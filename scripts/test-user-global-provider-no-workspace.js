#!/usr/bin/env node

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

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class EventEmitter {
  constructor() {
    this.event = () => undefined;
  }
  fire() {}
}

const vscodeStub = {
  TreeItem,
  EventEmitter,
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  },
  ThemeIcon: class ThemeIcon {
    constructor(id, color) {
      this.id = id;
      this.color = color;
    }
  },
  ThemeColor: class ThemeColor {
    constructor(id) {
      this.id = id;
    }
  },
  Uri: {
    file(filePath) {
      return { fsPath: filePath };
    },
  },
};

const userRoot = {
  scope: "userGlobal",
  label: "User / Global Skills",
  rootPath: path.join("C:", "Users", "tester", ".copilot", "skills"),
  displayPath: "~/.copilot/skills",
  isManaged: true,
  isReadOnly: false,
};

const extensionRoot = {
  scope: "extension",
  label: "Installed Extensions",
  rootPath: path.join(
    "C:",
    "Users",
    "tester",
    ".vscode",
    "extensions",
    "sample-ext",
    "skills",
  ),
  displayPath: "~/.vscode/extensions/sample-ext/skills",
  isManaged: false,
  isReadOnly: true,
  extensionId: "sample.publisher",
  extensionDisplayName: "Sample Skill Extension",
};

const builtInRoot = {
  scope: "builtIn",
  label: "Built-in Skills",
  rootPath: path.join(
    "C:",
    "VSCode",
    "extensions",
    "copilot",
    "assets",
    "prompts",
    "skills",
  ),
  displayPath: "C:/VSCode/extensions/copilot/assets/prompts/skills",
  isManaged: false,
  isReadOnly: true,
};

let capturedWorkspaceUri = "not-called";

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
          scanVisibleSkills: async (workspaceUri) => {
            capturedWorkspaceUri = workspaceUri;
            return [
              {
                name: "global-skill",
                description: "Global skill",
                relativePath: "global-skill/SKILL.md",
                displayPath: "~/.copilot/skills/global-skill/SKILL.md",
                fullPath: path.join(
                  userRoot.rootPath,
                  "global-skill",
                  "SKILL.md",
                ),
                isManaged: true,
                isReadOnly: false,
                isRegistered: true,
                registrationState: "registered",
                registrationSource: "metadata",
                registrationReason: "test",
                metadataPath: path.join(
                  userRoot.rootPath,
                  "global-skill",
                  ".skill-meta.json",
                ),
                metadataPresent: true,
                scope: "userGlobal",
                root: userRoot,
                categories: [],
              },
              {
                name: "extension-skill",
                description: "Extension skill",
                relativePath: "extension-skill/SKILL.md",
                displayPath:
                  "~/.vscode/extensions/sample-ext/skills/extension-skill/SKILL.md",
                fullPath: path.join(
                  extensionRoot.rootPath,
                  "extension-skill",
                  "SKILL.md",
                ),
                isManaged: false,
                isReadOnly: true,
                isRegistered: false,
                registrationState: "registered",
                registrationSource: "none",
                registrationReason: "read-only",
                metadataPath: path.join(
                  extensionRoot.rootPath,
                  "extension-skill",
                  ".skill-meta.json",
                ),
                metadataPresent: false,
                scope: "extension",
                root: extensionRoot,
                categories: [],
              },
              {
                name: "built-in-skill",
                description: "Built-in skill",
                relativePath: "built-in-skill/SKILL.md",
                displayPath:
                  "C:/VSCode/extensions/copilot/assets/prompts/skills/built-in-skill/SKILL.md",
                fullPath: path.join(
                  builtInRoot.rootPath,
                  "built-in-skill",
                  "SKILL.md",
                ),
                isManaged: false,
                isReadOnly: true,
                isRegistered: false,
                registrationState: "registered",
                registrationSource: "none",
                registrationReason: "read-only",
                metadataPath: path.join(
                  builtInRoot.rootPath,
                  "built-in-skill",
                  ".skill-meta.json",
                ),
                metadataPresent: false,
                scope: "builtIn",
                root: builtInRoot,
                categories: [],
              },
            ];
          },
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
      return require(request);
    },
  };

  vm.runInNewContext(transpiled.outputText, sandbox, {
    filename: sourcePath,
  });

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

(async () => {
  const { UserGlobalSkillsProvider } = loadModule();

  await test("user/global provider scans without an open workspace", async () => {
    const provider = new UserGlobalSkillsProvider(undefined);
    const rootItems = await provider.getChildren();

    assert.strictEqual(capturedWorkspaceUri, undefined);
    assert.strictEqual(rootItems.length, 3);
    assert.strictEqual(rootItems[0].label, "GitHub Copilot Home");
    assert.strictEqual(
      rootItems[0].description,
      "1 skills • ~/.copilot/skills",
    );

    const skillItems = await provider.getChildren(rootItems[0]);
    assert.strictEqual(skillItems.length, 1);
    assert.strictEqual(skillItems[0].label, "global-skill");

    assert.strictEqual(rootItems[1].label, "Installed Extensions");
    const extensionProviders = await provider.getChildren(rootItems[1]);
    assert.strictEqual(extensionProviders.length, 1);
    assert.strictEqual(extensionProviders[0].label, "Sample Skill Extension");
    const extensionRoots = await provider.getChildren(extensionProviders[0]);
    assert.strictEqual(extensionRoots.length, 1);
    const extensionSkills = await provider.getChildren(extensionRoots[0]);
    assert.strictEqual(extensionSkills.length, 1);
    assert.strictEqual(extensionSkills[0].label, "extension-skill");

    assert.strictEqual(rootItems[2].label, "Built-in Skills");
    const builtInProviders = await provider.getChildren(rootItems[2]);
    assert.strictEqual(builtInProviders.length, 1);
    assert.strictEqual(builtInProviders[0].label, "GitHub Copilot");
    const builtInRoots = await provider.getChildren(builtInProviders[0]);
    assert.strictEqual(builtInRoots.length, 1);
    const builtInSkills = await provider.getChildren(builtInRoots[0]);
    assert.strictEqual(builtInSkills.length, 1);
    assert.strictEqual(builtInSkills[0].label, "built-in-skill");
  });

  await test("user/global provider can retarget workspace after activation", async () => {
    const provider = new UserGlobalSkillsProvider(undefined);
    const workspaceUri = { fsPath: path.join("C:", "repo") };

    provider.setWorkspaceUri(workspaceUri);
    await provider.getChildren();

    assert.strictEqual(capturedWorkspaceUri, workspaceUri);
  });

  console.log("RESULT=PASS");
})();
