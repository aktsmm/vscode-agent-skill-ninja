/**
 * Output target resolution regression tests.
 * Run after compile: node scripts/test-output-targets.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

// deriveTargetId は os.homedir() を基準に標準ターゲットを判定するので、
// テストでも実際の home を使う（ファイルへは一切書き込まない）。
const HOME = os.homedir();

function makeUri(filePath) {
  const fsPath = path.resolve(filePath);
  return { fsPath, path: fsPath.replace(/\\/g, "/") };
}

const vscodeStub = {
  Uri: {
    file: makeUri,
    joinPath(base, ...parts) {
      return makeUri(path.join(base.fsPath, ...parts));
    },
  },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration() {
      return { get: () => undefined, inspect: () => undefined };
    },
    fs: {
      async readFile(uri) {
        return fs.readFileSync(uri.fsPath);
      },
      async writeFile(uri, data) {
        fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
        fs.writeFileSync(uri.fsPath, data);
      },
      async delete(uri) {
        fs.rmSync(uri.fsPath, { force: true });
      },
      async stat(uri) {
        return fs.statSync(uri.fsPath);
      },
      async createDirectory(uri) {
        fs.mkdirSync(uri.fsPath, { recursive: true });
      },
    },
  },
};

function normalizeFileSystemPath(filePath) {
  const normalized = path.normalize(filePath).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

const skillLocationsStub = {
  normalizeFileSystemPath,
  resolveConfiguredPathToUri(configuredPath, baseUri) {
    if (!configuredPath) {
      return undefined;
    }
    if (configuredPath === "~") {
      return makeUri(HOME);
    }
    if (configuredPath.startsWith("~/")) {
      return makeUri(path.join(HOME, configuredPath.slice(2)));
    }
    if (path.isAbsolute(configuredPath)) {
      return makeUri(configuredPath);
    }
    return baseUri
      ? makeUri(path.resolve(baseUri.fsPath, configuredPath))
      : undefined;
  },
};

const toolDetectorStub = {
  normalizeOutputFormat(value) {
    return ["full", "compact", "legacy", "ref"].includes(value) ? value : "ref";
  },
  resolveOutputFormat: async () => ({
    format: toolDetectorStub.__format || "ref",
    instructionFile: "AGENTS.md",
  }),
};

function loadTranspiledModule(sourcePath, extraModules = {}) {
  const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });

  const moduleExports = {};
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    process,
    Buffer,
    console,
    require(request) {
      if (request === "vscode") {
        return vscodeStub;
      }
      if (request in extraModules) {
        return extraModules[request];
      }
      return require(request);
    },
  };

  vm.runInNewContext(transpiled.outputText, sandbox, { filename: sourcePath });
  return sandbox.module.exports;
}

const srcPath = (name) => path.join(__dirname, "..", "src", `${name}.ts`);

const outputTargets = loadTranspiledModule(srcPath("outputTargets"), {
  "./skillLocations": skillLocationsStub,
  "./toolDetector": toolDetectorStub,
});

const instructionManager = loadTranspiledModule(srcPath("instructionManager"), {
  "./skillLocations": skillLocationsStub,
  "./toolDetector": toolDetectorStub,
  "./outputTargets": outputTargets,
  "./skillInstaller": { getInstalledSkillsWithMeta: async () => [] },
  "./coexistence": {
    getCoexistenceMode: () => "auto",
    getEffectiveOwnership: async () => ({ owner: "self", reason: "test" }),
  },
  "./shared-store-lock": {
    withSharedStoreLock: async (_id, task) =>
      task({ assertHeld() {}, assertStillOwned: async () => {} }),
    describeSharedStoreLockFailure: () => undefined,
  },
  "./constants": {
    SELF_EXTENSION_ID: "yamapan.agent-skill-ninja",
    SKILL_DESCRIPTION_LIMITS: { MAX_TOTAL: 200, MAX_EACH: 150 },
  },
});

const {
  buildOutputInventory,
  canonicalizeOutputPath,
  deriveTargetId,
  findDeepestContainingFolder,
  getOutputTargetsMode,
  parseOutputPathBuckets,
  parseOutputTargets,
  planOutputCleanup,
  resolveOutputGroups,
} = outputTargets;

function makeConfig({ values = {}, outputTargetsValue } = {}) {
  return {
    get: (key) =>
      key === "outputTargets" ? outputTargetsValue : values[key],
    inspect: (key) =>
      key === "outputTargets"
        ? { key, globalValue: outputTargetsValue }
        : undefined,
  };
}

function makeRoot({ scope, rootPath, instructionPath, label = "Root" }) {
  return {
    scope,
    label,
    rootUri: makeUri(rootPath),
    rootPath: path.resolve(rootPath),
    displayPath: rootPath,
    isManaged: true,
    isReadOnly: false,
    instructionUri: makeUri(instructionPath),
    instructionPath: path.resolve(instructionPath),
    linkPathFromInstruction: "skills",
  };
}

const workspaceA = path.resolve("/repos/alpha");
const workspaceB = path.resolve("/repos/beta");

const workspaceRootA = makeRoot({
  scope: "workspace",
  rootPath: path.join(workspaceA, ".github/skills"),
  instructionPath: path.join(workspaceA, "AGENTS.md"),
});
const workspaceRootB = makeRoot({
  scope: "workspace",
  rootPath: path.join(workspaceB, ".github/skills"),
  instructionPath: path.join(workspaceB, "AGENTS.md"),
});
const copilotRoot = makeRoot({
  scope: "userGlobal",
  rootPath: path.join(HOME, ".copilot/skills"),
  instructionPath: path.join(HOME, ".copilot/copilot-instructions.md"),
});
const claudeRoot = makeRoot({
  scope: "userGlobal",
  rootPath: path.join(HOME, ".claude/skills"),
  instructionPath: path.join(HOME, ".claude/CLAUDE.md"),
});
const agentsRoot = makeRoot({
  scope: "userGlobal",
  rootPath: path.join(HOME, ".agents/skills"),
  instructionPath: path.join(HOME, ".agents/AGENTS.md"),
});

const allRoots = [
  workspaceRootA,
  workspaceRootB,
  copilotRoot,
  claudeRoot,
  agentsRoot,
];

let failures = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  not ok - ${name}`);
    console.error(`    ${error && error.message}`);
  }
}

function findGroup(groups, instructionPath) {
  const normalized = normalizeFileSystemPath(path.resolve(instructionPath));
  return groups.find(
    (group) => normalizeFileSystemPath(group.instructionPath) === normalized,
  );
}

async function main() {
  console.log("Output target tests");

  await test("derives stable target ids from root locations", () => {
    assert.strictEqual(deriveTargetId(workspaceRootA, HOME), "workspace");
    assert.strictEqual(deriveTargetId(copilotRoot, HOME), "copilot");
    assert.strictEqual(deriveTargetId(claudeRoot, HOME), "claude");
    assert.strictEqual(deriveTargetId(agentsRoot, HOME), "agents");

    const nestedCopilot = makeRoot({
      scope: "userGlobal",
      rootPath: path.resolve("/opt/vendor/.copilot/skills"),
      instructionPath: path.resolve("/opt/vendor/.copilot/copilot-instructions.md"),
    });
    // home 直下でない `.copilot` は標準ターゲット扱いしない
    assert.ok(deriveTargetId(nestedCopilot, HOME).startsWith("custom:"));
  });

  await test("treats unset outputTargets as legacy mode", () => {
    assert.strictEqual(getOutputTargetsMode(makeConfig()), "legacy");
    assert.strictEqual(
      getOutputTargetsMode(makeConfig({ outputTargetsValue: [] })),
      "array",
    );
    assert.strictEqual(
      getOutputTargetsMode(
        makeConfig({ outputTargetsValue: [{ id: "workspace" }] }),
      ),
      "array",
    );
  });

  await test("legacy mode enables every managed root", async () => {
    toolDetectorStub.__format = "ref";
    const groups = await resolveOutputGroups(allRoots, {
      config: makeConfig({
        values: { refCatalogPath: ".github/skills/README.md" },
      }),
      workspaceFolderUris: [makeUri(workspaceA), makeUri(workspaceB)],
    });

    assert.strictEqual(groups.length, 5);
    for (const group of groups) {
      assert.strictEqual(group.format, "ref");
      assert.strictEqual(group.formatIsExplicit, false);
    }
  });

  await test("empty outputTargets disables every output", async () => {
    const groups = await resolveOutputGroups(allRoots, {
      config: makeConfig({ outputTargetsValue: [] }),
      workspaceFolderUris: [makeUri(workspaceA), makeUri(workspaceB)],
    });
    assert.strictEqual(groups.length, 0);
  });

  await test("array mode writes only the listed targets", async () => {
    const groups = await resolveOutputGroups(allRoots, {
      config: makeConfig({
        outputTargetsValue: [
          { id: "workspace" },
          { id: "claude", enabled: false },
          { id: "agents" },
        ],
      }),
      workspaceFolderUris: [makeUri(workspaceA), makeUri(workspaceB)],
    });

    const targetIds = groups.flatMap((group) => Array.from(group.targetIds));
    assert.ok(targetIds.includes("workspace"));
    assert.ok(targetIds.includes("agents"));
    assert.ok(!targetIds.includes("claude"));
    assert.ok(!targetIds.includes("copilot"));
  });

  await test("per-target format overrides the global default", async () => {
    toolDetectorStub.__format = "ref";
    const groups = await resolveOutputGroups(allRoots, {
      config: makeConfig({
        outputTargetsValue: [
          { id: "workspace" },
          { id: "agents", format: "compact" },
        ],
      }),
      workspaceFolderUris: [makeUri(workspaceA), makeUri(workspaceB)],
    });

    const agentsGroup = findGroup(
      groups,
      path.join(HOME, ".agents/AGENTS.md"),
    );
    const workspaceGroup = findGroup(groups, path.join(workspaceA, "AGENTS.md"));

    assert.strictEqual(agentsGroup.format, "compact");
    assert.strictEqual(agentsGroup.formatIsExplicit, true);
    assert.strictEqual(workspaceGroup.format, "ref");
    assert.strictEqual(workspaceGroup.formatIsExplicit, false);
  });

  await test("per-target catalog path overrides the global default", async () => {
    const groups = await resolveOutputGroups([copilotRoot], {
      config: makeConfig({
        values: { refCatalogPath: ".github/skills/README.md" },
        outputTargetsValue: [{ id: "copilot", catalogPath: "skills/README.md" }],
      }),
      workspaceFolderUris: [],
    });

    assert.strictEqual(groups.length, 1);
    assert.strictEqual(
      normalizeFileSystemPath(groups[0].catalogUri.fsPath),
      normalizeFileSystemPath(path.join(HOME, ".copilot/skills/README.md")),
    );
  });

  await test("multi-root folders stay in separate groups", async () => {
    const groups = await resolveOutputGroups(
      [workspaceRootA, workspaceRootB],
      {
        config: makeConfig(),
        workspaceFolderUris: [makeUri(workspaceA), makeUri(workspaceB)],
      },
    );

    assert.strictEqual(groups.length, 2);
    const groupA = findGroup(groups, path.join(workspaceA, "AGENTS.md"));
    const groupB = findGroup(groups, path.join(workspaceB, "AGENTS.md"));
    assert.strictEqual(
      normalizeFileSystemPath(groupA.workspaceFolderUri.fsPath),
      normalizeFileSystemPath(workspaceA),
    );
    assert.strictEqual(
      normalizeFileSystemPath(groupB.workspaceFolderUri.fsPath),
      normalizeFileSystemPath(workspaceB),
    );
    assert.strictEqual(groupA.members.length, 1);
    assert.strictEqual(groupB.members.length, 1);
  });

  await test("targets sharing one instruction file merge into one group", async () => {
    const sharedInstruction = path.join(HOME, ".agents/AGENTS.md");
    const extraRoot = makeRoot({
      scope: "userGlobal",
      rootPath: path.join(HOME, ".agents/extra-skills"),
      instructionPath: sharedInstruction,
    });

    toolDetectorStub.__format = "ref";
    const groups = await resolveOutputGroups([agentsRoot, extraRoot], {
      config: makeConfig({
        outputTargetsValue: [
          { id: "agents", format: "compact" },
          {
            id: `custom:${normalizeFileSystemPath(extraRoot.rootPath)}`,
            format: "legacy",
          },
        ],
      }),
      workspaceFolderUris: [],
    });

    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].members.length, 2);
    // agents は custom より優先されるので、共有ファイルの形式は compact になる
    assert.strictEqual(groups[0].format, "compact");
  });

  await test("nested workspace folders resolve to the deepest match", () => {
    const outer = makeUri("/repos/alpha");
    const inner = makeUri("/repos/alpha/packages/app");
    const sibling = makeUri("/repos/alpha2");

    assert.strictEqual(
      findDeepestContainingFolder(
        path.resolve("/repos/alpha/packages/app/.github/skills"),
        [outer, inner, sibling],
      ).fsPath,
      inner.fsPath,
    );
    // `/repos/alpha2` を `/repos/alpha` 配下と誤認しない
    assert.strictEqual(
      findDeepestContainingFolder(
        path.resolve("/repos/alpha2/.github/skills"),
        [outer, inner],
      ),
      undefined,
    );
  });

  await test("canonicalizes output paths for grouping", () => {
    const canonical = canonicalizeOutputPath(
      path.join(os.tmpdir(), "skill-ninja-does-not-exist", "AGENTS.md"),
    );
    assert.strictEqual(
      canonical,
      canonicalizeOutputPath(
        path.join(os.tmpdir(), "skill-ninja-does-not-exist", ".", "AGENTS.md"),
      ),
    );
  });

  await test("parses only object entries from outputTargets", () => {
    const parsed = parseOutputTargets([
      { id: "workspace" },
      "nope",
      null,
      ["also-nope"],
      { id: "copilot" },
    ]);
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parseOutputTargets(undefined).length, 0);
  });

  await test("disable cleanup keeps sibling and user-authored content", () => {
    const content = [
      "# My notes",
      "",
      "Hand written text that must survive.",
      "",
      "<!-- resource-ninja-START -->",
      "sibling managed block",
      "<!-- resource-ninja-END -->",
      "",
      "<!-- agent-ninja-START -->",
      "skill ninja managed block",
      "<!-- agent-ninja-END -->",
      "",
    ].join("\n");

    const stripped = instructionManager.cleanupManagedSkillBlocks(content, {
      keepLegacyResource: true,
    });

    assert.ok(stripped.includes("Hand written text that must survive."));
    assert.ok(stripped.includes("<!-- resource-ninja-START -->"));
    assert.ok(!stripped.includes("<!-- agent-ninja-START -->"));
  });

  await test("owner writes still consolidate sibling legacy markers", () => {
    const content = [
      "<!-- resource-ninja-START -->",
      "stale legacy block",
      "<!-- resource-ninja-END -->",
    ].join("\n");

    const stripped = instructionManager.cleanupManagedSkillBlocks(content);
    assert.ok(!stripped.includes("<!-- resource-ninja-START -->"));
  });

  await test("stale generated catalog files are deleted, authored ones are kept", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "output-targets-"));
    try {
      const generated = path.join(tmp, "generated-README.md");
      fs.writeFileSync(
        generated,
        "<!-- agent-ninja-START -->\ngenerated rows\n<!-- agent-ninja-END -->\n",
        "utf8",
      );
      await instructionManager.removeSkillSectionFromFile(makeUri(generated), {
        keepLegacyResource: true,
        deleteWhenEmpty: true,
      });
      assert.strictEqual(fs.existsSync(generated), false);

      const authored = path.join(tmp, "authored-README.md");
      fs.writeFileSync(
        authored,
        "# Team notes\n\n<!-- agent-ninja-START -->\ngenerated rows\n<!-- agent-ninja-END -->\n",
        "utf8",
      );
      await instructionManager.removeSkillSectionFromFile(makeUri(authored), {
        keepLegacyResource: true,
        deleteWhenEmpty: true,
      });
      assert.strictEqual(fs.existsSync(authored), true);
      const remaining = fs.readFileSync(authored, "utf8");
      assert.ok(remaining.includes("# Team notes"));
      assert.ok(!remaining.includes("<!-- agent-ninja-START -->"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await test("relative target roots match the workspace root they resolve to", async () => {
    const groups = await resolveOutputGroups([workspaceRootA], {
      config: makeConfig({
        outputTargetsValue: [
          { id: "some-custom-id", root: ".github/skills", format: "legacy" },
        ],
      }),
      workspaceFolderUris: [makeUri(workspaceA)],
    });

    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].format, "legacy");
  });

  // --- reconcile 判定ロジック（ファイル削除を決めるので、分岐を実際に通す） ---

  const bucketA = normalizeFileSystemPath(workspaceA);
  const bucketB = normalizeFileSystemPath(workspaceB);
  const instructionA = path.join(workspaceA, "AGENTS.md");
  const catalogA = path.join(workspaceA, ".github/skills/README.md");
  const instructionB = path.join(workspaceB, "AGENTS.md");
  const catalogB = path.join(workspaceB, ".github/skills/README.md");

  await test("desired paths are never treated as stale", () => {
    const desired = {
      [bucketA]: { instruction: [instructionA], catalog: [catalogA] },
    };
    const plan = planOutputCleanup({ desired, stored: desired });

    assert.deepStrictEqual(Array.from(plan.staleInstruction), []);
    assert.deepStrictEqual(Array.from(plan.staleCatalog), []);
  });

  await test("instruction and catalog stale lists stay separate", () => {
    const plan = planOutputCleanup({
      desired: { [bucketA]: { instruction: [instructionA], catalog: [] } },
      stored: {
        [bucketA]: { instruction: [instructionA], catalog: [catalogA] },
      },
    });

    // catalog だけが削除可能な生成物。instruction を混ぜるとユーザーのファイルを消す
    assert.deepStrictEqual(Array.from(plan.staleInstruction), []);
    assert.strictEqual(plan.staleCatalog.length, 1);
    assert.strictEqual(
      normalizeFileSystemPath(plan.staleCatalog[0]),
      normalizeFileSystemPath(catalogA),
    );
  });

  await test("a removed workspace folder is cleaned and dropped from the inventory", () => {
    const desired = {
      [bucketA]: { instruction: [instructionA], catalog: [] },
    };
    const stored = {
      [bucketA]: { instruction: [instructionA], catalog: [] },
      [bucketB]: { instruction: [instructionB], catalog: [catalogB] },
    };

    const plan = planOutputCleanup({ desired, stored });
    assert.ok(plan.buckets.includes(bucketB));
    assert.strictEqual(plan.staleInstruction.length, 1);
    assert.strictEqual(
      normalizeFileSystemPath(plan.staleInstruction[0]),
      normalizeFileSystemPath(instructionB),
    );
    assert.strictEqual(plan.staleCatalog.length, 1);

    const inventory = buildOutputInventory({
      buckets: plan.buckets,
      desired,
      stored,
      unhandledPaths: [],
    });
    assert.ok(Object.keys(inventory).includes(bucketA));
    assert.ok(!Object.keys(inventory).includes(bucketB));
  });

  await test("paths that could not be cleaned stay in the inventory for retry", () => {
    const desired = { [bucketA]: { instruction: [instructionA], catalog: [] } };
    const stored = {
      [bucketA]: { instruction: [instructionA], catalog: [catalogA] },
    };

    const retained = buildOutputInventory({
      buckets: [bucketA],
      desired,
      stored,
      unhandledPaths: [catalogA],
    });
    assert.strictEqual(retained[bucketA].catalog.length, 1);

    const dropped = buildOutputInventory({
      buckets: [bucketA],
      desired,
      stored,
      unhandledPaths: [],
    });
    assert.strictEqual(dropped[bucketA].catalog.length, 0);
  });

  await test("legacy inventory paths are cleaned only while they are not desired", () => {
    const legacyCopilot = path.join(HOME, ".copilot/instructions.md");
    const desired = {
      __global__: {
        instruction: [path.join(HOME, ".copilot/copilot-instructions.md")],
        catalog: [],
      },
    };

    const plan = planOutputCleanup({
      desired,
      stored: {},
      legacyInstructionPaths: [legacyCopilot],
    });
    assert.strictEqual(plan.staleInstruction.length, 1);

    // 出力先として現役なら掃除対象にしない
    const stillUsed = planOutputCleanup({
      desired: { __global__: { instruction: [legacyCopilot], catalog: [] } },
      stored: {},
      legacyInstructionPaths: [legacyCopilot],
    });
    assert.deepStrictEqual(Array.from(stillUsed.staleInstruction), []);
  });

  await test("a path some target uses as an instruction file is never deletable", () => {
    // catalogPath は設定次第で他ターゲットの instruction file と一致し得る
    const shared = path.join(workspaceA, "AGENTS.md");
    const plan = planOutputCleanup({
      desired: {},
      stored: {
        [bucketA]: { instruction: [shared], catalog: [] },
        [bucketB]: { instruction: [], catalog: [shared] },
      },
    });

    assert.strictEqual(plan.staleInstruction.length, 1);
    assert.deepStrictEqual(Array.from(plan.staleCatalog), []);
  });

  await test("unhandled instruction paths are retained too, and unknown buckets are tolerated", () => {
    const desired = { [bucketA]: { instruction: [], catalog: [] } };
    const stored = {
      [bucketA]: { instruction: [instructionA], catalog: [] },
    };

    const retained = buildOutputInventory({
      buckets: [bucketA, "never-seen-bucket"],
      desired,
      stored,
      unhandledPaths: [instructionA],
    });
    assert.strictEqual(retained[bucketA].instruction.length, 1);
    // stored も desired も無い bucket は落とす
    assert.ok(!Object.keys(retained).includes("never-seen-bucket"));

    // desired だけの bucket は stored が無くても残す
    const desiredOnly = buildOutputInventory({
      buckets: [bucketB],
      desired: { [bucketB]: { instruction: [instructionB], catalog: [] } },
      stored: {},
      unhandledPaths: [],
    });
    assert.strictEqual(desiredOnly[bucketB].instruction.length, 1);
  });

  await test("the stored inventory reader rejects shapes it must not misread", () => {
    const parsed = parseOutputPathBuckets({
      [bucketA]: { instruction: [instructionA], catalog: [catalogA] },
      droppedNonObject: "nope",
      droppedArray: [instructionB],
      partial: { instruction: [instructionB] },
      mixedEntries: { instruction: [instructionB, 42, null], catalog: [] },
    });

    assert.deepStrictEqual(Object.keys(parsed).sort(), [
      bucketA,
      "mixedEntries",
      "partial",
    ].sort());
    assert.deepStrictEqual(Array.from(parsed.partial.catalog), []);
    assert.strictEqual(parsed.mixedEntries.instruction.length, 1);

    // v1 は flat array。bucket として誤読みすると掃除対象を見失う
    assert.deepStrictEqual(
      Object.keys(parseOutputPathBuckets([instructionA, catalogA])),
      [],
    );
    assert.deepStrictEqual(Object.keys(parseOutputPathBuckets(undefined)), []);
    assert.deepStrictEqual(Object.keys(parseOutputPathBuckets("x")), []);
  });

  console.log(
    failures === 0
      ? "All output target tests passed"
      : `${failures} output target test(s) failed`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
