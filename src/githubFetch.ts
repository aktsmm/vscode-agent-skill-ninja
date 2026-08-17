import { createHash } from "crypto";
import { resolveGitHubTokenAfterFailure } from "./githubAuth";
import {
  classifyGitHubFailure,
  type GitHubFailureKind,
} from "./githubResponse";

const GITHUB_USER_AGENT = "VSCode-SkillNinja";
export const GITHUB_REQUEST_TIMEOUT_MS = 15000;
export const GITHUB_RETRY_MAX_ATTEMPTS = 3;
export const GITHUB_RETRY_ATTEMPTS_CAP = 10;
export const GITHUB_RETRY_BASE_DELAY_MS = 1000;
export const GITHUB_RETRY_MAX_DELAY_MS = 20000;
/** Token sources are secret / env / gh-cli / config, so four walks exhaust them. */
export const GITHUB_TOKEN_FALLBACK_MAX_ATTEMPTS = 4;

/**
 * Retry policy for the single GitHub backoff layer. Callers must not add their
 * own retry loop on top of the helpers in this module.
 */
export interface GitHubRetryPolicy {
  signal?: AbortSignal;
  maxAttempts?: number;
  deadlineAt?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

export function createAbortError(): Error {
  const error = new Error("Request aborted");
  error.name = "AbortError";
  return error;
}

/** Diagnostics keep only host and path so query strings never reach logs. */
export function describeGitHubRequest(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "(unparsable url)";
  }
}

/** 401/403/404 are excluded so retries never fight the auth fallback below. */
export function isRetryableGitHubStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === "AbortError") {
    return false;
  }

  return (
    error instanceof TypeError ||
    error.message.startsWith("Request timeout:") ||
    error.message.includes("fetch failed")
  );
}

export function parseRetryAfterMs(
  value: string | null | undefined,
  now: number,
): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const resetAt = Date.parse(trimmed);
  return Number.isNaN(resetAt) ? undefined : Math.max(0, resetAt - now);
}

function parseRateLimitResetMs(
  response: Pick<Response, "headers">,
  now: number,
): number | undefined {
  if (response.headers.get("x-ratelimit-remaining") !== "0") {
    return undefined;
  }

  const resetSeconds = Number(response.headers.get("x-ratelimit-reset"));
  if (!Number.isFinite(resetSeconds) || resetSeconds <= 0) {
    return undefined;
  }

  return Math.max(0, resetSeconds * 1000 - now);
}

function computeBackoffDelayMs(attempt: number, random: number): number {
  const backoff = GITHUB_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
  return backoff + Math.round(backoff * 0.25 * random);
}

/**
 * Returns the wait before the next attempt, or undefined when the response
 * must not be retried (including waits longer than the cap).
 */
export function computeGitHubRetryDelayMs(
  response: Pick<Response, "status" | "headers">,
  attempt: number,
  context: { now: number; random: number },
): number | undefined {
  if (!isRetryableGitHubStatus(response.status)) {
    return undefined;
  }

  const explicit =
    parseRetryAfterMs(response.headers.get("retry-after"), context.now) ??
    parseRateLimitResetMs(response, context.now);
  const delay = explicit ?? computeBackoffDelayMs(attempt, context.random);

  return delay > GITHUB_RETRY_MAX_DELAY_MS ? undefined : delay;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort(): void {
      clearTimeout(timeoutId);
      reject(createAbortError());
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function runWithGitHubRetry(
  attempt: (init?: RequestInit) => Promise<Response>,
  init: RequestInit | undefined,
  policy: GitHubRetryPolicy,
): Promise<Response> {
  const requestedAttempts = policy.maxAttempts ?? GITHUB_RETRY_MAX_ATTEMPTS;
  const maxAttempts = Number.isFinite(requestedAttempts)
    ? Math.min(
        GITHUB_RETRY_ATTEMPTS_CAP,
        Math.max(1, Math.floor(requestedAttempts)),
      )
    : GITHUB_RETRY_MAX_ATTEMPTS;
  const sleep = policy.sleep ?? defaultSleep;
  const now = policy.now ?? (() => Date.now());
  const random = policy.random ?? Math.random;
  const requestInit = policy.signal ? { ...init, signal: policy.signal } : init;

  for (let attemptNumber = 1; ; attemptNumber++) {
    let response: Response | undefined;
    let failure: unknown;
    try {
      response = await attempt(requestInit);
    } catch (error) {
      failure = error;
    }

    const isLastAttempt = attemptNumber >= maxAttempts;
    let delayMs: number | undefined;
    if (isLastAttempt) {
      delayMs = undefined;
    } else if (response) {
      delayMs = computeGitHubRetryDelayMs(response, attemptNumber, {
        now: now(),
        random: random(),
      });
    } else if (isTransientNetworkError(failure)) {
      delayMs = computeBackoffDelayMs(attemptNumber, random());
    }

    const exceedsDeadline =
      delayMs !== undefined &&
      policy.deadlineAt !== undefined &&
      now() + delayMs > policy.deadlineAt;

    if (delayMs === undefined || exceedsDeadline) {
      if (response) {
        return response;
      }
      throw failure;
    }

    await sleep(delayMs, policy.signal);
    // 注入された sleep が signal を無視しても、中断後に次の試行を始めない
    if (policy.signal?.aborted) {
      throw createAbortError();
    }
  }
}

export async function fetchGitHubWithRetry(
  url: string,
  init?: RequestInit,
  timeoutMs: number = GITHUB_REQUEST_TIMEOUT_MS,
  policy: GitHubRetryPolicy = {},
): Promise<Response> {
  return await runWithGitHubRetry(
    (attemptInit) => fetchGitHubWithTimeout(url, attemptInit, timeoutMs),
    init,
    policy,
  );
}

export async function fetchGitHubWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = GITHUB_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init?.signal;
  let timedOut = false;
  const abortFromCaller = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeoutId = setTimeout(() => {
    if (!controller.signal.aborted) {
      timedOut = true;
      controller.abort();
    }
  }, timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      // 分類器が transient と見分けられるよう code を付けて再 throw する
      const timeoutError = new Error(
        `Request timeout: ${describeGitHubRequest(url)}`,
      );
      timeoutError.name = "TimeoutError";
      (timeoutError as NodeJS.ErrnoException).code = "ETIMEDOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

function isRawGitHubUrl(url: string): boolean {
  return url.startsWith("https://raw.githubusercontent.com/");
}

/** SSO でブロックされた (owner, token) の組。token は生値ではなくハッシュで持つ。 */
const ssoBlockedOwnerTokens = new Map<string, Set<string>>();

/** 認証状態が変わったとき、古いブロック判定を引きずらないよう捨てる。 */
export function resetGitHubSsoCache(): void {
  ssoBlockedOwnerTokens.clear();
}

/** owner を持たない endpoint（search など）は undefined を返し、キャッシュ対象外にする。 */
function getGitHubOwner(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);

    if (parsed.host === "raw.githubusercontent.com") {
      return segments[0]?.toLowerCase();
    }

    if (parsed.host === "api.github.com" && segments[0] === "repos") {
      return segments[1]?.toLowerCase();
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function hashGitHubToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function isSsoBlockedToken(url: string, token: string): boolean {
  const owner = getGitHubOwner(url);
  if (!owner) {
    return false;
  }

  return Boolean(ssoBlockedOwnerTokens.get(owner)?.has(hashGitHubToken(token)));
}

function rememberSsoBlockedToken(url: string, token: string): void {
  const owner = getGitHubOwner(url);
  if (!owner) {
    return;
  }

  const blocked = ssoBlockedOwnerTokens.get(owner) ?? new Set<string>();
  const hash = hashGitHubToken(token);
  if (!blocked.has(hash)) {
    // 資格情報を外したことを黙って行わない。token 自体は出さない
    console.warn(
      `[Skill Ninja] GitHub rejected the credential for ${owner} with SAML SSO; sending later requests to that owner anonymously`,
    );
  }

  blocked.add(hash);
  ssoBlockedOwnerTokens.set(owner, blocked);
}

function isAuthFailureStatus(status: number): boolean {
  return status === 401 || status === 403;
}

/** 注入された stub は clone を持たないので、本文なしでも分類できるようにする。 */
async function readFailureKind(
  response: Response,
): Promise<GitHubFailureKind | undefined> {
  if (typeof response.headers?.get !== "function") {
    return undefined;
  }

  const bodyText =
    typeof response.clone === "function"
      ? await response
          .clone()
          .text()
          .catch(() => "")
      : "";

  return classifyGitHubFailure(response, bodyText);
}

/** 先頭ほど根本原因に近い。通知に出す理由をこの順で選ぶ。 */
const AUTH_FAILURE_PRIORITY: GitHubFailureKind[] = [
  "sso-required",
  "classic-pat-forbidden",
  "auth-required",
  "rate-limit",
];

function getAuthFailureRank(kind: GitHubFailureKind | undefined): number {
  const rank = kind ? AUTH_FAILURE_PRIORITY.indexOf(kind) : -1;
  return rank < 0 ? AUTH_FAILURE_PRIORITY.length : rank;
}

function shouldAttachGitHubToken(url: string, token?: string): boolean {
  if (!token) {
    return false;
  }

  // Public raw content works without auth, and authenticated raw requests can
  // fail in some environments even when the repository is public.
  if (isRawGitHubUrl(url)) {
    return false;
  }

  // SSO 未認可の token は public repo でも 403 になるので、匿名で取りに行く
  return !isSsoBlockedToken(url, token);
}

export function createGitHubHeaders(
  url: string,
  accept: string,
  token?: string,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": GITHUB_USER_AGENT,
    ...extraHeaders,
  };

  if (shouldAttachGitHubToken(url, token)) {
    headers.Authorization = `token ${token}`;
  }

  return headers;
}

export async function fetchGitHubWithOptionalAuthRetry(
  url: string,
  options: {
    accept: string;
    token?: string;
    method?: string;
    extraHeaders?: Record<string, string>;
    request?: (url: string, init?: RequestInit) => Promise<Response>;
    retry?: GitHubRetryPolicy;
  },
): Promise<Response> {
  return await runWithGitHubRetry(
    (init) => requestWithAuthFallback(url, options, init),
    undefined,
    options.retry ?? {},
  );
}

async function requestWithAuthFallback(
  url: string,
  options: {
    accept: string;
    token?: string;
    method?: string;
    extraHeaders?: Record<string, string>;
    request?: (url: string, init?: RequestInit) => Promise<Response>;
  },
  init?: RequestInit,
): Promise<Response> {
  const request = options.request ?? fetchGitHubWithTimeout;
  const headers = createGitHubHeaders(
    url,
    options.accept,
    options.token,
    options.extraHeaders,
  );
  const signal = init?.signal ?? undefined;
  // 中断後はどのフォールバックも新しいリクエストを始めない
  const assertNotCancelled = () => {
    if (signal?.aborted) {
      throw createAbortError();
    }
  };

  // 試行順の最後ではなく、最も根本原因に近い 401/403 を報告できるようにする
  let rootAuthFailure: Response | undefined;
  let rootAuthFailureRank = AUTH_FAILURE_PRIORITY.length;
  let lastAuthFailureRank = AUTH_FAILURE_PRIORITY.length;
  const observeAuthFailure = async (
    candidate: Response,
    sentToken?: string,
  ): Promise<void> => {
    if (!isAuthFailureStatus(candidate.status)) {
      return;
    }

    const kind = await readFailureKind(candidate);
    if (
      sentToken &&
      (kind === "sso-required" || kind === "classic-pat-forbidden")
    ) {
      rememberSsoBlockedToken(url, sentToken);
    }

    lastAuthFailureRank = getAuthFailureRank(kind);
    if (lastAuthFailureRank < rootAuthFailureRank) {
      rootAuthFailureRank = lastAuthFailureRank;
      rootAuthFailure = candidate;
    }
  };

  assertNotCancelled();
  let response = await request(url, {
    headers,
    method: options.method,
    signal,
  });
  await observeAuthFailure(
    response,
    headers.Authorization ? options.token : undefined,
  );

  if (
    response.status === 404 &&
    Boolean(options.token) &&
    isRawGitHubUrl(url) &&
    // ブロック済み token を強制すると、本来 404 の応答が 403 に化ける
    !isSsoBlockedToken(url, options.token!)
  ) {
    assertNotCancelled();
    response = await request(url, {
      headers: {
        ...headers,
        Authorization: `token ${options.token}`,
      },
      method: options.method,
      redirect: "error",
      signal,
    });
    await observeAuthFailure(response, options.token);
  }

  if (isAuthFailureStatus(response.status) && Boolean(headers.Authorization)) {
    assertNotCancelled();
    response = await request(url, {
      headers: {
        Accept: options.accept,
        "User-Agent": GITHUB_USER_AGENT,
        ...options.extraHeaders,
      },
      method: options.method,
      signal,
    });
    await observeAuthFailure(response);
  }

  if ([401, 403, 404].includes(response.status) && Boolean(options.token)) {
    const triedTokens = new Set<string>([options.token!]);
    let failingToken = options.token!;

    // Several stored credentials can be stale at once, so keep walking sources
    for (
      let attempt = 0;
      attempt < GITHUB_TOKEN_FALLBACK_MAX_ATTEMPTS &&
      [401, 403, 404].includes(response.status);
      attempt++
    ) {
      assertNotCancelled();

      const fallback = await resolveGitHubTokenAfterFailure(
        failingToken,
        Array.from(triedTokens),
      );
      if (!fallback || triedTokens.has(fallback.token)) {
        break;
      }

      triedTokens.add(fallback.token);
      failingToken = fallback.token;

      const fallbackHeaders = createGitHubHeaders(
        url,
        options.accept,
        fallback.token,
        options.extraHeaders,
      );
      if (isRawGitHubUrl(url) && !isSsoBlockedToken(url, fallback.token)) {
        fallbackHeaders.Authorization = `token ${fallback.token}`;
      }
      // SSO でブロック済みの token を外すと、直前と同じ匿名リクエストになるだけ
      if (!fallbackHeaders.Authorization) {
        continue;
      }

      response = await request(url, {
        headers: fallbackHeaders,
        method: options.method,
        signal,
        ...(isRawGitHubUrl(url) ? { redirect: "error" as const } : {}),
      });
      await observeAuthFailure(response, fallback.token);
    }
  }

  // 404 の意味論（ブランチ fallback など）は変えず、401/403 のときだけ差し替える
  if (
    isAuthFailureStatus(response.status) &&
    rootAuthFailure &&
    rootAuthFailureRank < lastAuthFailureRank
  ) {
    return rootAuthFailure;
  }

  return response;
}
