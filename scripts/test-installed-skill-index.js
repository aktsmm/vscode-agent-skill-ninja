/**
 * Installed skill/index matching regression tests.
 * Run: node scripts/test-installed-skill-index.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "src", "installedSkillIndex.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

function loadModule() {
  const moduleExports = {};
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    require,
  };
  vm.runInNewContext(transpiled.outputText, sandbox, {
    filename: sourcePath,
  });
  return sandbox.module.exports;
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

const {
  findIndexedSkillForInstalledMeta,
  isLocalInstalledSkillMeta,
  shouldAutoUpdateInstalledSkillFromIndex,
  shouldAutoUpdateManagedInstalledSkillFromIndex,
  shouldCheckManagedInstalledSkillAgainstIndex,
  shouldCheckInstalledSkillAgainstIndex,
  shouldWarnManagedInstalledSkillMissingFromIndex,
} = loadModule();

const skills = [
  {
    name: "remote-alpha",
    source: "sample-source",
    path: "skills/remote-alpha",
  },
  { name: "legacy-beta", source: "renamed-source", path: "legacy/legacy-beta" },
  { name: "duplicate", source: "first-source", path: "dupes/first" },
  { name: "duplicate", source: "second-source", path: "dupes/second" },
  {
    name: "excalidraw-diagram-generator",
    source: "resource-source",
    path: "skills/excalidraw-diagram-generator",
  },
];

test("local installed skills are excluded from remote index checks", () => {
  const localMeta = { name: "powerpoint-automation", source: "local" };

  assert.strictEqual(isLocalInstalledSkillMeta(localMeta), true);
  assert.strictEqual(shouldCheckInstalledSkillAgainstIndex(localMeta), false);
  assert.strictEqual(shouldAutoUpdateInstalledSkillFromIndex(localMeta), false);
  assert.strictEqual(
    findIndexedSkillForInstalledMeta(skills, localMeta),
    undefined,
  );
});

test("local source with remotePath is treated as remote-backed metadata", () => {
  const companionMeta = {
    name: "excalidraw",
    source: "local",
    remotePath: "skills/excalidraw-diagram-generator",
  };

  assert.strictEqual(isLocalInstalledSkillMeta(companionMeta), false);
  assert.strictEqual(
    shouldCheckInstalledSkillAgainstIndex(companionMeta),
    true,
  );
  assert.strictEqual(
    shouldAutoUpdateInstalledSkillFromIndex(companionMeta),
    true,
  );
  assert.deepStrictEqual(
    findIndexedSkillForInstalledMeta(skills, companionMeta),
    {
      name: "excalidraw-diagram-generator",
      source: "resource-source",
      path: "skills/excalidraw-diagram-generator",
    },
  );
});

test("empty source metadata is treated as local and not remote-missing", () => {
  const localMeta = { name: "receipt-ocr", source: "" };

  assert.strictEqual(isLocalInstalledSkillMeta(localMeta), true);
  assert.strictEqual(shouldCheckInstalledSkillAgainstIndex(localMeta), false);
  assert.strictEqual(shouldAutoUpdateInstalledSkillFromIndex(localMeta), false);
});

test("unknown legacy metadata keeps name-only fallback", () => {
  const unknownMeta = { name: "legacy-beta", source: "unknown" };

  assert.strictEqual(shouldCheckInstalledSkillAgainstIndex(unknownMeta), true);
  assert.strictEqual(
    shouldAutoUpdateInstalledSkillFromIndex(unknownMeta),
    false,
  );
  assert.deepStrictEqual(
    findIndexedSkillForInstalledMeta(skills, unknownMeta),
    {
      name: "legacy-beta",
      source: "renamed-source",
      path: "legacy/legacy-beta",
    },
  );
});

test("known remote metadata is eligible for upgrade auto-update", () => {
  assert.strictEqual(
    shouldAutoUpdateInstalledSkillFromIndex({
      name: "remote-alpha",
      source: "sample-source",
    }),
    true,
  );
});

test("read-only managed roots are excluded from remote index checks", () => {
  const readOnlyEntry = {
    root: { isReadOnly: true },
    meta: { name: "excalidraw", source: "companion-source" },
  };
  const writableEntry = {
    root: { isReadOnly: false },
    meta: { name: "remote-alpha", source: "sample-source" },
  };

  assert.strictEqual(
    shouldCheckManagedInstalledSkillAgainstIndex(readOnlyEntry),
    false,
  );
  assert.strictEqual(
    shouldCheckManagedInstalledSkillAgainstIndex(writableEntry),
    true,
  );
});

test("read-only managed roots are excluded from auto-update checks", () => {
  const readOnlyEntry = {
    root: { isReadOnly: true },
    meta: { name: "expense-report", source: "companion-source" },
  };
  const writableEntry = {
    root: { isReadOnly: false },
    meta: { name: "remote-alpha", source: "sample-source" },
  };

  assert.strictEqual(
    shouldAutoUpdateManagedInstalledSkillFromIndex(readOnlyEntry),
    false,
  );
  assert.strictEqual(
    shouldAutoUpdateManagedInstalledSkillFromIndex(writableEntry),
    true,
  );
});

test("unknown-source managed skills are excluded from startup missing-index warnings", () => {
  const unknownEntry = {
    root: { isReadOnly: false },
    meta: { name: "excalidraw", source: "unknown" },
  };
  const remoteEntry = {
    root: { isReadOnly: false },
    meta: { name: "remote-alpha", source: "sample-source" },
  };

  assert.strictEqual(
    shouldWarnManagedInstalledSkillMissingFromIndex(unknownEntry),
    false,
  );
  assert.strictEqual(
    shouldWarnManagedInstalledSkillMissingFromIndex(remoteEntry),
    true,
  );
});

test("remote metadata requires the matching source", () => {
  assert.deepStrictEqual(
    findIndexedSkillForInstalledMeta(skills, {
      name: "duplicate",
      source: "second-source",
    }),
    { name: "duplicate", source: "second-source", path: "dupes/second" },
  );

  assert.strictEqual(
    findIndexedSkillForInstalledMeta(skills, {
      name: "duplicate",
      source: "missing-source",
    }),
    undefined,
  );
});

test("remotePath fallback matches cross-extension metadata when source differs", () => {
  assert.deepStrictEqual(
    findIndexedSkillForInstalledMeta(skills, {
      name: "excalidraw",
      source: "companion-source",
      remotePath: "skills/excalidraw-diagram-generator",
    }),
    {
      name: "excalidraw-diagram-generator",
      source: "resource-source",
      path: "skills/excalidraw-diagram-generator",
    },
  );
});

console.log("\nInstalled skill/index tests passed.");
