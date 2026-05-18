/**
 * package.json and README UX contract tests.
 * Run: node scripts/test-package-manifest.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const packageLock = require(path.join(root, "package-lock.json"));
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const readmeJa = fs.readFileSync(path.join(root, "README_ja.md"), "utf8");
const vscodeIgnore = fs.readFileSync(path.join(root, ".vscodeignore"), "utf8");
const gitIgnore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
const releaseInstructions = fs.readFileSync(
  path.join(root, ".github", "instructions", "release.instructions.md"),
  "utf8",
);
const mcpToolsSource = fs.readFileSync(
  path.join(root, "src", "mcpTools.ts"),
  "utf8",
);
const extensionSource = fs.readFileSync(
  path.join(root, "src", "extension.ts"),
  "utf8",
);
const toolDetectorSource = fs.readFileSync(
  path.join(root, "src", "toolDetector.ts"),
  "utf8",
);

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function getSettingOrder(settingKey) {
  return pkg.contributes.configuration.properties[settingKey]?.order;
}

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function getVscodeIgnoreEntries() {
  return vscodeIgnore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function getGitIgnoreEntries() {
  return gitIgnore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function globToRegExp(pattern) {
  const normalized = normalizePath(pattern).replace(/^\.?\//, "");
  let regex = "^";

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === "*" && next === "*") {
      regex += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      regex += "[^/]*";
      continue;
    }

    regex += escapeRegex(char);
  }

  if (normalized.endsWith("/")) {
    regex += ".*";
  }

  regex += "$";
  return new RegExp(regex);
}

function collectManifestAssetPaths() {
  const paths = new Set();

  if (typeof pkg.icon === "string") {
    paths.add(normalizePath(pkg.icon));
  }

  for (const container of pkg.contributes.viewsContainers?.activitybar || []) {
    if (typeof container.icon === "string") {
      paths.add(normalizePath(container.icon));
    }
  }

  for (const viewEntries of Object.values(pkg.contributes.views || {})) {
    for (const view of viewEntries) {
      if (typeof view.icon === "string" && !view.icon.startsWith("$(")) {
        paths.add(normalizePath(view.icon));
      }
    }
  }

  return [...paths];
}

function titleMenuCommandsFor(viewId) {
  return (pkg.contributes?.menus?.["view/title"] || [])
    .filter((item) => item.when === `view == ${viewId}`)
    .map((item) => item.command);
}

test("settings order matches the documented primary flow", () => {
  assert.deepStrictEqual(
    [
      "skillNinja.autoUpdateInstruction",
      "skillNinja.instructionFile",
      "skillNinja.customInstructionPath",
      "skillNinja.skillsDirectory",
      "skillNinja.useVsCodeAgentSkillLocations",
      "skillNinja.showBuiltInSkills",
      "skillNinja.outputFormat",
      "skillNinja.refCatalogPath",
      "skillNinja.refCatalogFormat",
      "skillNinja.language",
      "skillNinja.autoUpdateSkillsOnUpgrade",
      "skillNinja.githubToken",
      "skillNinja.singleClickInstall",
      "skillNinja.coexistenceMode",
      "skillNinja.useSharedSourcesManifest",
      "skillNinja.includeLocalSkills",
    ].map((key) => [key, getSettingOrder(key)]),
    [
      ["skillNinja.autoUpdateInstruction", 1],
      ["skillNinja.instructionFile", 2],
      ["skillNinja.customInstructionPath", 3],
      ["skillNinja.skillsDirectory", 4],
      ["skillNinja.useVsCodeAgentSkillLocations", 5],
      ["skillNinja.showBuiltInSkills", 6],
      ["skillNinja.outputFormat", 7],
      ["skillNinja.refCatalogPath", 8],
      ["skillNinja.refCatalogFormat", 9],
      ["skillNinja.language", 10],
      ["skillNinja.autoUpdateSkillsOnUpgrade", 11],
      ["skillNinja.githubToken", 12],
      ["skillNinja.singleClickInstall", 13],
      ["skillNinja.coexistenceMode", 14],
      ["skillNinja.useSharedSourcesManifest", 15],
      ["skillNinja.includeLocalSkills", 90],
    ],
  );
});

test("output format defaults and docs are aligned to ref", () => {
  const setting =
    pkg.contributes.configuration.properties["skillNinja.outputFormat"];
  assert.ok(setting);
  assert.strictEqual(setting.default, "ref");
  assert.ok(
    pkg.contributes.configuration.properties["skillNinja.refCatalogPath"],
  );
  const catalogFormatSetting =
    pkg.contributes.configuration.properties["skillNinja.refCatalogFormat"];
  assert.ok(catalogFormatSetting);
  assert.strictEqual(catalogFormatSetting.default, "full");
  assert.deepStrictEqual(catalogFormatSetting.enum, [
    "full",
    "compact",
    "legacy",
  ]);
  assert.ok(readme.includes("🔗 **Ref**"));
  assert.ok(readme.includes("Ref Format (Default)"));
  // Output Format Details table now includes ref row
  assert.ok(readme.includes("IMPORTANT + link in instruction file"));
  assert.ok(readme.includes("Always-loaded context hygiene"));
  // ref should NOT appear as just "Complete information (default)" — that was the old full label
  assert.strictEqual(readme.includes("Complete information (default)"), false);
  assert.ok(readme.includes("refCatalogFormat"));
  assert.ok(readme.includes("skillNinja.refCatalogFormat"));
  assert.ok(readme.includes("Select `ref`, `full`, `compact`, or `legacy`"));
  assert.ok(readme.includes("skillNinja.refCatalogPath"));
  assert.ok(readme.includes("workspace root"));
  assert.ok(readme.includes("instruction file directory"));
  assert.strictEqual(
    readme.includes(
      "|   7   | `skillNinja.outputFormat`                 | `full`",
    ),
    false,
  );
  assert.ok(readmeJa.includes("🔗 **Ref**"));
  assert.ok(readmeJa.includes("Ref フォーマット（既定）"));
  // Output Format Details table now includes ref row
  assert.ok(readmeJa.includes("IMPORTANT + instruction file にリンク"));
  assert.ok(readmeJa.includes("常時ロードのコンテキスト軽量化"));
  // ref should NOT appear as just "完全な情報（既定）" — that was the old full label
  assert.strictEqual(readmeJa.includes("完全な情報（既定）"), false);
  assert.ok(readmeJa.includes("refCatalogFormat"));
  assert.ok(readmeJa.includes("skillNinja.refCatalogFormat"));
  assert.ok(readmeJa.includes("`ref`, `full`, `compact`, `legacy`"));
  assert.ok(readmeJa.includes("skillNinja.refCatalogPath"));
  assert.ok(readmeJa.includes("workspace root 基準"));
  assert.ok(readmeJa.includes("instruction file の親ディレクトリ基準"));
  assert.strictEqual(
    readmeJa.includes(
      "|  7   | `skillNinja.outputFormat`                 | `full`",
    ),
    false,
  );
});

test("tool detection keeps markdown-based assistants on ref by default", () => {
  assert.ok(
    toolDetectorSource.includes('tool: "github-copilot"') &&
      toolDetectorSource.includes('pattern: "AGENTS.md"') &&
      toolDetectorSource.includes('format: "ref"'),
  );
  assert.ok(
    toolDetectorSource.includes('tool: "claude-code"') &&
      toolDetectorSource.includes('instructionFile: "CLAUDE.md"') &&
      toolDetectorSource.includes('format: "ref"'),
  );
  assert.ok(
    toolDetectorSource.includes('let recommendedFormat: OutputFormat = "ref";'),
  );
  assert.ok(
    toolDetectorSource.includes(
      'return { format: "ref", instructionFile: "AGENTS.md" };',
    ),
  );
  assert.ok(
    toolDetectorSource.includes(
      'return { format: "ref", instructionFile: "CLAUDE.md" };',
    ),
  );
});

test("package lock metadata stays in sync with package manifest", () => {
  assert.strictEqual(packageLock.name, pkg.name);
  assert.strictEqual(packageLock.version, pkg.version);
  assert.strictEqual(packageLock.packages[""].name, pkg.name);
  assert.strictEqual(packageLock.packages[""].version, pkg.version);
  assert.strictEqual(packageLock.packages[""].license, pkg.license);
});

test("legacy local skill commands are hidden from command palette", () => {
  const commandPalette = pkg.contributes.menus.commandPalette || [];
  for (const command of [
    "skillNinja.registerLocalSkill",
    "skillNinja.unregisterLocalSkill",
  ]) {
    assert.ok(
      commandPalette.some(
        (entry) => entry.command === command && entry.when === "false",
      ),
      `${command} should be hidden from the command palette`,
    );
  }
});

test("README files do not document removed or misleading settings", () => {
  for (const content of [readme, readmeJa]) {
    assert.strictEqual(
      content.includes("skillNinja.enableToolDetection"),
      false,
    );
    assert.strictEqual(content.includes("Installed & local skills"), false);
    assert.strictEqual(
      content.includes("インストール済み＆ローカルスキル"),
      false,
    );
  }
});

test("README files describe workspace, user/global, and built-in skill scopes", () => {
  assert.ok(readme.includes("skillNinja.skillsDirectory"));
  assert.ok(readme.includes("Installed Skills"));
  assert.ok(readme.includes("skillNinja.useVsCodeAgentSkillLocations"));
  assert.ok(readme.includes("skillNinja.showBuiltInSkills"));
  assert.ok(readme.includes("User / Global Skills"));
  assert.ok(readme.includes("Installed Extensions"));
  assert.ok(readme.includes("Built-in Skills"));
  assert.ok(readme.includes("provider/origin"));
  assert.ok(readmeJa.includes("skillNinja.skillsDirectory"));
  assert.ok(readmeJa.includes("インストール済みスキル"));
  assert.ok(readmeJa.includes("skillNinja.useVsCodeAgentSkillLocations"));
  assert.ok(readmeJa.includes("skillNinja.showBuiltInSkills"));
  assert.ok(readmeJa.includes("ユーザー / グローバル スキル"));
  assert.ok(readmeJa.includes("インストール済み拡張機能"));
  assert.ok(readmeJa.includes("Built-in Skills"));
  assert.strictEqual(readmeJa.includes("built-in skills"), false);
  assert.ok(readmeJa.includes("provider/origin"));
});

test("built-in setting descriptions explain provider-based grouping", () => {
  assert.ok(
    pkg.contributes.configuration.properties["skillNinja.showBuiltInSkills"],
  );
  const nls = fs.readFileSync(path.join(root, "package.nls.json"), "utf8");
  const nlsJa = fs.readFileSync(path.join(root, "package.nls.ja.json"), "utf8");

  assert.ok(nls.includes("provider/origin"));
  assert.ok(nls.includes("installed extensions"));
  assert.ok(nls.includes("variant/root"));
  assert.ok(nlsJa.includes("Built-in Skills"));
  assert.strictEqual(nlsJa.includes("built-in skills"), false);
  assert.ok(nlsJa.includes("インストール済み拡張機能"));
  assert.ok(nlsJa.includes("provider/origin"));
  assert.ok(nlsJa.includes("variant/root"));
});

test("read-only extension skills expose only open/copy actions", () => {
  const commands = (pkg.contributes.menus["view/item/context"] || [])
    .filter(
      (item) =>
        typeof item.when === "string" && item.when.includes("extensionSkill"),
    )
    .map((item) => item.command)
    .sort();

  assert.deepStrictEqual(commands, [
    "skillNinja.copyPath",
    "skillNinja.copyPath",
    "skillNinja.openInTerminal",
    "skillNinja.openInTerminal",
    "skillNinja.openSkillFile",
    "skillNinja.openSkillFile",
    "skillNinja.openSkillFolder",
    "skillNinja.openSkillFolder",
  ]);
});

test("manifest exposes installed, user/global, and remote views", () => {
  const viewIds = (pkg.contributes.views["skill-ninja"] || []).map(
    (view) => view.id,
  );
  assert.deepStrictEqual(viewIds, [
    "skillNinja.installedView",
    "skillNinja.userGlobalView",
    "skillNinja.browseView",
  ]);
});

test("single-click install setting defaults to double-click behavior", () => {
  const setting =
    pkg.contributes.configuration.properties["skillNinja.singleClickInstall"];
  assert.ok(setting);
  assert.strictEqual(setting.default, false);
  // markdownDescription was added (previously description-only) to align with other settings
  assert.ok(
    setting.markdownDescription,
    "singleClickInstall should have markdownDescription",
  );
});

test("outputFormat markdownDescription surfaces ref-catalog sub-settings", () => {
  const nls = JSON.parse(
    fs.readFileSync(path.join(root, "package.nls.json"), "utf8"),
  );
  // The description table must mention refCatalogPath and refCatalogFormat links
  const desc = nls["config.outputFormat.markdownDescription"] || "";
  assert.ok(
    desc.includes("refCatalogPath") ||
      desc.includes("#skillNinja.refCatalogPath#"),
    "outputFormat description should link to refCatalogPath",
  );
  assert.ok(
    desc.includes("refCatalogFormat") ||
      desc.includes("#skillNinja.refCatalogFormat#"),
    "outputFormat description should link to refCatalogFormat",
  );
  // refCatalogPath and refCatalogFormat descriptions must mention they only apply in ref mode
  const pathDesc = nls["config.refCatalogPath.markdownDescription"] || "";
  const fmtDesc = nls["config.refCatalogFormat.markdownDescription"] || "";
  assert.ok(
    pathDesc.toLowerCase().includes("ref"),
    "refCatalogPath description should mention ref mode",
  );
  assert.ok(
    fmtDesc.toLowerCase().includes("ref"),
    "refCatalogFormat description should mention ref mode",
  );
});

test("README files explain double-click workspace install behavior", () => {
  assert.ok(readme.includes("Double-click a remote skill row"));
  assert.ok(readme.includes("workspace skill root"));
  assert.ok(readme.includes("inline Install action"));

  assert.ok(
    readmeJa.includes("ダブルクリックすると、既定で workspace skill root"),
  );
  assert.ok(readmeJa.includes("シングルクリックインストールに切り替え可能"));
  assert.ok(readmeJa.includes("inline の Install"));
});

test("open output wording matches ref-first UX", () => {
  const nls = JSON.parse(
    fs.readFileSync(path.join(root, "package.nls.json"), "utf8"),
  );
  const nlsJa = JSON.parse(
    fs.readFileSync(path.join(root, "package.nls.ja.json"), "utf8"),
  );

  assert.strictEqual(nls["command.openInstructionFile"], "Open Skill Output");
  assert.strictEqual(nlsJa["command.openInstructionFile"], "スキル出力を開く");
  assert.ok(readme.includes("Toolbar: Skill Output / Update Instruction"));
  assert.ok(readme.includes("Open Skill Output quick links"));
  assert.ok(
    readme.includes("In `ref` mode, **Skill Output** opens the linked catalog"),
  );
  assert.ok(readme.includes("Agent Skills Ninja: Open Skill Output"));
  assert.ok(
    readmeJa.includes("ツールバー: スキル出力 / インストラクション更新"),
  );
  assert.ok(readmeJa.includes("空状態: 検索 / 新規作成 / スキル出力を開く"));
  assert.ok(
    readmeJa.includes(
      "`ref` モードでは **スキル出力** がリンク先 catalog を開き",
    ),
  );
  assert.ok(readmeJa.includes("Agent Skills Ninja: Open Skill Output"));
});

test("extension keeps default double-click workspace install contract", () => {
  assert.ok(extensionSource.includes("resolveDefaultInstallTargetRoot"));
  assert.ok(extensionSource.includes('root.scope === "workspace"'));
  assert.ok(extensionSource.includes('"skillNinja.onSkillClick"'));
  assert.ok(extensionSource.includes("explicitTargetRoot?: SkillRoot"));
});

test("install bundle command uses localized command titles", () => {
  const installBundle = (pkg.contributes.commands || []).find(
    (command) => command.command === "skillNinja.installBundle",
  );

  assert.ok(installBundle);
  assert.strictEqual(installBundle.title, "%command.installBundle%");
});

test("all views expose create skill and settings in the title bar", () => {
  for (const viewId of [
    "skillNinja.installedView",
    "skillNinja.userGlobalView",
    "skillNinja.browseView",
  ]) {
    const commands = titleMenuCommandsFor(viewId);
    assert.ok(
      commands.includes("skillNinja.createSkill"),
      `${viewId} should expose create skill`,
    );
    assert.ok(
      commands.includes("skillNinja.openSettings"),
      `${viewId} should expose settings`,
    );
  }
});

test("user/global title bar exposes built-in skills toggle", () => {
  const userGlobalTitleMenu = (
    pkg.contributes?.menus?.["view/title"] || []
  ).find(
    (item) =>
      item.command === "skillNinja.showBuiltInSkills" &&
      item.when.includes("view == skillNinja.userGlobalView"),
  );

  assert.ok(userGlobalTitleMenu);
  assert.strictEqual(
    userGlobalTitleMenu.when,
    "view == skillNinja.userGlobalView && config.skillNinja.showBuiltInSkills == false",
  );
});

test("README files and settings surface the companion extension", () => {
  const companionUrl =
    "https://marketplace.visualstudio.com/items?itemName=yamapan.agent-resources-ninja";

  assert.ok(readme.includes("Agent Resources Ninja"));
  assert.ok(readme.includes(companionUrl));
  assert.ok(readmeJa.includes("Agent Resources Ninja"));
  assert.ok(readmeJa.includes(companionUrl));
  assert.strictEqual(
    pkg.contributes.configuration.properties["skillNinja.companionExtension"]
      ?.order,
    101,
  );
});

test("README files document coexistence behavior and standalone exclusions", () => {
  assert.ok(readme.includes("### Coexistence with Agent Resources Ninja"));
  assert.ok(readme.includes("skillNinja.coexistenceMode"));
  assert.ok(readme.includes("skillNinja.useSharedSourcesManifest"));
  assert.ok(readme.includes("sources.json"));
  assert.ok(readme.includes("resourceNinja.kindsExcluded"));
  assert.ok(readme.includes("Show Coexistence Status"));

  assert.ok(readmeJa.includes("### Agent Resources Ninja との共存"));
  assert.ok(readmeJa.includes("skillNinja.coexistenceMode"));
  assert.ok(readmeJa.includes("skillNinja.useSharedSourcesManifest"));
  assert.ok(readmeJa.includes("sources.json"));
  assert.ok(readmeJa.includes("resourceNinja.kindsExcluded"));
  assert.ok(readmeJa.includes("Show Coexistence Status"));
});

test("shared sources manifest setting is described as a source-list SSOT", () => {
  const nls = fs.readFileSync(path.join(root, "package.nls.json"), "utf8");
  const nlsJa = fs.readFileSync(path.join(root, "package.nls.ja.json"), "utf8");

  assert.ok(nls.includes("Agent Resources Ninja"));
  assert.ok(nls.includes("sources.json"));
  assert.ok(nls.includes("source definitions only"));
  assert.ok(nlsJa.includes("Agent Resources Ninja"));
  assert.ok(nlsJa.includes("sources.json"));
  assert.ok(nlsJa.includes("source 定義だけ"));
});

test("tool model descriptions do not hardcode workspace-only skill paths", () => {
  const modelDescriptions = pkg.contributes.languageModelTools
    .filter((tool) =>
      ["installSkill", "listSkills", "uninstallSkill"].includes(
        tool.toolReferenceName,
      ),
    )
    .map((tool) => tool.modelDescription || "");

  for (const description of modelDescriptions) {
    assert.strictEqual(description.includes(".github/skills/"), false);
    assert.strictEqual(description.includes("AGENTS.md"), false);
  }

  assert.ok(
    modelDescriptions.some((description) =>
      description.includes("managed skill root"),
    ),
  );
  assert.ok(
    modelDescriptions.some((description) =>
      description.includes("managed skill roots"),
    ),
  );
  assert.ok(
    modelDescriptions.some((description) =>
      description.includes("configured instruction file"),
    ),
  );
});

test("MCP tool responses do not contain corrupted markdown fragments", () => {
  const forbiddenSnippets = [
    "|| アクション | 説明 |",
    "|-----------|------||| アクション | 説明 |",
    "|-----------|------|||| アクション | 説明 |",
    "|-----------|------|| アクション | 説明 |",
    "|-----------|------|-|| アクション | 説明 |",
    "|-----------|------|-| アクション | 説明 |",
    "|---|| アクション | 説明 |",
    "**� スキルを見つけるには？**",
    "2. � ",
  ];

  for (const snippet of forbiddenSnippets) {
    assert.strictEqual(
      mcpToolsSource.includes(snippet),
      false,
      `${snippet} should not remain in src/mcpTools.ts`,
    );
  }

  assert.strictEqual(mcpToolsSource.includes("\uFFFD"), false);
});

test("release instructions include the maintained npm test path", () => {
  assert.ok(releaseInstructions.includes("npm test"));
  assert.ok(releaseInstructions.includes("scripts/test-skill-scan-paths.js"));
  assert.ok(
    releaseInstructions.includes("scripts/test-local-skill-scanner.js"),
  );
  assert.ok(releaseInstructions.includes("code --install-extension"));
  assert.ok(releaseInstructions.includes("docs/**"));
});

test("VSIX ignore rules keep demo docs out of the package", () => {
  const ignoreEntries = new Set(getVscodeIgnoreEntries().map(normalizePath));

  assert.ok(ignoreEntries.has("docs/**"));
  assert.ok(readme.includes("docs/screenshots/demo.gif"));
});

test("npm test regression scripts are not excluded by .gitignore", () => {
  const ignoreMatchers = getGitIgnoreEntries().map(globToRegExp);
  const npmTestCommand = pkg.scripts.test || "";
  const regressionScripts = [
    ...new Set(npmTestCommand.match(/scripts\/[A-Za-z0-9._-]+\.js/g) || []),
  ];

  assert.ok(
    regressionScripts.length > 0,
    "npm test should reference regression scripts",
  );

  for (const scriptPath of regressionScripts) {
    assert.strictEqual(
      ignoreMatchers.some((matcher) => matcher.test(scriptPath)),
      false,
      `${scriptPath} must not be excluded by .gitignore`,
    );
    assert.ok(
      fs.existsSync(path.join(root, scriptPath)),
      `${scriptPath} should exist on disk`,
    );
  }
});

test("temporary capture logs are excluded from the VSIX", () => {
  const ignoreMatchers = getVscodeIgnoreEntries().map(globToRegExp);
  for (const filePath of [
    ".tmp-vsce-show.json",
    ".tmp-release.log",
    "compile-capture.txt",
    "test-capture.txt",
    "vsce-package-capture.txt",
    "vsix-contents-capture.txt",
    "npm-audit-capture.json",
    "marketplace-check.json",
    "compile-exit.txt",
    "compile-output-latest.txt",
    "test-exit.txt",
    "test-output.txt",
    "audit-release.txt",
    "audit-release-exit.txt",
    "vsce-package-release.txt",
    "vsce-ls-release.txt",
    "vsce-show-0.9.x.json",
    "vsce-show-exit.txt",
    "vsix-contents-0.9.4.txt",
    "vsix-metadata-0.9.4.txt",
  ]) {
    assert.ok(
      ignoreMatchers.some((matcher) => matcher.test(filePath)),
      `${filePath} should be excluded from the VSIX`,
    );
  }
});

test("local debug logs and backup files are excluded from git", () => {
  const ignoreMatchers = getGitIgnoreEntries().map(globToRegExp);
  for (const filePath of [
    ".tmp-vsce-show.json",
    ".tmp-release.log",
    "compile-exit.txt",
    "compile-output-latest.txt",
    "test-exit.txt",
    "test-output.txt",
    "audit-release.txt",
    "audit-release-exit.txt",
    "vsce-package-release.txt",
    "vsce-ls-release.txt",
    "vsce-show-0.9.x.json",
    "vsce-show-exit.txt",
    "vsix-contents-0.9.4.txt",
    "vsix-metadata-0.9.4.txt",
    "AGENTS.md.backup",
  ]) {
    assert.ok(
      ignoreMatchers.some((matcher) => matcher.test(filePath)),
      `${filePath} must be excluded by .gitignore`,
    );
  }
});

test("manifest asset files exist and are not excluded from the VSIX", () => {
  const ignoreEntries = new Set(getVscodeIgnoreEntries().map(normalizePath));

  for (const assetPath of collectManifestAssetPaths()) {
    assert.ok(
      fs.existsSync(path.join(root, assetPath)),
      `${assetPath} should exist on disk`,
    );
    assert.strictEqual(
      ignoreEntries.has(assetPath),
      false,
      `${assetPath} must not be excluded by .vscodeignore`,
    );
  }
});

test("outputFormat migration covers all configuration scopes", () => {
  const extensionSource = fs.readFileSync(
    path.join(root, "src", "extension.ts"),
    "utf8",
  );
  // Migration must inspect all three VS Code config scopes
  assert.ok(
    extensionSource.includes("inspected?.globalValue"),
    "migration must handle globalValue",
  );
  assert.ok(
    extensionSource.includes("inspected?.workspaceValue"),
    "migration must handle workspaceValue",
  );
  assert.ok(
    extensionSource.includes("inspected?.workspaceFolderValue"),
    "migration must handle workspaceFolderValue",
  );
  // Migration map must include all known legacy values (TS object shorthand, no quotes on keys)
  assert.ok(
    extensionSource.includes('markdown: "legacy"'),
    "migration must map markdown → legacy",
  );
  assert.ok(
    extensionSource.includes('"compressed-index": "compact"'),
    "migration must map compressed-index → compact",
  );
  assert.ok(
    extensionSource.includes('"markdown-with-index": "full"'),
    "migration must map markdown-with-index → full",
  );
});

test("configWatcher watches refCatalogPath and refCatalogFormat", () => {
  const extensionSource = fs.readFileSync(
    path.join(root, "src", "extension.ts"),
    "utf8",
  );
  assert.ok(
    extensionSource.includes(
      'affectsConfiguration("skillNinja.refCatalogPath")',
    ),
    "configWatcher must watch refCatalogPath",
  );
  assert.ok(
    extensionSource.includes(
      'affectsConfiguration("skillNinja.refCatalogFormat")',
    ),
    "configWatcher must watch refCatalogFormat",
  );
});

test("openInstructionFile is ref-catalog aware", () => {
  assert.ok(
    extensionSource.includes("resolveOutputFormat(workspaceFolder.uri)"),
    "openInstructionFile should resolve output format",
  );
  assert.ok(
    extensionSource.includes("Select the skill output scope to open"),
    "openInstructionFile quick pick should use skill output wording",
  );
  assert.ok(
    extensionSource.includes("refCatalogPath"),
    "openInstructionFile should consult refCatalogPath in ref mode",
  );
  assert.ok(
    extensionSource.includes("Ref catalog was not available yet") ||
      extensionSource.includes("Ref catalog がまだ生成されていなかったため"),
    "openInstructionFile should fall back from catalog to instruction file",
  );
});

test("Output Format Details table in README includes ref as default", () => {
  // The secondary Output Format Details section must include ref
  assert.ok(
    readme.includes("Always-loaded context hygiene") &&
      readme.includes("_(Default)_"),
    "README Output Format Details must include ref as the default",
  );
  assert.ok(
    readmeJa.includes("常時ロードのコンテキスト軽量化") &&
      readmeJa.includes("_(既定)_"),
    "README_ja Output Format Details must include ref as the default",
  );
  // Ensure full is no longer labeled as default
  assert.strictEqual(
    readme.includes("Complete information (default)"),
    false,
    "full should not be labeled as default",
  );
  assert.strictEqual(
    readmeJa.includes("完全な情報（既定）"),
    false,
    "full should not be labeled as default in Japanese README",
  );
});

console.log("\nPackage manifest and README UX tests passed.");
