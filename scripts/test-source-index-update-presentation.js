#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const sourcePath = path.join(
  __dirname,
  "..",
  "src",
  "sourceIndexUpdatePresentation.ts",
);
const source = fs.readFileSync(sourcePath, "utf8");
const extensionSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "extension.ts"),
  "utf8",
);
const indexUpdaterSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "indexUpdater.ts"),
  "utf8",
);
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
  Intl,
  Date,
};

vm.runInNewContext(transpiled.outputText, sandbox, {
  filename: sourcePath,
});

const {
  formatSourceIndexResetAt,
  getSourceIndexUpdateNotificationKind,
  scaleSourceIndexProgressIncrement,
} = sandbox.exports;

function loadI18n(language) {
  const filePath = path.join(__dirname, "..", "src", "i18n.ts");
  const moduleSource = fs.readFileSync(filePath, "utf8");
  const moduleTranspiled = ts.transpileModule(moduleSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  });
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") {
      return {
        env: { language },
        workspace: {
          getConfiguration() {
            return { get(key, fallback) { return fallback; } };
          },
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const loadedModule = new Module(filePath, module);
    loadedModule.filename = filePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(filePath));
    loadedModule._compile(moduleTranspiled.outputText, filePath);
    return loadedModule.exports;
  } finally {
    Module._load = originalLoad;
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("uses one success notification only when every update succeeds", () => {
  assert.strictEqual(getSourceIndexUpdateNotificationKind(0), "success");
  assert.strictEqual(getSourceIndexUpdateNotificationKind(1), "warning");
});

test("scales per-source progress across the complete batch", () => {
  assert.strictEqual(scaleSourceIndexProgressIncrement(5, 50), 10);
  assert.strictEqual(scaleSourceIndexProgressIncrement(5, 100), 20);
  assert.strictEqual(scaleSourceIndexProgressIncrement(0, 50), 50);
  assert.strictEqual(scaleSourceIndexProgressIncrement(5, undefined), undefined);
});

test("formats GitHub reset timestamps for the active locale", () => {
  const resetAt = "2026-07-29T12:30:00.000Z";
  assert.strictEqual(
    formatSourceIndexResetAt(resetAt, "en-US"),
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(resetAt)),
  );
  assert.strictEqual(formatSourceIndexResetAt("invalid", "en-US"), "invalid");
});

test("source update user-facing text is localized", () => {
  assert.ok(!indexUpdaterSource.includes("message: `Updating ${source.name}...`"));
  assert.ok(
    !extensionSource.includes(
      "`Updated ${item.source?.name || sourceId}: ${oldCount}",
    ),
  );
  assert.ok(extensionSource.includes("messages.sourceIndexUpdated("));
});

test("renders complete source update notifications in Japanese and English", () => {
  const ja = loadI18n("ja").messages;
  const en = loadI18n("en").messages;

  assert.strictEqual(
    ja.staleSourceIndexPartialFailed(2, 1, 5, "Anthropic", "rate", 2),
    "source index の更新結果: 更新 2/5、失敗 1、未試行 2。失敗: Anthropic。理由: rate",
  );
  assert.strictEqual(
    en.staleSourceIndexPartialFailed(2, 1, 5, "Anthropic", "rate", 2),
    "Source index update result: 2/5 updated, 1 failed, 2 not attempted. Failed: Anthropic. Reason: rate",
  );
  assert.strictEqual(
    ja.sourceIndexUpdated("Anthropic", 10, 12, "+2"),
    "✅ Anthropic を更新しました: 10 → 12 スキル (+2)",
  );
  assert.strictEqual(
    en.sourceIndexUpdated("Anthropic", 10, 12, "+2"),
    "✅ Updated Anthropic: 10 → 12 skill(s) (+2)",
  );
});

console.log("\nSource index update presentation tests passed.");