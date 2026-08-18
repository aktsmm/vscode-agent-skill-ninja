// スキルインストール機能
// GitHub からスキルをダウンロードしてワークスペースに配置

import * as vscode from "vscode";
import * as path from "path";
import { Skill, loadSkillIndex, Source, getSourceBranch } from "./skillIndex";
import { encodeGitRef } from "./sourceRefs";
import { isJapanese, messages } from "./i18n";
import { getGitHubToken, hasStoredGitHubToken } from "./githubAuth";
import {
  needsRepair,
  normalizeInstalledSkillSource,
} from "./installedSkillIndex";
import {
  getManagedSkillRoots,
  resolveWorkspaceSkillsRootUri,
  type SkillRoot,
} from "./skillLocations";
import { fetchGitHubWithOptionalAuthRetry } from "./githubFetch";
import { buildIssueUrl } from "./issueReport";
import {
  classifyTransportError,
  containsHttpStatus,
  createGitHubResponseError,
  GitHubResponseError,
  isGitHubResponseError,
  type GitHubFailureKind,
} from "./githubResponse";
import {
  GitHubDirectoryEntry,
  partitionGitHubDirectoryEntries,
  resolveSymlinkTargetPath,
} from "./githubDirectoryTraversal";
import {
  isContainedPath,
  isRealPathStrictlyInside,
  isSafePathSegment,
  isSafeRemoteRepoPath,
  isStrictlyInsidePath,
  toSafeRelativeSegments,
} from "./pathSafety";
import { createHash } from "crypto";

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export type SkillInstallFailureKind =
  | GitHubFailureKind
  | "policy-limit"
  | "filesystem"
  | "cancelled"
  | "unknown";

export interface SkillInstallFailure {
  message: string;
  kind: SkillInstallFailureKind;
  path?: string;
}

/**
 * 再試行判定は message ではなく kind で行う。分類できない失敗は
 * "unknown" のままにして、決定論的な失敗を再試行対象へ紛れ込ませない。
 */
export function classifySkillInstallFailure(
  error: unknown,
): SkillInstallFailureKind {
  if (isGitHubResponseError(error)) {
    return error.kind;
  }

  // 中断による abort を一時障害と見なさない。realm をまたぐと
  // instanceof が効かないので name で判定する
  if ((error as { name?: unknown } | undefined)?.name === "AbortError") {
    return "cancelled";
  }

  if (
    typeof vscode.FileSystemError === "function" &&
    error instanceof vscode.FileSystemError
  ) {
    return "filesystem";
  }

  return classifyTransportError(error) ?? "unknown";
}

const RETRYABLE_INSTALL_FAILURE_KINDS: ReadonlySet<SkillInstallFailureKind> =
  new Set<SkillInstallFailureKind>(["server-error", "transport"]);

/** 不在だけを不在として扱う。権限エラーなどを含めない。 */
function isFileNotFoundError(error: unknown): boolean {
  const code = (error as { code?: unknown } | undefined)?.code;
  if (typeof code === "string") {
    return code === "FileNotFound" || code === "ENOENT";
  }

  // code を持たない実装だけ message で判定する
  const message = (error as { message?: unknown } | undefined)?.message;
  return (
    typeof message === "string" &&
    /\b(ENOENT|FileNotFound|EntryNotFound)\b/i.test(message)
  );
}

/**
 * 一時的な失敗だけを再試行する positive allowlist。
 * rate limit、認証、404、ポリシー上限、分類不能はここに入れない。
 */
export function isRetryableInstallFailure(
  failures: readonly SkillInstallFailure[],
): boolean {
  return (
    failures.length > 0 &&
    failures.every((failure) =>
      RETRYABLE_INSTALL_FAILURE_KINDS.has(failure.kind),
    )
  );
}

/**
 * 直前の試行が書いたプレースホルダーを実体と誤認しないため、
 * SKILL.md の存在ではなく中身で判定する。
 */
async function hasRealSkillMd(
  skillPath: vscode.Uri,
  skill: Pick<Skill, "source">,
): Promise<boolean> {
  try {
    const existing = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(skillPath, "SKILL.md"),
    );
    return !isFallbackSkillMd(
      Buffer.from(existing).toString("utf-8"),
      skill.source,
    );
  } catch {
    return false;
  }
}

/**
 * スキルフォルダを再帰削除する前に、対象がルート配下の真部分であることを確認する。
 * ルート自身や外部パスを消さないための最後の砦。
 *
 * `useTrash` は「ユーザーの唯一のコピーを消す削除」だけ true にする。
 * 未完了ダウンロードの後片付けまでごみ箱へ送ると、ごみ箱が残骸で埋まる。
 */
async function deleteSkillDirectory(
  skillsRootUri: vscode.Uri,
  skillPath: vscode.Uri,
  options: { useTrash: boolean } = { useTrash: false },
): Promise<void> {
  if (
    !isStrictlyInsidePath(skillsRootUri.fsPath, skillPath.fsPath) ||
    !isRealPathStrictlyInside(skillsRootUri.fsPath, skillPath.fsPath)
  ) {
    throw new Error(
      `Refusing to delete outside the skill root: ${skillPath.fsPath} (root: ${skillsRootUri.fsPath})`,
    );
  }
  await vscode.workspace.fs.delete(skillPath, {
    recursive: true,
    useTrash: options.useTrash,
  });
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
  interactive: boolean = true,
  cleanupUsesTrash: boolean = false,
): Promise<never> {
  try {
    // 新規ダウンロードの残骸なら直接削除。
    // 既存フォルダへ上書きしていた場合はユーザーのコピーなのでごみ箱へ
    await deleteSkillDirectory(skillsRootUri, skillPath, {
      useTrash: cleanupUsesTrash,
    });
  } catch {
    // 削除失敗は無視
  }

  // 一括実行はサマリで報告するので、スキルごとのダイアログで止めない
  if (!interactive) {
    throw new Error(`Skill not found: ${skill.name}`);
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
  signal?: AbortSignal,
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
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const response = await fetchGitHubWithOptionalAuthRetry(url, {
    accept: "application/vnd.github.v3+json",
    token,
    retry: { signal },
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    const failure = createGitHubResponseError(
      response,
      bodyText,
      `Failed to list directory ${normalizedPath}`,
    );
    if (response.status === 403) {
      throw new GitHubResponseError(
        failure.kind,
        failure.status,
        buildGitHub403Message(token),
        failure.resetAt,
      );
    }
    throw failure;
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
      signal,
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
  signal?: AbortSignal,
): Promise<GitHubDirectoryEntry[]> {
  return await listGitHubDirectoryInternal(
    owner,
    repo,
    path,
    branch,
    token,
    visitedPaths,
    signal,
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
  /** リトライ可否を message ではなく kind で判定するための構造化失敗一覧 */
  failures: SkillInstallFailure[];
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
  isCancelled: () => boolean = () => false,
  signal?: AbortSignal,
): Promise<DownloadDirectoryResult> {
  const errors: string[] = [];
  const failures: SkillInstallFailure[] = [];
  const skippedUnsafeEntries: string[] = [];

  const recordFailure = (
    message: string,
    kind: SkillInstallFailureKind,
    failurePath?: string,
  ) => {
    errors.push(message);
    failures.push({ message, kind, path: failurePath });
  };

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
    if (
      !isContainedPath(downloadRoot.fsPath, target.fsPath) ||
      // 既存のサブフォルダがルート外を指すリンクでも書き込まない
      !isRealPathStrictlyInside(downloadRoot.fsPath, target.fsPath)
    ) {
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
    const content = await fetchFileContent(entry.download_url, token, signal);
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
    undefined,
    signal,
  );
  console.log(`[Skill Ninja] Found ${entries.length} entries`);

  // ファイルとディレクトリを分離し、ファイルを先にダウンロード
  // （SKILL.md などの重要ファイルを確実に取得するため）
  const { files, directoriesToTraverse } =
    partitionGitHubDirectoryEntries(entries);

  // 1. ファイルを先にダウンロード
  for (const entry of files) {
    if (isCancelled()) {
      recordFailure(
        `Install cancelled before ${entry.name}`,
        "cancelled",
        remotePath,
      );
      return { errors, failures, skippedUnsafeEntries };
    }

    try {
      await downloadFileEntry(entry);
    } catch (error) {
      const msg = `Failed to download file ${entry.name}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[Skill Ninja] ${msg}`);
      recordFailure(msg, classifySkillInstallFailure(error), entry.name);
    }
  }

  // 2. サブディレクトリを再帰的にダウンロード（数の制限あり）
  if (directoriesToTraverse.length > MAX_SUBDIRECTORY_DOWNLOADS) {
    console.warn(
      `[Skill Ninja] Too many subdirectories (${directoriesToTraverse.length}), limiting to ${MAX_SUBDIRECTORY_DOWNLOADS}`,
    );
    recordFailure(
      `Skipped ${directoriesToTraverse.length - MAX_SUBDIRECTORY_DOWNLOADS} of ${directoriesToTraverse.length} subdirectories (limit: ${MAX_SUBDIRECTORY_DOWNLOADS})`,
      "policy-limit",
      remotePath,
    );
  }

  const dirsToDownload = directoriesToTraverse.slice(
    0,
    MAX_SUBDIRECTORY_DOWNLOADS,
  );

  for (const entry of dirsToDownload) {
    if (isCancelled()) {
      recordFailure(
        `Install cancelled before ${entry.name}`,
        "cancelled",
        remotePath,
      );
      return { errors, failures, skippedUnsafeEntries };
    }

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
        isCancelled,
        signal,
      );
      errors.push(...subResult.errors);
      failures.push(...subResult.failures);
      skippedUnsafeEntries.push(...subResult.skippedUnsafeEntries);
    } catch (error) {
      const msg = `Failed to download directory ${entry.name}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[Skill Ninja] ${msg}`);
      recordFailure(msg, classifySkillInstallFailure(error), entry.name);
      // サブディレクトリのエラーは致命的ではない - 続行
    }
  }

  return { errors, failures, skippedUnsafeEntries };
}

async function downloadPrimarySkillMd(
  owner: string,
  repo: string,
  branch: string,
  remotePath: string,
  localPath: vscode.Uri,
  token?: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const normalizedRemotePath = remotePath.replace(/^\/+|\/+$/g, "");
  if (!normalizedRemotePath || normalizedRemotePath.endsWith(".md")) {
    return false;
  }

  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeGitRef(branch)}/${normalizedRemotePath}/SKILL.md`;
  try {
    console.log(`[Skill Ninja] Trying primary SKILL.md fallback: ${rawUrl}`);
    const content = await fetchFileContent(rawUrl, token, signal);
    const skillMdPath = vscode.Uri.joinPath(localPath, "SKILL.md");
    await vscode.workspace.fs.writeFile(
      skillMdPath,
      Buffer.from(content, "utf-8"),
    );
    console.log(`[Skill Ninja] Saved primary SKILL.md fallback`);
    return true;
  } catch (error) {
    // 中断は「見つからなかった」ではないので、呼び出し側へそのまま返す
    if (classifySkillInstallFailure(error) === "cancelled") {
      throw error;
    }
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
  signal?: AbortSignal,
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
      const branch = await getSourceBranch(source, token, skill.path, signal);
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
  /** リトライ可否を判定するための構造化失敗一覧 */
  failures: SkillInstallFailure[];
  /**
   * 安全でない名前などで意図的に除外したリモートエントリ。
   * 転送失敗ではないので status を partial へ降格させないが、
   * 敵対的な配布元を無言で clean install に見せないため別途通知する。
   */
  skippedUnsafeEntries?: string[];
  /** 実際に書き込んだスキルルート（fsPath）。呼び出し側が再計算しないための SSOT。 */
  installedRoot: string;
  /** スキルルート直下の実フォルダ名。skill.name とは一致しないことがある。 */
  installedPath: string;
}

/**
 * Thrown when only placeholder content could be written, so callers that count
 * exceptions as failures never report an incomplete install as success.
 */
export class SkillInstallIncompleteError extends Error {
  constructor(
    public readonly skillName: string,
    public readonly errors: string[],
    public readonly failures: SkillInstallFailure[] = [],
  ) {
    super(`Skill install incomplete: ${skillName}`);
    this.name = "SkillInstallIncompleteError";
  }
}

/**
 * Thrown when the install folder is already owned by a different source, so a
 * same-named skill from another repository never silently overwrites it.
 */
export class SkillInstallTargetConflictError extends Error {
  constructor(
    public readonly skillName: string,
    public readonly folderName: string,
    public readonly existingSource: string,
    public readonly incomingSource: string,
  ) {
    super(
      messages.installTargetConflictBlocked(
        folderName,
        existingSource,
        incomingSource,
      ),
    );
    this.name = "SkillInstallTargetConflictError";
  }
}

async function readInstallTargetOwner(
  skillPath: vscode.Uri,
): Promise<{ exists: boolean; owner?: string }> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(skillPath);
  } catch (error) {
    // 不在以外の読み取り失敗（権限、provider 障害）を空き扱いしない
    if (!isFileNotFoundError(error)) {
      return { exists: true };
    }
    return { exists: false };
  }

  // 空フォルダは失敗した試行の残骸なので占有扱いしない
  if (entries.length === 0) {
    return { exists: false };
  }

  try {
    const raw = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(skillPath, ".skill-meta.json"),
    );
    const meta = JSON.parse(Buffer.from(raw).toString("utf-8")) as {
      source?: unknown;
      remotePath?: unknown;
    };
    return {
      exists: true,
      owner: normalizeInstalledSkillSource(
        typeof meta.source === "string" ? meta.source : undefined,
        typeof meta.remotePath === "string" ? meta.remotePath : undefined,
      ),
    };
  } catch {
    return { exists: true };
  }
}

/**
 * インストール先が別ソースのスキルに占有されていないか確認する。
 * 同名スキルは別リポジトリにも存在しうるため、所有者が違うときや
 * 所有者を確認できないときは、明示的な上書き同意なしに書き込まない。
 * 同意された場合だけ、呼び出し側へ既存フォルダの削除を指示する。
 */
async function ensureInstallTargetAvailable(
  skillPath: vscode.Uri,
  skill: Skill,
  folderName: string,
  incomingOwner: string,
  interactive: boolean,
  sources: Source[] = [],
): Promise<{ replaceExisting: boolean; existedBefore: boolean }> {
  const existing = await readInstallTargetOwner(skillPath);
  if (!existing.exists) {
    return { replaceExisting: false, existedBefore: false };
  }

  if (existing.owner?.toLowerCase() === incomingOwner.toLowerCase()) {
    return { replaceExisting: false, existedBefore: true };
  }

  const describeOwner = (ownerId: string): string =>
    sources.find((entry) => entry.id === ownerId)?.name || ownerId;
  const existingOwnerLabel = existing.owner
    ? describeOwner(existing.owner)
    : messages.installTargetUnknownOwner();
  const incomingOwnerLabel = describeOwner(incomingOwner);

  if (interactive) {
    const overwrite = messages.installTargetConflictOverwrite();
    const choice = await vscode.window.showWarningMessage(
      messages.installTargetConflictPrompt(
        folderName,
        existingOwnerLabel,
        incomingOwnerLabel,
      ),
      { modal: true },
      overwrite,
    );
    if (choice === overwrite) {
      // 既存コピーはごみ箱へ送ってから作り直すので、以後の後片付けは新規分だけ
      return { replaceExisting: true, existedBefore: false };
    }
  }

  throw new SkillInstallTargetConflictError(
    skill.name,
    folderName,
    existingOwnerLabel,
    incomingOwnerLabel,
  );
}

export async function installSkill(
  skill: Skill,
  workspaceUri: vscode.Uri,
  context: vscode.ExtensionContext,
  targetRoot?: SkillRoot,
  options?: {
    allowRetry?: boolean;
    interactive?: boolean;
    isCancelled?: () => boolean;
    /** 中断時に実行中の HTTP 取得ごと止める */
    signal?: AbortSignal;
  },
): Promise<SkillInstallResult> {
  if (targetRoot && (!targetRoot.isManaged || targetRoot.isReadOnly)) {
    throw new Error(
      `Cannot install into read-only skill root: ${targetRoot.rootPath}`,
    );
  }

  const downloadErrors: string[] = [];
  const downloadFailures: SkillInstallFailure[] = [];
  const skippedUnsafeEntries: string[] = [];
  let usedFallback = false;
  const interactive = options?.interactive !== false;

  const recordInstallFailure = (
    message: string,
    kind: SkillInstallFailureKind,
    failurePath?: string,
  ) => {
    downloadErrors.push(message);
    downloadFailures.push({ message, kind, path: failurePath });
  };

  const skillsRootUri = resolveSkillsRootUri(workspaceUri, targetRoot?.rootUri);

  // スキル名をサニタイズしてフォルダ名として使用
  const safeName = resolveSkillFolderName(skill);
  const skillPath = vscode.Uri.joinPath(skillsRootUri, safeName);
  if (
    !isStrictlyInsidePath(skillsRootUri.fsPath, skillPath.fsPath) ||
    !isRealPathStrictlyInside(skillsRootUri.fsPath, skillPath.fsPath)
  ) {
    throw new Error(
      `Refusing to install outside the skill root: ${skillPath.fsPath} (root: ${skillsRootUri.fsPath})`,
    );
  }

  // 所有者比較をメタデータ書き込み側と一致させるため、
  // index / token / ダウンロード先はフォルダ作成より前に解決する
  const index = await loadSkillIndex(context);
  const source = index.sources.find((s: Source) => s.id === skill.source);
  const token = await getGitHubToken();
  const downloadTarget = await resolveSkillDownloadTarget(
    skill,
    source,
    token,
    options?.signal,
  );
  const normalizedSourceId = inferInstalledSkillSourceId(
    skill,
    source,
    index.sources,
    downloadTarget,
  );

  const { replaceExisting, existedBefore } = await ensureInstallTargetAvailable(
    skillPath,
    skill,
    safeName,
    normalizedSourceId,
    interactive,
    index.sources,
  );
  // 既存フォルダへ上書きインストールする場合、後片付けはユーザーの唯一のコピーを消しうる
  const cleanupUsesTrash = existedBefore;
  if (replaceExisting) {
    // 上書き前の既存コピーが唯一の実体になりうるので、ここだけごみ箱経由にする
    await deleteSkillDirectory(skillsRootUri, skillPath, { useTrash: true });
  }
  await vscode.workspace.fs.createDirectory(skillPath);

  if (!downloadTarget) {
    // ソースがない場合はフォールバック
    usedFallback = true;
    recordInstallFailure(
      `Unable to resolve a download target for ${skill.name}`,
      "unknown",
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
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeGitRef(branch)}/${remotePath}`;
      if (options?.isCancelled?.()) {
        // 配布形式によらず、取得を始める前に中断を見る
        recordInstallFailure(
          `Install cancelled before ${remotePath}`,
          "cancelled",
          remotePath,
        );
      } else {
        console.log(`[Skill Ninja] Downloading single file: ${rawUrl}`);
        try {
          const content = await fetchFileContent(
            rawUrl,
            token,
            options?.signal,
          );
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
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          const failureKind = classifySkillInstallFailure(error);

          // 404エラーの場合はインストールをキャンセル（フォールバック作らない）
          if (failureKind === "not-found") {
            await handleSkillNotFound(
              skillsRootUri,
              skillPath,
              skill,
              source,
              rawUrl,
              token,
              branch,
              interactive,
              cleanupUsesTrash,
            );
          }

          // その他のエラーは不完全インストールとして記録し、後段でまとめて通知する
          usedFallback = true;
          // errorMsg は既に対象 URL を含むので、ここで重複させない
          recordInstallFailure(errorMsg, failureKind, remotePath);
          await createFallbackSkillMd(skillPath, skill);
        }
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
          0,
          skillPath,
          options?.isCancelled,
          options?.signal,
        );

        const cancelledDuringDownload = result.failures.some(
          (failure) => failure.kind === "cancelled",
        );

        // SKILL.md がなければ作成
        // 直前の試行が残したプレースホルダーは実体とみなさない
        // 中断後は新しい取得も書き込みも始めない
        if (
          !cancelledDuringDownload &&
          !(await hasRealSkillMd(skillPath, skill))
        ) {
          if (
            !(await downloadPrimarySkillMd(
              owner,
              repo,
              branch,
              remotePath,
              skillPath,
              token,
              options?.signal,
            ))
          ) {
            usedFallback = true;
            recordInstallFailure(
              `SKILL.md was not found under ${remotePath}`,
              "not-found",
              remotePath,
            );
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
          // 中断は階層ごとに記録されるので 1 件へ畳む
          let keptCancelled = false;
          for (const failure of result.failures) {
            if (failure.kind === "cancelled") {
              if (keptCancelled) {
                continue;
              }
              keptCancelled = true;
            }
            downloadFailures.push(failure);
          }
        }
        skippedUnsafeEntries.push(...result.skippedUnsafeEntries);
      } catch (error) {
        console.error(`[Skill Ninja] Failed to download directory:`, error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        const failureKind = classifySkillInstallFailure(error);

        // 中断後は回復用の取得も始めない
        const recoveredPrimarySkillMd =
          failureKind === "cancelled"
            ? false
            : await downloadPrimarySkillMd(
                owner,
                repo,
                branch,
                remotePath,
                skillPath,
                token,
                options?.signal,
              );
        if (recoveredPrimarySkillMd) {
          recordInstallFailure(errorMsg, failureKind, remotePath);
        } else if (failureKind === "not-found") {
          const repoTreeUrl = `https://github.com/${owner}/${repo}/tree/${branch}/${remotePath}`;
          await handleSkillNotFound(
            skillsRootUri,
            skillPath,
            skill,
            source,
            repoTreeUrl,
            token,
            branch,
            interactive,
            cleanupUsesTrash,
          );
        } else {
          // Don't overwrite SKILL.md with fallback if it was already downloaded
          const skillMdExists = await hasRealSkillMd(skillPath, skill);
          recordInstallFailure(errorMsg, failureKind, remotePath);
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

  // 中断で SKILL.md すら無いフォルダは走査に載らず修復対象から消えるので、
  // プレースホルダーだけ置いて「不完全」として見つかる状態にする
  if (
    downloadFailures.some((failure) => failure.kind === "cancelled") &&
    !(await hasRealSkillMd(skillPath, skill))
  ) {
    usedFallback = true;
    await createFallbackSkillMd(skillPath, skill);
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

  const status: SkillInstallStatus = usedFallback
    ? "incomplete"
    : downloadErrors.length > 0
      ? "partial"
      : "ok";

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
    // partial は再起動後も修復対象として残す必要があるので永続化する
    repairState:
      status === "incomplete"
        ? "fallback"
        : status === "partial"
          ? "partial"
          : undefined,
    ...derivePackageMetadata(skill.name, normalizedRemotePath, safeName),
  };
  await vscode.workspace.fs.writeFile(
    metaPath,
    Buffer.from(JSON.stringify(enrichSkillMeta(meta), null, 2), "utf-8"),
  );

  const result: SkillInstallResult = {
    status,
    name: skill.name,
    errors: downloadErrors,
    failures: downloadFailures,
    skippedUnsafeEntries:
      skippedUnsafeEntries.length > 0 ? skippedUnsafeEntries : undefined,
    installedRoot: skillsRootUri.fsPath,
    installedPath: safeName,
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
      interactive,
      cleanupUsesTrash,
    },
  );

  if (recovered) {
    return recovered;
  }

  if (result.status === "incomplete") {
    throw new SkillInstallIncompleteError(
      skill.name,
      result.errors,
      result.failures,
    );
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
    /** インストール前からあったフォルダなら、削除はユーザーのコピーを消すことになる */
    cleanupUsesTrash: boolean;
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
        { useTrash: options.cleanupUsesTrash },
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
    if (lower.includes("rate limit") || containsHttpStatus(error, 429)) {
      kinds.add("rate-limit");
    } else if (containsHttpStatus(error, 404)) {
      kinds.add("not-found");
    } else if (lower.includes("timeout")) {
      kinds.add("timeout");
    } else if (containsHttpStatus(error, 401, 403)) {
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

  const issueUrl = buildIssueUrl(
    "https://github.com/aktsmm/vscode-agent-skill-ninja/issues/new",
    issueTitle,
    issueBody,
  );
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

  let exactExists = true;
  try {
    await vscode.workspace.fs.stat(skillPath);
  } catch {
    exactExists = false;
  }

  if (!exactExists && candidates[1] && candidates[1] !== candidates[0]) {
    // サニタイズ名は別スキルやユーザー作成フォルダと衝突しうる。
    // 実在するフォルダを消すのは、メタデータが同じスキルだと証明できるときだけ
    const fallbackPath = vscode.Uri.joinPath(skillsPath, candidates[1]);
    let fallbackExists = true;
    try {
      await vscode.workspace.fs.stat(fallbackPath);
    } catch {
      fallbackExists = false;
    }

    if (fallbackExists) {
      const fallbackOwner = await readInstalledSkillMetaName(fallbackPath);
      if (fallbackOwner !== skillName) {
        throw new Error(
          `Refusing to delete ${JSON.stringify(candidates[1])}: it does not record skill ${JSON.stringify(skillName)}`,
        );
      }
    }
    skillPath = fallbackPath;
  }

  try {
    await deleteSkillDirectory(skillsPath, skillPath, { useTrash: true });
  } catch (error) {
    throw new Error(`Failed to delete skill directory: ${error}`);
  }
}

async function readInstalledSkillMetaName(
  skillPath: vscode.Uri,
): Promise<string | undefined> {
  try {
    const raw = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(skillPath, ".skill-meta.json"),
    );
    const meta = JSON.parse(Buffer.from(raw).toString("utf-8")) as {
      name?: unknown;
    };
    return typeof meta.name === "string" ? meta.name : undefined;
  } catch {
    return undefined;
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
    await deleteSkillDirectory(basePath, skillPath, { useTrash: true });
  } catch (error) {
    throw new Error(`Failed to delete skill directory: ${error}`);
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
  /**
   * 修復が必要な状態。新規書き込みではこちらが正本で、`incomplete` は
   * 旧バージョンで書かれたメタデータを読むための互換入力として残す。
   */
  repairState?: "fallback" | "partial";
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
 * 同名スキルが複数ルートに存在しうるので、root を保ったまま返す。
 *
 * `incomplete` / `repairState` を持たない旧バージョンの検出には SKILL.md 本文の
 * 読み込みが要るため、起動時のように毎回走らせたくない経路では
 * `includeLegacyContentScan: false` でメタデータだけを見る。
 */
export async function findIncompleteInstalledSkills(
  workspaceUri: vscode.Uri,
  options: {
    includeLegacyContentScan?: boolean;
    onContentReadError?: () => void;
  } = {},
): Promise<ManagedInstalledSkill[]> {
  const includeLegacyContentScan = options.includeLegacyContentScan !== false;
  const entries = await getManagedInstalledSkillsWithMeta(workspaceUri);
  const incompleteEntries: ManagedInstalledSkill[] = [];

  for (const entry of entries) {
    const { root, meta } = entry;
    if (needsRepair(meta)) {
      incompleteEntries.push(entry);
      continue;
    }

    if (!includeLegacyContentScan) {
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
        incompleteEntries.push(entry);
      }
    } catch {
      // 読めない SKILL.md はここでは判定しない
      options.onContentReadError?.();
    }
  }

  return incompleteEntries;
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

  const issueUrl = buildIssueUrl(
    "https://github.com/aktsmm/vscode-agent-skill-ninja/issues/new",
    issueTitle,
    issueBody,
  );
  await vscode.env.openExternal(vscode.Uri.parse(issueUrl));
}

/**
 * URL からファイル内容を取得
 */
async function fetchFileContent(
  url: string,
  token?: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetchGitHubWithOptionalAuthRetry(url, {
    accept: "text/plain",
    token,
    // 中断時に実行中の取得と retry 待機をその場で止める
    retry: { signal },
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw createGitHubResponseError(
      response,
      bodyText,
      `Failed to download ${url}`,
    );
  }
  // 空ファイル（例: Python の __init__.py）も正常なので、
  // HTTP 200 が返れば内容が空でもエラーにしない
  const text = await response.text();
  return text;
}
