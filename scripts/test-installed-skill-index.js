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
  shouldCheckInstalledSkillAgainstIndex,
} = loadModule();

const skills = [
  { name: "remote-alpha", source: "sample-source" },
  { name: "legacy-beta", source: "renamed-source" },
  { name: "duplicate", source: "first-source" },
  { name: "duplicate", source: "second-source" },
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
    { name: "legacy-beta", source: "renamed-source" },
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

test("remote metadata requires the matching source", () => {
  assert.deepStrictEqual(
    findIndexedSkillForInstalledMeta(skills, {
      name: "duplicate",
      source: "second-source",
    }),
    { name: "duplicate", source: "second-source" },
  );

  assert.strictEqual(
    findIndexedSkillForInstalledMeta(skills, {
      name: "duplicate",
      source: "missing-source",
    }),
    undefined,
  );
});

console.log("\nInstalled skill/index tests passed.");
