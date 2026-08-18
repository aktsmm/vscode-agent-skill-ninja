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
    public readonly ssoAuthorizationUrl?: string,
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

/**
 * 分類済み error を作れなかった経路のための最後の手段。日本語 UI では自前の文言が
 * 英語マーカーを含まないので、両言語の目印を 1 か所に集める。
 */
const GITHUB_AUTH_MESSAGE_MARKERS = [
  "rate limit",
  "authentication",
  "unauthorized",
  "forbidden",
  "認証",
  "アクセスが拒否",
  "制限に達し",
];

/**
 * status code は裸の部分一致で拾わない。`4291` バイトや `azure-403-troubleshoot`
 * のようなスキル名まで認証エラー扱いになる。
 */
export function containsHttpStatus(
  message: string,
  ...statuses: readonly number[]
): boolean {
  return statuses.some((status) =>
    new RegExp(`(?<![\\w-])${status}(?![\\w-])`).test(message),
  );
}

export function looksLikeGitHubAuthMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    GITHUB_AUTH_MESSAGE_MARKERS.some((marker) => normalized.includes(marker)) ||
    containsHttpStatus(message, 401, 403, 429)
  );
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

/**
 * `X-GitHub-SSO: required; url=...` から SSO 認可先を取る。
 * `authorization_request` は短命の capability なので保持せず、query を落とす。
 */
export function extractSsoAuthorizationUrl(
  response: Pick<Response, "headers">,
): string | undefined {
  const headers = response.headers;
  const header =
    typeof headers?.get === "function" ? headers.get("x-github-sso") || "" : "";
  const match = /url="?([^\s;,"]+)"?/i.exec(header);
  if (!match) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(match[1]);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== "https:" || parsed.host !== "github.com") {
    return undefined;
  }

  if (!/^\/(orgs|enterprises)\/[^/]+\/sso$/.test(parsed.pathname)) {
    return undefined;
  }

  return `https://github.com${parsed.pathname}`;
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
    kind === "sso-required" ? extractSsoAuthorizationUrl(response) : undefined,
  );
}
