const assert = require("assert");
const { loadSrcModule } = require("./load-src-module.js");
const { runBulkInstallPlan } = loadSrcModule("./bulkInstall");
const { showBulkFailureActions, formatBulkFailureDetails } =
  loadSrcModule("./bulkRetry");

async function main() {
  const attempts = [];
  const outcomes = await runBulkInstallPlan(
    ["demo"],
    async (item, options) => {
      attempts.push({ item, allowUninstall: options.allowUninstall });
      return { status: "failed", retryable: true, unsafeSkips: 0 };
    },
    {
      autoRetry: true,
      allowUninstall: false,
      label: (item) => item,
      reportProgress: () => {},
      retryMessage: (item) => item,
    },
  );
  assert.strictEqual(attempts.length, 2);
  assert.ok(attempts.every((attempt) => !attempt.allowUninstall));
  assert.strictEqual(outcomes[0].status, "failed");
  assert.strictEqual(outcomes[0].attempts, 2);
  console.log(
    "PASS retries never uninstall the existing copy and stay bounded",
  );

  const failure = (kind) => ({
    item: kind,
    status: "failed",
    retryable: false,
    unsafeSkips: 0,
    failureKinds: [kind],
  });
  const notices = [];
  const retried = [];
  const reports = [];
  let choice = "Retry 1";
  const deps = {
    retryLabel: (count) => `Retry ${count}`,
    reportLabel: "Report",
    stoppedText: " Stop",
    showWarning: async (message, ...actions) => {
      notices.push({ message, actions });
      return choice;
    },
    retry: async (items) => {
      retried.push(...items);
    },
    report: async (details) => {
      reports.push(details);
    },
    onError: () => assert.fail("notification callback failed"),
  };
  showBulkFailureActions(
    "failed",
    [failure("transport"), failure("auth")],
    0,
    deps,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(Array.from(retried), ["transport"]);
  assert.deepStrictEqual(notices[0].actions, ["Retry 1", "Report"]);
  choice = "Report";
  showBulkFailureActions("failed again", [failure("transport")], 1, deps);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(notices[1].actions, ["Report"]);
  assert.strictEqual(reports.length, 1);
  assert.ok(reports[0].includes("Manual retries: 1"));
  for (const kind of [
    "auth",
    "auth-required",
    "sso-required",
    "classic-pat-forbidden",
    "other",
    "rate-limit",
    "not-found",
    "policy-limit",
    "filesystem",
    "cancelled",
    "unknown",
  ]) {
    showBulkFailureActions("failed", [failure(kind)], 0, deps);
    assert.deepStrictEqual(notices.at(-1).actions, ["Report"]);
    assert.ok(
      formatBulkFailureDetails([failure(kind)], 0).includes(`kinds=${kind};`),
    );
  }
  const privateFailure = {
    ...failure("C:/private/token"),
    previousFailureKinds: ["C:/private/token"],
    item: "private-skill",
    message: "secret",
  };
  const report = formatBulkFailureDetails([privateFailure], 0);
  assert.ok(report.includes("unknown"));
  assert.ok(!/private|token|secret/.test(report));
  const pending = showBulkFailureActions("failed", [failure("transport")], 0, {
    ...deps,
    showWarning: () => new Promise(() => {}),
  });
  assert.strictEqual(pending, undefined);
  console.log(
    "PASS manual retry is bounded, permanent failures stop, reports are sanitized and notifications do not block",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
