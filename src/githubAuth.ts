import * as vscode from "vscode";
import { messages } from "./i18n";

export type GitHubTokenSource = "secret" | "config" | "env" | "gh-cli" | "none";

/**
 * トークン検証が失敗した理由。「無効」と「一時的に使えない」を混同すると、
 * 有効な資格情報を捨てさせる案内になるので分けて保持する。
 */
export type GitHubAuthFailureReason =
  | "invalid"
  | "rate-limited"
  | "sso-required"
  | "forbidden"
  | "unreachable";

export interface GitHubAuthStatus {
  authenticated: boolean;
  method: GitHubTokenSource;
  message: string;
  /** 資格情報はあったが検証が通らなかった場合の原因。 */
  reason?: GitHubAuthFailureReason;
}

export interface ResolveGitHubTokenOptions {
  excludeSources?: readonly GitHubTokenSource[];
}

const GITHUB_TOKEN_SECRET_KEY = "skillNinja.githubToken";
export const GITHUB_AUTH_TIMEOUT_MS = 5000;
/** secret / env / gh-cli / config の 4 系統を上限に、認証確認の探索を打ち切る。 */
const GITHUB_AUTH_MAX_CREDENTIALS = 4;
export const LEGACY_PLAINTEXT_PROMPT_DISMISSED_KEY =
  "skillNinja.legacyPlaintextTokenPromptDismissed";

let secretStorage: vscode.SecretStorage | undefined;
// 平文の PAT は workspace / folder の settings.json に残るので、抑止も workspace 単位
// にする。machine 全体で黙らせると、別 workspace の新しい平文を一度も見せられない。
let promptState: vscode.Memento | undefined;
let pendingSecretStorageMutation: Promise<void> = Promise.resolve();

export function initializeGitHubAuth(context: vscode.ExtensionContext): void {
  secretStorage = context.secrets;
  promptState = context.workspaceState;
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

/** 平文コピーが残りうる設定スコープ。環境変数と gh CLI はここに含めない。 */
export type LegacyTokenScope = "global" | "workspace" | "workspaceFolder";

export interface LegacyConfiguredToken {
  scope: LegacyTokenScope;
  token: string;
  /** workspaceFolder の値は folder ごとに別なので、更新先を特定するために保持する。 */
  folderUri?: vscode.Uri;
}

export interface LegacyTokenRemovalResult {
  removed: LegacyTokenScope[];
  /** 削除できずに残った平文コピーの数。0 でなければ成功と報告してはいけない。 */
  remaining: number;
}

const LEGACY_SCOPE_TARGET: Record<
  LegacyTokenScope,
  vscode.ConfigurationTarget
> = {
  global: vscode.ConfigurationTarget.Global,
  workspace: vscode.ConfigurationTarget.Workspace,
  workspaceFolder: vscode.ConfigurationTarget.WorkspaceFolder,
};

/**
 * `settings.json` に平文で残っている PAT を、スコープ付きで列挙する。
 *
 * これは「平文が残っているか」を見るための検出用。実際に使う値の決定には
 * `resolveLegacyConfiguredToken()` を使う。`workspaceFolderValue` は
 * resource scope を渡さないと解決できないため multi-root では folder ごとに見る。
 */
export function inspectLegacyConfiguredTokens(): LegacyConfiguredToken[] {
  const found: LegacyConfiguredToken[] = [];

  for (const folder of vscode.workspace.workspaceFolders || []) {
    const token = vscode.workspace
      .getConfiguration("skillNinja", folder.uri)
      .inspect<string>("githubToken")
      ?.workspaceFolderValue?.trim();
    if (token) {
      found.push({ scope: "workspaceFolder", token, folderUri: folder.uri });
    }
  }

  const inspected = vscode.workspace
    .getConfiguration("skillNinja")
    .inspect<string>("githubToken");
  for (const [scope, value] of [
    ["workspace", inspected?.workspaceValue],
    ["global", inspected?.globalValue],
  ] as const) {
    const token = value?.trim();
    if (token) {
      found.push({ scope, token });
    }
  }

  return found;
}

/**
 * 実際に使う legacy 値。resource scope なしの `config.get()` が返していた値と
 * 同じ「workspace が user を上書きする」順序を保つ。
 *
 * folder スコープの値は resource なしでは元から解決されないので、ここでは使わない。
 * multi-root で folder ごとに違う PAT があるとき、どれか 1 つを machine-wide な
 * SecretStorage へ昇格させてしまうのを防ぐ。
 */
function resolveLegacyConfiguredToken(): string | undefined {
  const inspected = vscode.workspace
    .getConfiguration("skillNinja")
    .inspect<string>("githubToken");
  return (
    inspected?.workspaceValue?.trim() ||
    inspected?.globalValue?.trim() ||
    undefined
  );
}

export async function migrateConfiguredGitHubTokenToSecretStorage(): Promise<boolean> {
  return runSecretStorageMutation(async () => {
    if (!secretStorage) {
      return false;
    }

    const configToken = resolveLegacyConfiguredToken();
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

/**
 * 削除しようとしている平文の中に、SecretStorage へ入っていない値が混ざっているか。
 *
 * multi-root では移行される値は 1 つだけなので、`migrate` が成功したことは
 * 「全部の平文が退避できた」を意味しない。控えを促す案内はこちらで判定する。
 */
export async function hasUnmigratedLegacyPlaintextToken(): Promise<boolean> {
  const stored = await secretStorage?.get(GITHUB_TOKEN_SECRET_KEY);
  return inspectLegacyConfiguredTokens().some(({ token }) => token !== stored);
}

/** 「今後表示しない」を解除する。Reset コマンドから使う。 */
export async function resetLegacyPlaintextPrompt(): Promise<void> {
  await promptState?.update(LEGACY_PLAINTEXT_PROMPT_DISMISSED_KEY, undefined);
}

/**
 * PAT を SecretStorage へ移した後、settings.json に残る平文コピーの削除を提案する。
 * 設定は machine scope なので、削除しない限り読めない値が残り続ける。
 *
 * 起動ごとに出るので、他の起動時プロンプトと同じく明示的な抑止先を持たせる。
 * キャンセルは次回また尋ね、抑止は「今後表示しない」を選んだときだけ。
 */
export async function offerToRemoveLegacyPlaintextGitHubToken(): Promise<void> {
  await migrateConfiguredGitHubTokenToSecretStorage();

  if (inspectLegacyConfiguredTokens().length === 0) {
    return;
  }
  if (promptState?.get<boolean>(LEGACY_PLAINTEXT_PROMPT_DISMISSED_KEY)) {
    return;
  }

  // 移行されるのは 1 値だけなので、別値の平文が残っていれば控えるよう促す
  const hasUnmigrated = await hasUnmigratedLegacyPlaintextToken();
  const removeLabel = messages.githubTokenRemoveLegacyPlaintext();
  const dontAskLabel = messages.actionDontAskAgain();
  const choice = await vscode.window.showWarningMessage(
    hasUnmigrated
      ? messages.githubTokenLegacyPlaintextOnly()
      : messages.githubTokenLegacyPlaintextFound(),
    removeLabel,
    dontAskLabel,
    messages.actionCancel(),
  );

  if (choice === dontAskLabel) {
    await promptState?.update(LEGACY_PLAINTEXT_PROMPT_DISMISSED_KEY, true);
    return;
  }
  if (choice !== removeLabel) {
    return;
  }

  const removal = await removeLegacyConfiguredGitHubTokens();
  await vscode.window.showInformationMessage(
    removal.remaining === 0
      ? messages.githubTokenLegacyPlaintextRemoved()
      : messages.githubTokenLegacyPlaintextRemoveFailed(),
  );
}

/**
 * `settings.json` 側の平文コピーを消す。SecretStorage へ移した後の後始末と、
 * Clear コマンドの両方から使う。環境変数と gh CLI credential は対象外。
 */
export async function removeLegacyConfiguredGitHubTokens(): Promise<LegacyTokenRemovalResult> {
  const removed: LegacyTokenScope[] = [];

  for (const { scope, folderUri } of inspectLegacyConfiguredTokens()) {
    try {
      await vscode.workspace
        .getConfiguration("skillNinja", folderUri)
        .update("githubToken", undefined, LEGACY_SCOPE_TARGET[scope]);
      removed.push(scope);
    } catch (error) {
      console.warn(
        `[Skill Ninja] Failed to clear the legacy GitHub token in ${scope} settings:`,
        error,
      );
    }
  }

  return { removed, remaining: inspectLegacyConfiguredTokens().length };
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
    // 平文の legacy copy を残すと、Clear した直後に同じ値へ戻ってしまう
    const legacy = await removeLegacyConfiguredGitHubTokens();
    if (legacy.remaining > 0) {
      await vscode.window.showErrorMessage(messages.githubTokenClearFailed());
      return;
    }

    await vscode.window.showInformationMessage(
      deleted || legacy.removed.length > 0
        ? messages.githubTokenCleared()
        : messages.githubTokenNotStored(),
    );
  } catch {
    await vscode.window.showErrorMessage(messages.githubTokenClearFailed());
  }
}

export async function hasStoredGitHubToken(): Promise<boolean> {
  return Boolean(await secretStorage?.get(GITHUB_TOKEN_SECRET_KEY));
}

/**
 * gh CLI の子プロセスからだけ環境変数トークンを外した env を作る。
 * 親 `process.env` は変更しない。古い `GH_TOKEN` が残っていると
 * `gh auth token` が保存済み credential ではなくその値をそのまま返すため。
 */
function buildGhCliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return env;
}

export interface GhCliAccount {
  login: string;
  active: boolean;
  /** gh が資格情報の検証に成功したか。false でも「トークンが無効」とは限らない */
  healthy: boolean;
  /** 検証に失敗した理由。rate limit と無効トークンを混同しないため生文言を保持する */
  error?: string;
}

function runGhCli(args: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    void import("child_process").then(({ exec }) => {
      exec(
        `gh ${args}`,
        {
          timeout: GITHUB_AUTH_TIMEOUT_MS,
          windowsHide: true,
          env: buildGhCliEnv(),
        },
        (error: Error | null, stdout: string) => {
          if (error) {
            reject(error);
          } else {
            resolve(stdout.trim());
          }
        },
      );
    }, reject);
  });
}

// exec へ渡す前に形を確かめる。gh 由来の値でもシェルへ素通しにしない
const GH_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GH_HOSTNAME_PATTERN = /^[A-Za-z0-9.-]{1,253}$/;

/** rate limit を「トークンが無効」と案内すると、有効な資格情報を捨てさせる */
export function isRateLimitAccountError(error: string | undefined): boolean {
  return typeof error === "string" && /rate limit/i.test(error);
}

/**
 * gh が知っているアカウントを列挙する。`gh auth token` は active なアカウントの値しか
 * 返さないので、active が壊れているだけなのかを見分けるにはこちらが要る。
 */
export async function listGhCliAccounts(
  hostname: string = "github.com",
): Promise<GhCliAccount[]> {
  if (!GH_HOSTNAME_PATTERN.test(hostname)) {
    return [];
  }

  let raw: string;
  try {
    raw = await runGhCli(`auth status --hostname ${hostname} --json hosts`);
  } catch {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as {
      hosts?: Record<string, unknown>;
    };
    const entries = parsed.hosts?.[hostname];
    if (!Array.isArray(entries)) {
      return [];
    }

    return entries
      .map((entry) => entry as Record<string, unknown>)
      .filter((entry) => typeof entry.login === "string")
      .map((entry) => ({
        login: entry.login as string,
        active: entry.active === true,
        healthy: entry.state === "success",
        error: typeof entry.error === "string" ? entry.error : undefined,
      }));
  } catch {
    return [];
  }
}

/** 切替候補は「有効かつ現在 active でない」ものだけ。無効な候補を勧めない */
export function selectGhCliSwitchCandidates(
  accounts: readonly GhCliAccount[],
): GhCliAccount[] {
  return accounts.filter((account) => account.healthy && !account.active);
}

export async function switchGhCliAccount(
  login: string,
  hostname: string = "github.com",
): Promise<boolean> {
  if (!GH_LOGIN_PATTERN.test(login) || !GH_HOSTNAME_PATTERN.test(hostname)) {
    return false;
  }

  try {
    await runGhCli(`auth switch --hostname ${hostname} --user ${login}`);
  } catch {
    return false;
  }

  // 切替は gh 全体の状態を変えるので、成功を自己申告ではなく実状態で確かめる
  const accounts = await listGhCliAccounts(hostname);
  return accounts.some((account) => account.active && account.login === login);
}

/** gh CLI からトークンを取得 */
export async function getGhCliToken(): Promise<string | null> {
  try {
    const { exec } = await import("child_process");
    const token = await new Promise<string>((resolve, reject) => {
      exec(
        "gh auth token --hostname github.com",
        {
          timeout: GITHUB_AUTH_TIMEOUT_MS,
          windowsHide: true,
          env: buildGhCliEnv(),
        },
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

/**
 * `GH_TOKEN` を `GITHUB_TOKEN` より優先する。gh CLI と同じ優先順位にして、
 * 「gh で使われている値」と「拡張が使う値」がずれないようにする。
 */
function getEnvToken(): string | undefined {
  return process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
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

  const configToken = resolveLegacyConfiguredToken();
  if (configToken && !excludedSources.has("config")) {
    return { token: configToken, source: "config" };
  }

  return { token: undefined, source: "none" };
}

export async function resolveGitHubTokenAfterFailure(
  failedToken: string,
  alreadyTried: readonly string[] = [],
): Promise<{ token: string; source: GitHubTokenSource } | undefined> {
  const tried = new Set<string>([failedToken, ...alreadyTried]);
  const current = await resolveGitHubToken();
  if (current.token && !tried.has(current.token)) {
    return { token: current.token, source: current.source };
  }
  if (current.source === "none") {
    return undefined;
  }

  // Walk past whichever source produced the failing token, not just SecretStorage
  const excludeSources: GitHubTokenSource[] = [current.source];
  while (true) {
    const fallback = await resolveGitHubToken({ excludeSources });
    if (!fallback.token || fallback.source === "none") {
      return undefined;
    }
    if (!tried.has(fallback.token)) {
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
export async function checkGitHubAuth(): Promise<GitHubAuthStatus> {
  const { token, source } = await resolveGitHubToken();

  if (!token) {
    return {
      authenticated: false,
      method: "none",
      message: messages.authRequired(),
    };
  }

  const tried: string[] = [];
  let current: { token: string; source: GitHubTokenSource } | undefined = {
    token,
    source,
  };
  let lastReason: GitHubAuthFailureReason = "invalid";

  // 401 のときだけ次の credential へ進む。rate limit / SSO / PAT policy は
  // 「このトークンが違う」ではないので、別の資格情報を試しても直らない。
  for (
    let attempt = 0;
    attempt < GITHUB_AUTH_MAX_CREDENTIALS && current;
    attempt++
  ) {
    const probe = await probeGitHubToken(current.token);
    if (probe.ok) {
      return {
        authenticated: true,
        method: current.source,
        message: "GitHub token authenticated",
      };
    }

    lastReason = probe.reason;
    if (probe.reason !== "invalid") {
      return {
        authenticated: probe.reason === "rate-limited",
        method: current.source,
        message: describeAuthFailure(probe.reason),
        reason: probe.reason,
      };
    }

    tried.push(current.token);
    current = await resolveGitHubTokenAfterFailure(current.token, tried);
  }

  return {
    authenticated: false,
    method: "none",
    message: messages.authRequired(),
    reason: lastReason,
  };
}

function describeAuthFailure(reason: GitHubAuthFailureReason): string {
  switch (reason) {
    case "rate-limited":
      return "GitHub token accepted but rate limited";
    case "sso-required":
      return "GitHub token requires SAML SSO authorization for this organization";
    case "forbidden":
      return "GitHub token was rejected by policy or lacks the required scope";
    case "unreachable":
      return "GitHub could not be reached to verify the token";
    default:
      return messages.authRequired();
  }
}

/**
 * `/user` の応答を「無効」「レート制限」「SSO 未承認」「権限不足」「到達不能」へ分類する。
 * すべてを 403 や「未認証」へ丸めると、有効なトークンを捨てる誘導になる。
 */
async function probeGitHubToken(
  token: string,
): Promise<{ ok: true } | { ok: false; reason: GitHubAuthFailureReason }> {
  let response: Response;
  try {
    response = await fetch("https://api.github.com/user", {
      headers: { Authorization: `token ${token}` },
      signal: AbortSignal.timeout(GITHUB_AUTH_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }

  if (response.ok) {
    return { ok: true };
  }
  if (response.status === 401) {
    return { ok: false, reason: "invalid" };
  }
  if (response.status === 403 || response.status === 429) {
    return { ok: false, reason: classifyForbidden(response) };
  }
  return { ok: false, reason: "unreachable" };
}

function classifyForbidden(
  response: Pick<Response, "status" | "headers">,
): GitHubAuthFailureReason {
  if (response.headers.get("x-github-sso")) {
    return "sso-required";
  }
  // secondary rate limit は `x-ratelimit-remaining` が 0 にならず
  // `retry-after` だけが付くことがある
  // https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
  if (
    response.status === 429 ||
    response.headers.get("x-ratelimit-remaining") === "0" ||
    response.headers.get("retry-after")
  ) {
    return "rate-limited";
  }
  return "forbidden";
}
