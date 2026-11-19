import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import * as path from "path";
import type * as vscode from "vscode";
import { isContainedPath, isStrictlyInsidePath } from "./pathSafety";

type RecoveryContext = Pick<vscode.ExtensionContext, "globalStorageUri">;

export interface SkillUpdateRecoveryRecord {
  version: 1;
  id: string;
  processId: number;
  startedAt: string;
  rootPath: string;
  targetPath: string;
  canonicalTargetPath: string;
  transactionPath: string;
  backupPath: string;
}

const activeRecords = new Set<string>();
const RECORD_FILE = "record.json";
const RECORD_DIRECTORY = "skill-update-recovery-v1";
const MAX_RECORD_BYTES = 16 * 1024;
const MAX_RECORDS = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECORD_KEY = /^[0-9a-f]{64}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export class SkillUpdateRecoveryRequiredError extends Error {
  constructor(readonly backupPath: string) {
    super("Skill update recovery required; review local details before another update");
  }
}

export class SkillUpdateRecoveryStoreError extends Error {
  constructor(readonly reason: "unavailable" | "inside-root" = "unavailable") {
    super("Skill update recovery records cannot be safely read or written");
  }
}

export class SkillUpdateRecoveryInUseError extends Error {
  constructor() {
    super("The recorded update process may still be running");
  }
}

export class SkillUpdateRecoveryTargetMissingError extends Error {
  constructor() {
    super("The installed skill must be restored before resolving recovery");
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function normalized(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function recordKey(canonicalTargetPath: string): string {
  return createHash("sha256").update(normalized(canonicalTargetPath)).digest("hex");
}

function isSafeAbsolutePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 8192 &&
    path.isAbsolute(value) &&
    !CONTROL_CHARACTERS.test(value)
  );
}

export async function canonicalPath(filePath: string): Promise<string> {
  let current = path.resolve(filePath);
  const suffix: string[] = [];
  for (;;) {
    try {
      return path.resolve(await fs.realpath(current), ...suffix);
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw error;
      }
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

function overlaps(left: string, right: string): boolean {
  return isContainedPath(left, right) || isContainedPath(right, left);
}

export function getSkillRecoveryDirectory(context: RecoveryContext): string {
  const storage = context.globalStorageUri;
  if (
    !storage ||
    (storage.scheme !== "file" && storage.scheme !== "vscode-userdata") ||
    !isSafeAbsolutePath(storage.fsPath)
  ) {
    throw new SkillUpdateRecoveryStoreError();
  }
  return path.join(storage.fsPath, RECORD_DIRECTORY);
}

function validRecord(
  value: unknown,
  key: string,
): value is SkillUpdateRecoveryRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<SkillUpdateRecoveryRecord>;
  return (
    record.version === 1 &&
    typeof record.id === "string" &&
    UUID.test(record.id) &&
    Number.isSafeInteger(record.processId) &&
    (record.processId ?? 0) > 0 &&
    typeof record.startedAt === "string" &&
    Number.isFinite(Date.parse(record.startedAt)) &&
    isSafeAbsolutePath(record.rootPath) &&
    isSafeAbsolutePath(record.targetPath) &&
    isSafeAbsolutePath(record.canonicalTargetPath) &&
    isSafeAbsolutePath(record.transactionPath) &&
    isSafeAbsolutePath(record.backupPath) &&
    isStrictlyInsidePath(record.rootPath, record.targetPath) &&
    normalized(path.dirname(record.transactionPath)) ===
      normalized(record.rootPath) &&
    /^\.skill-update-[0-9a-f-]{36}$/i.test(
      path.basename(record.transactionPath),
    ) &&
    normalized(record.backupPath) ===
      normalized(path.join(record.transactionPath, "backup")) &&
    recordKey(record.canonicalTargetPath) === key
  );
}

async function readRecord(
  directory: string,
  key: string,
): Promise<SkillUpdateRecoveryRecord | undefined> {
  const recordDirectory = path.join(directory, key);
  try {
    const directoryStat = await fs.lstat(recordDirectory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new SkillUpdateRecoveryStoreError();
    }
    const recordPath = path.join(recordDirectory, RECORD_FILE);
    const stat = await fs.lstat(recordPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RECORD_BYTES) {
      throw new SkillUpdateRecoveryStoreError();
    }
    const data: unknown = JSON.parse(await fs.readFile(recordPath, "utf8"));
    if (!validRecord(data, key)) {
      throw new SkillUpdateRecoveryStoreError();
    }
    return data;
  } catch (error) {
    if (isMissing(error)) {
      try {
        await fs.lstat(recordDirectory);
      } catch (directoryError) {
        if (isMissing(directoryError)) {
          return undefined;
        }
      }
    }
    throw new SkillUpdateRecoveryStoreError();
  }
}

export async function listSkillUpdateRecoveries(
  context: RecoveryContext,
): Promise<SkillUpdateRecoveryRecord[]> {
  const directory = getSkillRecoveryDirectory(context);
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new SkillUpdateRecoveryStoreError();
    }
    const entries = await fs.readdir(directory, { withFileTypes: true });
    if (entries.length > MAX_RECORDS) {
      throw new SkillUpdateRecoveryStoreError();
    }
    const records: SkillUpdateRecoveryRecord[] = [];
    for (const entry of entries) {
      if (/^\.(preparing|finished)-[0-9a-f-]{36}$/i.test(entry.name)) {
        continue;
      }
      if (!RECORD_KEY.test(entry.name) || !entry.isDirectory()) {
        throw new SkillUpdateRecoveryStoreError();
      }
      const record = await readRecord(directory, entry.name);
      if (record) {
        records.push(record);
      }
    }
    return records;
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }
    throw new SkillUpdateRecoveryStoreError();
  }
}

export async function assertNoSkillUpdateRecovery(
  context: RecoveryContext,
  targetPath: string,
): Promise<void> {
  const records = await listSkillUpdateRecoveries(context);
  if (records.length === 0) {
    return;
  }
  let canonicalTarget: string;
  try {
    canonicalTarget = await canonicalPath(targetPath);
  } catch {
    throw new SkillUpdateRecoveryStoreError();
  }
  for (const record of records) {
    if (
      overlaps(record.targetPath, targetPath) ||
      overlaps(record.canonicalTargetPath, canonicalTarget)
    ) {
      throw new SkillUpdateRecoveryRequiredError(record.backupPath);
    }
  }
}

export async function beginSkillUpdateRecovery(
  context: RecoveryContext,
  rootPath: string,
  targetPath: string,
  transactionPath: string,
  scannedRootPaths: readonly string[],
): Promise<SkillUpdateRecoveryRecord> {
  const directory = getSkillRecoveryDirectory(context);
  let preparingDirectory: string | undefined;
  let preparingCreated = false;
  let record: SkillUpdateRecoveryRecord | undefined;
  try {
    const canonicalDirectory = await canonicalPath(directory);
    for (const root of [rootPath, ...scannedRootPaths]) {
      if (
        isContainedPath(root, directory) ||
        isContainedPath(await canonicalPath(root), canonicalDirectory)
      ) {
        throw new SkillUpdateRecoveryStoreError("inside-root");
      }
    }
    await assertNoSkillUpdateRecovery(context, targetPath);
    const canonicalTargetPath = await canonicalPath(targetPath);
    record = {
      version: 1,
      id: randomUUID(),
      processId: process.pid,
      startedAt: new Date().toISOString(),
      rootPath: path.resolve(rootPath),
      targetPath: path.resolve(targetPath),
      canonicalTargetPath,
      transactionPath: path.resolve(transactionPath),
      backupPath: path.join(path.resolve(transactionPath), "backup"),
    };
    const key = recordKey(canonicalTargetPath);
    if (!validRecord(record, key)) {
      throw new SkillUpdateRecoveryStoreError();
    }
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    preparingDirectory = path.join(directory, `.preparing-${record.id}`);
    await fs.mkdir(preparingDirectory, { mode: 0o700 });
    preparingCreated = true;
    const handle = await fs.open(
      path.join(preparingDirectory, RECORD_FILE),
      "wx",
      0o600,
    );
    try {
      await handle.writeFile(JSON.stringify(record), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertNoSkillUpdateRecovery(context, targetPath);
    activeRecords.add(record.id);
    try {
      await fs.rename(preparingDirectory, path.join(directory, key));
    } catch (error) {
      await assertNoSkillUpdateRecovery(context, targetPath);
      throw error;
    }
    preparingDirectory = undefined;
    return record;
  } catch (error) {
    if (record) {
      activeRecords.delete(record.id);
    }
    if (preparingCreated && preparingDirectory) {
      try {
        await fs.unlink(path.join(preparingDirectory, RECORD_FILE));
      } catch (cleanupError) {
        if (!isMissing(cleanupError)) {
          console.warn("[Skill Ninja] Failed to clean an incomplete recovery record");
        }
      }
      try {
        await fs.rmdir(preparingDirectory);
      } catch (cleanupError) {
        if (!isMissing(cleanupError)) {
          console.warn("[Skill Ninja] Failed to clean an incomplete recovery directory");
        }
      }
    }
    if (
      error instanceof SkillUpdateRecoveryRequiredError ||
      error instanceof SkillUpdateRecoveryStoreError
    ) {
      throw error;
    }
    throw new SkillUpdateRecoveryStoreError();
  }
}

export function releaseSkillUpdateRecovery(
  record: SkillUpdateRecoveryRecord,
): void {
  activeRecords.delete(record.id);
}

export function isSkillUpdateRecoveryInUse(
  record: SkillUpdateRecoveryRecord,
): boolean {
  if (record.processId === process.pid) {
    return activeRecords.has(record.id);
  }
  try {
    process.kill(record.processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export async function finishSkillUpdateRecovery(
  context: RecoveryContext,
  record: SkillUpdateRecoveryRecord,
): Promise<void> {
  const directory = getSkillRecoveryDirectory(context);
  const key = recordKey(record.canonicalTargetPath);
  const current = await readRecord(directory, key);
  if (!current || JSON.stringify(current) !== JSON.stringify(record)) {
    throw new SkillUpdateRecoveryStoreError();
  }
  const retired = path.join(directory, `.finished-${record.id}`);
  try {
    await fs.rename(path.join(directory, key), retired);
  } catch {
    throw new SkillUpdateRecoveryStoreError();
  }
  activeRecords.delete(record.id);
  try {
    await fs.unlink(path.join(retired, RECORD_FILE));
    await fs.rmdir(retired);
  } catch {
    console.warn("[Skill Ninja] Failed to clean a completed recovery record");
  }
}

export async function hasSkillUpdateRecoveryTarget(
  record: SkillUpdateRecoveryRecord,
): Promise<boolean> {
  try {
    const directory = await fs.lstat(record.targetPath);
    const skill = await fs.lstat(path.join(record.targetPath, "SKILL.md"));
    return (
      directory.isDirectory() &&
      !directory.isSymbolicLink() &&
      skill.isFile() &&
      !skill.isSymbolicLink()
    );
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }
    throw new SkillUpdateRecoveryStoreError();
  }
}

export async function resolveSkillUpdateRecovery(
  context: RecoveryContext,
  record: SkillUpdateRecoveryRecord,
): Promise<void> {
  if (isSkillUpdateRecoveryInUse(record)) {
    throw new SkillUpdateRecoveryInUseError();
  }
  if (!(await hasSkillUpdateRecoveryTarget(record))) {
    throw new SkillUpdateRecoveryTargetMissingError();
  }
  if (isSkillUpdateRecoveryInUse(record)) {
    throw new SkillUpdateRecoveryInUseError();
  }
  await finishSkillUpdateRecovery(context, record);
}
