/**
 * Skill location resolver regression tests.
 * Run after compile: node scripts/test-skill-locations.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const vscodeStub = {
  FileType: {
    Unknown: 0,
    File: 1,
    Directory: 2,
  },
  __configBySection: {},
  Uri: {
    file(filePath) {
      return {
        fsPath: path.resolve(filePath),
        path: path.resolve(filePath).replace(/\\/g, "/"),
      };
    },
    parse(value) {
      const url = new URL(value);
      return {
        fsPath: url.pathname.replace(/^\//, ""),
        path: url.pathname,
      };
    },
    joinPath(base, ...parts) {
      const fsPath = path.join(base.fsPath, ...parts);
      return {
        fsPath,
        path: fsPath.replace(/\\/g, "/"),
      };
    },
  },
  workspace: {
    getConfiguration(section) {
      return {
        get(key) {
          const sectionValues = section
            ? vscodeStub.__configBySection[section] || {}
            : vscodeStub.__configBySection.__root || {};
          return sectionValues[key];
        },
      };
    },
    fs: {
      stat(target) {
        return fs.statSync(target.fsPath);
      },
      readDirectory(target) {
        return fs
          .readdirSync(target.fsPath, { withFileTypes: true })
          .map((entry) => [
            entry.name,
            entry.isDirectory()
              ? vscodeStub.FileType.Directory
              : vscodeStub.FileType.File,
          ]);
      },
    },
  },
  extensions: {
    all: [],
    getExtension() {
      return undefined;
    },
  },
  env: {
    appRoot: path.join(__dirname, "..", "fake-app-root"),
  },
};

function loadTranspiledModule(sourcePath, extraModules = {}, options = {}) {
  const source = fs.readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
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
    fetch: options.fetch || (async () => ({ ok: false })),
    require(request) {
      if (request === "vscode") {
        return vscodeStub;
      }
      if (request in extraModules) {
        return extraModules[request];
      }
      if (`${request}.ts` in extraModules) {
        return extraModules[`${request}.ts`];
      }
      if (request.includes("shared-sources-manifest-store")) {
        return extraModules["./shared-sources-manifest-store"];
      }
      return require(request);
    },
  };

  vm.runInNewContext(transpiled.outputText, sandbox, {
    filename: sourcePath,
  });

  return sandbox.module.exports;
}

const skillLocationsPath = path.join(
  __dirname,
  "..",
  "src",
  "skillLocations.ts",
);
const skillIndexPath = path.join(__dirname, "..", "src", "skillIndex.ts");

const skillLocationsExports = loadTranspiledModule(skillLocationsPath, {
  "./toolDetector": {
    resolveOutputFormat: async () => ({
      format: "full",
      instructionFile: "AGENTS.md",
    }),
  },
});

const skillIndexExports = loadTranspiledModule(skillIndexPath, {
  "./githubFetch": {
    createGitHubHeaders: () => ({}),
    fetchGitHubWithOptionalAuthRetry: async () => ({ ok: false }),
  },
  "./shared-sources-manifest-store": {
    applySharedSourcesManifestToSkillIndex: (index) => index,
    bootstrapSharedSourcesManifest: async () => undefined,
    readSharedSourcesManifest: async () => undefined,
    syncSharedSourcesManifestFromSources: async () => undefined,
  },
});

const {
  compareVersionStrings,
  computeRelativeDirectoryPath,
  getBuiltInCandidatePaths,
  getBuiltInSkillRoots,
  getDefaultUserGlobalSkillLocationPaths,
  getExtensionSkillRoots,
  getPackagedBuiltInSkillLocationPaths,
  parseAgentSkillLocationConfig,
  pathToDisplayPath,
  resolveConfiguredPath,
  resolveUserGlobalInstructionPath,
  resolveWorkspaceSkillsDirectory,
  resolveWorkspaceSkillsRootUri,
  DEFAULT_WORKSPACE_SKILLS_DIRECTORY,
} = skillLocationsExports;

const {
  buildGitHubContentUrl,
  cacheResolvedBranch,
  clearResolvedBranchCache,
  getDefaultBranch,
  getSkillGitHubUrl,
  getSkillGitHubUrlAsync,
} = skillIndexExports;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function makeConfigStub(values) {
  return {
    get(key) {
      return values[key];
    },
  };
}

(async () => {
  await test("parses string and object agent skill location entries", () => {
    const parsed = JSON.parse(
      JSON.stringify(
        parseAgentSkillLocationConfig([
          "~/.copilot/skills",
          { path: "./.github/skills", enabled: true },
          { path: "./disabled", enabled: false },
        ]),
      ),
    );

    assert.deepStrictEqual(parsed, [
      { path: "~/.copilot/skills", enabled: true },
      { path: "./.github/skills", enabled: true },
      { path: "./disabled", enabled: false },
    ]);
  });

  await test("parses object-shaped agent skill location maps", () => {
    const parsed = JSON.parse(
      JSON.stringify(
        parseAgentSkillLocationConfig({
          "~/.copilot/skills": true,
          "~/.claude/skills": { enabled: true },
          "~/.ignored/skills": false,
        }),
      ),
    );

    assert.deepStrictEqual(parsed, [
      { path: "~/.copilot/skills", enabled: true },
      { path: "~/.claude/skills", enabled: true },
    ]);
  });

  await test("resolves home-relative and workspace-relative skill locations", () => {
    const workspacePath = path.resolve(path.sep, "workspace", "project");

    assert.strictEqual(
      resolveConfiguredPath(
        "~/.copilot/skills",
        workspacePath,
        path.join(path.sep, "home", "tester"),
      ),
      path.normalize(
        path.join(path.sep, "home", "tester", ".copilot", "skills"),
      ),
    );
    assert.strictEqual(
      resolveConfiguredPath(
        ".github/skills",
        workspacePath,
        path.join(path.sep, "home", "tester"),
      ),
      path.resolve(workspacePath, ".github", "skills"),
    );
  });

  await test("resolves user-home and environment-variable skill locations", () => {
    const workspacePath = path.resolve(path.sep, "workspace", "project");
    const originalAppData = process.env.APPDATA;
    process.env.APPDATA = path.join(
      path.sep,
      "Users",
      "tester",
      "AppData",
      "Roaming",
    );

    try {
      assert.strictEqual(
        resolveConfiguredPath(
          "${userHome}/.copilot/skills",
          workspacePath,
          path.join(path.sep, "Users", "tester"),
        ),
        path.normalize(
          path.join(path.sep, "Users", "tester", ".copilot", "skills"),
        ),
      );

      assert.strictEqual(
        resolveConfiguredPath(
          "%APPDATA%/Code/User/prompts/skills",
          workspacePath,
          path.join(path.sep, "Users", "tester"),
        ),
        path.normalize(
          path.join(
            path.sep,
            "Users",
            "tester",
            "AppData",
            "Roaming",
            "Code",
            "User",
            "prompts",
            "skills",
          ),
        ),
      );

      assert.strictEqual(
        resolveConfiguredPath(
          "${env:APPDATA}/Code/User/prompts/skills",
          workspacePath,
          path.join(path.sep, "Users", "tester"),
        ),
        path.normalize(
          path.join(
            path.sep,
            "Users",
            "tester",
            "AppData",
            "Roaming",
            "Code",
            "User",
            "prompts",
            "skills",
          ),
        ),
      );
    } finally {
      process.env.APPDATA = originalAppData;
    }
  });

  await test("computes instruction-relative links to skill roots", () => {
    assert.strictEqual(
      computeRelativeDirectoryPath(
        "/home/tester/.copilot/instructions.md",
        "/home/tester/.copilot/skills",
      ),
      "skills",
    );
    assert.strictEqual(
      computeRelativeDirectoryPath(
        "/workspace/project/.github/instructions/skills.md",
        "/workspace/project/.github/skills",
      ),
      "../skills",
    );
  });

  await test("chooses tool-compatible user/global instruction files", () => {
    assert.strictEqual(
      resolveUserGlobalInstructionPath(
        path.normalize("/home/tester/.copilot/skills"),
      ),
      path.normalize("/home/tester/.copilot/instructions.md"),
    );
    assert.strictEqual(
      resolveUserGlobalInstructionPath(
        path.normalize("/home/tester/.claude/skills"),
      ),
      path.normalize("/home/tester/.claude/CLAUDE.md"),
    );
    assert.strictEqual(
      resolveUserGlobalInstructionPath(
        path.normalize("/home/tester/.agents/skills"),
      ),
      path.normalize("/home/tester/.agents/AGENTS.md"),
    );
  });

  await test("renders home-relative display paths with a tilde prefix", () => {
    assert.strictEqual(
      pathToDisplayPath("/home/tester/.copilot/skills", "/home/tester"),
      "~/.copilot/skills",
    );
  });

  await test("returns default personal skill roots", () => {
    const paths = JSON.parse(
      JSON.stringify(
        getDefaultUserGlobalSkillLocationPaths(
          path.join(path.sep, "home", "tester"),
        ),
      ),
    );

    assert.deepStrictEqual(paths, [
      path.join(path.sep, "home", "tester", ".copilot", "skills"),
      path.join(path.sep, "home", "tester", ".claude", "skills"),
      path.join(path.sep, "home", "tester", ".agents", "skills"),
    ]);
  });

  await test("resolveWorkspaceSkillsDirectory: own value wins when set explicitly", () => {
    const own = makeConfigStub({ skillsDirectory: "custom/skills" });
    const sibling = makeConfigStub({ resourcesDirectory: "should/be/ignored" });
    assert.strictEqual(
      resolveWorkspaceSkillsDirectory(own, sibling),
      "custom/skills",
    );
  });

  await test("resolveWorkspaceSkillsDirectory: falls back to resourceNinja when own is default", () => {
    const own = makeConfigStub({
      skillsDirectory: DEFAULT_WORKSPACE_SKILLS_DIRECTORY,
    });
    const sibling = makeConfigStub({ resourcesDirectory: "shared/path" });
    assert.strictEqual(
      resolveWorkspaceSkillsDirectory(own, sibling),
      "shared/path",
    );
  });

  await test("resolveWorkspaceSkillsDirectory: returns default when neither is set", () => {
    const own = makeConfigStub({});
    const sibling = makeConfigStub({});
    assert.strictEqual(
      resolveWorkspaceSkillsDirectory(own, sibling),
      DEFAULT_WORKSPACE_SKILLS_DIRECTORY,
    );
  });

  await test("resolveWorkspaceSkillsDirectory: ignores empty/whitespace overrides", () => {
    const own = makeConfigStub({ skillsDirectory: "   " });
    const sibling = makeConfigStub({ resourcesDirectory: "" });
    assert.strictEqual(
      resolveWorkspaceSkillsDirectory(own, sibling),
      DEFAULT_WORKSPACE_SKILLS_DIRECTORY,
    );
  });

  await test("resolveWorkspaceSkillsRootUri: keeps relative workspace paths under workspace", () => {
    const workspaceUri = vscodeStub.Uri.file(
      path.join(path.sep, "workspace", "repo"),
    );
    const own = makeConfigStub({ skillsDirectory: "custom/skills" });
    const resolved = resolveWorkspaceSkillsRootUri(workspaceUri, own);

    assert.strictEqual(
      resolved.fsPath,
      path.join(workspaceUri.fsPath, "custom", "skills"),
    );
  });

  await test("resolveWorkspaceSkillsRootUri: preserves absolute sibling overrides", () => {
    const workspaceUri = vscodeStub.Uri.file(
      path.join(path.sep, "workspace", "repo"),
    );
    const own = makeConfigStub({
      skillsDirectory: DEFAULT_WORKSPACE_SKILLS_DIRECTORY,
    });
    const siblingAbsolutePath = path.join(
      os.tmpdir(),
      "agent-ninja-shared-skills",
    );
    const sibling = makeConfigStub({
      resourcesDirectory: siblingAbsolutePath,
    });
    const resolved = resolveWorkspaceSkillsRootUri(workspaceUri, own, sibling);

    assert.strictEqual(resolved.fsPath, path.resolve(siblingAbsolutePath));
  });

  await test("builds built-in candidate paths for bundled and session skills", () => {
    const candidates = JSON.parse(
      JSON.stringify(
        getBuiltInCandidatePaths(path.join(path.sep, "app"), [
          path.join(path.sep, "extension", "copilot"),
        ]),
      ),
    );

    assert(
      candidates.includes(
        path.join(
          path.sep,
          "app",
          "extensions",
          "copilot",
          "assets",
          "prompts",
          "skills",
        ),
      ),
    );
    assert(
      candidates.includes(
        path.join(path.sep, "app", "out", "vs", "sessions", "skills"),
      ),
    );
    assert(
      candidates.includes(
        path.join(
          path.sep,
          "extension",
          "copilot",
          "assets",
          "prompts",
          "skills",
        ),
      ),
    );
  });

  await test("discovers packaged Copilot CLI builtin-skills roots", async () => {
    const tempHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "skill-ninja-home-"),
    );
    const builtinRoot = path.join(
      tempHome,
      ".copilot",
      "pkg",
      "universal",
      "1.0.44-2",
      "builtin-skills",
    );
    fs.mkdirSync(builtinRoot, { recursive: true });

    const roots = JSON.parse(
      JSON.stringify(await getPackagedBuiltInSkillLocationPaths(tempHome)),
    );

    assert.deepStrictEqual(roots, [path.normalize(builtinRoot)]);
  });

  await test("consolidates multiple versions per channel to latest only", async () => {
    const tempHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "skill-ninja-consolidate-"),
    );
    const versions = [
      "1.0.24",
      "1.0.26-0",
      "1.0.40",
      "1.0.42-0",
      "1.0.42",
      "1.0.44-2",
      "1.0.44",
    ];
    for (const v of versions) {
      fs.mkdirSync(
        path.join(
          tempHome,
          ".copilot",
          "pkg",
          "universal",
          v,
          "builtin-skills",
        ),
        { recursive: true },
      );
    }

    const roots = JSON.parse(
      JSON.stringify(await getPackagedBuiltInSkillLocationPaths(tempHome)),
    );

    // Should return only the latest version (1.0.44-2 > 1.0.44 > 1.0.42-0 > ...)
    assert.strictEqual(
      roots.length,
      1,
      `Expected 1 root, got ${roots.length}: ${JSON.stringify(roots)}`,
    );
    assert(
      roots[0].includes("1.0.44-2"),
      `Expected latest version 1.0.44-2, got: ${roots[0]}`,
    );
  });

  await test("keeps channel-level builtin-skills alongside consolidated versioned root", async () => {
    const tempHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "skill-ninja-channel-"),
    );
    // Channel-level (non-versioned)
    fs.mkdirSync(
      path.join(tempHome, ".copilot", "pkg", "universal", "builtin-skills"),
      { recursive: true },
    );
    // Versioned
    fs.mkdirSync(
      path.join(
        tempHome,
        ".copilot",
        "pkg",
        "universal",
        "1.0.40",
        "builtin-skills",
      ),
      { recursive: true },
    );
    fs.mkdirSync(
      path.join(
        tempHome,
        ".copilot",
        "pkg",
        "universal",
        "1.0.44",
        "builtin-skills",
      ),
      { recursive: true },
    );

    const roots = JSON.parse(
      JSON.stringify(await getPackagedBuiltInSkillLocationPaths(tempHome)),
    );

    // Channel-level + latest versioned = 2
    assert.strictEqual(
      roots.length,
      2,
      `Expected 2 roots, got ${roots.length}: ${JSON.stringify(roots)}`,
    );
  });

  await test("consolidates independently per channel", async () => {
    const tempHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "skill-ninja-multi-channel-"),
    );
    fs.mkdirSync(
      path.join(
        tempHome,
        ".copilot",
        "pkg",
        "universal",
        "1.0.24",
        "builtin-skills",
      ),
      { recursive: true },
    );
    fs.mkdirSync(
      path.join(
        tempHome,
        ".copilot",
        "pkg",
        "universal",
        "1.0.44",
        "builtin-skills",
      ),
      { recursive: true },
    );
    fs.mkdirSync(
      path.join(
        tempHome,
        ".copilot",
        "pkg",
        "preview",
        "2.0.1",
        "builtin-skills",
      ),
      { recursive: true },
    );
    fs.mkdirSync(
      path.join(
        tempHome,
        ".copilot",
        "pkg",
        "preview",
        "2.0.5",
        "builtin-skills",
      ),
      { recursive: true },
    );

    const roots = JSON.parse(
      JSON.stringify(await getPackagedBuiltInSkillLocationPaths(tempHome)),
    );

    // 1 per channel = 2
    assert.strictEqual(
      roots.length,
      2,
      `Expected 2 roots, got ${roots.length}: ${JSON.stringify(roots)}`,
    );
    const hasUniversalLatest = roots.some((r) => r.includes("1.0.44"));
    const hasPreviewLatest = roots.some((r) => r.includes("2.0.5"));
    assert(hasUniversalLatest, "Should include latest universal version");
    assert(hasPreviewLatest, "Should include latest preview version");
  });

  await test("compareVersionStrings sorts semver-like strings correctly", () => {
    assert(compareVersionStrings("1.0.44-2", "1.0.44") > 0);
    assert(compareVersionStrings("1.0.44", "1.0.42-0") > 0);
    assert(
      compareVersionStrings("1.0.42-0", "1.0.42") === 0,
      "trailing -0 is equal to no suffix",
    );
    assert(compareVersionStrings("1.0.42", "1.0.40") > 0);
    assert(compareVersionStrings("1.0.40", "1.0.26-0") > 0);
    assert(compareVersionStrings("1.0.24", "1.0.24") === 0);
    assert(compareVersionStrings("2.0.0", "1.99.99") > 0);
    assert(compareVersionStrings("1.0.44-2", "1.0.44-1") > 0);
  });

  await test("getBuiltInSkillRoots respects showBuiltInSkills gate", async () => {
    const tempHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "skill-ninja-gate-"),
    );
    const tempAppRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "skill-ninja-app-"),
    );
    const sessionRoot = path.join(
      tempAppRoot,
      "out",
      "vs",
      "sessions",
      "skills",
    );
    fs.mkdirSync(sessionRoot, { recursive: true });

    const originalUserProfile = process.env.USERPROFILE;
    const originalHome = process.env.HOME;
    const originalAppRoot = vscodeStub.env.appRoot;

    process.env.USERPROFILE = tempHome;
    process.env.HOME = tempHome;
    vscodeStub.env.appRoot = tempAppRoot;

    try {
      vscodeStub.__configBySection.skillNinja = { showBuiltInSkills: false };
      const hiddenRoots = await getBuiltInSkillRoots();
      assert.strictEqual(hiddenRoots.length, 0);

      vscodeStub.__configBySection.skillNinja = { showBuiltInSkills: true };
      const visibleRoots = await getBuiltInSkillRoots();
      assert(
        visibleRoots.some(
          (root) =>
            path.normalize(root.rootPath) === path.normalize(sessionRoot),
        ),
      );
    } finally {
      process.env.USERPROFILE = originalUserProfile;
      process.env.HOME = originalHome;
      vscodeStub.env.appRoot = originalAppRoot;
      vscodeStub.__configBySection.skillNinja = {};
    }
  });

  await test("getExtensionSkillRoots discovers installed extension skill folders and excludes Copilot built-ins", async () => {
    const tempExtensions = fs.mkdtempSync(
      path.join(os.tmpdir(), "skill-ninja-ext-roots-"),
    );
    const tempAppRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "skill-ninja-ext-app-"),
    );
    const azureExtensionRoot = path.join(
      tempExtensions,
      "ms-azuretools.vscode-azure-github-copilot-1.0.0",
    );
    const azureSkillsRoot = path.join(
      azureExtensionRoot,
      "resources",
      "prompts",
      "skills",
    );
    const copilotChatExtensionRoot = path.join(
      tempExtensions,
      "github.copilot-chat-1.0.0",
    );
    const copilotChatSkillsRoot = path.join(
      copilotChatExtensionRoot,
      "assets",
      "prompts",
      "skills",
    );
    const bundledExtensionRoot = path.join(
      tempAppRoot,
      "extensions",
      "ms-vscode.azure-account",
    );
    const bundledSkillsRoot = path.join(
      bundledExtensionRoot,
      "resources",
      "skills",
    );
    const ownExtensionRoot = path.join(
      tempExtensions,
      "yamapan.agent-skill-ninja-0.9.5",
    );
    const ownSkillsRoot = path.join(ownExtensionRoot, "resources", "skills");
    fs.mkdirSync(azureSkillsRoot, { recursive: true });
    fs.mkdirSync(copilotChatSkillsRoot, { recursive: true });
    fs.mkdirSync(bundledSkillsRoot, { recursive: true });
    fs.mkdirSync(ownSkillsRoot, { recursive: true });

    const originalExtensions = vscodeStub.extensions.all;
    const originalAppRoot = vscodeStub.env.appRoot;
    vscodeStub.env.appRoot = tempAppRoot;
    vscodeStub.extensions.all = [
      {
        id: "ms-azuretools.vscode-azure-github-copilot",
        extensionUri: vscodeStub.Uri.file(azureExtensionRoot),
        packageJSON: { displayName: "GitHub Copilot for Azure" },
      },
      {
        id: "github.copilot-chat",
        extensionUri: vscodeStub.Uri.file(copilotChatExtensionRoot),
        packageJSON: { displayName: "GitHub Copilot Chat" },
      },
      {
        id: "ms-vscode.azure-account",
        extensionUri: vscodeStub.Uri.file(bundledExtensionRoot),
        packageJSON: { displayName: "Azure Account" },
      },
      {
        id: "yamapan.agent-skill-ninja",
        extensionUri: vscodeStub.Uri.file(ownExtensionRoot),
        packageJSON: { displayName: "Agent Skills Ninja" },
      },
    ];

    try {
      const roots = JSON.parse(JSON.stringify(await getExtensionSkillRoots()));
      assert.strictEqual(roots.length, 1);
      assert.strictEqual(roots[0].scope, "extension");
      assert.strictEqual(roots[0].label, "Installed Extensions");
      assert.strictEqual(
        path.normalize(roots[0].rootPath),
        path.normalize(azureSkillsRoot),
      );
      assert.strictEqual(
        roots[0].extensionId,
        "ms-azuretools.vscode-azure-github-copilot",
      );
      assert.strictEqual(
        roots[0].extensionDisplayName,
        "GitHub Copilot for Azure",
      );
    } finally {
      vscodeStub.env.appRoot = originalAppRoot;
      vscodeStub.extensions.all = originalExtensions;
    }
  });

  await test("buildGitHubContentUrl chooses tree for directories and blob for markdown", () => {
    assert.strictEqual(
      buildGitHubContentUrl(
        "https://github.com/aktsmm/Agent-Skills",
        "master",
        "humanize-writing",
      ),
      "https://github.com/aktsmm/Agent-Skills/tree/master/humanize-writing",
    );

    assert.strictEqual(
      buildGitHubContentUrl(
        "https://github.com/aktsmm/Agent-Skills",
        "master",
        "humanize-writing/SKILL.md",
      ),
      "https://github.com/aktsmm/Agent-Skills/blob/master/humanize-writing/SKILL.md",
    );
  });

  await test("getSkillGitHubUrl preserves explicit skill.url", () => {
    clearResolvedBranchCache();
    const explicitUrl =
      "https://github.com/aktsmm/Agent-Skills/blob/master/humanize-writing/";

    const url = getSkillGitHubUrl(
      {
        name: "humanize-writing",
        source: "agent-skills",
        path: "humanize-writing",
        categories: [],
        description: "",
        url: explicitUrl,
      },
      [],
    );

    assert.strictEqual(url, explicitUrl);
  });

  await test("getSkillGitHubUrl uses cached or configured branch before main fallback", () => {
    clearResolvedBranchCache();
    const source = {
      id: "agent-skills",
      name: "Agent Skills",
      url: "https://github.com/aktsmm/Agent-Skills",
      type: "user-added",
      description: "",
    };
    const skill = {
      name: "humanize-writing",
      source: "agent-skills",
      path: "humanize-writing",
      categories: [],
      description: "",
    };

    cacheResolvedBranch(source.url, "master");
    assert.strictEqual(
      getSkillGitHubUrl(skill, [source]),
      "https://github.com/aktsmm/Agent-Skills/tree/master/humanize-writing",
    );

    clearResolvedBranchCache();
    assert.strictEqual(
      getSkillGitHubUrl({ ...skill }, [{ ...source, branch: "master" }]),
      "https://github.com/aktsmm/Agent-Skills/tree/master/humanize-writing",
    );
  });

  await test("getSkillGitHubUrlAsync honors source.branch and file paths", async () => {
    clearResolvedBranchCache();
    const url = await getSkillGitHubUrlAsync(
      {
        name: "humanize-writing",
        source: "agent-skills",
        path: "humanize-writing/SKILL.md",
        categories: [],
        description: "",
      },
      [
        {
          id: "agent-skills",
          name: "Agent Skills",
          url: "https://github.com/aktsmm/Agent-Skills.git",
          type: "user-added",
          branch: "master",
          description: "",
        },
      ],
    );

    assert.strictEqual(
      url,
      "https://github.com/aktsmm/Agent-Skills/blob/master/humanize-writing/SKILL.md",
    );
  });

  await test("getDefaultBranch normalizes .git suffix before probing raw URLs", async () => {
    const moduleWithFetchCapture = loadTranspiledModule(
      skillIndexPath,
      {
        "./githubFetch": {
          createGitHubHeaders: () => ({}),
          fetchGitHubWithOptionalAuthRetry: async () => ({ ok: false }),
        },
      },
      {
        fetch: async (url) => ({
          ok:
            url ===
            "https://raw.githubusercontent.com/aktsmm/Agent-Skills/master/humanize-writing/SKILL.md",
        }),
      },
    );

    const branch = await moduleWithFetchCapture.getDefaultBranch(
      "https://github.com/aktsmm/Agent-Skills.git",
      undefined,
      "humanize-writing/SKILL.md",
    );

    assert.strictEqual(branch, "master");
  });

  console.log("\nSkill location tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
