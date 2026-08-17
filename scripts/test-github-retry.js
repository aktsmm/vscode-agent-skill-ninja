#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

let fallbackToken;
let githubResponseModule;

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "vscode") {
    return {};
  }
  if (request === "./githubResponse") {
    if (!githubResponseModule) {
      githubResponseModule = requireTypeScriptModule(
        path.join(__dirname, "..", "src", "githubResponse.ts"),
      );
    }
    return githubResponseModule;
  }
  if (request === "./githubAuth") {
    return {
      resolveGitHubTokenAfterFailure: async (failedToken, alreadyTried) =>
        typeof fallbackToken === "function"
          ? fallbackToken(failedToken, alreadyTried)
          : fallbackToken,
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

function response(status, headers = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = String(value);
  }

  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (key) => normalized[key.toLowerCase()] ?? null,
    },
  };
}

function createHarness(responses, overrides = {}) {
  const sleeps = [];
  const inits = [];
  let index = 0;

  const request = async (_url, init) => {
    inits.push(init);
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next instanceof Error) {
      throw next;
    }
    return next;
  };

  const retry = {
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => 1_000_000,
    random: () => 0,
    ...overrides,
  };

  return {
    request,
    retry,
    sleeps,
    inits,
    get attempts() {
      return index;
    },
  };
}

async function test(name, fn) {
  try {
    fallbackToken = undefined;
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main() {
  const githubFetch = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "githubFetch.ts"),
  );

  await test("classifies only transient statuses as retryable", () => {
    assert.strictEqual(githubFetch.isRetryableGitHubStatus(429), true);
    assert.strictEqual(githubFetch.isRetryableGitHubStatus(503), true);
    for (const status of [200, 401, 403, 404, 422, 500]) {
      assert.strictEqual(
        githubFetch.isRetryableGitHubStatus(status),
        false,
        `status ${status} must not be retried`,
      );
    }
  });

  await test("parses Retry-After as seconds and as HTTP date", () => {
    assert.strictEqual(githubFetch.parseRetryAfterMs("3", 0), 3000);
    assert.strictEqual(githubFetch.parseRetryAfterMs("  ", 0), undefined);
    assert.strictEqual(githubFetch.parseRetryAfterMs(null, 0), undefined);

    const now = Date.parse("2026-01-01T00:00:00Z");
    assert.strictEqual(
      githubFetch.parseRetryAfterMs("Thu, 01 Jan 2026 00:00:05 GMT", now),
      5000,
    );
    assert.strictEqual(
      githubFetch.parseRetryAfterMs("Thu, 01 Jan 2020 00:00:00 GMT", now),
      0,
    );
  });

  await test("honors Retry-After before falling back to backoff", () => {
    const now = 1_000_000;
    assert.strictEqual(
      githubFetch.computeGitHubRetryDelayMs(
        response(429, { "retry-after": "2" }),
        1,
        { now, random: 0 },
      ),
      2000,
    );

    assert.strictEqual(
      githubFetch.computeGitHubRetryDelayMs(
        response(429, {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String((now + 4000) / 1000),
        }),
        1,
        { now, random: 0 },
      ),
      4000,
    );

    assert.strictEqual(
      githubFetch.computeGitHubRetryDelayMs(response(503), 2, {
        now,
        random: 0,
      }),
      githubFetch.GITHUB_RETRY_BASE_DELAY_MS * 2,
    );
  });

  await test("gives up when the required wait exceeds the cap", () => {
    assert.strictEqual(
      githubFetch.computeGitHubRetryDelayMs(
        response(429, { "retry-after": "3600" }),
        1,
        { now: 0, random: 0 },
      ),
      undefined,
    );
  });

  await test("treats timeouts as transient but never aborts", () => {
    assert.strictEqual(
      githubFetch.isTransientNetworkError(
        new Error("Request timeout: https://example.com"),
      ),
      true,
    );
    assert.strictEqual(
      githubFetch.isTransientNetworkError(new TypeError("fetch failed")),
      true,
    );
    assert.strictEqual(
      githubFetch.isTransientNetworkError(githubFetch.createAbortError()),
      false,
    );
    assert.strictEqual(
      githubFetch.isTransientNetworkError(new Error("HTTP 404")),
      false,
    );
  });

  await test("retries a rate-limited request and returns the success", async () => {
    const harness = createHarness([
      response(429, { "retry-after": "1" }),
      response(200),
    ]);

    const result = await githubFetch.fetchGitHubWithOptionalAuthRetry(
      "https://api.github.com/repos/o/r/contents/x",
      {
        accept: "application/vnd.github.v3+json",
        request: harness.request,
        retry: harness.retry,
      },
    );

    assert.strictEqual(result.status, 200);
    assert.strictEqual(harness.attempts, 2);
    assert.deepStrictEqual(harness.sleeps, [1000]);
  });

  await test("never retries a 404", async () => {
    const harness = createHarness([response(404)]);

    const result = await githubFetch.fetchGitHubWithOptionalAuthRetry(
      "https://api.github.com/repos/o/r/contents/x",
      {
        accept: "application/vnd.github.v3+json",
        request: harness.request,
        retry: harness.retry,
      },
    );

    assert.strictEqual(result.status, 404);
    assert.strictEqual(harness.attempts, 1);
    assert.deepStrictEqual(harness.sleeps, []);
  });

  await test("stops after the attempt cap and returns the last response", async () => {
    const harness = createHarness([
      response(429),
      response(429),
      response(429),
    ]);

    const result = await githubFetch.fetchGitHubWithOptionalAuthRetry(
      "https://api.github.com/repos/o/r/contents/x",
      {
        accept: "application/vnd.github.v3+json",
        request: harness.request,
        retry: harness.retry,
      },
    );

    assert.strictEqual(result.status, 429);
    assert.strictEqual(harness.attempts, githubFetch.GITHUB_RETRY_MAX_ATTEMPTS);
    assert.strictEqual(
      harness.sleeps.length,
      githubFetch.GITHUB_RETRY_MAX_ATTEMPTS - 1,
    );
  });

  await test("does not wait past the install deadline", async () => {
    const harness = createHarness([response(429, { "retry-after": "5" })], {
      deadlineAt: 1_000_000 + 1000,
    });

    const result = await githubFetch.fetchGitHubWithOptionalAuthRetry(
      "https://api.github.com/repos/o/r/contents/x",
      {
        accept: "application/vnd.github.v3+json",
        request: harness.request,
        retry: harness.retry,
      },
    );

    assert.strictEqual(result.status, 429);
    assert.strictEqual(harness.attempts, 1);
    assert.deepStrictEqual(harness.sleeps, []);
  });

  await test("retries transient network failures and rethrows the last one", async () => {
    const harness = createHarness([new Error("Request timeout: https://x")]);

    await assert.rejects(
      githubFetch.fetchGitHubWithOptionalAuthRetry(
        "https://api.github.com/repos/o/r/contents/x",
        {
          accept: "application/vnd.github.v3+json",
          request: harness.request,
          retry: harness.retry,
        },
      ),
      /Request timeout/,
    );

    assert.strictEqual(harness.attempts, githubFetch.GITHUB_RETRY_MAX_ATTEMPTS);
  });

  await test("forwards the caller cancellation signal to every attempt", async () => {
    const controller = new AbortController();
    const harness = createHarness([response(429), response(200)], {
      signal: controller.signal,
    });

    await githubFetch.fetchGitHubWithOptionalAuthRetry(
      "https://api.github.com/repos/o/r/contents/x",
      {
        accept: "application/vnd.github.v3+json",
        request: harness.request,
        retry: harness.retry,
      },
    );

    assert.ok(harness.inits.length >= 2);
    for (const init of harness.inits) {
      assert.strictEqual(init.signal, controller.signal);
    }
  });

  await test("falls back to the default cap for non-finite attempt limits", async () => {
    for (const maxAttempts of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const harness = createHarness([response(429)], { maxAttempts });

      const result = await githubFetch.fetchGitHubWithOptionalAuthRetry(
        "https://api.github.com/repos/o/r/contents/x",
        {
          accept: "application/vnd.github.v3+json",
          request: harness.request,
          retry: harness.retry,
        },
      );

      assert.strictEqual(result.status, 429);
      assert.strictEqual(
        harness.attempts,
        githubFetch.GITHUB_RETRY_MAX_ATTEMPTS,
        `maxAttempts=${String(maxAttempts)} must not loop forever`,
      );
    }
  });

  await test("keeps extra headers on every attempt", async () => {
    const harness = createHarness([response(429), response(200)]);

    await githubFetch.fetchGitHubWithOptionalAuthRetry(
      "https://api.github.com/repos/o/r/contents/x",
      {
        accept: "application/vnd.github.v3+json",
        extraHeaders: { "X-GitHub-Api-Version": "2022-11-28" },
        request: harness.request,
        retry: harness.retry,
      },
    );

    assert.ok(harness.inits.length >= 2);
    for (const init of harness.inits) {
      assert.strictEqual(
        init.headers["X-GitHub-Api-Version"],
        "2022-11-28",
        "extra headers must survive retries and auth fallbacks",
      );
    }
  });

  await test("bounds the credential walk when every source yields a new token", async () => {
    const harness = createHarness([response(401)]);
    let issued = 0;
    fallbackToken = (failedToken, alreadyTried) => {
      assert.ok(
        Array.isArray(alreadyTried),
        "resolveGitHubTokenAfterFailure must receive a plain array",
      );
      issued += 1;
      // 供給を有限にして、上限が外れた場合もハングではなく失敗にする
      return issued > 10
        ? undefined
        : { token: `rotating-${issued}`, source: "gh-cli" };
    };

    const result = await githubFetch.fetchGitHubWithOptionalAuthRetry(
      "https://api.github.com/repos/o/r/contents/x",
      {
        accept: "application/vnd.github.v3+json",
        token: "stale-token",
        request: harness.request,
        retry: harness.retry,
      },
    );

    assert.strictEqual(result.status, 401);
    assert.strictEqual(issued, githubFetch.GITHUB_TOKEN_FALLBACK_MAX_ATTEMPTS);
    assert.strictEqual(
      harness.attempts,
      2 + githubFetch.GITHUB_TOKEN_FALLBACK_MAX_ATTEMPTS,
      "initial request, anonymous retry, then a bounded number of credentials",
    );
  });

  await test("stops the credential walk when a source repeats a token", async () => {
    const harness = createHarness([response(403)]);
    fallbackToken = () => ({ token: "repeat-token", source: "env" });

    const result = await githubFetch.fetchGitHubWithOptionalAuthRetry(
      "https://api.github.com/repos/o/r/contents/x",
      {
        accept: "application/vnd.github.v3+json",
        token: "stale-token",
        request: harness.request,
        retry: harness.retry,
      },
    );

    assert.strictEqual(result.status, 403);
    assert.strictEqual(
      harness.attempts,
      3,
      "a repeated token must end the walk instead of being retried",
    );
  });

  await test("does not start a new attempt when the sleep ignores the signal", async () => {
    const controller = new AbortController();
    const harness = createHarness([response(429), response(200)], {
      signal: controller.signal,
      sleep: async () => {
        controller.abort();
      },
    });

    await assert.rejects(
      githubFetch.fetchGitHubWithOptionalAuthRetry(
        "https://api.github.com/repos/o/r/contents/x",
        {
          accept: "application/vnd.github.v3+json",
          request: harness.request,
          retry: harness.retry,
        },
      ),
      (error) => error.name === "AbortError",
    );

    assert.strictEqual(
      harness.attempts,
      1,
      "the retry must not run after the wait was cancelled",
    );
  });

  await test("issues no request when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = createHarness([response(200)], {
      signal: controller.signal,
    });

    await assert.rejects(
      githubFetch.fetchGitHubWithOptionalAuthRetry(
        "https://api.github.com/repos/o/r/contents/x",
        {
          accept: "application/vnd.github.v3+json",
          token: "stale-token",
          request: harness.request,
          retry: harness.retry,
        },
      ),
      (error) => error.name === "AbortError",
    );

    assert.strictEqual(harness.attempts, 0);
  });

  await test("clamps an oversized attempt limit", async () => {
    const harness = createHarness([response(429, { "retry-after": "1" })], {
      maxAttempts: 50,
    });

    const result = await githubFetch.fetchGitHubWithOptionalAuthRetry(
      "https://api.github.com/repos/o/r/contents/x",
      {
        accept: "application/vnd.github.v3+json",
        request: harness.request,
        retry: harness.retry,
      },
    );

    assert.strictEqual(result.status, 429);
    assert.strictEqual(harness.attempts, githubFetch.GITHUB_RETRY_ATTEMPTS_CAP);
  });

  await test("describes requests without query strings or fragments", () => {
    assert.strictEqual(
      githubFetch.describeGitHubRequest(
        "https://api.github.com/repos/o/r/contents/x?ref=private-branch#frag",
      ),
      "api.github.com/repos/o/r/contents/x",
    );
    assert.strictEqual(
      githubFetch.describeGitHubRequest("not a url"),
      "(unparsable url)",
    );
  });

  console.log("GitHub retry tests passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    Module._load = originalLoad;
  });
