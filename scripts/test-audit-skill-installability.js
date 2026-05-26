#!/usr/bin/env node

const assert = require("assert");
const path = require("path");

const {
  normalizeRepoUrl,
  getRepoParts,
  normalizeSkillPath,
  auditSkill,
  buildPrunedIndex,
} = require(path.join(__dirname, "audit-skill-installability.js"));

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("normalizeRepoUrl strips tree/blob/query/hash suffixes", () => {
  assert.strictEqual(
    normalizeRepoUrl(
      "https://github.com/aktsmm/Agent-Skills/tree/master/local-media-transcription?tab=readme#top",
    ),
    "https://github.com/aktsmm/Agent-Skills",
  );
  assert.strictEqual(
    normalizeRepoUrl(
      "https://github.com/aktsmm/Agent-Skills/blob/master/local-media-transcription/SKILL.md",
    ),
    "https://github.com/aktsmm/Agent-Skills",
  );
});

test("getRepoParts resolves normalized owner/repo", () => {
  assert.deepStrictEqual(
    getRepoParts(
      "https://github.com/openai/skills/blob/main/skills/test/SKILL.md",
    ),
    {
      owner: "openai",
      repo: "skills",
      normalized: "https://github.com/openai/skills",
    },
  );
});

test("normalizeSkillPath trims surrounding slashes", () => {
  assert.strictEqual(normalizeSkillPath("/skills/example/"), "skills/example");
});

test("auditSkill accepts markdown file paths and directory SKILL.md paths", () => {
  const sourceMap = new Map([
    ["sample", { id: "sample", url: "https://github.com/owner/repo" }],
  ]);
  const treeBySource = new Map([
    [
      "sample",
      {
        blobs: new Set([
          "skills/file-based.md",
          "skills/folder-based/SKILL.md",
        ]),
      },
    ],
  ]);

  assert.deepStrictEqual(
    auditSkill(
      { source: "sample", name: "file-based", path: "skills/file-based.md" },
      sourceMap,
      treeBySource,
    ),
    { ok: true },
  );
  assert.deepStrictEqual(
    auditSkill(
      { source: "sample", name: "folder-based", path: "skills/folder-based" },
      sourceMap,
      treeBySource,
    ),
    { ok: true },
  );
});

test("auditSkill reports missing directory SKILL.md", () => {
  const sourceMap = new Map([
    ["sample", { id: "sample", url: "https://github.com/owner/repo" }],
  ]);
  const treeBySource = new Map([["sample", { blobs: new Set() }]]);

  assert.deepStrictEqual(
    auditSkill(
      { source: "sample", name: "broken", path: "skills/broken" },
      sourceMap,
      treeBySource,
    ),
    { ok: false, reason: "missing SKILL.md: skills/broken/SKILL.md" },
  );
});

test("buildPrunedIndex removes failed skills and bumps minor version", () => {
  const currentIndex = {
    version: "1.19.0",
    lastUpdated: "2026-05-26",
    skills: [
      { source: "a", name: "keep", path: "skills/keep" },
      { source: "b", name: "drop", path: "skills/drop" },
    ],
  };

  const { nextIndex, nextVersion, prunedSkills } = buildPrunedIndex(
    currentIndex,
    [{ source: "b", name: "drop", path: "skills/drop" }],
  );

  assert.strictEqual(nextVersion, "1.20.0");
  assert.strictEqual(nextIndex.version, "1.20.0");
  assert.strictEqual(prunedSkills.length, 1);
  assert.deepStrictEqual(prunedSkills[0], {
    source: "a",
    name: "keep",
    path: "skills/keep",
  });
});

console.log("\nAudit installability tests passed.");
