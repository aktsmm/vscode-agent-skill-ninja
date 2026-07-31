import { resolveGitHubTokenAfterFailure } from "./githubAuth";

const GITHUB_USER_AGENT = "VSCode-SkillNinja";
export const GITHUB_REQUEST_TIMEOUT_MS = 15000;

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
      throw new Error(`Request timeout: ${url}`);
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
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": GITHUB_USER_AGENT,
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
    request?: (url: string, init?: RequestInit) => Promise<Response>;
  },
): Promise<Response> {
  const request = options.request ?? fetchGitHubWithTimeout;
  const headers = createGitHubHeaders(url, options.accept, options.token);

  let response = await request(url, {
    headers,
    method: options.method,
  });

  if (
    response.status === 404 &&
    Boolean(options.token) &&
    isRawGitHubUrl(url)
  ) {
    response = await request(url, {
      headers: {
        ...headers,
        Authorization: `token ${options.token}`,
      },
      method: options.method,
      redirect: "error",
    });
  }

  if (
    (response.status === 401 || response.status === 403) &&
    Boolean(headers.Authorization)
  ) {
    response = await request(url, {
      headers: {
        Accept: options.accept,
        "User-Agent": GITHUB_USER_AGENT,
      },
      method: options.method,
    });
  }

  if ([401, 403, 404].includes(response.status) && Boolean(options.token)) {
    const fallback = await resolveGitHubTokenAfterFailure(options.token!);
    if (fallback) {
      const fallbackHeaders = createGitHubHeaders(
        url,
        options.accept,
        fallback.token,
      );
      if (isRawGitHubUrl(url)) {
        fallbackHeaders.Authorization = `token ${fallback.token}`;
      }
      response = await request(url, {
        headers: fallbackHeaders,
        method: options.method,
        ...(isRawGitHubUrl(url) ? { redirect: "error" as const } : {}),
      });
    }
  }

  return response;
}
