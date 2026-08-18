// GitHub 認証失敗の分類と、復旧できたときの再試行導線。
//
// extension.ts に置いていたときは実行時に検証できず、「再試行を配線した」のに
// 先行 return で到達しない回帰を 2 回出荷した。VS Code API を seam として注入し、
// 実挙動をテストできる形にしてある。

import {
  GitHubResponseError,
  isGitHubResponseError,
  looksLikeGitHubAuthMessage,
} from "./githubResponse";

export interface AuthRecoveryMessages {
  actionOpenGitHubSso: () => string;
  actionConfigureGitHubAuth: () => string;
}

export interface AuthRecoverySeams {
  showAuthHelp: (options?: {
    onRecovered?: () => Promise<void>;
  }) => Promise<void>;
  showWarningMessage: (
    message: string,
    ...actions: string[]
  ) => PromiseLike<string | undefined>;
  /** URL 文字列で受けることで、テストが vscode.Uri を用意せずに済む */
  openExternal: (url: string) => Promise<void>;
  messages: AuthRecoveryMessages;
  resetGitHubSsoCache: () => void;
  formatStaleSourceFailureReason: (error: unknown) => string;
}

export interface AuthRecovery {
  shouldOfferGitHubAuth(error: unknown): error is GitHubResponseError;
  isGitHubAuthFailure(error: unknown): boolean;
  showAuthHelpWithRetry(
    retryFailedOperation: () => Promise<void>,
  ): Promise<void>;
  offerGitHubFailureRecovery(
    error: unknown,
    formatMessage: (reason: string) => string,
    onRecovered?: () => Promise<void>,
  ): Promise<boolean>;
}

export function createAuthRecovery(seams: AuthRecoverySeams): AuthRecovery {
  // 再試行中の失敗からさらに再試行を提案すると、同じ操作を無限に往復できてしまう
  let authRecoveryRetryInFlight = false;

  function shouldOfferGitHubAuth(error: unknown): error is GitHubResponseError {
    return (
      isGitHubResponseError(error) &&
      [
        "rate-limit",
        "sso-required",
        "classic-pat-forbidden",
        "auth-required",
      ].includes(error.kind)
    );
  }

  /** 分類できない error も認証導線へ入れる。個別 command で条件を書き分けない */
  function isGitHubAuthFailure(error: unknown): boolean {
    return (
      shouldOfferGitHubAuth(error) ||
      looksLikeGitHubAuthMessage(
        error instanceof Error ? error.message : String(error),
      )
    );
  }

  /** onRecoveredを持たない呼び出しも同じ再入防止を通るよう、ここへ集める */
  async function runAuthHelp(
    retryFailedOperation?: () => Promise<void>,
  ): Promise<void> {
    if (!retryFailedOperation || authRecoveryRetryInFlight) {
      await seams.showAuthHelp();
      return;
    }

    await seams.showAuthHelp({
      onRecovered: async () => {
        authRecoveryRetryInFlight = true;
        try {
          await retryFailedOperation();
        } finally {
          authRecoveryRetryInFlight = false;
        }
      },
    });
  }

  /**
   * 認証を直せたときだけ、失敗した操作そのものを 1 回だけやり直す。
   * command を再実行すると入力を再要求するので、呼び出し側は捕捉済みの引数を閉じ込めた
   * closure を渡す。
   */
  async function showAuthHelpWithRetry(
    retryFailedOperation: () => Promise<void>,
  ): Promise<void> {
    await runAuthHelp(retryFailedOperation);
  }

  /**
   * 文字列一致ではなく分類で GitHub の失敗を扱う。扱えなければ false を返し、
   * 呼び出し側の既定処理へ戻す。
   */
  async function offerGitHubFailureRecovery(
    error: unknown,
    formatMessage: (reason: string) => string,
    onRecovered?: () => Promise<void>,
  ): Promise<boolean> {
    if (!shouldOfferGitHubAuth(error)) {
      return false;
    }

    const ssoUrl = error.ssoAuthorizationUrl;
    if (!ssoUrl) {
      await runAuthHelp(onRecovered);
      return true;
    }

    const ssoAction = seams.messages.actionOpenGitHubSso();
    const authAction = seams.messages.actionConfigureGitHubAuth();
    const action = await seams.showWarningMessage(
      formatMessage(seams.formatStaleSourceFailureReason(error)),
      ssoAction,
      authAction,
    );
    if (action === ssoAction) {
      await seams.openExternal(ssoUrl);
      seams.resetGitHubSsoCache();
    } else if (action === authAction) {
      await runAuthHelp(onRecovered);
    }

    return true;
  }

  return {
    shouldOfferGitHubAuth,
    isGitHubAuthFailure,
    showAuthHelpWithRetry,
    offerGitHubFailureRecovery,
  };
}
