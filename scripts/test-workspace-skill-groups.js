/**
 * Workspace skill tree grouping regression tests.
 * Run after compile: node scripts/test-workspace-skill-groups.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "src", "treeProvider.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

const vscodeStub = {
  EventEmitter: class {
    event() {}
    fire() {}
  },
  TreeItem: class {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  },
  ThemeIcon: class {},
  ThemeColor: class {},
  Uri: {
    file(filePath) {
      return { fsPath: path.resolve(filePath) };
    },
  },
};

const moduleExports = {};
const sandbox = {
  exports: moduleExports,
  module: { exports: moduleExports },
  require(request) {
    if (request === "vscode") {
      return vscodeStub;
    }
    if (request === "./skillIndex") {
      return {
        loadSkillIndex: async () => undefined,
        getLocalizedDescription: () => "",
      };
    }
    if (request === "./skillInstaller") {
      return {
        getInstalledSkillsWithMeta: async () => [],
      };
    }
    if (request === "./localSkillScanner") {
      return {
        scanVisibleSkills: async () => [],
      };
    }
    if (request === "./i18n") {
      return {
        isJapanese: () => false,
      };
    }
    if (request === "./skillPreview") {
      return {
        getSkillId: () => "",
      };
    }
    if (request === "./skillLocations") {
      return {
        normalizeFileSystemPath(value) {
          return value.replace(/\\/g, "/").toLowerCase();
        },
      };
    }
    return require(request);
  },
};

vm.runInNewContext(transpiled.outputText, sandbox, {
  filename: sourcePath,
});

const { buildSkillRootGroups } = sandbox.module.exports;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function createSkill(name, scope, rootPath, relativePath) {
  return {
    name,
    description: "",
    relativePath,
    displayPath: `${rootPath}/${relativePath}`,
    fullPath: `${rootPath}/${relativePath}/SKILL.md`,
    isInstalled: true,
    isRegistered: true,
    isManaged: true,
    isReadOnly: scope === "builtIn",
    scope,
    root: {
      scope,
      label: scope,
      rootUri: { fsPath: rootPath },
      rootPath,
      displayPath: rootPath,
      isManaged: scope !== "builtIn",
      isReadOnly: scope === "builtIn",
    },
  };
}

test("groups skills by normalized root path", () => {
  const groups = JSON.parse(
    JSON.stringify(
      buildSkillRootGroups([
        createSkill("gamma", "userGlobal", "C:/Users/test/.copilot/skills", "gamma"),
        createSkill("beta", "workspace", "D:/repo/.github/skills", "nested/beta"),
        createSkill("alpha", "workspace", "D:/repo/.github/skills", "alpha"),
        createSkill("delta", "userGlobal", "C:/Users/test/.claude/skills", "delta"),
        createSkill("epsilon", "builtIn", "C:/VSCode/resources/app/skills", "epsilon"),
      ]),
    ),
  );

  assert.deepStrictEqual(
    groups.map((group) => group.root.rootPath),
    [
      "C:/Users/test/.claude/skills",
      "C:/Users/test/.copilot/skills",
      "C:/VSCode/resources/app/skills",
      "D:/repo/.github/skills",
    ],
  );
  assert.deepStrictEqual(
    groups[3].skills.map((skill) => skill.relativePath),
    ["alpha", "nested/beta"],
  );
  assert.deepStrictEqual(
    groups[2].skills.map((skill) => skill.name),
    ["epsilon"],
  );
});

console.log("\nWorkspace skill grouping tests passed.");