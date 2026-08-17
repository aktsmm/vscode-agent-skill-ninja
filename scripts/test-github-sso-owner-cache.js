#!/usr/bin/env node

// SSO でブロックされた (owner, token) の組を覚えて匿名優先へ切り替える契約を固定する。

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

let fallbackTokens = [];
let githubResponseModule;

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "vscode") {
    return {};
  }
  if (request === "./githubAuth") {
    return {
      resolveGitHubTokenAfterFailure: async (_failedToken, alreadyTried) => {
        const next = fallbackTokens.find(
          (token) => !alreadyTried.includes(token),
        );
        return next ? { token: next, source: "test" } : null;
      },
    };
  }
  if (request === "./githubResponse") {
    if (!githubResponseModule) {
      githubResponseModule = requireTypeScriptModule(
        path.join(__dirname, "..", "src", "githubResponse.ts"),
      );
    }
    return githubResponseModule;
  }
  return originalLoad.call(this, request, parent, isMain);
};

function requireTypeScriptModule(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  });

  const loadedModule = new Module(filePath, module);
  loadedModule.filename = filePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(filePath));
  loadedModule._compile(transpiled.outputText, filePath);
  return loadedModule.exports;
}

const SSO_HEADER = {
  "x-github-sso":
    "required; url=https://github.com/orgs/acme/sso?authorization_request=SECRET",
};

function ssoResponse() {
  return new Response("Resource protected by organization SAML enforcement", {
    status: 403,
    headers: SSO_HEADER,
  });
}

function rateLimitResponse() {
  return new Response("API rate limit exceeded", {
    status: 403,
    headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1" },
  });
}

function createRecorder(handler) {
  const requests = [];
  return {
    requests,
    request: async (url, init) => {
      requests.push({ url, headers: init?.headers ?? {} });
      return handler(url, init, requests.length);
    },
  };
}

let githubFetch;

async function test(name, fn) {
  try {
    fallbackTokens = [];
    githubFetch.resetGitHubSsoCache();
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main() {
  githubFetch = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "githubFetch.ts"),
  );

  const apiUrl = "https://api.github.com/repos/acme/widgets";

  await test("drops a token that the owner rejected with SAML SSO", async () => {
    const recorder = createRecorder(async (_url, init) =>
      init?.headers?.Authorization ? ssoResponse() : new Response("ok"),
    );

    const first = await githubFetch.fetchGitHubWithOptionalAuthRetry(apiUrl, {
      accept: "application/vnd.github+json",
      token: "blocked-token",
      request: recorder.request,
    });

    assert.strictEqual(first.status, 200);
    assert.strictEqual(recorder.requests.length, 2);
    assert.strictEqual(
      recorder.requests[0].headers.Authorization,
      "token blocked-token",
    );
    assert.strictEqual(recorder.requests[1].headers.Authorization, undefined);

    const second = await githubFetch.fetchGitHubWithOptionalAuthRetry(apiUrl, {
      accept: "application/vnd.github+json",
      token: "blocked-token",
      request: recorder.request,
    });

    assert.strictEqual(second.status, 200);
    assert.strictEqual(
      recorder.requests.length,
      3,
      "the second call must not re-send the blocked token",
    );
    assert.strictEqual(recorder.requests[2].headers.Authorization, undefined);
  });

  await test("keeps sending the token to owners that never rejected it", async () => {
    const recorder = createRecorder(async (url, init) =>
      url.includes("/acme/") && init?.headers?.Authorization
        ? ssoResponse()
        : new Response("ok"),
    );

    await githubFetch.fetchGitHubWithOptionalAuthRetry(apiUrl, {
      accept: "application/vnd.github+json",
      token: "shared-token",
      request: recorder.request,
    });

    const otherOwner = await githubFetch.fetchGitHubWithOptionalAuthRetry(
      "https://api.github.com/repos/other/widgets",
      {
        accept: "application/vnd.github+json",
        token: "shared-token",
        request: recorder.request,
      },
    );

    assert.strictEqual(otherOwner.status, 200);
    assert.strictEqual(
      recorder.requests.at(-1).headers.Authorization,
      "token shared-token",
    );
  });

  await test("never caches endpoints without an owner", async () => {
    const searchUrl = "https://api.github.com/search/code?q=skill";
    const recorder = createRecorder(async (_url, init) =>
      init?.headers?.Authorization ? ssoResponse() : new Response("ok"),
    );

    await githubFetch.fetchGitHubWithOptionalAuthRetry(searchUrl, {
      accept: "application/vnd.github+json",
      token: "search-token",
      request: recorder.request,
    });
    await githubFetch.fetchGitHubWithOptionalAuthRetry(searchUrl, {
      accept: "application/vnd.github+json",
      token: "search-token",
      request: recorder.request,
    });

    assert.strictEqual(
      recorder.requests[2].headers.Authorization,
      "token search-token",
    );
  });

  await test("skips blocked credentials instead of repeating the anonymous request", async () => {
    const blocking = createRecorder(async (_url, init) =>
      init?.headers?.Authorization ? ssoResponse() : rateLimitResponse(),
    );

    await githubFetch.fetchGitHubWithOptionalAuthRetry(apiUrl, {
      accept: "application/vnd.github+json",
      token: "blocked-a",
      request: blocking.request,
    });
    await githubFetch.fetchGitHubWithOptionalAuthRetry(apiUrl, {
      accept: "application/vnd.github+json",
      token: "blocked-b",
      request: blocking.request,
    });

    fallbackTokens = ["blocked-b", "working-token"];
    const recorder = createRecorder(async (_url, init) =>
      init?.headers?.Authorization === "token working-token"
        ? new Response("ok")
        : rateLimitResponse(),
    );

    const result = await githubFetch.fetchGitHubWithOptionalAuthRetry(apiUrl, {
      accept: "application/vnd.github+json",
      token: "blocked-a",
      request: recorder.request,
    });

    assert.strictEqual(result.status, 200);
    assert.strictEqual(
      recorder.requests.length,
      2,
      "blocked-b must not issue a duplicate anonymous request",
    );
    assert.strictEqual(recorder.requests[0].headers.Authorization, undefined);
    assert.strictEqual(
      recorder.requests[1].headers.Authorization,
      "token working-token",
    );
  });

  await test("reports the SSO root cause instead of the later rate limit", async () => {
    const recorder = createRecorder(async (_url, init) =>
      init?.headers?.Authorization ? ssoResponse() : rateLimitResponse(),
    );

    const result = await githubFetch.fetchGitHubWithOptionalAuthRetry(apiUrl, {
      accept: "application/vnd.github+json",
      token: "blocked-token",
      request: recorder.request,
    });

    assert.strictEqual(result.status, 403);
    assert.strictEqual(
      githubResponseModule.classifyGitHubFailure(
        result,
        await result.clone().text(),
      ),
      "sso-required",
    );
  });

  await test("keeps a final 404 so branch fallback still works", async () => {
    const recorder = createRecorder(async (_url, init) =>
      init?.headers?.Authorization
        ? ssoResponse()
        : new Response("missing", { status: 404 }),
    );

    const result = await githubFetch.fetchGitHubWithOptionalAuthRetry(
      "https://api.github.com/repos/acme/widgets/git/trees/main?recursive=1",
      {
        accept: "application/vnd.github+json",
        token: "blocked-token",
        request: recorder.request,
      },
    );

    assert.strictEqual(result.status, 404);
  });

  await test("resetGitHubSsoCache restores the authenticated attempt", async () => {
    const recorder = createRecorder(async (_url, init) =>
      init?.headers?.Authorization ? ssoResponse() : new Response("ok"),
    );

    await githubFetch.fetchGitHubWithOptionalAuthRetry(apiUrl, {
      accept: "application/vnd.github+json",
      token: "blocked-token",
      request: recorder.request,
    });

    githubFetch.resetGitHubSsoCache();

    await githubFetch.fetchGitHubWithOptionalAuthRetry(apiUrl, {
      accept: "application/vnd.github+json",
      token: "blocked-token",
      request: recorder.request,
    });

    assert.strictEqual(
      recorder.requests[2].headers.Authorization,
      "token blocked-token",
    );
  });

  await test("keeps a raw 404 as 404 when the only credential is blocked", async () => {
    const rawUrl = "https://raw.githubusercontent.com/acme/widgets/main/x.md";
    const blocking = createRecorder(async (_url, init) =>
      init?.headers?.Authorization ? ssoResponse() : new Response("ok"),
    );

    await githubFetch.fetchGitHubWithOptionalAuthRetry(apiUrl, {
      accept: "application/vnd.github+json",
      token: "blocked-token",
      request: blocking.request,
    });

    const recorder = createRecorder(async (_url, init) =>
      init?.headers?.Authorization
        ? ssoResponse()
        : new Response("missing", { status: 404 }),
    );

    const result = await githubFetch.fetchGitHubWithOptionalAuthRetry(rawUrl, {
      accept: "text/plain",
      token: "blocked-token",
      request: recorder.request,
    });

    assert.strictEqual(result.status, 404);
    assert.strictEqual(
      recorder.requests.length,
      1,
      "a blocked token must not be forced onto raw content",
    );
  });

  await test("raw private fallback still uses an unblocked credential", async () => {
    const rawUrl = "https://raw.githubusercontent.com/acme/widgets/main/x.md";
    const blocking = createRecorder(async (_url, init) =>
      init?.headers?.Authorization ? ssoResponse() : new Response("ok"),
    );

    await githubFetch.fetchGitHubWithOptionalAuthRetry(apiUrl, {
      accept: "application/vnd.github+json",
      token: "blocked-token",
      request: blocking.request,
    });

    fallbackTokens = ["working-token"];
    const recorder = createRecorder(async (_url, init) =>
      init?.headers?.Authorization === "token working-token"
        ? new Response("private content")
        : new Response("missing", { status: 404 }),
    );

    const result = await githubFetch.fetchGitHubWithOptionalAuthRetry(rawUrl, {
      accept: "text/plain",
      token: "blocked-token",
      request: recorder.request,
    });

    assert.strictEqual(result.status, 200);
    assert.strictEqual(recorder.requests[0].headers.Authorization, undefined);
    assert.strictEqual(
      recorder.requests[1].headers.Authorization,
      "token working-token",
    );
  });

  await test("logs the dropped credential once, without the token", async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message) => warnings.push(String(message));

    try {
      const recorder = createRecorder(async (_url, init) =>
        init?.headers?.Authorization ? ssoResponse() : new Response("ok"),
      );

      for (let i = 0; i < 3; i++) {
        await githubFetch.fetchGitHubWithOptionalAuthRetry(apiUrl, {
          accept: "application/vnd.github+json",
          token: "blocked-token",
          request: recorder.request,
        });
      }

      assert.strictEqual(warnings.length, 1);
      assert.ok(warnings[0].includes("acme"));
      assert.ok(!warnings[0].includes("blocked-token"));
    } finally {
      console.warn = originalWarn;
    }
  });

  console.log("\nGitHub SSO owner cache tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
