export type GitHubFailureKind =
  | "rate-limit"
  | "sso-required"
  | "classic-pat-forbidden"
  | "auth-required"
  | "not-found"
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
  const ssoHeader = response.headers.get("x-github-sso")?.toLowerCase() || "";

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
    response.headers.get("x-ratelimit-remaining") === "0" ||
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

  return "other";
}

function getRateLimitResetAt(
  response: Pick<Response, "headers">,
): string | undefined {
  const resetSeconds = Number(response.headers.get("x-ratelimit-reset"));
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
