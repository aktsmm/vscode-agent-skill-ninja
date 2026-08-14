export type GitHubFailureKind =
  | "rate-limit"
  | "sso-required"
  | "classic-pat-forbidden"
  | "auth-required"
  | "not-found"
  | "server-error"
  | "transport"
  | "other";

export class GitHubResponseError extends Error {
  constructor(
    public readonly kind: GitHubFailureKind,
    public readonly status: number,
    message: string,
    public readonly resetAt?: string,
  ) {
    super(message);
    this.name = "GitHubResponseError";
  }
}

export function isGitHubResponseError(
  error: unknown,
): error is GitHubResponseError {
  return error instanceof GitHubResponseError;
}

export function classifyGitHubFailure(
  response: Pick<Response, "status" | "headers">,
  bodyText: string,
): GitHubFailureKind {
  const lowerBody = bodyText.toLowerCase();
  const headers = response.headers;
  const readHeader = (name: string): string =>
    typeof headers?.get === "function" ? headers.get(name) || "" : "";
  const ssoHeader = readHeader("x-github-sso").toLowerCase();

  if (
    ssoHeader.includes("required") ||
    lowerBody.includes("saml enforcement") ||
    lowerBody.includes("must grant your oauth token access")
  ) {
    return "sso-required";
  }

  if (
    lowerBody.includes("forbids access via a personal access tokens (classic)")
  ) {
    return "classic-pat-forbidden";
  }

  if (
    response.status === 429 ||
    readHeader("x-ratelimit-remaining") === "0" ||
    lowerBody.includes("rate limit")
  ) {
    return "rate-limit";
  }

  if (response.status === 404) {
    return "not-found";
  }

  if (response.status === 401 || response.status === 403) {
    return "auth-required";
  }

  if (response.status >= 500) {
    return "server-error";
  }

  return "other";
}

const TRANSPORT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/**
 * fetch が Response を返さずに throw した場合だけ transient と見なす。
 * 判別できないものは transport 扱いにしない（再試行対象を広げない）。
 */
export function classifyTransportError(
  error: unknown,
): "transport" | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const codes: unknown[] = [
    (error as NodeJS.ErrnoException).code,
    (error.cause as NodeJS.ErrnoException | undefined)?.code,
  ];
  if (
    codes.some(
      (code) => typeof code === "string" && TRANSPORT_ERROR_CODES.has(code),
    )
  ) {
    return "transport";
  }

  // undici は接続失敗を TypeError("fetch failed") + cause で表す
  if (error.name === "TypeError" && /fetch failed/i.test(error.message)) {
    return "transport";
  }

  return undefined;
}

function getRateLimitResetAt(
  response: Pick<Response, "headers">,
): string | undefined {
  const headers = response.headers;
  if (typeof headers?.get !== "function") {
    return undefined;
  }

  const resetSeconds = Number(headers.get("x-ratelimit-reset"));
  if (!Number.isFinite(resetSeconds) || resetSeconds <= 0) {
    return undefined;
  }

  return new Date(resetSeconds * 1000).toISOString();
}

export function createGitHubResponseError(
  response: Pick<Response, "status" | "headers">,
  bodyText: string,
  context: string,
): GitHubResponseError {
  const kind = classifyGitHubFailure(response, bodyText);
  const resetAt =
    kind === "rate-limit" ? getRateLimitResetAt(response) : undefined;
  const detail =
    kind === "rate-limit"
      ? `GitHub API rate limit exceeded${resetAt ? ` until ${resetAt}` : ""}`
      : kind === "sso-required"
        ? "GitHub organization SSO authorization is required"
        : kind === "classic-pat-forbidden"
          ? "GitHub organization policy rejected the classic PAT"
          : kind === "auth-required"
            ? "GitHub authentication or repository permission is required"
            : kind === "not-found"
              ? "GitHub resource was not found"
              : kind === "server-error"
                ? `GitHub API returned a server error (${response.status})`
                : `GitHub API request failed (${response.status})`;

  return new GitHubResponseError(
    kind,
    response.status,
    `${context}: ${detail}`,
    resetAt,
  );
}

export async function retryGitHubRequestAnonymously(
  response: Response,
  hasToken: boolean,
  requestWithoutToken: () => Promise<Response>,
): Promise<Response> {
  if (!hasToken || response.ok) {
    return response;
  }

  const bodyText = await response
    .clone()
    .text()
    .catch(() => "");
  const failureKind = classifyGitHubFailure(response, bodyText);
  if (
    failureKind !== "sso-required" &&
    failureKind !== "classic-pat-forbidden" &&
    failureKind !== "auth-required"
  ) {
    return response;
  }

  try {
    const retryResponse = await requestWithoutToken();
    return retryResponse.ok ? retryResponse : response;
  } catch {
    return response;
  }
}
