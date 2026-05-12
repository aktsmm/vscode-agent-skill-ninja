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
      ["skillNinja.language", 8],
      ["skillNinja.autoUpdateSkillsOnUpgrade", 9],
      ["skillNinja.githubToken", 10],
      ["skillNinja.singleClickInstall", 11],
      ["skillNinja.coexistenceMode", 12],
      ["skillNinja.useSharedSourcesManifest", 13],
      ["skillNinja.includeLocalSkills", 90],
    ],
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
  assert.ok(readme.includes("Built-in Skills"));
  assert.ok(readme.includes("provider/origin"));
  assert.ok(readmeJa.includes("skillNinja.skillsDirectory"));
  assert.ok(readmeJa.includes("インストール済みスキル"));
  assert.ok(readmeJa.includes("skillNinja.useVsCodeAgentSkillLocations"));
  assert.ok(readmeJa.includes("skillNinja.showBuiltInSkills"));
  assert.ok(readmeJa.includes("ユーザー / グローバル スキル"));
  assert.ok(readmeJa.includes("組み込みスキル"));
  assert.ok(readmeJa.includes("provider/origin"));
});

test("built-in setting descriptions explain provider-based grouping", () => {
  assert.ok(
    pkg.contributes.configuration.properties[
      "skillNinja.showBuiltInSkills"
    ],
  );
  const nls = fs.readFileSync(path.join(root, "package.nls.json"), "utf8");
  const nlsJa = fs.readFileSync(
    path.join(root, "package.nls.ja.json"),
    "utf8",
  );

  assert.ok(nls.includes("provider/origin"));
  assert.ok(nls.includes("variant/root"));
  assert.ok(nlsJa.includes("provider/origin"));
  assert.ok(nlsJa.includes("variant/root"));
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
  assert.ok(readme.includes("resourceNinja.kindsExcluded"));
  assert.ok(readme.includes("Show Coexistence Status"));

  assert.ok(readmeJa.includes("### Agent Resources Ninja との共存"));
  assert.ok(readmeJa.includes("skillNinja.coexistenceMode"));
  assert.ok(readmeJa.includes("resourceNinja.kindsExcluded"));
  assert.ok(readmeJa.includes("Show Coexistence Status"));
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
    "compile-capture.txt",
    "test-capture.txt",
    "vsce-package-capture.txt",
    "vsix-contents-capture.txt",
    "npm-audit-capture.json",
    "marketplace-check.json",
  ]) {
    assert.ok(
      ignoreMatchers.some((matcher) => matcher.test(filePath)),
      `${filePath} should be excluded from the VSIX`,
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

console.log("\nPackage manifest and README UX tests passed.");
