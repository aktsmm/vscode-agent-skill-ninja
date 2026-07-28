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

const vscodeMock = {
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

    await auth.deleteStoredGitHubToken();
    assert.strictEqual(
      await context.secrets.get("skillNinja.githubToken"),
      undefined,
    );
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
