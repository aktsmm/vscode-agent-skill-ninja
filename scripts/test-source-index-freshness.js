#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const modulePath = path.join(repoRoot, "src", "sourceIndexFreshness.ts");

function loadModule() {
  const source = fs.readFileSync(modulePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: modulePath,
  });

  const module = { exports: {} };
  vm.runInNewContext(
    transpiled.outputText,
    {
      module,
      exports: module.exports,
      require,
      console,
      Number,
      Date,
    },
    { filename: modulePath },
  );
  return module.exports;
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

const { getSourceIndexAgeDays, getStaleSources } = loadModule();
const now = new Date("2026-06-24T12:00:00.000Z");

function createIndex(overrides = {}) {
  return {
    lastUpdated: "2026-06-01",
    sources: [],
    ...overrides,
  };
}

test("sources older than 30 days are stale", () => {
  const index = createIndex({
    sources: [
      {
        id: "old",
        name: "Old",
        url: "https://github.com/example/old",
        type: "preset",
        description: "Old source",
        lastIndexedAt: "2026-05-20T00:00:00.000Z",
      },
    ],
  });

  const stale = getStaleSources(index, 30, now);
  assert.deepStrictEqual(
    stale.map((entry) => entry.source.id),
    ["old"],
  );
});

test("sources at or under the 30 day threshold are not stale", () => {
  const index = createIndex({
    sources: [
      {
        id: "exact",
        name: "Exact",
        url: "https://github.com/example/exact",
        type: "preset",
        description: "Exact source",
        lastIndexedAt: "2026-05-25T12:00:00.000Z",
      },
      {
        id: "new",
        name: "New",
        url: "https://github.com/example/new",
        type: "preset",
        description: "New source",
        lastIndexedAt: "2026-06-20T00:00:00.000Z",
      },
    ],
  });

  assert.deepStrictEqual(getStaleSources(index, 30, now), []);
});

test("missing per-source timestamp falls back to global lastUpdated", () => {
  const staleIndex = createIndex({
    lastUpdated: "2026-05-01",
    sources: [
      {
        id: "fallback-old",
        name: "Fallback Old",
        url: "https://github.com/example/fallback-old",
        type: "preset",
        description: "Fallback old source",
      },
    ],
  });
  assert.deepStrictEqual(
    getStaleSources(staleIndex, 30, now).map((entry) => entry.source.id),
    ["fallback-old"],
  );

  const freshIndex = createIndex({
    lastUpdated: "2026-06-20",
    sources: [
      {
        id: "fallback-new",
        name: "Fallback New",
        url: "https://github.com/example/fallback-new",
        type: "preset",
        description: "Fallback new source",
      },
    ],
  });
  assert.deepStrictEqual(getStaleSources(freshIndex, 30, now), []);
});

test("invalid timestamps are reported as unknown stale sources", () => {
  const index = createIndex({
    sources: [
      {
        id: "invalid",
        name: "Invalid",
        url: "https://github.com/example/invalid",
        type: "preset",
        description: "Invalid source",
        lastIndexedAt: "not-a-date",
      },
    ],
  });

  const stale = getStaleSources(index, 30, now);
  assert.strictEqual(stale.length, 1);
  assert.strictEqual(stale[0].source.id, "invalid");
  assert.strictEqual(stale[0].isUnknown, true);
});

test("future timestamps are treated as fresh", () => {
  const index = createIndex({
    sources: [
      {
        id: "future",
        name: "Future",
        url: "https://github.com/example/future",
        type: "preset",
        description: "Future source",
        lastIndexedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
  });

  assert.deepStrictEqual(getStaleSources(index, 30, now), []);
  const age = getSourceIndexAgeDays(index.sources[0], index, now);
  assert.strictEqual(age.lastIndexedAt, "2026-07-01T00:00:00.000Z");
  assert.strictEqual(age.daysOld, 0);
  assert.strictEqual(age.isUnknown, false);
});
