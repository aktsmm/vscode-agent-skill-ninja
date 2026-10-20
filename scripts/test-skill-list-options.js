/**
 * Shared filter / sort logic for the Installed, User-Global and Browse views,
 * plus the frontmatter helpers the remote index uses to record invocation mode.
 * Run: node scripts/test-skill-list-options.js
 */

const assert = require("assert");
const { loadSrcModule } = require("./load-src-module");

const {
  BROWSE_SORT_MODES,
  LOCAL_SORT_MODES,
  compareSkillsByMode,
  hasInvocationData,
  matchesInvocationFilter,
  normalizeInvocationFilter,
  normalizeSortMode,
  sortSkills,
} = loadSrcModule("./skillListOptions");
const { parseSkillExecutionContext, resolveSkillInvocationFromValues } =
  loadSrcModule("./skillInvocation");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const skills = [
  { name: "charlie", stars: 5, invocation: "auto" },
  { name: "alpha", stars: 50, invocation: "explicitOnly" },
  { name: "bravo", invocation: "modelOnly" },
  { name: "delta", stars: 50, invocation: "explicitOnly" },
  { name: "echo" },
];
const names = (list) => list.map((skill) => skill.name);

run("filter keeps only the requested invocation mode", () => {
  assert.deepStrictEqual(
    names(skills.filter((s) => matchesInvocationFilter(s, "explicitOnly"))),
    ["alpha", "delta"],
  );
  assert.deepStrictEqual(
    names(skills.filter((s) => matchesInvocationFilter(s, "modelOnly"))),
    ["bravo"],
  );
  assert.strictEqual(
    skills.filter((s) => matchesInvocationFilter(s, "all")).length,
    skills.length,
  );
});

run("a skill whose mode is unknown is treated as auto", () => {
  assert.deepStrictEqual(
    names(skills.filter((s) => matchesInvocationFilter(s, "auto"))),
    ["charlie", "echo"],
  );
});

run("sorting by name is alphabetical and does not mutate the input", () => {
  const before = names(skills);
  assert.deepStrictEqual(names(sortSkills(skills, "name")), [
    "alpha",
    "bravo",
    "charlie",
    "delta",
    "echo",
  ]);
  assert.deepStrictEqual(names(skills), before);
});

run("sorting by stars puts the most starred first, ties by name", () => {
  assert.deepStrictEqual(names(sortSkills(skills, "stars")), [
    "alpha",
    "delta",
    "charlie",
    "bravo",
    "echo",
  ]);
});

run("sorting by invocation puts manual-only first, then model-only", () => {
  assert.deepStrictEqual(names(sortSkills(skills, "invocation")), [
    "alpha",
    "delta",
    "bravo",
    "charlie",
    "echo",
  ]);
});

run("default sort keeps the incoming order", () => {
  assert.deepStrictEqual(names(sortSkills(skills, "default")), names(skills));
  assert.strictEqual(compareSkillsByMode(skills[0], skills[1], "default"), 0);
});

run("stored values are normalized per view", () => {
  assert.strictEqual(normalizeInvocationFilter("explicitOnly"), "explicitOnly");
  assert.strictEqual(normalizeInvocationFilter("bogus"), "all");
  assert.strictEqual(normalizeInvocationFilter(undefined), "all");
  assert.strictEqual(normalizeSortMode("stars", BROWSE_SORT_MODES), "stars");
  // stars は Browse 専用、invocation はローカル専用
  assert.strictEqual(normalizeSortMode("stars", LOCAL_SORT_MODES), "default");
  assert.strictEqual(
    normalizeSortMode("invocation", BROWSE_SORT_MODES),
    "default",
  );
});

run("index without invocation data is detected", () => {
  assert.strictEqual(hasInvocationData([{ name: "a" }, { name: "b" }]), false);
  assert.strictEqual(
    hasInvocationData([{ name: "a" }, { invocation: "auto" }]),
    true,
  );
});

run("remote frontmatter values resolve like the local scanner", () => {
  assert.strictEqual(resolveSkillInvocationFromValues({}), "auto");
  assert.strictEqual(
    resolveSkillInvocationFromValues({ disableModelInvocation: "true" }),
    "explicitOnly",
  );
  assert.strictEqual(
    resolveSkillInvocationFromValues({ disableModelInvocation: "TRUE" }),
    "explicitOnly",
  );
  assert.strictEqual(
    resolveSkillInvocationFromValues({ userInvocable: "false" }),
    "modelOnly",
  );
  assert.strictEqual(
    resolveSkillInvocationFromValues({ userInvocable: "true" }),
    "auto",
  );
  // 両方立っているときは、誰も自動では使わない手動専用を優先する
  assert.strictEqual(
    resolveSkillInvocationFromValues({
      disableModelInvocation: "true",
      userInvocable: "false",
    }),
    "explicitOnly",
  );
});

run("only context: fork is recognized", () => {
  assert.strictEqual(parseSkillExecutionContext("fork"), "fork");
  assert.strictEqual(parseSkillExecutionContext(" Fork "), "fork");
  assert.strictEqual(parseSkillExecutionContext("inline"), undefined);
  assert.strictEqual(parseSkillExecutionContext(undefined), undefined);
});

run("labels and icons make manual-only and model-only skills stand out", () => {
  const { getInvocationIconId, getInvocationLabelText } =
    loadSrcModule("./skillInvocation");
  assert.strictEqual(
    getInvocationLabelText("explicitOnly", false),
    "Manual only",
  );
  assert.strictEqual(getInvocationLabelText("explicitOnly", true), "手動専用");
  assert.strictEqual(getInvocationLabelText("modelOnly", false), "Model only");
  assert.strictEqual(getInvocationLabelText(undefined, true), "自動");
  assert.strictEqual(
    getInvocationIconId("explicitOnly", "package"),
    "play-circle",
  );
  assert.strictEqual(getInvocationIconId("modelOnly", "package"), "hubot");
  assert.strictEqual(getInvocationIconId(undefined, "package"), "package");
});
