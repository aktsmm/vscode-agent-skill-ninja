// GitHub の rate limit や 1 回あたりの更新上限で持ち越した source index 更新を、
// あとで再開するための state。
//
// 共有ディレクトリではなく自拡張の globalState に置く。共有ディレクトリは
// 別拡張との契約面なので、こちらの再試行都合でファイルを増やさない。

/** rate-limit は reset 待ちが要る。deferred は 1 回あたりの上限で溢れただけなのですぐ再開してよい */
export type SourceIndexResumeReason = "rate-limit" | "deferred";

export interface RateLimitResumeState {
  sourceIds: string[];
  reason: SourceIndexResumeReason;
  resetAt?: string;
  savedAt: string;
}

// 共有マニフェストの entry 上限と揃え、持ち越し先で取りこぼさない
const MAX_RESUME_SOURCE_IDS = 500;
// reset 時刻が取れないときに再開してよいと見なすまでの待ち時間
export const RATE_LIMIT_RESUME_FALLBACK_DELAY_MS = 60 * 60 * 1000;
// 古すぎる resume state を無限に持ち越さない
export const RATE_LIMIT_RESUME_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeReason(value: unknown): SourceIndexResumeReason {
  return value === "deferred" ? "deferred" : "rate-limit";
}

export function createRateLimitResumeState(
  sourceIds: readonly string[],
  options: { reason: SourceIndexResumeReason; resetAt?: string },
  now: Date = new Date(),
): RateLimitResumeState | undefined {
  const uniqueIds = Array.from(
    new Set(sourceIds.filter((id) => typeof id === "string" && id.length > 0)),
  ).slice(0, MAX_RESUME_SOURCE_IDS);

  if (uniqueIds.length === 0) {
    return undefined;
  }

  return {
    sourceIds: uniqueIds,
    reason: options.reason,
    resetAt: Number.isFinite(Date.parse(options.resetAt ?? ""))
      ? options.resetAt
      : undefined,
    savedAt: now.toISOString(),
  };
}

export function normalizeRateLimitResumeState(
  raw: unknown,
): RateLimitResumeState | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const candidate = raw as Partial<RateLimitResumeState>;
  if (!Array.isArray(candidate.sourceIds)) {
    return undefined;
  }

  const sourceIds = candidate.sourceIds
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .slice(0, MAX_RESUME_SOURCE_IDS);
  if (sourceIds.length === 0) {
    return undefined;
  }

  const savedAt =
    typeof candidate.savedAt === "string" &&
    Number.isFinite(Date.parse(candidate.savedAt))
      ? candidate.savedAt
      : undefined;
  if (!savedAt) {
    return undefined;
  }

  return {
    sourceIds,
    reason: normalizeReason(candidate.reason),
    resetAt:
      typeof candidate.resetAt === "string" &&
      Number.isFinite(Date.parse(candidate.resetAt))
        ? candidate.resetAt
        : undefined,
    savedAt,
  };
}

export function isRateLimitResumeExpired(
  state: RateLimitResumeState,
  now: Date = new Date(),
): boolean {
  return (
    now.getTime() - Date.parse(state.savedAt) > RATE_LIMIT_RESUME_MAX_AGE_MS
  );
}

export function shouldResumeRateLimitedUpdate(
  state: RateLimitResumeState | undefined,
  now: Date = new Date(),
): boolean {
  if (!state || isRateLimitResumeExpired(state, now)) {
    return false;
  }

  if (state.reason === "deferred") {
    return true;
  }

  const resetAt = state.resetAt ? Date.parse(state.resetAt) : Number.NaN;
  if (Number.isFinite(resetAt)) {
    return now.getTime() >= resetAt;
  }

  return (
    now.getTime() - Date.parse(state.savedAt) >=
    RATE_LIMIT_RESUME_FALLBACK_DELAY_MS
  );
}
