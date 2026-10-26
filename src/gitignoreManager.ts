import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import type * as vscode from "vscode";

export const GITIGNORE_SETTING = "autoManageGitignore";
export const GITIGNORE_LOCK_NAME = ".gitignore.agent-ninja.lock";
export const SKILLS_IGNORE_OWNER = "Agent Skills Ninja";

export interface GitignoreSyncResult {
  status: "updated" | "unchanged" | "skipped" | "failed";
  managedBlock?: boolean;
  reason?:
    | "out-of-scope"
    | "missing"
    | "busy"
    | "invalid-metadata"
    | "invalid-block"
    | "dirty"
    | "changed"
    | "unsafe-path"
    | "limit"
    | "io-failure";
  warning?: "cleanup-failed";
}

const syncObservers = new Set<
  (root: vscode.Uri, result: GitignoreSyncResult) => void
>();

export function observeGitignoreSynchronization(
  observer: (root: vscode.Uri, result: GitignoreSyncResult) => void,
): () => void {
  syncObservers.add(observer);
  return () => {
    syncObservers.delete(observer);
  };
}

function describeFailure(
  error: unknown,
  phase: "read" | "scan" | "write",
): GitignoreSyncResult["reason"] {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "EEXIST") {
    return "busy";
  }
  const message = error instanceof Error ? error.message : "";
  if (message === "Ignore file has unsaved changes") {
    return "dirty";
  }
  if (message === "Invalid managed ignore block") {
    return "invalid-block";
  }
  if (message.includes("changed during")) {
    return "changed";
  }
  if (message.includes("limit exceeded")) {
    return "limit";
  }
  if (
    message.startsWith("Unsafe") ||
    message === "Skill root outside workspace"
  ) {
    return "unsafe-path";
  }
  if (phase === "scan") {
    return classifyScanFailure(error);
  }
  return "io-failure";
}

const TRANSIENT_FS_CODES = new Set([
  "ENOENT",
  "EBUSY",
  "EPERM",
  "EACCES",
  "ENOTEMPTY",
]);

// 別 realm（vm など）で作られた Error でも判定できるよう、instanceof を使わない
function readErrorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : "";
}

function isInvalidMetadataError(error: unknown): boolean {
  const message = readErrorMessage(error);
  return (
    (error as { name?: unknown } | null)?.name === "SyntaxError" ||
    message === "Invalid skill metadata" ||
    message === "Invalid skill identity"
  );
}

/**
 * 走査中の失敗の分類。メタデータの中身が不正なときだけ invalid-metadata にし、
 * 走査中にフォルダーが消えた・ロックされたなどのファイル操作の失敗は io-failure にする。
 */
export function classifyScanFailure(
  error: unknown,
): GitignoreSyncResult["reason"] {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code && TRANSIENT_FS_CODES.has(code)) {
    return "io-failure";
  }
  return isInvalidMetadataError(error) ? "invalid-metadata" : "io-failure";
}

/**
 * インストールや一括適用が同じフォルダーへ書き込んでいる最中は、メタデータが
 * 空・書きかけだったり、フォルダーが入れ替わったりする。書き込みが終われば解消するので、
 * 内容の不正やファイル操作の失敗は短く待って数回だけ走査し直す。
 */
const SCAN_ATTEMPTS = 5;

function isTransientScanError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code && TRANSIENT_FS_CODES.has(code)) {
    return true;
  }
  return (
    isInvalidMetadataError(error) ||
    readErrorMessage(error).includes("changed during")
  );
}

async function collectSkillIgnoreEntriesWithRetry(
  rootPath: string,
): Promise<IgnoreEntry[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await collectSkillIgnoreEntries(rootPath);
    } catch (error) {
      if (attempt >= SCAN_ATTEMPTS || !isTransientScanError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
}

export interface IgnoreEntry {
  relativePath: string;
  external: boolean;
  metadata: boolean;
}

const FAILURE_TEXT: Record<
  NonNullable<GitignoreSyncResult["reason"]>,
  { ja: string; en: string }
> = {
  "out-of-scope": {
    ja: "対象外のフォルダーです",
    en: "the folder is out of scope",
  },
  missing: { ja: "フォルダーが見つかりません", en: "the folder is missing" },
  busy: {
    ja: `ロックファイル（${GITIGNORE_LOCK_NAME}）が残っているか、他の処理が使用中です。他の VS Code ウィンドウや Agent Resources Ninja が動いていないことを確認し、残っている場合だけ手動で削除してください`,
    en: `the lock file (${GITIGNORE_LOCK_NAME}) is left behind or in use. Make sure no other VS Code window or Agent Resources Ninja is running, and delete it manually only if it remains`,
  },
  "invalid-metadata": {
    ja: ".skill-meta.json が壊れているか、name / source がありません",
    en: ".skill-meta.json is corrupt or lacks name / source",
  },
  "invalid-block": {
    ja: ".gitignore の Agent Skills Ninja ブロック（START / END）が壊れています",
    en: "the Agent Skills Ninja block (START / END) in .gitignore is corrupt",
  },
  dirty: {
    ja: ".gitignore に未保存の変更があります。保存または破棄してください",
    en: ".gitignore has unsaved changes. Save or discard them",
  },
  changed: {
    ja: "同期中に .gitignore が変更されました",
    en: ".gitignore changed during synchronization",
  },
  "unsafe-path": {
    ja: "スキルフォルダーが symlink / junction か、ワークスペース外を指しています",
    en: "the skill folder is a symlink / junction or points outside the workspace",
  },
  limit: {
    ja: "スキルの走査上限を超えました",
    en: "the skill scan limit was exceeded",
  },
  "io-failure": {
    ja: "ファイルの読み書きに失敗しました（権限や OneDrive などの同期ロックの可能性）",
    en: "reading or writing a file failed (permissions or a sync lock such as OneDrive)",
  },
};

/**
 * 通知に原因と対象を出すための文言。cleanup は管理ブロックを外す側の失敗で、
 * 失敗すると除外設定が .gitignore に残るため、同期失敗とは別の言い方にする。
 */
export function formatGitignoreFailure(
  result: GitignoreSyncResult,
  options: { rootLabel: string; japanese: boolean; cleanup: boolean },
): string {
  const lang = options.japanese ? "ja" : "en";
  const parts: string[] = [];
  if (result.reason) {
    parts.push(FAILURE_TEXT[result.reason][lang]);
  }
  if (result.warning === "cleanup-failed") {
    parts.push(
      options.japanese
        ? "一時ファイルまたはロックを削除できませんでした。以降の同期がブロックされる場合があります"
        : "a temporary file or lock could not be removed, which may block later synchronization",
    );
  }
  const cause = parts.join(options.japanese ? "。" : "; ");
  if (options.japanese) {
    return options.cleanup
      ? `Gitignore の管理ブロックを外せませんでした（${options.rootLabel}）。除外設定が .gitignore に残っている可能性があります。原因: ${cause}。スキルのインストール結果とは別の問題です。`
      : `Gitignore の同期を完了できませんでした（${options.rootLabel}）。原因: ${cause}。スキルのインストール結果とは別の問題です。`;
  }
  return options.cleanup
    ? `Could not remove the managed Gitignore block (${options.rootLabel}); exclusions may remain in .gitignore. Cause: ${cause}. This is separate from the skill installation result.`
    : `Gitignore synchronization could not finish (${options.rootLabel}). Cause: ${cause}. This is separate from the skill installation result.`;
}

export function escapeIgnorePath(relativePath: string): string {
  const segments = relativePath.split("/");
  if (
    segments.some(
      (segment) => !segment || segment === "." || segment === "..",
    ) ||
    /[\r\n\0\\]/.test(relativePath)
  ) {
    throw new Error("Invalid ignore path");
  }
  return relativePath.replace(/[!*?[\]# ]/g, "\\$&");
}

export function buildSkillIgnorePatterns(entries: IgnoreEntry[]): string[] {
  const patterns = new Set<string>();
  const localAncestors = new Set<string>();
  for (const entry of entries) {
    if (entry.external) {
      continue;
    }
    const segments = entry.relativePath.split("/");
    for (let depth = 1; depth < segments.length; depth++) {
      localAncestors.add(segments.slice(0, depth).join("/"));
    }
  }
  for (const entry of entries) {
    const escaped = escapeIgnorePath(entry.relativePath);
    const containsLocalSkill = localAncestors.has(entry.relativePath);
    if (entry.external && !containsLocalSkill) {
      patterns.add(`/${escaped}/`);
    } else if (entry.metadata) {
      patterns.add(`/${escaped}/.skill-meta.json`);
    }
  }
  if (patterns.size > 0) {
    patterns.add(`/${GITIGNORE_LOCK_NAME}`);
    patterns.add("/.gitignore.agent-ninja-*.tmp");
  }
  return [...patterns].sort();
}

export function updateIgnoreBlock(
  content: string,
  patterns: string[],
  owner: "Agent Skills Ninja" | "Agent Resources Ninja" = SKILLS_IGNORE_OWNER,
): string {
  const start = `# ${owner} START`;
  const end = `# ${owner} END`;
  const lines = [...content.matchAll(/[^\r\n]*(?:\r\n|\n|$)/g)].filter(
    (match) => match[0].length > 0,
  );
  let activeOwner: string | undefined;
  const seenOwners = new Set<string>();
  for (const line of lines) {
    const marker = line[0]
      .replace(/^\uFEFF/, "")
      .trimEnd()
      .match(/^# (Agent Skills Ninja|Agent Resources Ninja) (START|END)$/);
    if (!marker) {
      continue;
    }
    const [, markerOwner, boundary] = marker;
    if (boundary === "START") {
      if (activeOwner || seenOwners.has(markerOwner)) {
        throw new Error("Invalid managed ignore block");
      }
      seenOwners.add(markerOwner);
      activeOwner = markerOwner;
    } else {
      if (activeOwner !== markerOwner) {
        throw new Error("Invalid managed ignore block");
      }
      activeOwner = undefined;
    }
  }
  if (activeOwner) {
    throw new Error("Invalid managed ignore block");
  }
  const starts = lines.filter(
    (match) => match[0].replace(/^\uFEFF/, "").trimEnd() === start,
  );
  const ends = lines.filter((match) => match[0].trimEnd() === end);
  if (
    starts.length !== ends.length ||
    starts.length > 1 ||
    (starts.length === 1 && starts[0].index! >= ends[0].index!)
  ) {
    throw new Error("Invalid managed ignore block");
  }
  if (patterns.some((pattern) => /[\r\n\0]/.test(pattern))) {
    throw new Error("Invalid ignore pattern");
  }
  const eol = content.match(/\r\n|\n/)?.[0] || "\n";
  const block = patterns.length
    ? [start, ...new Set(patterns), end].join(eol)
    : "";
  if (starts.length === 1) {
    const from = starts[0].index! + (starts[0][0].startsWith("\uFEFF") ? 1 : 0);
    const to = ends[0].index! + ends[0][0].length;
    const suffix = ends[0][0].endsWith("\n") ? eol : "";
    return (
      content.slice(0, from) + (block ? block + suffix : "") + content.slice(to)
    );
  }
  if (!block) {
    return content;
  }
  const separator = content
    ? content.endsWith(eol + eol)
      ? ""
      : content.endsWith("\n")
        ? eol
        : eol + eol
    : "";
  return content + separator + block + eol;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export async function collectSkillIgnoreEntries(
  rootPath: string,
): Promise<IgnoreEntry[]> {
  const entries: IgnoreEntry[] = [];
  let visited = 0;
  async function visit(
    directory: string,
    relativePath: string,
    depth: number,
  ): Promise<void> {
    if (++visited > 10000 || depth > 32) {
      throw new Error("Skill scan limit exceeded");
    }
    if ((await fs.realpath(directory)) !== directory) {
      throw new Error("Skill directory changed during scan");
    }
    const children = await fs.readdir(directory, { withFileTypes: true });
    if (relativePath) {
      const metadataFile = children.find(
        (child) => child.name === ".skill-meta.json",
      );
      const hasSkill = children.some(
        (child) => child.name === "SKILL.md" && child.isFile(),
      );
      let external = false;
      if (metadataFile) {
        if (!metadataFile.isFile() || metadataFile.isSymbolicLink()) {
          throw new Error("Unsafe skill metadata");
        }
        const metadataPath = path.join(directory, ".skill-meta.json");
        const metadataStat = await fs.lstat(metadataPath);
        if (
          !metadataStat.isFile() ||
          metadataStat.isSymbolicLink() ||
          metadataStat.size > 1024 * 1024
        ) {
          throw new Error("Skill metadata limit exceeded");
        }
        const meta: unknown = JSON.parse(
          await fs.readFile(metadataPath, "utf8"),
        );
        const currentMetadataStat = await fs.lstat(metadataPath);
        if (
          currentMetadataStat.isSymbolicLink() ||
          !sameFile(metadataStat, currentMetadataStat)
        ) {
          throw new Error("Skill metadata changed during scan");
        }
        if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
          throw new Error("Invalid skill metadata");
        }
        const identity = meta as {
          name?: unknown;
          source?: unknown;
          remotePath?: unknown;
        };
        if (
          typeof identity.name !== "string" ||
          typeof identity.source !== "string"
        ) {
          throw new Error("Invalid skill identity");
        }
        const source = identity.source.trim();
        external =
          (source !== "" && source !== "local" && source !== "unknown") ||
          (typeof identity.remotePath === "string" &&
            identity.remotePath.trim() !== "");
      }
      if (hasSkill || metadataFile) {
        entries.push({ relativePath, external, metadata: !!metadataFile });
      }
    }
    for (const child of children) {
      const childRelativePath = relativePath
        ? `${relativePath}/${child.name}`
        : child.name;
      if (
        child.isSymbolicLink() ||
        child.name === ".git" ||
        child.name.startsWith(".skill-update-")
      ) {
        entries.push({
          relativePath: childRelativePath,
          external: false,
          metadata: false,
        });
      } else if (child.isDirectory()) {
        await visit(
          path.join(directory, child.name),
          childRelativePath,
          depth + 1,
        );
      }
    }
  }
  await visit(rootPath, "", 0);
  return entries;
}

function sameFile(
  before: import("fs").Stats,
  after: import("fs").Stats,
): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.mtimeMs === after.mtimeMs &&
    before.size === after.size &&
    before.mode === after.mode
  );
}

function normalizePath(filePath: string): string {
  const normalized = path.resolve(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function assertNoDirtyIgnore(
  workspace: Pick<typeof vscode.workspace, "textDocuments">,
  ignorePath: string,
): Promise<void> {
  for (const document of workspace.textDocuments || []) {
    if (!document.isDirty || document.uri.scheme !== "file") {
      continue;
    }
    let documentPath = document.uri.fsPath;
    try {
      documentPath = await fs.realpath(documentPath);
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
    if (normalizePath(documentPath) === normalizePath(ignorePath)) {
      throw new Error("Ignore file has unsaved changes");
    }
  }
}

export async function synchronizeSkillGitignore(
  rootUri: vscode.Uri,
  workspace: Pick<
    typeof vscode.workspace,
    "getWorkspaceFolder" | "getConfiguration" | "isTrusted" | "textDocuments"
  >,
  options?: { removeBlock?: boolean },
): Promise<GitignoreSyncResult> {
  const folder = workspace.getWorkspaceFolder?.(rootUri);
  if (
    !folder ||
    rootUri.scheme !== "file" ||
    workspace.isTrusted === false ||
    !isInside(folder.uri.fsPath, rootUri.fsPath)
  ) {
    return { status: "skipped", reason: "out-of-scope" };
  }
  if (
    path
      .relative(folder.uri.fsPath, rootUri.fsPath)
      .split(path.sep)
      .some((segment) => segment.startsWith(".skill-update-"))
  ) {
    return { status: "skipped", reason: "out-of-scope" };
  }
  let lock: fs.FileHandle | undefined;
  let lockPath: string | undefined;
  let lockStat: import("fs").Stats | undefined;
  let tempPath: string | undefined;
  let phase: "read" | "scan" | "write" = "read";
  let result: GitignoreSyncResult = { status: "unchanged" };
  try {
    const rootStat = await fs.lstat(rootUri.fsPath);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error("Unsafe skill root");
    }
    const realRoot = await fs.realpath(rootUri.fsPath);
    const realWorkspace = await fs.realpath(folder.uri.fsPath);
    if (!isInside(realWorkspace, realRoot)) {
      throw new Error("Skill root outside workspace");
    }
    lockPath = path.join(realRoot, GITIGNORE_LOCK_NAME);
    for (let attempt = 0; attempt < 25; attempt++) {
      try {
        lock = await fs.open(lockPath, "wx");
        lockStat = await fs.lstat(lockPath);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const transientLock =
          code === "EEXIST" ||
          (process.platform === "win32" &&
            (code === "EACCES" || code === "EPERM"));
        if (!transientLock || attempt === 24) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    const ignorePath = path.join(realRoot, ".gitignore");
    await assertNoDirtyIgnore(workspace, ignorePath);
    let original = Buffer.alloc(0);
    let originalStat: import("fs").Stats | undefined;
    try {
      const stat = await fs.lstat(ignorePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
        throw new Error("Unsafe ignore file");
      }
      original = await fs.readFile(ignorePath);
      originalStat = stat;
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
    const content = original.toString("utf8");
    if (!Buffer.from(content, "utf8").equals(original)) {
      throw new Error("Invalid ignore encoding");
    }
    const enabled =
      !options?.removeBlock &&
      workspace
        .getConfiguration("skillNinja", rootUri)
        .get<boolean>(GITIGNORE_SETTING, true);
    phase = "scan";
    const patterns = enabled
      ? buildSkillIgnorePatterns(
          await collectSkillIgnoreEntriesWithRetry(realRoot),
        )
      : [];
    phase = "read";
    const updated = updateIgnoreBlock(content, patterns);
    result.managedBlock = patterns.length > 0;
    if (updated !== content) {
      phase = "write";
      const candidateTempPath = path.join(
        realRoot,
        `.gitignore.agent-ninja-${randomUUID()}.tmp`,
      );
      const temporary = await fs.open(
        candidateTempPath,
        "wx",
        originalStat?.mode,
      );
      tempPath = candidateTempPath;
      try {
        await temporary.writeFile(updated, "utf8");
        await temporary.sync();
      } finally {
        await temporary.close();
      }
      let current = Buffer.alloc(0);
      let currentStat: import("fs").Stats | undefined;
      try {
        currentStat = await fs.lstat(ignorePath);
        if (!currentStat.isFile() || currentStat.isSymbolicLink()) {
          throw new Error("Unsafe ignore file");
        }
        current = await fs.readFile(ignorePath);
      } catch (error) {
        if (!isMissing(error)) {
          throw error;
        }
      }
      if (
        !current.equals(original) ||
        Boolean(currentStat) !== Boolean(originalStat) ||
        (originalStat && currentStat && !sameFile(originalStat, currentStat))
      ) {
        throw new Error("Ignore file changed during synchronization");
      }
      await assertNoDirtyIgnore(workspace, ignorePath);
      await fs.rename(tempPath, ignorePath);
      tempPath = undefined;
      result = { status: "updated", managedBlock: patterns.length > 0 };
    }
  } catch (error) {
    if (isMissing(error) && !lock) {
      result = { status: "skipped", reason: "missing" };
    } else {
      result = { status: "failed", reason: describeFailure(error, phase) };
      console.warn(
        `[Skill Ninja] Gitignore synchronization failed (${result.reason}).`,
      );
    }
  } finally {
    if (tempPath) {
      try {
        await fs.unlink(tempPath);
      } catch {
        result.warning = "cleanup-failed";
        console.warn("[Skill Ninja] Gitignore temporary cleanup failed.");
      }
    }
    if (lock && lockPath) {
      try {
        await lock.close();
        const currentLockStat = await fs.lstat(lockPath);
        if (
          !lockStat ||
          currentLockStat.isSymbolicLink() ||
          !sameFile(lockStat, currentLockStat)
        ) {
          result.warning = "cleanup-failed";
          console.warn(
            "[Skill Ninja] Gitignore lock ownership changed; the replacement lock was preserved.",
          );
        } else {
          await fs.unlink(lockPath);
        }
      } catch {
        result.warning = "cleanup-failed";
        console.warn(
          "[Skill Ninja] Gitignore lock cleanup failed; synchronization remains blocked.",
        );
      }
    }
  }
  for (const observer of syncObservers) {
    try {
      observer(rootUri, result);
    } catch {
      console.warn("[Skill Ninja] Gitignore feedback failed.");
    }
  }
  return result;
}

export async function reconcileSkillGitignores(
  currentRoots: vscode.Uri[],
  previousRoots: vscode.Uri[],
  workspace: Parameters<typeof synchronizeSkillGitignore>[1],
): Promise<vscode.Uri[]> {
  const current = new Map(
    currentRoots.map((root) => [normalizePath(root.fsPath), root]),
  );
  const retained = new Map(current);
  for (const root of current.values()) {
    await synchronizeSkillGitignore(root, workspace);
  }
  for (const root of previousRoots) {
    const key = normalizePath(root.fsPath);
    if (current.has(key)) {
      continue;
    }
    const result = await synchronizeSkillGitignore(root, workspace, {
      removeBlock: true,
    });
    if (
      result.status === "failed" ||
      result.warning ||
      result.reason === "out-of-scope"
    ) {
      retained.set(key, root);
    }
  }
  return [...retained.values()];
}

export function createGitignoreInventory(deps: {
  initialRoots: vscode.Uri[];
  currentRoots(): vscode.Uri[];
  reconcile(
    current: vscode.Uri[],
    previous: vscode.Uri[],
  ): Promise<vscode.Uri[]>;
  save(roots: vscode.Uri[]): PromiseLike<void>;
  onFailure(): void;
}) {
  let roots = new Map(
    deps.initialRoots.map((root) => [normalizePath(root.fsPath), root]),
  );
  let queue: Promise<void> = Promise.resolve();
  function enqueue(operation: () => Promise<void>): Promise<void> {
    queue = queue.then(operation).catch(() => {
      deps.onFailure();
    });
    return queue;
  }
  return {
    remember(root: vscode.Uri): Promise<void> {
      return enqueue(async () => {
        const key = normalizePath(root.fsPath);
        roots.set(key, root);
        const current = deps.currentRoots();
        if (
          !current.some((candidate) => normalizePath(candidate.fsPath) === key)
        ) {
          const reconciled = await deps.reconcile(current, [...roots.values()]);
          roots = new Map(
            reconciled.map((candidate) => [
              normalizePath(candidate.fsPath),
              candidate,
            ]),
          );
        }
        await deps.save([...roots.values()]);
      });
    },
    synchronize(): Promise<void> {
      return enqueue(async () => {
        const reconciled = await deps.reconcile(deps.currentRoots(), [
          ...roots.values(),
        ]);
        roots = new Map(
          reconciled.map((root) => [normalizePath(root.fsPath), root]),
        );
        await deps.save([...roots.values()]);
      });
    },
  };
}
