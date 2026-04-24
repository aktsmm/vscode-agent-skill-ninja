const GITHUB_USER_AGENT = "VSCode-SkillNinja";

function shouldAttachGitHubToken(url: string, token?: string): boolean {
  if (!token) {
    return false;
  }

  // Public raw content works without auth, and authenticated raw requests can
  // fail in some environments even when the repository is public.
  return !url.includes("raw.githubusercontent.com");
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
  },
): Promise<Response> {
  const headers = createGitHubHeaders(url, options.accept, options.token);

  let response = await fetch(url, {
    headers,
    method: options.method,
  });

  if (
    (response.status === 401 || response.status === 403) &&
    Boolean(headers.Authorization)
  ) {
    response = await fetch(url, {
      headers: {
        Accept: options.accept,
        "User-Agent": GITHUB_USER_AGENT,
      },
      method: options.method,
    });
  }

  return response;
}
