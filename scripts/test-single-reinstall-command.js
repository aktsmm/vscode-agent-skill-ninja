const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const extensionPath = path.join(root, "src", "extension.ts");
const source = ts.createSourceFile(
  extensionPath,
  fs.readFileSync(extensionPath, "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const matches = [];
const recoveryReporters = [];
(function visit(node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(source) === "vscode.commands.registerCommand" &&
    ts.isStringLiteral(node.arguments[0]) &&
    node.arguments[0].text === "skillNinja.reinstall"
  ) {
    matches.push(node.getText(source));
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === "reportReinstallRecovery"
  ) {
    recoveryReporters.push(node.getText(source));
  }
  ts.forEachChild(node, visit);
})(source);
assert.equal(matches.length, 1, "exactly one skillNinja.reinstall registration");
assert.equal(recoveryReporters.length, 1, "exactly one recovery reporter");
assert.ok(
  !matches[0].includes("uninstallSkillByPath"),
  "the single reinstall must not delete the installed copy before the new one is verified",
);
const executable = ts.transpileModule(`const ${recoveryReporters[0]};\n${matches[0]}`, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;

const i18nPath = path.join(root, "src", "i18n.ts");
const i18nOutput = ts.transpileModule(fs.readFileSync(i18nPath, "utf8"), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;

// 実際の i18n を言語ごとに読み込む。文言を test 側で複製せず、実際の表示文言と照合する
function loadI18n(language) {
  const module = { exports: {} };
  const stub = {
    workspace: { getConfiguration: () => ({ get: () => language }) },
    env: { language },
  };
  vm.runInNewContext(
    i18nOutput,
    {
      module,
      exports: module.exports,
      require: (id) => (id === "vscode" ? stub : require(id)),
      console,
    },
    { filename: i18nPath },
  );
  return module.exports;
}

class ConflictError extends Error {}
class RecoveryRequiredError extends Error {
  constructor(backupPath) {
    super("recovery");
    this.backupPath = backupPath;
  }
}

const skillRoot = {
  isManaged: true,
  isReadOnly: false,
  rootUri: { fsPath: "/skills" },
};
const demoMeta = {
  name: "demo",
  source: "src",
  remotePath: "group/demo",
  relativePath: "group/demo",
};

async function run({
  language = "en",
  metas = [demoMeta],
  itemPath = "group/demo",
  confirm = true,
  install,
  autoUpdate = true,
  showDetails = false,
} = {}) {
  const calls = {
    install: [],
    warnings: [],
    errors: [],
    infos: [],
    channel: [],
    channelShown: 0,
    output: 0,
    refresh: 0,
  };
  const i18n = loadI18n(language);
  calls.messages = i18n.messages;
  let handler;
  const indexSkill = { name: "demo", source: "src", path: "group/demo" };
  const vscode = {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
      getConfiguration: () => ({ get: () => autoUpdate }),
    },
    ProgressLocation: { Notification: 15 },
    commands: {
      registerCommand: (_id, callback) => {
        handler = callback;
        return { dispose() {} };
      },
    },
    window: {
      showErrorMessage: (message, ...buttons) => {
        calls.errors.push({ message, buttons });
        return Promise.resolve(showDetails ? buttons[0] : undefined);
      },
      showInformationMessage: (message) => {
        calls.infos.push(message);
        return Promise.resolve(undefined);
      },
      showWarningMessage: (message, options, ...buttons) => {
        calls.warnings.push({ message, options, buttons });
        return Promise.resolve(confirm ? buttons[0] : undefined);
      },
      withProgress: (_options, callback) => callback(),
    },
  };
  vm.runInNewContext(executable, {
    vscode,
    setTimeout: () => 0,
    context: {},
    isJapanese: i18n.isJapanese,
    messages: i18n.messages,
    resolveCurrentSkillRoot: (_item, roots) => roots[0],
    getCurrentUpdateRoots: async () => [skillRoot],
    getInstalledSkillsWithMeta: async () => metas,
    loadSkillIndex: async () => ({
      skills: [indexSkill],
      sources: [{ id: "src" }],
    }),
    isLocalInstalledSkillMeta: () => false,
    findIndexedSkillForInstalledMeta: () => indexSkill,
    refreshIndexForInstalledMetas: async (index) => index,
    offerDisableMissingReinstallChecks: async () => 0,
    refreshInstalledViews: () => {},
    getGitHubToken: async () => undefined,
    resolveSkillDownloadTarget: async () => ({
      owner: "owner",
      repo: "repo",
      branch: "main",
      remotePath: "group/demo",
    }),
    createSkillRevisionResolver: () => async () => ({ commitSha: "a".repeat(40) }),
    installSkillUpdate: async (_skill, _workspace, _context, _root, meta, _revision, options) => {
      calls.install.push({ meta, options });
      return install ? install(options) : { status: "ok" };
    },
    markRecentlyInstalled: () => {},
    statusBarItem: { show() {}, hide() {}, text: "" },
    refreshAllViews: () => {
      calls.refresh++;
    },
    classifySkillInstallFailure: (error) =>
      error?.name === "AbortError" ? "cancelled" : "other",
    SkillUpdateConflictError: ConflictError,
    SkillUpdateRecoveryRequiredError: RecoveryRequiredError,
    SkillUpdateRecoveryStoreError: class extends Error {},
    reportRecoveryStore: () => {},
    skillStateChannel: {
      appendLine: (line) => calls.channel.push(line),
      show: () => calls.channelShown++,
    },
    updateInstructionFileForRoot: async () => {
      calls.output++;
    },
    outputWriteFeedback: { record() {} },
    uninstallSkillByPath: async () => {
      throw new Error("legacy delete-first reinstall must not run");
    },
  });
  await handler({ skill: { name: "demo", path: itemPath }, skillRoot });
  return calls;
}

async function main() {
  const ok = await run();
  assert.equal(ok.install.length, 1);
  assert.equal(ok.install[0].options.rebind, false);
  assert.equal(ok.install[0].meta.relativePath, "group/demo");
  assert.equal(ok.output, 1);
  assert.deepEqual(ok.infos, ["Reinstalled demo"]);
  assert.equal(ok.refresh, 1);

  const asked = await run({
    install: async (options) => {
      assert.equal(await options.confirmReplace(), true);
      return { status: "ok" };
    },
  });
  assert.equal(asked.warnings.length, 1);
  assert.ok(asked.warnings[0].message.includes("demo"));
  assert.equal(asked.warnings[0].options.modal, true);
  assert.deepEqual(asked.warnings[0].buttons, [asked.messages.actionReinstall()]);

  const japanese = await run({ language: "ja" });
  assert.deepEqual(japanese.infos, ["demo を再インストールしました"]);

  const declined = await run({
    confirm: false,
    install: async (options) => {
      if (!(await options.confirmReplace())) {
        throw Object.assign(new Error("cancelled"), { name: "AbortError" });
      }
      return { status: "ok" };
    },
  });
  assert.deepEqual([declined.errors, declined.infos], [[], []]);
  assert.equal(declined.output, 0);
  assert.equal(declined.refresh, 0);

  const conflict = await run({
    install: async () => {
      throw new ConflictError("private C:\\path ghp_secret");
    },
  });
  assert.equal(conflict.errors.length, 1);
  assert.equal(conflict.errors[0].message, conflict.messages.reinstallLocalConflict());
  assert.deepEqual(conflict.infos, []);
  assert.equal(conflict.output, 0);

  const failed = await run({
    install: async () => {
      throw new Error("private C:\\path ghp_secret");
    },
  });
  assert.equal(failed.errors[0].message, failed.messages.reinstallFailed("other"));
  assert.ok(!/private|ghp_|C:/.test(JSON.stringify(failed)));

  const recovery = await run({
    install: async () => {
      throw new RecoveryRequiredError("/skills/.skill-update-x/backup");
    },
  });
  assert.equal(
    recovery.errors[0].message,
    recovery.messages.reinstallRecoveryRequired(),
  );
  assert.deepEqual(recovery.errors[0].buttons, [
    recovery.messages.actionShowDetails(),
    recovery.messages.recoveryReviewAction(),
  ]);
  assert.ok(recovery.channel.some((line) => line.includes("/skills/.skill-update-x/backup")));
  assert.equal(recovery.refresh, 1);
  assert.deepEqual(recovery.infos, []);
  const recoveryDetails = await run({
    showDetails: true,
    install: async () => {
      throw new RecoveryRequiredError("/skills/.skill-update-x/backup");
    },
  });
  assert.equal(recoveryDetails.channelShown, 1);

  const legacy = await run({
    metas: [{ ...demoMeta, remotePath: undefined }],
  });
  assert.equal(legacy.install[0].options.rebind, true);

  const picked = await run({
    metas: [
      { ...demoMeta, relativePath: "other/demo" },
      { ...demoMeta, relativePath: "group/demo", installedAt: "target" },
    ],
  });
  assert.equal(picked.install[0].meta.installedAt, "target");

  const ambiguous = await run({
    itemPath: "missing/demo",
    metas: [
      { ...demoMeta, relativePath: "one/demo" },
      { ...demoMeta, relativePath: "two/demo" },
    ],
  });
  assert.equal(ambiguous.install.length, 0);
  assert.equal(ambiguous.errors.length, 1);

  const onlyByName = await run({
    itemPath: "moved/demo",
    metas: [{ ...demoMeta, relativePath: "group/demo" }],
  });
  assert.equal(onlyByName.install.length, 1);

  const skipped = await run({ autoUpdate: false });
  assert.equal(skipped.output, 0);

  // 全件・ルート・複数の再インストールは先にごみ箱へ移す方式のまま。復元できる前提を固定する
  const installerSource = fs.readFileSync(
    path.join(root, "src", "skillInstaller.ts"),
    "utf8",
  );
  const uninstall = /export async function uninstallSkillByPath[\s\S]*?\r?\n}\r?\n/.exec(
    installerSource,
  )?.[0];
  assert.ok(uninstall?.includes("{ useTrash: true }"));

  console.log(
    "PASS single reinstall stages the replacement, confirms overwrite, and keeps failures recoverable",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
