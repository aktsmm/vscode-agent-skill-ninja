#!/usr/bin/env node

const assert = require("assert");
const skillIndex = require("../resources/skill-index.json");
const {
  normalizePathPrefix,
  pathMatchesPrefix,
  isSkillPathAllowed,
} = require("./update-preset-index.js");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

test("normalizePathPrefix trims slashes and normalizes case", () => {
  assert.strictEqual(normalizePathPrefix("/Skills/Alpha/"), "skills/alpha");
  assert.strictEqual(
    normalizePathPrefix("plugins\\Demo\\Skills"),
    "plugins/demo/skills",
  );
});

test("pathMatchesPrefix respects directory boundaries", () => {
  assert.strictEqual(pathMatchesPrefix("skills/alpha", "skills"), true);
  assert.strictEqual(
    pathMatchesPrefix("skills/alpha/skill.md", "skills"),
    true,
  );
  assert.strictEqual(pathMatchesPrefix("skills-extra/alpha", "skills"), false);
});

test("isSkillPathAllowed accepts included skill paths", () => {
  assert.strictEqual(
    isSkillPathAllowed("skills/ultragoal/SKILL.md", {
      includePaths: ["skills"],
    }),
    true,
  );
});

test("isSkillPathAllowed rejects paths outside includePaths", () => {
  assert.strictEqual(
    isSkillPathAllowed("plugins/oh-my-codex/skills/ultragoal/SKILL.md", {
      includePaths: ["skills"],
    }),
    false,
  );
});

test("isSkillPathAllowed applies excludePaths after includePaths", () => {
  assert.strictEqual(
    isSkillPathAllowed("skills/archive/old/SKILL.md", {
      includePaths: ["skills"],
      excludePaths: ["skills/archive"],
    }),
    false,
  );
});

test("oh-my-codex bundled skills match includePaths guard", () => {
  const source = skillIndex.sources.find((item) => item.id === "oh-my-codex");
  assert.ok(source, "Expected oh-my-codex source in bundled index");
  const omxSkills = skillIndex.skills.filter(
    (skill) => skill.source === "oh-my-codex",
  );
  assert.ok(omxSkills.length > 0, "Expected oh-my-codex skills in index");

  for (const skill of omxSkills) {
    assert.strictEqual(
      isSkillPathAllowed(`${skill.path}/SKILL.md`, source),
      true,
      `oh-my-codex skill path should match source filters: ${skill.path}`,
    );
  }
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
