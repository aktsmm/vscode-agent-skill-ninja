#!/usr/bin/env node

const assert = require("assert");
const skillIndex = require("../resources/skill-index.json");
const {
  normalizePathPrefix,
  pathMatchesPrefix,
  isSkillPathAllowed,
  processTree,
  assertNoUnexpectedShrink,
  mergeUpdatedSkills,
} = require("./update-preset-index.js");

const pending = [];

function fail(name, error) {
  console.error(`FAIL ${name}`);
  console.error(error);
  process.exitCode = 1;
}

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      pending.push(
        result.then(
          () => console.log(`PASS ${name}`),
          (error) => fail(name, error),
        ),
      );
      return;
    }
    console.log(`PASS ${name}`);
  } catch (error) {
    fail(name, error);
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

// Preset completeness gate: keep the shipped index self-consistent so a stale
// bundle or an emptied source cannot reach users.
test("every skill points at a declared source", () => {
  const sourceIds = new Set(skillIndex.sources.map((source) => source.id));
  const orphans = [
    ...new Set(
      skillIndex.skills
        .filter((skill) => !sourceIds.has(skill.source))
        .map((skill) => skill.source),
    ),
  ];
  assert.deepStrictEqual(orphans, [], `Unknown skill sources: ${orphans}`);
});

test("every source contributes at least one skill", () => {
  const countsBySource = new Map();
  for (const skill of skillIndex.skills) {
    countsBySource.set(
      skill.source,
      (countsBySource.get(skill.source) || 0) + 1,
    );
  }
  const empty = skillIndex.sources
    .filter((source) => !countsBySource.get(source.id))
    .map((source) => source.id);
  assert.deepStrictEqual(empty, [], `Sources without skills: ${empty}`);
});

test("every bundled skill has a non-empty install path", () => {
  const emptyPaths = skillIndex.skills
    .filter((skill) => !String(skill.path || "").trim())
    .map((skill) => `${skill.source}:${skill.name}`);
  assert.deepStrictEqual(
    emptyPaths,
    [],
    `Skills with empty paths: ${emptyPaths}`,
  );
});

test("skill names are unique across the index", () => {
  const seen = new Set();
  const duplicates = [];
  for (const skill of skillIndex.skills) {
    const key = skill.name.toLowerCase();
    if (seen.has(key)) {
      duplicates.push(skill.name);
    }
    seen.add(key);
  }
  assert.deepStrictEqual(duplicates, [], `Duplicate skills: ${duplicates}`);
});

// runtime の bundle identity は source:id なので、検出単位も揃える
test("bundle ids are unique per source", () => {
  const seen = new Set();
  const duplicates = [];
  for (const bundle of skillIndex.bundles || []) {
    const key = `${bundle.source}:${bundle.id}`.toLowerCase();
    if (seen.has(key)) {
      duplicates.push(key);
    }
    seen.add(key);
  }
  assert.deepStrictEqual(duplicates, [], `Duplicate bundle ids: ${duplicates}`);
});

function findDanglingBundleReferences(index) {
  const sourceIds = new Set(index.sources.map((source) => source.id));
  const skillNamesBySource = new Map();
  for (const skill of index.skills) {
    if (!skillNamesBySource.has(skill.source)) {
      skillNamesBySource.set(skill.source, new Set());
    }
    skillNamesBySource.get(skill.source).add(skill.name);
  }

  const problems = [];
  for (const bundle of index.bundles || []) {
    if (!sourceIds.has(bundle.source)) {
      problems.push(`${bundle.id}: unknown source ${bundle.source}`);
      continue;
    }

    const available = skillNamesBySource.get(bundle.source) || new Set();
    const referenced = [
      ...(bundle.skills || []),
      ...(bundle.installOrder || []),
      ...(bundle.coreSkill ? [bundle.coreSkill] : []),
    ];
    for (const name of referenced) {
      if (!available.has(name)) {
        problems.push(`${bundle.id}: missing skill ${name}`);
      }
    }
  }

  return problems;
}

test("bundles only reference skills that exist in their source", () => {
  const problems = findDanglingBundleReferences(skillIndex);
  assert.deepStrictEqual(
    problems,
    [],
    `Dangling bundle references: ${problems}`,
  );
});

test("the bundle gate detects a stale bundle reference", () => {
  const problems = findDanglingBundleReferences({
    sources: [{ id: "demo" }],
    skills: [{ name: "kept", source: "demo" }],
    bundles: [
      {
        id: "stale",
        source: "demo",
        skills: ["kept", "removed-upstream"],
        coreSkill: "removed-upstream",
      },
    ],
  });
  assert.deepStrictEqual(problems, [
    "stale: missing skill removed-upstream",
    "stale: missing skill removed-upstream",
  ]);
});

test("bundle installOrder covers exactly the bundled skills", () => {
  const mismatches = [];
  for (const bundle of skillIndex.bundles || []) {
    if (!bundle.installOrder) {
      continue;
    }
    const skills = [...(bundle.skills || [])].sort();
    const order = [...bundle.installOrder].sort();
    if (JSON.stringify(skills) !== JSON.stringify(order)) {
      mismatches.push(bundle.id);
    }
  }
  assert.deepStrictEqual(
    mismatches,
    [],
    `installOrder does not match skills: ${mismatches}`,
  );
});

test("the preset index generator refuses truncated GitHub trees", async () => {
  await assert.rejects(
    () =>
      processTree({ tree: [], truncated: true }, "example", "demo", "main", {}),
    /truncated/i,
  );
});

test("the preset index generator skips a repository-root SKILL.md", async () => {
  const skills = await processTree(
    { tree: [{ type: "blob", path: "SKILL.md" }] },
    "example",
    "demo",
    "main",
    { id: "demo" },
  );
  assert.deepStrictEqual(skills, []);
});

test("the preset index generator refuses scanners it cannot run", async () => {
  await assert.rejects(
    () =>
      processTree({ tree: [] }, "example", "demo", "main", {
        id: "demo",
        scanner: "top-level-dirs",
      }),
    /does not implement/i,
  );
});

test("preset sources that rely on a fallback scanner declare it explicitly", () => {
  const composio = skillIndex.sources.find(
    (source) => source.id === "composio-awesome",
  );
  assert.ok(composio, "Expected composio-awesome source in bundled index");
  assert.strictEqual(composio.scanner, "top-level-dirs");
});

test("the generator refuses a sharp per-source skill drop", () => {
  const source = { id: "demo" };
  assert.ok(assertNoUnexpectedShrink(source, 850, 0));
  assert.ok(assertNoUnexpectedShrink(source, 850, 100));
  assert.strictEqual(assertNoUnexpectedShrink(source, 850, 840), undefined);
  assert.strictEqual(assertNoUnexpectedShrink(source, 0, 0), undefined);
});

test("a partial update cannot steal a name from an untouched source", () => {
  const merged = mergeUpdatedSkills(
    [
      { name: "shared", source: "updated", path: "skills/shared" },
      { name: "new", source: "updated", path: "skills/new" },
    ],
    [
      { name: "shared", source: "untouched", path: "skills/shared" },
      { name: "old", source: "updated", path: "skills/old" },
    ],
    new Set(["updated"]),
  );

  assert.strictEqual(
    merged.find((skill) => skill.name === "shared").source,
    "untouched",
  );
  assert.ok(merged.some((skill) => skill.name === "new"));
  assert.ok(!merged.some((skill) => skill.name === "old"));
});

test("regenerated sources carry a lastIndexedAt stamp", () => {
  const regenerated = skillIndex.sources.find(
    (source) => source.id === "prps-agentic",
  );
  assert.ok(regenerated, "Expected prps-agentic source in bundled index");
  assert.strictEqual(typeof regenerated.lastIndexedAt, "string");
});

Promise.all(pending).then(() => {
  if (process.exitCode) {
    process.exit(process.exitCode);
  }
});
