#!/usr/bin/env node
/**
 * Embedded skill tree identity test: nested skill rows expand under their parent
 * and getParent (used by reveal) returns the same chain the tree shows.
 * Run: node scripts/test-embedded-tree-provider.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");
const { loadSrcModule } = require("./load-src-module");

const sourcePath = path.join(__dirname, "..", "src", "treeProvider.ts");
const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

const vscodeStub = {
  TreeItem,
  EventEmitter: class {
    constructor() {
      this.event = () => undefined;
    }
    fire() {}
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class {},
  ThemeColor: class {},
  Uri: { file: (filePath) => ({ fsPath: filePath }) },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
  },
};

function makeRoot(scope, rootPath, label) {
  return {
    scope,
    label,
    rootPath,
    displayPath: rootPath,
    isManaged: true,
    isReadOnly: false,
  };
}

const userRoot = makeRoot(
  "userGlobal",
  path.join("C:", "Users", "tester", ".copilot", "skills"),
  "User / Global Skills",
);
const workspaceRoot = makeRoot(
  "workspace",
  path.join("C:", "repo", ".github", "skills"),
  "Workspace Skills",
);

function makeScanned(root, relativePath, embeddedParentPath) {
  const name = relativePath.split("/").at(-1);
  return {
    name,
    description: "demo",
    relativePath,
    displayPath: `${root.displayPath}/${relativePath}`,
    fullPath: path.join(root.rootPath, ...relativePath.split("/"), "SKILL.md"),
    isManaged: true,
    isReadOnly: false,
    isRegistered: true,
    registrationState: embeddedParentPath ? "registered" : "unregistered",
    registrationSource: "none",
    registrationReason: "test",
    metadataPath: "",
    metadataPresent: false,
    scope: root.scope,
    root,
    categories: [],
    embeddedParentPath,
  };
}

function scannedFor(root) {
  return [
    makeScanned(root, "pack"),
    makeScanned(root, "pack/assets/inner", "pack"),
    makeScanned(root, "pack/assets/inner/deep", "pack/assets/inner"),
    makeScanned(root, "plain"),
  ];
}

function loadModule() {
  const moduleExports = {};
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    Buffer,
    require(request) {
      if (request === "vscode") {
        return vscodeStub;
      }
      if (request === "./localSkillScanner") {
        return {
          scanVisibleSkills: async () => [
            ...scannedFor(userRoot),
            ...scannedFor(workspaceRoot),
          ],
        };
      }
      if (request === "./skillIndex") {
        return {
          getLocalizedDescription: (skill) => skill.description || "",
          loadSkillIndex: async () => ({ skills: [], sources: [] }),
        };
      }
      if (request === "./i18n") {
        return { isJapanese: () => false };
      }
      if (request === "./skillPreview") {
        return { getSkillId: (skill) => skill.name };
      }
      if (request === "./skillInstaller") {
        return { getInstalledSkillsWithMeta: async () => [] };
      }
      if (request === "./skillLocations") {
        return {
          getManagedSkillRoots: async () => [userRoot],
          normalizeFileSystemPath: (value) =>
            String(value).replace(/\\/g, "/").toLowerCase(),
        };
      }
      if (request === "./installedSkillIndex") {
        return { shouldCheckInstalledSkillAgainstIndex: () => false };
      }
      if (
        request === "./skillInvocation" ||
        request === "./skillListOptions" ||
        request === "./skillRootIds" ||
        request === "./embeddedSkills"
      ) {
        return loadSrcModule(request);
      }
      return require(request);
    },
  };
  vm.runInNewContext(transpiled.outputText, sandbox, { filename: sourcePath });
  return sandbox.module.exports;
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function assertNestedChain(provider, rootItem) {
  const top = await provider.getChildren(rootItem);
  assert.deepStrictEqual(
    top.map((item) => item.label),
    ["pack", "plain"],
  );
  const [pack, plain] = top;
  assert.strictEqual(pack.collapsibleState, 1);
  assert.strictEqual(plain.collapsibleState, 0);

  const [inner] = await provider.getChildren(pack);
  assert.strictEqual(inner.label, "inner");
  assert.strictEqual(inner.description, "assets/inner • 1 embedded");
  assert.strictEqual(inner.contextValue, "embeddedSkill");
  assert.strictEqual(inner.collapsibleState, 1);

  const [deep] = await provider.getChildren(inner);
  assert.strictEqual(deep.label, "deep");
  assert.strictEqual(deep.description, "deep");
  assert.strictEqual(deep.collapsibleState, 0);
  assert.deepStrictEqual(await provider.getChildren(deep), []);

  // reveal() walks getParent up to the root, so it must mirror getChildren
  assert.strictEqual(provider.getParent(deep).label, "inner");
  assert.strictEqual(provider.getParent(inner).label, "pack");
  assert.strictEqual(provider.getParent(pack).contextValue, rootItem.contextValue);
  assert.strictEqual(provider.getParent(plain).contextValue, rootItem.contextValue);
}

(async () => {
  const { UserGlobalSkillsProvider, WorkspaceSkillsProvider } = loadModule();

  await test("user/global tree nests embedded skills and getParent mirrors it", async () => {
    const provider = new UserGlobalSkillsProvider(undefined);
    const rootItems = await provider.getChildren();
    const userRootItem = rootItems.find((item) => item.skillRoot === userRoot);
    assert.ok(userRootItem, "user root row exists");
    await assertNestedChain(provider, userRootItem);
  });

  await test("workspace tree nests embedded skills and getParent mirrors it", async () => {
    const provider = new WorkspaceSkillsProvider({
      fsPath: path.join("C:", "repo"),
    });
    const [rootItem] = await provider.getChildren();
    assert.strictEqual(rootItem.skillRoot, workspaceRoot);
    await assertNestedChain(provider, rootItem);
  });

  console.log("RESULT=PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
