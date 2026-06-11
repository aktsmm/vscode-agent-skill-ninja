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
  isReinstallDisabledInstalledSkillMeta,
  isUnknownLegacyInstalledSkillMeta,
  normalizeInstalledSkillSource,
  resolveSingleAffectedSourceId,
  summarizeBatchOutcome,
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

test("missing remote-backed source is normalized to unknown", () => {
  assert.strictEqual(
    normalizeInstalledSkillSource(undefined, "skills/remote-alpha"),
    "unknown",
  );
  assert.strictEqual(
    normalizeInstalledSkillSource(undefined, undefined),
    "local",
  );
  assert.strictEqual(
    normalizeInstalledSkillSource(" sample-source ", "skills/remote-alpha"),
    "sample-source",
  );
});

test("unknown legacy metadata without remotePath is excluded from batch checks but keeps name-only lookup", () => {
  const unknownMeta = { name: "legacy-beta", source: "unknown" };

  assert.strictEqual(isUnknownLegacyInstalledSkillMeta(unknownMeta), true);
  assert.strictEqual(shouldCheckInstalledSkillAgainstIndex(unknownMeta), false);
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

test("unknown metadata with remotePath is still remote-backed", () => {
  const unknownRemotePathMeta = {
    name: "excalidraw",
    source: "unknown",
    remotePath: "skills/excalidraw-diagram-generator",
  };

  assert.strictEqual(
    isUnknownLegacyInstalledSkillMeta(unknownRemotePathMeta),
    false,
  );
  assert.strictEqual(
    shouldCheckInstalledSkillAgainstIndex(unknownRemotePathMeta),
    true,
  );
  assert.deepStrictEqual(
    findIndexedSkillForInstalledMeta(skills, unknownRemotePathMeta),
    {
      name: "excalidraw-diagram-generator",
      source: "resource-source",
      path: "skills/excalidraw-diagram-generator",
    },
  );
});

test("reinstall disabled metadata is excluded from checks and lookup", () => {
  const disabledMeta = {
    name: "remote-alpha",
    source: "sample-source",
    remotePath: "skills/remote-alpha",
    reinstallDisabled: true,
  };

  assert.strictEqual(isReinstallDisabledInstalledSkillMeta(disabledMeta), true);
  assert.strictEqual(
    shouldCheckInstalledSkillAgainstIndex(disabledMeta),
    false,
  );
  assert.strictEqual(
    shouldAutoUpdateInstalledSkillFromIndex(disabledMeta),
    false,
  );
  assert.strictEqual(
    findIndexedSkillForInstalledMeta(skills, disabledMeta),
    undefined,
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

test("resolveSingleAffectedSourceId returns one valid shared source only", () => {
  assert.strictEqual(
    resolveSingleAffectedSourceId(
      [
        { source: "sample-source", remotePath: "skills/remote-alpha" },
        { source: "sample-source", remotePath: "skills/remote-beta" },
      ],
      [{ id: "sample-source" }, { id: "other-source" }],
    ),
    "sample-source",
  );

  assert.strictEqual(
    resolveSingleAffectedSourceId(
      [
        { source: "sample-source", remotePath: "skills/remote-alpha" },
        { source: "other-source", remotePath: "skills/remote-beta" },
      ],
      [{ id: "sample-source" }, { id: "other-source" }],
    ),
    undefined,
  );

  assert.strictEqual(
    resolveSingleAffectedSourceId(
      [{ source: "unknown", remotePath: "skills/remote-alpha" }],
      [{ id: "sample-source" }],
    ),
    undefined,
  );
});

test("summarizeBatchOutcome distinguishes full, partial, and failed batches", () => {
  const success = summarizeBatchOutcome(4, 0);
  assert.strictEqual(success.totalCount, 4);
  assert.strictEqual(success.failedCount, 0);
  assert.strictEqual(success.succeededCount, 4);
  assert.strictEqual(success.isPartialFailure, false);
  assert.strictEqual(success.isTotalFailure, false);

  const partial = summarizeBatchOutcome(4, 1);
  assert.strictEqual(partial.totalCount, 4);
  assert.strictEqual(partial.failedCount, 1);
  assert.strictEqual(partial.succeededCount, 3);
  assert.strictEqual(partial.isPartialFailure, true);
  assert.strictEqual(partial.isTotalFailure, false);

  const failed = summarizeBatchOutcome(4, 4);
  assert.strictEqual(failed.totalCount, 4);
  assert.strictEqual(failed.failedCount, 4);
  assert.strictEqual(failed.succeededCount, 0);
  assert.strictEqual(failed.isPartialFailure, false);
  assert.strictEqual(failed.isTotalFailure, true);
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
