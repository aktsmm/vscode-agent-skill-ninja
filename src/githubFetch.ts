import { resolveGitHubTokenAfterFailure } from "./githubAuth";

const GITHUB_USER_AGENT = "VSCode-SkillNinja";
export const GITHUB_REQUEST_TIMEOUT_MS = 15000;
export const GITHUB_RETRY_MAX_ATTEMPTS = 3;
export const GITHUB_RETRY_BASE_DELAY_MS = 1000;
export const GITHUB_RETRY_MAX_DELAY_MS = 20000;

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
    ? Math.max(1, Math.floor(requestedAttempts))
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
      const timeoutError = new Error(`Request timeout: ${url}`);
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

function shouldAttachGitHubToken(url: string, token?: string): boolean {
  if (!token) {
    return false;
  }

  // Public raw content works without auth, and authenticated raw requests can
  // fail in some environments even when the repository is public.
  return !isRawGitHubUrl(url);
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

  let response = await request(url, {
    headers,
    method: options.method,
    signal,
  });

  if (
    response.status === 404 &&
    Boolean(options.token) &&
    isRawGitHubUrl(url)
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
  }

  if (
    (response.status === 401 || response.status === 403) &&
    Boolean(headers.Authorization)
  ) {
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
  }

  if ([401, 403, 404].includes(response.status) && Boolean(options.token)) {
    const triedTokens: string[] = [options.token!];
    let failingToken = options.token!;

    // Several stored credentials can be stale at once, so keep walking sources
    while ([401, 403, 404].includes(response.status)) {
      assertNotCancelled();

      const fallback = await resolveGitHubTokenAfterFailure(
        failingToken,
        triedTokens,
      );
      if (!fallback) {
        break;
      }

      const fallbackHeaders = createGitHubHeaders(
        url,
        options.accept,
        fallback.token,
        options.extraHeaders,
      );
      if (isRawGitHubUrl(url)) {
        fallbackHeaders.Authorization = `token ${fallback.token}`;
      }
      response = await request(url, {
        headers: fallbackHeaders,
        method: options.method,
        signal,
        ...(isRawGitHubUrl(url) ? { redirect: "error" as const } : {}),
      });

      triedTokens.push(fallback.token);
      failingToken = fallback.token;
    }
  }

  return response;
}
