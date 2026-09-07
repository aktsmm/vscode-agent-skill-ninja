const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { loadSrcModule } = require("./load-src-module");
const { createOutputWriteFeedback, summarizeOutputWrites } = loadSrcModule(
  "./outputWriteFeedback",
);
const filename = path.join(__dirname, "../src/extension.ts");
const source = ts.createSourceFile(
  filename,
  fs.readFileSync(filename, "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const matches = [];
const schedulers = [];
function visit(node) {
  if (
    ts.isFunctionDeclaration(node) &&
    node.name?.text === "scheduleOutputReconcile"
  ) {
    schedulers.push(node.getText(source));
  }
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(source) === "vscode.commands.registerCommand" &&
    ts.isStringLiteral(node.arguments[0]) &&
    node.arguments[0].text === "skillNinja.updateInstruction"
  ) {
    matches.push(node.getText(source));
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(matches.length, 1);
const executable = ts.transpileModule(matches[0], {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;

async function scenario({
  result = "updated",
  language = "en",
  item = { skillRoot: {} },
  root = { isManaged: true },
  workspace = true,
  throws = false,
} = {}) {
  const information = [];
  const warnings = [];
  const errors = [];
  let rootWrites = 0;
  let allWrites = 0;
  let handler;
  const feedback = createOutputWriteFeedback({
    log() {},
    detailsAction: () => "Details",
    warn: (action) => {
      warnings.push(action);
      return new Promise(() => {});
    },
    showDetails() {},
  });
  const write = async () => {
    if (throws) {
      throw new Error("private error text must never reach a message");
    }
    feedback.record("fixture", result);
    return result;
  };
  vm.runInNewContext(executable, {
    vscode: {
      commands: {
        registerCommand: (_, callback) => {
          handler = callback;
        },
      },
      window: {
        showInformationMessage: (message) => information.push(message),
        showWarningMessage: (message) => warnings.push(message),
        showErrorMessage: (message) => errors.push(message),
      },
    },
    workspaceFolder: workspace ? { uri: "workspace" } : undefined,
    context: {},
    outputWriteFeedback: feedback,
    isJapanese: () => language === "ja",
    messages: { noWorkspace: () => "no workspace" },
    resolveCurrentSkillRoot: () => root,
    getCurrentUpdateRoots: async () => [],
    updateInstructionFileForRoot: async () => {
      rootWrites++;
      return write();
    },
    updateAllInstructionFiles: async () => {
      allWrites++;
      return [await write()];
    },
    summarizeOutputWrites,
  });
  const summary = await handler(item);
  return { information, warnings, errors, rootWrites, allWrites, summary };
}

async function main() {
  assert.equal(schedulers.length, 1);
  let failReconcile = true;
  let notices = 0;
  const feedback = createOutputWriteFeedback({
    log() {},
    detailsAction: () => "Details",
    warn: () => {
      notices++;
      return Promise.resolve(undefined);
    },
    showDetails() {},
  });
  const schedulerCode = ts.transpileModule(
    `let outputReconcileInFlight; let outputReconcileQueued = false; ${schedulers[0]} globalThis.run = scheduleOutputReconcile;`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText;
  const scope = {
    outputWriteFeedback: feedback,
    isContextActive: () => true,
    console: { error() {} },
    reconcileOutputTargets: async () => {
      if (failReconcile) {
        throw new Error("fixture failure");
      }
    },
  };
  vm.runInNewContext(schedulerCode, scope);
  await scope.run();
  await scope.run();
  assert.equal(notices, 1);
  failReconcile = false;
  await scope.run();
  failReconcile = true;
  await scope.run();
  assert.equal(notices, 2);
  for (const language of ["en", "ja"]) {
    for (const result of ["unreadable", "locked", "failed"]) {
      const actual = await scenario({ result, language });
      assert.equal(actual.information.length, 0);
      assert.equal(actual.summary.blocked, 1);
      assert.deepEqual(actual.warnings, ["Details"]);
    }
    for (const result of ["updated", "unchanged", "disabled", "deferred"]) {
      const actual = await scenario({ result, language });
      assert.equal(actual.warnings.length, 0);
      assert.equal(actual.information.length, 1);
      const phrases =
        language === "ja"
          ? {
              updated: "更新 1",
              unchanged: "変更なし 1",
              disabled: "有効なスキル出力先がありません",
              deferred: "別の拡張",
            }
          : {
              updated: "updated 1",
              unchanged: "unchanged 1",
              disabled: "No enabled",
              deferred: "another extension",
            };
      assert.ok(actual.information[0].includes(phrases[result]));
    }
  }
  for (const root of [
    null,
    { isManaged: true, isReadOnly: true },
    { isManaged: false },
  ]) {
    const actual = await scenario({ root });
    assert.equal(actual.rootWrites + actual.allWrites, 0);
    assert.equal(actual.warnings.length, 1);
  }
  assert.equal((await scenario({ workspace: false })).rootWrites, 1);
  const thrown = await scenario({ throws: true });
  assert.equal(thrown.information.length, 0);
  assert.deepEqual(thrown.warnings, ["Details"]);
  assert.equal(thrown.errors.length, 0);
  console.log(
    "PASS actual output command distinguishes results in en/ja, never falls back from invalid roots and never claims failed writes succeeded",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
