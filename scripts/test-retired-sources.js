#!/usr/bin/env node

// 退役 preset source が merge でローカル index から消えることを検証する。

const assert = require("assert");
const { loadSrcModule } = require("./load-src-module");

const { applyRetiredSources, getRetiredSourceIds } =
  loadSrcModule("./retiredSources");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function createIndex() {
  return {
    version: "1.0.0",
    lastUpdated: "2026-08-01",
    sources: [
      {
        id: "kept",
        name: "Kept",
        url: "https://github.com/example/kept",
        type: "official",
        description: "",
      },
      {
        id: "gone",
        name: "Gone",
        url: "https://github.com/example/gone",
        type: "official",
        description: "",
      },
    ],
    skills: [
      {
        name: "a",
        source: "kept",
        path: "skills/a",
        categories: [],
        description: "",
      },
      {
        name: "b",
        source: "gone",
        path: "skills/b",
        categories: [],
        description: "",
      },
    ],
    categories: [],
    bundles: [
      {
        id: "kept-bundle",
        name: "Kept",
        source: "kept",
        description: "",
        skills: ["a"],
      },
      {
        id: "gone-bundle",
        name: "Gone",
        source: "gone",
        description: "",
        skills: ["b"],
      },
    ],
  };
}

test("retired sources drop their sources, skills and bundles", () => {
  const applied = applyRetiredSources(createIndex(), [
    { id: "gone", supersededBy: "kept" },
  ]);

  assert.deepStrictEqual(
    Array.from(applied.sources.map((source) => source.id)),
    ["kept"],
  );
  assert.deepStrictEqual(
    Array.from(applied.skills.map((skill) => skill.source)),
    ["kept"],
  );
  assert.deepStrictEqual(
    Array.from(applied.bundles.map((bundle) => bundle.id)),
    ["kept-bundle"],
  );
});

test("retired skills are dropped instead of being remapped to the successor", () => {
  const applied = applyRetiredSources(createIndex(), [
    { id: "gone", supersededBy: "kept" },
  ]);

  // path は退役元リポジトリのものなので、id を付け替えると raw 取得が 404 になる
  assert.ok(
    !applied.skills.some((skill) => skill.path === "skills/b"),
    "successor must not inherit the retired repository path",
  );
});

test("an empty retirement list leaves the index untouched", () => {
  const index = createIndex();
  assert.strictEqual(applyRetiredSources(index, undefined), index);
  assert.strictEqual(applyRetiredSources(index, []), index);
  assert.strictEqual(
    applyRetiredSources(index, [{ id: "not-present" }]).sources.length,
    2,
  );
});

test("retired ids ignore blank entries", () => {
  const ids = getRetiredSourceIds([
    { id: " spaced " },
    { id: "" },
    undefined,
    { id: "real" },
  ]);

  assert.deepStrictEqual(Array.from(ids).sort(), ["real", "spaced"]);
});
