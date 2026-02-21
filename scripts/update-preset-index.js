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

// GitHub API トークン（環境変数から取得）
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

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
  return fetchWithTimeout(url, { headers });
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
    console.error(`  ❌ Failed to fetch tree: ${response.status}`);
    return [];
  }

  const data = await response.json();
  return await processTree(data, owner, repoName, branch, source);
}

/**
 * ツリーを処理してスキルを抽出
 */
async function processTree(data, owner, repoName, branch, source) {
  // SKILL.md ファイルを探す
  const skillFiles = data.tree.filter((item) => {
    if (item.type !== "blob") return false;
    const lowerPath = item.path.toLowerCase();
    return lowerPath === "skill.md" || lowerPath.endsWith("/skill.md");
  });

  console.log(`  📄 Found ${skillFiles.length} SKILL.md files`);

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

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];

    // name
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    if (nameMatch) {
      name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
    }

    // description
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
    if (descMatch) {
      description = descMatch[1].trim().replace(/^["']|["']$/g, "");
    }

    // description_ja
    const descJaMatch = frontmatter.match(/^description_ja:\s*(.+)$/m);
    if (descJaMatch) {
      description_ja = descJaMatch[1].trim().replace(/^["']|["']$/g, "");
    }

    // categories
    const catMatch = frontmatter.match(/^categories:\s*\[([^\]]*)\]/m);
    if (catMatch) {
      categories = catMatch[1]
        .split(",")
        .map((c) => c.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
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

  return { name, description, description_ja, categories };
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
  for (const source of index.sources) {
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
        }
      }

      allSkills.push(...skills);
      console.log(`  ✅ ${skills.length} skills`);
    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
      // エラー時は既存のスキルを保持
      const existingSkills = existingSkillsBySource[source.id] || [];
      allSkills.push(...existingSkills);
      console.log(`  ⚠️  Kept ${existingSkills.length} existing skills`);
    }
  }

  // 重複を除去（名前で）
  const uniqueSkills = [];
  const seenNames = new Set();
  for (const skill of allSkills) {
    const key = skill.name.toLowerCase();
    if (!seenNames.has(key)) {
      seenNames.add(key);
      uniqueSkills.push(skill);
    }
  }

  // ソート
  uniqueSkills.sort((a, b) => a.name.localeCompare(b.name));

  // インデックスを更新
  const newIndex = {
    version: index.version,
    lastUpdated: new Date().toISOString().split("T")[0],
    sources: index.sources,
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

main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
