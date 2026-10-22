#!/usr/bin/env node

// rootId / ラベル / 読み手の対応を固定する。
// Agents Home (~/.agents) と Codex Home (~/.codex) を取り違えないことが目的。

const assert = require("assert");
const path = require("path");
const { loadSrcModule } = require("./load-src-module.js");

const {
  formatRootReaders,
  formatRootWithPath,
  getCodexHomeSkillsPath,
  resolveSkillRootIdentity,
} = loadSrcModule("./skillRootIds");

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(`  ${error.stack || error.message}`);
  }
}

const home = path.join(path.sep, "home", "tester");
const user = (...segments) => ({
  scope: "userGlobal",
  rootPath: path.join(home, ...segments),
  displayPath: `~/${segments.join("/")}`,
});

test("each home root has its own stable id", () => {
  const ids = [
    [".copilot", "skills"],
    [".claude", "skills"],
    [".agents", "skills"],
    [".codex", "skills"],
  ].map((segments) => resolveSkillRootIdentity(user(...segments), home).id);
  assert.deepStrictEqual(ids, [
    "home-copilot",
    "home-claude",
    "home-agents",
    "home-codex",
  ]);
});

test("Agents Home and Codex Home are labelled differently and carry their real path", () => {
  const agents = resolveSkillRootIdentity(user(".agents", "skills"), home);
  const codex = resolveSkillRootIdentity(user(".codex", "skills"), home);
  assert.notStrictEqual(agents.label.en, codex.label.en);
  assert.strictEqual(
    formatRootWithPath(codex, "~/.codex/skills", false),
    "Codex Home (~/.codex/skills)",
  );
  assert.strictEqual(
    formatRootWithPath(agents, "~/.agents/skills", true),
    "共通 Agents ホーム (~/.agents/skills)",
  );
});

test("readers name the agents that actually read the root", () => {
  const readers = (segments) =>
    resolveSkillRootIdentity(user(...segments), home).readers;
  assert.deepStrictEqual(readers([".copilot", "skills"]), ["GitHub Copilot"]);
  assert.deepStrictEqual(readers([".agents", "skills"]), [
    "Codex",
    "GitHub Copilot",
  ]);
  assert.deepStrictEqual(readers([".codex", "skills"]), ["Codex"]);
  assert.strictEqual(
    formatRootReaders(resolveSkillRootIdentity(user(".codex", "skills"), home), true),
    "参照: Codex",
  );
  assert.strictEqual(
    formatRootReaders(resolveSkillRootIdentity(user("elsewhere", "skills"), home), false),
    undefined,
  );
});

test("workspace and custom roots never collide with a home root id", () => {
  const workspace = resolveSkillRootIdentity(
    {
      scope: "workspace",
      rootPath: path.join(path.sep, "repo", ".agents", "skills"),
      displayPath: ".agents/skills",
    },
    home,
  );
  assert.strictEqual(workspace.id, "workspace:.agents/skills");

  const custom = resolveSkillRootIdentity(
    user("somewhere", "skills"),
    home,
  );
  assert.match(custom.id, /^custom:[0-9a-f]{8}$/);
  assert.strictEqual(
    resolveSkillRootIdentity(user("somewhere", "skills"), home).id,
    custom.id,
  );
});

test("exact matching keeps a look-alike folder from taking a home id; display matching is looser", () => {
  const lookalike = {
    scope: "userGlobal",
    rootPath: path.join(path.sep, "other", "person", ".codex", "skills"),
    displayPath: "/other/person/.codex/skills",
  };
  assert.match(resolveSkillRootIdentity(lookalike, home).id, /^custom:/);
  assert.strictEqual(
    resolveSkillRootIdentity(lookalike, home, process.platform, {
      matchBySuffix: true,
    }).id,
    "home-codex",
  );
});

test("codex home path is ~/.codex/skills", () => {
  assert.strictEqual(
    getCodexHomeSkillsPath(home),
    path.join(home, ".codex", "skills"),
  );
});

if (failures > 0) {
  console.error(`\n${failures} skill root id test(s) failed.`);
  process.exit(1);
}
console.log("\nSkill root id tests passed.");
