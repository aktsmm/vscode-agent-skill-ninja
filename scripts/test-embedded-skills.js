/**
 * Embedded skill (SKILL.md inside another skill folder) regression tests.
 * Run: node scripts/test-embedded-skills.js
 */

const assert = require("assert");
const { loadSrcModule } = require("./load-src-module");

const {
  findEmbeddedParentPath,
  isEmbeddedSkillPath,
  buildEmbeddedHierarchy,
  getPathRelativeToParent,
} = loadSrcModule("./embeddedSkills");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("findEmbeddedParentPath returns the nearest ancestor skill", () => {
  const paths = new Set([
    "customer-workspace",
    "customer-workspace/assets/workspace-skills/inbox",
    "customer-workspace/assets/workspace-skills/inbox/deep/leaf",
  ]);
  assert.strictEqual(
    findEmbeddedParentPath(
      "customer-workspace/assets/workspace-skills/inbox",
      paths,
    ),
    "customer-workspace",
  );
  assert.strictEqual(
    findEmbeddedParentPath(
      "customer-workspace/assets/workspace-skills/inbox/deep/leaf",
      paths,
    ),
    "customer-workspace/assets/workspace-skills/inbox",
  );
});

test("findEmbeddedParentPath ignores siblings, prefixes and top-level skills", () => {
  const paths = new Set(["docx", "docx-extra", "browser-max-automation"]);
  assert.strictEqual(findEmbeddedParentPath("docx", paths), undefined);
  assert.strictEqual(findEmbeddedParentPath("docx-extra", paths), undefined);
  assert.strictEqual(isEmbeddedSkillPath("docx-extra", paths), false);
});

test("findEmbeddedParentPath does not treat the skill root itself as a parent", () => {
  const paths = new Set(["", "docx"]);
  assert.strictEqual(findEmbeddedParentPath("docx", paths), undefined);
});

test("findEmbeddedParentPath accepts backslash separators", () => {
  const paths = new Set(["pack"]);
  assert.strictEqual(findEmbeddedParentPath("pack\\child", paths), "pack");
});

test("buildEmbeddedHierarchy nests children and keeps input order", () => {
  const skills = [
    { relativePath: "a" },
    { relativePath: "customer-workspace" },
    { relativePath: "customer-workspace/assets/inbox" },
    { relativePath: "customer-workspace/assets/extract-questions" },
    { relativePath: "z" },
  ];
  const hierarchy = buildEmbeddedHierarchy(skills);

  assert.deepStrictEqual(
    hierarchy.topLevel.map((skill) => skill.relativePath),
    ["a", "customer-workspace", "z"],
  );
  assert.deepStrictEqual(
    hierarchy.childrenOf("customer-workspace").map((s) => s.relativePath),
    [
      "customer-workspace/assets/inbox",
      "customer-workspace/assets/extract-questions",
    ],
  );
  assert.deepStrictEqual(hierarchy.childrenOf("a"), []);
  assert.strictEqual(
    hierarchy.parentOf("customer-workspace/assets/inbox"),
    "customer-workspace",
  );
  assert.strictEqual(hierarchy.parentOf("a"), undefined);
});

test("buildEmbeddedHierarchy promotes a child when its parent is filtered out", () => {
  const hierarchy = buildEmbeddedHierarchy([
    { relativePath: "pack/child" },
    { relativePath: "other" },
  ]);
  assert.deepStrictEqual(
    hierarchy.topLevel.map((skill) => skill.relativePath),
    ["pack/child", "other"],
  );
});

test("buildEmbeddedHierarchy attaches to the nearest visible ancestor", () => {
  const hierarchy = buildEmbeddedHierarchy([
    { relativePath: "pack" },
    { relativePath: "pack/mid/leaf" },
  ]);
  assert.strictEqual(hierarchy.parentOf("pack/mid/leaf"), "pack");
});

test("getPathRelativeToParent shortens the path under the parent", () => {
  assert.strictEqual(
    getPathRelativeToParent("pack/assets/inbox", "pack"),
    "assets/inbox",
  );
  assert.strictEqual(getPathRelativeToParent("pack/x", undefined), "pack/x");
  assert.strictEqual(getPathRelativeToParent("other/x", "pack"), "other/x");
});

console.log("All embedded skill tests passed.");
