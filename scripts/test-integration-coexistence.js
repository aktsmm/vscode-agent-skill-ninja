/**
 * Integration coexistence regression tests.
 *
 * Drives `instructionManager.updateInstructionFileForRoot` against the real
 * filesystem via a `vscode` module stub. Covers 6 of the 8 acceptance
 * scenarios end-to-end (A, C, D, E, G, H). Scenarios B and F live on the
 * Resource NINJA side and require its own integration harness.
 *
 * Each scenario:
 *  1. Copies the corresponding fixture into a temp workspace.
 *  2. Configures a `vscode` stub (sibling presence, settings, fs).
 *  3. Calls `updateInstructionFileForRoot`.
 *  4. Asserts marker structure + payload presence + idempotency (3 runs).
 *
 * Run after compile: node scripts/test-integration-coexistence.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const vm = require("vm");
const ts = require("typescript");

const REPO_ROOT = path.resolve(__dirname, "..");
const FIXTURE_ROOT = path.join(
  REPO_ROOT,
  "output_sessions",
  "coexistence-fixture",
);

const SHARED_MARKERS = {
  start: "<!-- agent-ninja-START -->",
  end: "<!-- agent-ninja-END -->",
};
const LEGACY_SKILL_MARKERS = {
  start: "<!-- skill-ninja-START -->",
  end: "<!-- skill-ninja-END -->",
};
const LEGACY_RESOURCE_MARKERS = {
  start: "<!-- resource-ninja-START -->",
  end: "<!-- resource-ninja-END -->",
};
const LEGACY_FINDER_MARKERS = {
  start: "<!-- SKILL-FINDER-START -->",
  end: "<!-- SKILL-FINDER-END -->",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countMarkerPairs(text, markers) {
  return {
    starts: (text.match(new RegExp(escapeRegExp(markers.start), "g")) || [])
      .length,
    ends: (text.match(new RegExp(escapeRegExp(markers.end), "g")) || []).length,
  };
}

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

function setupTmpFixture(scenarioName) {
  const src = path.join(FIXTURE_ROOT, scenarioName);
  if (!fs.existsSync(src)) {
    throw new Error(
      `Fixture ${scenarioName} not found. Run scripts/build-coexistence-fixture.js first.`,
    );
  }
  const tmp = fs.mkdtempSync(
    path.join(os.tmpdir(), `coexistence-${scenarioName}-`),
  );
  copyDirSync(src, tmp);
  return tmp;
}

function cleanupTmp(tmp) {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// vscode module stub backed by the real filesystem
// ---------------------------------------------------------------------------

class FsBackedFs {
  async readFile(uri) {
    return fs.readFileSync(uri.fsPath);
  }
  async writeFile(uri, content) {
    fs.writeFileSync(uri.fsPath, content);
  }
  async createDirectory(uri) {
    fs.mkdirSync(uri.fsPath, { recursive: true });
  }
  async stat(uri) {
    const st = fs.statSync(uri.fsPath);
    return {
      type: st.isDirectory() ? 2 : 1,
      ctime: st.ctimeMs,
      mtime: st.mtimeMs,
      size: st.size,
    };
  }
  async readDirectory(uri) {
    const entries = fs.readdirSync(uri.fsPath, { withFileTypes: true });
    return entries.map((e) => [
      e.name,
      e.isDirectory() ? 2 : e.isFile() ? 1 : 64,
    ]);
  }
}

const FileType = { File: 1, Directory: 2, SymbolicLink: 64 };

function makeUri(fsPath) {
  const p = path.normalize(fsPath);
  return {
    fsPath: p,
    path: p.replace(/\\/g, "/"),
    scheme: "file",
  };
}

function joinPath(base, ...parts) {
  return makeUri(path.join(base.fsPath, ...parts));
}

function makeVscodeStub({
  workspaceUri,
  settings = {},
  siblingExports = undefined, // undefined => not installed (default)
  siblingInstalledNoApi = false, // true => installed but activate returns no API (older version)
  siblingActivateThrows = false, // true => sibling.activate() rejects
  siblingExtensionVersion = "0.2.11",
}) {
  const onDidChangeListeners = [];
  const onDidChangeConfigListeners = [];

  const stub = {
    Uri: {
      file: makeUri,
      joinPath,
      parse: (s) => makeUri(s.replace(/^file:\/\//, "")),
    },
    FileType,
    workspace: {
      workspaceFolders: workspaceUri
        ? [{ uri: workspaceUri, name: "test", index: 0 }]
        : undefined,
      fs: new FsBackedFs(),
      getConfiguration(section) {
        return {
          get(key, def) {
            const fullKey = section ? `${section}.${key}` : key;
            const value = settings[fullKey];
            return value !== undefined ? value : def;
          },
          inspect(key) {
            const fullKey = section ? `${section}.${key}` : key;
            return { key: fullKey, globalValue: settings[fullKey] };
          },
          update() {
            return Promise.resolve();
          },
        };
      },
      onDidChangeConfiguration(cb) {
        onDidChangeConfigListeners.push(cb);
        return {
          dispose() {
            const i = onDidChangeConfigListeners.indexOf(cb);
            if (i !== -1) onDidChangeConfigListeners.splice(i, 1);
          },
        };
      },
    },
    extensions: {
      getExtension(id) {
        if (id === "yamapan.agent-skill-ninja") {
          return {
            isActive: true,
            packageJSON: { version: "0.8.28-dev" },
            activate() {
              return Promise.resolve({});
            },
          };
        }
        if (
          id === "yamapan.agent-resources-ninja" &&
          (siblingExports !== undefined ||
            siblingInstalledNoApi ||
            siblingActivateThrows)
        ) {
          return {
            isActive: true,
            packageJSON: { version: siblingExtensionVersion },
            activate() {
              if (siblingActivateThrows) {
                return Promise.reject(new Error("sibling activate failed"));
              }
              if (siblingInstalledNoApi) {
                return Promise.resolve(undefined);
              }
              return Promise.resolve(siblingExports);
            },
          };
        }
        return undefined;
      },
      onDidChange(cb) {
        onDidChangeListeners.push(cb);
        return {
          dispose() {
            const i = onDidChangeListeners.indexOf(cb);
            if (i !== -1) onDidChangeListeners.splice(i, 1);
          },
        };
      },
    },
    Disposable: class {
      constructor(fn) {
        this._fn = fn;
      }
      dispose() {
        if (this._fn) this._fn();
      }
    },
  };

  // Expose listeners so tests can fire onDidChange manually if needed.
  stub.__internal = {
    onDidChangeListeners,
    onDidChangeConfigListeners,
  };

  return stub;
}

// ---------------------------------------------------------------------------
// Module loader: shared sandbox for instructionManager + coexistence
// ---------------------------------------------------------------------------

function transpileTs(srcPath) {
  const source = fs.readFileSync(srcPath, "utf8");
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
}

/**
 * Load instructionManager.ts in a sandbox where:
 *   - `vscode` resolves to the supplied stub
 *   - `./coexistence` is the real coexistence module (also transpiled)
 *   - `./skillInstaller` is stubbed to return our injected SkillMeta list
 *   - other deps are minimal stubs so updateInstructionFileForRoot works
 *
 * Returns the loaded `instructionManager` module exports.
 */
function loadInstructionManager(vscodeStub, injectedSkills, options = {}) {
  const skillsByRootPath = options.skillsByRootPath || new Map();
  const managedRoots = options.managedRoots || [];
  // Coexistence sandbox
  const coexExports = {};
  const coexSandbox = {
    exports: coexExports,
    module: { exports: coexExports },
    process,
    console,
    Promise,
    Date,
    Set,
    Map,
    Buffer,
    setImmediate,
    setTimeout,
    require(req) {
      if (req === "vscode") return vscodeStub;
      return require(req);
    },
  };
  vm.runInNewContext(
    transpileTs(path.join(REPO_ROOT, "src", "coexistence.ts")),
    coexSandbox,
    { filename: "coexistence.ts" },
  );
  const coexistenceModule = coexSandbox.module.exports;

  // instructionManager sandbox
  const skillLocationsStub = {
    computeRelativeDirectoryPath: (from, to) => {
      const r = path.relative(path.dirname(from), to).replace(/\\/g, "/");
      return r || ".";
    },
    normalizeFileSystemPath: (filePath) => {
      const normalized = path.normalize(filePath).replace(/\\/g, "/");
      return process.platform === "win32"
        ? normalized.toLowerCase()
        : normalized;
    },
    getManagedSkillRoots: async () => managedRoots,
    resolveConfiguredPathToUri: (configuredPath, rootUri) => {
      if (!configuredPath) {
        return undefined;
      }
      if (path.isAbsolute(configuredPath)) {
        return makeUri(configuredPath);
      }
      return rootUri ? joinPath(rootUri, configuredPath) : undefined;
    },
  };

  const toolDetectorStub = (() => {
    const skillConfig = vscodeStub.workspace.getConfiguration("skillNinja");
    const normalizeOutputFormat = (value) => {
      if (["ref", "full", "compact", "legacy"].includes(value)) {
        return value;
      }
      if (value === "markdown") return "legacy";
      if (value === "compressed-index") return "compact";
      if (value === "markdown-with-index") return "full";
      return "ref";
    };
    return {
      normalizeOutputFormat,
      resolveOutputFormat: async () => ({
        format: normalizeOutputFormat(skillConfig.get("outputFormat", "ref")),
      }),
    };
  })();

  const outputTargetsExports = {};
  const outputTargetsSandbox = {
    exports: outputTargetsExports,
    module: { exports: outputTargetsExports },
    process,
    console,
    Buffer,
    require(req) {
      if (req === "vscode") return vscodeStub;
      if (req === "./skillLocations") return skillLocationsStub;
      if (req === "./toolDetector") return toolDetectorStub;
      return require(req);
    },
  };
  vm.runInNewContext(
    transpileTs(path.join(REPO_ROOT, "src", "outputTargets.ts")),
    outputTargetsSandbox,
    { filename: "outputTargets.ts" },
  );
  const outputTargetsModule = outputTargetsSandbox.module.exports;

  const imExports = {};
  const imSandbox = {
    exports: imExports,
    module: { exports: imExports },
    process,
    console,
    Promise,
    Date,
    Set,
    Map,
    Buffer,
    setImmediate,
    setTimeout,
    require(req) {
      if (req === "vscode") return vscodeStub;
      if (req === "./coexistence") return coexistenceModule;
      if (req === "./skillInstaller") {
        return {
          getInstalledSkillsWithMeta: async (rootUri) =>
            skillsByRootPath.get(rootUri.fsPath) || injectedSkills,
        };
      }
      if (req === "./localSkillScanner") {
        return {};
      }
      if (req === "./toolDetector") {
        return toolDetectorStub;
      }
      if (req === "./outputTargets") {
        return outputTargetsModule;
      }
      if (req === "./shared-store-lock") {
        return {
          withSharedStoreLock: async (_id, task) =>
            task({ assertHeld() {}, assertStillOwned: async () => {} }),
          describeSharedStoreLockFailure: () => undefined,
        };
      }
      if (req === "./constants") {
        return {
          SELF_EXTENSION_ID: "yamapan.agent-skill-ninja",
          SKILL_DESCRIPTION_LIMITS: { MAX_TOTAL: 200, MAX_EACH: 100 },
        };
      }
      if (req === "./skillLocations") {
        return skillLocationsStub;
      }
      if (req === "path") return path;
      return require(req);
    },
  };
  vm.runInNewContext(
    transpileTs(path.join(REPO_ROOT, "src", "instructionManager.ts")),
    imSandbox,
    { filename: "instructionManager.ts" },
  );
  return {
    instructionManager: imSandbox.module.exports,
    coexistence: coexistenceModule,
  };
}

function makeContext() {
  const state = new Map();
  return {
    globalState: {
      get: (k) => state.get(k),
      update: (k, v) => {
        if (v === undefined) state.delete(k);
        else state.set(k, v);
        return Promise.resolve();
      },
    },
    _state: state,
  };
}

function makeSampleSkill(name, description, relativePath = name) {
  return {
    name,
    source: "local",
    description,
    whenToUse: "",
    customWhenToUse: "",
    categories: [],
    installedAt: new Date().toISOString(),
    relativePath,
    license: "",
    author: "",
    version: "1.0.0",
    registrationDisabled: false,
  };
}

function makeRoot(workspaceUri, skillsDir = ".github/skills") {
  const rootUri = joinPath(workspaceUri, skillsDir);
  const instructionUri = joinPath(workspaceUri, "AGENTS.md");
  return {
    scope: "workspace",
    label: "Workspace",
    rootUri,
    rootPath: rootUri.fsPath,
    displayPath: skillsDir,
    isManaged: true,
    isReadOnly: false,
    instructionUri,
    instructionPath: instructionUri.fsPath,
    linkPathFromInstruction: skillsDir,
  };
}

function makeUserGlobalRoot(baseUri) {
  const rootUri = joinPath(baseUri, "user-skills");
  const instructionUri = joinPath(baseUri, "instructions", "AGENTS.md");
  return {
    scope: "userGlobal",
    label: "User / Global",
    rootUri,
    rootPath: rootUri.fsPath,
    displayPath: "user-skills",
    isManaged: true,
    isReadOnly: false,
    instructionUri,
    instructionPath: instructionUri.fsPath,
    linkPathFromInstruction: "../user-skills",
  };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

async function run() {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`PASS ${t.name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL ${t.name}`);
      console.error(err && err.stack ? err.stack : err);
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll integration coexistence tests passed.");
}

// ---------------------------------------------------------------------------
// Scenario A: Skill solo
// ---------------------------------------------------------------------------

test("Scenario A: Skill solo writes shared block with skill rows", async () => {
  const tmp = setupTmpFixture("A-skill-solo");
  try {
    const wsUri = makeUri(tmp);
    const stub = makeVscodeStub({
      workspaceUri: wsUri,
      settings: { "skillNinja.outputFormat": "full" },
      siblingExports: undefined, // not installed
    });
    const skills = [
      makeSampleSkill("sample-alpha", "First sample skill"),
      makeSampleSkill("sample-beta", "Second sample skill"),
    ];
    const { instructionManager } = loadInstructionManager(stub, skills);
    const ctx = makeContext();
    const root = makeRoot(wsUri);

    await instructionManager.updateInstructionFileForRoot(root, ctx);

    const got = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    assert.ok(
      got.includes(SHARED_MARKERS.start),
      "shared start marker should be present",
    );
    assert.ok(
      got.includes(SHARED_MARKERS.end),
      "shared end marker should be present",
    );
    assert.ok(got.includes("sample-alpha"), "sample-alpha row missing");
    assert.ok(got.includes("sample-beta"), "sample-beta row missing");
    assert.strictEqual(
      got.includes("[incomplete]"),
      false,
      "complete skills must not be flagged",
    );
    const counts = countMarkerPairs(got, SHARED_MARKERS);
    assert.strictEqual(counts.starts, 1, "exactly one shared start marker");
    assert.strictEqual(counts.ends, 1, "exactly one shared end marker");
    // Project notes preserved
    assert.ok(got.includes("Project notes"), "user content must be preserved");

    // Idempotency: 3 consecutive runs
    const after1 = got;
    await instructionManager.updateInstructionFileForRoot(root, ctx);
    const after2 = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    await instructionManager.updateInstructionFileForRoot(root, ctx);
    const after3 = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    assert.strictEqual(after1, after2, "second run should be a no-op");
    assert.strictEqual(after2, after3, "third run should be a no-op");
  } finally {
    cleanupTmp(tmp);
  }
});

test("Scenario A-incomplete: placeholder-only skills are flagged in the skill list", async () => {
  const tmp = setupTmpFixture("A-skill-solo");
  try {
    const wsUri = makeUri(tmp);
    const stub = makeVscodeStub({
      workspaceUri: wsUri,
      settings: { "skillNinja.outputFormat": "full" },
      siblingExports: undefined,
    });
    const broken = makeSampleSkill("sample-broken", "Placeholder description");
    broken.incomplete = true;
    const skills = [
      makeSampleSkill("sample-alpha", "First sample skill"),
      broken,
    ];
    const { instructionManager } = loadInstructionManager(stub, skills);
    const ctx = makeContext();
    const root = makeRoot(wsUri);

    await instructionManager.updateInstructionFileForRoot(root, ctx);

    const got = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    const brokenRow = got
      .split("\n")
      .find((line) => line.includes("sample-broken"));
    assert.ok(brokenRow, "incomplete skill row missing");
    assert.ok(
      brokenRow.includes("[incomplete]"),
      "incomplete skill must be flagged for the reading agent",
    );
    const healthyRow = got
      .split("\n")
      .find((line) => line.includes("sample-alpha"));
    assert.ok(healthyRow, "healthy skill row missing");
    assert.strictEqual(
      healthyRow.includes("[incomplete]"),
      false,
      "healthy skills must stay unflagged",
    );
  } finally {
    cleanupTmp(tmp);
  }
});

test("Scenario A-ref: lightweight instruction block writes separate catalog with catalog-relative skill links", async () => {
  const tmp = setupTmpFixture("A-skill-solo");
  try {
    const wsUri = makeUri(tmp);
    const stub = makeVscodeStub({
      workspaceUri: wsUri,
      settings: {
        "skillNinja.outputFormat": "ref",
        "skillNinja.refCatalogPath": ".github/catalog/skills.md",
      },
      siblingExports: undefined,
    });
    const skills = [
      makeSampleSkill("sample-alpha", "First sample skill"),
      makeSampleSkill("sample-beta", "Second sample skill"),
    ];
    const { instructionManager } = loadInstructionManager(stub, skills);
    const ctx = makeContext();
    const root = makeRoot(wsUri);

    await instructionManager.updateInstructionFileForRoot(root, ctx);

    const instruction = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    const catalogPath = path.join(tmp, ".github", "catalog", "skills.md");
    const catalog = fs.readFileSync(catalogPath, "utf8");

    assert.ok(
      instruction.includes(
        "> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.\n" +
          "> See [Agent Skills](.github/catalog/skills.md) before working on tasks covered by these skills.",
      ),
      `instruction file should reference external catalog; got:\n${instruction}`,
    );
    assert.ok(
      !instruction.includes("sample-alpha/SKILL.md"),
      "instruction file should stay lightweight in ref mode",
    );
    assert.ok(
      catalog.includes("../skills/sample-alpha/SKILL.md"),
      `catalog should link to skills relative to catalog location; got:\n${catalog}`,
    );
    assert.ok(
      catalog.includes("sample-beta"),
      "catalog should contain skill rows",
    );

    await instructionManager.updateInstructionFileForRoot(root, ctx);
    const instructionAgain = fs.readFileSync(
      path.join(tmp, "AGENTS.md"),
      "utf8",
    );
    const catalogAgain = fs.readFileSync(catalogPath, "utf8");
    assert.strictEqual(
      instruction,
      instructionAgain,
      "ref instruction output should be idempotent",
    );
    assert.strictEqual(
      catalog,
      catalogAgain,
      "ref catalog output should be idempotent",
    );
  } finally {
    cleanupTmp(tmp);
  }
});

test("Scenario A-ref-compact: ref catalog format can use compact index", async () => {
  const tmp = setupTmpFixture("A-skill-solo");
  try {
    const wsUri = makeUri(tmp);
    const stub = makeVscodeStub({
      workspaceUri: wsUri,
      settings: {
        "skillNinja.outputFormat": "ref",
        "skillNinja.refCatalogPath": ".github/catalog/skills.md",
        "skillNinja.refCatalogFormat": "compact",
      },
      siblingExports: undefined,
    });
    const skills = [makeSampleSkill("sample-alpha", "First sample skill")];
    const { instructionManager } = loadInstructionManager(stub, skills);
    const ctx = makeContext();
    const root = makeRoot(wsUri);

    await instructionManager.updateInstructionFileForRoot(root, ctx);

    const instruction = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    const catalog = fs.readFileSync(
      path.join(tmp, ".github", "catalog", "skills.md"),
      "utf8",
    );

    assert.ok(
      instruction.includes("> See [Agent Skills](.github/catalog/skills.md)"),
      `instruction file should still link to compact catalog; got:\n${instruction}`,
    );
    assert.ok(
      catalog.includes("## Agent Skills (Compressed Index)"),
      `catalog should use compact format; got:\n${catalog}`,
    );
    assert.ok(
      catalog.includes("../skills/sample-alpha/SKILL.md"),
      `compact catalog should keep catalog-relative links; got:\n${catalog}`,
    );
  } finally {
    cleanupTmp(tmp);
  }
});

test("Scenario A: duplicate skill names are disambiguated in generated labels", async () => {
  const tmp = setupTmpFixture("A-skill-solo");
  try {
    const wsUri = makeUri(tmp);
    const stub = makeVscodeStub({
      workspaceUri: wsUri,
      settings: { "skillNinja.outputFormat": "full" },
      siblingExports: undefined,
    });
    const skills = [
      makeSampleSkill("Docx", "Primary docx skill", "docx"),
      makeSampleSkill("Docx", "Nested documents docx skill", "documents/Docx"),
    ];
    const { instructionManager } = loadInstructionManager(stub, skills);
    const ctx = makeContext();
    const root = makeRoot(wsUri);

    await instructionManager.updateInstructionFileForRoot(root, ctx);

    const got = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    assert.ok(got.includes("[Docx](.github/skills/docx/SKILL.md)"));
    assert.ok(
      got.includes(
        "[Docx (Documents)](.github/skills/documents/Docx/SKILL.md)",
      ),
      `duplicate names should be disambiguated; got:\n${got}`,
    );
  } finally {
    cleanupTmp(tmp);
  }
});

test("Scenario U-ref: user/global ref catalog resolves from instruction directory", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "user-global-ref-"));
  try {
    fs.mkdirSync(path.join(tmp, "user-skills"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "instructions"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "instructions", "AGENTS.md"),
      "# User instructions\n",
    );

    const baseUri = makeUri(tmp);
    const stub = makeVscodeStub({
      workspaceUri: undefined,
      settings: {
        "skillNinja.outputFormat": "ref",
        "skillNinja.refCatalogPath": ".catalog/skills.md",
      },
      siblingExports: undefined,
    });
    const skills = [makeSampleSkill("global-alpha", "Global sample skill")];
    const { instructionManager } = loadInstructionManager(stub, skills);
    const ctx = makeContext();
    const root = makeUserGlobalRoot(baseUri);

    await instructionManager.updateInstructionFileForRoot(root, ctx);

    const instructionPath = path.join(tmp, "instructions", "AGENTS.md");
    const catalogPath = path.join(tmp, "instructions", ".catalog", "skills.md");
    const instruction = fs.readFileSync(instructionPath, "utf8");
    const catalog = fs.readFileSync(catalogPath, "utf8");

    assert.ok(
      instruction.includes(
        "> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.\n" +
          "> See [Agent Skills](.catalog/skills.md) before working on tasks covered by these skills.",
      ),
      `user/global instruction should link to catalog beside instruction file; got:\n${instruction}`,
    );
    assert.ok(
      !instruction.includes("global-alpha/SKILL.md"),
      "user/global instruction file should stay lightweight in ref mode",
    );
    assert.ok(
      catalog.includes("../../user-skills/global-alpha/SKILL.md"),
      `user/global catalog should link to skills relative to catalog location; got:\n${catalog}`,
    );
  } finally {
    cleanupTmp(tmp);
  }
});

// ---------------------------------------------------------------------------
// Scenario C: Both extensions, default auto -> sibling owns -> Skill defers
// ---------------------------------------------------------------------------

test("Scenario C: Both extensions in auto mode; Skill NINJA defers to sibling", async () => {
  const tmp = setupTmpFixture("C-both-auto");
  try {
    const wsUri = makeUri(tmp);
    const siblingBeacon = {
      extensionId: "yamapan.agent-resources-ninja",
      version: "0.2.11",
      kinds: [
        "skill",
        "agent",
        "instruction",
        "prompt",
        "hook",
        "mcp",
        "plugin",
        "cursor-rule",
      ],
      capabilities: ["owner-handoff-v3"],
      protocolVersion: 3,
      updatedAt: new Date().toISOString(),
    };
    const stub = makeVscodeStub({
      workspaceUri: wsUri,
      settings: {
        "skillNinja.outputFormat": "full",
        "skillNinja.coexistenceMode": "auto",
      },
      siblingExports: { getAgentNinjaBeacon: () => siblingBeacon },
    });
    const skills = [makeSampleSkill("sample-alpha", "First")];
    const { instructionManager } = loadInstructionManager(stub, skills);
    const ctx = makeContext();
    const root = makeRoot(wsUri);

    const before = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    await instructionManager.updateInstructionFileForRoot(root, ctx);
    const after = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");

    // Skill NINJA must NOT touch the file when sibling owns the block.
    assert.strictEqual(
      after,
      before,
      "Skill NINJA should defer (no write) when sibling owns the shared block",
    );
    // No skill-ninja markers should be added.
    assert.ok(
      !after.includes(LEGACY_SKILL_MARKERS.start),
      "no legacy skill-ninja marker should appear",
    );
  } finally {
    cleanupTmp(tmp);
  }
});

// ---------------------------------------------------------------------------
// Scenario D: Both + custom paths -> Skill defers (sibling owns), no write
// ---------------------------------------------------------------------------

test("Scenario D: Custom skillsDirectory honored when Skill NINJA does write (sibling absent)", async () => {
  const tmp = setupTmpFixture("D-both-custom-paths");
  try {
    const wsUri = makeUri(tmp);
    // For an automatable D variant: simulate sibling absent so Skill NINJA
    // does the write and we can verify the custom path link is used.
    // (When sibling owns, Skill NINJA defers, which is already covered by C.)
    const stub = makeVscodeStub({
      workspaceUri: wsUri,
      settings: {
        "skillNinja.outputFormat": "full",
        "skillNinja.skillsDirectory": "custom/skills",
        "skillNinja.coexistenceMode": "auto",
      },
      siblingExports: undefined,
    });
    const skills = [makeSampleSkill("custom-gamma", "Custom path skill")];
    const { instructionManager } = loadInstructionManager(stub, skills);
    const ctx = makeContext();
    const root = makeRoot(wsUri, "custom/skills");

    await instructionManager.updateInstructionFileForRoot(root, ctx);

    const got = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    assert.ok(got.includes(SHARED_MARKERS.start));
    assert.ok(
      got.includes("custom/skills/custom-gamma/SKILL.md"),
      `link should point at custom path; got:\n${got}`,
    );
  } finally {
    cleanupTmp(tmp);
  }
});

test("Scenario D2: additional workspace roots share one instruction block", async () => {
  const tmp = setupTmpFixture("D-both-custom-paths");
  try {
    const wsUri = makeUri(tmp);
    const rootA = makeRoot(wsUri, ".github/skills");
    const rootB = makeRoot(wsUri, "copilot-skills/skills");
    const skillsByRootPath = new Map([
      [rootA.rootPath, [makeSampleSkill("sample-alpha", "First")]],
      [rootB.rootPath, [makeSampleSkill("copilot-beta", "Second")]],
    ]);
    const stub = makeVscodeStub({
      workspaceUri: wsUri,
      settings: {
        "skillNinja.outputFormat": "full",
        "skillNinja.skillsDirectory": ".github/skills",
        "skillNinja.additionalSkillRoots": ["copilot-skills/skills"],
        "skillNinja.coexistenceMode": "auto",
      },
      siblingExports: undefined,
    });
    const { instructionManager } = loadInstructionManager(stub, [], {
      managedRoots: [rootA, rootB],
      skillsByRootPath,
    });
    const ctx = makeContext();

    await instructionManager.updateInstructionFileForRoot(rootA, ctx);

    const got = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    assert.ok(got.includes(".github/skills/sample-alpha/SKILL.md"));
    assert.ok(got.includes("copilot-skills/skills/copilot-beta/SKILL.md"));
  } finally {
    cleanupTmp(tmp);
  }
});

test("Scenario D3: additional workspace roots share one ref catalog", async () => {
  const tmp = setupTmpFixture("D-both-custom-paths");
  try {
    const wsUri = makeUri(tmp);
    const rootA = makeRoot(wsUri, ".github/skills");
    const rootB = makeRoot(wsUri, "copilot-skills/skills");
    const skillsByRootPath = new Map([
      [rootA.rootPath, [makeSampleSkill("sample-alpha", "First")]],
      [rootB.rootPath, [makeSampleSkill("copilot-beta", "Second")]],
    ]);
    const stub = makeVscodeStub({
      workspaceUri: wsUri,
      settings: {
        "skillNinja.outputFormat": "ref",
        "skillNinja.refCatalogPath": ".github/skills/README.md",
        "skillNinja.skillsDirectory": ".github/skills",
        "skillNinja.additionalSkillRoots": ["copilot-skills/skills"],
        "skillNinja.coexistenceMode": "auto",
      },
      siblingExports: undefined,
    });
    const { instructionManager } = loadInstructionManager(stub, [], {
      managedRoots: [rootA, rootB],
      skillsByRootPath,
    });
    const ctx = makeContext();

    await instructionManager.updateInstructionFileForRoot(rootA, ctx);

    const instruction = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    const catalog = fs.readFileSync(
      path.join(tmp, ".github", "skills", "README.md"),
      "utf8",
    );
    assert.ok(instruction.includes(".github/skills/README.md"));
    assert.ok(catalog.includes("sample-alpha/SKILL.md"));
    assert.ok(
      catalog.includes("../../copilot-skills/skills/copilot-beta/SKILL.md"),
    );
  } finally {
    cleanupTmp(tmp);
  }
});

// ---------------------------------------------------------------------------
// Scenario E: Resource uninstall handoff
// ---------------------------------------------------------------------------

test("Scenario E: Skill NINJA takes over the same shared block after sibling disappears", async () => {
  const tmp = setupTmpFixture("E-uninstall-resource");
  try {
    const wsUri = makeUri(tmp);
    const skills = [
      makeSampleSkill("sample-alpha", "First"),
      makeSampleSkill("sample-beta", "Second"),
    ];

    // Phase 1: sibling present, Skill defers -> file unchanged.
    const siblingBeacon = {
      extensionId: "yamapan.agent-resources-ninja",
      version: "0.2.11",
      kinds: [
        "skill",
        "agent",
        "instruction",
        "prompt",
        "hook",
        "mcp",
        "plugin",
        "cursor-rule",
      ],
      capabilities: ["owner-handoff-v3"],
      protocolVersion: 3,
      updatedAt: new Date().toISOString(),
    };
    const stubWithSibling = makeVscodeStub({
      workspaceUri: wsUri,
      settings: {
        "skillNinja.outputFormat": "full",
        "skillNinja.coexistenceMode": "auto",
      },
      siblingExports: { getAgentNinjaBeacon: () => siblingBeacon },
    });
    const { instructionManager: im1 } = loadInstructionManager(
      stubWithSibling,
      skills,
    );
    const ctx1 = makeContext();
    const root1 = makeRoot(wsUri);

    const initial = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    await im1.updateInstructionFileForRoot(root1, ctx1);
    const afterDefer = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    assert.strictEqual(
      afterDefer,
      initial,
      "Skill NINJA should not touch the file while sibling owns",
    );

    // Phase 2: simulate sibling uninstall by reloading without sibling.
    const stubAlone = makeVscodeStub({
      workspaceUri: wsUri,
      settings: {
        "skillNinja.outputFormat": "full",
        "skillNinja.coexistenceMode": "auto",
      },
      siblingExports: undefined,
    });
    const { instructionManager: im2 } = loadInstructionManager(
      stubAlone,
      skills,
    );
    const ctx2 = makeContext();
    const root2 = makeRoot(wsUri);

    await im2.updateInstructionFileForRoot(root2, ctx2);

    const afterTakeover = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    // Same shared marker is reused (no rename, no new marker pair).
    const counts = countMarkerPairs(afterTakeover, SHARED_MARKERS);
    assert.strictEqual(counts.starts, 1);
    assert.strictEqual(counts.ends, 1);
    // Skill rows are present.
    assert.ok(afterTakeover.includes("sample-alpha"));
    assert.ok(afterTakeover.includes("sample-beta"));
    // No legacy markers introduced during handoff.
    assert.ok(!afterTakeover.includes(LEGACY_SKILL_MARKERS.start));
    assert.ok(!afterTakeover.includes(LEGACY_RESOURCE_MARKERS.start));
  } finally {
    cleanupTmp(tmp);
  }
});

// ---------------------------------------------------------------------------
// Scenario G: independent mode -> always self, uses legacy skill-ninja marker
// ---------------------------------------------------------------------------

test("Scenario G: independent mode writes legacy skill-ninja block even when sibling is active", async () => {
  const tmp = setupTmpFixture("G-both-independent");
  try {
    const wsUri = makeUri(tmp);
    const siblingBeacon = {
      extensionId: "yamapan.agent-resources-ninja",
      version: "0.2.11",
      kinds: [
        "skill",
        "agent",
        "instruction",
        "prompt",
        "hook",
        "mcp",
        "plugin",
        "cursor-rule",
      ],
      capabilities: ["owner-handoff-v3"],
      protocolVersion: 3,
      updatedAt: new Date().toISOString(),
    };
    const stub = makeVscodeStub({
      workspaceUri: wsUri,
      settings: {
        "skillNinja.outputFormat": "full",
        "skillNinja.coexistenceMode": "independent",
      },
      siblingExports: { getAgentNinjaBeacon: () => siblingBeacon },
    });
    const skills = [
      makeSampleSkill("sample-alpha", "First"),
      makeSampleSkill("sample-beta", "Second"),
    ];
    const { instructionManager } = loadInstructionManager(stub, skills);
    const ctx = makeContext();
    const root = makeRoot(wsUri);

    await instructionManager.updateInstructionFileForRoot(root, ctx);

    const got = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    const skillCounts = countMarkerPairs(got, LEGACY_SKILL_MARKERS);
    assert.strictEqual(
      skillCounts.starts,
      1,
      "independent mode should write legacy skill-ninja marker",
    );
    assert.strictEqual(skillCounts.ends, 1);
    // The shared marker should NOT be added by Skill NINJA in independent mode.
    const sharedCounts = countMarkerPairs(got, SHARED_MARKERS);
    assert.strictEqual(
      sharedCounts.starts,
      0,
      "independent mode must not add shared marker",
    );
  } finally {
    cleanupTmp(tmp);
  }
});

// ---------------------------------------------------------------------------
// Scenario H: Legacy migration consolidates 3 marker types into 1 shared block
// ---------------------------------------------------------------------------

test("Scenario H: Legacy markers (skill-ninja / resource-ninja / SKILL-FINDER) are consolidated into one shared block", async () => {
  const tmp = setupTmpFixture("H-legacy-migration");
  try {
    const wsUri = makeUri(tmp);
    const stub = makeVscodeStub({
      workspaceUri: wsUri,
      settings: {
        "skillNinja.outputFormat": "full",
        "skillNinja.coexistenceMode": "auto",
      },
      siblingExports: undefined, // Skill NINJA owns
    });
    const skills = [makeSampleSkill("sample-alpha", "First")];
    const { instructionManager } = loadInstructionManager(stub, skills);
    const ctx = makeContext();
    const root = makeRoot(wsUri);

    const before = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    // Sanity: starting fixture should contain all 3 legacy markers.
    assert.ok(before.includes(LEGACY_SKILL_MARKERS.start));
    assert.ok(before.includes(LEGACY_RESOURCE_MARKERS.start));
    assert.ok(before.includes(LEGACY_FINDER_MARKERS.start));

    await instructionManager.updateInstructionFileForRoot(root, ctx);

    const got = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    // All legacy markers gone.
    assert.ok(
      !got.includes(LEGACY_SKILL_MARKERS.start),
      "legacy skill-ninja marker should be removed",
    );
    assert.ok(
      !got.includes(LEGACY_RESOURCE_MARKERS.start),
      "legacy resource-ninja marker should be removed",
    );
    assert.ok(
      !got.includes(LEGACY_FINDER_MARKERS.start),
      "legacy SKILL-FINDER marker should be removed",
    );
    // Exactly one shared marker pair.
    const counts = countMarkerPairs(got, SHARED_MARKERS);
    assert.strictEqual(counts.starts, 1);
    assert.strictEqual(counts.ends, 1);
    // Skill row present.
    assert.ok(got.includes("sample-alpha"));
    // User content preserved.
    assert.ok(got.includes("Project notes"));

    // Idempotency
    await instructionManager.updateInstructionFileForRoot(root, ctx);
    const after2 = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    assert.strictEqual(got, after2, "second run should be a no-op");
  } finally {
    cleanupTmp(tmp);
  }
});

// ---------------------------------------------------------------------------
// Mixed-version safety: sibling installed but exposes no v3.1 API
// ---------------------------------------------------------------------------

test("Mixed-version: sibling extension present without v3.1 exports API -> Skill NINJA defers (no parallel block)", async () => {
  const tmp = setupTmpFixture("A-skill-solo");
  try {
    const wsUri = makeUri(tmp);
    const stub = makeVscodeStub({
      workspaceUri: wsUri,
      settings: {
        "skillNinja.outputFormat": "full",
        "skillNinja.coexistenceMode": "auto",
      },
      // Older Resource NINJA: installed but `activate()` returns undefined.
      siblingInstalledNoApi: true,
    });
    const skills = [makeSampleSkill("sample-alpha", "First")];
    const { instructionManager } = loadInstructionManager(stub, skills);
    const ctx = makeContext();
    const root = makeRoot(wsUri);

    const before = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    await instructionManager.updateInstructionFileForRoot(root, ctx);
    const after = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");

    // SIBLING_KINDS_FALLBACK pulls Skill NINJA into defer mode so it does
    // NOT write on top of whatever the older Resource NINJA might write.
    assert.strictEqual(
      after,
      before,
      "Skill NINJA must defer when sibling is installed but lacks v3.1 API",
    );
    // No marker added.
    assert.ok(!after.includes(SHARED_MARKERS.start));
    assert.ok(!after.includes(LEGACY_SKILL_MARKERS.start));
  } finally {
    cleanupTmp(tmp);
  }
});

test("Mixed-version: sibling.activate() throws -> Skill NINJA defers (no parallel block)", async () => {
  const tmp = setupTmpFixture("A-skill-solo");
  try {
    const wsUri = makeUri(tmp);
    const stub = makeVscodeStub({
      workspaceUri: wsUri,
      settings: {
        "skillNinja.outputFormat": "full",
        "skillNinja.coexistenceMode": "auto",
      },
      siblingActivateThrows: true,
    });
    const skills = [makeSampleSkill("sample-alpha", "First")];
    const { instructionManager } = loadInstructionManager(stub, skills);
    const ctx = makeContext();
    const root = makeRoot(wsUri);

    const before = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    // Expected error path: coexistence.ts logs a warning when sibling.activate()
    // rejects. Silence it here so the integration suite stays signal-focused.
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await instructionManager.updateInstructionFileForRoot(root, ctx);
    } finally {
      console.warn = originalWarn;
    }
    const after = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");

    assert.strictEqual(
      after,
      before,
      "Skill NINJA must defer when sibling activate throws",
    );
  } finally {
    cleanupTmp(tmp);
  }
});

// ---------------------------------------------------------------------------
// Catalog cleanup on defer: previously written ref catalog block is removed
// ---------------------------------------------------------------------------

test("Catalog cleanup: defer removes pre-existing agent-ninja block from catalog file", async () => {
  const tmp = setupTmpFixture("A-skill-solo");
  try {
    const wsUri = makeUri(tmp);
    const catalogRelPath = ".github/skills/README.md";
    const catalogAbsPath = path.join(tmp, catalogRelPath);

    fs.mkdirSync(path.dirname(catalogAbsPath), { recursive: true });
    const resourceNinjaCatalog =
      "<!-- resource-ninja-catalog: skill -->\n# Agent Skills\n| Resource | Source |\n<!-- /resource-ninja-catalog: skill -->\n";
    const compressedCatalog = [
      SHARED_MARKERS.start,
      "## Agent Skills (Compressed Index)",
      "",
      "> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.",
      "> Read the relevant SKILL.md before working on tasks covered by these skills.",
      "",
      "### Skills Index",
      "",
      "| Skill | Path | Description |",
      "|-------|------|-------------|",
      "| [sample-alpha](./sample-alpha/SKILL.md) | `sample-alpha` | First |",
      "",
      SHARED_MARKERS.end,
    ].join("\n");
    const preExistingCatalog =
      compressedCatalog + "\n\n" + resourceNinjaCatalog;
    fs.writeFileSync(catalogAbsPath, preExistingCatalog);

    const siblingBeacon = {
      extensionId: "yamapan.agent-resources-ninja",
      version: "0.2.11",
      kinds: [
        "skill",
        "agent",
        "instruction",
        "prompt",
        "hook",
        "mcp",
        "plugin",
        "cursor-rule",
      ],
      capabilities: ["owner-handoff-v3"],
      protocolVersion: 3,
      updatedAt: new Date().toISOString(),
    };
    const stub = makeVscodeStub({
      workspaceUri: wsUri,
      settings: {
        "skillNinja.outputFormat": "ref",
        "skillNinja.refCatalogPath": catalogRelPath,
        "skillNinja.coexistenceMode": "auto",
      },
      siblingExports: { getAgentNinjaBeacon: () => siblingBeacon },
    });
    const skills = [makeSampleSkill("sample-alpha", "First")];
    const { instructionManager } = loadInstructionManager(stub, skills);
    const ctx = makeContext();
    const root = makeRoot(wsUri);

    await instructionManager.updateInstructionFileForRoot(root, ctx);

    const catalogAfter = fs.readFileSync(catalogAbsPath, "utf8");
    assert.ok(
      !catalogAfter.includes(SHARED_MARKERS.start),
      "catalog should not contain agent-ninja-START after defer cleanup",
    );
    assert.ok(
      !catalogAfter.includes(SHARED_MARKERS.end),
      "catalog should not contain agent-ninja-END after defer cleanup",
    );
    assert.ok(
      catalogAfter.includes("resource-ninja-catalog: skill"),
      "Resources Ninja catalog block should remain intact",
    );
  } finally {
    cleanupTmp(tmp);
  }
});

test("Catalog cleanup: no-op when catalog has no agent-ninja block", async () => {
  const tmp = setupTmpFixture("A-skill-solo");
  try {
    const wsUri = makeUri(tmp);
    const catalogRelPath = ".github/skills/README.md";
    const catalogAbsPath = path.join(tmp, catalogRelPath);

    fs.mkdirSync(path.dirname(catalogAbsPath), { recursive: true });
    const cleanCatalog =
      "<!-- resource-ninja-catalog: skill -->\n# Agent Skills\n| Resource | Source |\n<!-- /resource-ninja-catalog: skill -->\n";
    fs.writeFileSync(catalogAbsPath, cleanCatalog);

    const siblingBeacon = {
      extensionId: "yamapan.agent-resources-ninja",
      version: "0.2.11",
      kinds: [
        "skill",
        "agent",
        "instruction",
        "prompt",
        "hook",
        "mcp",
        "plugin",
        "cursor-rule",
      ],
      capabilities: ["owner-handoff-v3"],
      protocolVersion: 3,
      updatedAt: new Date().toISOString(),
    };
    const stub = makeVscodeStub({
      workspaceUri: wsUri,
      settings: {
        "skillNinja.outputFormat": "ref",
        "skillNinja.refCatalogPath": catalogRelPath,
        "skillNinja.coexistenceMode": "auto",
      },
      siblingExports: { getAgentNinjaBeacon: () => siblingBeacon },
    });
    const skills = [makeSampleSkill("sample-alpha", "First")];
    const { instructionManager } = loadInstructionManager(stub, skills);
    const ctx = makeContext();
    const root = makeRoot(wsUri);

    await instructionManager.updateInstructionFileForRoot(root, ctx);

    const catalogAfter = fs.readFileSync(catalogAbsPath, "utf8");
    assert.strictEqual(
      catalogAfter,
      cleanCatalog,
      "catalog without agent-ninja block should be untouched",
    );
  } finally {
    cleanupTmp(tmp);
  }
});
run();
