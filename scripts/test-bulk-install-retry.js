#!/usr/bin/env node

// 一括インストールの再試行制御を実行して検証する。
//
// これまでは extension.ts の文字列一致で「1 回だけ」「削除しない」を守っていたが、
// それは経路が変わっても通ってしまう。制御だけを純粋関数へ切り出したので、
// ここでは実際に呼び出して不変条件を固定する。

const assert = require("assert");
const { loadSrcModule } = require("./load-src-module.js");

const { runBulkInstallPlan } = loadSrcModule("./bulkInstall");

let failures = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`PASS ${name}`))
    .catch((error) => {
      failures += 1;
      console.error(`FAIL ${name}`);
      console.error(`  ${error.stack || error.message}`);
    });
}

function createPlanOptions(overrides = {}) {
  const progress = [];
  return {
    progress,
    options: {
      autoRetry: true,
      label: (item) => item.label,
      reportProgress: (message, increment) =>
        progress.push({ message, increment }),
      retryMessage: (label) => `retry:${label}`,
      ...overrides,
    },
  };
}

async function main() {
  await test("a transient failure is retried exactly once", async () => {
    const attempts = [];
    const { options } = createPlanOptions();
    const outcomes = await runBulkInstallPlan(
      [{ label: "a" }],
      async (item, context) => {
        attempts.push(context.allowUninstall);
        return attempts.length === 1
          ? { status: "failed", retryable: true, unsafeSkips: 0 }
          : { status: "failed", retryable: true, unsafeSkips: 0 };
      },
      options,
    );

    assert.strictEqual(
      attempts.length,
      2,
      "a retryable item must be attempted exactly twice",
    );
    assert.strictEqual(
      Array.from(outcomes).length,
      1,
      "the retry must replace the outcome instead of appending one",
    );
    assert.strictEqual(
      outcomes[0].retryable,
      false,
      "a retried item must not stay eligible for another automatic retry",
    );
  });

  await test("the automatic retry never asks for an uninstall", async () => {
    const attempts = [];
    const { options } = createPlanOptions();
    await runBulkInstallPlan(
      [{ label: "a" }],
      async (item, context) => {
        attempts.push(context.allowUninstall);
        return {
          status: "failed",
          retryable: attempts.length === 1,
          unsafeSkips: 0,
        };
      },
      options,
    );

    assert.deepStrictEqual(
      Array.from(attempts),
      [true, false],
      "the first pass may replace the folder, the retry must install in place",
    );
  });

  await test("non-retryable failures are never retried", async () => {
    let calls = 0;
    const { options } = createPlanOptions();
    const outcomes = await runBulkInstallPlan(
      [{ label: "rate-limited" }, { label: "not-found" }],
      async () => {
        calls += 1;
        return { status: "failed", retryable: false, unsafeSkips: 0 };
      },
      options,
    );

    assert.strictEqual(calls, 2, "permanent failures must be attempted once");
    assert.deepStrictEqual(
      Array.from(outcomes).map((outcome) => outcome.status),
      ["failed", "failed"],
    );
  });

  await test("a manual rerun does not start another automatic retry", async () => {
    let calls = 0;
    const { options } = createPlanOptions({ autoRetry: false });
    await runBulkInstallPlan(
      [{ label: "a" }],
      async () => {
        calls += 1;
        return { status: "failed", retryable: true, unsafeSkips: 0 };
      },
      options,
    );

    assert.strictEqual(
      calls,
      1,
      "autoRetry:false must not retry even when the failure is transient",
    );
  });

  await test("a successful retry replaces the failed outcome", async () => {
    let calls = 0;
    const { options } = createPlanOptions();
    const outcomes = await runBulkInstallPlan(
      [{ label: "a" }],
      async () => {
        calls += 1;
        return calls === 1
          ? { status: "failed", retryable: true, unsafeSkips: 3 }
          : { status: "ok", retryable: false, unsafeSkips: 1 };
      },
      options,
    );

    assert.strictEqual(outcomes[0].status, "ok");
    assert.strictEqual(
      outcomes[0].unsafeSkips,
      3,
      "the merge must keep the larger skip count, not the last one",
    );
  });

  await test("every retryable item is retried, in batch order", async () => {
    const attempts = [];
    const { options } = createPlanOptions();
    await runBulkInstallPlan(
      [{ label: "a" }, { label: "b" }, { label: "c" }],
      async (item) => {
        attempts.push(item.label);
        return {
          status: "failed",
          retryable: item.label !== "b" && attempts.length <= 3,
          unsafeSkips: 0,
        };
      },
      options,
    );

    assert.deepStrictEqual(
      Array.from(attempts),
      ["a", "b", "c", "a", "c"],
      "retries must follow the original batch order and skip permanent failures",
    );
  });

  await test("progress is reported per item and once per retry", async () => {
    const { options, progress } = createPlanOptions();
    await runBulkInstallPlan(
      [{ label: "a" }, { label: "b" }],
      async (item) => ({
        status: "failed",
        retryable: item.label === "a",
        unsafeSkips: 0,
      }),
      options,
    );

    const messages = Array.from(progress).map((entry) => entry.message);
    assert.deepStrictEqual(messages, ["a (1/2)", "b (2/2)", "retry:a"]);

    const increments = Array.from(progress).map((entry) => entry.increment);
    assert.deepStrictEqual(
      increments,
      [50, 50, undefined],
      "the progress bar must advance once per item and not again on a retry",
    );
  });

  await test("an empty batch does not divide by zero", async () => {
    const { options, progress } = createPlanOptions();
    const outcomes = await runBulkInstallPlan(
      [],
      async () => {
        throw new Error("must not be called");
      },
      options,
    );

    assert.deepStrictEqual(Array.from(outcomes), []);
    assert.deepStrictEqual(Array.from(progress), []);
  });

  await test("cancelling stops before the next item starts", async () => {
    const attempted = [];
    let cancelled = false;
    const { options } = createPlanOptions({
      isCancelled: () => cancelled,
    });

    const outcomes = await runBulkInstallPlan(
      [{ label: "a" }, { label: "b" }, { label: "c" }],
      async (item) => {
        attempted.push(item.label);
        cancelled = item.label === "b";
        return { status: "ok", retryable: false, unsafeSkips: 0 };
      },
      options,
    );

    assert.deepStrictEqual(
      Array.from(attempted),
      ["a", "b"],
      "the item already running finishes, the next one must not start",
    );
    assert.strictEqual(
      Array.from(outcomes).length,
      2,
      "the caller must be able to see how many items were processed",
    );
  });

  await test("cancelling also stops the automatic retry pass", async () => {
    const attempted = [];
    let cancelled = false;
    const { options } = createPlanOptions({
      isCancelled: () => cancelled,
    });

    await runBulkInstallPlan(
      [{ label: "a" }, { label: "b" }],
      async (item, context) => {
        attempted.push(`${item.label}:${context.allowUninstall}`);
        if (!context.allowUninstall) {
          cancelled = true;
        }
        return { status: "failed", retryable: true, unsafeSkips: 0 };
      },
      options,
    );

    assert.deepStrictEqual(
      Array.from(attempted),
      ["a:true", "b:true", "a:false"],
      "only the first retry runs before the cancellation is observed",
    );
  });

  await test("an uncancelled run processes every item", async () => {
    const { options } = createPlanOptions({ isCancelled: () => false });
    const outcomes = await runBulkInstallPlan(
      [{ label: "a" }, { label: "b" }],
      async () => ({ status: "ok", retryable: false, unsafeSkips: 0 }),
      options,
    );

    assert.strictEqual(Array.from(outcomes).length, 2);
  });
}

main().then(() => {
  if (failures > 0) {
    process.exitCode = 1;
  }
});
