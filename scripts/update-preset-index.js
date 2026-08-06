#!/usr/bin/env node
/**
 * プリセットソースからスキルインデックスを更新するスクリプト
 * Usage: node scripts/update-preset-index.js
 *
 * 環境変数:
 *   GITHUB_TOKEN - GitHub API トークン（レート制限回避のため推奨）
 */

const fs = require("fs");
const path = require("path");

const INDEX_PATH = path.join(__dirname, "..", "resources", "skill-index.json");
const FETCH_TIMEOUT = 15000;
const CONCURRENCY = 5;
const SOURCE_FILTER = (process.env.SKILL_NINJA_SOURCES || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

// GitHub API トークン（環境変数から取得）
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

function normalizePathPrefix(prefix) {
  return String(prefix || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function pathMatchesPrefix(filePath, prefix) {
  return filePath === prefix || filePath.startsWith(`${prefix}/`);
}

function isSkillPathAllowed(filePath, source) {
  const normalizedPath = normalizePathPrefix(filePath);
  const includePaths = (source.includePaths || []).map(normalizePathPrefix);
  const excludePaths = (source.excludePaths || []).map(normalizePathPrefix);

  if (
    includePaths.length > 0 &&
    !includePaths.some((prefix) => pathMatchesPrefix(normalizedPath, prefix))
  ) {
    return false;
  }

  return !excludePaths.some((prefix) =>
    pathMatchesPrefix(normalizedPath, prefix),
  );
}

/**
 * タイムアウト付き fetch
 */
async function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * GitHub API リクエスト
 */
async function githubFetch(url) {
  const headers = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "SkillNinja-IndexUpdater",
  };
  if (GITHUB_TOKEN) {
    headers["Authorization"] = `token ${GITHUB_TOKEN}`;
  }
  const response = await fetchWithTimeout(url, { headers });
  if (response.status === 403 && headers.Authorization) {
    const bodyText = await response.clone().text();
    if (
      bodyText.includes("forbids access via a personal access tokens (classic)")
    ) {
      console.warn(
        "  ⚠️  Retrying without token because the repository rejects this classic PAT policy",
      );
      const retryHeaders = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "SkillNinja-IndexUpdater",
      };
      return fetchWithTimeout(url, { headers: retryHeaders });
    }
  }
  return response;
}

function unquoteYamlValue(value) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function stripYamlInlineComment(value) {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let bracketDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (char === "[") {
      bracketDepth += 1;
      continue;
    }

    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (char === "#" && bracketDepth === 0) {
      const previousChar = index > 0 ? value[index - 1] : "";
      if (index === 0 || /\s/.test(previousChar)) {
        return value.slice(0, index).trimEnd();
      }
    }
  }

  return value.trimEnd();
}

function parseInlineYamlArray(value) {
  const match = stripYamlInlineComment(value).match(/^\[(.*)\]$/);
  if (!match) {
    return [];
  }
  return match[1]
    .split(",")
    .map((item) => unquoteYamlValue(item))
    .filter(Boolean);
}

function getBlockScalarStyle(value) {
  const match = value.match(
    /^([>|])(?:([1-9])([+-])?|([+-])([1-9])?)?(?:\s+#.*)?$/,
  );
  return match ? match[1] : null;
}

function parseTopLevelFrontmatter(frontmatter) {
  const values = new Map();
  const lines = frontmatter.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) {
      continue;
    }

    const [, key, rawValue] = keyMatch;
    const trimmedValue = rawValue.trim();

    const blockScalarStyle = getBlockScalarStyle(trimmedValue);
    if (blockScalarStyle) {
      const blockLines = [];
      let blockIndent = null;

      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1];
        if (!nextLine.trim()) {
          blockLines.push("");
          index += 1;
          continue;
        }

        const indentMatch = nextLine.match(/^(\s+)/);
        if (!indentMatch) {
          break;
        }

        const indentLength = indentMatch[1].length;
        if (blockIndent === null) {
          blockIndent = indentLength;
        }
        if (indentLength < blockIndent) {
          break;
        }

        blockLines.push(nextLine.slice(blockIndent));
        index += 1;
      }

      const joined =
        blockScalarStyle === ">" ? blockLines.join(" ") : blockLines.join("\n");
      values.set(key, joined.trim());
      continue;
    }

    values.set(key, unquoteYamlValue(stripYamlInlineComment(trimmedValue)));
  }

  return values;
}

/**
 * リポジトリのデフォルトブランチを取得
 */
async function getDefaultBranch(owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const response = await githubFetch(url);
  if (!response.ok) {
    // フォールバック
    return "main";
  }
  const data = await response.json();
  return data.default_branch || "main";
}

const SHRINK_RATIO_THRESHOLD = 0.5;
const ALLOW_SHRINK = process.env.SKILL_NINJA_ALLOW_SHRINK === "1";

/**
 * 既存件数に対する急減を検出する。許容する場合は SKILL_NINJA_ALLOW_SHRINK=1 を付ける。
 */
function assertNoUnexpectedShrink(source, previousCount, nextCount) {
  if (ALLOW_SHRINK || previousCount === 0) {
    return undefined;
  }

  if (nextCount === 0 || nextCount < previousCount * SHRINK_RATIO_THRESHOLD) {
    return `Source ${source.id} dropped from ${previousCount} to ${nextCount} skills. Re-run with SKILL_NINJA_ALLOW_SHRINK=1 if the upstream removal is intentional.`;
  }

  return undefined;
}

/**
 * リポジトリ内の SKILL.md ファイルを検索
 */
async function scanRepositoryForSkills(source) {
  const match = source.url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    console.error(`  ❌ Invalid URL: ${source.url}`);
    return [];
  }

  const [, owner, repo] = match;
  const repoName = repo.replace(/\.git$/, "");

  // ブランチを決定
  const branch = source.branch || (await getDefaultBranch(owner, repoName));
  console.log(`  📦 ${owner}/${repoName} (branch: ${branch})`);

  // リポジトリのツリーを取得
  const treeUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/${branch}?recursive=1`;
  const response = await githubFetch(treeUrl);

  if (!response.ok) {
    if (response.status === 404) {
      // 別のブランチを試す
      const fallbackBranch = branch === "main" ? "master" : "main";
      const fallbackUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/${fallbackBranch}?recursive=1`;
      const fallbackResponse = await githubFetch(fallbackUrl);
      if (fallbackResponse.ok) {
        const data = await fallbackResponse.json();
        return await processTree(data, owner, repoName, fallbackBranch, source);
      }
    }
    throw new Error(`Failed to fetch tree: ${response.status}`);
  }

  const data = await response.json();
  return await processTree(data, owner, repoName, branch, source);
}

/**
 * ツリーを処理してスキルを抽出
 */
async function processTree(data, owner, repoName, branch, source) {
  // truncated のまま取り込むと、欠落したスキルが削除として確定してしまう
  if (data.truncated) {
    throw new Error(
      `GitHub tree response was truncated for ${owner}/${repoName}. Narrow the source with includePaths or split the repository into smaller sources.`,
    );
  }

  // SKILL.md ファイルを探す
  const skillFiles = data.tree.filter((item) => {
    if (item.type !== "blob") return false;
    const lowerPath = item.path.toLowerCase();
    return (
      (lowerPath === "skill.md" || lowerPath.endsWith("/skill.md")) &&
      isSkillPathAllowed(item.path, source)
    );
  });

  console.log(`  📄 Found ${skillFiles.length} SKILL.md files`);

  // 拡張本体は SKILL.md が 0 件のときだけ代替 scanner へ落とす。生成器はそれを持たないので黙って 0 件で確定させない。
  if (
    skillFiles.length === 0 &&
    source.scanner &&
    source.scanner !== "skill-md"
  ) {
    throw new Error(
      `Source ${source.id} declares scanner "${source.scanner}", which the preset generator does not implement. Regenerate this source from the extension or narrow includePaths.`,
    );
  }

  const skills = [];

  // 並列でスキル情報を取得
  const chunks = [];
  for (let i = 0; i < skillFiles.length; i += CONCURRENCY) {
    chunks.push(skillFiles.slice(i, i + CONCURRENCY));
  }

  for (const chunk of chunks) {
    const results = await Promise.all(
      chunk.map(async (file) => {
        try {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/${file.path}`;
          const response = await fetchWithTimeout(rawUrl);
          if (!response.ok) return null;

          const content = await response.text();
          const skillInfo = parseSkillFrontmatter(content, file.path);
          if (!skillInfo) return null;

          return {
            name: skillInfo.name,
            source: source.id,
            path: file.path
              .replace(/\/SKILL\.md$/i, "")
              .replace(/^SKILL\.md$/i, ""),
            categories: skillInfo.categories || [],
            description: skillInfo.description || "",
            description_ja: skillInfo.description_ja,
            standalone: skillInfo.standalone,
            requires: skillInfo.requires,
            bundle: skillInfo.bundle,
            license: skillInfo.license,
            author: skillInfo.author,
            version: skillInfo.version,
          };
        } catch (error) {
          return null;
        }
      }),
    );

    skills.push(...results.filter(Boolean));
  }

  return skills;
}

/**
 * SKILL.md の frontmatter を解析
 */
function parseSkillFrontmatter(content, filePath) {
  const normalizedContent = content.replace(/\r\n/g, "\n");
  // frontmatter を抽出
  const frontmatterMatch = normalizedContent.match(/^---\n([\s\S]*?)\n---/);

  let name = "";
  let description = "";
  let description_ja = "";
  let categories = [];
  let standalone;
  let requires;
  let bundle;
  let license;
  let author;
  let version;

  if (frontmatterMatch) {
    const frontmatter = parseTopLevelFrontmatter(frontmatterMatch[1]);
    const metadataMatch = frontmatterMatch[1].match(
      /metadata:[\s\S]*?author:\s*["']?([^"'\n]+)["']?/m,
    );
    name = frontmatter.get("name") || "";
    description = frontmatter.get("description") || "";
    description_ja = frontmatter.get("description_ja") || "";
    categories = parseInlineYamlArray(frontmatter.get("categories") || "[]");
    standalone =
      frontmatter.get("standalone") === "true"
        ? true
        : frontmatter.get("standalone") === "false"
          ? false
          : undefined;
    requires = parseInlineYamlArray(frontmatter.get("requires") || "[]");
    bundle = frontmatter.get("bundle") || undefined;
    license = frontmatter.get("license") || undefined;
    author = frontmatter.get("author") || metadataMatch?.[1]?.trim();
    version = frontmatter.get("version") || undefined;
  }

  // name がない場合はパスから推測
  if (!name) {
    const pathParts = filePath.split("/");
    const folderName = pathParts[pathParts.length - 2] || pathParts[0];
    if (folderName && folderName.toLowerCase() !== "skill.md") {
      name = folderName;
    }
  }

  // # ヘッダーから name を取得
  if (!name) {
    const headerMatch = normalizedContent.match(/^#\s+(.+)$/m);
    if (headerMatch) {
      name = headerMatch[1].trim();
    }
  }

  if (!name) {
    return null;
  }

  // description がない場合は本文から抽出
  if (!description) {
    const lines = normalizedContent.split("\n");
    let inFrontmatter = false;
    for (const line of lines) {
      if (line.trim() === "---") {
        inFrontmatter = !inFrontmatter;
        continue;
      }
      if (inFrontmatter) continue;

      const trimmed = line.trim();
      if (
        trimmed &&
        !trimmed.startsWith("#") &&
        !trimmed.startsWith("Source:") &&
        !trimmed.startsWith("<!--")
      ) {
        description = trimmed.substring(0, 200);
        break;
      }
    }
  }

  return {
    name,
    description,
    description_ja,
    categories,
    standalone,
    requires: requires?.length ? requires : undefined,
    bundle,
    license,
    author,
    version,
  };
}

/**
 * メイン処理
 */
async function main() {
  console.log("🥷 Skill Ninja - Preset Index Updater\n");

  if (!GITHUB_TOKEN) {
    console.log("⚠️  GITHUB_TOKEN not set. Rate limit: 60 requests/hour");
    console.log("   Set GITHUB_TOKEN for 5000 requests/hour\n");
  } else {
    console.log("✅ GITHUB_TOKEN detected\n");
  }

  // 現在のインデックスを読み込む
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));
  console.log(
    `📂 Current index: ${index.skills.length} skills, ${index.sources.length} sources\n`,
  );

  // 既存のスキルを保持（ソースIDでグループ化）
  const existingSkillsBySource = {};
  for (const skill of index.skills) {
    if (!existingSkillsBySource[skill.source]) {
      existingSkillsBySource[skill.source] = [];
    }
    existingSkillsBySource[skill.source].push(skill);
  }

  // 各ソースをスキャン
  const allSkills = [];
  const failures = [];
  const sourcesToUpdate =
    SOURCE_FILTER.length > 0
      ? index.sources.filter((source) => SOURCE_FILTER.includes(source.id))
      : index.sources;

  if (SOURCE_FILTER.length > 0 && sourcesToUpdate.length === 0) {
    const availableSourceIds = index.sources
      .map((source) => source.id)
      .join(", ");
    console.error(
      "\n❌ Preset index update aborted. SKILL_NINJA_SOURCES did not match any source IDs.",
    );
    console.error(`Requested: ${SOURCE_FILTER.join(", ")}`);
    console.error(`Available: ${availableSourceIds}`);
    process.exit(1);
  }

  for (const source of sourcesToUpdate) {
    console.log(`\n🔄 Updating: ${source.name}`);
    try {
      const skills = await scanRepositoryForSkills(source);

      // 既存のスキル情報をマージ（description_ja など）
      const existingSkills = existingSkillsBySource[source.id] || [];
      const existingMap = new Map(existingSkills.map((s) => [s.name, s]));

      for (const skill of skills) {
        const existing = existingMap.get(skill.name);
        if (existing) {
          // 既存の情報を保持
          if (!skill.description && existing.description) {
            skill.description = existing.description;
          }
          if (!skill.description_ja && existing.description_ja) {
            skill.description_ja = existing.description_ja;
          }
          if (
            skill.categories.length === 0 &&
            existing.categories?.length > 0
          ) {
            skill.categories = existing.categories;
          }
          if (
            skill.standalone === undefined &&
            existing.standalone !== undefined
          ) {
            skill.standalone = existing.standalone;
          }
          if (!skill.requires?.length && existing.requires?.length) {
            skill.requires = existing.requires;
          }
          if (!skill.bundle && existing.bundle) {
            skill.bundle = existing.bundle;
          }
          if (!skill.license && existing.license) {
            skill.license = existing.license;
          }
          if (!skill.author && existing.author) {
            skill.author = existing.author;
          }
          if (!skill.version && existing.version) {
            skill.version = existing.version;
          }
        }
      }

      allSkills.push(...skills);
      console.log(`  ✅ ${skills.length} skills`);

      // 件数の急減はコード側の scan 規則ズレを示すことが多いので、黙って確定させない
      const shrinkGuard = assertNoUnexpectedShrink(
        source,
        existingSkills.length,
        skills.length,
      );
      if (shrinkGuard) {
        throw new Error(shrinkGuard);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ Error: ${message}`);
      failures.push({ source: source.name, message });
    }
  }

  // Preserve all-or-nothing semantics here.
  // Falling back to stale per-source data on failure makes bundled counts look fresh
  // while silently locking in degraded index contents.
  if (failures.length > 0) {
    console.error(
      "\n❌ Preset index update aborted. One or more sources failed:",
    );
    for (const failure of failures) {
      console.error(`  - ${failure.source}: ${failure.message}`);
    }
    console.error("\nNo changes were written to resources/skill-index.json.");
    process.exit(1);
  }

  if (SOURCE_FILTER.length > 0) {
    const untouchedSkills = index.skills.filter(
      (skill) => !SOURCE_FILTER.includes(skill.source),
    );
    allSkills.push(...untouchedSkills);
  }

  // 重複を除去（name で判定）
  // インストール先ディレクトリは skill name ベースのため、
  // 同名スキルを複数残すと上書き衝突を起こす。
  const uniqueSkills = [];
  const seenSkills = new Set();
  for (const skill of allSkills) {
    const key = skill.name.toLowerCase();
    if (!seenSkills.has(key)) {
      seenSkills.add(key);
      uniqueSkills.push(skill);
    }
  }

  // ソート
  uniqueSkills.sort((a, b) => a.name.localeCompare(b.name));

  // インデックスを更新
  // 再生成したソースには lastIndexedAt を刻む。無いと index.lastUpdated が代用され、
  // 全ソースが同じ日に一斉 stale 化する。
  const indexedAt = new Date().toISOString();
  const updatedSourceIds = new Set(sourcesToUpdate.map((source) => source.id));
  const newIndex = {
    version: index.version,
    lastUpdated: new Date().toISOString().split("T")[0],
    sources: index.sources.map((source) =>
      updatedSourceIds.has(source.id)
        ? { ...source, lastIndexedAt: indexedAt }
        : source,
    ),
    categories: index.categories,
    bundles: index.bundles,
    skills: uniqueSkills,
  };

  // 保存
  fs.writeFileSync(
    INDEX_PATH,
    JSON.stringify(newIndex, null, 2) + "\n",
    "utf-8",
  );

  console.log(
    `\n✅ Updated: ${uniqueSkills.length} skills (was ${index.skills.length})`,
  );
  console.log(`📁 Saved to: ${INDEX_PATH}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
}

module.exports = {
  normalizePathPrefix,
  pathMatchesPrefix,
  isSkillPathAllowed,
  processTree,
  assertNoUnexpectedShrink,
};
