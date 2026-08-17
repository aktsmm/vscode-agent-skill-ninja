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
const skillIndex = require(path.join(root, "resources", "skill-index.json"));
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const readmeJa = fs.readFileSync(path.join(root, "README_ja.md"), "utf8");
const vscodeIgnore = fs.readFileSync(path.join(root, ".vscodeignore"), "utf8");
const gitIgnore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
const packageNls = JSON.parse(
  fs.readFileSync(path.join(root, "package.nls.json"), "utf8"),
);
const packageNlsJa = JSON.parse(
  fs.readFileSync(path.join(root, "package.nls.ja.json"), "utf8"),
);
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
const chatParticipantSource = fs.readFileSync(
  path.join(root, "src", "chatParticipant.ts"),
  "utf8",
);
const toolDetectorSource = fs.readFileSync(
  path.join(root, "src", "toolDetector.ts"),
  "utf8",
);
const i18nSource = fs.readFileSync(path.join(root, "src", "i18n.ts"), "utf8");

const isGitCheckout = fs.existsSync(path.join(root, ".git"));

function runGit(args, input) {
  return require("child_process").execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    input,
  });
}

// 改行や空白を含むファイル名を壊さないよう、git との受け渡しは NUL 区切りにする
function toNulLines(output) {
  return output.split("\0").filter(Boolean);
}

// git が無い環境では index 由来の検査を skip するが、
// .git があるのに問い合わせが失敗した場合は握りつぶさず落とす
const trackedFiles = (() => {
  if (!isGitCheckout) {
    return null;
  }
  return new Set(toNulLines(runGit(["ls-files", "-z"])));
})();

/**
 * 手書きの glob matcher では `scripts` や `test-*.js` のような
 * 正当な .gitignore 記法を取りこぼすので、判定は git 本体に任せる。
 */
function gitIgnoredPaths(candidates) {
  if (!isGitCheckout || candidates.length === 0) {
    return null;
  }

  try {
    return new Set(
      toNulLines(
        runGit(
          ["check-ignore", "--no-index", "--stdin", "-z"],
          `${candidates.join("\0")}\0`,
        ),
      ),
    );
  } catch (error) {
    // check-ignore は該当なしのとき exit 1 を返す
    if (error.status === 1) {
      return new Set();
    }
    throw error;
  }
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
      "skillNinja.additionalSkillRoots",
      "skillNinja.useVsCodeAgentSkillLocations",
      "skillNinja.showBuiltInSkills",
      "skillNinja.outputFormat",
      "skillNinja.refCatalogPath",
      "skillNinja.refCatalogFormat",
      "skillNinja.language",
      "skillNinja.autoUpdateSkillsOnUpgrade",
      "skillNinja.staleSourceIndexUpdateMode",
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
      ["skillNinja.additionalSkillRoots", 5],
      ["skillNinja.useVsCodeAgentSkillLocations", 6],
      ["skillNinja.showBuiltInSkills", 7],
      ["skillNinja.outputFormat", 8],
      ["skillNinja.refCatalogPath", 9],
      ["skillNinja.refCatalogFormat", 10],
      ["skillNinja.language", 11],
      ["skillNinja.autoUpdateSkillsOnUpgrade", 12],
      ["skillNinja.staleSourceIndexUpdateMode", 13],
      ["skillNinja.githubToken", 14],
      ["skillNinja.singleClickInstall", 15],
      ["skillNinja.coexistenceMode", 16],
      ["skillNinja.useSharedSourcesManifest", 17],
      ["skillNinja.includeLocalSkills", 90],
    ],
  );
});

test("stale source index update setting is localized and scoped", () => {
  const setting =
    pkg.contributes.configuration.properties[
      "skillNinja.staleSourceIndexUpdateMode"
    ];
  assert.ok(setting);
  assert.strictEqual(setting.default, "prompt");
  assert.deepStrictEqual(setting.enum, ["always", "prompt", "never"]);
  assert.deepStrictEqual(setting.enumDescriptions, [
    "%config.staleSourceIndexUpdateMode.always%",
    "%config.staleSourceIndexUpdateMode.prompt%",
    "%config.staleSourceIndexUpdateMode.never%",
  ]);
  assert.strictEqual(
    setting.markdownDescription,
    "%config.staleSourceIndexUpdateMode.markdownDescription%",
  );

  for (const key of [
    "config.staleSourceIndexUpdateMode.markdownDescription",
    "config.staleSourceIndexUpdateMode.always",
    "config.staleSourceIndexUpdateMode.prompt",
    "config.staleSourceIndexUpdateMode.never",
  ]) {
    assert.ok(packageNls[key], `${key} should exist in package.nls.json`);
    assert.ok(packageNlsJa[key], `${key} should exist in package.nls.ja.json`);
  }

  assert.ok(
    packageNls[
      "config.staleSourceIndexUpdateMode.markdownDescription"
    ].includes("30 days"),
  );
  assert.ok(
    packageNls[
      "config.staleSourceIndexUpdateMode.markdownDescription"
    ].includes("does not affect extension-upgrade"),
  );
});

test("stale source startup prompt flow is guarded in extension runtime", () => {
  for (const expected of [
    "LAST_STALE_SOURCE_INDEX_PROMPT_DATE_KEY",
    "normalizeStaleSourceIndexUpdateMode",
    'config.get<string>("staleSourceIndexUpdateMode")',
    "decideStaleSourceIndexAction(",
    "messages.staleSourceIndexPrompt(",
    "messages.actionUpdateNow()",
    "messages.actionLater()",
    "updateIndexFromSingleSource(",
    "messages.staleSourceIndexPartialFailed(",
  ]) {
    assert.ok(
      extensionSource.includes(expected),
      `extension should include stale source startup flow piece: ${expected}`,
    );
  }

  assert.ok(
    extensionSource.includes('return "prompt";'),
    "invalid stale source update mode should fall back to prompt",
  );

  // 判断そのものは activate() の外の純関数に置き、テストできる形にしている
  const freshnessSource = fs.readFileSync(
    path.join(root, "src", "sourceIndexFreshness.ts"),
    "utf8",
  );
  assert.ok(
    freshnessSource.includes("input.lastPromptDate === input.today"),
    "prompt mode should avoid repeated daily prompts",
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

test("every ordered setting appears in both README settings tables", () => {
  const ordered = Object.entries(pkg.contributes.configuration.properties)
    .filter(([, value]) => typeof value.order === "number" && value.order < 90)
    .sort((left, right) => left[1].order - right[1].order);

  const missing = [];
  for (const [name, value] of ordered) {
    for (const [label, doc] of [
      ["README.md", readme],
      ["README_ja.md", readmeJa],
    ]) {
      // The settings table row pins the documented order to the manifest order.
      if (!doc.includes(`| \`${name}\``)) {
        missing.push(`${label}: ${name} row`);
        continue;
      }
      const rowPattern = new RegExp(
        `\\|\\s*${value.order}\\s*\\|\\s*\`${name.replace(/\./g, "\\.")}\``,
      );
      if (!rowPattern.test(doc)) {
        missing.push(`${label}: ${name} order ${value.order}`);
      }
    }
  }

  assert.deepStrictEqual(missing, [], `README settings drift: ${missing}`);
});

test("documented output channel names match the registered ones", () => {
  const channelNames = [
    ...extensionSource.matchAll(/createOutputChannel\(\s*"([^"]+)"/g),
  ].map((match) => match[1]);
  assert.ok(channelNames.length > 0, "Expected registered output channels");

  for (const doc of [readme, readmeJa]) {
    for (const referenced of doc.matchAll(/`([^`]*: Source Index)`/g)) {
      assert.ok(
        channelNames.includes(referenced[1]),
        `Unknown output channel referenced in docs: ${referenced[1]}`,
      );
    }
  }
});

test("package version info stays in sync with skill-index metadata", () => {
  for (const description of [
    packageNls["config.versionInfo.markdownDescription"] || "",
    packageNlsJa["config.versionInfo.markdownDescription"] || "",
  ]) {
    assert.ok(description.includes(`Skill Index | **v${skillIndex.version}**`));
    assert.ok(description.includes(`Last Updated | ${skillIndex.lastUpdated}`));
    assert.ok(description.includes(`Skills | ${skillIndex.skills.length}`));
    assert.ok(description.includes(`Sources | ${skillIndex.sources.length}`));
  }
});

test("extension version stays in sync across manifest, NLS, and changelog", () => {
  for (const [label, nls] of [
    ["package.nls.json", packageNls],
    ["package.nls.ja.json", packageNlsJa],
  ]) {
    const description = nls["config.versionInfo.markdownDescription"] || "";
    assert.ok(
      description.includes(`Extension | **${pkg.version}**`),
      `${label} should show extension version ${pkg.version}`,
    );
  }

  const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const latestRelease = /^## \[(\d+\.\d+\.\d+)\]/m.exec(changelog)?.[1];
  assert.strictEqual(
    latestRelease,
    pkg.version,
    "CHANGELOG should lead with the packaged version",
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

test("chat participant and MCP tools always reload the latest skill index", () => {
  assert.strictEqual(
    chatParticipantSource.includes("let cachedIndex"),
    false,
    "chatParticipant should not keep a long-lived cached index",
  );
  assert.strictEqual(
    mcpToolsSource.includes("let cachedIndex"),
    false,
    "mcpTools should not keep a long-lived cached index",
  );
  assert.ok(
    chatParticipantSource.includes("return loadSkillIndex(context);"),
    "chatParticipant should reload the index for each request",
  );
  assert.ok(
    mcpToolsSource.includes("return loadSkillIndex(context);"),
    "mcpTools should reload the index for each invocation",
  );
});

test("chat participant user-facing copy goes through runtime i18n", () => {
  assert.ok(
    chatParticipantSource.includes('import { messages } from "./i18n";'),
    "chat participant should use the shared runtime i18n messages",
  );

  for (const forbidden of [
    "Please provide a search query",
    "Please provide a skill name",
    "No workspace folder open",
    "No skills installed yet",
    "Recommended Skills",
    "Popular Skills",
  ]) {
    assert.strictEqual(
      chatParticipantSource.includes(forbidden),
      false,
      `chat participant should not hardcode: ${forbidden}`,
    );
  }

  for (const expected of [
    "chatSearchMissingQuery",
    "chatInstallMissingSkillName",
    "chatNoWorkspaceFolderOpen",
    "chatNoInstalledSkillsUsage",
    "chatRecommendedSkillsHeader",
    "chatPopularSkillsHeader",
  ]) {
    assert.ok(i18nSource.includes(expected), `i18n should expose ${expected}`);
  }
});

test("chat participant guards malformed skill index arrays", () => {
  assert.ok(
    chatParticipantSource.includes(
      "function getIndexSkills(index: SkillIndex): Skill[]",
    ),
    "chat participant should centralize skill array normalization",
  );
  assert.strictEqual(
    chatParticipantSource.includes("= index.skills;"),
    false,
    "chat participant should not directly dereference index.skills",
  );
  assert.ok(
    chatParticipantSource.includes(
      "Array.isArray(index.skills) ? index.skills : []",
    ),
    "chat participant should tolerate malformed runtime index objects",
  );
});

test("MCP tools guard malformed skill index arrays", () => {
  assert.ok(
    mcpToolsSource.includes(
      "function getIndexSkills(index: SkillIndex): Skill[]",
    ),
    "MCP tools should centralize skill array normalization",
  );
  for (const forbidden of [
    "const skills = index.skills;",
    "oldIndex.skills.length",
    "newIndex.skills.length",
    "index.skills.find(",
  ]) {
    assert.strictEqual(
      mcpToolsSource.includes(forbidden),
      false,
      `MCP tools should not directly dereference: ${forbidden}`,
    );
  }
  assert.ok(
    mcpToolsSource.includes("Array.isArray(index.skills) ? index.skills : []"),
    "MCP tools should tolerate malformed runtime index objects",
  );
});

test("MCP workspace errors use runtime i18n", () => {
  assert.ok(
    mcpToolsSource.includes('import { isJapanese, messages } from "./i18n";'),
    "MCP tools should import runtime i18n messages",
  );

  for (const forbidden of [
    "No workspace folder open",
    "No workspace open. Cannot analyze project",
    "No managed skill root is available",
  ]) {
    assert.strictEqual(
      mcpToolsSource.includes(forbidden),
      false,
      `MCP tools should not hardcode workspace error: ${forbidden}`,
    );
  }

  assert.ok(
    mcpToolsSource.includes("messages.chatNoWorkspaceFolderOpen()"),
    "MCP tools should use localized no-workspace message",
  );
  assert.ok(
    mcpToolsSource.includes("messages.chatNoManagedSkillRoot()"),
    "MCP tools should use localized managed-root message",
  );
});

test("MCP short error responses use localizable helpers", () => {
  assert.ok(
    mcpToolsSource.includes("function localizeMcpText("),
    "MCP tools should have a scoped localization helper for short tool errors",
  );
  assert.ok(
    mcpToolsSource.includes("function formatMcpError("),
    "MCP tools should have a scoped error formatter",
  );
  assert.ok(
    mcpToolsSource.includes("function mcpContextUnavailableMessage("),
    "MCP tools should localize missing extension context errors",
  );
  assert.ok(
    mcpToolsSource.includes("function formatSourceRemoveError("),
    "MCP tools should localize remove-source resolution errors",
  );

  for (const expected of [
    "Failed to install",
    "Failed to uninstall",
    "Failed to update index",
    "GitHub search failed",
    "Failed to add source",
    "Failed to remove source",
    "Failed to localize skill",
    "skillName is required",
    "not found in index",
  ]) {
    assert.ok(
      mcpToolsSource.includes(expected),
      `MCP source should still contain the English fallback text: ${expected}`,
    );
  }

  for (const expected of [
    "インストールに失敗しました",
    "アンインストールに失敗しました",
    "インデックス更新に失敗しました",
    "GitHub 検索に失敗しました",
    "ソース追加に失敗しました",
    "ソース削除に失敗しました",
    "skillName は必須です",
    "拡張機能の context を利用できません",
    "ソースを削除するには",
    "複数のソースが一致しました",
    "ソースが見つかりません",
  ]) {
    assert.ok(
      mcpToolsSource.includes(expected),
      `MCP source should include Japanese fallback text: ${expected}`,
    );
  }

  for (const forbidden of [
    "`❌ GitHub search failed:",
    "`❌ Failed to update index:",
    "`❌ Failed to add source:",
    "`❌ Failed to remove source:",
    "`❌ Failed to localize skill:",
    "`❌ Extension context not available.",
    "`❌ ${resolved.error}`",
  ]) {
    assert.strictEqual(
      mcpToolsSource.includes(forbidden),
      false,
      `MCP tools should not use raw English error template: ${forbidden}`,
    );
  }
});

test("open managed output reports open failures instead of silently swallowing them", () => {
  assert.ok(
    extensionSource.includes("const reportOpenFailure = (") &&
      extensionSource.includes("[Skill Ninja] Failed to open ${label}:"),
    "extension should log managed output open failures",
  );
  assert.ok(
    extensionSource.includes("The configured ") &&
      extensionSource.includes("could not be opened"),
    "extension should surface a warning when the configured output cannot be opened",
  );
  assert.ok(
    extensionSource.includes("Failed to regenerate managed output"),
    "extension should log regeneration failures before falling back",
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
    "skillNinja.openWorkspaceOutput",
    "skillNinja.openUserGlobalOutput",
    "skillNinja.reinstallRoot",
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

test("show built-in command appears in command palette only when disabled", () => {
  const commandPalette = pkg.contributes.menus.commandPalette || [];

  assert.ok(
    commandPalette.some(
      (entry) =>
        entry.command === "skillNinja.showBuiltInSkills" &&
        entry.when === "config.skillNinja.showBuiltInSkills == false",
    ),
  );
  assert.ok(extensionSource.includes('"skillNinja.showBuiltInSkills"'));
  assert.strictEqual(
    extensionSource.includes('"showBuiltInSkills",\n        false'),
    false,
  );
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
  assert.ok(readme.includes("skillNinja.additionalSkillRoots"));
  assert.ok(readme.includes("Installed Skills"));
  assert.ok(readme.includes("skillNinja.useVsCodeAgentSkillLocations"));
  assert.ok(readme.includes("skillNinja.showBuiltInSkills"));
  assert.ok(readme.includes("User / Global Skills"));
  assert.ok(readme.includes("Installed Extensions"));
  assert.ok(readme.includes("Built-in Skills"));
  assert.ok(readme.includes("provider/origin"));
  assert.ok(readmeJa.includes("skillNinja.skillsDirectory"));
  assert.ok(readmeJa.includes("skillNinja.additionalSkillRoots"));
  assert.ok(readmeJa.includes("インストール済みスキル"));
  assert.ok(readmeJa.includes("skillNinja.useVsCodeAgentSkillLocations"));
  assert.ok(readmeJa.includes("skillNinja.showBuiltInSkills"));
  assert.ok(readmeJa.includes("ユーザー / グローバル スキル"));
  assert.ok(readmeJa.includes("インストール済み拡張機能"));
  assert.ok(readmeJa.includes("Built-in Skills"));
  assert.strictEqual(readmeJa.includes("built-in skills"), false);
  assert.ok(readmeJa.includes("provider/origin"));
});

test("README files document the install reliability contract", () => {
  const githubFetchSource = fs.readFileSync(
    path.join(root, "src", "githubFetch.ts"),
    "utf8",
  );

  const attemptCap = /GITHUB_RETRY_MAX_ATTEMPTS = (\d+)/.exec(
    githubFetchSource,
  )?.[1];
  assert.ok(attemptCap, "githubFetch.ts should declare a retry attempt cap");

  const maxDelayMs = /GITHUB_RETRY_MAX_DELAY_MS = (\d+)/.exec(
    githubFetchSource,
  )?.[1];
  assert.ok(maxDelayMs, "githubFetch.ts should declare a retry wait cap");
  const maxDelaySeconds = Number(maxDelayMs) / 1000;

  const retryableBody =
    /export function isRetryableGitHubStatus[\s\S]*?\n}/.exec(
      githubFetchSource,
    )?.[0];
  assert.ok(retryableBody, "githubFetch.ts should declare retryable statuses");
  for (const status of ["429", "502", "503", "504"]) {
    assert.ok(
      retryableBody.includes(status),
      `${status} should stay retryable`,
    );
  }
  for (const status of ["401", "403", "404"]) {
    assert.strictEqual(
      retryableBody.includes(status),
      false,
      `${status} must never be retried, or the README contract is wrong`,
    );
  }

  assert.ok(readme.includes("### Skill Install Reliability"));
  assert.ok(readme.includes(`up to ${attemptCap} attempts`));
  assert.ok(readme.includes(`longer than ${maxDelaySeconds} seconds`));
  assert.ok(readmeJa.includes("### インストール失敗時の挙動"));
  assert.ok(readmeJa.includes(`最大 ${attemptCap} 回`));
  assert.ok(readmeJa.includes(`${maxDelaySeconds} 秒を超える`));

  for (const doc of [readme, readmeJa]) {
    for (const token of [
      "`429`",
      "`502`",
      "`503`",
      "`504`",
      "`401`",
      "`403`",
      "`404`",
      "Retry-After",
      "x-ratelimit-remaining",
      "x-ratelimit-reset",
      ".skill-meta.json",
    ]) {
      assert.ok(doc.includes(token), `README should document ${token}`);
    }
  }
});

test("README files document the path containment contract", () => {
  const installerSource = fs.readFileSync(
    path.join(root, "src", "skillInstaller.ts"),
    "utf8",
  );

  // 実装側の契約が消えたら README の記述も嘘になるので、両方を突き合わせる
  const implementationContract = [
    ["skippedUnsafeEntries", "unsafe entries are tracked separately"],
    [
      "EXTENSION_OWNED_FILE_NAMES",
      "extension-owned metadata is not downloaded",
    ],
    ["HASHED_SKILL_FOLDER_PREFIX", "a hashed folder fallback exists"],
    ["isStrictlyInsidePath", "deletes are bounded to the skill root"],
    ["findRootLevelSkillArtifacts", "root-level leftovers are detected"],
  ];
  for (const [symbol, reason] of implementationContract) {
    assert.ok(
      installerSource.includes(symbol),
      `skillInstaller.ts should keep ${symbol} so ${reason}`,
    );
  }

  const hashedPrefix = /HASHED_SKILL_FOLDER_PREFIX = "([^"]+)"/.exec(
    installerSource,
  )?.[1];
  assert.strictEqual(
    hashedPrefix,
    "skill-",
    "README documents the hashed folder prefix literally",
  );

  assert.ok(
    extensionSource.includes("ROOT_ARTIFACT_SCAN_STATE_KEY"),
    "the leftover notice needs its own one-shot gate for the README claim to hold",
  );

  for (const doc of [readme, readmeJa]) {
    for (const token of ["`..`", "`skill-<hash>`", "`SKILL.md`"]) {
      assert.ok(
        doc.includes(token),
        `README should document the containment contract token ${token}`,
      );
    }
  }

  for (const phrase of [
    "Unsafe file names from a source are skipped",
    "cannot ship its own",
    "still gets its own folder",
    "Leftover files directly in a skill root are reported once",
    "Bulk delete reports what actually happened",
  ]) {
    assert.ok(readme.includes(phrase), `README.md should document: ${phrase}`);
  }

  for (const phrase of [
    "安全でないファイル名は、インストールせずに除外します",
    "配布元が同梱した `.skill-meta.json` は使いません",
    "専用フォルダを作ります",
    "スキルルート直下の残骸は 1 回だけ通知します",
    "一括削除は実際の結果を報告します",
  ]) {
    assert.ok(
      readmeJa.includes(phrase),
      `README_ja.md should document: ${phrase}`,
    );
  }
});

test("every localized message key exists in both language tables", () => {
  // 片方の表にだけ足すと、その言語では生キーがそのままユーザーへ出る
  const jaStart = i18nSource.indexOf("const jaMessages = {");
  const enStart = i18nSource.indexOf("const enMessages: MessageDictionary = {");
  const accessorStart = i18nSource.indexOf("export const messages = {");
  assert.ok(
    jaStart >= 0 && enStart > jaStart && accessorStart > enStart,
    "i18n.ts should keep jaMessages, enMessages, and messages in that order",
  );

  const jaTable = i18nSource.slice(jaStart, enStart);
  const enTable = i18nSource.slice(enStart, accessorStart);
  const accessors = i18nSource.slice(accessorStart);

  const declaredKeys = (table) =>
    new Set(
      [...table.matchAll(/(?:^|\n)\s{2}([A-Za-z0-9_]+):/g)].map(
        (match) => match[1],
      ),
    );

  const jaKeys = declaredKeys(jaTable);
  const enKeys = declaredKeys(enTable);
  assert.ok(
    jaKeys.size > 100,
    `expected a populated ja table, got ${jaKeys.size}`,
  );

  // accessor 外の helper が localize を呼んでも見逃さないよう、ファイル全体を見る
  const usedKeys = [
    ...new Set(
      [...i18nSource.matchAll(/localize\(\s*"([A-Za-z0-9_]+)"/g)].map(
        (match) => match[1],
      ),
    ),
  ].sort();
  assert.ok(usedKeys.length > 100, "expected many localize() call sites");

  const missingJa = usedKeys.filter((key) => !jaKeys.has(key));
  const missingEn = usedKeys.filter((key) => !enKeys.has(key));
  assert.deepStrictEqual(
    missingJa,
    [],
    `localize keys missing from jaMessages: ${missingJa.join(", ")}`,
  );
  assert.deepStrictEqual(
    missingEn,
    [],
    `localize keys missing from enMessages: ${missingEn.join(", ")}`,
  );

  const jaOnly = [...jaKeys].filter((key) => !enKeys.has(key)).sort();
  const enOnly = [...enKeys].filter((key) => !jaKeys.has(key)).sort();
  assert.deepStrictEqual(
    [jaOnly, enOnly],
    [[], []],
    `language tables drifted. ja-only: ${jaOnly.join(", ")} / en-only: ${enOnly.join(", ")}`,
  );

  // 片方だけ {1} を落とすと、その言語で引数が消えたまま表示される
  const placeholderCounts = (table) => {
    const counts = new Map();
    for (const match of table.matchAll(
      /(?:^|\n)\s{2}([A-Za-z0-9_]+):\s*([\s\S]*?)(?=\n\s{2}[A-Za-z0-9_]+:|\n\};)/g,
    )) {
      const indexes = new Set(
        [...match[2].matchAll(/\{(\d+)\}/g)].map((hit) => hit[1]),
      );
      counts.set(match[1], [...indexes].sort().join(","));
    }
    return counts;
  };

  const jaPlaceholders = placeholderCounts(jaTable);
  const enPlaceholders = placeholderCounts(enTable);
  const placeholderMismatches = [...jaPlaceholders.entries()]
    .filter(
      ([key, value]) =>
        enPlaceholders.has(key) && enPlaceholders.get(key) !== value,
    )
    .map(
      ([key, value]) => `${key}: ja={${value}} en={${enPlaceholders.get(key)}}`,
    );
  assert.deepStrictEqual(
    placeholderMismatches,
    [],
    `placeholder sets differ between languages: ${placeholderMismatches.join(" / ")}`,
  );
});

test("built-in setting descriptions explain provider-based grouping", () => {
  const setting =
    pkg.contributes.configuration.properties["skillNinja.showBuiltInSkills"];
  assert.ok(setting);
  assert.strictEqual(setting.default, true);
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

test("additional workspace root setting has settings UI fallback text", () => {
  const setting =
    pkg.contributes.configuration.properties["skillNinja.additionalSkillRoots"];
  assert.ok(setting);
  assert.strictEqual(setting.default.length, 0);
  assert.strictEqual(
    setting.description,
    "%config.additionalSkillRoots.description%",
  );
  assert.strictEqual(
    setting.markdownDescription,
    "%config.additionalSkillRoots.markdownDescription%",
  );
  assert.ok(packageNls["config.additionalSkillRoots.description"]);
  assert.ok(packageNlsJa["config.additionalSkillRoots.description"]);
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

test("Add Source docs and prompts accept GitHub folder/file URLs", () => {
  assert.ok(
    readme.includes("Add Source accepts a repository root URL") &&
      readme.includes("GitHub folder/file URL"),
  );
  assert.ok(
    readmeJa.includes("GitHub 上のフォルダ / ファイル URL") &&
      readmeJa.includes("リポジトリ root を解決"),
  );
  assert.ok(i18nSource.includes("folder/file URL inside the repository"));
  assert.ok(
    i18nSource.includes("フォルダ/ファイル URL") ||
      i18nSource.includes("フォルダ / ファイル URL"),
  );
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
  assert.ok(
    readme.includes(
      "Toolbar: Skill Output / Regenerate Skill Output / Create / Refresh View / Settings",
    ),
  );
  assert.ok(readme.includes("Open Skill Output quick links"));
  assert.ok(
    readme.includes(
      "workspace view, **Skill Output** opens the workspace root directly",
    ),
  );
  assert.ok(
    readme.includes("In `ref` mode, **Skill Output** opens the linked catalog"),
  );
  assert.ok(readme.includes("Agent Skills Ninja: Open Skill Output"));
  assert.ok(
    readmeJa.includes(
      "ツールバー: スキル出力 / スキル出力を再生成 / 新規作成 / ビューを更新 / 設定",
    ),
  );
  assert.ok(readmeJa.includes("空状態: 検索 / 新規作成 / スキル出力を開く"));
  assert.ok(
    readmeJa.includes(
      "workspace view の **スキル出力** は全 root の QuickPick を出さず",
    ),
  );
  assert.ok(
    readmeJa.includes(
      "`ref` モードでは **スキル出力** がリンク先 catalog を開き",
    ),
  );
  assert.ok(readme.includes("Default priority: VS Code user customizations"));
  assert.ok(readmeJa.includes("既定優先順は VS Code ユーザーカスタマイズ"));
  assert.ok(readmeJa.includes("Agent Skills Ninja: スキル出力を開く"));
});

test("view-specific output commands use distinct localized labels", () => {
  const nls = JSON.parse(
    fs.readFileSync(path.join(root, "package.nls.json"), "utf8"),
  );
  const nlsJa = JSON.parse(
    fs.readFileSync(path.join(root, "package.nls.ja.json"), "utf8"),
  );

  assert.strictEqual(
    nls["command.openWorkspaceOutput"],
    "Open Workspace Skill Output",
  );
  assert.strictEqual(
    nls["command.openUserGlobalOutput"],
    "Open User/Global Skill Output",
  );
  assert.strictEqual(
    nlsJa["command.openWorkspaceOutput"],
    "ワークスペースのスキル出力を開く",
  );
  assert.strictEqual(
    nlsJa["command.openUserGlobalOutput"],
    "ユーザー / グローバルのスキル出力を開く",
  );

  const commandEntries = pkg.contributes.commands || [];
  const workspaceOutputCommand = commandEntries.find(
    (item) => item.command === "skillNinja.openWorkspaceOutput",
  );
  const userGlobalOutputCommand = commandEntries.find(
    (item) => item.command === "skillNinja.openUserGlobalOutput",
  );

  assert.strictEqual(
    workspaceOutputCommand?.title,
    "%command.openWorkspaceOutput%",
  );
  assert.strictEqual(
    userGlobalOutputCommand?.title,
    "%command.openUserGlobalOutput%",
  );
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

test("GitHub auth recovery exposes token reset and token source diagnostics", () => {
  const clearToken = (pkg.contributes.commands || []).find(
    (command) => command.command === "skillNinja.clearGitHubToken",
  );

  assert.ok(clearToken);
  assert.strictEqual(clearToken.title, "%command.clearGitHubToken%");
  assert.strictEqual(
    packageNls["command.clearGitHubToken"],
    "Clear GitHub Token (SecretStorage only)",
  );
  assert.strictEqual(
    packageNlsJa["command.clearGitHubToken"],
    "GitHub トークンをクリア（SecretStorage のみ）",
  );
  assert.match(
    extensionSource,
    /registerCommand\(\s*"skillNinja\.clearGitHubToken",[\s\S]*?clearStoredGitHubTokenWithFeedback\(\);[\s\S]*?resetGitHubSsoCache\(\);/,
  );
  assert.match(
    extensionSource,
    /initializeGitHubAuth\(context\);\s*resetGitHubSsoCache\(\);/,
  );
  // SSO を認可しに行った直後は、ブロック判定を持ち越さない
  assert.match(
    extensionSource,
    /openExternal\(vscode\.Uri\.parse\(ssoUrl\)\);[\s\S]*?resetGitHubSsoCache\(\);/,
  );
  // 手動更新と source 追加の失敗にも、文字列一致ではなく分類で導線を出す
  const recoveryCallSites = extensionSource.match(
    /await offerGitHubFailureRecovery\(/g,
  );
  assert.ok(
    recoveryCallSites && recoveryCallSites.length >= 3,
    "every GitHub command failure path must offer the classified recovery",
  );
  assert.match(
    extensionSource,
    /context\.subscriptions\.push\([\s\S]*?\bclearGitHubTokenCmd\b[\s\S]*?\);/,
  );
  assert.ok(
    extensionSource.includes("GitHub Auth Src  : ${githubAuth.source}"),
  );
  assert.ok(
    extensionSource.includes("GitHub Auth Help : skillNinja.clearGitHubToken"),
  );
  // console を開かない利用者にも、共有ストアで捨てた source が伝わること
  assert.match(
    extensionSource,
    /getLastRejectedSharedSources\(\)[\s\S]*?Shared Src Drops/,
  );
  assert.ok(
    readme.includes(
      "Agent Skills Ninja: Clear GitHub Token (SecretStorage only)",
    ),
  );
  assert.ok(readme.includes("Agent Skills Ninja: Explain Skill State"));
  assert.ok(
    readmeJa.includes(
      "Agent Skills Ninja: GitHub トークンをクリア（SecretStorage のみ）",
    ),
  );
  assert.ok(readmeJa.includes("Agent Skills Ninja: スキル状態を診断"));
});

test("a deferred source index update stays resumable", () => {
  const command = pkg.contributes.commands.find(
    (entry) => entry.command === "skillNinja.resumeSourceIndexUpdate",
  );
  assert.ok(command, "the resume command must be contributed");
  assert.strictEqual(command.title, "%command.resumeSourceIndexUpdate%");
  assert.ok(packageNls["command.resumeSourceIndexUpdate"]);
  assert.ok(packageNlsJa["command.resumeSourceIndexUpdate"]);

  assert.match(
    extensionSource,
    /registerCommand\(\s*"skillNinja\.resumeSourceIndexUpdate",[\s\S]*?resumeRateLimitedSourceIndexUpdate\(/,
  );
  assert.match(
    extensionSource,
    /context\.subscriptions\.push\([\s\S]*?\bresumeSourceIndexUpdateCmd\b[\s\S]*?\);/,
  );

  // 1 回あたりの上限で溢れた分も持ち越す。渡さないと約束した再開が消える
  assert.match(
    extensionSource,
    /saveRateLimitResumeStateFromBatch\(\s*batchResult,\s*deferred,?\s*\)/,
  );
  // 走らせる前に state を捨てると、上限超過分が取りこぼされる
  assert.doesNotMatch(
    extensionSource,
    /toStaleSourceInfos\(index, state\.sourceIds\);\s*await writeRateLimitResumeState\(undefined\);/,
  );

  assert.ok(
    readme.includes("Agent Skills Ninja: Resume Deferred Source Index Update"),
  );
  assert.ok(readmeJa.includes("Agent Skills Ninja: 中断したソース更新を再開"));
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

test("view title bars use scope-specific output commands", () => {
  const installedCommands = titleMenuCommandsFor("skillNinja.installedView");
  const userGlobalCommands = titleMenuCommandsFor("skillNinja.userGlobalView");

  assert.ok(installedCommands.includes("skillNinja.openWorkspaceOutput"));
  assert.strictEqual(
    installedCommands.includes("skillNinja.openInstructionFile"),
    false,
  );
  assert.ok(userGlobalCommands.includes("skillNinja.openUserGlobalOutput"));
  assert.strictEqual(
    userGlobalCommands.includes("skillNinja.openInstructionFile"),
    false,
  );
});

test("managed root groups expose inline output update and reinstall actions", () => {
  const contextMenus = pkg.contributes.menus["view/item/context"] || [];

  for (const viewId of [
    "skillNinja.installedView",
    "skillNinja.userGlobalView",
  ]) {
    assert.ok(
      contextMenus.some(
        (item) =>
          item.command === "skillNinja.updateInstruction" &&
          item.when ===
            `view == ${viewId} && (viewItem == skillRootGroup || viewItem == skillRootGroupReinstallable)`,
      ),
      `${viewId} should expose skillNinja.updateInstruction on managed root groups`,
    );

    assert.ok(
      contextMenus.some(
        (item) =>
          item.command === "skillNinja.reinstallRoot" &&
          item.when ===
            `view == ${viewId} && viewItem == skillRootGroupReinstallable`,
      ),
      `${viewId} should expose skillNinja.reinstallRoot only on reinstallable root groups`,
    );
  }
});

test("missing installed-skill recovery stays source-aware and can disable future reinstall checks", () => {
  assert.ok(
    extensionSource.includes("refreshIndexForInstalledMetas(") &&
      extensionSource.includes("{ confirm: false }") &&
      extensionSource.includes("offerDisableMissingReinstallChecks"),
    "startup and reinstall missing-index recovery should use source-aware refresh and disable future checks",
  );
  assert.ok(
    extensionSource.includes("Do Not Check Again") &&
      extensionSource.includes("今後確認しない"),
    "missing upstream skills should offer a future-suppression action",
  );
});

test("localized command labels distinguish view refresh from output update", () => {
  assert.strictEqual(packageNls["command.refresh"], "Refresh View");
  assert.strictEqual(
    packageNls["command.updateInstruction"],
    "Regenerate Skill Output",
  );
  assert.strictEqual(packageNlsJa["command.refresh"], "ビューを更新");
  assert.strictEqual(
    packageNlsJa["command.updateInstruction"],
    "スキル出力を再生成",
  );
});

test("README files document root inline maintenance actions and renamed labels", () => {
  assert.ok(
    readme.includes(
      "Regenerate Skill Output / Create / Refresh View / Settings",
    ),
  );
  assert.ok(readme.includes("Reinstall Remote Skills in This Root"));
  assert.ok(readme.includes("disabled for future reinstall checks"));
  assert.ok(
    readme.includes("Legacy `source: unknown` skills without a `remotePath`"),
  );
  assert.ok(readme.includes("Agent Skills Ninja: Regenerate Skill Output"));

  assert.ok(
    readmeJa.includes(
      "スキル出力 / スキル出力を再生成 / 新規作成 / ビューを更新 / 設定",
    ),
  );
  assert.ok(readmeJa.includes("このルートのリモートスキルを再インストール"));
  assert.ok(readmeJa.includes("今後確認しない"));
  assert.ok(readmeJa.includes("`source: unknown` かつ `remotePath` が無い"));
  assert.ok(readmeJa.includes("Agent Skills Ninja: スキル出力を再生成"));
});

test("README command palette labels stay aligned with actual command titles", () => {
  for (const label of [
    "Agent Skills Ninja: Reinstall All Skills",
    "Agent Skills Ninja: Uninstall All Skills",
    "Agent Skills Ninja: Uninstall Multiple Skills",
    "Agent Skills Ninja: Reinstall Multiple Skills",
  ]) {
    assert.ok(
      readme.includes(label),
      `${label} should be documented in README`,
    );
  }

  assert.ok(readme.includes("Choose a managed root"));
  assert.ok(readme.includes("selected root"));
  assert.ok(readmeJa.includes("managed root を選んで"));
  assert.ok(readmeJa.includes("選択した root"));
});

test("README_ja command palette labels match localized command titles", () => {
  for (const label of [
    "Agent Skills Ninja: スキルを検索",
    "Agent Skills Ninja: インデックスを更新",
    "Agent Skills Ninja: GitHub で検索",
    "Agent Skills Ninja: ソースリポジトリを追加",
    "Agent Skills Ninja: ソースリポジトリを削除",
    "Agent Skills Ninja: スキルをアンインストール",
    "Agent Skills Ninja: インストール済みスキルを表示",
    "Agent Skills Ninja: 新規スキル作成",
    "Agent Skills Ninja: 全スキルを再インストール",
    "Agent Skills Ninja: 全スキルを削除",
    "Agent Skills Ninja: 複数スキルを削除",
    "Agent Skills Ninja: 複数スキルを再インストール",
    "Agent Skills Ninja: スキル出力を開く",
    "Agent Skills Ninja: スキル出力を再生成",
    "Agent Skills Ninja: スキルフォルダを開く",
  ]) {
    assert.ok(
      readmeJa.includes(label),
      `${label} should be documented in README_ja`,
    );
  }

  assert.strictEqual(
    readmeJa.includes("Agent Skills Ninja: Search Skills"),
    false,
  );
  assert.strictEqual(
    readmeJa.includes("Agent Skills Ninja: Update Index"),
    false,
  );
  assert.strictEqual(
    readmeJa.includes("Agent Skills Ninja: Open Skill Output"),
    false,
  );
  assert.ok(
    readmeJa.includes(
      "アクションを選択（インストール / プレビュー / お気に入りに追加 / GitHub で開く）",
    ),
  );
  assert.strictEqual(
    readmeJa.includes(
      "アクションを選択（Install / Preview / Favorite / GitHub）",
    ),
    false,
  );
});

test("README root-action docs avoid stale scope wording around root maintenance", () => {
  assert.ok(
    readme.includes("rows that contain at least one remote-backed skill"),
  );
  assert.ok(readme.includes("workspace root"));
  assert.ok(readme.includes("user/global root"));
  assert.ok(readme.includes("root picker"));
  assert.strictEqual(readme.includes("workspace scope"), false);
  assert.strictEqual(readme.includes("user/global scope"), false);
  assert.strictEqual(readme.includes("scope picker"), false);

  assert.ok(readmeJa.includes("remote-backed skill を 1 件以上含む root"));
  assert.ok(readmeJa.includes("workspace root のスキルフォルダ / ファイル"));
  assert.ok(
    readmeJa.includes("user/global root でもスキルフォルダ / ファイル"),
  );
  assert.ok(readmeJa.includes("ルートを選びたい場合は inline の Install"));
  assert.strictEqual(readmeJa.includes("workspace scope"), false);
  assert.strictEqual(readmeJa.includes("user/global scope"), false);
  assert.strictEqual(readmeJa.includes("スコープ選択したい場合"), false);
});

test("managed root pickers use root wording instead of scope wording", () => {
  assert.ok(extensionSource.includes('"Select the target skill root"'));
  assert.ok(extensionSource.includes('"Select the skill output root to open"'));
  assert.ok(extensionSource.includes('"インストール先のスキルルートを選択"'));
  assert.ok(extensionSource.includes('"開くスキル出力のルートを選択"'));
  assert.strictEqual(
    extensionSource.includes("Select the target skill scope"),
    false,
  );
  assert.strictEqual(
    extensionSource.includes("Select the skill output scope to open"),
    false,
  );
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

test("published text assets stay free of replacement characters", () => {
  for (const file of [
    "CHANGELOG.md",
    "README.md",
    "README_ja.md",
    "package.nls.json",
    "package.nls.ja.json",
  ]) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.strictEqual(
      text.includes("\uFFFD"),
      false,
      `${file} contains a replacement character, so an emoji or multibyte edit was corrupted`,
    );
  }
});

test("MCP source tools support private add and source removal flows", () => {
  const toolsByReference = new Map(
    pkg.contributes.languageModelTools.map((tool) => [
      tool.toolReferenceName,
      tool,
    ]),
  );

  assert.ok(toolsByReference.has("addSkillSource"));
  assert.ok(toolsByReference.has("removeSkillSource"));
  assert.ok(
    mcpToolsSource.includes('["skillNinja_removeSource", "removeSkillSource"]'),
  );
  assert.ok(mcpToolsSource.includes("class RemoveSourceTool"));
  assert.strictEqual(
    mcpToolsSource.includes("Repository must be public"),
    false,
  );

  const removeTool = toolsByReference.get("removeSkillSource");
  assert.ok(removeTool.modelDescription.includes("Remove a GitHub repository"));
  assert.ok(removeTool.inputSchema.properties.sourceId);
  assert.ok(removeTool.inputSchema.properties.repoUrl);
  assert.ok(removeTool.inputSchema.properties.sourceName);

  assert.ok(readme.includes("#removeSkillSource"));
  assert.ok(readmeJa.includes("#removeSkillSource"));
  assert.ok(readme.includes("#localizeSkill"));
  assert.ok(readmeJa.includes("#localizeSkill"));
  assert.ok(readme.includes("**10 Tools**"));
  assert.ok(readmeJa.includes("**10 ツール**"));
  assert.ok(readme.includes("Private source repositories are supported"));
  assert.ok(readmeJa.includes("Private source repository"));
});

test("GitHub token docs mention private repository read permissions", () => {
  assert.ok(packageNls["config.githubToken.description"].includes("private"));
  assert.ok(
    packageNls["config.githubToken.markdownDescription"].includes(
      "Contents: read",
    ),
  );
  assert.ok(
    packageNls["config.githubToken.markdownDescription"].includes("repo"),
  );
  assert.ok(
    packageNlsJa["config.githubToken.markdownDescription"].includes(
      "Contents: read",
    ),
  );
  assert.ok(readme.includes("Contents: read"));
  assert.ok(readme.includes("repo` scope"));
  assert.ok(readme.includes('reports `404` or "not found"'));
  assert.ok(readmeJa.includes("Contents: read"));
  assert.ok(readmeJa.includes("repo` scope"));
  assert.ok(readmeJa.includes("インデックス更新やバグ報告の前に"));
});

test("release instructions include the maintained npm test path", () => {
  assert.ok(releaseInstructions.includes("npm test"));
  assert.ok(releaseInstructions.includes("scripts/test-skill-scan-paths.js"));
  assert.ok(
    releaseInstructions.includes("scripts/test-local-skill-scanner.js"),
  );
  // 自動検出へ移行したので、手順書側もその契約を明示している必要がある
  assert.ok(
    releaseInstructions.includes("scripts/run-skill-tests.js"),
    "release instructions should name the auto-discovering runner",
  );
  assert.ok(
    releaseInstructions.includes("scripts/test-*.js"),
    "release instructions should state the discovery naming rule",
  );
  assert.ok(
    releaseInstructions.includes(
      "node scripts/audit-skill-installability.js --raw-only",
    ),
  );
  assert.ok(releaseInstructions.includes("code --install-extension"));
  assert.ok(releaseInstructions.includes("docs/**"));
  assert.ok(releaseInstructions.includes("VSCE の `pack` API"));
  assert.ok(releaseInstructions.includes("fallback 用 script / task"));
  assert.ok(releaseInstructions.includes("%TEMP%"));
  assert.ok(releaseInstructions.includes("DONE Published"));
  assert.ok(releaseInstructions.includes("追加 version bump しない"));
});

test("VSIX ignore rules keep demo docs out of the package", () => {
  const ignoreEntries = new Set(getVscodeIgnoreEntries().map(normalizePath));

  assert.ok(ignoreEntries.has("docs/**"));
  assert.ok(readme.includes("docs/screenshots/demo.gif"));
});

// テストランナーは並列なので、固定パスへ書く script が 1 本でもあると
// 落ち方が実行順に依存する。書き込む script は自前の temp を作ること
test("regression scripts that touch the filesystem use their own temp dir", () => {
  const mutatingApi =
    /(?:fs|fsPromises|fs\.promises)\.(writeFileSync|writeFile|mkdirSync|mkdir|rmSync|rm|rmdirSync|appendFileSync|appendFile|copyFileSync|copyFile|cpSync|cp|symlinkSync|symlink|linkSync|renameSync|rename|unlinkSync|unlink|truncateSync|truncate|createWriteStream|openSync)\(/;
  const offenders = [];
  let checked = 0;

  for (const entry of fs.readdirSync(path.join(root, "scripts"), {
    withFileTypes: true,
  })) {
    if (
      !entry.isFile() ||
      !entry.name.startsWith("test-") ||
      !entry.name.endsWith(".js")
    ) {
      continue;
    }

    const source = fs.readFileSync(
      path.join(root, "scripts", entry.name),
      "utf8",
    );
    if (!mutatingApi.test(source)) {
      continue;
    }

    checked += 1;
    if (!/mkdtempSync\(/.test(source)) {
      offenders.push(entry.name);
    }
  }

  assert.ok(checked > 0, "expected at least one filesystem-touching script");
  assert.deepStrictEqual(
    offenders,
    [],
    `these scripts mutate the filesystem without mkdtempSync: ${offenders.join(", ")}`,
  );
});

test("npm test regression scripts are not excluded by .gitignore", () => {
  const npmTestCommand = pkg.scripts.test || "";
  // `test` が単一ランナーになってからは、コマンド文字列を読むだけでは
  // 実際に走る 20 本以上の script を 1 本も検査できない
  const entryScripts = [
    ...new Set(npmTestCommand.match(/scripts\/[A-Za-z0-9._-]+\.js/g) || []),
  ];
  assert.ok(
    entryScripts.length > 0,
    "npm test should reference at least one script",
  );

  // ランナーと同じ発見規則を使う（scripts/run-skill-tests.js の discoverTestScripts）
  const discoveredScripts = fs
    .readdirSync(path.join(root, "scripts"), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith("test-") &&
        entry.name.endsWith(".js"),
    )
    .map((entry) => `scripts/${entry.name}`);

  // 名前を変えられた 1 本を件数だけでは検出できないので、
  // 落ちると痛い回帰テストは名指しで存在を要求する
  const criticalScripts = [
    "scripts/test-path-safety.js",
    "scripts/test-skill-installer-path-traversal.js",
    "scripts/test-package-manifest.js",
    "scripts/test-skill-locations.js",
    "scripts/test-coexistence.js",
  ];
  for (const scriptPath of criticalScripts) {
    assert.ok(
      discoveredScripts.includes(scriptPath),
      `${scriptPath} must stay discoverable by the runner's test-*.js rule`,
    );
  }

  assert.ok(
    discoveredScripts.length >= criticalScripts.length + 15,
    `expected the discovered regression suite, got ${discoveredScripts.length}`,
  );

  const regressionScripts = [
    ...new Set([...entryScripts, ...discoveredScripts]),
  ];

  const ignored = gitIgnoredPaths(regressionScripts);
  const ignoreMatchers = getGitIgnoreEntries().map(globToRegExp);

  for (const scriptPath of regressionScripts) {
    assert.ok(
      fs.existsSync(path.join(root, scriptPath)),
      `${scriptPath} should exist on disk`,
    );

    if (ignored) {
      assert.strictEqual(
        ignored.has(scriptPath),
        false,
        `${scriptPath} must not be excluded by .gitignore`,
      );
    } else {
      assert.strictEqual(
        ignoreMatchers.some((matcher) => matcher.test(scriptPath)),
        false,
        `${scriptPath} must not be excluded by .gitignore`,
      );
    }
  }
});

test("no tracked file is excluded by .gitignore", () => {
  if (!trackedFiles) {
    console.log("  (skipped: not a git checkout)");
    return;
  }

  // .gitignore は既に追跡済みのファイルには効かないので、
  // 「除外したつもりで commit され続けている」状態はパターン検査では見つからない
  const ignored = gitIgnoredPaths([...trackedFiles]);
  assert.ok(ignored, "git check-ignore should be available in a git checkout");

  assert.deepStrictEqual(
    [...ignored].sort(),
    [],
    "these files are listed in .gitignore but are still tracked; untrack them or drop the ignore rule",
  );
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

test("one-shot activation notices own a distinct workspaceState gate", () => {
  // gate を共有すると、片方が完了した時点でもう片方が永久に出なくなる。
  // 特に移行検出は、旧バージョンで gate 済みの環境にこそ届く必要がある。
  const keyDeclarations = [
    ...extensionSource.matchAll(
      /const\s+([A-Z0-9_]*STATE_KEY)\s*=\s*"([^"]+)"/g,
    ),
  ].map(([, identifier, value]) => ({ identifier, value }));

  assert.ok(
    keyDeclarations.length >= 2,
    "expected at least two one-shot state keys",
  );

  const values = keyDeclarations.map((entry) => entry.value);
  assert.strictEqual(
    new Set(values).size,
    values.length,
    `state key literals must be unique: ${values.join(", ")}`,
  );

  const normalizedExtensionSource = extensionSource.replace(/\r\n/g, "\n");
  const noticeFunctions = [
    ...normalizedExtensionSource.matchAll(
      /async function (notify[A-Za-z0-9]*Once)\([\s\S]*?\n^}$/gm,
    ),
  ].map((match) => [match[0], match[1], match[0]]);
  assert.ok(
    noticeFunctions.length >= 2,
    `expected at least two notify*Once functions, got ${noticeFunctions.length}`,
  );

  const usedKeys = new Map();
  for (const [, functionName, body] of noticeFunctions) {
    const referenced = keyDeclarations
      .map((entry) => entry.identifier)
      .filter((identifier) => body.includes(identifier));

    assert.ok(
      referenced.length >= 1,
      `${functionName} must reference at least one state key`,
    );

    // 通知ごとの gate は独立させる。補助的な scan gate の併用は許す
    for (const key of referenced) {
      assert.ok(
        !usedKeys.has(key),
        `${functionName} shares ${key} with ${usedKeys.get(key)}`,
      );
      usedKeys.set(key, functionName);

      assert.ok(
        new RegExp(
          `workspaceState\\.get<(?:boolean|string)>\\(\\s*\n?\\s*${key}`,
        ).test(body),
        `${functionName} must read ${key} so the notice is gated (one-shot flag or fingerprint)`,
      );

      assert.ok(
        new RegExp(`workspaceState\\.update\\(\\s*\n?\\s*${key}`).test(body),
        `${functionName} must persist ${key} so the notice stays gated`,
      );
    }
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

test("configWatcher watches root and ref catalog settings", () => {
  const extensionSource = fs.readFileSync(
    path.join(root, "src", "extension.ts"),
    "utf8",
  );
  assert.ok(
    extensionSource.includes(
      'affectsConfiguration("skillNinja.additionalSkillRoots")',
    ),
    "configWatcher must watch additionalSkillRoots",
  );
  assert.ok(
    extensionSource.includes("resetSkillMdWatchers();"),
    "root setting changes must recreate SKILL.md watchers",
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
    extensionSource.includes("async function openManagedOutputForRoot"),
    "open output flow should be centralized in helper",
  );
  assert.ok(
    extensionSource.includes("Select the skill output root to open"),
    "openInstructionFile quick pick should use skill output root wording",
  );
  assert.ok(
    extensionSource.includes("openManagedOutputForPreferredScope"),
    "extension should support view-scoped default output opening",
  );
  assert.ok(
    extensionSource.includes("scoreUserGlobalRoot"),
    "user/global default output root should use explicit priority",
  );
  assert.ok(
    extensionSource.includes('"skillNinja.openWorkspaceOutput"'),
    "workspace output command should exist",
  );
  assert.ok(
    extensionSource.includes('"skillNinja.openUserGlobalOutput"'),
    "user/global output command should exist",
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
