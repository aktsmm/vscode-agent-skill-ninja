#!/usr/bin/env node

// rate limit で中断した source 更新の再開判断と、再試行集合の作り方を検証する。

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

// これらの層は vscode に依存しないので、実装をそのまま読み込んで検証する
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

const {
  createRateLimitResumeState,
  normalizeRateLimitResumeState,
  shouldResumeRateLimitedUpdate,
  RATE_LIMIT_RESUME_FALLBACK_DELAY_MS,
  RATE_LIMIT_RESUME_MAX_AGE_MS,
} = require(path.join(srcDir, "rateLimitResume.ts"));
const { getSourceIndexUpdateRetryEntries, runSourceIndexUpdateBatch } = require(
  path.join(srcDir, "sourceIndexUpdateBatch.ts"),
);
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

async function run() {
  await test("the retry set contains the rate limited entry, not only the skipped ones", async () => {
    const entries = ["a", "b", "c", "d"];
    const result = await runSourceIndexUpdateBatch(
      entries,
      0,
      async (value, entry) => {
        if (entry === "b") {
          throw new GitHubResponseError(
            "rate-limit",
            403,
            "rate limit",
            "2026-08-17T10:00:00.000Z",
          );
        }
        return value + 1;
      },
    );

    assert.deepStrictEqual(Array.from(result.succeeded), ["a"]);
    assert.deepStrictEqual(Array.from(result.skipped), ["c", "d"]);
    assert.deepStrictEqual(
      Array.from(getSourceIndexUpdateRetryEntries(result)),
      ["b", "c", "d"],
    );
  });

  await test("non rate limit failures do not stop the batch but stay retryable", async () => {
    const result = await runSourceIndexUpdateBatch(
      ["a", "b"],
      0,
      async (value, entry) => {
        if (entry === "a") {
          throw new Error("transient");
        }
        return value + 1;
      },
    );

    assert.deepStrictEqual(Array.from(result.skipped), []);
    assert.deepStrictEqual(
      Array.from(getSourceIndexUpdateRetryEntries(result)),
      ["a"],
    );
  });

  await test("resume state keeps unique ids and a valid reset time", () => {
    const now = new Date("2026-08-17T09:00:00.000Z");
    const state = createRateLimitResumeState(
      ["alpha", "alpha", "beta", ""],
      { reason: "rate-limit", resetAt: "2026-08-17T10:00:00.000Z" },
      now,
    );

    assert.deepStrictEqual(Array.from(state.sourceIds), ["alpha", "beta"]);
    assert.strictEqual(state.reason, "rate-limit");
    assert.strictEqual(state.resetAt, "2026-08-17T10:00:00.000Z");
    assert.strictEqual(state.savedAt, now.toISOString());
    assert.strictEqual(
      createRateLimitResumeState([], { reason: "deferred" }, now),
      undefined,
    );
    assert.strictEqual(
      createRateLimitResumeState(
        ["alpha"],
        { reason: "rate-limit", resetAt: "not-a-date" },
        now,
      ).resetAt,
      undefined,
    );
  });

  await test("a run capped by the per-run limit stays resumable right away", () => {
    const now = new Date("2026-08-17T09:00:00.000Z");
    // 上限で溢れただけの持ち越しは reset 待ちが要らない
    const state = createRateLimitResumeState(
      ["alpha"],
      { reason: "deferred" },
      now,
    );

    assert.strictEqual(state.reason, "deferred");
    assert.strictEqual(shouldResumeRateLimitedUpdate(state, now), true);
  });

  await test("resume waits for the reset time", () => {
    const state = {
      sourceIds: ["alpha"],
      reason: "rate-limit",
      resetAt: "2026-08-17T10:00:00.000Z",
      savedAt: "2026-08-17T09:00:00.000Z",
    };

    assert.strictEqual(
      shouldResumeRateLimitedUpdate(
        state,
        new Date("2026-08-17T09:59:59.000Z"),
      ),
      false,
    );
    assert.strictEqual(
      shouldResumeRateLimitedUpdate(
        state,
        new Date("2026-08-17T10:00:00.000Z"),
      ),
      true,
    );
  });

  await test("a missing reset time falls back to a delay, and stale state expires", () => {
    const savedAt = new Date("2026-08-17T09:00:00.000Z");
    const state = {
      sourceIds: ["alpha"],
      reason: "rate-limit",
      savedAt: savedAt.toISOString(),
    };

    assert.strictEqual(
      shouldResumeRateLimitedUpdate(
        state,
        new Date(savedAt.getTime() + RATE_LIMIT_RESUME_FALLBACK_DELAY_MS - 1),
      ),
      false,
    );
    assert.strictEqual(
      shouldResumeRateLimitedUpdate(
        state,
        new Date(savedAt.getTime() + RATE_LIMIT_RESUME_FALLBACK_DELAY_MS),
      ),
      true,
    );
    assert.strictEqual(
      shouldResumeRateLimitedUpdate(
        state,
        new Date(savedAt.getTime() + RATE_LIMIT_RESUME_MAX_AGE_MS + 1),
      ),
      false,
    );
    assert.strictEqual(shouldResumeRateLimitedUpdate(undefined), false);
  });

  await test("stored resume state is validated before use", () => {
    assert.strictEqual(normalizeRateLimitResumeState(undefined), undefined);
    assert.strictEqual(
      normalizeRateLimitResumeState({ sourceIds: [] }),
      undefined,
    );
    assert.strictEqual(
      normalizeRateLimitResumeState({ sourceIds: ["a"], savedAt: "nope" }),
      undefined,
    );

    const normalized = normalizeRateLimitResumeState({
      sourceIds: ["a", 5, ""],
      savedAt: "2026-08-17T09:00:00.000Z",
      resetAt: "nope",
    });
    assert.deepStrictEqual(Array.from(normalized.sourceIds), ["a"]);
    assert.strictEqual(normalized.resetAt, undefined);
    // reason が無い過去の state は reset 待ちが要る側へ倒す
    assert.strictEqual(normalized.reason, "rate-limit");
    assert.strictEqual(
      normalizeRateLimitResumeState({
        sourceIds: ["a"],
        savedAt: "2026-08-17T09:00:00.000Z",
        reason: "deferred",
      }).reason,
      "deferred",
    );
  });

  if (failures > 0) {
    throw new Error(`${failures} rate limit resume test(s) failed`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
