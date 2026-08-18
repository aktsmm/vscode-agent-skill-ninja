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
  // 新しい vm context には Node の global が無いので、使うものだけ渡す
  URL,
  Date,
};

vm.runInNewContext(transpiled.outputText, sandbox, {
  filename: sourcePath,
});

const {
  classifyGitHubFailure,
  createGitHubResponseError,
  extractSsoAuthorizationUrl,
  retryGitHubRequestAnonymously,
} = sandbox.exports;

let resolvedToken;
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "vscode") {
    return {};
  }
  if (request === "./skillIndex") {
    return {
      saveSkillIndex: async () => {},
    };
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
      // Callers that inject `request` exercise the real header contract; the
      // rest keep the previous inert stub.
      fetchGitHubWithOptionalAuthRetry: async (url, options = {}) => {
        if (!options.request) {
          return response(200, "");
        }
        const headers = {
          Accept: options.accept,
          "User-Agent": "VSCode-SkillNinja",
          ...options.extraHeaders,
        };
        if (options.token) {
          headers.Authorization = `token ${options.token}`;
        }
        return options.request(url, { headers });
      },
      fetchGitHubWithTimeout: async (url, init) => fetch(url, init),
      fetchGitHubWithRetry: async (url, init) => fetch(url, init),
    };
  }
  if (request === "./sourceUpdateReconcile") {
    return requireTypeScriptModule(
      path.join(__dirname, "..", "src", "sourceUpdateReconcile.ts"),
    );
  }
  // vscode 非依存の純粋ヘルパーは実モジュールを使う。書き写すと実装と乖離する
  if (request === "./sourceRefs") {
    return requireTypeScriptModule(
      path.join(__dirname, "..", "src", "sourceRefs.ts"),
    );
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

  await test("reports a 429 as a rate-limit failure", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => response(429, "Too Many Requests");

    try {
      await assert.rejects(
        fetchRepositoryTextFile(
          "MicrosoftDocs",
          "Agent-Skills",
          "main",
          "skills/example/SKILL.md",
          "test-token",
        ),
        (error) =>
          error.name === "GitHubResponseError" && error.kind === "rate-limit",
        "a 429 must surface as a rate-limit failure so batch updates short-circuit",
      );
    } finally {
      global.fetch = originalFetch;
    }
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

  await test("keeps the authorization_request out of the stored SSO url", async () => {
    const result = response(403, "SAML enforcement", {
      "x-github-sso":
        "required; url=https://github.com/enterprises/acme/sso?authorization_request=SECRET",
    });

    assert.strictEqual(
      extractSsoAuthorizationUrl(result),
      "https://github.com/enterprises/acme/sso",
    );
  });

  await test("rejects SSO urls outside the github.com sso paths", async () => {
    const cases = [
      "required; url=https://evil.example.com/orgs/acme/sso",
      "required; url=http://github.com/orgs/acme/sso",
      "required; url=https://github.com/acme/repo",
      "required; url=https://github.com/orgs/acme/sso/extra",
      // userinfo / port / 別ホスト埋め込みは host allowlist をすり抜けやすい
      "required; url=https://github.com@evil.example.com/orgs/acme/sso",
      "required; url=https://github.com.evil.example.com/orgs/acme/sso",
      "required; url=https://github.com:8443/orgs/acme/sso",
      "required; url=javascript:alert(1)",
      "required",
    ];

    for (const header of cases) {
      assert.strictEqual(
        extractSsoAuthorizationUrl(
          response(403, "SAML enforcement", { "x-github-sso": header }),
        ),
        undefined,
        `must reject ${header}`,
      );
    }
  });

  await test("never carries the authorization_request into the error", async () => {
    const failure = createGitHubResponseError(
      response(403, "Resource protected by organization SAML enforcement", {
        "x-github-sso":
          "required; url=https://github.com/orgs/acme/sso?authorization_request=SECRET",
      }),
      "Resource protected by organization SAML enforcement",
      "GitHub tree request failed for acme/widgets",
    );

    assert.strictEqual(failure.kind, "sso-required");
    assert.strictEqual(
      failure.ssoAuthorizationUrl,
      "https://github.com/orgs/acme/sso",
    );
    // console.warn は error 本体を出すので、どのフィールドにも残さない
    for (const value of Object.values(failure)) {
      if (typeof value === "string") {
        assert.ok(
          !value.includes("authorization_request") && !value.includes("SECRET"),
          `authorization_request must not survive in ${value}`,
        );
      }
    }
    assert.ok(!failure.message.includes("github.com"));
  });

  await test("every GitHub index entry point re-verifies blocked credentials", async () => {
    // 呼び出し側ではなく定義側に置くことで、新しい入口が漏れない
    const ast = ts.createSourceFile(
      indexUpdaterPath,
      indexUpdaterSource,
      ts.ScriptTarget.ES2022,
      true,
    );

    const findCallPosition = (node, callee) => {
      let position = -1;
      const visit = (current) => {
        if (
          position < 0 &&
          ts.isCallExpression(current) &&
          ts.isIdentifier(current.expression) &&
          current.expression.text === callee
        ) {
          position = current.getStart(ast);
        }
        ts.forEachChild(current, visit);
      };
      visit(node);
      return position;
    };

    const entryPoints = [
      "updateIndexFromSources",
      "updateIndexFromSingleSource",
      "updateSingleSource",
      "addSource",
    ];

    for (const name of entryPoints) {
      const declaration = ast.statements.find(
        (statement) =>
          ts.isFunctionDeclaration(statement) && statement.name?.text === name,
      );
      assert.ok(declaration?.body, `${name} must exist`);

      const resetAt = findCallPosition(declaration.body, "resetGitHubSsoCache");
      const tokenAt = findCallPosition(declaration.body, "getGitHubToken");
      assert.ok(resetAt >= 0, `${name} must re-verify SSO-blocked credentials`);
      assert.ok(
        tokenAt < 0 || resetAt < tokenAt,
        `${name} must reset before resolving a credential`,
      );
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
