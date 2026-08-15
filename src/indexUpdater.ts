// インデックス更新とGitHub検索機能
// GitHub API を使用してスキルを検索・更新

import * as vscode from "vscode";
import {
  SkillIndex,
  Skill,
  Source,
  SourceScanner,
  Bundle,
  saveSkillIndex,
} from "./skillIndex";
import { messages } from "./i18n";
import { getGitHubToken, hasStoredGitHubToken } from "./githubAuth";
export { checkGitHubAuth } from "./githubAuth";
import { LICENSE_EXTRACTION, INDEX_LIMITS } from "./constants";
import {
  createGitHubResponseError,
  isGitHubResponseError,
} from "./githubResponse";
import {
  fetchGitHubWithOptionalAuthRetry,
  fetchGitHubWithRetry,
  fetchGitHubWithTimeout,
  GITHUB_REQUEST_TIMEOUT_MS,
} from "./githubFetch";
import {
  createSourceBundleKey,
  hasRepositoryIdentityChanged,
  reconcileSourceBundles,
  shouldPreserveSkillsOnEmptyScan,
} from "./sourceUpdateReconcile";

const FETCH_CONCURRENCY = 8;
const GITHUB_API_VERSION = "2022-11-28";

function getIndexDateStamp(): string {
  return new Date().toISOString().split("T")[0];
}

function getSourceIndexedStamp(): string {
  return new Date().toISOString();
}

function stampSourceIndexedAt(
  sources: Source[],
  sourceId: string,
  indexedAt: string,
  canonicalUrl?: string,
  repoId?: number,
): Source[] {
  return sources.map((source) =>
    source.id === sourceId
      ? {
          ...source,
          url: canonicalUrl || source.url,
          repoId: repoId ?? source.repoId,
          lastIndexedAt: indexedAt,
        }
      : source,
  );
}

function encodeGitHubContentPath(filePath: string): string {
  return filePath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function joinRepositoryPath(...segments: Array<string | undefined>): string {
  return segments
    .filter((segment): segment is string => Boolean(segment?.trim()))
    .map((segment) => segment.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

export async function fetchRepositoryTextFile(
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
  token?: string,
  timeoutMs: number = GITHUB_REQUEST_TIMEOUT_MS,
): Promise<string | undefined> {
  const effectiveToken = token || (await getGitHubToken());
  const encodedPath = encodeGitHubContentPath(filePath);
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const anonymousUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${encodedPath}`;
  const fetchAnonymously = () =>
    fetchGitHubWithRetry(
      anonymousUrl,
      { headers: { "User-Agent": "VSCode-SkillNinja" } },
      timeoutMs,
    );

  let response = await fetchAnonymously();
  if (response.status === 404 && effectiveToken) {
    // Route the authenticated attempt through the shared fallback so a stale
    // credential can still be replaced by the next available token source.
    response = await fetchGitHubWithOptionalAuthRetry(url, {
      accept: "application/vnd.github.raw+json",
      token: effectiveToken,
      extraHeaders: { "X-GitHub-Api-Version": GITHUB_API_VERSION },
      request: (requestUrl, init) =>
        fetchGitHubWithTimeout(requestUrl, init, timeoutMs),
    });
  }

  if (response.ok) {
    return await response.text();
  }

  if (response.status === 404) {
    return undefined;
  }

  const bodyText = await response
    .clone()
    .text()
    .catch(() => "");
  if (
    response.status === 401 ||
    response.status === 403 ||
    response.status === 429 ||
    bodyText.toLowerCase().includes("rate limit")
  ) {
    throw createGitHubResponseError(
      response,
      bodyText,
      `GitHub content request failed for ${owner}/${repo}/${filePath}`,
    );
  }

  return undefined;
}

function getPrivateRepositoryAuthHint(token?: string): string {
  return token
    ? " If this is a private repository, GitHub authentication may be missing Contents: read permission."
    : " If this is a private repository, GitHub authentication is required.";
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R | undefined>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: Array<R | undefined> = new Array(items.length);
  let index = 0;

  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (index < items.length) {
        const currentIndex = index;
        const current = items[currentIndex];
        index += 1;
        results[currentIndex] = await worker(current);
      }
    },
  );

  await Promise.all(runners);
  return results.filter((r): r is R => r !== undefined);
}

/**
 * LICENSE.txt を取得してライセンス名を抽出
 */
async function fetchAndExtractLicense(
  owner: string,
  repo: string,
  skillDir: string,
  branch: string,
  token?: string,
): Promise<string | null> {
  // 試すファイル名のリスト
  const licenseFiles = LICENSE_EXTRACTION.FILE_NAMES;

  for (const filename of licenseFiles) {
    try {
      const content = await fetchRepositoryTextFile(
        owner,
        repo,
        branch,
        joinRepositoryPath(skillDir, filename),
        token,
      );
      if (content) {
        const license = extractLicenseFromContent(content);
        if (license) {
          return license;
        }
      }
    } catch {
      // 取得失敗は無視
    }
  }
  return null;
}

/**
 * LICENSE ファイルの内容からライセンス名を抽出
 */
function extractLicenseFromContent(content: string): string | null {
  const firstLines = content
    .substring(0, LICENSE_EXTRACTION.SCAN_LENGTH)
    .toLowerCase();

  // パターンマッチング（優先度順）
  const patterns: [RegExp, string][] = [
    // MIT
    [/mit license/i, "MIT"],
    [/permission is hereby granted, free of charge/i, "MIT"],
    // Apache 2.0
    [/apache license,?\s*version 2\.0/i, "Apache-2.0"],
    [/apache-2\.0/i, "Apache-2.0"],
    // GPL
    [/gnu general public license.*version 3/i, "GPL-3.0"],
    [/gpl-3\.0/i, "GPL-3.0"],
    [/gnu general public license.*version 2/i, "GPL-2.0"],
    // LGPL
    [/gnu lesser general public license/i, "LGPL"],
    // BSD
    [/bsd 3-clause/i, "BSD-3-Clause"],
    [/bsd 2-clause/i, "BSD-2-Clause"],
    [/redistribution and use in source and binary forms/i, "BSD"],
    // Creative Commons
    [/cc by-nc-sa 4\.0/i, "CC BY-NC-SA 4.0"],
    [
      /creative commons attribution-noncommercial-sharealike 4\.0/i,
      "CC BY-NC-SA 4.0",
    ],
    [/cc by-nc 4\.0/i, "CC BY-NC 4.0"],
    [/creative commons attribution-noncommercial 4\.0/i, "CC BY-NC 4.0"],
    [/cc by-sa 4\.0/i, "CC BY-SA 4.0"],
    [/cc by 4\.0/i, "CC BY 4.0"],
    [/cc0/i, "CC0"],
    // ISC
    [/isc license/i, "ISC"],
    // Mozilla
    [/mozilla public license/i, "MPL-2.0"],
    // Unlicense
    [/unlicense/i, "Unlicense"],
    // Anthropic Proprietary
    [/© \d+ anthropic/i, "Anthropic Proprietary"],
    [/anthropic.*all rights reserved/i, "Anthropic Proprietary"],
    // Proprietary
    [/proprietary/i, "Proprietary"],
    [/all rights reserved/i, "Proprietary"],
  ];

  for (const [pattern, licenseName] of patterns) {
    if (pattern.test(firstLines)) {
      return licenseName;
    }
  }

  // 1行目にライセンス名が書いてある場合（例: "# MIT License"）
  const firstLine = content.split("\n")[0].replace(/^#\s*/, "").trim();
  if (firstLine.length < 50 && firstLine.length > 2) {
    return firstLine;
  }

  return null;
}

/**
 * GitHub API リクエストを実行（認証付き）
 */
async function githubFetch(url: string, token?: string): Promise<Response> {
  // トークンが渡されなかった場合は自動取得を試みる
  const effectiveToken = token || (await getGitHubToken());
  return fetchGitHubWithOptionalAuthRetry(url, {
    accept: "application/vnd.github.v3+json",
    token: effectiveToken,
    request: fetchGitHubWithTimeout,
  });
}

function unquoteYamlValue(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function stripYamlInlineComment(value: string): string {
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

function parseInlineYamlArray(value: string): string[] {
  const match = stripYamlInlineComment(value).match(/^\[(.*)\]$/);
  if (!match) {
    return [];
  }

  return match[1]
    .split(",")
    .map((item) => unquoteYamlValue(item))
    .filter(Boolean);
}

function getBlockScalarStyle(value: string): ">" | "|" | null {
  const match = value.match(
    /^([>|])(?:([1-9])([+-])?|([+-])([1-9])?)?(?:\s+#.*)?$/,
  );
  if (!match) {
    return null;
  }

  return match[1] as ">" | "|";
}

function parseTopLevelFrontmatter(frontmatter: string): Map<string, string> {
  const values = new Map<string, string>();
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
      const blockLines: string[] = [];
      let blockIndent: number | null = null;

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

      values.set(
        key,
        (blockScalarStyle === ">"
          ? blockLines.join(" ")
          : blockLines.join("\n")
        ).trim(),
      );
      continue;
    }

    values.set(key, unquoteYamlValue(stripYamlInlineComment(trimmedValue)));
  }

  return values;
}

export type SourceScanOptions = Pick<
  Source,
  "includePaths" | "excludePaths" | "scanner"
>;

/**
 * source 定義の `scanner` を優先し、未指定のときだけ repo 名ベースの legacy 判定へ落とす。
 * repo 名判定は rename で黙って外れるため、preset source では常に明示する。
 */
export function resolveSourceScanner(
  repoName: string,
  sourceOptions?: Pick<Source, "scanner">,
): SourceScanner {
  if (sourceOptions?.scanner) {
    return sourceOptions.scanner;
  }

  const lowerName = repoName.toLowerCase();
  if (lowerName.includes("skill-registry")) {
    return "registry-json";
  }
  if (lowerName.includes("prps-agentic")) {
    return "claude-commands";
  }
  if (lowerName.includes("awesome-claude-skills")) {
    return "top-level-dirs";
  }

  return "skill-md";
}

interface ResolvedRepository {
  owner: string;
  repo: string;
  defaultBranch?: string;
  repoId?: number;
}

const repositoryResolutionCache = new Map<string, ResolvedRepository>();

export function clearRepositoryResolutionCache(): void {
  repositoryResolutionCache.clear();
}

/**
 * owner/repo を canonical な値へ解決する。
 * リネーム済みリポジトリでも GitHub の redirect に依存せずに済ませるため、
 * full_name を正として以降の tree / raw URL を組み立てる。
 */
async function resolveRepository(
  owner: string,
  repo: string,
  token?: string,
): Promise<ResolvedRepository> {
  const cacheKey = `${owner}/${repo}`.toLowerCase();
  const cached = repositoryResolutionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const fallback: ResolvedRepository = { owner, repo };
  let response: Response;
  try {
    response = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      token,
    );
  } catch {
    return fallback;
  }

  if (!response.ok) {
    return fallback;
  }

  const info = (await response.json().catch(() => undefined)) as
    | { full_name?: string; default_branch?: string; id?: number }
    | undefined;
  const [resolvedOwner, resolvedRepo] = (info?.full_name || "").split("/");
  const resolved: ResolvedRepository = {
    owner: resolvedOwner || owner,
    repo: resolvedRepo || repo,
    defaultBranch: info?.default_branch,
    repoId: info?.id,
  };

  repositoryResolutionCache.set(cacheKey, resolved);
  return resolved;
}

type ScanResult = { skills: Skill[]; source: Source; bundles?: Bundle[] };

function withResolvedRepoId(result: ScanResult, repoId?: number): ScanResult {
  if (repoId === undefined) {
    return result;
  }

  return { ...result, source: { ...result.source, repoId } };
}

/**
 * リポジトリ内のSKILL.mdファイルを検索
 */
export async function scanRepositoryForSkills(
  repoUrl: string,
  token?: string,
  preferredBranch?: string, // skill-index.json で指定されたブランチ
  sourceOptions?: SourceScanOptions,
): Promise<{ skills: Skill[]; source: Source; bundles?: Bundle[] } | null> {
  // URLからowner/repoを抽出
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    throw new Error("Invalid GitHub repository URL");
  }

  const [, requestedOwner, requestedRepo] = match;
  // リネーム済みリポジトリでは redirect 頼みにせず canonical な owner/repo を使う
  const resolved = await resolveRepository(
    requestedOwner,
    requestedRepo.replace(/\.git$/, ""),
    token,
  );
  const owner = resolved.owner;
  const repoName = resolved.repo;
  const canonicalUrl = `https://github.com/${owner}/${repoName}`;

  // ブランチを決定: 指定されたブランチ → デフォルトブランチを取得
  const branch = preferredBranch || resolved.defaultBranch || "main";

  // claude-skill-registry 特別処理: registry.json から読み込む
  if (resolveSourceScanner(repoName, sourceOptions) === "registry-json") {
    const registryResult = await scanSkillRegistryJson(
      owner,
      repoName,
      branch,
      token,
      sourceOptions,
    );
    if (registryResult) {
      return withResolvedRepoId(registryResult, resolved.repoId);
    }
    // registry.json がない場合は通常処理にフォールバック
  }

  // リポジトリのツリーを取得
  const treeUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/${branch}?recursive=1`;
  const response = await githubFetch(treeUrl, token);

  if (!response.ok) {
    if (response.status === 404 && !preferredBranch) {
      // 指定ブランチがない場合のみ別のブランチを試す
      const fallbackBranch = branch === "main" ? "master" : "main";
      const fallbackUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/${fallbackBranch}?recursive=1`;
      const fallbackResponse = await githubFetch(fallbackUrl, token);
      if (fallbackResponse.ok) {
        const fallbackData = (await fallbackResponse.json()) as {
          tree: Array<{ path: string; type: string }>;
          truncated?: boolean;
        };
        return withResolvedRepoId(
          await processTreeResponse(
            fallbackData,
            owner,
            repoName,
            canonicalUrl,
            fallbackBranch,
            token,
            sourceOptions,
          ),
          resolved.repoId,
        );
      }
      const fallbackBody = await fallbackResponse
        .clone()
        .text()
        .catch(() => "");
      if (fallbackResponse.status !== 404) {
        throw createGitHubResponseError(
          fallbackResponse,
          fallbackBody,
          `GitHub tree request failed for ${owner}/${repoName}`,
        );
      }
      throw new Error(
        `Repository or branch not found: ${owner}/${repoName} (branch: ${branch}).${getPrivateRepositoryAuthHint(token)}`,
      );
    }
    if (response.status === 404) {
      throw new Error(
        `Repository or branch not found: ${owner}/${repoName} (branch: ${branch}).${getPrivateRepositoryAuthHint(token)}`,
      );
    }
    const bodyText = await response
      .clone()
      .text()
      .catch(() => "");
    throw createGitHubResponseError(
      response,
      bodyText,
      `GitHub tree request failed for ${owner}/${repoName}`,
    );
  }

  const responseData = (await response.json()) as {
    tree: Array<{ path: string; type: string }>;
    truncated?: boolean;
  };
  return withResolvedRepoId(
    await processTreeResponse(
      responseData,
      owner,
      repoName,
      canonicalUrl,
      branch,
      token,
      sourceOptions,
    ),
    resolved.repoId,
  );
}

function normalizePathPrefix(prefix: string): string {
  return prefix
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function pathMatchesPrefix(filePath: string, prefix: string): boolean {
  return filePath === prefix || filePath.startsWith(`${prefix}/`);
}

function isSkillPathAllowed(
  filePath: string,
  sourceOptions?: Pick<Source, "includePaths" | "excludePaths">,
): boolean {
  const normalizedPath = normalizePathPrefix(filePath);
  const includePaths = (sourceOptions?.includePaths || []).map(
    normalizePathPrefix,
  );
  const excludePaths = (sourceOptions?.excludePaths || []).map(
    normalizePathPrefix,
  );

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
 * ツリーレスポンスを処理してスキルを抽出
 */
async function processTreeResponse(
  data: { tree: Array<{ path: string; type: string }>; truncated?: boolean },
  owner: string,
  repoName: string,
  repoUrl: string,
  branch: string,
  token?: string,
  sourceOptions?: SourceScanOptions,
): Promise<{ skills: Skill[]; source: Source; bundles?: Bundle[] }> {
  if (data.truncated) {
    throw new Error(
      `GitHub tree response was truncated for ${owner}/${repoName}. Narrow the source with includePaths or split the repository into smaller sources.`,
    );
  }

  // SKILL.md / skill.md ファイルを探す（どのディレクトリでも可、大文字小文字両対応）
  const skillFiles = data.tree.filter((item) => {
    if (item.type !== "blob") return false;
    const lowerPath = item.path.toLowerCase();
    // 正確に skill.md で終わるもののみ（blockskill.md 等を除外）
    return (
      (lowerPath === "skill.md" || lowerPath.endsWith("/skill.md")) &&
      isSkillPathAllowed(item.path, sourceOptions)
    );
  });
  const canUseLegacyFallbackScanner = skillFiles.length === 0;
  const scanner = resolveSourceScanner(repoName, sourceOptions);

  if (scanner === "claude-commands" && canUseLegacyFallbackScanner) {
    const claudeCommandSkills = await scanClaudeCommands(
      data,
      owner,
      repoName,
      branch,
      token,
      sourceOptions,
    );
    const source: Source = {
      id: `${owner}-${repoName}`,
      name: repoName,
      url: repoUrl.replace(/\.git$/, ""),
      type: "user-added",
      branch, // ブランチを保存
      description: `User added repository: ${owner}/${repoName}`,
      includePaths: sourceOptions?.includePaths,
      excludePaths: sourceOptions?.excludePaths,
    };
    return { skills: claudeCommandSkills, source };
  }

  if (scanner === "top-level-dirs" && canUseLegacyFallbackScanner) {
    const composioSkills = scanComposioSkills(
      data,
      owner,
      repoName,
      sourceOptions,
    );
    const source: Source = {
      id: `${owner}-${repoName}`,
      name: repoName,
      url: repoUrl.replace(/\.git$/, ""),
      type: "user-added",
      branch, // ブランチを保存
      description: `User added repository: ${owner}/${repoName}`,
      includePaths: sourceOptions?.includePaths,
      excludePaths: sourceOptions?.excludePaths,
    };
    return { skills: composioSkills, source };
  }

  const skills = await mapWithConcurrency(
    skillFiles,
    FETCH_CONCURRENCY,
    async (file): Promise<Skill | undefined> => {
      try {
        // SKILL.md の内容を取得して frontmatter を解析
        const content = await fetchRepositoryTextFile(
          owner,
          repoName,
          branch,
          file.path,
          token,
        );
        if (!content) return undefined;
        const skillInfo = parseSkillFrontmatter(content, file.path);
        if (!skillInfo) {
          return undefined;
        }

        const skill: Skill = {
          name: skillInfo.name,
          source: `${owner}-${repoName}`,
          path: normalizeSkillRootPathFromSkillFile(file.path),
          categories: skillInfo.categories || [],
          description: skillInfo.description || "",
        };
        // Bundle/Framework対応フィールドを追加（存在する場合のみ）
        if (skillInfo.standalone !== undefined) {
          skill.standalone = skillInfo.standalone;
        }
        if (skillInfo.requires?.length) {
          skill.requires = skillInfo.requires;
        }
        if (skillInfo.bundle) {
          skill.bundle = skillInfo.bundle;
        }
        // メタデータフィールドを追加
        let license = skillInfo.license;
        // license が曖昧な場合は LICENSE.txt から抽出を試行
        if (
          !license ||
          license.toLowerCase().includes("license.txt") ||
          license.toLowerCase().includes("complete terms")
        ) {
          const skillDir = normalizeSkillRootPathFromSkillFile(file.path);
          const extractedLicense = await fetchAndExtractLicense(
            owner,
            repoName,
            skillDir,
            branch,
            token,
          );
          if (extractedLicense) {
            license = extractedLicense;
          }
        }
        if (license) {
          skill.license = license;
        }
        if (skillInfo.author) {
          skill.author = skillInfo.author;
        }
        if (skillInfo.version) {
          skill.version = skillInfo.version;
        }
        return skill;
      } catch (error) {
        if (isGitHubResponseError(error)) {
          throw error;
        }
        // 個別のスキル取得エラーは無視して続行
        console.warn(`Failed to fetch skill: ${file.path}`);
        return undefined;
      }
    },
  );

  // bundle.json を検出してBundle定義を取得
  const bundles = await scanBundleJson(
    data,
    owner,
    repoName,
    branch,
    token,
    sourceOptions,
  );

  // 同じスキル名の重複を除去（パスが短い方を優先）
  // 例: vscode-extension-guide と skills/vscode-extension-guide がある場合、前者を優先
  const skillMap = new Map<string, Skill>();
  for (const skill of skills) {
    const existing = skillMap.get(skill.name.toLowerCase());
    if (!existing) {
      skillMap.set(skill.name.toLowerCase(), skill);
    } else {
      // パスが短い方を優先（ルートに近い方）
      if (skill.path.length < existing.path.length) {
        skillMap.set(skill.name.toLowerCase(), skill);
      }
    }
  }
  const deduplicatedSkills = Array.from(skillMap.values());

  const source: Source = {
    id: `${owner}-${repoName}`,
    name: repoName,
    url: repoUrl.replace(/\.git$/, ""),
    type: "user-added",
    branch, // ブランチを保存
    description: `User added repository: ${owner}/${repoName}`,
    includePaths: sourceOptions?.includePaths,
    excludePaths: sourceOptions?.excludePaths,
  };

  return { skills: deduplicatedSkills, source, bundles };
}

export function normalizeSkillRootPathFromSkillFile(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, "/");
  if (/^skill\.md$/i.test(normalizedPath)) {
    return "";
  }

  return normalizedPath.replace(/\/skill\.md$/i, "");
}

/**
 * bundle.json を検出してBundle定義を取得
 * リポジトリルートまたは特定のパスにあるbundle.jsonを読み込む
 */
async function scanBundleJson(
  data: { tree: Array<{ path: string; type: string }> },
  owner: string,
  repoName: string,
  branch: string,
  token?: string,
  sourceOptions?: Pick<Source, "includePaths" | "excludePaths">,
): Promise<Bundle[]> {
  // bundle.json ファイルを探す（ルートまたはどこでも）
  const bundleFiles = data.tree.filter(
    (item) =>
      item.type === "blob" &&
      (item.path === "bundle.json" || item.path.endsWith("/bundle.json")) &&
      isSkillPathAllowed(item.path, sourceOptions),
  );

  const bundles: Bundle[] = [];
  const sourceId = `${owner}-${repoName}`;

  for (const file of bundleFiles) {
    try {
      const content = await fetchRepositoryTextFile(
        owner,
        repoName,
        branch,
        file.path,
        token,
      );
      if (content) {
        const bundleData = JSON.parse(content);

        // 単一のBundle定義の場合
        if (bundleData.id && bundleData.name && bundleData.skills) {
          bundles.push({
            id: bundleData.id,
            name: bundleData.name,
            source: sourceId,
            description: bundleData.description || "",
            description_ja: bundleData.description_ja,
            skills: bundleData.skills,
            installOrder: bundleData.installOrder,
            coreSkill: bundleData.coreSkill,
          });
        }

        // 複数のBundle定義（bundles配列）の場合
        if (Array.isArray(bundleData.bundles)) {
          for (const b of bundleData.bundles) {
            if (b.id && b.name && b.skills) {
              bundles.push({
                id: b.id,
                name: b.name,
                source: sourceId,
                description: b.description || "",
                description_ja: b.description_ja,
                skills: b.skills,
                installOrder: b.installOrder,
                coreSkill: b.coreSkill,
              });
            }
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to parse bundle.json: ${file.path}`, error);
    }
  }

  return bundles;
}

/**
 * PRPs-agentic-eng リポジトリ専用: .claude/commands/ 内の .md ファイルをスキャン
 * このリポジトリは SKILL.md ではなく Claude Code コマンド形式を使用
 */
async function scanClaudeCommands(
  data: { tree: Array<{ path: string; type: string }> },
  owner: string,
  repoName: string,
  branch: string,
  token?: string,
  sourceOptions?: Pick<Source, "includePaths" | "excludePaths">,
): Promise<Skill[]> {
  console.log(
    `[Skill Ninja] scanClaudeCommands: ${owner}/${repoName} branch=${branch}`,
  );
  console.log(`[Skill Ninja] Total tree items: ${data.tree.length}`);

  // .claude/commands/ 配下の .md ファイルを取得
  const commandFiles = data.tree.filter(
    (item) =>
      item.type === "blob" &&
      item.path.startsWith(".claude/commands/") &&
      item.path.endsWith(".md") &&
      isSkillPathAllowed(item.path, sourceOptions),
  );

  console.log(`[Skill Ninja] Found ${commandFiles.length} command files`);

  const skills = await mapWithConcurrency(
    commandFiles,
    FETCH_CONCURRENCY,
    async (file): Promise<Skill | undefined> => {
      try {
        // コマンドの内容を取得
        const content = await fetchRepositoryTextFile(
          owner,
          repoName,
          branch,
          file.path,
          token,
        );
        if (!content) return undefined;

        // パスからスキル名を抽出: .claude/commands/category/command-name.md -> category/command-name
        const pathWithoutPrefix = file.path.replace(".claude/commands/", "");
        const skillName = pathWithoutPrefix.replace(".md", "");

        // ファイルの最初の行から説明を抽出（# Title 形式）
        const lines = content.split("\n");
        let description = "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("# ")) {
            description = trimmed
              .replace(/^#+\s*/, "")
              .substring(0, INDEX_LIMITS.SHORT_DESCRIPTION);
            break;
          }
          // frontmatter 内の description も確認
          if (trimmed.startsWith("description:")) {
            description = trimmed
              .replace(/^description:\s*["']?/, "")
              .replace(/["']$/, "")
              .substring(0, INDEX_LIMITS.SHORT_DESCRIPTION);
            break;
          }
        }

        // カテゴリはパスのディレクトリ名から推測
        const pathParts = skillName.split("/");
        const category = pathParts.length > 1 ? pathParts[0] : "command";

        return {
          name: skillName,
          source: `${owner}-${repoName}`,
          path: file.path,
          categories: [category, "claude-code", "prp"],
          description: description || `Claude Code command: ${skillName}`,
        };
      } catch (error) {
        if (isGitHubResponseError(error)) {
          throw error;
        }
        console.warn(`Failed to fetch command: ${file.path}`);
        return undefined;
      }
    },
  );

  return skills;
}

/**
 * ComposioHQ/awesome-claude-skills リポジトリ専用: トップレベルディレクトリをスキルとして扱う
 * このリポジトリは SKILL.md を持たないディレクトリベースの構造
 */
function scanComposioSkills(
  data: { tree: Array<{ path: string; type: string }> },
  owner: string,
  repoName: string,
  sourceOptions?: Pick<Source, "includePaths" | "excludePaths">,
): Skill[] {
  // 除外するディレクトリ（設定ファイルや非スキル）
  const excludeDirs = new Set([
    ".claude-plugin",
    ".github",
    ".git",
    "scripts",
    "templates",
    "resources",
  ]);

  // トップレベルのディレクトリを取得（スキルディレクトリ）
  const topLevelDirs = data.tree.filter(
    (item) =>
      item.type === "tree" &&
      !item.path.includes("/") &&
      !item.path.startsWith(".") &&
      !excludeDirs.has(item.path),
  );

  const skills: Skill[] = topLevelDirs.map((dir) => ({
    name: dir.path,
    source: `${owner}-${repoName}`,
    path: dir.path,
    categories: ["community"],
    description: `${dir.path} skill`,
  }));

  return skills.filter((skill) =>
    isSkillPathAllowed(skill.path, sourceOptions),
  );
}

/**
 * claude-skill-registry 専用: registry.json から直接スキルを読み込む
 * このリポジトリは 43,000+ のスキルを registry.json に集約している
 */
async function scanSkillRegistryJson(
  owner: string,
  repoName: string,
  branch: string,
  token?: string,
  sourceOptions?: Pick<Source, "includePaths" | "excludePaths">,
): Promise<{ skills: Skill[]; source: Source } | null> {
  console.log(
    `[Skill Ninja] scanSkillRegistryJson: ${owner}/${repoName} branch=${branch}`,
  );

  // registry.json または search-index.json を取得
  // search-index.json は軽量（~1MB）なのでこちらを優先
  try {
    const searchIndexContent = await fetchRepositoryTextFile(
      owner,
      repoName,
      branch,
      "docs/search-index.json",
      token,
      30000,
    );
    if (!searchIndexContent) {
      console.log(
        `[Skill Ninja] search-index.json not found, trying registry.json`,
      );
      // registry.json にフォールバック（大きいので注意）
      const registryContent = await fetchRepositoryTextFile(
        owner,
        repoName,
        branch,
        "registry.json",
        token,
        60000,
      );
      if (!registryContent) {
        return null;
      }
      const registryData = JSON.parse(registryContent) as {
        skills?: RegistrySkill[];
        total?: number;
      };
      return parseRegistryJson(
        registryData,
        owner,
        repoName,
        branch,
        sourceOptions,
      );
    }

    const searchIndex = JSON.parse(searchIndexContent) as {
      v?: string;
      t?: number;
      s?: SearchIndexSkill[];
    };
    return parseSearchIndex(
      searchIndex,
      owner,
      repoName,
      branch,
      sourceOptions,
    );
  } catch (error) {
    console.error(`[Skill Ninja] Failed to fetch skill registry:`, error);
    return null;
  }
}

/**
 * search-index.json を解析してスキルに変換
 */
interface SearchIndexSkill {
  n: string; // name
  d: string; // description
  c: string; // category code
  g?: string[]; // tags
  r?: number; // stars
  i: string; // install path
}

/** リモート index の値は型が保証されないので、star 数は有限な非負数だけ受ける。 */
export function normalizeStarCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/** 同上。文字列以外が来たら値が無かったものとして扱う。 */
export function normalizeIndexText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

export function normalizeIndexTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (tag): tag is string => typeof tag === "string" && tag.trim().length > 0,
  );
}

function parseSearchIndex(
  data: { v?: string; t?: number; s?: SearchIndexSkill[] },
  owner: string,
  repoName: string,
  branch: string,
  sourceOptions?: Pick<Source, "includePaths" | "excludePaths">,
): { skills: Skill[]; source: Source } {
  const sourceId = `${owner}-${repoName}`;
  const skills: Skill[] = [];

  // カテゴリコードをフルネームにマッピング
  const categoryMap: Record<string, string> = {
    dev: "development",
    dat: "data",
    des: "design",
    tst: "testing",
    ops: "devops",
    doc: "documents",
    pro: "productivity",
    prd: "product",
    sec: "security",
    mkt: "marketing",
  };

  if (data.s && Array.isArray(data.s)) {
    // 上限を設定（全部入れると重すぎる）
    const MAX_SKILLS = 5000;
    const skillsToProcess = data.s.slice(0, MAX_SKILLS);

    for (const item of skillsToProcess) {
      const name = normalizeIndexText(item.n);
      const installPath = normalizeIndexText(item.i);
      if (!name || !installPath) {
        continue;
      }
      if (!isSkillPathAllowed(installPath, sourceOptions)) {
        continue;
      }
      const categoryCode = normalizeIndexText(item.c);
      const category =
        (categoryCode && categoryMap[categoryCode]) || categoryCode || "other";
      const tags = normalizeIndexTags(item.g);

      skills.push({
        name,
        source: sourceId,
        path: installPath,
        categories: [category, ...tags.slice(0, 3)],
        description: normalizeIndexText(item.d) || "",
        stars: normalizeStarCount(item.r),
      });
    }

    console.log(
      `[Skill Ninja] Loaded ${skills.length} skills from search-index.json (total: ${data.t || data.s.length})`,
    );
  }

  const source: Source = {
    id: sourceId,
    name: `${repoName} (Registry)`,
    url: `https://github.com/${owner}/${repoName}`,
    type: "user-added",
    branch, // ブランチを保存
    description: `Claude Skills Registry - ${data.t || skills.length} skills indexed`,
    includePaths: sourceOptions?.includePaths,
    excludePaths: sourceOptions?.excludePaths,
  };

  return { skills, source };
}

/**
 * registry.json を解析してスキルに変換（フォールバック用）
 */
interface RegistrySkill {
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  stars?: number;
  repo?: string;
  path?: string;
  install_path?: string;
}

function parseRegistryJson(
  data: { skills?: RegistrySkill[]; total?: number },
  owner: string,
  repoName: string,
  branch: string,
  sourceOptions?: Pick<Source, "includePaths" | "excludePaths">,
): { skills: Skill[]; source: Source } {
  const sourceId = `${owner}-${repoName}`;
  const skills: Skill[] = [];

  if (data.skills && Array.isArray(data.skills)) {
    // 上限を設定
    const MAX_SKILLS = 5000;
    const skillsToProcess = data.skills.slice(0, MAX_SKILLS);

    for (const item of skillsToProcess) {
      const name = normalizeIndexText(item.name);
      const resourcePath =
        normalizeIndexText(item.install_path) ||
        normalizeIndexText(item.path) ||
        normalizeIndexText(item.repo);
      if (!name || !resourcePath) {
        continue;
      }
      if (!isSkillPathAllowed(resourcePath, sourceOptions)) {
        continue;
      }
      const categories: string[] = [];
      const category = normalizeIndexText(item.category);
      if (category) categories.push(category);
      categories.push(...normalizeIndexTags(item.tags).slice(0, 3));

      skills.push({
        name,
        source: sourceId,
        path: resourcePath,
        categories: categories.length > 0 ? categories : ["other"],
        description: normalizeIndexText(item.description) || "",
        stars: normalizeStarCount(item.stars),
      });
    }

    console.log(
      `[Skill Ninja] Loaded ${skills.length} skills from registry.json (total: ${data.total || data.skills.length})`,
    );
  }

  const source: Source = {
    id: sourceId,
    name: `${repoName} (Registry)`,
    url: `https://github.com/${owner}/${repoName}`,
    type: "user-added",
    branch, // ブランチを保存
    description: `Claude Skills Registry - ${data.total || skills.length} skills indexed`,
    includePaths: sourceOptions?.includePaths,
    excludePaths: sourceOptions?.excludePaths,
  };

  return { skills, source };
}

/**
 * SKILL.md の frontmatter を解析
 */
function parseSkillFrontmatter(
  content: string,
  filePath: string,
): {
  name: string;
  description: string;
  categories: string[];
  standalone?: boolean;
  requires?: string[];
  bundle?: string;
  license?: string;
  author?: string;
  version?: string;
} | null {
  const normalizedContent = content.replace(/\r\n/g, "\n");
  // frontmatter を抽出
  const frontmatterMatch = normalizedContent.match(/^---\n([\s\S]*?)\n---/);

  if (frontmatterMatch) {
    const frontmatter = parseTopLevelFrontmatter(frontmatterMatch[1]);
    const metadataMatch = frontmatterMatch[1].match(
      /metadata:[\s\S]*?author:\s*["']?([^"'\n]+)["']?/m,
    );

    let name = frontmatter.get("name")?.trim();
    if (!name) {
      const pathParts = filePath.split("/");
      name = pathParts[pathParts.length - 2];
    }

    const categories = parseInlineYamlArray(
      frontmatter.get("categories") || "[]",
    );
    const requires = parseInlineYamlArray(frontmatter.get("requires") || "[]");

    // description が空の場合は When to Use セクションからフォールバック
    let description = frontmatter.get("description")?.trim() || "";
    if (!description) {
      description = extractWhenToUseFromContent(normalizedContent);
    }

    return {
      name,
      description,
      categories,
      standalone:
        frontmatter.get("standalone") === "true"
          ? true
          : frontmatter.get("standalone") === "false"
            ? false
            : undefined,
      requires: requires.length > 0 ? requires : undefined,
      bundle: frontmatter.get("bundle")?.trim(),
      license: frontmatter.get("license")?.trim(),
      author: frontmatter.get("author")?.trim() || metadataMatch?.[1]?.trim(),
      version: frontmatter.get("version")?.trim(),
    };
  }

  // frontmatter がない場合はディレクトリ名を使用
  // description は When to Use セクションからフォールバック
  const pathParts = filePath.split("/");
  const dirName = pathParts[pathParts.length - 2];
  const description = extractWhenToUseFromContent(normalizedContent);
  return {
    name: dirName,
    description,
    categories: [],
  };
}

/**
 * SKILL.md の内容から When to Use セクションを抽出（description フォールバック用）
 */
function extractWhenToUseFromContent(content: string): string {
  // When to Use セクションを検出
  const sectionMatch = content.match(
    /\n##\s*(When to Use|When To Use|いつ使うか|使用タイミング|Usage|使い方)\s*\n([\s\S]*?)(?=\n##\s|\n---\n|\n*$)/i,
  );

  if (!sectionMatch) {
    // # タイトルの次の段落をフォールバック
    const titleMatch = content.match(/^#\s+[^\n]+\n\n([^\n#]+)/m);
    if (titleMatch) {
      return titleMatch[1].trim().substring(0, INDEX_LIMITS.SHORT_DESCRIPTION);
    }
    return "";
  }

  const sectionContent = sectionMatch[2].trim();
  const lines = sectionContent.split("\n").filter((line) => line.trim());

  // 最初の意味のある行を取得
  for (const line of lines) {
    const trimmed = line.trim();
    // ヘッダー行やセパレータ行をスキップ
    if (trimmed.startsWith("|") && trimmed.includes("---")) continue;
    if (trimmed.match(/^\|[\s-|]+\|$/)) continue;

    // 箇条書きの場合
    if (trimmed.startsWith("-") || trimmed.startsWith("*")) {
      return trimmed
        .replace(/^[-*]\s*/, "")
        .substring(0, INDEX_LIMITS.SHORT_DESCRIPTION);
    }
    // テーブル行の場合
    if (trimmed.startsWith("|")) {
      const cells = trimmed.split("|").filter((c) => c.trim());
      if (cells.length > 0) {
        return cells.join("; ").substring(0, INDEX_LIMITS.SHORT_DESCRIPTION);
      }
    }
    // 通常のテキスト
    if (trimmed.length > 5) {
      return trimmed.substring(0, INDEX_LIMITS.SHORT_DESCRIPTION);
    }
  }

  return "";
}

/**
 * 単一ソースのインデックスを更新
 * 指定されたソースのスキルのみを再取得し、他のソースのスキルは保持
 */
export async function updateSingleSource(
  context: vscode.ExtensionContext,
  currentIndex: SkillIndex,
  sourceId: string,
  progress?: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<{ index: SkillIndex; addedSkills: number; removedSkills: number }> {
  const token = await getGitHubToken();

  const source = currentIndex.sources.find((s) => s.id === sourceId);
  if (!source) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  // 対象ソース以外のスキルを保持
  const otherSkills = currentIndex.skills.filter((s) => s.source !== sourceId);
  const oldSkillCount = currentIndex.skills.filter(
    (s) => s.source === sourceId,
  ).length;

  // 既存スキルの説明をマップとして保持
  const existingDescriptions = new Map<string, string>();
  for (const skill of currentIndex.skills) {
    if (skill.source === sourceId && skill.description) {
      existingDescriptions.set(skill.name, skill.description);
    }
  }

  progress?.report({ message: messages.updatingSource(source.name) });

  try {
    const result = await scanRepositoryForSkills(
      source.url,
      token,
      source.branch,
      source,
    );

    if (!result) {
      throw new Error(`Failed to scan repository: ${source.url}`);
    }

    if (hasRepositoryIdentityChanged(source.repoId, result.source.repoId)) {
      throw new Error(
        messages.sourceIndexRepositoryIdentityChanged(
          source.repoId as number,
          result.source.repoId as number,
        ),
      );
    }

    if (shouldPreserveSkillsOnEmptyScan(result.skills.length, oldSkillCount)) {
      throw new Error(messages.sourceIndexEmptyScanKept(oldSkillCount));
    }

    // 新しいスキルを追加（既存の説明があれば保持）
    const updatedSkills: Skill[] = [];
    for (const skill of result.skills) {
      const existingDesc = existingDescriptions.get(skill.name);
      updatedSkills.push({
        ...skill,
        source: sourceId,
        description: existingDesc || skill.description,
      });
    }

    const newIndex: SkillIndex = {
      ...currentIndex,
      sources: stampSourceIndexedAt(
        currentIndex.sources,
        sourceId,
        getSourceIndexedStamp(),
        result.source.url,
        result.source.repoId,
      ),
      skills: [...otherSkills, ...updatedSkills],
      // 単一 source の走査は index 全体の鮮度ではない
      lastUpdated: currentIndex.lastUpdated,
    };

    // バンドル更新も処理
    if (result.bundles?.length) {
      const otherBundles = (currentIndex.bundles || []).filter(
        (b) => b.source !== sourceId,
      );
      const updatedBundles = result.bundles.map((b) => ({
        ...b,
        source: sourceId,
      }));
      newIndex.bundles = [...otherBundles, ...updatedBundles];
    }

    await saveSkillIndex(context, newIndex);

    return {
      index: newIndex,
      addedSkills: updatedSkills.length - oldSkillCount,
      removedSkills:
        oldSkillCount > updatedSkills.length
          ? oldSkillCount - updatedSkills.length
          : 0,
    };
  } catch (error) {
    console.error(`Failed to update source ${sourceId}:`, error);
    throw error;
  }
}

/**
 * 既存ソースからインデックスを更新
 * 既存のローカライズされた説明は保持し、新規スキルのみGitHubから説明を取得
 */
export async function updateIndexFromSources(
  context: vscode.ExtensionContext,
  currentIndex: SkillIndex,
  progress?: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<SkillIndex> {
  const token = await getGitHubToken();

  // 既存スキルの説明をマップとして保持（ローカライズされた説明を保持するため）
  const existingDescriptions = new Map<string, string>();
  for (const skill of currentIndex.skills) {
    const key = `${skill.source}:${skill.name}`;
    if (skill.description) {
      existingDescriptions.set(key, skill.description);
    }
  }

  const updatedSkills: Skill[] = [];
  const updatedBundles: Bundle[] = [];
  const updatedSourceIds = new Set<string>();
  const handledSourceIds = new Set<string>();
  const canonicalSourceUrls = new Map<string, string>();
  const resolvedRepoIds = new Map<string, number>();
  const identityMismatchedSources: string[] = [];
  const totalSources = currentIndex.sources.length;

  for (const source of currentIndex.sources) {
    handledSourceIds.add(source.id);
    const existingSkillsForSource = currentIndex.skills.filter(
      (s) => s.source === source.id,
    );
    const existingBundlesForSource = (currentIndex.bundles || []).filter(
      (b) => b.source === source.id,
    );

    try {
      progress?.report({
        message: messages.updatingSource(source.name),
        increment: (1 / totalSources) * 100,
      });

      // ソースに設定されたブランチを使用
      const result = await scanRepositoryForSkills(
        source.url,
        token,
        source.branch,
        source,
      );
      if (result) {
        if (hasRepositoryIdentityChanged(source.repoId, result.source.repoId)) {
          console.warn(
            `[Skill Ninja] Source ${source.id} now resolves to repository ${result.source.repoId} instead of ${source.repoId}; keeping the stored index`,
          );
          updatedSkills.push(...existingSkillsForSource);
          updatedBundles.push(...existingBundlesForSource);
          continue;
        }

        if (
          shouldPreserveSkillsOnEmptyScan(
            result.skills.length,
            existingSkillsForSource.length,
          )
        ) {
          console.warn(
            `[Skill Ninja] Source ${source.id} returned 0 skills; keeping ${existingSkillsForSource.length} existing skill(s)`,
          );
          updatedSkills.push(...existingSkillsForSource);
          updatedBundles.push(...existingBundlesForSource);
          continue;
        }

        updatedSourceIds.add(source.id);
        if (result.source.url && result.source.url !== source.url) {
          canonicalSourceUrls.set(source.id, result.source.url);
        }
        if (result.source.repoId !== undefined) {
          resolvedRepoIds.set(source.id, result.source.repoId);
        }
        // 既存の説明があれば保持、なければGitHubから取得した説明を使用
        // source ID は既存の source.id を使用（GitHub から生成された ID ではなく）
        for (const skill of result.skills) {
          const skillWithCorrectSource = {
            ...skill,
            source: source.id, // 既存の source ID を使用
          };
          const key = `${source.id}:${skill.name}`;
          const existingDesc = existingDescriptions.get(key);
          updatedSkills.push({
            ...skillWithCorrectSource,
            description: existingDesc || skill.description,
          });
        }

        updatedBundles.push(
          ...reconcileSourceBundles(
            existingBundlesForSource,
            result.bundles,
            source.id,
          ),
        );
      }
    } catch (error) {
      console.warn(`Failed to update source ${source.id}:`, error);
      // 更新に失敗したソースの既存スキルとBundlesは保持
      updatedSkills.push(...existingSkillsForSource);
      updatedBundles.push(...existingBundlesForSource);
    }
  }

  // 現在の source 一覧に属さない孤立 bundle だけを温存する
  const handledBundleKeys = new Set(updatedBundles.map(createSourceBundleKey));
  const preservedBundles = (currentIndex.bundles || []).filter(
    (b) =>
      !handledSourceIds.has(b.source) &&
      !handledBundleKeys.has(createSourceBundleKey(b)),
  );
  const indexedAt = getSourceIndexedStamp();
  // 全 source を走査して全部成功したときだけ index 全体の日付を進める。
  // 部分失敗で進めると、未走査の source が fallback で新鮮に見える。
  const scannedEverySource =
    currentIndex.sources.length > 0 &&
    updatedSourceIds.size === currentIndex.sources.length;

  const updatedIndex: SkillIndex = {
    ...currentIndex,
    lastUpdated: scannedEverySource
      ? getIndexDateStamp()
      : currentIndex.lastUpdated,
    sources: currentIndex.sources.map((source) =>
      updatedSourceIds.has(source.id)
        ? {
            ...source,
            url: canonicalSourceUrls.get(source.id) || source.url,
            repoId: resolvedRepoIds.get(source.id) ?? source.repoId,
            lastIndexedAt: indexedAt,
          }
        : source,
    ),
    skills: updatedSkills,
    bundles: [...preservedBundles, ...updatedBundles],
  };

  // 保存
  await saveSkillIndex(context, updatedIndex);

  if (identityMismatchedSources.length > 0) {
    vscode.window.showWarningMessage(
      messages.sourceIndexRepositoryIdentitySkipped(
        identityMismatchedSources.join(", "),
      ),
    );
  }

  return updatedIndex;
}

/**
 * 単一ソースからインデックスを更新
 */
export async function updateIndexFromSingleSource(
  context: vscode.ExtensionContext,
  currentIndex: SkillIndex,
  sourceId: string,
  progress?: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<SkillIndex> {
  const token = await getGitHubToken();

  const source = currentIndex.sources.find((s) => s.id === sourceId);
  if (!source) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  // 既存スキルの説明をマップとして保持
  const existingDescriptions = new Map<string, string>();
  for (const skill of currentIndex.skills) {
    const key = `${skill.source}:${skill.name}`;
    if (skill.description) {
      existingDescriptions.set(key, skill.description);
    }
  }

  progress?.report({
    message: messages.updatingSource(source.name),
    increment: 50,
  });

  const result = await scanRepositoryForSkills(
    source.url,
    token,
    source.branch,
    source,
  );

  if (!result) {
    throw new Error(`Failed to scan repository: ${source.url}`);
  }

  // 既存スキルから該当ソース以外のものを保持
  const otherSkills = currentIndex.skills.filter((s) => s.source !== sourceId);
  const otherBundles = (currentIndex.bundles || []).filter(
    (b) => b.source !== sourceId,
  );
  const existingSkillsForSource = currentIndex.skills.filter(
    (s) => s.source === sourceId,
  );
  const existingBundlesForSource = (currentIndex.bundles || []).filter(
    (b) => b.source === sourceId,
  );

  if (hasRepositoryIdentityChanged(source.repoId, result.source.repoId)) {
    throw new Error(
      messages.sourceIndexRepositoryIdentityChanged(
        source.repoId as number,
        result.source.repoId as number,
      ),
    );
  }

  if (
    shouldPreserveSkillsOnEmptyScan(
      result.skills.length,
      existingSkillsForSource.length,
    )
  ) {
    throw new Error(
      messages.sourceIndexEmptyScanKept(existingSkillsForSource.length),
    );
  }

  // 新しいスキルをマージ
  const newSkills: Skill[] = [];
  for (const skill of result.skills) {
    const skillWithCorrectSource = {
      ...skill,
      source: sourceId,
    };
    const key = `${sourceId}:${skill.name}`;
    const existingDesc = existingDescriptions.get(key);
    newSkills.push({
      ...skillWithCorrectSource,
      description: existingDesc || skill.description,
    });
  }

  // 新しいバンドルをマージ
  const newBundles: Bundle[] = reconcileSourceBundles(
    existingBundlesForSource,
    result.bundles,
    sourceId,
  );

  progress?.report({
    message: messages.sourceIndexSkillsUpdatedProgress(newSkills.length),
    increment: 50,
  });

  const updatedIndex: SkillIndex = {
    ...currentIndex,
    // 単一 source の走査は index 全体の鮮度ではない
    lastUpdated: currentIndex.lastUpdated,
    sources: stampSourceIndexedAt(
      currentIndex.sources,
      sourceId,
      getSourceIndexedStamp(),
      result.source.url,
      result.source.repoId,
    ),
    skills: [...otherSkills, ...newSkills],
    bundles: [...otherBundles, ...newBundles],
  };

  // 保存
  await saveSkillIndex(context, updatedIndex);

  return updatedIndex;
}

/**
 * ソースを追加
 */
export async function addSource(
  context: vscode.ExtensionContext,
  currentIndex: SkillIndex,
  repoUrl: string,
): Promise<{ index: SkillIndex; addedSkills: number }> {
  // repoUrlが文字列かどうか検証
  if (!repoUrl || typeof repoUrl !== "string") {
    throw new Error("repoUrl must be a valid string");
  }

  const token = await getGitHubToken();

  const result = await scanRepositoryForSkills(repoUrl, token);
  if (!result) {
    throw new Error("No skills found in repository");
  }

  // 既存のソースをチェック
  const existingSourceIndex = currentIndex.sources.findIndex(
    (s) => s.id === result.source.id,
  );

  // 既存のスキルを除外して新しいスキルを追加
  const existingSkills = currentIndex.skills.filter(
    (s) => s.source !== result.source.id,
  );
  const existingSkillsForSource = currentIndex.skills.filter(
    (s) => s.source === result.source.id,
  );

  if (
    shouldPreserveSkillsOnEmptyScan(
      result.skills.length,
      existingSkillsForSource.length,
    )
  ) {
    throw new Error(
      messages.sourceIndexEmptyScanKept(existingSkillsForSource.length),
    );
  }

  let updatedSources: Source[];
  const indexedAt = getSourceIndexedStamp();
  if (existingSourceIndex >= 0) {
    // 既存ソースを更新。scanner や path フィルタなどの curation 設定はスキャン結果で上書きしない
    const existingSource = currentIndex.sources[existingSourceIndex];
    updatedSources = [...currentIndex.sources];
    updatedSources[existingSourceIndex] = {
      ...result.source,
      scanner: existingSource.scanner ?? result.source.scanner,
      includePaths: existingSource.includePaths ?? result.source.includePaths,
      excludePaths: existingSource.excludePaths ?? result.source.excludePaths,
      description_ja:
        existingSource.description_ja ?? result.source.description_ja,
      lastIndexedAt: indexedAt,
    };
  } else {
    // 新規ソースを追加
    updatedSources = [
      ...currentIndex.sources,
      { ...result.source, lastIndexedAt: indexedAt },
    ];
  }

  const updatedSkills = [...existingSkills, ...result.skills];

  // Bundlesもマージ
  const existingBundles = (currentIndex.bundles || []).filter(
    (b) => b.source !== result.source.id,
  );
  const updatedBundles = [
    ...existingBundles,
    ...reconcileSourceBundles(
      (currentIndex.bundles || []).filter((b) => b.source === result.source.id),
      result.bundles,
      result.source.id,
    ),
  ];

  const updatedIndex: SkillIndex = {
    ...currentIndex,
    // 追加した source 以外は走査していない
    lastUpdated: currentIndex.lastUpdated,
    sources: updatedSources,
    skills: updatedSkills,
    bundles: updatedBundles.length > 0 ? updatedBundles : currentIndex.bundles,
  };

  // 保存
  await saveSkillIndex(context, updatedIndex);

  return { index: updatedIndex, addedSkills: result.skills.length };
}

/**
 * ソースを削除
 */
export async function removeSource(
  context: vscode.ExtensionContext,
  currentIndex: SkillIndex,
  sourceId: string,
): Promise<{ index: SkillIndex; removedSkills: number }> {
  // ソースを検索
  const sourceToRemove = currentIndex.sources.find((s) => s.id === sourceId);
  if (!sourceToRemove) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  // そのソースに属するスキル数をカウント
  const skillsToRemove = currentIndex.skills.filter(
    (s) => s.source === sourceId,
  );
  const removedSkills = skillsToRemove.length;

  // ソースとスキルを除外
  const updatedSources = currentIndex.sources.filter((s) => s.id !== sourceId);
  const updatedSkills = currentIndex.skills.filter(
    (s) => s.source !== sourceId,
  );

  // Bundlesも除外
  const updatedBundles = (currentIndex.bundles || []).filter(
    (b) => b.source !== sourceId,
  );

  const updatedIndex: SkillIndex = {
    ...currentIndex,
    // 削除だけでは残りの source を走査していない
    lastUpdated: currentIndex.lastUpdated,
    sources: updatedSources,
    skills: updatedSkills,
    bundles: updatedBundles.length > 0 ? updatedBundles : undefined,
  };

  // 保存
  await saveSkillIndex(context, updatedIndex);

  return { index: updatedIndex, removedSkills };
}

/**
 * GitHub でスキルを検索
 * 複数の検索戦略を組み合わせて精度を向上
 */
export async function searchGitHub(
  query: string,
  token?: string,
): Promise<
  Array<{
    name: string;
    repo: string;
    repoUrl: string;
    path: string;
    description: string;
    stars?: number;
    isOrg?: boolean;
    defaultBranch?: string;
  }>
> {
  // クエリをキーワードに分割（3文字以上のみ、ノイズ削減）
  const rawKeywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((k) => k.length > 0);
  const keywords = rawKeywords.filter(
    (k) => k.length >= 3 || /^[a-z0-9]+$/i.test(k),
  );

  // user: または repo: プレフィックスを抽出
  const userMatch = query.match(/\buser:([^\s]+)/i);
  const repoMatch = query.match(/\brepo:([^\s]+)/i);
  let userPrefix = userMatch ? `user:${userMatch[1]}` : "";
  const repoPrefix = repoMatch ? `repo:${repoMatch[1]}` : "";

  // プレフィックスを除いたキーワード
  let keywordsWithoutPrefix = keywords.filter(
    (k) => !k.startsWith("user:") && !k.startsWith("repo:"),
  );

  // 単一キーワードがユーザー名っぽいかどうかを判定する関数
  const looksLikeUsername = (keyword: string): boolean => {
    return (
      /^[a-z][a-z0-9-]*$/i.test(keyword) &&
      keyword.length >= 3 &&
      keyword.length <= 39 &&
      !keyword.includes("--")
    );
  };

  // 検索クエリを生成する関数
  const buildSearchQueries = (kws: string[]): string[] => {
    const queries: string[] = [];

    // user: または repo: が明示的に指定されている場合
    if (userPrefix || repoPrefix) {
      const prefix = userPrefix || repoPrefix;
      if (keywordsWithoutPrefix.length > 0) {
        // プレフィックス + キーワード
        const orQuery = keywordsWithoutPrefix.join(" OR ");
        queries.push(`filename:SKILL.md ${prefix} ${orQuery}`);
        queries.push(`filename:SKILL.md ${prefix} ${orQuery} in:path`);
      }
      // プレフィックスのみ（全スキル取得）
      queries.push(`filename:SKILL.md ${prefix}`);
    } else if (query.includes("/")) {
      // owner/repo 形式
      queries.push(`filename:SKILL.md repo:${query}`);
    } else if (kws.length > 1) {
      const orQuery = kws.join(" OR ");
      queries.push(`filename:SKILL.md ${orQuery}`);
      queries.push(`filename:SKILL.md ${orQuery} in:path`);
    } else if (kws.length === 1) {
      queries.push(`filename:SKILL.md ${kws[0]}`);
      queries.push(`filename:SKILL.md ${kws[0]} in:path`);
    }
    return queries;
  };

  // 検索実行関数（フォールバック対応）
  const executeSearch = async (
    searchQueries: string[],
  ): Promise<GitHubSearchItem[]> => {
    const items: GitHubSearchItem[] = [];
    const seen = new Set<string>();

    for (const searchQuery of searchQueries) {
      try {
        const searchUrl = `https://api.github.com/search/code?q=${encodeURIComponent(
          searchQuery,
        )}&per_page=100`;
        const response = await githubFetch(searchUrl, token);

        if (!response.ok) {
          if (response.status === 403) {
            throw new Error(
              "GitHub API rate limit exceeded. Please authenticate with a GitHub token.",
            );
          }
          if (response.status === 401) {
            throw new Error("GitHub authentication required for code search.");
          }
          continue;
        }

        const data = (await response.json()) as {
          items: GitHubSearchItem[];
          total_count: number;
        };
        for (const item of data.items || []) {
          const key = `${item.repository.full_name}:${item.path}`;
          if (!seen.has(key)) {
            seen.add(key);
            items.push(item);
          }
        }
      } catch (error) {
        if (searchQueries.indexOf(searchQuery) === 0) {
          throw error;
        }
      }
    }
    return items;
  };

  interface GitHubSearchItem {
    path: string;
    repository: {
      full_name: string;
      html_url: string;
    };
  }

  // Phase 1: 検索実行
  let searchItems: GitHubSearchItem[] = [];

  // 最初のキーワードがユーザー名っぽい & 明示的プレフィックスなし → 通常検索と user: 検索を並列実行
  const firstKeyword = keywordsWithoutPrefix[0];
  const shouldParallelSearch =
    !userPrefix &&
    !repoPrefix &&
    !query.includes("/") &&
    keywordsWithoutPrefix.length >= 1 &&
    looksLikeUsername(firstKeyword);

  if (shouldParallelSearch) {
    // 通常検索クエリ
    const normalQueries = buildSearchQueries(keywords);

    // user: 検索クエリ（最初のキーワードをユーザー名として扱う）
    const remainingKeywords = keywordsWithoutPrefix.slice(1);
    let userQueries: string[];
    if (remainingKeywords.length > 0) {
      const orQuery = remainingKeywords.join(" OR ");
      userQueries = [
        `filename:SKILL.md user:${firstKeyword} ${orQuery}`,
        `filename:SKILL.md user:${firstKeyword} ${orQuery} in:path`,
        `filename:SKILL.md user:${firstKeyword}`,
      ];
    } else {
      userQueries = [`filename:SKILL.md user:${firstKeyword}`];
    }

    // 並列実行してマージ
    const [normalResults, userResults] = await Promise.all([
      executeSearch(normalQueries),
      executeSearch(userQueries),
    ]);

    // 重複排除してマージ
    const seen = new Set<string>();
    for (const item of [...normalResults, ...userResults]) {
      const key = `${item.repository.full_name}:${item.path}`;
      if (!seen.has(key)) {
        seen.add(key);
        searchItems.push(item);
      }
    }
  } else {
    let searchQueries = buildSearchQueries(keywords);
    searchItems = await executeSearch(searchQueries);

    // フォールバック: 0件なら1単語ずつ減らして再検索
    let fallbackKeywords = [...keywords];
    while (searchItems.length === 0 && fallbackKeywords.length > 1) {
      fallbackKeywords.pop();
      searchQueries = buildSearchQueries(fallbackKeywords);
      searchItems = await executeSearch(searchQueries);
    }
  }

  // リポジトリ情報のキャッシュ（同じリポジトリからの複数スキルで重複APIコールを防ぐ）
  const repoInfoCache = new Map<
    string,
    { stars: number; isOrg: boolean; defaultBranch: string }
  >();

  // Phase 2: 検索結果の基本情報を収集（既に取得済みのsearchItemsを使用）
  interface BasicResult {
    name: string;
    repo: string;
    repoUrl: string;
    path: string;
    itemPath: string;
    stars?: number;
    isOrg?: boolean;
    defaultBranch: string;
  }

  // SKILL.mdフィルタリング
  const validItems = searchItems.filter((item) => {
    const lowerPath = item.path.toLowerCase();
    return lowerPath === "skill.md" || lowerPath.endsWith("/skill.md");
  });

  // 重複排除してユニークなリポジトリリストを作成
  const uniqueRepos = [
    ...new Set(validItems.map((item) => item.repository.full_name)),
  ];

  // リポジトリ情報を並列取得（最大10並列）
  const REPO_BATCH_SIZE = 10;
  for (let i = 0; i < uniqueRepos.length; i += REPO_BATCH_SIZE) {
    const batch = uniqueRepos.slice(i, i + REPO_BATCH_SIZE);
    await Promise.all(
      batch.map(async (repoName) => {
        if (repoInfoCache.has(repoName)) return;
        try {
          const repoApiUrl = `https://api.github.com/repos/${repoName}`;
          const repoResponse = await githubFetch(repoApiUrl, token);
          if (repoResponse.ok) {
            const repoData = (await repoResponse.json()) as {
              stargazers_count: number;
              owner: { type: string };
              default_branch: string;
            };
            repoInfoCache.set(repoName, {
              stars: repoData.stargazers_count,
              isOrg: repoData.owner.type === "Organization",
              defaultBranch: repoData.default_branch || "main",
            });
          }
        } catch {
          // 失敗しても続行
        }
      }),
    );
  }

  // BasicResultsを構築
  const basicResults: BasicResult[] = [];
  const seenKeys = new Set<string>();

  for (const item of validItems) {
    const key = `${item.repository.full_name}:${item.path}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const pathParts = item.path.split("/");
    const skillName =
      pathParts.length > 1
        ? pathParts[pathParts.length - 2]
        : item.repository.full_name.split("/")[1];

    const repoInfo = repoInfoCache.get(item.repository.full_name);

    basicResults.push({
      name: skillName,
      repo: item.repository.full_name,
      repoUrl: item.repository.html_url,
      path: item.path.replace(/\/SKILL\.md$/i, "").replace(/^SKILL\.md$/i, ""),
      itemPath: item.path,
      stars: repoInfo?.stars,
      isOrg: repoInfo?.isOrg,
      defaultBranch: repoInfo?.defaultBranch || "main",
    });
  }

  // Phase 3: スコアリング（SKILL.md取得前に仮ランキング）
  let rankedResults = basicResults;
  if (keywords.length > 1) {
    rankedResults = basicResults
      .map((result) => {
        const searchText =
          `${result.name} ${result.path} ${result.repo}`.toLowerCase();
        let score = 0;
        for (const keyword of keywords) {
          if (searchText.includes(keyword)) {
            score++;
            if (result.name.toLowerCase().includes(keyword)) {
              score += 2;
            }
          }
        }
        if (result.stars && result.stars > 100) {
          score += 1;
        }
        return { ...result, score };
      })
      .sort((a, b) => {
        const aScore = (a as { score?: number }).score || 0;
        const bScore = (b as { score?: number }).score || 0;
        if (bScore !== aScore) return bScore - aScore;
        return (b.stars || 0) - (a.stars || 0);
      });
  }

  // Phase 4: 上位50件のみSKILL.md取得して再スコアリング（並列処理で高速化）
  const MAX_FETCH = 50;
  const topResults = rankedResults.slice(0, MAX_FETCH);

  const fetchSkillContent = async (
    result: BasicResult & { score?: number },
  ): Promise<{
    name: string;
    repo: string;
    repoUrl: string;
    path: string;
    description: string;
    stars?: number;
    isOrg?: boolean;
    defaultBranch?: string;
    score?: number;
  }> => {
    let skillDescription = `From ${result.repo}`;
    let skillNameFromMeta = result.name;

    try {
      const rawUrl = `https://raw.githubusercontent.com/${result.repo}/${result.defaultBranch}/${result.itemPath}`;
      const contentResponse = await fetchGitHubWithOptionalAuthRetry(rawUrl, {
        accept: "text/plain",
        token,
      });
      if (contentResponse.ok) {
        const content = await contentResponse.text();
        const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
          const frontmatter = frontmatterMatch[1];
          const descMatch = frontmatter.match(
            /^description:\s*(?:\|\s*\n([\s\S]*?)(?=\n\w|\n---)|(.+))/m,
          );
          if (descMatch) {
            const desc = (descMatch[1] || descMatch[2] || "").trim();
            if (desc) {
              const firstLine = desc.split("\n")[0].trim();
              skillDescription =
                firstLine.length > INDEX_LIMITS.PREVIEW_LENGTH
                  ? firstLine.substring(0, INDEX_LIMITS.PREVIEW_LENGTH) + "..."
                  : firstLine;
            }
          }
          const nameMatch = frontmatter.match(/^name:\s*(.+)/m);
          if (nameMatch) {
            skillNameFromMeta = nameMatch[1].trim();
          }
        }
      }
    } catch {
      // 失敗してもデフォルト description を使用
    }

    // Description を含めて再スコアリング（複数キーワードの場合）
    let finalScore = result.score || 0;
    if (keywords.length > 1) {
      const descLower = skillDescription.toLowerCase();
      for (const keyword of keywords) {
        if (descLower.includes(keyword)) {
          finalScore += 1; // description にキーワードがあれば +1
        }
      }
    }

    return {
      name: skillNameFromMeta,
      repo: result.repo,
      repoUrl: result.repoUrl,
      path: result.path,
      description: skillDescription,
      stars: result.stars,
      isOrg: result.isOrg,
      defaultBranch: result.defaultBranch,
      score: finalScore,
    };
  };

  // 並列実行（最大10同時）
  const BATCH_SIZE = 10;
  const fetchedResults: Array<{
    name: string;
    repo: string;
    repoUrl: string;
    path: string;
    description: string;
    stars?: number;
    isOrg?: boolean;
    defaultBranch?: string;
    score?: number;
  }> = [];

  for (let i = 0; i < topResults.length; i += BATCH_SIZE) {
    const batch = topResults.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(fetchSkillContent));
    fetchedResults.push(...batchResults);
  }

  // 最終スコアでソート（複数キーワードの場合）
  if (keywords.length > 1) {
    fetchedResults.sort((a, b) => {
      const aScore = a.score || 0;
      const bScore = b.score || 0;
      if (bScore !== aScore) return bScore - aScore;
      return (b.stars || 0) - (a.stars || 0);
    });
  }

  return fetchedResults;
}

/**
 * 認証エラー時のヘルプメッセージを表示
 */
export async function showAuthHelp(): Promise<void> {
  const openSettingsLabel = messages.openSettings();
  const authWithGhCliLabel = messages.authWithGhCli();
  const clearStoredTokenLabel = messages.actionClearStoredGitHubToken();
  const cancelLabel = messages.actionCancel();
  const actions = (await hasStoredGitHubToken())
    ? [
        clearStoredTokenLabel,
        openSettingsLabel,
        authWithGhCliLabel,
        cancelLabel,
      ]
    : [openSettingsLabel, authWithGhCliLabel, cancelLabel];

  const action = await vscode.window.showErrorMessage(
    messages.authRequired(),
    ...actions,
  );

  if (action === clearStoredTokenLabel) {
    await vscode.commands.executeCommand("skillNinja.clearGitHubToken");
  } else if (action === openSettingsLabel) {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "skillNinja.githubToken",
    );
  } else if (action === authWithGhCliLabel) {
    const terminal = vscode.window.createTerminal("GitHub Auth");
    terminal.show();
    terminal.sendText("gh auth login");
  }
}
