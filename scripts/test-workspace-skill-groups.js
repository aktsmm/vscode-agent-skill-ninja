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

function loadTreeProviderExports(japanese = false) {
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
          isJapanese: () => japanese,
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
      if (request === "./installedSkillIndex") {
        return {
          shouldCheckInstalledSkillAgainstIndex(meta) {
            return (
              !!(meta.source && meta.source !== "local") || !!meta.remotePath
            );
          },
        };
      }
      return require(request);
    },
  };

  vm.runInNewContext(transpiled.outputText, sandbox, {
    filename: sourcePath,
  });

  return sandbox.module.exports;
}

const englishExports = loadTreeProviderExports(false);
const japaneseExports = loadTreeProviderExports(true);

const {
  buildExtensionProviderGroups,
  buildBuiltInProviderGroups,
  buildSkillRootGroups,
  getSkillRootGroupContextValue,
  getBuiltInProviderLabel,
  getBuiltInVariantLabel,
  getExtensionProviderLabel,
  getExtensionVariantLabel,
  getSkillRootGroupLabel,
  getSkillRootGroupDescription,
  getSkillRootFromTreeItem,
  getManagedSkillTreeItemLabel,
  getManagedSkillTreeItemDescription,
  setViewRegistrationContext,
} = englishExports;

const {
  getSkillRootGroupLabel: getSkillRootGroupLabelJa,
  getSkillRootGroupDescription: getSkillRootGroupDescriptionJa,
  getManagedSkillTreeItemDescription: getManagedSkillTreeItemDescriptionJa,
} = japaneseExports;

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
        createSkill(
          "gamma",
          "userGlobal",
          "C:/Users/test/.copilot/skills",
          "gamma",
        ),
        createSkill(
          "beta",
          "workspace",
          "D:/repo/.github/skills",
          "nested/beta",
        ),
        createSkill("alpha", "workspace", "D:/repo/.github/skills", "alpha"),
        createSkill(
          "delta",
          "userGlobal",
          "C:/Users/test/.claude/skills",
          "delta",
        ),
        createSkill(
          "epsilon",
          "builtIn",
          "C:/VSCode/resources/app/skills",
          "epsilon",
        ),
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

test("root group context only exposes reinstall for remote-backed managed roots", () => {
  const workspaceRoot = createSkill(
    "remote-alpha",
    "workspace",
    "D:/repo/.github/skills",
    "remote-alpha",
  ).root;

  assert.strictEqual(
    getSkillRootGroupContextValue(workspaceRoot, [
      { source: "local", remotePath: undefined },
    ]),
    "skillRootGroup",
  );

  assert.strictEqual(
    getSkillRootGroupContextValue(workspaceRoot, [
      { source: "sample-source", remotePath: "skills/remote-alpha" },
    ]),
    "skillRootGroupReinstallable",
  );

  assert.strictEqual(
    getSkillRootGroupContextValue(workspaceRoot, [
      { source: "local", remotePath: "skills/remote-alpha" },
    ]),
    "skillRootGroupReinstallable",
  );
});

test("resolves skill roots from root group items without a skill payload", () => {
  const root = createSkill(
    "remote-alpha",
    "workspace",
    "D:/repo/.github/skills",
    "remote-alpha",
  ).root;

  assert.strictEqual(getSkillRootFromTreeItem({ skillRoot: root }), root);
});

test("prefers embedded skill roots for skill items", () => {
  const itemRoot = createSkill(
    "remote-alpha",
    "workspace",
    "D:/repo/.github/skills",
    "remote-alpha",
  ).root;
  const embeddedRoot = createSkill(
    "remote-alpha",
    "userGlobal",
    "C:/Users/test/.copilot/skills",
    "remote-alpha",
  ).root;

  assert.strictEqual(
    getSkillRootFromTreeItem({
      skill: { root: embeddedRoot },
      skillRoot: itemRoot,
    }),
    embeddedRoot,
  );
});

test("returns undefined when no tree item is available", () => {
  assert.strictEqual(getSkillRootFromTreeItem(undefined), undefined);
});

console.log("\nWorkspace skill grouping tests passed.");

test("uses concise friendly labels for user/global roots", () => {
  assert.strictEqual(
    getSkillRootGroupLabel(
      createSkill(
        "gamma",
        "userGlobal",
        "C:/Users/test/.copilot/skills",
        "gamma",
      ).root,
    ),
    "GitHub Copilot Home",
  );

  assert.strictEqual(
    getSkillRootGroupLabel(
      createSkill(
        "delta",
        "userGlobal",
        "C:/Users/test/AppData/Roaming/Code/User/prompts/skills",
        "delta",
      ).root,
    ),
    "VS Code User Customizations",
  );

  assert.strictEqual(
    getBuiltInProviderLabel(
      createSkill(
        "epsilon",
        "builtIn",
        "C:/Users/test/.vscode/extensions/github.copilot-chat-1.0.0/assets/prompts/skills",
        "epsilon",
      ).root,
    ),
    "GitHub Copilot Chat",
  );

  assert.strictEqual(
    getSkillRootGroupLabel(
      createSkill(
        "epsilon",
        "builtIn",
        "C:/Users/test/.vscode/extensions/github.copilot-chat-1.0.0/assets/prompts/skills",
        "epsilon",
      ).root,
    ),
    "Prompts",
  );

  assert.strictEqual(
    getSkillRootGroupLabel(
      createSkill(
        "zeta",
        "builtIn",
        "C:/Users/test/.copilot/pkg/universal/1.0.44-2/builtin-skills",
        "customize-cloud-agent",
      ).root,
    ),
    "Package (Universal)",
  );

  assert.strictEqual(
    getSkillRootGroupLabel(
      createSkill(
        "builtin-core",
        "builtIn",
        "C:/Users/test/AppData/Local/Programs/Microsoft VS Code/resources/app/node_modules/@github/copilot/builtin-skills",
        "builtin-core",
      ).root,
    ),
    "Built-in Skills",
  );
});

test("groups built-in roots by provider before variant", () => {
  const providerGroups = JSON.parse(
    JSON.stringify(
      buildBuiltInProviderGroups([
        createSkill(
          "chat-prompt-skill",
          "builtIn",
          "C:/Users/test/.vscode/extensions/github.copilot-chat-1.0.0/assets/prompts/skills",
          "chat-prompt-skill",
        ),
        createSkill(
          "chat-core-skill",
          "builtIn",
          "C:/Users/test/.vscode/extensions/github.copilot-chat-1.0.0/skills",
          "chat-core-skill",
        ),
        createSkill(
          "cli-skill",
          "builtIn",
          "C:/Users/test/.copilot/pkg/universal/1.0.44-2/builtin-skills",
          "cli-skill",
        ),
        createSkill(
          "session-skill",
          "builtIn",
          "C:/Users/test/AppData/Local/Programs/Microsoft VS Code/resources/app/out/vs/sessions/skills",
          "session-skill",
        ),
      ]),
    ),
  );

  assert.deepStrictEqual(
    providerGroups.map((group) => ({
      label: group.label,
      skillCount: group.skillCount,
      rootLabels: group.roots.map((rootGroup) =>
        getBuiltInVariantLabel(rootGroup.root),
      ),
    })),
    [
      {
        label: "GitHub Copilot Chat",
        skillCount: 2,
        rootLabels: ["Prompts", "Skills"],
      },
      {
        label: "GitHub Copilot CLI",
        skillCount: 1,
        rootLabels: ["Package (Universal)"],
      },
      {
        label: "VS Code",
        skillCount: 1,
        rootLabels: ["Session Skills"],
      },
    ],
  );
});

test("groups installed extension roots by extension before variant", () => {
  const extensionPromptSkill = createSkill(
    "azure-prompts",
    "extension",
    "C:/Users/test/.vscode/extensions/ms-azuretools.vscode-azure-github-copilot/resources/prompts/skills",
    "azure-prompts",
  );
  extensionPromptSkill.root.extensionId =
    "ms-azuretools.vscode-azure-github-copilot";
  extensionPromptSkill.root.extensionDisplayName = "GitHub Copilot for Azure";

  const extensionSkill = createSkill(
    "azure-skills",
    "extension",
    "C:/Users/test/.vscode/extensions/ms-azuretools.vscode-azure-github-copilot/resources/skills",
    "azure-skills",
  );
  extensionSkill.root.extensionId = "ms-azuretools.vscode-azure-github-copilot";
  extensionSkill.root.extensionDisplayName = "GitHub Copilot for Azure";

  const providerGroups = JSON.parse(
    JSON.stringify(
      buildExtensionProviderGroups([extensionPromptSkill, extensionSkill]),
    ),
  );

  assert.deepStrictEqual(
    providerGroups.map((group) => ({
      label: group.label,
      skillCount: group.skillCount,
      rootLabels: group.roots.map((rootGroup) =>
        getExtensionVariantLabel(rootGroup.root),
      ),
    })),
    [
      {
        label: "GitHub Copilot for Azure",
        skillCount: 2,
        rootLabels: ["Prompts", "Skills"],
      },
    ],
  );

  assert.strictEqual(
    getExtensionProviderLabel(extensionPromptSkill.root),
    "GitHub Copilot for Azure",
  );
});

test("keeps root descriptions path-aware without using the path as the label", () => {
  assert.strictEqual(
    getSkillRootGroupDescription(
      createSkill(
        "gamma",
        "userGlobal",
        "C:/Users/test/.copilot/skills",
        "gamma",
      ).root,
      3,
    ),
    "3 skills • C:/Users/test/.copilot/skills",
  );
});

test("uses clean skill labels and keeps registration state in description", () => {
  setViewRegistrationContext({ initialSyncPending: false });
  const registeredSkill = createSkill(
    "User Evidence Agent",
    "userGlobal",
    "C:/Users/test/.copilot/skills",
    "agents/user-evidence",
  );
  const unregisteredSkill = {
    ...createSkill(
      "Custom Skill",
      "userGlobal",
      "C:/Users/test/.copilot/skills",
      "instructions/custom-skill",
    ),
    isRegistered: false,
  };

  assert.strictEqual(
    getManagedSkillTreeItemLabel(
      registeredSkill,
      new Set(["User Evidence Agent"]),
    ),
    "🆕 User Evidence Agent",
  );
  assert.strictEqual(
    getManagedSkillTreeItemDescription(registeredSkill),
    "agents/user-evidence",
  );
  assert.strictEqual(
    getManagedSkillTreeItemDescription(unregisteredSkill),
    "instructions/custom-skill • Not registered",
  );
});

test("shows pending description while initial sync is unresolved", () => {
  setViewRegistrationContext({ initialSyncPending: true });

  const pendingSkill = {
    ...createSkill(
      "Custom Skill",
      "userGlobal",
      "C:/Users/test/.copilot/skills",
      "instructions/custom-skill",
    ),
    isRegistered: false,
    registrationState: "unregistered",
  };

  assert.strictEqual(
    getManagedSkillTreeItemDescription(pendingSkill),
    "instructions/custom-skill • Resolving",
  );

  setViewRegistrationContext({ initialSyncPending: false });
});

test("localizes root labels and descriptions for Japanese UI", () => {
  assert.strictEqual(
    getSkillRootGroupLabelJa(
      createSkill("gamma", "workspace", "D:/repo/.github/skills", "gamma").root,
    ),
    "ワークスペース スキル",
  );

  assert.strictEqual(
    getSkillRootGroupLabelJa(
      createSkill(
        "delta",
        "userGlobal",
        "C:/Users/test/.copilot/skills",
        "delta",
      ).root,
    ),
    "GitHub Copilot ホーム",
  );

  assert.strictEqual(
    getSkillRootGroupLabelJa(
      createSkill(
        "epsilon",
        "userGlobal",
        "C:/Users/test/AppData/Roaming/Code/User/prompts/skills",
        "epsilon",
      ).root,
    ),
    "VS Code ユーザーカスタマイズ",
  );

  assert.strictEqual(
    getSkillRootGroupDescriptionJa(
      createSkill(
        "theta",
        "userGlobal",
        "C:/Users/test/.copilot/skills",
        "theta",
      ).root,
      2,
    ),
    "2 件のスキル • C:/Users/test/.copilot/skills",
  );

  assert.strictEqual(
    getManagedSkillTreeItemDescriptionJa({
      ...createSkill(
        "Custom Skill",
        "userGlobal",
        "C:/Users/test/.copilot/skills",
        "instructions/custom-skill",
      ),
      isRegistered: false,
    }),
    "instructions/custom-skill • 未登録",
  );
});
