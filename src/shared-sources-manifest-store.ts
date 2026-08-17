import * as fs from "fs/promises";

import { SELF_EXTENSION_ID } from "./constants";
import type { SkillIndex, SourceScanner } from "./skillIndex";
import {
  createEmptySharedSourcesManifest,
  getAgentNinjaSharedDirectoryPath,
  getSharedSourcesManifestPath,
  SHARED_MANIFEST_SCHEMA_VERSION,
  SHARED_SOURCE_BRANCH_PATTERN,
  SHARED_SOURCE_ID_PATTERN,
  SHARED_SOURCE_PATH_LIST_MAX_ENTRIES,
  SHARED_SOURCE_PATH_MAX_LENGTH,
  SHARED_SOURCE_SCANNERS,
  SHARED_SOURCE_TEXT_MAX_LENGTH,
  SHARED_SOURCE_TYPE_PATTERN,
  SHARED_SOURCE_URL_PATTERN,
  SHARED_SOURCES_MANIFEST_MAX_BYTES,
  SHARED_SOURCES_MANIFEST_MAX_ENTRIES,
  SHARED_SOURCES_MANIFEST_TEMP_FILE,
  type SharedSourcesManifest,
  type SourceEntry,
} from "./shared-manifest";
import {
  withSharedStoreLock,
  type SharedStoreLease,
} from "./shared-store-lock";

const DEFAULT_SOURCE_TYPE = "community";

function sanitizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > SHARED_SOURCE_TEXT_MAX_LENGTH) {
    return undefined;
  }

  return trimmed;
}

function sanitizeRepositoryUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value
    .trim()
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  if (!SHARED_SOURCE_URL_PATTERN.test(trimmed)) {
    return undefined;
  }

  // owner / repo が dot segment だと API path を遡れてしまう
  const [owner, repo] = trimmed.split("/").slice(-2);
  return isDotSegment(owner) || isDotSegment(repo) ? undefined : trimmed;
}

function isDotSegment(segment: string): boolean {
  return segment === "." || segment === "..";
}

function sanitizePathList(value: unknown): {
  ok: boolean;
  value?: string[];
} {
  if (value === undefined || value === null) {
    return { ok: true };
  }

  if (
    !Array.isArray(value) ||
    value.length > SHARED_SOURCE_PATH_LIST_MAX_ENTRIES
  ) {
    return { ok: false };
  }

  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return { ok: false };
    }

    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }

    // 走査範囲を決める値なので、脱出や制御文字を含むものは entry ごと拒否する
    if (
      trimmed.length > SHARED_SOURCE_PATH_MAX_LENGTH ||
      trimmed.startsWith("/") ||
      trimmed.startsWith("\\") ||
      /(^|[/\\])\.\.([/\\]|$)/.test(trimmed) ||
      /[\0<>|"*?]/.test(trimmed) ||
      /^[A-Za-z]:/.test(trimmed)
    ) {
      return { ok: false };
    }

    normalized.push(trimmed);
  }

  return { ok: true, value: normalized.length > 0 ? normalized : undefined };
}

/**
 * type は表示分類にしか使わないので、未知の値も別拡張の分類として残す。
 * 書式だけ制限して、そのまま UI へ流れる長文や制御文字を弾く。
 */
function sanitizeSourceType(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_SOURCE_TYPE;
  }

  const trimmed = value.trim();
  return SHARED_SOURCE_TYPE_PATTERN.test(trimmed)
    ? trimmed
    : DEFAULT_SOURCE_TYPE;
}

function sanitizeScanner(value: unknown): SourceScanner | undefined {
  return typeof value === "string" &&
    (SHARED_SOURCE_SCANNERS as readonly string[]).includes(value)
    ? (value as SourceScanner)
    : undefined;
}

function sanitizeIsoDate(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

/**
 * 共有ストアの 1 レコードを検証する。壊れた entry は全体を捨てず、その entry だけ落とす。
 */
export function sanitizeSourceEntry(raw: unknown): SourceEntry | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const candidate = raw as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  if (!SHARED_SOURCE_ID_PATTERN.test(id)) {
    return undefined;
  }

  const url = sanitizeRepositoryUrl(candidate.url);
  if (!url) {
    return undefined;
  }

  const name = sanitizeText(candidate.name);
  if (!name) {
    return undefined;
  }

  const includePaths = sanitizePathList(candidate.includePaths);
  const excludePaths = sanitizePathList(candidate.excludePaths);
  if (!includePaths.ok || !excludePaths.ok) {
    return undefined;
  }

  const branch =
    typeof candidate.branch === "string" &&
    SHARED_SOURCE_BRANCH_PATTERN.test(candidate.branch.trim()) &&
    // branch は API path へそのまま入るので、遡れる形を弾く
    !candidate.branch
      .trim()
      .split("/")
      .some((segment) => isDotSegment(segment))
      ? candidate.branch.trim()
      : undefined;

  const repoId =
    typeof candidate.repoId === "number" &&
    Number.isSafeInteger(candidate.repoId) &&
    candidate.repoId > 0
      ? candidate.repoId
      : undefined;

  return {
    id,
    name,
    url,
    type: sanitizeSourceType(candidate.type),
    branch,
    lastIndexedAt: sanitizeIsoDate(candidate.lastIndexedAt),
    lastIndexedBy: sanitizeText(candidate.lastIndexedBy),
    description: sanitizeText(candidate.description) ?? "",
    description_ja: sanitizeText(candidate.description_ja),
    includePaths: includePaths.value,
    excludePaths: excludePaths.value,
    scanner: sanitizeScanner(candidate.scanner),
    repoId,
  };
}

/** 捨てた entry を追跡できるようにするラベル。値そのものはログへ出さない */
function describeRejectedSourceEntry(raw: unknown, position: number): string {
  const id =
    raw && typeof raw === "object" ? (raw as { id?: unknown }).id : undefined;

  return typeof id === "string" && SHARED_SOURCE_ID_PATTERN.test(id.trim())
    ? `${id.trim()} (#${position})`
    : `#${position}`;
}

// console を開かないユーザーにも届くよう、直近の破棄内容を診断コマンド向けに保持する
let lastRejectedSharedSources: string[] = [];

export function getLastRejectedSharedSources(): string[] {
  return [...lastRejectedSharedSources];
}

export function normalizeSharedSourcesManifest(
  raw: unknown,
): { manifest: SharedSourcesManifest; rejectedEntries: string[] } | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const candidate = raw as Partial<SharedSourcesManifest>;
  if (candidate.schemaVersion !== SHARED_MANIFEST_SCHEMA_VERSION) {
    return undefined;
  }

  if (!Array.isArray(candidate.sources)) {
    return undefined;
  }

  // 上限超過は切り詰めず全体拒否。部分適用した状態で再開したくない
  if (candidate.sources.length > SHARED_SOURCES_MANIFEST_MAX_ENTRIES) {
    console.warn(
      `[Skill Ninja] Shared sources manifest exceeds ${SHARED_SOURCES_MANIFEST_MAX_ENTRIES} entries; rejecting it`,
    );
    return undefined;
  }

  const seenIds = new Set<string>();
  const sources: SourceEntry[] = [];
  const rejected: string[] = [];
  for (const [position, rawSource] of candidate.sources.entries()) {
    const entry = sanitizeSourceEntry(rawSource);
    if (!entry) {
      rejected.push(describeRejectedSourceEntry(rawSource, position));
      continue;
    }

    if (seenIds.has(entry.id)) {
      continue;
    }

    seenIds.add(entry.id);
    sources.push(entry);
  }

  // 黙って消えると、姉妹拡張側で登録したはずの source が理由なく現れない
  if (rejected.length > 0) {
    console.warn(
      `[Skill Ninja] Ignored ${rejected.length} invalid shared source entr(ies): ${rejected.join(", ")}`,
    );
  }

  return {
    manifest: {
      schemaVersion: SHARED_MANIFEST_SCHEMA_VERSION,
      sources,
      lastUpdated:
        sanitizeIsoDate(candidate.lastUpdated) ?? new Date().toISOString(),
      updatedBy: sanitizeText(candidate.updatedBy) ?? SELF_EXTENSION_ID,
    },
    rejectedEntries: rejected,
  };
}

export type SharedSourcesManifestRead =
  | { status: "missing" }
  | {
      status: "valid";
      manifest: SharedSourcesManifest;
      /** この read で落とした entry。並行 read で上書きされないよう結果に載せる */
      rejectedEntries: string[];
    }
  /** ファイルはあるが採用できない。bootstrap で上書きしてはいけない */
  | { status: "rejected"; reason: string };

export async function readSharedSourcesManifestResult(): Promise<SharedSourcesManifestRead> {
  const filePath = getSharedSourcesManifestPath();

  try {
    // 相手拡張の書きかけや第三者の書き込みが activation 経路へ流れ込むため、
    // 同じ handle のうえでサイズを確認し、上限超過は JSON.parse に到達させない
    const handle = await fs.open(filePath, "r");
    let content: string;
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) {
        return { status: "rejected", reason: "not a file" };
      }

      if (stats.size > SHARED_SOURCES_MANIFEST_MAX_BYTES) {
        console.warn(
          `[Skill Ninja] Shared sources manifest is too large (${stats.size} bytes); ignoring it`,
        );
        return { status: "rejected", reason: "too large" };
      }

      content = (await handle.readFile()).toString("utf8");
    } finally {
      await handle.close();
    }

    const normalized = normalizeSharedSourcesManifest(JSON.parse(content));
    if (!normalized) {
      return { status: "rejected", reason: "schema or entry cap" };
    }

    lastRejectedSharedSources = normalized.rejectedEntries;
    return {
      status: "valid",
      manifest: normalized.manifest,
      rejectedEntries: normalized.rejectedEntries,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT|FileNotFound/i.test(message)) {
      return { status: "missing" };
    }

    // 読めないファイルは移動させない。sibling が書き直す途中の可能性がある
    console.warn(
      "[Skill Ninja] Failed to parse shared sources manifest:",
      error,
    );
    return { status: "rejected", reason: "unparsable" };
  }
}

export async function readSharedSourcesManifest(): Promise<
  SharedSourcesManifest | undefined
> {
  const result = await readSharedSourcesManifestResult();
  return result.status === "valid" ? result.manifest : undefined;
}

async function writeSharedSourcesManifestUnderLease(
  manifest: SharedSourcesManifest,
  lease: SharedStoreLease,
): Promise<void> {
  const normalizedManifest: SharedSourcesManifest = {
    schemaVersion: SHARED_MANIFEST_SCHEMA_VERSION,
    sources: manifest.sources
      .map((source) => sanitizeSourceEntry(source))
      .filter((source): source is SourceEntry => source !== undefined),
    lastUpdated: manifest.lastUpdated,
    updatedBy: manifest.updatedBy,
  };

  // 自分の source を共有ストアへ書けなかったことも黙って済ませない
  if (normalizedManifest.sources.length < manifest.sources.length) {
    console.warn(
      `[Skill Ninja] Skipped ${manifest.sources.length - normalizedManifest.sources.length} source(s) that do not satisfy the shared manifest contract`,
    );
  }
  const sharedDir = getAgentNinjaSharedDirectoryPath();
  const filePath = getSharedSourcesManifestPath();
  const tempPath = `${sharedDir}/${SHARED_SOURCES_MANIFEST_TEMP_FILE}`;

  await fs.mkdir(sharedDir, { recursive: true });
  // lease を奪われていたら共有 state へ書かない
  lease.assertHeld();
  await fs.writeFile(
    tempPath,
    JSON.stringify(normalizedManifest, null, 2),
    "utf8",
  );
  // commit 直前にディスク上の所有権を確かめる
  await lease.assertStillOwned();
  await fs.rename(tempPath, filePath);
}

/**
 * read → 判定 → write を 1 ロック内で完結させる。
 * ロック外で読んでから書くと、別プロセスの更新を上書きする。
 */
export async function updateSharedSourcesManifest(
  mutate: (
    current: SharedSourcesManifest | undefined,
  ) => SharedSourcesManifest | undefined,
): Promise<SharedSourcesManifest | undefined> {
  return await withSharedStoreLock(SELF_EXTENSION_ID, async (lease) => {
    const result = await readSharedSourcesManifestResult();

    // 採用できないだけで中身はある。上書きすると sibling の登録が消える
    if (result.status === "rejected") {
      console.warn(
        `[Skill Ninja] Refused to write the shared sources manifest (${result.reason})`,
      );
      return undefined;
    }

    // 検証で落とした entry を書き戻すと sibling の登録を消すので、直るまで同期しない
    if (result.status === "valid" && result.rejectedEntries.length > 0) {
      console.warn(
        "[Skill Ninja] Refused to write the shared sources manifest because some entries could not be validated",
      );
      return undefined;
    }

    const current = result.status === "valid" ? result.manifest : undefined;
    const next = mutate(current);
    if (!next) {
      return current;
    }

    await writeSharedSourcesManifestUnderLease(next, lease);
    return next;
  });
}

/** 共有ストアへ実際に書けたかどうか。拒否は呼び出し元にも伝える */
export type SharedSourcesWriteOutcome = "written" | "refused";

export async function writeSharedSourcesManifest(
  manifest: SharedSourcesManifest,
): Promise<SharedSourcesWriteOutcome> {
  const written = await updateSharedSourcesManifest(() => manifest);
  return written ? "written" : "refused";
}

export async function bootstrapSharedSourcesManifest(
  sources: SourceEntry[],
): Promise<SharedSourcesManifest | undefined> {
  const prepared = createEmptySharedSourcesManifest(SELF_EXTENSION_ID);
  prepared.sources = sources
    .map((source) => sanitizeSourceEntry(source))
    .filter((source): source is SourceEntry => source !== undefined);
  prepared.lastUpdated = new Date().toISOString();

  // missing を読んでから bootstrap するまでに別プロセスがファイルを作ることがある
  return await updateSharedSourcesManifest((current) =>
    current ? undefined : prepared,
  );
}

export interface ApplySharedSourcesOptions {
  /** 退役した preset source。共有ストア経由で復活させない */
  retiredSourceIds?: Iterable<string>;
}

export function applySharedSourcesManifestToSkillIndex(
  currentIndex: SkillIndex,
  manifest: SharedSourcesManifest,
  options: ApplySharedSourcesOptions = {},
): SkillIndex {
  const retired = new Set(options.retiredSourceIds || []);
  const localSourcesById = new Map(
    currentIndex.sources.map((source) => [source.id, source]),
  );
  const nextSources = manifest.sources
    .filter((source) => !retired.has(source.id))
    .map((source) => {
      // 共有マニフェストは source 登録の SSOT。走査履歴はローカル index を正とし、
      // 別拡張が書いた時刻を自分の鮮度として採用しない
      const local = localSourcesById.get(source.id);
      return {
        ...source,
        lastIndexedAt: local?.lastIndexedAt,
        lastIndexedBy: local?.lastIndexedBy,
      };
    });
  const currentSourceIds = new Set(nextSources.map((source) => source.id));
  const nextBundles = (currentIndex.bundles || []).filter((bundle) =>
    currentSourceIds.has(bundle.source),
  );

  return {
    ...currentIndex,
    sources: nextSources,
    skills: currentIndex.skills.filter((skill) =>
      currentSourceIds.has(skill.source),
    ),
    bundles: nextBundles.length > 0 ? nextBundles : undefined,
  };
}

export interface SyncSharedSourcesOptions {
  /** 自分の index からは消えているが共有ストアには残す id（退役 preset など） */
  preservedIds?: Iterable<string>;
}

export async function syncSharedSourcesManifestFromSources(
  sources: SourceEntry[],
  options: SyncSharedSourcesOptions = {},
): Promise<SharedSourcesWriteOutcome> {
  const preserved = new Set(options.preservedIds || []);
  const ownSources = sources
    .map((source) => sanitizeSourceEntry(source))
    .filter((source): source is SourceEntry => source !== undefined);
  const ownIds = new Set(ownSources.map((source) => source.id));

  const written = await updateSharedSourcesManifest((current) => {
    const currentById = new Map(
      (current?.sources || []).map((source) => [source.id, source]),
    );

    const mergedOwnSources = ownSources.map((source) => {
      const existing = currentById.get(source.id);
      if (source.lastIndexedAt || !existing?.lastIndexedAt) {
        return source;
      }

      // 他拡張の走査履歴を消さない
      return {
        ...source,
        lastIndexedAt: existing.lastIndexedAt,
        lastIndexedBy: existing.lastIndexedBy,
      };
    });

    // 自分の view から隠しただけの entry を、共有ストアから消さない
    const keptFromCurrent = (current?.sources || []).filter(
      (source) => !ownIds.has(source.id) && preserved.has(source.id),
    );

    return {
      schemaVersion: SHARED_MANIFEST_SCHEMA_VERSION,
      sources: [...mergedOwnSources, ...keptFromCurrent],
      lastUpdated: new Date().toISOString(),
      updatedBy: SELF_EXTENSION_ID,
    };
  });

  return written ? "written" : "refused";
}
