#!/usr/bin/env node
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { loadSrcModule } = require("./load-src-module");

const recovery = loadSrcModule("skillUpdateRecovery");
const commandsSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "skillUpdateRecoveryCommands.ts"),
  "utf8",
);
const commandsJs = ts.transpileModule(commandsSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ninja-recovery-test-"));
  const root = path.join(temporary, "skills");
  const target = path.join(root, "group", "demo");
  const transaction = () => path.join(root, `.skill-update-${crypto.randomUUID()}`);
  const context = {
    globalStorageUri: { scheme: "file", fsPath: path.join(temporary, "storage") },
  };
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "SKILL.md"), "original skill");
  return {
    temporary,
    root,
    target,
    transaction,
    context,
    begin: (tx = transaction()) =>
      recovery.beginSkillUpdateRecovery(context, root, target, tx, [root]),
    dispose: () => fs.rmSync(temporary, { recursive: true, force: true }),
  };
}

async function test(name, callback) {
  const env = fixture();
  try {
    await callback(env);
    console.log(`PASS ${name}`);
  } finally {
    env.dispose();
  }
}

function commandHarness(context) {
  const state = new Map();
  const notices = [];
  const lines = [];
  const executions = [];
  const settings = { confirm: false, openRecords: false };
  let handler;
  const messages = new Proxy({}, {
    get: (_, key) => (...args) => `${key}${args.length ? `:${args.join(",")}` : ""}`,
  });
  context.globalState = {
    get: (key) => state.get(key),
    update: async (key, value) => {
      if (value === undefined) state.delete(key);
      else state.set(key, value);
    },
  };
  const vscode = {
    Uri: { file: (fsPath) => ({ fsPath }) },
    commands: {
      registerCommand: (_, callback) => {
        handler = callback;
        return { dispose() {} };
      },
      executeCommand: async (...args) => executions.push(args),
    },
    window: {
      showQuickPick: async (items) => items[0],
      showErrorMessage: async (message, ...actions) => {
        notices.push({ kind: "error", message, actions });
        return settings.openRecords ? actions[0] : undefined;
      },
      showInformationMessage: async (message) => {
        notices.push({ kind: "info", message });
      },
      showWarningMessage: async (message, ...actions) => {
        notices.push({ kind: "warning", message, actions });
        return settings.confirm && actions[0]?.modal ? actions[1] : undefined;
      },
    },
  };
  const channel = {
    appendLine: (line) => lines.push(line),
    show: () => {},
  };
  const module = { exports: {} };
  vm.runInNewContext(commandsJs, {
    module,
    exports: module.exports,
    require: (request) => {
      if (request === "vscode") return vscode;
      if (request === "./i18n") return { messages };
      if (request === "./skillUpdateRecovery") return recovery;
      return require(request);
    },
    console,
  });
  module.exports.registerSkillRecoveryCommand(context, channel);
  return {
    review: () => handler(),
    notify: (active = true) =>
      module.exports.notifyInterruptedSkillUpdates(context, () => active),
    state,
    notices,
    lines,
    executions,
    settings,
  };
}

async function main() {
  await test("records block overlapping paths and retire after a completed swap", async (env) => {
    const record = await env.begin();
    assert.equal((await recovery.listSkillUpdateRecoveries(env.context)).length, 1);
    for (const candidate of [
      env.target,
      path.dirname(env.target),
      path.join(env.target, "child"),
    ]) {
      await assert.rejects(
        recovery.assertNoSkillUpdateRecovery(env.context, candidate),
        recovery.SkillUpdateRecoveryRequiredError,
      );
    }
    await recovery.assertNoSkillUpdateRecovery(env.context, path.join(env.root, "other"));
    await recovery.finishSkillUpdateRecovery(env.context, record);
    assert.deepEqual(await recovery.listSkillUpdateRecoveries(env.context), []);
  });

  await test("VS Code userdata storage supports recovery records", async (env) => {
    env.context.globalStorageUri.scheme = "vscode-userdata";
    const record = await env.begin();
    assert.equal((await recovery.listSkillUpdateRecoveries(env.context)).length, 1);
    await recovery.finishSkillUpdateRecovery(env.context, record);
    assert.deepEqual(await recovery.listSkillUpdateRecoveries(env.context), []);
  });

  await test("a partially prepared record never blocks readers or replaces a concurrent record", async (env) => {
    const originalOpen = fs.promises.open;
    let release;
    let entered;
    const waiting = new Promise((resolve) => { entered = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    let held = false;
    fs.promises.open = async (file, ...args) => {
      if (!held && String(file).includes(`${path.sep}.preparing-`)) {
        held = true;
        entered();
        await gate;
      }
      return originalOpen.call(fs.promises, file, ...args);
    };
    let first;
    try {
      first = env.begin();
      await waiting;
      assert.deepEqual(await recovery.listSkillUpdateRecoveries(env.context), []);
      const second = await env.begin();
      release();
      await assert.rejects(first, recovery.SkillUpdateRecoveryRequiredError);
      assert.equal((await recovery.listSkillUpdateRecoveries(env.context))[0].id, second.id);
      await recovery.finishSkillUpdateRecovery(env.context, second);
    } finally {
      release();
      if (first) await first.catch(() => {});
      fs.promises.open = originalOpen;
    }
  });

  await test("simultaneous records for one target have a single winner", async (env) => {
    const results = await Promise.allSettled([env.begin(), env.begin()]);
    const winners = results.filter((result) => result.status === "fulfilled");
    const failures = results.filter((result) => result.status === "rejected");
    assert.equal(winners.length, 1);
    assert.equal(failures.length, 1);
    assert.ok(failures[0].reason instanceof recovery.SkillUpdateRecoveryRequiredError);
    assert.equal((await recovery.listSkillUpdateRecoveries(env.context)).length, 1);
    await recovery.finishSkillUpdateRecovery(env.context, winners[0].value);
  });

  await test("storage inside any scan root stops before creating a record", async (env) => {
    const otherRoot = path.join(env.temporary, "other-root");
    fs.mkdirSync(otherRoot);
    env.context.globalStorageUri.fsPath = path.join(otherRoot, ".storage");
    await assert.rejects(recovery.beginSkillUpdateRecovery(
      env.context, env.root, env.target, env.transaction(), [env.root, otherRoot],
    ), (error) =>
      error instanceof recovery.SkillUpdateRecoveryStoreError &&
      error.reason === "inside-root",
    );
    assert.equal(fs.existsSync(env.context.globalStorageUri.fsPath), false);
    assert.equal(fs.readFileSync(path.join(env.target, "SKILL.md"), "utf8"), "original skill");
  });

  await test("storage reached through a root alias is also rejected", async (env) => {
    const alias = path.join(env.temporary, "root-alias");
    fs.symlinkSync(env.root, alias, "junction");
    env.context.globalStorageUri.fsPath = path.join(alias, ".storage");
    await assert.rejects(env.begin(), (error) =>
      error instanceof recovery.SkillUpdateRecoveryStoreError &&
      error.reason === "inside-root",
    );
    assert.equal(fs.existsSync(env.context.globalStorageUri.fsPath), false);
  });

  await test("a non-file storage URI fails closed", async (env) => {
    env.context.globalStorageUri.scheme = "custom";
    await assert.rejects(env.begin(), recovery.SkillUpdateRecoveryStoreError);
    await assert.rejects(
      recovery.assertNoSkillUpdateRecovery(env.context, env.target),
      recovery.SkillUpdateRecoveryStoreError,
    );
  });

  await test("unreadable, malformed and oversized records fail closed", async (env) => {
    const directory = recovery.getSkillRecoveryDirectory(env.context);
    const recordDirectory = path.join(directory, "a".repeat(64));
    fs.mkdirSync(recordDirectory, { recursive: true });
    for (const value of [undefined, "{invalid", "x".repeat(17000)]) {
      const recordFile = path.join(recordDirectory, "record.json");
      if (value === undefined) {
        if (fs.existsSync(recordFile)) fs.unlinkSync(recordFile);
      } else {
        fs.writeFileSync(recordFile, value);
      }
      await assert.rejects(
        recovery.assertNoSkillUpdateRecovery(env.context, path.join(env.root, "other")),
        recovery.SkillUpdateRecoveryStoreError,
      );
    }
    assert.equal(fs.readFileSync(path.join(env.target, "SKILL.md"), "utf8"), "original skill");
  });

  await test("a failed record retirement retains the record and target", async (env) => {
    const record = await env.begin();
    const originalRename = fs.promises.rename;
    fs.promises.rename = async (from, to) => {
      if (String(to).includes(`${path.sep}.finished-`)) throw new Error("blocked");
      return originalRename.call(fs.promises, from, to);
    };
    try {
      await assert.rejects(
        recovery.finishSkillUpdateRecovery(env.context, record),
        recovery.SkillUpdateRecoveryStoreError,
      );
      assert.equal((await recovery.listSkillUpdateRecoveries(env.context))[0].id, record.id);
      assert.equal(fs.readFileSync(path.join(env.target, "SKILL.md"), "utf8"), "original skill");
    } finally {
      fs.promises.rename = originalRename;
      recovery.releaseSkillUpdateRecovery(record);
    }
  });

  await test("review refuses active or missing targets and clears only an explicitly confirmed record", async (env) => {
    const transaction = env.transaction();
    fs.mkdirSync(transaction);
    const record = await env.begin(transaction);
    const ui = commandHarness(env.context);
    await ui.review();
    assert.equal(ui.notices.at(-1).message, "recoveryInUse");
    assert.equal(ui.notices.some((notice) => notice.message === "recoveryConfirm"), false);
    recovery.releaseSkillUpdateRecovery(record);
    fs.renameSync(env.target, record.backupPath);
    await ui.review();
    assert.equal(ui.notices.at(-1).message, "recoveryMissingTarget");
    assert.equal(fs.existsSync(record.backupPath), true);
    fs.renameSync(record.backupPath, env.target);
    fs.cpSync(env.target, record.backupPath, { recursive: true });
    await ui.review();
    assert.equal((await recovery.listSkillUpdateRecoveries(env.context)).length, 1);
    ui.settings.confirm = true;
    await ui.review();
    assert.deepEqual(await recovery.listSkillUpdateRecoveries(env.context), []);
    assert.equal(fs.readFileSync(path.join(env.target, "SKILL.md"), "utf8"), "original skill");
    assert.equal(fs.readFileSync(path.join(record.backupPath, "SKILL.md"), "utf8"), "original skill");
    assert.equal(ui.notices.at(-1).message, "recoveryResolved");
    assert.ok(ui.lines.some((line) => line.includes(env.target)));
    assert.ok(ui.lines.some((line) => line.includes(record.backupPath)));
  });

  await test("unreadable recovery opens its local record directory", async (env) => {
    const directory = recovery.getSkillRecoveryDirectory(env.context);
    fs.mkdirSync(path.join(directory, "invalid"), { recursive: true });
    const ui = commandHarness(env.context);
    ui.settings.openRecords = true;
    await ui.review();
    assert.equal(ui.notices.at(-1).message, "recoveryStoreUnavailable");
    assert.equal(ui.executions[0][0], "revealFileInOS");
    assert.equal(ui.executions[0][1].fsPath, directory);
  });

  await test("startup notifications are deduplicated and reappear for new corruption", async (env) => {
    const ui = commandHarness(env.context);
    const record = await env.begin();
    await ui.notify();
    assert.equal(ui.notices.length, 0);
    recovery.releaseSkillUpdateRecovery(record);
    await ui.notify(false);
    assert.equal(ui.notices.length, 0);
    await ui.notify();
    await ui.notify();
    assert.equal(ui.notices.filter((notice) => notice.message === "recoveryStartup:1").length, 1);
    await recovery.finishSkillUpdateRecovery(env.context, record);
    await ui.notify();
    const invalid = path.join(recovery.getSkillRecoveryDirectory(env.context), "invalid");
    fs.mkdirSync(invalid);
    await ui.notify();
    await ui.notify();
    assert.equal(ui.notices.filter((notice) => notice.message === "recoveryStoreUnavailable").length, 1);
    fs.rmdirSync(invalid);
    await ui.notify();
    fs.mkdirSync(invalid);
    await ui.notify();
    assert.equal(ui.notices.filter((notice) => notice.message === "recoveryStoreUnavailable").length, 2);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
