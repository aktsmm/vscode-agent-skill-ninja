// スキルインストール機能
// GitHub からスキルをダウンロードしてワークスペースに配置

import * as vscode from "vscode";
import * as path from "path";
import { Skill, loadSkillIndex, Source, getSourceBranch } from "./skillIndex";
import { isJapanese, messages } from "./i18n";
import { getGitHubToken, hasStoredGitHubToken } from "./githubAuth";
import { normalizeInstalledSkillSource } from "./installedSkillIndex";
import {
  getManagedSkillRoots,
  resolveWorkspaceSkillsRootUri,
  type SkillRoot,
} from "./skillLocations";
import { fetchGitHubWithOptionalAuthRetry } from "./githubFetch";
import {
  GitHubDirectoryEntry,
  partitionGitHubDirectoryEntries,
  resolveSymlinkTargetPath,
} from "./githubDirectoryTraversal";
import {
  isContainedPath,
  isSafePathSegment,
  isSafeRemoteRepoPath,
  isStrictlyInsidePath,
  toSafeRelativeSegments,
} from "./pathSafety";
import { createHash } from "crypto";

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/**
 * スキルフォルダを再帰削除する前に、対象がルート配下の真部分であることを確認する。
 * ルート自身や外部パスを消さないための最後の砦。
 */
async function deleteSkillDirectory(
  skillsRootUri: vscode.Uri,
  skillPath: vscode.Uri,
): Promise<void> {
  if (!isStrictlyInsidePath(skillsRootUri.fsPath, skillPath.fsPath)) {
    throw new Error(
      `Refusing to delete outside the skill root: ${skillPath.fsPath} (root: ${skillsRootUri.fsPath})`,
    );
  }
  await vscode.workspace.fs.delete(skillPath, { recursive: true });
}

/**
 * 実在位置からスキルルート相対パスを再計算する。
 * メタデータファイルの値ではなくこちらを正として使う。
 */
export function resolveTrustedRelativePath(
  skillsRootUri: vscode.Uri,
  skillDirUri: vscode.Uri,
): string | undefined {
  if (!isStrictlyInsidePath(skillsRootUri.fsPath, skillDirUri.fsPath)) {
    return undefined;
  }

  return path
    .relative(skillsRootUri.fsPath, skillDirUri.fsPath)
    .replace(/\\/g, "/");
}

/**
 * `"folder/SKILL.md"` 形式の相対パスから、ルート配下のスキルフォルダ URI を解決する。
 *
 * 相対パスは配布元が同梱した `.skill-meta.json` 由来でありうるので、
 * 区切り非依存で末尾の `SKILL.md` を落とし、安全なセグメントが 1 つ以上
 * 残ることを要求する。空になるとルート自身を指してしまう。
 */
export function resolveManagedSkillDirUri(
  skillsRootUri: vscode.Uri,
  relativePath: string,
): vscode.Uri {
  const rawSegments = (relativePath ?? "").split(/[\\/]/).filter(Boolean);
  if (rawSegments.at(-1)?.toLowerCase() === "skill.md") {
    rawSegments.pop();
  }

  const segments = toSafeRelativeSegments(rawSegments.join("/"));
  if (!segments) {
    throw new Error(
      `Refusing to resolve an unsafe skill path: ${JSON.stringify(relativePath)}`,
    );
  }

  const target = vscode.Uri.joinPath(skillsRootUri, ...segments);
  if (!isStrictlyInsidePath(skillsRootUri.fsPath, target.fsPath)) {
    throw new Error(
      `Refusing to resolve a skill path outside its root: ${target.fsPath} (root: ${skillsRootUri.fsPath})`,
    );
  }

  return target;
}

function resolveSkillsRootUri(
  workspaceUri: vscode.Uri,
  explicitRootUri?: vscode.Uri,
): vscode.Uri {
  if (explicitRootUri) {
    return explicitRootUri;
  }

  return resolveWorkspaceSkillsRootUri(workspaceUri);
}

function buildGitHub403Message(token?: string): string {
  if (isJapanese()) {
    return token
      ? "GitHub API へのアクセスが拒否されました (403)。トークン権限不足、トークン無効、または対象リポジトリ/検索で追加認証が必要な可能性があります。GitHub 認証設定を確認してください。"
      : "GitHub API へのアクセスが拒否されました (403)。未認証のレート制限に達したか、対象リポジトリ/検索に認証が必要な可能性があります。GitHub トークンを設定して再試行してください。";
  }

  return token
    ? "GitHub API access was denied (403). The token may be invalid, missing required scope, or the target repository/search may require additional authentication. Check your GitHub auth settings."
    : "GitHub API access was denied (403). You may have hit the unauthenticated rate limit, or the target repository/search may require authentication. Configure a GitHub token and try again.";
}

function buildSkillNotFoundMessage(skillName: string, token?: string): string {
  return token
    ? messages.skillDownloadNotFoundWithAuth(skillName)
    : messages.skillDownloadNotFoundNoAuth(skillName);
}

function buildSkillNotFoundPossibleCause(hasToken: boolean): string {
  return hasToken
    ? "The skill index path may be outdated, or the configured GitHub authentication may not have Contents: read access to the repository."
    : "The skill index path may be outdated. If the repository is private, GitHub authentication with Contents: read access is required.";
}

async function handleSkillNotFound(
  skillsRootUri: vscode.Uri,
  skillPath: vscode.Uri,
  skill: Skill,
  source: Source | undefined,
  failedUrl: string,
  token?: string,
  resolvedBranch?: string,
): Promise<never> {
  try {
    await deleteSkillDirectory(skillsRootUri, skillPath);
  } catch {
    // 削除失敗は無視
  }

  const openSettings = messages.openSettings();
  const updateIndex = messages.actionUpdateIndex();
  const reportBug = messages.actionReportBug();
  const clearStoredToken = messages.actionClearStoredGitHubToken();
  const actions = (await hasStoredGitHubToken())
    ? [clearStoredToken, openSettings, updateIndex, reportBug]
    : [openSettings, updateIndex, reportBug];
  const choice = await vscode.window.showErrorMessage(
    buildSkillNotFoundMessage(skill.name, token),
    ...actions,
  );

  if (choice === clearStoredToken) {
    await vscode.commands.executeCommand("skillNinja.clearGitHubToken");
  } else if (choice === openSettings) {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "skillNinja.githubToken",
    );
  } else if (choice === updateIndex) {
    await vscode.commands.executeCommand("skillNinja.updateIndex");
  } else if (choice === reportBug) {
    await openBugReport(
      skill,
      source,
      failedUrl,
      "404 Not Found",
      Boolean(token),
      resolvedBranch,
    );
  }

  throw new Error(`Skill not found: ${skill.name}`);
}

/**
 * GitHub API でフォルダ内のファイル一覧を取得
 */
async function listGitHubDirectoryInternal(
  owner: string,
  repo: string,
  path: string,
  branch: string = "main",
  token?: string,
  visitedPaths: Set<string> = new Set(),
): Promise<GitHubDirectoryEntry[]> {
  const normalizedPath = path.replace(/^\/+|\/+$/g, "");
  if (visitedPaths.has(normalizedPath)) {
    throw new Error(`Symlink loop detected: ${normalizedPath}`);
  }
  visitedPaths.add(normalizedPath);

  const encodedPath = normalizedPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${branch}`;
  const response = await fetchGitHubWithOptionalAuthRetry(url, {
    accept: "application/vnd.github.v3+json",
    token,
  });
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(buildGitHub403Message(token));
    }
    throw new Error(`Failed to list directory: ${response.status}`);
  }
  const data = (await response.json()) as
    | GitHubDirectoryEntry[]
    | GitHubDirectoryEntry;

  if (Array.isArray(data)) {
    return data;
  }

  if (data.type === "symlink" && data.target) {
    const resolvedTarget = resolveSymlinkTargetPath(
      normalizedPath,
      data.target,
    );
    return listGitHubDirectory(
      owner,
      repo,
      resolvedTarget,
      branch,
      token,
      visitedPaths,
    );
  }

  throw new Error(`Path is not a directory: ${normalizedPath}`);
}

export async function listGitHubDirectory(
  owner: string,
  repo: string,
  path: string,
  branch: string = "main",
  token?: string,
  visitedPaths: Set<string> = new Set(),
): Promise<GitHubDirectoryEntry[]> {
  return await listGitHubDirectoryInternal(
    owner,
    repo,
    path,
    branch,
    token,
    visitedPaths,
  );
}

/**
 * サブディレクトリの最大ダウンロード数
 * 巨大なリポジトリ（例: Fabric の Patterns 240+ディレクトリ）で
 * GitHub API レート制限に当たるのを防止
 * 認証済み(5000回/時)なら余裕、未認証(60回/時)だと厳しいが
 * 未認証の場合はそもそも他の処理でも制限に当たるので300で許容
 */
const MAX_SUBDIRECTORY_DOWNLOADS = 300;

/**
 * 配布元が同梱したメタデータは信用しない。
 * ダウンロード内容から取ったパスをスキャナや削除処理へ渡さないため、
 * 拡張が自分で書くファイル名はリモートから受け取らない。
 */
const EXTENSION_OWNED_FILE_NAMES = new Set([".skill-meta.json"]);

function isExtensionOwnedFileName(name: string): boolean {
  return EXTENSION_OWNED_FILE_NAMES.has(name.trim().toLowerCase());
}

export interface DownloadDirectoryResult {
  errors: string[];
  /** ポリシー違反で除外したリモートのファイル名 / ディレクトリ名 */
  skippedUnsafeEntries: string[];
}

/**
 * フォルダを再帰的にダウンロード
 * ファイルをディレクトリより先にダウンロードし、
 * サブディレクトリのエラーは個別にキャッチして全体のクラッシュを防止
 */
async function downloadDirectory(
  owner: string,
  repo: string,
  remotePath: string,
  localPath: vscode.Uri,
  branch: string = "main",
  token?: string,
  depth: number = 0,
  downloadRoot: vscode.Uri = localPath,
): Promise<DownloadDirectoryResult> {
  const errors: string[] = [];
  const skippedUnsafeEntries: string[] = [];

  // GitHub のファイル名はディレクトリ区切りを含みうる。
  // Uri.joinPath は POSIX 結合なので `..\..\x` は 1 セグメントのまま通り、
  // Windows で fsPath へ変換された時点でインストール先の外へ出る。
  const resolveEntryUri = (entry: GitHubDirectoryEntry): vscode.Uri | null => {
    if (!isSafePathSegment(entry.name)) {
      skippedUnsafeEntries.push(entry.name);
      console.warn(
        `[Skill Ninja] Skipping unsafe remote entry name: ${JSON.stringify(entry.name)}`,
      );
      return null;
    }

    const target = vscode.Uri.joinPath(localPath, entry.name);
    if (!isContainedPath(downloadRoot.fsPath, target.fsPath)) {
      skippedUnsafeEntries.push(entry.name);
      console.warn(
        `[Skill Ninja] Skipping remote entry resolving outside the download root: ${target.fsPath}`,
      );
      return null;
    }

    return target;
  };

  const downloadFileEntry = async (
    entry: GitHubDirectoryEntry,
  ): Promise<void> => {
    if (!entry.download_url) {
      return;
    }

    if (isExtensionOwnedFileName(entry.name)) {
      skippedUnsafeEntries.push(entry.name);
      console.warn(
        `[Skill Ninja] Skipping extension-owned metadata shipped by the source: ${entry.name}`,
      );
      return;
    }

    const localFilePath = resolveEntryUri(entry);
    if (!localFilePath) {
      return;
    }

    console.log(`[Skill Ninja] Downloading file: ${entry.name}`);
    const content = await fetchFileContent(entry.download_url, token);
    await vscode.workspace.fs.writeFile(
      localFilePath,
      Buffer.from(content, "utf-8"),
    );
  };

  console.log(
    `[Skill Ninja] Downloading directory: ${owner}/${repo}/${remotePath} (branch: ${branch}, depth: ${depth})`,
  );

  const entries = await listGitHubDirectory(
    owner,
    repo,
    remotePath,
    branch,
    token,
  );
  console.log(`[Skill Ninja] Found ${entries.length} entries`);

  // ファイルとディレクトリを分離し、ファイルを先にダウンロード
  // （SKILL.md などの重要ファイルを確実に取得するため）
  const { files, directoriesToTraverse } =
    partitionGitHubDirectoryEntries(entries);

  // 1. ファイルを先にダウンロード
  for (const entry of files) {
    try {
      await downloadFileEntry(entry);
    } catch (error) {
      const msg = `Failed to download file ${entry.name}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[Skill Ninja] ${msg}`);
      errors.push(msg);
    }
  }

  // 2. サブディレクトリを再帰的にダウンロード（数の制限あり）
  if (directoriesToTraverse.length > MAX_SUBDIRECTORY_DOWNLOADS) {
    console.warn(
      `[Skill Ninja] Too many subdirectories (${directoriesToTraverse.length}), limiting to ${MAX_SUBDIRECTORY_DOWNLOADS}`,
    );
    errors.push(
      `Skipped ${directoriesToTraverse.length - MAX_SUBDIRECTORY_DOWNLOADS} of ${directoriesToTraverse.length} subdirectories (limit: ${MAX_SUBDIRECTORY_DOWNLOADS})`,
    );
  }

  const dirsToDownload = directoriesToTraverse.slice(
    0,
    MAX_SUBDIRECTORY_DOWNLOADS,
  );

  for (const entry of dirsToDownload) {
    const localFilePath = resolveEntryUri(entry);
    if (!localFilePath) {
      continue;
    }

    try {
      await vscode.workspace.fs.createDirectory(localFilePath);
      const subResult = await downloadDirectory(
        owner,
        repo,
        `${remotePath}/${entry.name}`,
        localFilePath,
        branch,
        token,
        depth + 1,
        downloadRoot,
      );
      errors.push(...subResult.errors);
      skippedUnsafeEntries.push(...subResult.skippedUnsafeEntries);
    } catch (error) {
      const msg = `Failed to download directory ${entry.name}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[Skill Ninja] ${msg}`);
      errors.push(msg);
      // サブディレクトリのエラーは致命的ではない - 続行
    }
  }

  return { errors, skippedUnsafeEntries };
}

async function downloadPrimarySkillMd(
  owner: string,
  repo: string,
  branch: string,
  remotePath: string,
  localPath: vscode.Uri,
  token?: string,
): Promise<boolean> {
  const normalizedRemotePath = remotePath.replace(/^\/+|\/+$/g, "");
  if (!normalizedRemotePath || normalizedRemotePath.endsWith(".md")) {
    return false;
  }

  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${normalizedRemotePath}/SKILL.md`;
  try {
    console.log(`[Skill Ninja] Trying primary SKILL.md fallback: ${rawUrl}`);
    const content = await fetchFileContent(rawUrl, token);
    const skillMdPath = vscode.Uri.joinPath(localPath, "SKILL.md");
    await vscode.workspace.fs.writeFile(
      skillMdPath,
      Buffer.from(content, "utf-8"),
    );
    console.log(`[Skill Ninja] Saved primary SKILL.md fallback`);
    return true;
  } catch (error) {
    console.warn(
      `[Skill Ninja] Primary SKILL.md fallback failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/**
 * スキル名をフォルダ名として安全な形式に変換
 * 非 ASCII だけの名前などは空文字になりうるので、
 * 単独では使わず resolveSkillFolderName 経由で使う。
 */
function sanitizeSkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-") // スペースをハイフンに
    .replace(/[()[\]{}]/g, "") // 括弧を削除
    .replace(/[^a-z0-9\-_]/g, "-") // 英数字とハイフン、アンダースコア以外をハイフンに
    .replace(/-+/g, "-") // 連続ハイフンを1つに
    .replace(/^-|-$/g, ""); // 先頭・末尾のハイフンを削除
}

const HASHED_SKILL_FOLDER_PREFIX = "skill-";

/**
 * インストール先フォルダ名を決める。
 *
 * `sanitizeSkillName` は日本語だけの名前や記号だけの名前で空文字を返すため、
 * そのまま join するとスキルルート自身を指してしまい、
 * 失敗時の後片付けでルートごと削除されうる。空にならない名前を必ず返す。
 */
export function resolveSkillFolderName(skill: {
  name: string;
  source?: string;
  path?: string;
}): string {
  const fromName = sanitizeSkillName(skill.name || "");
  if (isSafePathSegment(fromName)) {
    return fromName;
  }

  const remoteSegments = (skill.path || "").split(/[\\/]/).filter(Boolean);
  const fromRemotePath = sanitizeSkillName(remoteSegments.at(-1) || "");
  if (isSafePathSegment(fromRemotePath)) {
    return fromRemotePath;
  }

  const identity = [
    skill.source || FALLBACK_LOCAL_SOURCE,
    skill.path || "",
    skill.name || "",
  ]
    .map((part) => `${part.length}:${part}`)
    .join("|");
  const digest = createHash("sha256")
    .update(identity, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `${HASHED_SKILL_FOLDER_PREFIX}${digest}`;
}

function normalizeRemoteSkillPath(skillPath: string): string {
  return skillPath.replace(/^\/+/, "").replace(/\/+$/, "");
}

function normalizeGitHubRepoRef(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  const normalizedUrl = url.trim();
  const repoMatch = normalizedUrl.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (repoMatch) {
    return `${repoMatch[1]}/${repoMatch[2].replace(/\.git$/i, "")}`.toLowerCase();
  }

  const rawMatch = normalizedUrl.match(
    /raw\.githubusercontent\.com\/([^/]+)\/([^/]+)/i,
  );
  if (rawMatch) {
    return `${rawMatch[1]}/${rawMatch[2].replace(/\.git$/i, "")}`.toLowerCase();
  }

  return undefined;
}

function inferInstalledSkillSourceId(
  skill: Skill,
  source: Source | undefined,
  sources: Source[],
  downloadTarget:
    | { owner: string; repo: string; branch: string; remotePath: string }
    | undefined,
): string {
  if (source?.id) {
    return source.id;
  }

  if (downloadTarget) {
    const repoRef =
      `${downloadTarget.owner}/${downloadTarget.repo}`.toLowerCase();
    const matchedSource = sources.find(
      (candidate) => normalizeGitHubRepoRef(candidate.url) === repoRef,
    );
    if (matchedSource?.id) {
      return matchedSource.id;
    }
  }

  return normalizeInstalledSkillSource(
    skill.source,
    downloadTarget?.remotePath || skill.path,
  );
}

function buildGitHubPathSuffixCandidates(skillPath: string): string[] {
  if (skillPath.endsWith(".md")) {
    return [skillPath];
  }

  return [`${skillPath}/SKILL.md`, skillPath];
}

function parseGitHubSkillReference(
  url: string | undefined,
  skillPath: string,
): { owner: string; repo: string; branch: string } | undefined {
  if (!url) {
    return undefined;
  }

  const normalizedSkillPath = normalizeRemoteSkillPath(skillPath);
  if (!normalizedSkillPath) {
    return undefined;
  }

  const pathCandidates = buildGitHubPathSuffixCandidates(normalizedSkillPath);
  const gitHubMatch = url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|tree)\/(.+)$/,
  );
  if (gitHubMatch) {
    const [, owner, repo, branchAndPath] = gitHubMatch;
    for (const candidate of pathCandidates) {
      if (branchAndPath.endsWith(`/${candidate}`)) {
        const branch = branchAndPath.slice(
          0,
          branchAndPath.length - candidate.length - 1,
        );
        if (branch) {
          return {
            owner,
            repo: repo.replace(/\.git$/, ""),
            branch,
          };
        }
      }
    }
  }

  const rawMatch = url.match(
    /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(.+)$/,
  );
  if (!rawMatch) {
    return undefined;
  }

  const [, owner, repo, branchAndPath] = rawMatch;
  for (const candidate of pathCandidates) {
    if (branchAndPath.endsWith(`/${candidate}`)) {
      const branch = branchAndPath.slice(
        0,
        branchAndPath.length - candidate.length - 1,
      );
      if (branch) {
        return {
          owner,
          repo: repo.replace(/\.git$/, ""),
          branch,
        };
      }
    }
  }

  return undefined;
}

async function resolveSkillDownloadTarget(
  skill: Skill,
  source: Source | undefined,
  token?: string,
): Promise<
  | { owner: string; repo: string; branch: string; remotePath: string }
  | undefined
> {
  const remotePath = normalizeRemoteSkillPath(skill.path || "");
  if (!remotePath) {
    return undefined;
  }

  // `..` はパーセントエンコードしても URL 正規化で親セグメントへ戻り、
  // raw URL の owner / repo / branch を踏み越えて別リポジトリを取得できる
  if (!isSafeRemoteRepoPath(remotePath)) {
    console.warn(
      `[Skill Ninja] Refusing unsafe remote path: ${JSON.stringify(remotePath)}`,
    );
    return undefined;
  }

  if (source) {
    const match = source.url.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (match) {
      const [, owner, repo] = match;
      const branch = await getSourceBranch(source, token, skill.path);
      return {
        owner,
        repo: repo.replace(/\.git$/, ""),
        branch,
        remotePath,
      };
    }
  }

  const parsed =
    parseGitHubSkillReference(skill.rawUrl, remotePath) ||
    parseGitHubSkillReference(skill.url, remotePath);
  if (!parsed) {
    return undefined;
  }

  return {
    ...parsed,
    remotePath,
  };
}

/**
 * インストールをインストールする
 * GitHub からスキルファイルをダウンロードしてワークスペースに配置
 */
export type SkillInstallStatus = "ok" | "partial" | "incomplete";

export interface SkillInstallResult {
  status: SkillInstallStatus;
  name: string;
  errors: string[];
  /**
   * 安全でない名前などで意図的に除外したリモートエントリ。
   * 転送失敗ではないので status を partial へ降格させないが、
   * 敵対的な配布元を無言で clean install に見せないため別途通知する。
   */
  skippedUnsafeEntries?: string[];
}

/**
 * Thrown when only placeholder content could be written, so callers that count
 * exceptions as failures never report an incomplete install as success.
 */
export class SkillInstallIncompleteError extends Error {
  constructor(
    public readonly skillName: string,
    public readonly errors: string[],
  ) {
    super(`Skill install incomplete: ${skillName}`);
    this.name = "SkillInstallIncompleteError";
  }
}

export async function installSkill(
  skill: Skill,
  workspaceUri: vscode.Uri,
  context: vscode.ExtensionContext,
  targetRoot?: SkillRoot,
  options?: { allowRetry?: boolean; interactive?: boolean },
): Promise<SkillInstallResult> {
  if (targetRoot && (!targetRoot.isManaged || targetRoot.isReadOnly)) {
    throw new Error(
      `Cannot install into read-only skill root: ${targetRoot.rootPath}`,
    );
  }

  const downloadErrors: string[] = [];
  const skippedUnsafeEntries: string[] = [];
  let usedFallback = false;

  const skillsRootUri = resolveSkillsRootUri(workspaceUri, targetRoot?.rootUri);

  // スキル名をサニタイズしてフォルダ名として使用
  const safeName = resolveSkillFolderName(skill);
  const skillPath = vscode.Uri.joinPath(skillsRootUri, safeName);
  if (!isStrictlyInsidePath(skillsRootUri.fsPath, skillPath.fsPath)) {
    throw new Error(
      `Refusing to install outside the skill root: ${skillPath.fsPath} (root: ${skillsRootUri.fsPath})`,
    );
  }
  await vscode.workspace.fs.createDirectory(skillPath);

  // インデックスからソース情報を取得
  const index = await loadSkillIndex(context);
  const source = index.sources.find((s: Source) => s.id === skill.source);

  // GitHub Token を取得
  const token = await getGitHubToken();
  const downloadTarget = await resolveSkillDownloadTarget(skill, source, token);

  if (!downloadTarget) {
    // ソースがない場合はフォールバック
    usedFallback = true;
    downloadErrors.push(
      `Unable to resolve a download target for ${skill.name}`,
    );
    await createFallbackSkillMd(skillPath, skill);
  } else {
    const { owner, repo, branch, remotePath } = downloadTarget;

    console.log(`[Skill Ninja] Installing skill: ${skill.name}`);
    console.log(
      `[Skill Ninja] Owner: ${owner}, Repo: ${repo}, Branch: ${branch}`,
    );
    console.log(`[Skill Ninja] Remote path: ${remotePath}`);

    // パスが .md で終わる場合は単独ファイル
    if (remotePath.endsWith(".md")) {
      // 単独ファイルをダウンロード → SKILL.md として保存
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${remotePath}`;
      console.log(`[Skill Ninja] Downloading single file: ${rawUrl}`);
      try {
        const content = await fetchFileContent(rawUrl, token);
        console.log(`[Skill Ninja] Downloaded ${content.length} bytes`);

        // SKILL.md として保存（メインファイル）
        const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
        await vscode.workspace.fs.writeFile(
          skillMdPath,
          Buffer.from(content, "utf-8"),
        );
        console.log(`[Skill Ninja] Saved as SKILL.md`);
      } catch (error) {
        console.error(`[Skill Ninja] Failed to download ${rawUrl}:`, error);
        const errorMsg = error instanceof Error ? error.message : String(error);

        // 404エラーの場合はインストールをキャンセル（フォールバック作らない）
        if (errorMsg.includes("404")) {
          await handleSkillNotFound(
            skillsRootUri,
            skillPath,
            skill,
            source,
            rawUrl,
            token,
            branch,
          );
        }

        // その他のエラーは不完全インストールとして記録し、後段でまとめて通知する
        usedFallback = true;
        downloadErrors.push(`${rawUrl}: ${errorMsg}`);
        await createFallbackSkillMd(skillPath, skill);
      }
    } else {
      // フォルダ全体をダウンロード
      try {
        const result = await downloadDirectory(
          owner,
          repo,
          remotePath,
          skillPath,
          branch,
          token,
        );

        // SKILL.md がなければ作成
        try {
          await vscode.workspace.fs.stat(
            vscode.Uri.joinPath(skillPath, "SKILL.md"),
          );
        } catch {
          if (
            !(await downloadPrimarySkillMd(
              owner,
              repo,
              branch,
              remotePath,
              skillPath,
              token,
            ))
          ) {
            usedFallback = true;
            downloadErrors.push(`SKILL.md was not found under ${remotePath}`);
            await createFallbackSkillMd(skillPath, skill);
          }
        }

        // サブディレクトリで部分的なエラーがあった場合は部分成功として記録
        if (result.errors.length > 0) {
          console.warn(
            `[Skill Ninja] Partial errors during download:`,
            result.errors,
          );
          downloadErrors.push(...result.errors);
        }
        skippedUnsafeEntries.push(...result.skippedUnsafeEntries);
      } catch (error) {
        console.error(`[Skill Ninja] Failed to download directory:`, error);
        const errorMsg = error instanceof Error ? error.message : String(error);

        const recoveredPrimarySkillMd = await downloadPrimarySkillMd(
          owner,
          repo,
          branch,
          remotePath,
          skillPath,
          token,
        );
        if (recoveredPrimarySkillMd) {
          downloadErrors.push(errorMsg);
        } else if (errorMsg.includes("404")) {
          const repoTreeUrl = `https://github.com/${owner}/${repo}/tree/${branch}/${remotePath}`;
          await handleSkillNotFound(
            skillsRootUri,
            skillPath,
            skill,
            source,
            repoTreeUrl,
            token,
            branch,
          );
        } else {
          // Don't overwrite SKILL.md with fallback if it was already downloaded
          const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
          let skillMdExists = false;
          try {
            const existing = await vscode.workspace.fs.readFile(skillMdPath);
            const existingText = Buffer.from(existing).toString("utf-8");
            // A leftover placeholder from an earlier install must not count as real content
            skillMdExists = !isFallbackSkillMd(existingText, skill.source);
          } catch {
            // File does not exist
          }
          downloadErrors.push(errorMsg);
          if (!skillMdExists) {
            usedFallback = true;
            await createFallbackSkillMd(skillPath, skill);
          } else {
            console.log(
              `[Skill Ninja] SKILL.md already exists, skipping fallback creation`,
            );
          }
        }
      }
    }
  }

  // メタデータを保存（description などを後で取得できるように）
  // 英語環境の場合はSKILL.mdからdescriptionを抽出（インデックスは日本語のため）
  let description = skill.description;
  if (!isJapanese()) {
    const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
    const extractedDesc = await extractDescriptionFromSkillMd(skillMdPath);
    if (extractedDesc) {
      description = extractedDesc;
    }
  }

  // "When to Use" セクションを抽出
  const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
  const whenToUse = await extractWhenToUseFromSkillMd(skillMdPath);

  // 既存のメタデータからカスタム値を保持
  const metaPath = vscode.Uri.joinPath(skillPath, ".skill-meta.json");
  let existingCustomWhenToUse: string | undefined;
  let existingRegistrationDisabled: boolean | undefined;
  try {
    const existingContent = await vscode.workspace.fs.readFile(metaPath);
    const existingMeta = JSON.parse(
      Buffer.from(existingContent).toString("utf-8"),
    );
    existingCustomWhenToUse = existingMeta.customWhenToUse;
    existingRegistrationDisabled = existingMeta.registrationDisabled;
  } catch {
    // 既存のメタデータがない場合は無視
  }

  const normalizedRemotePath = downloadTarget?.remotePath || skill.path;
  const normalizedSourceId = inferInstalledSkillSourceId(
    skill,
    source,
    index.sources,
    downloadTarget,
  );

  const meta: SkillMeta = {
    name: skill.name,
    source: normalizedSourceId,
    description: description,
    description_ja: skill.description_ja,
    whenToUse: whenToUse || undefined,
    customWhenToUse: existingCustomWhenToUse, // ユーザーのカスタム値を保持
    categories: skill.categories,
    installedAt: new Date().toISOString(),
    relativePath: safeName,
    remotePath: normalizedRemotePath,
    registrationDisabled: existingRegistrationDisabled,
    incomplete: usedFallback || undefined,
    ...derivePackageMetadata(skill.name, normalizedRemotePath, safeName),
  };
  await vscode.workspace.fs.writeFile(
    metaPath,
    Buffer.from(JSON.stringify(enrichSkillMeta(meta), null, 2), "utf-8"),
  );

  const result: SkillInstallResult = {
    status: usedFallback
      ? "incomplete"
      : downloadErrors.length > 0
        ? "partial"
        : "ok",
    name: skill.name,
    errors: downloadErrors,
    skippedUnsafeEntries:
      skippedUnsafeEntries.length > 0 ? skippedUnsafeEntries : undefined,
  };

  const recovered = await reportInstallResult(
    skillPath,
    skill,
    source,
    result,
    {
      workspaceUri,
      context,
      targetRoot,
      resolvedBranch: downloadTarget?.branch,
      hasToken: Boolean(token),
      allowRetry: options?.allowRetry !== false,
      interactive: options?.interactive !== false,
    },
  );

  if (recovered) {
    return recovered;
  }

  if (result.status === "incomplete") {
    throw new SkillInstallIncompleteError(skill.name, result.errors);
  }

  return result;
}

/**
 * インストール結果を通知し、再試行で回復できた場合はその結果を返す
 */
async function reportInstallResult(
  skillPath: vscode.Uri,
  skill: Skill,
  source: Source | undefined,
  result: SkillInstallResult,
  options: {
    workspaceUri: vscode.Uri;
    context: vscode.ExtensionContext;
    targetRoot?: SkillRoot;
    resolvedBranch?: string;
    hasToken: boolean;
    allowRetry: boolean;
    interactive: boolean;
  },
): Promise<SkillInstallResult | undefined> {
  const skipped = result.skippedUnsafeEntries ?? [];
  if (skipped.length > 0) {
    console.warn(
      `[Skill Ninja] Skipped unsafe remote entries for "${skill.name}":`,
      skipped,
    );
    if (options.interactive) {
      vscode.window.showWarningMessage(
        messages.installSkippedUnsafeEntries(
          skill.name,
          skipped.length,
          skipped.slice(0, 5).join(", "),
        ),
      );
    }
  }

  if (result.status === "ok") {
    return undefined;
  }

  if (result.status === "partial") {
    if (options.interactive) {
      vscode.window.showWarningMessage(messages.installPartial(skill.name));
    }
    return undefined;
  }

  console.warn(
    `[Skill Ninja] Skill "${skill.name}" installed incompletely:`,
    result.errors,
  );

  // Bulk installs report through their own summary, so skip the per-skill dialog
  if (!options.interactive) {
    return undefined;
  }

  const retryInstall = messages.actionRetryInstall();
  const removeSkill = messages.actionRemoveSkill();
  const reportBug = messages.actionReportBug();
  const actions = options.allowRetry
    ? [retryInstall, removeSkill, reportBug]
    : [removeSkill, reportBug];

  const choice = await vscode.window.showErrorMessage(
    messages.installIncomplete(skill.name),
    ...actions,
  );

  if (choice === retryInstall) {
    return await installSkill(
      skill,
      options.workspaceUri,
      options.context,
      options.targetRoot,
      { allowRetry: false, interactive: options.interactive },
    );
  }

  if (choice === removeSkill) {
    try {
      await deleteSkillDirectory(
        resolveSkillsRootUri(options.workspaceUri, options.targetRoot?.rootUri),
        skillPath,
      );
    } catch (error) {
      console.error(
        `[Skill Ninja] Failed to remove incomplete skill "${skill.name}":`,
        error,
      );
    }
  } else if (choice === reportBug) {
    await openIncompleteInstallReport(
      skill,
      source,
      result,
      options.resolvedBranch,
      options.hasToken,
    );
  }

  return undefined;
}

/**
 * すでにインストール済みの SKILL.md がフォールバック（プレースホルダー）かを判定する。
 * `.skill-meta.json` に `incomplete` が無い旧バージョンの移行判定に使う。
 */
export function isFallbackSkillMd(text: string, sourceId: string): boolean {
  // Frontmatter means a real SKILL.md, so it must never be treated as a placeholder
  if (text.includes("---")) {
    return false;
  }

  if (text.trim().length < 50) {
    return true;
  }

  return (
    text.includes(`Source: ${sourceId}`) &&
    text.split("\n").filter((line) => line.trim()).length <= 5
  );
}

function classifyInstallErrors(errors: string[]): string {
  const kinds = new Set<string>();
  for (const error of errors) {
    const lower = error.toLowerCase();
    if (lower.includes("rate limit") || lower.includes("429")) {
      kinds.add("rate-limit");
    } else if (lower.includes("404")) {
      kinds.add("not-found");
    } else if (lower.includes("timeout")) {
      kinds.add("timeout");
    } else if (lower.includes("401") || lower.includes("403")) {
      kinds.add("auth");
    } else {
      kinds.add("other");
    }
  }

  return kinds.size > 0 ? Array.from(kinds).join(", ") : "unknown";
}

async function openIncompleteInstallReport(
  skill: Skill,
  source: Source | undefined,
  result: SkillInstallResult,
  resolvedBranch: string | undefined,
  hasToken: boolean,
): Promise<void> {
  const extensionVersion =
    vscode.extensions.getExtension("yamapan.agent-skill-ninja")?.packageJSON
      ?.version || "unknown";

  const issueTitle = `[Bug] Skill install incomplete: ${skill.name}`;
  const issueBody =
    `**Issue**\n` +
    `Skill "${skill.name}" from source "${skill.source}" was not installed correctly.\n\n` +
    `**Expected**\n` +
    `SKILL.md should contain the full skill content.\n\n` +
    `**Actual**\n` +
    `Only placeholder content was written because the download failed.\n\n` +
    `**Skill Details**\n` +
    `- Name: ${skill.name}\n` +
    `- Source ID: ${skill.source}\n` +
    `- Path: ${skill.path || "unknown"}\n` +
    `- Repository: ${source?.url || "unknown"}\n` +
    `- Resolved Branch: ${resolvedBranch || source?.branch || "unknown"}\n\n` +
    `**Environment**\n` +
    `- Extension Version: ${extensionVersion}\n` +
    `- VS Code: ${vscode.version}\n` +
    `- OS: ${process.platform}\n` +
    `- GitHub Authentication: ${hasToken ? "configured" : "not configured"}\n\n` +
    `**Failure Kinds**\n` +
    `${classifyInstallErrors(result.errors)}\n\n` +
    `**Download Errors**\n` +
    "```\n" +
    `${result.errors.slice(0, 10).join("\n") || "none recorded"}\n` +
    "```";

  const params = new URLSearchParams({
    title: issueTitle,
    body: issueBody,
  });
  const issueUrl = `https://github.com/aktsmm/vscode-agent-skill-ninja/issues/new?${params.toString()}`;
  await vscode.env.openExternal(vscode.Uri.parse(issueUrl));
}

/**
 * スキルをアンインストールする
 */
export async function uninstallSkill(
  skillName: string,
  workspaceUri: vscode.Uri,
  skillsRootUri?: vscode.Uri,
): Promise<void> {
  const skillsPath = resolveSkillsRootUri(workspaceUri, skillsRootUri);

  // 区切りや相対参照を含む名前はサニタイズで別スキルへ化けるので受け付けない
  if (typeof skillName !== "string" || /[\\/]/.test(skillName)) {
    throw new Error(
      `Refusing to delete skill with an unsafe name: ${JSON.stringify(skillName)}`,
    );
  }

  // まずそのままの名前で試す（既存の互換性）、無ければサニタイズ名で試す
  const candidates = [skillName, sanitizeSkillName(skillName)].filter(
    (candidate) => isSafePathSegment(candidate),
  );
  if (candidates.length === 0) {
    throw new Error(
      `Refusing to delete skill with an unsafe folder name: ${JSON.stringify(skillName)}`,
    );
  }

  let skillPath = vscode.Uri.joinPath(skillsPath, candidates[0]);

  try {
    await vscode.workspace.fs.stat(skillPath);
  } catch {
    if (candidates[1]) {
      skillPath = vscode.Uri.joinPath(skillsPath, candidates[1]);
    }
  }

  try {
    await deleteSkillDirectory(skillsPath, skillPath);
  } catch (error) {
    throw new Error(`Failed to delete skill directory: ${error}`);
  }
}

/**
 * 相対パスからスキルフォルダを削除
 * SKILL.md の相対パスから親フォルダを特定して削除
 */
export async function uninstallSkillByPath(
  relativePath: string,
  workspaceUri: vscode.Uri,
  skillsRootUri?: vscode.Uri,
): Promise<void> {
  const basePath = resolveSkillsRootUri(workspaceUri, skillsRootUri);
  const skillPath = resolveManagedSkillDirUri(basePath, relativePath);

  try {
    await deleteSkillDirectory(basePath, skillPath);
  } catch (error) {
    throw new Error(`Failed to delete skill directory: ${error}`);
  }
}

/**
 * インストール済みスキルの一覧を取得
 */
export async function getInstalledSkills(
  workspaceUri: vscode.Uri,
  skillsRootUri?: vscode.Uri,
): Promise<string[]> {
  const skillsPath = resolveSkillsRootUri(workspaceUri, skillsRootUri);

  try {
    try {
      await vscode.workspace.fs.stat(skillsPath);
    } catch {
      return [];
    }

    const entries = await vscode.workspace.fs.readDirectory(skillsPath);
    // ディレクトリのみを返す
    return entries
      .filter(([, type]) => type === vscode.FileType.Directory)
      .map(([name]) => name);
  } catch {
    // ディレクトリが存在しない場合は空配列
    return [];
  }
}

/**
 * スキルのメタデータ
 */
export interface SkillMeta {
  name: string;
  source: string;
  description: string;
  description_ja?: string;
  whenToUse?: string; // SKILL.md の "When to Use" セクションから抽出
  customWhenToUse?: string; // ユーザーがカスタマイズした説明（最優先）
  categories: string[];
  installedAt: string;
  relativePath?: string; // ネストされたスキルのパス（例: "document-skills/docx"）
  remotePath?: string; // 配布元リポジトリでの相対パス
  registrationDisabled?: boolean;
  /** Set when only placeholder content could be written during install. */
  incomplete?: boolean;
  reinstallDisabled?: boolean;
  reinstallDisabledReason?: string;
  reinstallDisabledAt?: string;
  metadataVersion?: 2;
  installedVia?: "direct" | "packageRoot" | "packageChild" | "legacy";
  packageParentName?: string;
  packageParentRemotePath?: string;
  packageParentRelativePath?: string;
  // 公式仕様に基づくメタデータ
  license?: string; // ライセンス（例: MIT, Apache-2.0）
  author?: string; // 作成者
  version?: string; // バージョン
}

const FALLBACK_LOCAL_SOURCE = "local";

/**
 * ローカルの配置位置だけから導ける情報。
 * 走査結果から常に再計算できるので、メタデータファイルの値を信用しない。
 */
function deriveLocalPackageMetadata(relativePath?: string): {
  isPackageChild: boolean;
  packageParentRelativePath?: string;
} {
  const segments = (relativePath ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);

  if (segments.length > 1) {
    return {
      isPackageChild: true,
      packageParentRelativePath: segments.slice(0, -1).join("/"),
    };
  }

  return { isPackageChild: false };
}

/**
 * 配布元リポジトリ側の情報。ローカル走査からは復元できない。
 */
function deriveRemotePackageMetadata(
  name: string,
  remotePath?: string,
): Pick<
  SkillMeta,
  "installedVia" | "packageParentName" | "packageParentRemotePath"
> {
  const remoteSegments = (remotePath ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);

  const leafSegment = remoteSegments.at(-1);
  const parentSegment =
    remoteSegments.length >= 2 ? remoteSegments.at(-2) : undefined;
  if (
    leafSegment &&
    parentSegment &&
    parentSegment.toLowerCase() !== leafSegment.toLowerCase() &&
    parentSegment.toLowerCase() !== name.toLowerCase()
  ) {
    return {
      installedVia: "packageChild",
      packageParentName: parentSegment,
      packageParentRemotePath: remoteSegments.slice(0, -1).join("/"),
    };
  }

  return {
    installedVia: remoteSegments.length > 0 ? "direct" : "legacy",
  };
}

function derivePackageMetadata(
  name: string,
  remotePath?: string,
  relativePath?: string,
): Pick<
  SkillMeta,
  | "installedVia"
  | "packageParentName"
  | "packageParentRemotePath"
  | "packageParentRelativePath"
> {
  const local = deriveLocalPackageMetadata(relativePath);
  if (local.isPackageChild) {
    return {
      installedVia: "packageChild",
      packageParentRelativePath: local.packageParentRelativePath,
    };
  }

  return deriveRemotePackageMetadata(name, remotePath);
}

/**
 * @param trustedRelativePath 走査で確定したスキルルート相対パス。
 *   渡された場合、ローカル位置由来のフィールドはこの値から再計算し、
 *   メタデータファイルの値を採用しない。走査から復元できないリモート側の
 *   情報（`packageParentName` / `packageParentRemotePath`）だけは残す。
 */
export function enrichSkillMeta(
  meta: SkillMeta,
  trustedRelativePath?: string,
): SkillMeta {
  if (trustedRelativePath === undefined) {
    const derived = derivePackageMetadata(
      meta.name,
      meta.remotePath,
      meta.relativePath,
    );

    return {
      ...meta,
      metadataVersion: 2,
      installedVia: meta.installedVia ?? derived.installedVia,
      packageParentName: meta.packageParentName ?? derived.packageParentName,
      packageParentRemotePath:
        meta.packageParentRemotePath ?? derived.packageParentRemotePath,
      packageParentRelativePath:
        meta.packageParentRelativePath ?? derived.packageParentRelativePath,
    };
  }

  const local = deriveLocalPackageMetadata(trustedRelativePath);
  const remote = deriveRemotePackageMetadata(meta.name, meta.remotePath);

  return {
    ...meta,
    metadataVersion: 2,
    relativePath: trustedRelativePath,
    installedVia: local.isPackageChild
      ? "packageChild"
      : (meta.installedVia ?? remote.installedVia),
    packageParentRelativePath: local.packageParentRelativePath,
    packageParentName: meta.packageParentName ?? remote.packageParentName,
    packageParentRemotePath:
      meta.packageParentRemotePath ?? remote.packageParentRemotePath,
  };
}

export interface ManagedInstalledSkill {
  root: SkillRoot;
  meta: SkillMeta;
}

export async function getManagedInstalledSkillsWithMeta(
  workspaceUri: vscode.Uri,
): Promise<ManagedInstalledSkill[]> {
  const roots = await getManagedSkillRoots(workspaceUri);
  const groupedSkills = await Promise.all(
    roots.map(async (root) => {
      const metas = await getInstalledSkillsWithMeta(
        workspaceUri,
        root.rootUri,
      );
      return metas.map((meta) => ({ root, meta }));
    }),
  );

  return groupedSkills.flat().sort((left, right) => {
    if (left.root.scope !== right.root.scope) {
      const scopeOrder = [
        "workspace",
        "userGlobal",
        "extension",
        "builtIn",
      ] as const;
      return (
        scopeOrder.indexOf(left.root.scope) -
        scopeOrder.indexOf(right.root.scope)
      );
    }

    const rootPathCompare = left.root.rootPath.localeCompare(
      right.root.rootPath,
    );
    if (rootPathCompare !== 0) {
      return rootPathCompare;
    }

    const leftPath = left.meta.relativePath || left.meta.name;
    const rightPath = right.meta.relativePath || right.meta.name;
    return leftPath.localeCompare(rightPath);
  });
}

/**
 * インストール済みスキルのうち、内容がプレースホルダーのままのものを返す。
 * `incomplete` フラグが無い旧バージョンでインストールされたものも検出する。
 */
export async function findIncompleteInstalledSkills(
  workspaceUri: vscode.Uri,
): Promise<string[]> {
  const entries = await getManagedInstalledSkillsWithMeta(workspaceUri);
  const incompleteNames: string[] = [];

  for (const { root, meta } of entries) {
    if (meta.incomplete) {
      incompleteNames.push(meta.name);
      continue;
    }

    const skillsRootUri = resolveSkillsRootUri(workspaceUri, root.rootUri);
    const skillMdPath = vscode.Uri.joinPath(
      skillsRootUri,
      meta.relativePath || meta.name,
      "SKILL.md",
    );

    try {
      const content = await vscode.workspace.fs.readFile(skillMdPath);
      const text = Buffer.from(content).toString("utf-8");
      if (isFallbackSkillMd(text, meta.source)) {
        incompleteNames.push(meta.name);
      }
    } catch {
      // 読めない SKILL.md はここでは判定しない
    }
  }

  return incompleteNames;
}

/**
 * 空文字フォルダ名バグの残骸が疑われる managed root を返す。
 *
 * 空文字へサニタイズされるスキル名でインストールすると、スキル本体が
 * ルート直下へ展開され、`relativePath` が空のメタデータが書かれていた。
 *
 * ルート直下の `SKILL.md` 自体は、ルートを 1 スキルとして扱う正規構成でも
 * 現れるので判定に使わない。バグ固有の証拠であるメタデータ側だけを見る。
 * 復旧はユーザー判断が要るので検出だけ行う。
 */
export async function findRootLevelSkillArtifacts(
  workspaceUri: vscode.Uri,
): Promise<string[]> {
  const roots = await getManagedSkillRoots(workspaceUri);
  const affected: string[] = [];

  for (const root of roots) {
    const skillsRootUri = resolveSkillsRootUri(workspaceUri, root.rootUri);
    try {
      const content = await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(skillsRootUri, ".skill-meta.json"),
      );
      const meta = JSON.parse(
        Buffer.from(content).toString("utf-8"),
      ) as Partial<SkillMeta>;
      const recordedPath = (meta.relativePath ?? "").replace(/[\\/.]/g, "");
      if (recordedPath.length === 0) {
        affected.push(skillsRootUri.fsPath);
      }
    } catch {
      // メタデータが無い、または読めない場合は残骸とみなさない
    }
  }

  return affected;
}

export async function refreshManagedSkillMetadata(
  workspaceUri: vscode.Uri,
): Promise<number> {
  const roots = await getManagedSkillRoots(workspaceUri);
  let updatedCount = 0;

  for (const root of roots) {
    updatedCount += await refreshSkillMetadata(workspaceUri, root.rootUri);
  }

  return updatedCount;
}

/**
 * ディレクトリ内のスキルを再帰的にスキャン
 * SKILL.md を持つフォルダをスキルとして検出
 * サブフォルダに SKILL.md がある場合は個別のスキルとして扱う
 */
async function scanSkillsRecursively(
  basePath: vscode.Uri,
  currentPath: vscode.Uri,
  relativePath: string,
  results: Array<{
    folderName: string;
    relativePath: string;
    metaPath: vscode.Uri;
    skillMdPath: vscode.Uri;
  }>,
  depth: number = 0,
): Promise<void> {
  // 最大深度を制限（無限ループ防止）
  if (depth > 3) return;

  try {
    try {
      await vscode.workspace.fs.stat(currentPath);
    } catch {
      return;
    }

    const entries = await vscode.workspace.fs.readDirectory(currentPath);
    const dirs = entries.filter(
      ([, type]) => type === vscode.FileType.Directory,
    );

    for (const [folderName] of dirs) {
      // 隠しフォルダはスキップ
      if (folderName.startsWith(".")) continue;

      const subPath = vscode.Uri.joinPath(currentPath, folderName);
      const skillMdPath = vscode.Uri.joinPath(subPath, "SKILL.md");
      const metaPath = vscode.Uri.joinPath(subPath, ".skill-meta.json");
      const subRelativePath = relativePath
        ? `${relativePath}/${folderName}`
        : folderName;

      // SKILL.md が存在するか確認
      let hasSkillMd = false;
      try {
        await vscode.workspace.fs.stat(skillMdPath);
        hasSkillMd = true;
      } catch {
        // SKILL.md がない
      }

      if (hasSkillMd) {
        // このフォルダはスキル
        results.push({
          folderName,
          relativePath: subRelativePath,
          metaPath,
          skillMdPath,
        });
      }

      // サブフォルダも再帰的にスキャン
      await scanSkillsRecursively(
        basePath,
        subPath,
        subRelativePath,
        results,
        depth + 1,
      );
    }
  } catch {
    // ディレクトリ読み取りエラー
  }
}

/**
 * インストール済みスキルのメタデータを再抽出（アップデート時用）
 * SKILL.md から description と whenToUse を再抽出してメタデータファイルを更新
 */
export async function refreshSkillMetadata(
  workspaceUri: vscode.Uri,
  skillsRootUri?: vscode.Uri,
): Promise<number> {
  const skillsPath = resolveSkillsRootUri(workspaceUri, skillsRootUri);

  let updatedCount = 0;

  try {
    try {
      await vscode.workspace.fs.stat(skillsPath);
    } catch {
      return 0;
    }

    // ネストされたスキルも走査対象にし、書き戻すパスは走査結果から取る
    const skillEntries: Array<{
      folderName: string;
      relativePath: string;
      metaPath: vscode.Uri;
      skillMdPath: vscode.Uri;
    }> = [];
    await scanSkillsRecursively(skillsPath, skillsPath, "", skillEntries);

    for (const entry of skillEntries) {
      const { folderName, relativePath, metaPath, skillMdPath } = entry;

      try {
        // 既存のメタデータを読み込む
        const content = await vscode.workspace.fs.readFile(metaPath);
        const meta = enrichSkillMeta(
          JSON.parse(Buffer.from(content).toString("utf-8")) as SkillMeta,
          relativePath,
        );

        // SKILL.md から description と whenToUse を再抽出
        const newDescription = await extractDescriptionFromSkillMd(skillMdPath);
        const newWhenToUse = await extractWhenToUseFromSkillMd(skillMdPath);

        let updated = false;

        // description が変更された場合
        if (newDescription && meta.description !== newDescription) {
          meta.description = newDescription;
          updated = true;
        }

        // whenToUse が変更された場合
        // （customWhenToUse がある場合は whenToUse のみ更新、ユーザーのカスタム値は保持）
        if (meta.whenToUse !== newWhenToUse) {
          meta.whenToUse = newWhenToUse || undefined;
          updated = true;
        }

        if (meta.metadataVersion !== 2) {
          meta.metadataVersion = 2;
          updated = true;
        }

        if (updated) {
          // メタデータを保存
          await vscode.workspace.fs.writeFile(
            metaPath,
            Buffer.from(JSON.stringify(meta, null, 2), "utf-8"),
          );
          updatedCount++;
          console.log(`[Skill Ninja] Refreshed metadata for ${relativePath}`);
        }
      } catch {
        // メタデータがない場合は新規作成。
        // 走査はネストも見るが、新規作成は従来どおり直下のスキルに限る
        if (relativePath.includes("/")) {
          continue;
        }
        try {
          const { name, description } =
            await extractNameAndDescriptionFromSkillMd(skillMdPath, folderName);
          const whenToUse = await extractWhenToUseFromSkillMd(skillMdPath);

          const newMeta: SkillMeta = {
            name,
            source: FALLBACK_LOCAL_SOURCE,
            description,
            whenToUse: whenToUse || undefined,
            categories: [],
            installedAt: new Date().toISOString(),
            relativePath,
          };

          await vscode.workspace.fs.writeFile(
            metaPath,
            Buffer.from(
              JSON.stringify(enrichSkillMeta(newMeta, relativePath), null, 2),
              "utf-8",
            ),
          );
          updatedCount++;
          console.log(
            `[Skill Ninja] Created metadata for ${relativePath}: ${whenToUse}`,
          );
        } catch {
          // SKILL.md もない場合はスキップ
        }
      }
    }
  } catch {
    // skills ディレクトリがない場合は何もしない
  }

  return updatedCount;
}

/**
 * 単一スキルのメタデータを SKILL.md から再抽出して更新
 * @param skillMdUri SKILL.md ファイルの URI
 * @param skillsRootUri このスキルが属する managed root。渡された場合、
 *   位置関連フィールドを実在位置から再構成する。
 * @returns 更新されたかどうか
 */
export async function refreshSingleSkillMetadata(
  skillMdUri: vscode.Uri,
  skillsRootUri?: vscode.Uri,
): Promise<boolean> {
  // SKILL.md の親ディレクトリ（スキルフォルダ）を取得
  const skillPath = vscode.Uri.joinPath(skillMdUri, "..");
  const metaPath = vscode.Uri.joinPath(skillPath, ".skill-meta.json");

  const trustedRelativePath = skillsRootUri
    ? resolveTrustedRelativePath(skillsRootUri, skillPath)
    : undefined;

  // root を渡されたのに位置を確定できないなら、その URI は管理外
  if (skillsRootUri && !trustedRelativePath) {
    console.warn(
      `[Skill Ninja] Refusing metadata update outside the skill root: ${skillPath.fsPath}`,
    );
    return false;
  }

  try {
    // 既存のメタデータを読み込む
    const content = await vscode.workspace.fs.readFile(metaPath);
    const meta = enrichSkillMeta(
      JSON.parse(Buffer.from(content).toString("utf-8")) as SkillMeta,
      trustedRelativePath,
    );

    // SKILL.md から description と whenToUse を再抽出
    const newDescription = await extractDescriptionFromSkillMd(skillMdUri);
    const newWhenToUse = await extractWhenToUseFromSkillMd(skillMdUri);

    let updated = false;

    // description が変更された場合
    if (newDescription && meta.description !== newDescription) {
      meta.description = newDescription;
      updated = true;
    }

    // whenToUse が変更された場合
    if (meta.whenToUse !== newWhenToUse) {
      meta.whenToUse = newWhenToUse || undefined;
      updated = true;
    }

    if (updated) {
      await vscode.workspace.fs.writeFile(
        metaPath,
        Buffer.from(JSON.stringify(meta, null, 2), "utf-8"),
      );
      console.log(
        `[Skill Ninja] Updated metadata from SKILL.md: ${skillMdUri.fsPath}`,
      );
      return true;
    }

    return false;
  } catch {
    // メタデータがない場合は何もしない（インストールされていないスキル）
    return false;
  }
}

/**
 * インストール済みスキルのメタデータを取得
 * サブフォルダも再帰的にスキャンしてネストされたスキルも検出
 */
export async function getInstalledSkillsWithMeta(
  workspaceUri: vscode.Uri,
  skillsRootUri?: vscode.Uri,
): Promise<SkillMeta[]> {
  const skillsPath = resolveSkillsRootUri(workspaceUri, skillsRootUri);

  try {
    try {
      await vscode.workspace.fs.stat(skillsPath);
    } catch {
      return [];
    }

    // 再帰的にスキルをスキャン
    const skillEntries: Array<{
      folderName: string;
      relativePath: string;
      metaPath: vscode.Uri;
      skillMdPath: vscode.Uri;
    }> = [];
    await scanSkillsRecursively(skillsPath, skillsPath, "", skillEntries);

    const metas: SkillMeta[] = [];
    for (const entry of skillEntries) {
      try {
        const content = await vscode.workspace.fs.readFile(entry.metaPath);
        // 走査で確定した位置を正とする。
        // メタデータ側のパスは配布元が同梱できるので削除・書き込みに使わない。
        const meta = enrichSkillMeta(
          JSON.parse(Buffer.from(content).toString("utf-8")) as SkillMeta,
          entry.relativePath,
        );
        metas.push(meta);
      } catch {
        // メタデータがない場合は SKILL.md から name と description を読み取る
        const { name, description, license, author, version } =
          await extractMetadataFromSkillMd(entry.skillMdPath, entry.folderName);
        // When to Use セクションも抽出
        const whenToUse = await extractWhenToUseFromSkillMd(entry.skillMdPath);
        metas.push({
          name,
          source: FALLBACK_LOCAL_SOURCE,
          description,
          whenToUse: whenToUse || undefined,
          categories: [],
          installedAt: "",
          relativePath: entry.relativePath,
          license,
          author,
          version,
          metadataVersion: 2,
          ...derivePackageMetadata(name, undefined, entry.relativePath),
        });
      }
    }
    return metas;
  } catch {
    return [];
  }
}

/**
 * SKILL.md ファイルから name と description を抽出する
 * frontmatter の name, description フィールドを読み取る
 * frontmatter がない場合は # ヘッダーから name を抽出
 */
async function extractNameAndDescriptionFromSkillMd(
  skillMdUri: vscode.Uri,
  fallbackName: string,
): Promise<{ name: string; description: string }> {
  try {
    const content = await vscode.workspace.fs.readFile(skillMdUri);
    const text = Buffer.from(content).toString("utf-8");
    const normalizedText = normalizeNewlines(text);

    // frontmatter を解析
    const frontmatterMatch = normalizedText.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];

      // name フィールドを抽出
      let name = fallbackName;
      const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
      if (nameMatch) {
        name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
      }

      // description を抽出
      const description = extractDescriptionFromFrontmatter(frontmatter);

      return { name, description };
    }

    // frontmatter がない場合は # ヘッダーから name を抽出
    const headerMatch = normalizedText.match(/^#\s+(.+)$/m);
    if (headerMatch) {
      const name = headerMatch[1].trim();
      // 2行目以降で説明文を探す（空行を除く）
      const lines = normalizedText.split("\n").slice(1);
      let description = "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (
          trimmed &&
          !trimmed.startsWith("#") &&
          !trimmed.startsWith("Source:")
        ) {
          description = trimmed;
          break;
        }
      }
      return { name, description };
    }

    return { name: fallbackName, description: "" };
  } catch {
    return { name: fallbackName, description: "" };
  }
}

/**
 * SKILL.md ファイルからメタデータを抽出する
 * frontmatter の name, description, license, metadata.author, metadata.version を読み取る
 */
async function extractMetadataFromSkillMd(
  skillMdUri: vscode.Uri,
  fallbackName: string,
): Promise<{
  name: string;
  description: string;
  license?: string;
  author?: string;
  version?: string;
}> {
  try {
    const content = await vscode.workspace.fs.readFile(skillMdUri);
    const text = Buffer.from(content).toString("utf-8");
    const normalizedText = normalizeNewlines(text);

    // frontmatter を解析
    const frontmatterMatch = normalizedText.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];

      // name フィールドを抽出
      let name = fallbackName;
      const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
      if (nameMatch) {
        name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
      }

      // description を抽出
      const description = extractDescriptionFromFrontmatter(frontmatter);

      // license を抽出
      let license: string | undefined;
      const licenseMatch = frontmatter.match(/^license:\s*(.+)$/m);
      if (licenseMatch) {
        license = licenseMatch[1].trim().replace(/^["']|["']$/g, "");
      }

      // metadata セクションから author と version を抽出
      let author: string | undefined;
      let version: string | undefined;

      // metadata.author または author を抽出
      const authorMatch = frontmatter.match(/^\s*author:\s*(.+)$/m);
      if (authorMatch) {
        author = authorMatch[1].trim().replace(/^["']|["']$/g, "");
      }

      // metadata.version または version を抽出
      const versionMatch = frontmatter.match(/^\s*version:\s*(.+)$/m);
      if (versionMatch) {
        version = versionMatch[1].trim().replace(/^["']|["']$/g, "");
      }

      return { name, description, license, author, version };
    }

    return { name: fallbackName, description: "" };
  } catch {
    return { name: fallbackName, description: "" };
  }
}

/**
 * frontmatter から description を抽出
 */
function extractDescriptionFromFrontmatter(frontmatter: string): string {
  let description = "";

  // ダブルクォート対応
  const doubleQuoteMatch = frontmatter.match(
    /^description:\s*"([^"]*(?:""[^"]*)*)"/m,
  );
  if (doubleQuoteMatch) {
    description = doubleQuoteMatch[1].replace(/""/g, '"');
  }

  // シングルクォート対応
  if (!description) {
    const singleQuoteMatch = frontmatter.match(
      /^description:\s*'([^']*(?:''[^']*)*)'/m,
    );
    if (singleQuoteMatch) {
      description = singleQuoteMatch[1].replace(/''/g, "'");
    }
  }

  // クォートなし（1行）
  if (!description) {
    const plainMatch = frontmatter.match(/^description:\s*(.+)$/m);
    if (plainMatch) {
      description = plainMatch[1].trim();
    }
  }

  // 長い説明は切り詰める（AGENTS.md 用に短くする）
  const maxLength = 200;
  if (description.length > maxLength) {
    const periodIndex = description.indexOf("。");
    const dotIndex = description.indexOf(". ");
    const cutIndex =
      periodIndex !== -1 && periodIndex < maxLength
        ? periodIndex + 1
        : dotIndex !== -1 && dotIndex < maxLength
          ? dotIndex + 1
          : maxLength;

    description = description.substring(0, cutIndex).trim();
    if (description.length === maxLength) {
      description += "...";
    }
  }

  return description;
}

/**
 * SKILL.md ファイルから description を抽出する
 * frontmatter の description フィールドを読み取り、長い場合は切り詰める
 */
async function extractDescriptionFromSkillMd(
  skillMdUri: vscode.Uri,
): Promise<string> {
  try {
    const content = await vscode.workspace.fs.readFile(skillMdUri);
    const text = Buffer.from(content).toString("utf-8");
    const normalizedText = normalizeNewlines(text);

    // frontmatter を解析
    const frontmatterMatch = normalizedText.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return "";
    }

    return extractDescriptionFromFrontmatter(frontmatterMatch[1]);
  } catch {
    return "";
  }
}

/**
 * SKILL.md ファイルから "When to Use" セクションを抽出する
 * ## When to Use または ## いつ使うか などのセクションを検出し、内容を返す
 * セクションがない場合は、# タイトルの次の段落を使用
 */
/**
 * SKILL.md ファイルから "When to Use" セクションを抽出する
 * 箇条書き・テーブル・段落形式に対応
 */
async function extractWhenToUseFromSkillMd(
  skillMdUri: vscode.Uri,
): Promise<string> {
  try {
    const content = await vscode.workspace.fs.readFile(skillMdUri);
    const text = Buffer.from(content).toString("utf-8");
    return parseWhenToUseFromText(text);
  } catch {
    return "";
  }
}

/**
 * テキストから "When to Use" セクションを抽出する（純粋関数・テスト可能）
 * @param text SKILL.md のテキスト内容
 * @returns 抽出された When to Use 文字列（最大200文字）
 */
export function parseWhenToUseFromText(text: string): string {
  const normalizedText = normalizeNewlines(text);
  // "When to Use" セクションを検出（英語・日本語対応）
  // 終了条件: 次の ## セクション、--- 区切り、または EOF
  // m フラグを使わず \n## で行頭をマッチさせる（$ がマルチラインで各行末にマッチするのを防ぐ）
  const sectionMatch = normalizedText.match(
    /\n##\s*(When to Use|When To Use|いつ使うか|使用タイミング|Usage|使い方)\s*\n([\s\S]*?)(?=\n##\s|\n---\n|\n*$)/i,
  );

  let sectionContent = "";

  if (sectionMatch) {
    sectionContent = sectionMatch[2].trim();
  } else {
    // フォールバック: # タイトルの次の段落を抽出
    // frontmatter をスキップ
    let bodyText = normalizedText;
    const frontmatterMatch = normalizedText.match(/^---\n[\s\S]*?\n---\n*/);
    if (frontmatterMatch) {
      bodyText = normalizedText.substring(frontmatterMatch[0].length);
    }

    // # タイトル行を見つけて、その後の最初の段落を取得
    const lines = bodyText.split("\n");
    let foundTitle = false;
    const paragraphLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (!foundTitle) {
        // # で始まるタイトル行を探す
        if (/^#\s+/.test(trimmed)) {
          foundTitle = true;
        }
        continue;
      }

      // タイトル後の空行をスキップ
      if (!trimmed) {
        if (paragraphLines.length > 0) {
          // 段落が終わった
          break;
        }
        continue;
      }

      // 次のセクション（## など）に到達したら終了
      if (/^#/.test(trimmed)) {
        break;
      }

      // コードブロック、リスト等はスキップ
      if (/^```/.test(trimmed) || /^[-*]\s+\*\*/.test(trimmed)) {
        break;
      }

      paragraphLines.push(trimmed);

      // 最大2行まで
      if (paragraphLines.length >= 2) {
        break;
      }
    }

    sectionContent = paragraphLines.join(" ");
  }

  if (!sectionContent) {
    return "";
  }

  const lines = sectionContent.split("\n");
  const extractedItems: string[] = [];

  // テーブル形式かどうかを検出（| で始まる行があるか）
  const hasTableLines = lines.some((line) => line.trim().startsWith("|"));

  if (hasTableLines) {
    // テーブル形式の場合：各行の全セルを結合（"キー: 値" 形式）
    for (const line of lines) {
      const trimmed = line.trim();

      // テーブル行でない場合はスキップ
      if (!trimmed.startsWith("|")) {
        continue;
      }

      // セパレータ行をスキップ（|---|---| のパターン）
      if (/^\|[\s\-:]+\|/.test(trimmed) && !trimmed.match(/[a-zA-Z0-9]/)) {
        continue;
      }

      // セルを抽出
      const cells = trimmed
        .split("|")
        .map(
          (c) =>
            c
              .trim()
              .replace(/\*\*/g, "") // bold マーカーを除去
              .replace(/`([^`]+)`/g, "$1"), // インラインコードを除去
        )
        .filter((c) => c.length > 0);

      if (cells.length > 0) {
        const firstCell = cells[0];

        // ヘッダーっぽい行はスキップ（Action, Triggers, Pattern 等）
        if (
          /^(action|trigger|pattern|use case|when|scenario|situation)s?$/i.test(
            firstCell,
          )
        ) {
          continue;
        }

        // 全セルを結合（2列以上の場合は "キー: 値" 形式）
        let rowContent = "";
        if (cells.length >= 2) {
          // 最初のセルが短い場合はキーとして使用（例: "Create: New .agent.md, ..."）
          if (firstCell.length <= 20) {
            rowContent = `${firstCell}: ${cells.slice(1).join(", ")}`;
          } else {
            // 全セルをカンマで結合
            rowContent = cells.join(", ");
          }
        } else {
          rowContent = firstCell;
        }

        if (rowContent) {
          extractedItems.push(rowContent);
        }
      }
    }
  } else {
    // リスト形式または段落形式の場合
    for (const line of lines) {
      const trimmed = line.trim();

      // リスト項目を検出（- や * や 数字. で始まる行）
      if (/^[-*•]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        // マーカーを除去して内容のみ取得
        const itemContent = trimmed
          .replace(/^[-*•]\s+/, "")
          .replace(/^\d+\.\s+/, "")
          .replace(/\*\*([^*]+)\*\*/g, "$1"); // bold を除去
        extractedItems.push(itemContent);
      } else if (
        trimmed &&
        !trimmed.startsWith("#") &&
        extractedItems.length === 0
      ) {
        // 段落テキストの場合（リストがまだない場合）
        extractedItems.push(trimmed);
      }
    }
  }

  if (extractedItems.length === 0) {
    return "";
  }

  // 200文字以内で可能な限り多くの項目を結合
  const maxLength = 200;
  let result = "";
  let itemCount = 0;

  for (const item of extractedItems) {
    const separator = itemCount > 0 ? "; " : "";
    const candidate = result + separator + item;

    if (candidate.length <= maxLength) {
      result = candidate;
      itemCount++;
    } else if (itemCount === 0) {
      // 最初の項目すら入らない場合は切り詰め
      result = item.substring(0, maxLength - 3) + "...";
      break;
    } else {
      // これ以上入らないので終了
      break;
    }
  }

  return result;
}

/**
 * フォールバック SKILL.md を作成
 */
async function createFallbackSkillMd(
  skillPath: vscode.Uri,
  skill: Skill,
): Promise<void> {
  const content = `# ${skill.name}

${skill.description}

Source: ${skill.source}
`;
  const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
  await vscode.workspace.fs.writeFile(
    skillMdPath,
    Buffer.from(content, "utf-8"),
  );
}

/**
 * バグレポートを GitHub Issue として開く
 */
async function openBugReport(
  skill: Skill,
  source: Source | undefined,
  url: string,
  errorType: string,
  hasToken: boolean,
  resolvedBranch?: string,
): Promise<void> {
  const extensionVersion =
    vscode.extensions.getExtension("yamapan.agent-skill-ninja")?.packageJSON
      ?.version || "unknown";

  const repoUrl = source?.url || "unknown";
  const branch = resolvedBranch || source?.branch || "unknown";

  const issueTitle = `[Bug] Skill not found: ${skill.name}`;
  const issueBody =
    `**Issue**\n` +
    `Skill "${skill.name}" from source "${skill.source}" could not be downloaded.\n\n` +
    `**Error**\n` +
    `${errorType}\n\n` +
    `**Skill Details**\n` +
    `- Name: ${skill.name}\n` +
    `- Source ID: ${skill.source}\n` +
    `- Path: ${skill.path || "unknown"}\n` +
    `- Repository: ${repoUrl}\n` +
    `- Resolved Branch: ${branch}\n` +
    `- Failed URL: ${url}\n\n` +
    `**Environment**\n` +
    `- Extension Version: ${extensionVersion}\n` +
    `- VS Code: ${vscode.version}\n` +
    `- OS: ${process.platform}\n` +
    `- GitHub Authentication: ${hasToken ? "configured" : "not configured"}\n\n` +
    `**Possible Cause**\n` +
    buildSkillNotFoundPossibleCause(hasToken);

  const params = new URLSearchParams({
    title: issueTitle,
    body: issueBody,
  });
  const issueUrl = `https://github.com/aktsmm/vscode-agent-skill-ninja/issues/new?${params.toString()}`;
  await vscode.env.openExternal(vscode.Uri.parse(issueUrl));
}

/**
 * URL からファイル内容を取得
 */
async function fetchFileContent(url: string, token?: string): Promise<string> {
  const response = await fetchGitHubWithOptionalAuthRetry(url, {
    accept: "text/plain",
    token,
  });
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${response.statusText} (URL: ${url})`,
    );
  }
  // 空ファイル（例: Python の __init__.py）も正常なので、
  // HTTP 200 が返れば内容が空でもエラーにしない
  const text = await response.text();
  return text;
}
