#!/usr/bin/env node

// 認証復旧後の再試行を「実際に走らせて」確認する。
//
// これまでの防御は extension.ts をソース正規表現で見るだけだったので、
// 「再試行を配線した」のに先行 return で到達しない回帰を 2 回出荷した。
// ここでは src/authRecovery.ts を実行し、retry が走る条件と走らない条件を固定する。

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const srcDir = path.join(__dirname, "..", "src");
const { createAuthRecovery } = require(path.join(srcDir, "authRecovery.ts"));
const { GitHubResponseError } = require(path.join(srcDir, "githubResponse.ts"));

let failures = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

/**
 * seam をすべて記録する。既定では「認証を直せた」体で onRecovered を呼ぶ。
 * 呼ばれた seam を数えることで、誤配線をテスト側から見える形にする。
 */
function createHarness(overrides = {}) {
  const calls = {
    showAuthHelp: [],
    warnings: [],
    openedUrls: [],
    ssoCacheResets: 0,
    retries: 0,
  };

  const seams = {
    showAuthHelp: async (options) => {
      calls.showAuthHelp.push(options);
      if (options?.onRecovered && harness.recoverySucceeds) {
        await options.onRecovered();
      }
    },
    showWarningMessage: async (message, ...actions) => {
      calls.warnings.push({ message, actions });
      return harness.warningChoice(actions);
    },
    openExternal: async (url) => {
      calls.openedUrls.push(url);
    },
    messages: {
      actionOpenGitHubSso: () => "Open SSO",
      actionConfigureGitHubAuth: () => "Configure auth",
    },
    resetGitHubSsoCache: () => {
      calls.ssoCacheResets += 1;
    },
    formatStaleSourceFailureReason: (error) =>
      error instanceof Error ? error.message : String(error),
    ...overrides,
  };

  const harness = {
    calls,
    recoverySucceeds: true,
    warningChoice: () => undefined,
    retry: async () => {
      calls.retries += 1;
    },
    recovery: createAuthRecovery(seams),
  };

  return harness;
}

function authRequiredError() {
  return new GitHubResponseError("auth-required", 403, "GitHub API 403");
}

function ssoError() {
  return new GitHubResponseError(
    "sso-required",
    403,
    "SAML enforcement",
    undefined,
    "https://github.com/orgs/acme/sso",
  );
}

async function main() {
  await test("every classified auth failure recovers and retries exactly once", async () => {
    // kind を 1 つ落としても気付けるよう、分類対象すべてを回す
    for (const kind of [
      "auth-required",
      "rate-limit",
      "sso-required",
      "classic-pat-forbidden",
    ]) {
      const harness = createHarness();
      const handled = await harness.recovery.offerGitHubFailureRecovery(
        new GitHubResponseError(kind, 403, `GitHub API ${kind}`),
        (reason) => `update failed: ${reason}`,
        harness.retry,
      );

      assert.strictEqual(handled, true, `${kind} must be handled here`);
      assert.strictEqual(harness.calls.showAuthHelp.length, 1, kind);
      assert.strictEqual(harness.calls.retries, 1, kind);
    }
  });

  await test("classified auth failure recovers and retries exactly once", async () => {
    const harness = createHarness();
    const handled = await harness.recovery.offerGitHubFailureRecovery(
      authRequiredError(),
      (reason) => `update failed: ${reason}`,
      harness.retry,
    );

    assert.strictEqual(handled, true, "classified error must be handled here");
    assert.strictEqual(harness.calls.showAuthHelp.length, 1);
    assert.strictEqual(harness.calls.retries, 1);
  });

  await test("unclassified but auth-looking failure also retries once", async () => {
    const harness = createHarness();
    const error = new Error(
      "GitHub API へのアクセスが拒否されました (403)。認証が必要です。",
    );

    assert.strictEqual(
      harness.recovery.isGitHubAuthFailure(error),
      true,
      "japanese wording must still reach the auth surface",
    );
    assert.strictEqual(
      harness.recovery.shouldOfferGitHubAuth(error),
      false,
      "unclassified errors must fall through to the retry helper",
    );

    await harness.recovery.showAuthHelpWithRetry(harness.retry);
    assert.strictEqual(harness.calls.retries, 1);
  });

  await test("non-auth failure never opens the auth surface", async () => {
    const harness = createHarness();
    const error = new Error("No skills found");

    assert.strictEqual(harness.recovery.isGitHubAuthFailure(error), false);
    const handled = await harness.recovery.offerGitHubFailureRecovery(
      error,
      (reason) => reason,
      harness.retry,
    );

    assert.strictEqual(handled, false, "caller must keep its default handling");
    assert.strictEqual(harness.calls.showAuthHelp.length, 0);
    assert.strictEqual(harness.calls.retries, 0);
  });

  await test("dismissing the SSO prompt does not retry", async () => {
    const harness = createHarness();
    harness.warningChoice = () => undefined;

    const handled = await harness.recovery.offerGitHubFailureRecovery(
      ssoError(),
      (reason) => reason,
      harness.retry,
    );

    assert.strictEqual(handled, true);
    assert.strictEqual(harness.calls.warnings.length, 1);
    assert.strictEqual(harness.calls.showAuthHelp.length, 0);
    assert.strictEqual(harness.calls.retries, 0);
    assert.strictEqual(harness.calls.openedUrls.length, 0);
  });

  await test("SSO branch opens the url, resets the cache, and skips retry", async () => {
    const harness = createHarness();
    harness.warningChoice = (actions) => actions[0];

    const handled = await harness.recovery.offerGitHubFailureRecovery(
      ssoError(),
      (reason) => reason,
      harness.retry,
    );

    assert.strictEqual(handled, true);
    assert.deepStrictEqual(Array.from(harness.calls.openedUrls), [
      "https://github.com/orgs/acme/sso",
    ]);
    assert.strictEqual(harness.calls.ssoCacheResets, 1);
    // SSO を開いた直後は認可が済んでいないので、ここで再試行してはいけない
    assert.strictEqual(harness.calls.retries, 0);
    assert.strictEqual(harness.calls.showAuthHelp.length, 0);
  });

  await test("choosing auth config from the SSO prompt retries once", async () => {
    const harness = createHarness();
    harness.warningChoice = (actions) => actions[1];

    await harness.recovery.offerGitHubFailureRecovery(
      ssoError(),
      (reason) => reason,
      harness.retry,
    );

    assert.strictEqual(harness.calls.showAuthHelp.length, 1);
    assert.strictEqual(harness.calls.retries, 1);
  });

  await test("a failure raised during a retry does not offer another retry", async () => {
    const harness = createHarness();
    let nested = 0;

    harness.retry = async () => {
      harness.calls.retries += 1;
      nested += 1;
      if (nested > 3) {
        throw new Error("retry recursion guard tripped");
      }
      // 再試行中にまた認証エラーが出たケース
      await harness.recovery.showAuthHelpWithRetry(harness.retry);
    };

    await harness.recovery.showAuthHelpWithRetry(harness.retry);

    assert.strictEqual(harness.calls.retries, 1, "retry must not re-enter");
    assert.strictEqual(harness.calls.showAuthHelp.length, 2);
    assert.strictEqual(
      harness.calls.showAuthHelp[1],
      undefined,
      "the nested call must not carry an onRecovered closure",
    );
  });

  await test("the in-flight guard is released after the retry finishes", async () => {
    const harness = createHarness();

    await harness.recovery.showAuthHelpWithRetry(harness.retry);
    await harness.recovery.showAuthHelpWithRetry(harness.retry);

    assert.strictEqual(harness.calls.retries, 2);
  });

  await test("a throwing retry still releases the in-flight guard", async () => {
    const harness = createHarness();
    harness.retry = async () => {
      harness.calls.retries += 1;
      throw new Error("update failed again");
    };

    await assert.rejects(() =>
      harness.recovery.showAuthHelpWithRetry(harness.retry),
    );

    harness.retry = async () => {
      harness.calls.retries += 1;
    };
    await harness.recovery.showAuthHelpWithRetry(harness.retry);

    assert.strictEqual(harness.calls.retries, 2);
  });

  await test("each factory owns its own in-flight state", async () => {
    const first = createHarness();
    const second = createHarness();

    // first が再試行中でも、別インスタンスの再試行は止まらない。
    // in-flight フラグを module global に移すとここで落ちる
    first.retry = async () => {
      first.calls.retries += 1;
      await second.recovery.showAuthHelpWithRetry(second.retry);
    };

    await first.recovery.showAuthHelpWithRetry(first.retry);

    assert.strictEqual(first.calls.retries, 1);
    assert.strictEqual(second.calls.retries, 1);
  });

  if (failures > 0) {
    console.error(`\n${failures} auth recovery retry test(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("\nAuth recovery retry tests passed.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
