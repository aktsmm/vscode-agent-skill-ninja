const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { loadSrcModule } = require("./load-src-module");

const sourcePath = path.join(__dirname, "../src/extension.ts");
const sourceText = fs.readFileSync(sourcePath, "utf8");
const source = ts.createSourceFile(
  sourcePath,
  sourceText,
  ts.ScriptTarget.Latest,
  true,
);
const names = [
  "installBulkItem",
  "runBulkInstall",
  "summarizeBulkInstall",
  "showBulkInstallSummary",
  "retryFailedBulkInstalls",
  "formatPartialInstallSuffix",
  "formatCancelledSuffix",
];
const definitions = names.map((name) => {
  const matches = source.statements.filter(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  assert.equal(matches.length, 1, `Expected actual extension function ${name}`);
  return matches[0].getText(source);
});
const registrations = [];
function visit(node) {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.getText(source) === "vscode.commands.registerCommand" &&
    ts.isStringLiteral(node.arguments[0]) &&
    node.arguments[0].text === "skillNinja.reportBug"
  ) {
    registrations.push(node.getText(source));
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(registrations.length, 1, "Expected actual reportBug registration");
const executable = ts.transpileModule(
  [
    ...definitions,
    registrations[0] + ";",
    `globalThis.api = { ${names.join(", ")} };`,
  ].join("\n"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  },
).outputText;

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settle() {
  for (let turn = 0; turn < 8; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function makeToken(cancelled = false) {
  const listeners = new Set();
  return {
    isCancellationRequested: cancelled,
    disposed: 0,
    onCancellationRequested(listener) {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
          this.disposed++;
        },
      };
    },
    cancel() {
      this.isCancellationRequested = true;
      for (const listener of listeners) listener();
    },
  };
}

function makeItem(name = "private-skill") {
  return {
    label: name,
    skill: {
      name,
      repoUrl: "https://github.com/private-owner/private-repo",
      localPath: "C:/private-home/private-skill",
      metadata: { secret: "private-secret" },
    },
    root: {
      rootUri: "C:/private-home/skills",
      instructionPath: "C:/private-home/AGENTS.md",
    },
    uninstallRelativePath: "private-skill",
    metadata: { localPath: "C:/private-home/metadata", token: "private-token" },
  };
}

function harness() {
  const state = {
    installs: [],
    deletes: [],
    warnings: [],
    information: [],
    reports: [],
    documents: [],
    shown: [],
    external: [],
    events: [],
    sideEffects: [],
    errors: [],
    progress: [],
    token: makeToken(),
    handlers: new Map(),
  };
  class SkillInstallIncompleteError extends Error {
    constructor(kinds) {
      super("private-secret C:/private-home/raw-error");
      this.failures = kinds.map((kind) => ({ kind, message: this.message }));
    }
  }
  state.fail = (kinds = ["transport"]) => {
    throw new SkillInstallIncompleteError(kinds);
  };
  state.install = () => state.fail();
  const forbidden = () =>
    assert.fail("Unexpected filesystem mutation or network request");
  const vscode = {
    version: "test-version",
    ProgressLocation: { Notification: 15 },
    Uri: { parse: (value) => new URL(value) },
    extensions: {
      getExtension: () => ({ packageJSON: { version: "test-extension" } }),
    },
    commands: {
      registerCommand: (name, handler) => {
        state.handlers.set(name, handler);
        return {};
      },
      executeCommand: async (name, ...args) => {
        state.reports.push({ name, args });
        assert.equal(name, "skillNinja.reportBug");
        return state.handlers.get(name)(...args);
      },
    },
    workspace: {
      fs: new Proxy({}, { get: () => forbidden }),
      getConfiguration: () => ({ get: (_key, fallback) => fallback }),
      openTextDocument: async (options) => {
        state.events.push("preview-created");
        state.documents.push(options);
        return options;
      },
    },
    window: {
      showInformationMessage: (message) => {
        state.information.push(message);
        return Promise.resolve();
      },
      showWarningMessage: (message, ...actions) => {
        const choice = deferred();
        state.warnings.push({ message, actions, choice });
        state.events.push(
          typeof actions[0] === "object" ? "confirmation" : "summary",
        );
        return choice.promise;
      },
      withProgress: async (_options, task) =>
        task({ report: (value) => state.progress.push(value) }, state.token),
      showTextDocument: async (document, options) => {
        state.events.push("preview-shown");
        state.shown.push({ document, options });
      },
    },
    env: {
      openExternal: async (uri) => {
        state.events.push("external");
        state.external.push(uri);
        return true;
      },
    },
  };
  const sandbox = {
    vscode,
    getGitHubToken: async () => undefined,
    createSkillRevisionResolver: () => async () => {
      throw new Error("mock revision unavailable");
    },
    AbortController,
    process: { platform: "test-platform" },
    console: { error: (...args) => state.errors.push(args) },
    fetch: forbidden,
    installSkill: async (...args) => {
      state.installs.push(args);
      return state.install(...args);
    },
    uninstallSkillByPath: async (...args) => {
      state.deletes.push(args);
      forbidden();
    },
    SkillInstallIncompleteError,
    classifySkillInstallFailure: () => "unknown",
    isRetryableInstallFailure: (failures) =>
      failures.length > 0 &&
      failures.every(
        ({ kind }) => kind === "transport" || kind === "server-error",
      ),
    ...loadSrcModule("./bulkInstall"),
    ...loadSrcModule("./bulkRetry"),
    ...loadSrcModule("./issueReport"),
    isJapanese: () => false,
    messages: {
      retryingFailedInstalls: (label) => `Retrying ${label}`,
      retryFailedInstallsAction: (count) => `Retry ${count}`,
      actionReportBug: () => "Report bug",
      retryingFailedInstallsTitle: () => "Retry failed installs",
      retryFailedInstallsSummary: (done, total) => `${done}/${total} installed`,
    },
    applyBulkInstallSideEffects: async (roots) => state.sideEffects.push(roots),
  };
  vm.runInNewContext(executable, sandbox, {
    filename: sourcePath,
    timeout: 1000,
  });
  state.api = sandbox.api;
  state.run = (items, options = {}) =>
    state.api.runBulkInstall(
      items,
      {},
      "workspace",
      { report: (value) => state.progress.push(value) },
      { autoRetry: true, allowUninstall: false, ...options },
    );
  state.summary = (outcomes) =>
    state.api.showBulkInstallSummary(
      "0/1 installed",
      outcomes,
      {},
      "workspace",
    );
  return state;
}

function assertPrivateDataAbsent(text) {
  for (const secret of [
    "private-skill",
    "private-owner",
    "private-repo",
    "private-home",
    "private-secret",
    "private-token",
  ]) {
    assert.ok(!text.includes(secret), `Leaked ${secret}`);
  }
}

async function main() {
  let failures = 0;
  async function test(name, action) {
    try {
      await action();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${name}: ${error.stack}`);
    }
  }

  await test("actual extension: transient auto retry then manual once, no delete, no 0/1 loop", async () => {
    const state = harness();
    const outcomes = await state.run([makeItem()]);
    assert.equal(state.installs.length, 2);
    assert.equal(outcomes[0].attempts, 2);
    assert.equal(outcomes[0].retryable, false);
    assert.equal(outcomes[0].failureKinds[0], "transport");
    await state.summary(outcomes);
    assert.deepEqual(state.warnings[0].actions, ["Retry 1", "Report bug"]);
    state.warnings[0].choice.resolve("Retry 1");
    await settle();
    assert.equal(
      state.installs.length,
      3,
      "Manual retry must not nest another auto retry",
    );
    assert.equal(state.warnings.length, 2);
    assert.ok(state.warnings[1].message.includes("0/1 installed"));
    assert.deepEqual(
      state.warnings[1].actions,
      ["Report bug"],
      "0/1 must not offer an endless Retry 1 loop",
    );
    assert.equal(state.sideEffects.length, 1);
    assert.equal(state.deletes.length, 0);
    assert.ok(state.installs.every((args) => args[4].interactive === false));
    state.warnings[1].choice.resolve("Report bug");
    await settle();
    assert.equal(state.reports.length, 1);
    const diagnostics = state.reports[0].args[0];
    assert.ok(diagnostics.includes("Manual retries: 1"));
    assert.ok(diagnostics.includes("transport"));
    assertPrivateDataAbsent(diagnostics);
    assert.equal(state.documents[0].content, diagnostics);
    assert.equal(state.external.length, 0);
  });

  await test("actual extension: all permanent failure kinds have no auto/manual retry", async () => {
    for (const kind of [
      "auth",
      "rate-limit",
      "not-found",
      "policy-limit",
      "filesystem",
      "cancelled",
      "unknown",
    ]) {
      const state = harness();
      state.install = () => state.fail([kind]);
      const outcomes = await state.run([makeItem()]);
      assert.equal(state.installs.length, 1, kind);
      await state.summary(outcomes);
      assert.deepEqual(state.warnings[0].actions, ["Report bug"], kind);
      assert.equal(state.deletes.length, 0);
    }
  });

  await test("actual extension: successful retry retains permanent failures and issue action", async () => {
    const state = harness();
    const transient = makeItem("transient");
    const permanent = makeItem("permanent");
    state.install = (skill) =>
      state.fail([skill === transient.skill ? "transport" : "auth-required"]);
    const outcomes = await state.run([transient, permanent]);
    await state.summary(outcomes);
    state.install = () => ({ status: "ok", failures: [] });
    state.warnings[0].choice.resolve("Retry 1");
    await settle();
    assert.equal(state.warnings.length, 2);
    assert.ok(
      state.warnings[1].message.includes(
        "1 failure(s) outside this retry remain",
      ),
    );
    assert.deepEqual(state.warnings[1].actions, ["Report bug"]);
    assert.equal(state.information.length, 0);
    state.warnings[1].choice.resolve("Report bug");
    await settle();
    assert.ok(state.reports[0].args[0].includes("auth-required"));
    assert.ok(state.reports[0].args[0].includes("attempts in last batch=0"));
  });

  await test("actual extension: summaries return while notification remains unanswered", async () => {
    const state = harness();
    const outcomes = await state.run([makeItem()]);
    let returned = false;
    const completion = state.summary(outcomes).then(() => {
      returned = true;
    });
    await settle();
    assert.equal(
      returned,
      true,
      "Summary incorrectly awaits notification choice",
    );
    await completion;
    assert.equal(state.installs.length, 2);
  });

  await test("actual extension: partial/success counts, unsafe skips and recovered retry", async () => {
    const state = harness();
    state.install = () => ({
      status: "partial",
      failures: [{ kind: "server-error" }],
      skippedUnsafeEntries: ["unsafe"],
    });
    const outcomes = await state.run([makeItem()]);
    const summary = state.api.summarizeBulkInstall(outcomes);
    assert.equal(summary.failedCount, 0);
    assert.equal(summary.partialCount, 1);
    assert.equal(summary.unsafeSkips, 1);
    assert.equal(summary.failedItems[0], outcomes[0].item);
    state.install = () => ({ status: "ok", failures: [] });
    await state.summary(outcomes);
    state.warnings[0].choice.resolve("Retry 1");
    await settle();
    assert.equal(state.installs.length, 3);
    assert.equal(state.warnings.length, 1);
    assert.ok(state.information[0].includes("1/1 installed"));
    assert.equal(state.deletes.length, 0);
  });

  await test("actual extension: canceled skipped items are not reported as attempted failures", async () => {
    const state = harness();
    const items = [makeItem("first"), makeItem("second")];
    const previous = items.map((item) => ({
      item,
      status: "failed",
      retryable: false,
      unsafeSkips: 0,
      attempts: 2,
      failureKinds: ["server-error"],
    }));
    state.install = () => {
      state.token.cancel();
      return state.fail();
    };
    await state.api.retryFailedBulkInstalls(items, {}, "workspace", previous);
    assert.equal(state.installs.length, 1);
    assert.equal(state.installs[0][4].signal.aborted, true);
    assert.equal(state.token.disposed, 1);
    assert.deepEqual(state.warnings[0].actions, ["Report bug"]);
    assert.ok(state.warnings[0].message.includes("processed 1/2"));
    state.warnings[0].choice.resolve("Report bug");
    await settle();
    const diagnostics = state.reports[0].args[0];
    assert.ok(diagnostics.includes("transport"));
    assert.ok(diagnostics.includes("cancelled"));
    const skippedLine = diagnostics
      .split("\n")
      .find((line) => line.includes("cancelled"));
    assert.ok(skippedLine.includes("previous kinds=server-error"));
    assert.ok(
      skippedLine.includes("attempts in last batch=0") ||
        skippedLine.includes("not attempted"),
      `Unstarted item must be distinguishable from an attempted cancellation: ${skippedLine}`,
    );
  });

  await test("registered reportBug: preview then modal, no external access until approval, safe draft only", async () => {
    for (const approve of [false, true]) {
      const state = harness();
      state.install = () => state.fail(["C:/private-home/private-token"]);
      const outcomes = await state.run([makeItem()]);
      await state.summary(outcomes);
      state.warnings[0].choice.resolve("Report bug");
      await settle();
      const diagnostics = state.reports[0].args[0];
      assertPrivateDataAbsent(diagnostics);
      assert.ok(diagnostics.includes("unknown"));
      assert.equal(state.documents[0].content, diagnostics);
      assert.equal(state.documents[0].language, "markdown");
      assert.equal(state.shown[0].options.preview, true);
      assert.equal(state.warnings[1].actions[0].modal, true);
      assert.deepEqual(state.events, [
        "summary",
        "preview-created",
        "preview-shown",
        "confirmation",
      ]);
      assert.equal(state.external.length, 0);
      state.warnings[1].choice.resolve(
        approve ? state.warnings[1].actions[1] : undefined,
      );
      await settle();
      assert.equal(state.external.length, approve ? 1 : 0);
      if (approve) {
        const url = state.external[0];
        assert.equal(url.origin, "https://github.com");
        assert.equal(
          url.pathname,
          "/aktsmm/vscode-agent-skill-ninja/issues/new",
        );
        assert.equal(url.username, "");
        assert.equal(url.password, "");
        assert.ok(url.searchParams.get("body").includes(diagnostics));
        assertPrivateDataAbsent(url.href);
      }
      assert.equal(
        state.errors.filter(
          (args) => args[0] === "[Skill Ninja] Bulk failure action failed",
        ).length,
        0,
      );
    }
  });
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
