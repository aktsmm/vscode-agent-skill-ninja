#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const secrets = new Map();
let configToken = "";
let execCalls = [];
let execBehavior = "error";
let githubAuthModule;
let informationMessages = [];
let errorMessages = [];
let secretDeleteError;

const vscodeMock = {
  window: {
    async showInformationMessage(message) {
      informationMessages.push(message);
      return undefined;
    },
    async showErrorMessage(message) {
      errorMessages.push(message);
      return undefined;
    },
  },
  workspace: {
    getConfiguration(section) {
      assert.strictEqual(section, "skillNinja");
      return {
        get(key) {
          if (key === "githubToken") {
            return configToken;
          }
          return undefined;
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
        assert.strictEqual(command, "gh auth token");
        assert.strictEqual(options.timeout, 5000);
        assert.strictEqual(options.windowsHide, true);

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
    execCalls = [];
    execBehavior = "error";
    informationMessages = [];
    errorMessages = [];
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
            "https://api.github.com/repos/owner/repo",
            {},
            5,
          ),
        (error) =>
          error.message ===
          "Request timeout: https://api.github.com/repos/owner/repo",
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
