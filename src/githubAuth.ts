import * as vscode from "vscode";
import { messages } from "./i18n";

export type GitHubTokenSource = "secret" | "config" | "env" | "gh-cli" | "none";

const GITHUB_TOKEN_SECRET_KEY = "skillNinja.githubToken";

let secretStorage: vscode.SecretStorage | undefined;

export function initializeGitHubAuth(context: vscode.ExtensionContext): void {
  secretStorage = context.secrets;
}

export async function migrateConfiguredGitHubTokenToSecretStorage(): Promise<boolean> {
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
}

export async function deleteStoredGitHubToken(): Promise<void> {
  await secretStorage?.delete(GITHUB_TOKEN_SECRET_KEY);
}

/** gh CLI からトークンを取得 */
export async function getGhCliToken(): Promise<string | null> {
  try {
    const { exec } = await import("child_process");
    const token = await new Promise<string>((resolve, reject) => {
      exec(
        "gh auth token",
        { timeout: 5000, windowsHide: true },
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
export async function resolveGitHubToken(): Promise<{
  token: string | undefined;
  source: GitHubTokenSource;
}> {
  const storedToken = await secretStorage?.get(GITHUB_TOKEN_SECRET_KEY);
  if (storedToken) {
    return { token: storedToken, source: "secret" };
  }

  const envToken = getEnvToken();
  if (envToken) {
    return { token: envToken, source: "env" };
  }

  const ghCliToken = await getGhCliToken();
  if (ghCliToken) {
    return { token: ghCliToken, source: "gh-cli" };
  }

  const config = vscode.workspace.getConfiguration("skillNinja");
  const configToken = config.get<string>("githubToken");
  if (configToken) {
    return { token: configToken, source: "config" };
  }

  return { token: undefined, source: "none" };
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
      const response = await fetch("https://api.github.com/user", {
        headers: { Authorization: `token ${token}` },
      });
      if (response.ok) {
        return {
          authenticated: true,
          method: source,
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
