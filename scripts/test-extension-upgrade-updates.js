const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const source = fs.readFileSync(
  path.join(__dirname, "..", "src", "extension.ts"),
  "utf8",
);
const parsed = ts.createSourceFile(
  "extension.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
);
const declarations = [
  "refreshUpgradeMetadata",
  "resumePendingUpgradeMetadata",
  "checkVersionAndRefreshMetadata",
].map((name) => {
  const declaration = parsed.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  assert.ok(declaration, `missing ${name}`);
  return declaration.getText(parsed);
});
const javascript = ts.transpileModule(
  `${declarations.join("\n")}\nmodule.exports = { checkVersionAndRefreshMetadata, resumePendingUpgradeMetadata };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

async function scenario({
  lastVersion = "1.0.0",
  setting = "prompt",
  eligible = true,
  workspace = true,
  failure = false,
  scanFailure = false,
  metadataFailure = false,
  recoveryBlocked = false,
  pendingMetadata = false,
  reminderState,
  resume = false,
  restarts = 0,
  result = { checkFailed: 0 },
} = {}) {
  const events = [];
  const notices = [];
  let scanOptions;
  let storedVersion = lastVersion;
  const metadataPending =
    typeof pendingMetadata === "string"
      ? pendingMetadata
      : pendingMetadata
        ? "file:///workspace"
        : undefined;
  const pendingKey = "skillNinja.upgradeMetadataPending";
  const reminderKey = "skillNinja.upgradeMetadataPendingReminderShown";
  const workspaceState = new Map();
  if (metadataPending) workspaceState.set(pendingKey, metadataPending);
  if (reminderState) workspaceState.set(reminderKey, reminderState);
  const context = {
    globalState: {
      get: () => storedVersion,
      update: async (_, value) => {
        storedVersion = value;
        events.push("version");
      },
    },
    workspaceState: {
      get: (key) => workspaceState.get(key),
      update: async (key, value) => {
        if (value === undefined) workspaceState.delete(key);
        else workspaceState.set(key, value);
      },
    },
  };
  const module = { exports: {} };
  const sandbox = {
    module,
    EXTENSION_VERSION: "2.0.0",
    UPGRADE_METADATA_PENDING_KEY: pendingKey,
    UPGRADE_METADATA_REMINDER_KEY: reminderKey,
    upgradeMetadataRefreshing: false,
    activeContext: context,
    extensionShuttingDown: false,
    console: { log() {}, error() {} },
    isJapanese: () => false,
    messages: {
      updateUpgradeStartFailed: () => "check failed",
      updateUpgradeMetadataSkipped: () => "metadata skipped",
      updateUpgradeMetadataFailed: () => "metadata failed",
      updateUpgradeMetadataRetried: () => "metadata resumed",
      updateUpgradeMetadataWorkspaceChanged: () => "workspace changed",
    },
    vscode: {
      workspace: {
        getConfiguration: () => ({
          get: (name) =>
            name === "autoUpdateSkillsOnUpgrade" ? setting : true,
        }),
      },
      window: {
        showInformationMessage: (message) => notices.push(message),
        showWarningMessage: (message) => notices.push(message),
      },
    },
    getManagedInstalledSkillsWithMeta: async (_, options) => {
      scanOptions = options;
      if (scanFailure) throw new Error("access denied");
      return [{ eligible }];
    },
    shouldAutoUpdateManagedInstalledSkillFromIndex: (entry) => entry.eligible,
    getManagedSkillRoots: async () => [
      { rootUri: { scheme: "file", fsPath: "/workspace/skills" } },
      { rootUri: { scheme: "file", fsPath: "/home/skills" } },
    ],
    assertNoSkillUpdateRecovery: async (_, rootPath) => {
      if (recoveryBlocked && rootPath === "/home/skills") {
        throw new Error("recovery required");
      }
    },
    refreshManagedSkillMetadata: async (_, options) => {
      events.push("metadata");
      if (metadataFailure) options.onFailure();
      return 1;
    },
    updateAllInstructionFiles: async () => events.push("output"),
    showRefFormatUpdateNotice: async () => events.push("ref-notice"),
    showFrozenOutputMigrationNotice: async () => events.push("frozen-notice"),
  };
  vm.runInNewContext(javascript, sandbox);
  const uri = workspace
    ? { fsPath: "/workspace", toString: () => "file:///workspace" }
    : undefined;
  const checkVersion = () =>
    module.exports.checkVersionAndRefreshMetadata(context, uri, false, async (actualUri) => {
      assert.strictEqual(actualUri, uri);
      assert.strictEqual(storedVersion, "2.0.0");
      events.push("check");
      if (failure) throw new Error("check failed");
      return result;
    });
  await checkVersion();
  for (let i = 0; i < restarts; i++) await checkVersion();
  if (resume) await module.exports.resumePendingUpgradeMetadata(context, uri);
  return {
    events,
    notices,
    storedVersion,
    scanOptions,
    metadataPending: Boolean(workspaceState.get(pendingKey)),
  };
}

async function main() {
  for (const setting of ["prompt", "always"]) {
    const checked = await scenario({
      setting,
      result: { cancelled: true, checkFailed: 0 },
    });
    assert.deepStrictEqual(checked.events, [
      "version",
      "check",
      "metadata",
      "output",
      "ref-notice",
      "frozen-notice",
    ]);
    assert.ok(!checked.notices.some((notice) => /to latest version/.test(notice)));
    assert.strictEqual(checked.scanOptions.strict, true);
  }
  const never = await scenario({ setting: "never" });
  assert.ok(!never.events.includes("check"));
  assert.strictEqual(never.scanOptions, undefined);
  assert.ok(never.events.includes("metadata"));
  const neverMetadataFailed = await scenario({
    setting: "never",
    metadataFailure: true,
  });
  assert.ok(!neverMetadataFailed.events.includes("check"));
  assert.ok(neverMetadataFailed.notices.includes("metadata failed"));
  assert.strictEqual(neverMetadataFailed.metadataPending, true);
  const interrupted = await scenario({ setting: "never", recoveryBlocked: true });
  assert.ok(!interrupted.events.includes("metadata"));
  assert.ok(interrupted.notices.includes("metadata failed"));
  assert.strictEqual(interrupted.metadataPending, true);
  const interruptedRetry = await scenario({
    lastVersion: "2.0.0",
    pendingMetadata: true,
    resume: true,
    recoveryBlocked: true,
  });
  assert.ok(!interruptedRetry.events.includes("metadata"));
  assert.strictEqual(interruptedRetry.metadataPending, true);
  const noEligible = await scenario({ eligible: false });
  assert.ok(!noEligible.events.includes("check"));
  assert.ok(noEligible.events.includes("metadata"));
  const unchanged = await scenario({ lastVersion: "2.0.0" });
  assert.deepStrictEqual(unchanged.events, []);
  const pending = await scenario({
    lastVersion: "2.0.0",
    pendingMetadata: true,
    restarts: 2,
  });
  assert.strictEqual(pending.notices.filter((notice) => notice === "metadata skipped").length, 1);
  assert.strictEqual(pending.metadataPending, true);
  const recovered = await scenario({
    lastVersion: "2.0.0",
    pendingMetadata: true,
    resume: true,
  });
  assert.ok(recovered.events.includes("metadata"));
  assert.strictEqual(recovered.metadataPending, false);
  assert.ok(recovered.notices.includes("metadata resumed"));
  const retryFailed = await scenario({
    lastVersion: "2.0.0",
    pendingMetadata: true,
    resume: true,
    metadataFailure: true,
  });
  assert.strictEqual(retryFailed.metadataPending, true);
  assert.ok(retryFailed.notices.includes("metadata failed"));
  const otherWorkspace = await scenario({
    lastVersion: "2.0.0",
    pendingMetadata: "file:///other",
    resume: true,
  });
  assert.ok(!otherWorkspace.events.includes("metadata"));
  assert.strictEqual(otherWorkspace.metadataPending, true);
  assert.ok(otherWorkspace.notices.includes("workspace changed"));
  const upgradeWithOtherWorkspace = await scenario({
    pendingMetadata: "file:///other",
    reminderState: "pending",
    restarts: 2,
  });
  assert.strictEqual(upgradeWithOtherWorkspace.storedVersion, "1.0.0");
  assert.strictEqual(upgradeWithOtherWorkspace.metadataPending, true);
  assert.ok(!upgradeWithOtherWorkspace.events.includes("check"));
  assert.ok(!upgradeWithOtherWorkspace.events.includes("metadata"));
  assert.strictEqual(
    upgradeWithOtherWorkspace.notices.filter((notice) => notice === "workspace changed").length,
    1,
  );
  const nothingPending = await scenario({ lastVersion: "2.0.0", resume: true });
  assert.ok(!nothingPending.events.includes("metadata"));
  const initial = await scenario({ lastVersion: null });
  assert.deepStrictEqual(initial.events, ["version"]);
  const noWorkspace = await scenario({ workspace: false });
  assert.deepStrictEqual(noWorkspace.events, []);
  const failed = await scenario({ failure: true });
  assert.ok(failed.notices.includes("check failed"));
  assert.ok(!failed.events.includes("metadata"));
  assert.ok(failed.notices.includes("metadata skipped"));
  assert.strictEqual(failed.metadataPending, true);
  assert.ok(failed.events.includes("frozen-notice"));
  const newFailureAfterReminder = await scenario({
    pendingMetadata: true,
    reminderState: "pending",
    failure: true,
    restarts: 2,
  });
  assert.strictEqual(
    newFailureAfterReminder.notices.filter((notice) => notice === "metadata skipped").length,
    2,
  );
  const scanFailed = await scenario({ scanFailure: true });
  assert.ok(scanFailed.notices.includes("check failed"));
  assert.ok(!scanFailed.events.includes("check"));
  assert.ok(!scanFailed.events.includes("metadata"));
  assert.ok(scanFailed.notices.includes("metadata skipped"));
  const partial = await scenario({ result: { checkFailed: 1 } });
  assert.ok(!partial.events.includes("metadata"));
  assert.ok(partial.notices.includes("metadata skipped"));
  assert.strictEqual(partial.metadataPending, true);
  const updateFailed = await scenario({
    result: { checkFailed: 0, updateFailed: 1, cancelled: true },
  });
  assert.ok(!updateFailed.events.includes("metadata"));
  assert.ok(updateFailed.notices.includes("metadata skipped"));

  let handlerDeclaration;
  const findHandler = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === "handleSkillMdChange") {
      handlerDeclaration = node;
    }
    ts.forEachChild(node, findHandler);
  };
  findHandler(parsed);
  assert.ok(handlerDeclaration?.initializer);
  const watcherCode = ts.transpileModule(
    `module.exports = ${handlerDeclaration.initializer.getText(parsed)};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const watcherModule = { exports: {} };
  const scheduled = [];
  let blocked = true;
  let storeBroken = false;
  let notices = 0;
  let refreshed = 0;
  class RecoveryRequired extends Error {}
  class RecoveryStoreError extends Error {}
  vm.runInNewContext(watcherCode, {
    module: watcherModule,
    isContextActive: () => true,
    pendingUpdates: new Map(),
    setTimeout: (callback) => { scheduled.push(callback); return {}; },
    clearTimeout: () => {},
    workspaceFolder: { uri: {} },
    findManagedRootForSkillFile: async () => ({ rootUri: {} }),
    assertNoSkillUpdateRecovery: async () => {
      if (storeBroken) throw new RecoveryStoreError();
      if (blocked) throw new RecoveryRequired();
    },
    notifyInterruptedSkillUpdates: async () => { notices++; },
    SkillUpdateRecoveryRequiredError: RecoveryRequired,
    SkillUpdateRecoveryStoreError: RecoveryStoreError,
    context: {},
    path,
    refreshSingleSkillMetadata: async () => { refreshed++; return false; },
    vscode: {
      Uri: { joinPath: () => ({}) },
      workspace: { fs: { stat: async () => ({}) } },
    },
  });
  await watcherModule.exports({ fsPath: "C:\\skills\\.skill-update-test\\stage\\demo\\SKILL.md" });
  await watcherModule.exports({ fsPath: "/skills/.skill-update-test/backup/SKILL.md" });
  assert.equal(scheduled.length, 0, "transaction files must not schedule metadata writes");
  await watcherModule.exports({ fsPath: "C:\\skills\\demo\\SKILL.md" });
  assert.equal(scheduled.length, 1, "ordinary skill saves must still be watched");
  await scheduled[0]();
  assert.equal(refreshed, 0, "a pending recovery must protect target metadata");
  blocked = false;
  await watcherModule.exports({ fsPath: "C:\\skills\\demo\\SKILL.md" });
  await scheduled[1]();
  assert.equal(refreshed, 1, "metadata refresh must resume after recovery");
  storeBroken = true;
  await watcherModule.exports({ fsPath: "C:\\skills\\demo\\SKILL.md" });
  await scheduled[2]();
  assert.equal(refreshed, 1);
  assert.equal(notices, 1, "unreadable recovery must be reported");

  const registration = source.indexOf("const skillUpdateController = registerSkillUpdateCommands(");
  const startup = source.indexOf("upgradeStartup = checkVersionAndRefreshMetadata(");
  assert.ok(registration >= 0 && startup > registration);
  console.log("PASS extension upgrade update routing and metadata refresh");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
