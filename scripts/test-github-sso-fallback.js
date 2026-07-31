#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "src", "githubResponse.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

const sandbox = {
  exports: {},
  module: { exports: {} },
  require,
};

vm.runInNewContext(transpiled.outputText, sandbox, {
  filename: sourcePath,
});

const { classifyGitHubFailure, retryGitHubRequestAnonymously } =
  sandbox.exports;

let resolvedToken;
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "vscode") {
    return {};
  }
  if (request === "./skillIndex") {
    return { saveSkillIndex: async () => {} };
  }
  if (request === "./i18n") {
    return { messages: {} };
  }
  if (request === "./githubAuth") {
    return {
      checkGitHubAuth: async () => ({}),
      getGitHubToken: async () => resolvedToken,
    };
  }
  if (request === "./constants") {
    return {
      INDEX_LIMITS: { SHORT_DESCRIPTION: 200 },
      LICENSE_EXTRACTION: { FILE_NAMES: [], PATTERNS: [] },
    };
  }
  if (request === "./githubResponse") {
    return sandbox.exports;
  }
  if (request === "./githubFetch") {
    return {
      fetchGitHubWithOptionalAuthRetry: async () => response(200, ""),
      fetchGitHubWithTimeout: async (url, init) => fetch(url, init),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function requireTypeScriptModule(filePath) {
  const moduleSource = fs.readFileSync(filePath, "utf8");
  const moduleTranspiled = ts.transpileModule(moduleSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  });

  const loadedModule = new Module(filePath, module);
  loadedModule.filename = filePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(filePath));
  loadedModule._compile(moduleTranspiled.outputText, filePath);
  return loadedModule.exports;
}

function response(status, body, headers = {}) {
  return new Response(body, { status, headers });
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main() {
  const indexUpdaterPath = path.join(__dirname, "..", "src", "indexUpdater.ts");
  const indexUpdaterSource = fs.readFileSync(indexUpdaterPath, "utf8");
  const { fetchRepositoryTextFile, scanRepositoryForSkills } =
    requireTypeScriptModule(indexUpdaterPath);

  await test("raw search previews use the anonymous-first GitHub helper", async () => {
    assert.ok(
      indexUpdaterSource.includes("fetchGitHubWithOptionalAuthRetry(rawUrl, {"),
    );
    assert.ok(!indexUpdaterSource.includes("githubFetch(rawUrl, token)"));
  });

  await test("classifies SAML enforcement responses", async () => {
    const result = response(
      403,
      JSON.stringify({
        message:
          "Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.",
      }),
    );
    assert.strictEqual(
      classifyGitHubFailure(result, await result.clone().text()),
      "sso-required",
    );
  });

  await test("retries SAML failures without a token", async () => {
    const initial = response(
      403,
      "Resource protected by organization SAML enforcement",
    );
    let retryCount = 0;
    const result = await retryGitHubRequestAnonymously(
      initial,
      true,
      async () => {
        retryCount += 1;
        return response(200, "ok");
      },
    );

    assert.strictEqual(result.status, 200);
    assert.strictEqual(retryCount, 1);
  });

  await test("retries invalid-token failures anonymously", async () => {
    const initial = response(401, "Bad credentials");
    let retryCount = 0;
    const result = await retryGitHubRequestAnonymously(
      initial,
      true,
      async () => {
        retryCount += 1;
        return response(200, "public content");
      },
    );

    assert.strictEqual(result.status, 200);
    assert.strictEqual(retryCount, 1);
  });

  await test("keeps the authenticated failure when anonymous retry fails", async () => {
    const initial = response(
      403,
      "Resource protected by organization SAML enforcement",
    );
    const result = await retryGitHubRequestAnonymously(
      initial,
      true,
      async () => response(404, "Not Found"),
    );

    assert.strictEqual(result, initial);
  });

  await test("keeps private repository auth failures when anonymous access fails", async () => {
    const initial = response(401, "Bad credentials");
    const result = await retryGitHubRequestAnonymously(
      initial,
      true,
      async () => response(404, "Not Found"),
    );

    assert.strictEqual(result, initial);
  });

  await test("does not retry rate limit failures", async () => {
    const initial = response(403, "API rate limit exceeded", {
      "x-ratelimit-remaining": "0",
    });
    let retryCount = 0;
    const result = await retryGitHubRequestAnonymously(
      initial,
      true,
      async () => {
        retryCount += 1;
        return response(200, "ok");
      },
    );

    assert.strictEqual(result, initial);
    assert.strictEqual(retryCount, 0);
  });

  await test("fetches public content anonymously even when a token is available", async () => {
    const originalFetch = global.fetch;
    const requests = [];
    global.fetch = async (url, options = {}) => {
      requests.push({ url: String(url), headers: options.headers || {} });
      return response(200, "skill content");
    };

    try {
      const content = await fetchRepositoryTextFile(
        "MicrosoftDocs",
        "Agent-Skills",
        "main",
        "skills/example/SKILL.md",
        "test-token",
      );

      assert.strictEqual(content, "skill content");
      assert.strictEqual(requests.length, 1);
      assert.strictEqual(
        requests[0].url,
        "https://raw.githubusercontent.com/MicrosoftDocs/Agent-Skills/main/skills/example/SKILL.md",
      );
      assert.strictEqual(requests[0].headers.Authorization, undefined);
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test("retries anonymous 404 content through the authenticated API", async () => {
    const originalFetch = global.fetch;
    const requests = [];
    global.fetch = async (url, options = {}) => {
      requests.push({ url: String(url), headers: options.headers || {} });
      return String(url).startsWith("https://raw.githubusercontent.com/")
        ? response(404, "Not Found")
        : response(200, "private content");
    };

    try {
      const content = await fetchRepositoryTextFile(
        "private-owner",
        "private-repo",
        "main",
        "SKILL.md",
        "test-token",
      );

      assert.strictEqual(content, "private content");
      assert.strictEqual(requests.length, 2);
      assert.ok(
        requests[0].url.startsWith("https://raw.githubusercontent.com/"),
      );
      assert.strictEqual(requests[0].headers.Authorization, undefined);
      assert.ok(requests[1].url.startsWith("https://api.github.com/"));
      assert.strictEqual(requests[1].headers.Authorization, "token test-token");
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test("uses raw GitHub directly when no token is available", async () => {
    const originalFetch = global.fetch;
    const requests = [];
    resolvedToken = undefined;
    global.fetch = async (url, options = {}) => {
      requests.push({ url: String(url), headers: options.headers || {} });
      return response(200, "anonymous content");
    };

    try {
      const content = await fetchRepositoryTextFile(
        "owner",
        "repo",
        "main",
        "SKILL.md",
      );

      assert.strictEqual(content, "anonymous content");
      assert.strictEqual(requests.length, 1);
      assert.strictEqual(
        requests[0].url,
        "https://raw.githubusercontent.com/owner/repo/main/SKILL.md",
      );
      assert.strictEqual(requests[0].headers.Authorization, undefined);
    } finally {
      global.fetch = originalFetch;
    }
  });

  if (process.argv.includes("--live")) {
    await test("scans the live MicrosoftDocs source without API content requests", async () => {
      resolvedToken = undefined;
      const result = await scanRepositoryForSkills(
        "https://github.com/MicrosoftDocs/Agent-Skills",
        undefined,
        "main",
      );

      assert.ok(result);
      assert.strictEqual(
        result.source.url,
        "https://github.com/MicrosoftDocs/Agent-Skills",
      );
      assert.ok(result.skills.length > 0);
      console.log(`LIVE scanned ${result.skills.length} skill(s)`);
    });
  }

  console.log("\nGitHub SSO fallback tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
