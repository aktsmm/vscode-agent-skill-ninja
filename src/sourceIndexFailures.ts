import type { Source } from "./skillIndex";
import {
  SourceScanError,
  type SourceScanFailureKind,
} from "./sourceUpdateReconcile";

export const SOURCE_INDEX_FAILURES_KEY = "skillNinja.sourceIndexFailures";
export const PERSISTENT_FAILURE_RETRY_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SourceFailureRecord {
  kind: SourceScanFailureKind;
  lastFailedAt: string;
  /** 同じ kind の失敗で通知済みか。kind が変わったら再通知する。 */
  notified: boolean;
  /** ユーザーが自動更新の対象から外した。手動更新が成功すると解除される。 */
  muted: boolean;
  /** source の定義が変わったら、古い失敗記録を使わないための指紋。 */
  fingerprint: string;
}

export type SourceFailureState = Record<string, SourceFailureRecord>;

const PERSISTENT_KINDS: ReadonlySet<string> = new Set<SourceScanFailureKind>([
  "empty-scan",
  "not-found",
  "identity-changed",
]);

export function getSourceFingerprint(source: Source): string {
  return JSON.stringify([
    source.url,
    source.branch ?? null,
    source.scanner ?? null,
    source.includePaths ?? null,
    source.excludePaths ?? null,
  ]);
}

export function classifyPersistentFailure(
  error: unknown,
): SourceScanFailureKind | undefined {
  return error instanceof SourceScanError ? error.kind : undefined;
}

export function normalizeFailureState(raw: unknown): SourceFailureState {
  const state: SourceFailureState = Object.create(null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return state;
  }

  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const record = value as Partial<SourceFailureRecord> | null;
    if (
      !record ||
      typeof record !== "object" ||
      typeof record.kind !== "string" ||
      !PERSISTENT_KINDS.has(record.kind) ||
      typeof record.lastFailedAt !== "string" ||
      Number.isNaN(Date.parse(record.lastFailedAt)) ||
      typeof record.fingerprint !== "string"
    ) {
      continue;
    }
    state[id] = {
      kind: record.kind,
      lastFailedAt: record.lastFailedAt,
      notified: record.notified === true,
      muted: record.muted === true,
      fingerprint: record.fingerprint,
    };
  }
  return state;
}

function currentRecord(
  state: SourceFailureState,
  source: Source,
): SourceFailureRecord | undefined {
  const record = state[source.id];
  return record && record.fingerprint === getSourceFingerprint(source)
    ? record
    : undefined;
}

/** 削除・退役した source と、定義が変わった source の記録を捨てる。 */
export function pruneFailureState(
  state: SourceFailureState,
  sources: readonly Source[],
): SourceFailureState {
  const next: SourceFailureState = Object.create(null);
  for (const source of sources) {
    const record = currentRecord(state, source);
    if (record) {
      next[source.id] = record;
    }
  }
  return next;
}

export function isEligibleForAutoUpdate(
  state: SourceFailureState,
  source: Source,
  now: Date = new Date(),
): boolean {
  const record = currentRecord(state, source);
  if (!record) {
    return true;
  }
  if (record.muted) {
    return false;
  }
  return (
    now.getTime() - Date.parse(record.lastFailedAt) >=
    PERSISTENT_FAILURE_RETRY_DAYS * DAY_MS
  );
}

export function filterEligibleEntries<T extends { source: Source }>(
  entries: readonly T[],
  state: SourceFailureState,
  now: Date = new Date(),
): T[] {
  return entries.filter((entry) =>
    isEligibleForAutoUpdate(state, entry.source, now),
  );
}

export function recordPersistentFailure(
  state: SourceFailureState,
  source: Source,
  kind: SourceScanFailureKind,
  now: Date = new Date(),
  /** false のときは通知を出せないので、通知済みにしない。次回の失敗で表示する。 */
  canNotify: boolean = true,
): { state: SourceFailureState; shouldNotify: boolean } {
  const existing = currentRecord(state, source);
  const needsNotice = !existing || existing.kind !== kind || !existing.notified;
  const shouldNotify = needsNotice && canNotify;
  return {
    state: {
      ...state,
      [source.id]: {
        kind,
        lastFailedAt: now.toISOString(),
        notified: needsNotice ? shouldNotify : true,
        muted: existing?.muted ?? false,
        fingerprint: getSourceFingerprint(source),
      },
    },
    shouldNotify,
  };
}

export function muteSource(
  state: SourceFailureState,
  source: Source,
): SourceFailureState {
  const existing = currentRecord(state, source);
  return existing
    ? { ...state, [source.id]: { ...existing, muted: true } }
    : state;
}

export function clearFailure(
  state: SourceFailureState,
  sourceId: string,
): SourceFailureState {
  if (!(sourceId in state)) {
    return state;
  }
  const next = { ...state };
  delete next[sourceId];
  return next;
}

/**
 * 更新が成功した source は lastIndexedAt が進む。戻り値の型を変えずに
 * 「実際に成功した source」だけを判定するため、更新前後の index を比べる。
 */
export function clearRecoveredSources(
  state: SourceFailureState,
  before: readonly Source[],
  after: readonly Source[],
): SourceFailureState {
  const beforeStamps = new Map(
    before.map((source) => [source.id, source.lastIndexedAt]),
  );
  let next = state;
  for (const source of after) {
    if (
      beforeStamps.has(source.id) &&
      beforeStamps.get(source.id) !== source.lastIndexedAt
    ) {
      next = clearFailure(next, source.id);
    }
  }
  return next;
}
