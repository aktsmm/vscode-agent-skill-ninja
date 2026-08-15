#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const secrets = new Map();
let configToken = "";
let workspaceConfigToken = "";
let folderConfigTokens = new Map();
let workspaceFolders = [];
let configUpdates = [];
let execCalls = [];
let execBehavior = "error";
let githubAuthModule;
let informationMessages = [];
let errorMessages = [];
let secretDeleteError;
let warningMessages = [];
let warningChoice;
let globalStateStore = new Map();

const vscodeMock = {
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  window: {
    async showInformationMessage(message) {
      informationMessages.push(message);
      return undefined;
    },
    async showErrorMessage(message) {
      errorMessages.push(message);
      return undefined;
    },
    async showWarningMessage(message, ...actions) {
      warningMessages.push({ message, actions });
      return warningChoice;
    },
  },
  workspace: {
    get workspaceFolders() {
      return workspaceFolders;
    },
    getConfiguration(section, scope) {
      assert.strictEqual(section, "skillNinja");
      const folderKey = scope?.fsPath;
      return {
        get(key) {
          if (key === "githubToken") {
            return configToken;
          }
          return undefined;
        },
        inspect(key) {
          if (key !== "githubToken") {
            return undefined;
          }
          return {
            key: "skillNinja.githubToken",
            defaultValue: "",
            globalValue: configToken || undefined,
            workspaceValue: workspaceConfigToken || undefined,
            // resource scope なしでは folder の値は解決できない
            workspaceFolderValue: folderKey
              ? folderConfigTokens.get(folderKey) || undefined
              : undefined,
          };
        },
        async update(key, value, target) {
          configUpdates.push({ key, value, target, folder: folderKey });
          if (key !== "githubToken" || value !== undefined) {
            return;
          }
          if (target === vscodeMock.ConfigurationTarget.WorkspaceFolder) {
            assert.ok(
              folderKey,
              "a workspace-folder update needs the folder's resource scope",
            );
            folderConfigTokens.delete(folderKey);
          } else if (target === vscodeMock.ConfigurationTarget.Workspace) {
            workspaceConfigToken = "";
          } else {
            configToken = "";
          }
        },
      };
    },
  },
};

const i18nMock = {
  messages: {
    authRequired: () => "GitHub authentication required",
    githubTokenCleared: () => "token cleared",
    githubTokenNotStored: () => "token not stored",
    githubTokenClearFailed: () => "token clear failed",
    githubTokenRemoveLegacyPlaintext: () => "remove plaintext",
    githubTokenLegacyPlaintextFound: () => "migrated, copy remains",
    githubTokenLegacyPlaintextOnly: () => "not migrated, copy it first",
    githubTokenLegacyPlaintextRemoved: () => "plaintext removed",
    githubTokenLegacyPlaintextRemoveFailed: () => "plaintext remove failed",
    actionCancel: () => "cancel",
    actionDontAskAgain: () => "dont ask again",
  },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "vscode") {
    return vscodeMock;
  }
  if (request === "./i18n") {
    return i18nMock;
  }
  if (request === "./githubAuth" && githubAuthModule) {
    return githubAuthModule;
  }
  if (request === "child_process") {
    return {
      exec(command, options, callback) {
        execCalls.push({ command, options });
        assert.strictEqual(command, "gh auth token --hostname github.com");
        assert.strictEqual(options.timeout, 5000);
        assert.strictEqual(options.windowsHide, true);
        assert.ok(
          options.env && typeof options.env === "object",
          "gh CLI must run with an explicit env",
        );
        assert.strictEqual(
          options.env.GH_TOKEN,
          undefined,
          "stale GH_TOKEN must not leak into gh auth token",
        );
        assert.strictEqual(
          options.env.GITHUB_TOKEN,
          undefined,
          "stale GITHUB_TOKEN must not leak into gh auth token",
        );

        switch (execBehavior) {
          case "token":
            callback(null, "gh-token\n");
            break;
          case "empty":
            callback(null, "\n");
            break;
          default:
            callback(new Error("gh unavailable"), "");
            break;
        }
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function requireTypeScriptModule(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  });

  const loadedModule = new Module(filePath, module);
  loadedModule.filename = filePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(filePath));
  loadedModule._compile(transpiled.outputText, filePath);
  return loadedModule.exports;
}

async function test(name, fn) {
  try {
    secrets.clear();
    configToken = "";
    workspaceConfigToken = "";
    folderConfigTokens = new Map();
    workspaceFolders = [];
    configUpdates = [];
    execCalls = [];
    execBehavior = "error";
    informationMessages = [];
    errorMessages = [];
    warningMessages = [];
    warningChoice = undefined;
    globalStateStore = new Map();
    secretDeleteError = undefined;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main() {
  const auth = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "githubAuth.ts"),
  );
  githubAuthModule = auth;
  const githubFetch = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "githubFetch.ts"),
  );

  const context = {
    secrets: {
      get: async (key) => secrets.get(key),
      store: async (key, value) => {
        secrets.set(key, value);
      },
      delete: async (key) => {
        if (secretDeleteError) {
          throw secretDeleteError;
        }
        secrets.delete(key);
      },
    },
    globalState: {
      get: () => undefined,
      update: async () => {
        throw new Error(
          "the plaintext prompt is per-workspace, so it must not use globalState",
        );
      },
    },
    workspaceState: {
      get: (key, fallback) =>
        globalStateStore.has(key) ? globalStateStore.get(key) : fallback,
      update: async (key, value) => {
        if (value === undefined) {
          globalStateStore.delete(key);
        } else {
          globalStateStore.set(key, value);
        }
      },
    },
  };

  auth.initializeGitHubAuth(context);

  await test("SecretStorage token wins over env and legacy config", async () => {
    await context.secrets.store("skillNinja.githubToken", "secret-token");
    process.env.GITHUB_TOKEN = "env-token";
    configToken = "config-token";

    const result = await auth.resolveGitHubToken();
    assert.deepStrictEqual(result, {
      token: "secret-token",
      source: "secret",
    });
  });

  await test("stale SecretStorage token can be excluded", async () => {
    await context.secrets.store("skillNinja.githubToken", "secret-token");
    execBehavior = "token";

    const result = await auth.resolveGitHubToken({
      excludeSources: ["secret"],
    });
    assert.deepStrictEqual(result, {
      token: "gh-token",
      source: "gh-cli",
    });
  });

  await test("stale SecretStorage failure resolves to gh CLI", async () => {
    await context.secrets.store("skillNinja.githubToken", "secret-token");
    execBehavior = "token";

    const result = await auth.resolveGitHubTokenAfterFailure("secret-token");
    assert.deepStrictEqual(result, {
      token: "gh-token",
      source: "gh-cli",
    });
  });

  await test("credential change during failure uses the current token", async () => {
    await context.secrets.store("skillNinja.githubToken", "secret-token");
    process.env.GITHUB_TOKEN = "env-token";
    await context.secrets.delete("skillNinja.githubToken");

    const result = await auth.resolveGitHubTokenAfterFailure("secret-token");
    assert.deepStrictEqual(result, {
      token: "env-token",
      source: "env",
    });
  });

  await test("auth check retries stale secret with gh CLI", async () => {
    await context.secrets.store("skillNinja.githubToken", "secret-token");
    execBehavior = "token";
    const requests = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      return {
        ok: options.headers.Authorization === "token gh-token",
        status: options.headers.Authorization === "token gh-token" ? 200 : 401,
      };
    };

    try {
      const result = await auth.checkGitHubAuth();
      assert.deepStrictEqual(result, {
        authenticated: true,
        method: "gh-cli",
        message: "GitHub token authenticated",
      });
      assert.strictEqual(requests.length, 2);
      assert.strictEqual(auth.GITHUB_AUTH_TIMEOUT_MS, 5000);
      assert.ok(
        requests.every(({ options }) => options.signal instanceof AbortSignal),
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test("env token wins over legacy config when no secret exists", async () => {
    process.env.GH_TOKEN = "env-token";
    configToken = "config-token";

    const result = await auth.resolveGitHubToken();
    assert.deepStrictEqual(result, {
      token: "env-token",
      source: "env",
    });
  });

  await test("GH_TOKEN wins over GITHUB_TOKEN", async () => {
    process.env.GITHUB_TOKEN = "github-token-var";
    process.env.GH_TOKEN = "gh-token-var";

    const result = await auth.resolveGitHubToken();
    assert.deepStrictEqual(result, {
      token: "gh-token-var",
      source: "env",
    });
  });

  await test("stale env token still yields the gh CLI credential", async () => {
    process.env.GH_TOKEN = "stale-env-token";
    execBehavior = "token";

    const fallback =
      await auth.resolveGitHubTokenAfterFailure("stale-env-token");
    assert.deepStrictEqual(fallback, {
      token: "gh-token",
      source: "gh-cli",
    });
  });

  await test("rate limited token is not reported as unauthenticated", async () => {
    await context.secrets.store("skillNinja.githubToken", "secret-token");
    execBehavior = "token";
    const requests = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      return {
        ok: false,
        status: 403,
        headers: new Map([["x-ratelimit-remaining", "0"]]),
      };
    };

    try {
      const result = await auth.checkGitHubAuth();
      assert.strictEqual(result.authenticated, true);
      assert.strictEqual(result.method, "secret");
      assert.strictEqual(result.reason, "rate-limited");
      assert.strictEqual(
        requests.length,
        1,
        "rate limit must not burn other credentials",
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test("SSO and policy failures are not collapsed into one reason", async () => {
    const originalFetch = global.fetch;
    const cases = [
      { headers: [["x-github-sso", "required"]], reason: "sso-required" },
      { headers: [], reason: "forbidden" },
      // secondary rate limit は remaining が 0 にならず retry-after だけ付く
      { headers: [["retry-after", "60"]], reason: "rate-limited" },
    ];

    try {
      for (const testCase of cases) {
        await context.secrets.store("skillNinja.githubToken", "secret-token");
        process.env.GH_TOKEN = "another-token";
        execBehavior = "token";
        let requestCount = 0;
        global.fetch = async () => {
          requestCount += 1;
          return {
            ok: false,
            status: 403,
            headers: new Map(testCase.headers),
          };
        };

        const result = await auth.checkGitHubAuth();
        assert.strictEqual(result.reason, testCase.reason);
        assert.strictEqual(
          result.authenticated,
          testCase.reason === "rate-limited",
        );
        assert.strictEqual(
          requestCount,
          1,
          `${testCase.reason} must not burn the other credentials`,
        );
        assert.ok(
          !JSON.stringify(result).includes("secret-token"),
          "auth status must not echo the token value",
        );
      }
    } finally {
      global.fetch = originalFetch;
      secrets.clear();
      delete process.env.GH_TOKEN;
    }
  });

  await test("legacy config token is copied to SecretStorage", async () => {
    configToken = "config-token";

    const migrated = await auth.migrateConfiguredGitHubTokenToSecretStorage();
    assert.strictEqual(migrated, true);
    assert.strictEqual(
      await context.secrets.get("skillNinja.githubToken"),
      "config-token",
    );

    const migratedAgain =
      await auth.migrateConfiguredGitHubTokenToSecretStorage();
    assert.strictEqual(migratedAgain, false);
  });

  await test("workspace plaintext token is migrated even at machine scope", async () => {
    workspaceConfigToken = "workspace-token";

    assert.deepStrictEqual(auth.inspectLegacyConfiguredTokens(), [
      { scope: "workspace", token: "workspace-token" },
    ]);

    const migrated = await auth.migrateConfiguredGitHubTokenToSecretStorage();
    assert.strictEqual(migrated, true);
    assert.strictEqual(
      await context.secrets.get("skillNinja.githubToken"),
      "workspace-token",
    );
  });

  await test("resolution keeps the pre-machine-scope order and ignores folder values", async () => {
    const folderUri = { fsPath: "/repo/pkg-a" };
    workspaceFolders = [{ uri: folderUri }];
    folderConfigTokens.set(folderUri.fsPath, "folder-token");
    workspaceConfigToken = "workspace-token";
    configToken = "global-token";

    // 検出は全スコープ、解決は resource なしの get() が返していた値だけ
    assert.deepStrictEqual(
      auth.inspectLegacyConfiguredTokens().map(({ scope }) => scope),
      ["workspaceFolder", "workspace", "global"],
    );

    const resolved = await auth.resolveGitHubToken();
    assert.deepStrictEqual(resolved, {
      token: "workspace-token",
      source: "config",
    });

    const migrated = await auth.migrateConfiguredGitHubTokenToSecretStorage();
    assert.strictEqual(migrated, true);
    assert.strictEqual(
      await context.secrets.get("skillNinja.githubToken"),
      "workspace-token",
    );
  });

  await test("a folder-only plaintext token is never promoted to SecretStorage", async () => {
    const folderA = { fsPath: "/repo/pkg-a" };
    const folderB = { fsPath: "/repo/pkg-b" };
    workspaceFolders = [{ uri: folderA }, { uri: folderB }];
    folderConfigTokens.set(folderA.fsPath, "folder-a-token");
    folderConfigTokens.set(folderB.fsPath, "folder-b-token");

    assert.deepStrictEqual(await auth.resolveGitHubToken(), {
      token: undefined,
      source: "none",
    });
    assert.strictEqual(
      await auth.migrateConfiguredGitHubTokenToSecretStorage(),
      false,
      "one folder's PAT must not become the machine-wide credential",
    );
    assert.strictEqual(
      await context.secrets.get("skillNinja.githubToken"),
      undefined,
    );
    // 平文としては残っているので、検出と削除の対象からは外さない
    assert.strictEqual(auth.inspectLegacyConfiguredTokens().length, 2);
  });

  await test("a plaintext value that was not migrated is reported as unmigrated", async () => {
    const folder = { fsPath: "/repo/pkg-a" };
    workspaceFolders = [{ uri: folder }];
    folderConfigTokens.set(folder.fsPath, "folder-token");
    workspaceConfigToken = "workspace-token";

    assert.strictEqual(
      await auth.migrateConfiguredGitHubTokenToSecretStorage(),
      true,
    );
    assert.strictEqual(
      await auth.hasUnmigratedLegacyPlaintextToken(),
      true,
      "a distinct folder PAT is about to be deleted without being saved anywhere",
    );

    folderConfigTokens.delete(folder.fsPath);
    assert.strictEqual(
      await auth.hasUnmigratedLegacyPlaintextToken(),
      false,
      "the remaining plaintext is the value now held in SecretStorage",
    );
  });

  await test("multi-root folder plaintext copies are found and removed", async () => {
    const folderA = { fsPath: "/repo/pkg-a" };
    const folderB = { fsPath: "/repo/pkg-b" };
    workspaceFolders = [{ uri: folderA }, { uri: folderB }];
    folderConfigTokens.set(folderA.fsPath, "folder-a-token");
    folderConfigTokens.set(folderB.fsPath, "folder-b-token");

    assert.deepStrictEqual(
      auth.inspectLegacyConfiguredTokens().map(({ token }) => token),
      ["folder-a-token", "folder-b-token"],
    );

    const result = await auth.removeLegacyConfiguredGitHubTokens();
    assert.deepStrictEqual(
      { removed: [...result.removed], remaining: result.remaining },
      { removed: ["workspaceFolder", "workspaceFolder"], remaining: 0 },
    );
    assert.deepStrictEqual(auth.inspectLegacyConfiguredTokens(), []);
  });

  await test("clearing removes the plaintext copies in every settings scope", async () => {
    configToken = "config-token";
    workspaceConfigToken = "workspace-token";

    const result = await auth.removeLegacyConfiguredGitHubTokens();
    assert.deepStrictEqual(
      { removed: [...result.removed], remaining: result.remaining },
      { removed: ["workspace", "global"], remaining: 0 },
    );
    assert.deepStrictEqual(auth.inspectLegacyConfiguredTokens(), []);
    assert.deepStrictEqual(
      configUpdates.map(({ key, value, target }) => ({ key, value, target })),
      [
        { key: "githubToken", value: undefined, target: 2 },
        { key: "githubToken", value: undefined, target: 1 },
      ],
    );
  });

  await test("a plaintext copy that survives removal is not reported as cleared", async () => {
    const stubborn = { fsPath: "/repo/locked" };
    workspaceFolders = [{ uri: stubborn }];
    folderConfigTokens.set(stubborn.fsPath, "stuck-token");
    workspaceConfigToken = "workspace-token";
    const originalDelete = folderConfigTokens.delete.bind(folderConfigTokens);
    folderConfigTokens.delete = () => {
      throw new Error("settings.json is read-only");
    };

    try {
      const result = await auth.removeLegacyConfiguredGitHubTokens();
      assert.deepStrictEqual([...result.removed], ["workspace"]);
      assert.strictEqual(result.remaining, 1);

      await auth.clearStoredGitHubTokenWithFeedback();
      assert.deepStrictEqual(informationMessages, []);
      assert.deepStrictEqual(errorMessages, ["token clear failed"]);
    } finally {
      folderConfigTokens.delete = originalDelete;
    }
  });

  await test("clear command reports success when only plaintext existed", async () => {
    workspaceConfigToken = "workspace-token";

    await auth.clearStoredGitHubTokenWithFeedback();
    assert.deepStrictEqual(informationMessages, ["token cleared"]);
    assert.deepStrictEqual(auth.inspectLegacyConfiguredTokens(), []);
  });

  await test("no plaintext means no startup prompt", async () => {
    await auth.offerToRemoveLegacyPlaintextGitHubToken();
    assert.deepStrictEqual(warningMessages, []);
  });

  await test("cancelling the plaintext prompt keeps asking next startup", async () => {
    workspaceConfigToken = "workspace-token";
    warningChoice = "cancel";

    await auth.offerToRemoveLegacyPlaintextGitHubToken();
    assert.strictEqual(warningMessages.length, 1);
    assert.deepStrictEqual(warningMessages[0].actions, [
      "remove plaintext",
      "dont ask again",
      "cancel",
    ]);
    assert.strictEqual(
      auth.inspectLegacyConfiguredTokens().length,
      1,
      "cancelling must not delete the plaintext copy",
    );

    await auth.offerToRemoveLegacyPlaintextGitHubToken();
    assert.strictEqual(
      warningMessages.length,
      2,
      "a security nudge must survive an accidental dismiss",
    );
  });

  await test("dismissing the plaintext prompt stops the startup nag", async () => {
    workspaceConfigToken = "workspace-token";
    warningChoice = "dont ask again";

    await auth.offerToRemoveLegacyPlaintextGitHubToken();
    assert.strictEqual(warningMessages.length, 1);
    assert.strictEqual(
      globalStateStore.get("skillNinja.legacyPlaintextTokenPromptDismissed"),
      true,
    );

    warningChoice = undefined;
    await auth.offerToRemoveLegacyPlaintextGitHubToken();
    assert.strictEqual(
      warningMessages.length,
      1,
      "a dismissed prompt must not return on every window",
    );

    await auth.resetLegacyPlaintextPrompt();
    await auth.offerToRemoveLegacyPlaintextGitHubToken();
    assert.strictEqual(
      warningMessages.length,
      2,
      "Reset Settings must be able to bring the prompt back",
    );
  });

  await test("accepting the plaintext prompt removes every copy", async () => {
    const folder = { fsPath: "/repo/pkg-a" };
    workspaceFolders = [{ uri: folder }];
    folderConfigTokens.set(folder.fsPath, "folder-token");
    workspaceConfigToken = "workspace-token";
    warningChoice = "remove plaintext";

    await auth.offerToRemoveLegacyPlaintextGitHubToken();
    assert.strictEqual(
      warningMessages[0].message,
      "not migrated, copy it first",
      "a distinct folder PAT is deleted without being saved, so say so",
    );
    assert.deepStrictEqual(auth.inspectLegacyConfiguredTokens(), []);
    assert.deepStrictEqual(informationMessages, ["plaintext removed"]);
  });

  await test("gh CLI token uses bounded exec options", async () => {
    execBehavior = "token";

    const result = await auth.resolveGitHubToken();
    assert.deepStrictEqual(result, {
      token: "gh-token",
      source: "gh-cli",
    });
    assert.strictEqual(execCalls.length, 1);
  });

  await test("gh CLI errors fall back to legacy config", async () => {
    execBehavior = "error";
    configToken = "config-token";

    const result = await auth.resolveGitHubToken();
    assert.deepStrictEqual(result, {
      token: "config-token",
      source: "config",
    });
    assert.strictEqual(execCalls.length, 1);
  });

  await test("empty gh CLI output resolves to none", async () => {
    execBehavior = "empty";

    const result = await auth.resolveGitHubToken();
    assert.deepStrictEqual(result, {
      token: undefined,
      source: "none",
    });
    assert.strictEqual(execCalls.length, 1);
  });

  await test("stored token can be deleted", async () => {
    await context.secrets.store("skillNinja.githubToken", "secret-token");

    const deleted = await auth.deleteStoredGitHubToken();
    assert.strictEqual(deleted, true);
    assert.strictEqual(
      await context.secrets.get("skillNinja.githubToken"),
      undefined,
    );
  });

  await test("missing stored token reports no deletion", async () => {
    const deleted = await auth.deleteStoredGitHubToken();
    assert.strictEqual(deleted, false);
  });

  await test("clear-token command handler deletes and confirms", async () => {
    await context.secrets.store("skillNinja.githubToken", "secret-token");

    await auth.clearStoredGitHubTokenWithFeedback();

    assert.strictEqual(
      await context.secrets.get("skillNinja.githubToken"),
      undefined,
    );
    assert.deepStrictEqual(informationMessages, ["token cleared"]);
  });

  await test("clear-token command handler reports no stored token", async () => {
    await auth.clearStoredGitHubTokenWithFeedback();

    assert.deepStrictEqual(informationMessages, ["token not stored"]);
  });

  await test("clear-token command handler does not confirm failed deletion", async () => {
    await context.secrets.store("skillNinja.githubToken", "secret-token");
    secretDeleteError = new Error("SecretStorage unavailable");

    await auth.clearStoredGitHubTokenWithFeedback();
    assert.deepStrictEqual(informationMessages, []);
    assert.deepStrictEqual(errorMessages, ["token clear failed"]);
    assert.strictEqual(
      await context.secrets.get("skillNinja.githubToken"),
      "secret-token",
    );
  });

  await test("clear waits for startup token migration before deleting", async () => {
    configToken = "legacy-token";
    const originalStore = context.secrets.store;
    let releaseStore;
    let markStoreStarted;
    const storeStarted = new Promise((resolve) => {
      markStoreStarted = resolve;
    });
    const storeGate = new Promise((resolve) => {
      releaseStore = resolve;
    });
    context.secrets.store = async (key, value) => {
      markStoreStarted();
      await storeGate;
      secrets.set(key, value);
    };

    try {
      const migration = auth.migrateConfiguredGitHubTokenToSecretStorage();
      await storeStarted;
      const clear = auth.clearStoredGitHubTokenWithFeedback();
      releaseStore();
      assert.strictEqual(await migration, true);
      await clear;

      assert.strictEqual(
        await context.secrets.get("skillNinja.githubToken"),
        undefined,
      );
      assert.deepStrictEqual(informationMessages, ["token cleared"]);
    } finally {
      context.secrets.store = originalStore;
    }
  });

  await test("stored token presence can be checked without resolving", async () => {
    assert.strictEqual(await auth.hasStoredGitHubToken(), false);
    await context.secrets.store("skillNinja.githubToken", "secret-token");
    assert.strictEqual(await auth.hasStoredGitHubToken(), true);
    assert.strictEqual(execCalls.length, 0);
  });

  await test("GitHub requests use a bounded default timeout", async () => {
    assert.strictEqual(githubFetch.GITHUB_REQUEST_TIMEOUT_MS, 15000);
    const originalFetch = global.fetch;
    global.fetch = async (url, options = {}) =>
      new Promise((resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      });

    try {
      await assert.rejects(
        () =>
          githubFetch.fetchGitHubWithTimeout(
            "https://api.github.com/repos/owner/repo?ref=secret-branch",
            {},
            5,
          ),
        (error) =>
          error.message === "Request timeout: api.github.com/repos/owner/repo",
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test("GitHub call sites use bounded shared requests", async () => {
    const githubFetchSource = fs.readFileSync(
      path.join(__dirname, "..", "src", "githubFetch.ts"),
      "utf8",
    );
    const skillIndexSource = fs.readFileSync(
      path.join(__dirname, "..", "src", "skillIndex.ts"),
      "utf8",
    );

    assert.ok(
      githubFetchSource.includes(
        "const request = options.request ?? fetchGitHubWithTimeout;",
      ),
    );
    assert.ok(
      skillIndexSource.includes("fetchGitHubWithOptionalAuthRetry(url, {"),
    );
    assert.ok(!skillIndexSource.includes('await fetch(url, { method: "HEAD"'));
  });

  await test("caller cancellation is not reported as a timeout", async () => {
    const originalFetch = global.fetch;
    global.fetch = async (url, options = {}) =>
      new Promise((resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => {
            const error = new Error("caller aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      });

    try {
      const controller = new AbortController();
      const request = githubFetch.fetchGitHubWithTimeout(
        "https://api.github.com/repos/owner/repo",
        { signal: controller.signal },
        1000,
      );
      controller.abort();
      await assert.rejects(
        request,
        (error) =>
          error.name === "AbortError" && error.message === "caller aborted",
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test("successful requests release timeout and abort listener", async () => {
    const originalFetch = global.fetch;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    const timeoutHandle = { id: "timeout-handle" };
    let clearedHandle;
    let addedListener;
    let removedListener;
    const callerSignal = {
      aborted: false,
      addEventListener(event, listener) {
        assert.strictEqual(event, "abort");
        addedListener = listener;
      },
      removeEventListener(event, listener) {
        assert.strictEqual(event, "abort");
        removedListener = listener;
      },
    };

    global.setTimeout = (callback, timeoutMs) => {
      assert.strictEqual(timeoutMs, 250);
      return timeoutHandle;
    };
    global.clearTimeout = (handle) => {
      clearedHandle = handle;
    };
    global.fetch = async () => ({ ok: true, status: 200 });

    try {
      const response = await githubFetch.fetchGitHubWithTimeout(
        "https://api.github.com/repos/owner/repo",
        { signal: callerSignal },
        250,
      );
      assert.strictEqual(response.status, 200);
      assert.strictEqual(clearedHandle, timeoutHandle);
      assert.strictEqual(removedListener, addedListener);
    } finally {
      global.fetch = originalFetch;
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }
  });

  await test("public raw content remains anonymous", async () => {
    const requests = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200 };
    };

    try {
      const response = await githubFetch.fetchGitHubWithOptionalAuthRetry(
        "https://raw.githubusercontent.com/owner/repo/main/SKILL.md",
        { accept: "text/plain", token: "test-token" },
      );

      assert.strictEqual(response.status, 200);
      assert.strictEqual(requests.length, 1);
      assert.strictEqual(requests[0].options.headers.Authorization, undefined);
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test("cancelling stops the credential walk", async () => {
    const requests = [];
    const controller = new AbortController();
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      // 最初の応答で中断が入る。次の資格情報を試してはいけない
      controller.abort();
      return { ok: false, status: 401 };
    };

    try {
      await assert.rejects(
        () =>
          githubFetch.fetchGitHubWithOptionalAuthRetry(
            "https://api.github.com/repos/owner/repo",
            {
              accept: "application/vnd.github.v3+json",
              token: "stale-token",
              retry: { signal: controller.signal },
            },
          ),
        (error) => error.name === "AbortError",
      );
      assert.strictEqual(
        requests.length,
        1,
        "no further credential may be tried after the cancellation",
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test("private raw content retries with authentication", async () => {
    const requests = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      return requests.length === 1
        ? { ok: false, status: 404 }
        : { ok: true, status: 200 };
    };

    try {
      const response = await githubFetch.fetchGitHubWithOptionalAuthRetry(
        "https://raw.githubusercontent.com/owner/private-repo/main/SKILL.md",
        { accept: "text/plain", token: "test-token" },
      );

      assert.strictEqual(response.status, 200);
      assert.strictEqual(requests.length, 2);
      assert.strictEqual(requests[0].options.headers.Authorization, undefined);
      assert.strictEqual(
        requests[1].options.headers.Authorization,
        "token test-token",
      );
      assert.strictEqual(requests[1].options.redirect, "error");
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test("private raw HEAD probes preserve the method on auth retry", async () => {
    const requests = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      return requests.length === 1
        ? { ok: false, status: 404 }
        : { ok: true, status: 200 };
    };

    try {
      const response = await githubFetch.fetchGitHubWithOptionalAuthRetry(
        "https://raw.githubusercontent.com/owner/private-repo/main/SKILL.md",
        { accept: "*/*", token: "test-token", method: "HEAD" },
      );

      assert.strictEqual(response.status, 200);
      assert.strictEqual(requests.length, 2);
      assert.ok(requests.every(({ options }) => options.method === "HEAD"));
      assert.strictEqual(requests[0].options.headers.Authorization, undefined);
      assert.strictEqual(
        requests[1].options.headers.Authorization,
        "token test-token",
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test("stale secret API failure retries with gh CLI token", async () => {
    await context.secrets.store("skillNinja.githubToken", "secret-token");
    execBehavior = "token";
    const requests = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      return options.headers.Authorization === "token gh-token"
        ? { ok: true, status: 200 }
        : { ok: false, status: 404 };
    };

    try {
      const response = await githubFetch.fetchGitHubWithOptionalAuthRetry(
        "https://api.github.com/repos/owner/private-repo/contents/SKILL.md",
        { accept: "application/vnd.github+json", token: "secret-token" },
      );

      assert.strictEqual(response.status, 200);
      assert.strictEqual(requests.length, 2);
      assert.strictEqual(
        requests[0].options.headers.Authorization,
        "token secret-token",
      );
      assert.strictEqual(
        requests[1].options.headers.Authorization,
        "token gh-token",
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test("stale secret raw failure retries with gh CLI token", async () => {
    await context.secrets.store("skillNinja.githubToken", "secret-token");
    execBehavior = "token";
    const requests = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      return options.headers.Authorization === "token gh-token"
        ? { ok: true, status: 200 }
        : { ok: false, status: 404 };
    };

    try {
      const response = await githubFetch.fetchGitHubWithOptionalAuthRetry(
        "https://raw.githubusercontent.com/owner/private-repo/main/SKILL.md",
        { accept: "text/plain", token: "secret-token" },
      );

      assert.strictEqual(response.status, 200);
      assert.strictEqual(requests.length, 3);
      assert.strictEqual(requests[0].options.headers.Authorization, undefined);
      assert.strictEqual(
        requests[1].options.headers.Authorization,
        "token secret-token",
      );
      assert.strictEqual(
        requests[2].options.headers.Authorization,
        "token gh-token",
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test("stale env token retries with the gh CLI token", async () => {
    process.env.GITHUB_TOKEN = "env-token";
    execBehavior = "token";
    const requests = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      return options.headers.Authorization === "token gh-token"
        ? { ok: true, status: 200 }
        : { ok: false, status: 404 };
    };

    try {
      const response = await githubFetch.fetchGitHubWithOptionalAuthRetry(
        "https://api.github.com/repos/owner/private-repo/contents/SKILL.md",
        { accept: "application/vnd.github+json", token: "env-token" },
      );

      assert.strictEqual(response.status, 200);
      assert.strictEqual(requests.length, 2);
      assert.strictEqual(
        requests[0].options.headers.Authorization,
        "token env-token",
      );
      assert.strictEqual(
        requests[1].options.headers.Authorization,
        "token gh-token",
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test("walks past several stale credentials in one request", async () => {
    await context.secrets.store("skillNinja.githubToken", "secret-token");
    process.env.GITHUB_TOKEN = "env-token";
    execBehavior = "token";
    const requests = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      return options.headers.Authorization === "token gh-token"
        ? { ok: true, status: 200 }
        : { ok: false, status: 404 };
    };

    try {
      const response = await githubFetch.fetchGitHubWithOptionalAuthRetry(
        "https://api.github.com/repos/owner/private-repo/contents/SKILL.md",
        { accept: "application/vnd.github+json", token: "secret-token" },
      );

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(
        requests.map((entry) => entry.options.headers.Authorization),
        ["token secret-token", "token env-token", "token gh-token"],
      );
      assert.ok(
        execCalls.length <= 3,
        `credential walk should stay bounded, saw ${execCalls.length} gh calls`,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test("missing private raw content stops after authenticated retry", async () => {
    const requests = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      return { ok: false, status: 404 };
    };

    try {
      const response = await githubFetch.fetchGitHubWithOptionalAuthRetry(
        "https://raw.githubusercontent.com/owner/private-repo/main/missing.md",
        { accept: "text/plain", token: "test-token" },
      );

      assert.strictEqual(response.status, 404);
      assert.strictEqual(requests.length, 2);
      assert.strictEqual(requests[0].options.headers.Authorization, undefined);
      assert.strictEqual(
        requests[1].options.headers.Authorization,
        "token test-token",
      );
      assert.strictEqual(requests[1].options.redirect, "error");
    } finally {
      global.fetch = originalFetch;
    }
  });
}

main()
  .then(() => {
    console.log("RESULT=PASS");
  })
  .finally(() => {
    Module._load = originalLoad;
  });
