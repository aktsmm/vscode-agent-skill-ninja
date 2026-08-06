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

export function getSourceLastIndexedAt(
  source: Source,
  index: Pick<SkillIndex, "lastUpdated">,
): string | undefined {
  return source.lastIndexedAt || index.lastUpdated || undefined;
}

export function getSourceIndexAgeDays(
  source: Source,
  index: Pick<SkillIndex, "lastUpdated">,
  now: Date = new Date(),
): { lastIndexedAt?: string; daysOld: number; isUnknown: boolean } {
  const lastIndexedAt = getSourceLastIndexedAt(source, index);
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
  index: Pick<SkillIndex, "lastUpdated" | "sources">,
  thresholdDays: number = STALE_SOURCE_INDEX_THRESHOLD_DAYS,
  now: Date = new Date(),
): StaleSourceInfo[] {
  const thresholdMs = thresholdDays * DAY_MS;

  return index.sources
    .map((source) => {
      const age = getSourceIndexAgeDays(source, index, now);
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
