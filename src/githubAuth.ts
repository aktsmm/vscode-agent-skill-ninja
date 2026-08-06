import * as vscode from "vscode";
import { messages } from "./i18n";

export type GitHubTokenSource = "secret" | "config" | "env" | "gh-cli" | "none";

export interface ResolveGitHubTokenOptions {
  excludeSources?: readonly GitHubTokenSource[];
}

const GITHUB_TOKEN_SECRET_KEY = "skillNinja.githubToken";
export const GITHUB_AUTH_TIMEOUT_MS = 5000;

let secretStorage: vscode.SecretStorage | undefined;
let pendingSecretStorageMutation: Promise<void> = Promise.resolve();

export function initializeGitHubAuth(context: vscode.ExtensionContext): void {
  secretStorage = context.secrets;
  pendingSecretStorageMutation = Promise.resolve();
}

function runSecretStorageMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = pendingSecretStorageMutation.then(mutation, mutation);
  pendingSecretStorageMutation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function migrateConfiguredGitHubTokenToSecretStorage(): Promise<boolean> {
  return runSecretStorageMutation(async () => {
    if (!secretStorage) {
      return false;
    }

    const config = vscode.workspace.getConfiguration("skillNinja");
    const configToken = config.get<string>("githubToken")?.trim();
    if (!configToken) {
      return false;
    }

    const storedToken = await secretStorage.get(GITHUB_TOKEN_SECRET_KEY);
    if (storedToken === configToken) {
      return false;
    }

    await secretStorage.store(GITHUB_TOKEN_SECRET_KEY, configToken);
    return true;
  });
}

export async function deleteStoredGitHubToken(): Promise<boolean> {
  return runSecretStorageMutation(async () => {
    if (!secretStorage) {
      return false;
    }

    const storedToken = await secretStorage.get(GITHUB_TOKEN_SECRET_KEY);
    if (storedToken === undefined) {
      return false;
    }

    await secretStorage.delete(GITHUB_TOKEN_SECRET_KEY);
    return true;
  });
}

export async function clearStoredGitHubTokenWithFeedback(): Promise<void> {
  try {
    const deleted = await deleteStoredGitHubToken();
    await vscode.window.showInformationMessage(
      deleted ? messages.githubTokenCleared() : messages.githubTokenNotStored(),
    );
  } catch {
    await vscode.window.showErrorMessage(messages.githubTokenClearFailed());
  }
}

export async function hasStoredGitHubToken(): Promise<boolean> {
  return Boolean(await secretStorage?.get(GITHUB_TOKEN_SECRET_KEY));
}

/** gh CLI からトークンを取得 */
export async function getGhCliToken(): Promise<string | null> {
  try {
    const { exec } = await import("child_process");
    const token = await new Promise<string>((resolve, reject) => {
      exec(
        "gh auth token",
        { timeout: GITHUB_AUTH_TIMEOUT_MS, windowsHide: true },
        (error: Error | null, stdout: string) => {
          if (error) {
            reject(error);
          } else {
            resolve(stdout.trim());
          }
        },
      );
    });
    if (token && token.length > 0) {
      return token;
    }
  } catch {
    // gh CLI が使えない場合は無視
  }
  return null;
}

function getEnvToken(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
}

/** SecretStorage / 環境変数 / gh CLI / 互換設定 の順でトークンを解決 */
export async function resolveGitHubToken(
  options: ResolveGitHubTokenOptions = {},
): Promise<{
  token: string | undefined;
  source: GitHubTokenSource;
}> {
  const excludedSources = new Set(options.excludeSources);
  const storedToken = await secretStorage?.get(GITHUB_TOKEN_SECRET_KEY);
  if (storedToken && !excludedSources.has("secret")) {
    return { token: storedToken, source: "secret" };
  }

  const envToken = getEnvToken();
  if (envToken && !excludedSources.has("env")) {
    return { token: envToken, source: "env" };
  }

  if (!excludedSources.has("gh-cli")) {
    const ghCliToken = await getGhCliToken();
    if (ghCliToken) {
      return { token: ghCliToken, source: "gh-cli" };
    }
  }

  const config = vscode.workspace.getConfiguration("skillNinja");
  const configToken = config.get<string>("githubToken");
  if (configToken && !excludedSources.has("config")) {
    return { token: configToken, source: "config" };
  }

  return { token: undefined, source: "none" };
}

export async function resolveGitHubTokenAfterFailure(
  failedToken: string,
): Promise<{ token: string; source: GitHubTokenSource } | undefined> {
  const current = await resolveGitHubToken();
  if (current.token && current.token !== failedToken) {
    return { token: current.token, source: current.source };
  }
  if (current.source !== "secret") {
    return undefined;
  }

  const excludeSources: GitHubTokenSource[] = ["secret"];
  while (true) {
    const fallback = await resolveGitHubToken({ excludeSources });
    if (!fallback.token || fallback.source === "none") {
      return undefined;
    }
    if (fallback.token !== failedToken) {
      return { token: fallback.token, source: fallback.source };
    }
    excludeSources.push(fallback.source);
  }
}

/** トークンのみ取得したい場合のヘルパー */
export async function getGitHubToken(): Promise<string | undefined> {
  const { token } = await resolveGitHubToken();
  return token;
}

/** GitHub 認証状態を確認 */
export async function checkGitHubAuth(): Promise<{
  authenticated: boolean;
  method: GitHubTokenSource;
  message: string;
}> {
  const { token, source } = await resolveGitHubToken();

  if (token) {
    try {
      if (await validateGitHubToken(token)) {
        return {
          authenticated: true,
          method: source,
          message: "GitHub token authenticated",
        };
      }

      const fallback = await resolveGitHubTokenAfterFailure(token);
      if (fallback && (await validateGitHubToken(fallback.token))) {
        return {
          authenticated: true,
          method: fallback.source,
          message: "GitHub token authenticated",
        };
      }
    } catch {
      // 無効トークンは下で none を返す
    }
  }

  return {
    authenticated: false,
    method: "none",
    message: messages.authRequired(),
  };
}

async function validateGitHubToken(token: string): Promise<boolean> {
  const response = await fetch("https://api.github.com/user", {
    headers: { Authorization: `token ${token}` },
    signal: AbortSignal.timeout(GITHUB_AUTH_TIMEOUT_MS),
  });
  return response.ok;
}
