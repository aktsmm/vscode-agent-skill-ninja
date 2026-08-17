import type { SkillIndex, Source } from "./skillIndex";

export const STALE_SOURCE_INDEX_THRESHOLD_DAYS = 30;
// 1 回の起動で全ソースを一括再スキャンすると rate limit と長時間ブロックを招くため上限を置く
export const MAX_STALE_SOURCE_UPDATES_PER_RUN = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 最も古いものから上限件数までを今回の対象にし、残りは次回以降へ回す。
 */
export function selectStaleSourcesForRun(
  staleSources: StaleSourceInfo[],
  limit: number = MAX_STALE_SOURCE_UPDATES_PER_RUN,
): { selected: StaleSourceInfo[]; deferred: StaleSourceInfo[] } {
  if (limit <= 0 || staleSources.length <= limit) {
    return { selected: staleSources, deferred: [] };
  }

  return {
    selected: staleSources.slice(0, limit),
    deferred: staleSources.slice(limit),
  };
}

export interface StaleSourceInfo {
  source: Source;
  lastIndexedAt?: string;
  daysOld: number;
  isUnknown: boolean;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * source 単位の鮮度に index 全体の日付を流用しない。
 * 1 つ走査しただけで全 source が新鮮扱いになる。
 */
export function getSourceLastIndexedAt(source: Source): string | undefined {
  return source.lastIndexedAt || undefined;
}

/**
 * 走査日時は「そのデータをいつ取得したか」なので、古い方で上書きしない。
 * bundled catalog の stamp がローカルの新しい走査を巻き戻すのを防ぐ。
 */
export function pickNewerIndexedSource<
  T extends Pick<Source, "lastIndexedAt" | "lastIndexedBy">,
>(local: T, bundled: T): T | undefined {
  const localAt = local.lastIndexedAt ? Date.parse(local.lastIndexedAt) : NaN;
  const bundledAt = bundled.lastIndexedAt
    ? Date.parse(bundled.lastIndexedAt)
    : NaN;

  if (!Number.isFinite(localAt)) {
    return Number.isFinite(bundledAt) ? bundled : undefined;
  }

  if (!Number.isFinite(bundledAt)) {
    return local;
  }

  return bundledAt > localAt ? bundled : local;
}

export function getSourceIndexAgeDays(
  source: Source,
  now: Date = new Date(),
): { lastIndexedAt?: string; daysOld: number; isUnknown: boolean } {
  const lastIndexedAt = getSourceLastIndexedAt(source);
  const lastDate = parseDate(lastIndexedAt);

  if (!lastDate) {
    return {
      lastIndexedAt,
      daysOld: Number.POSITIVE_INFINITY,
      isUnknown: true,
    };
  }

  const ageMs = now.getTime() - lastDate.getTime();
  if (ageMs <= 0) {
    return { lastIndexedAt, daysOld: 0, isUnknown: false };
  }

  return {
    lastIndexedAt,
    daysOld: Math.floor(ageMs / DAY_MS),
    isUnknown: false,
  };
}

export function getStaleSources(
  index: Pick<SkillIndex, "sources">,
  thresholdDays: number = STALE_SOURCE_INDEX_THRESHOLD_DAYS,
  now: Date = new Date(),
): StaleSourceInfo[] {
  const thresholdMs = thresholdDays * DAY_MS;

  return index.sources
    .map((source) => {
      const age = getSourceIndexAgeDays(source, now);
      return { source, ...age };
    })
    .filter((entry) => {
      if (entry.isUnknown) {
        return true;
      }

      const lastDate = parseDate(entry.lastIndexedAt);
      if (!lastDate) {
        return true;
      }

      return now.getTime() - lastDate.getTime() > thresholdMs;
    })
    .sort((left, right) => right.daysOld - left.daysOld);
}

export type StaleSourceIndexUpdateMode = "always" | "prompt" | "never";

export type StaleSourceIndexAction =
  | {
      kind: "skip";
      reason: "mode-never" | "no-stale-sources" | "prompted-today";
    }
  | { kind: "prompt" }
  | { kind: "update" };

/**
 * activate() 内に置くとテストできないため、判断だけを純関数へ出す。
 * タイマー・I/O・globalState 更新・通知は呼び出し側に残す。
 */
export function decideStaleSourceIndexAction(input: {
  mode: StaleSourceIndexUpdateMode;
  staleSourceCount: number;
  lastPromptDate?: string;
  today: string;
}): StaleSourceIndexAction {
  if (input.mode === "never") {
    return { kind: "skip", reason: "mode-never" };
  }

  if (input.staleSourceCount <= 0) {
    return { kind: "skip", reason: "no-stale-sources" };
  }

  if (input.mode === "always") {
    return { kind: "update" };
  }

  if (input.lastPromptDate === input.today) {
    return { kind: "skip", reason: "prompted-today" };
  }

  return { kind: "prompt" };
}
