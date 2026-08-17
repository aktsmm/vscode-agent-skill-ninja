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

const {
  decideStaleSourceIndexAction,
  getSourceIndexAgeDays,
  pickNewerIndexedSource,
  getStaleSources,
  selectStaleSourcesForRun,
  MAX_STALE_SOURCE_UPDATES_PER_RUN,
} = loadModule();
const now = new Date("2026-06-24T12:00:00.000Z");

function staleEntry(id, daysOld) {
  return { source: { id }, daysOld, isUnknown: false };
}

test("a stale batch is capped and the rest is deferred", () => {
  const entries = Array.from({ length: 13 }, (_, index) =>
    staleEntry(`source-${index}`, 100 - index),
  );

  const { selected, deferred } = selectStaleSourcesForRun(entries);

  assert.strictEqual(selected.length, MAX_STALE_SOURCE_UPDATES_PER_RUN);
  assert.strictEqual(
    deferred.length,
    entries.length - MAX_STALE_SOURCE_UPDATES_PER_RUN,
  );
  assert.strictEqual(selected[0].source.id, "source-0");
  assert.strictEqual(
    deferred[0].source.id,
    `source-${MAX_STALE_SOURCE_UPDATES_PER_RUN}`,
  );
});

test("a batch at or under the cap defers nothing", () => {
  const entries = [staleEntry("a", 40), staleEntry("b", 35)];
  const { selected, deferred } = selectStaleSourcesForRun(entries);

  assert.strictEqual(selected.length, 2);
  assert.strictEqual(deferred.length, 0);
});

test("stamped and unstamped sources are aged independently", () => {
  const index = createIndex({
    lastUpdated: "2026-05-01",
    sources: [
      {
        id: "stamped-fresh",
        name: "Stamped Fresh",
        url: "https://github.com/example/stamped",
        type: "preset",
        description: "Stamped source",
        lastIndexedAt: "2026-06-20T00:00:00.000Z",
      },
      {
        id: "unstamped",
        name: "Unstamped",
        url: "https://github.com/example/unstamped",
        type: "preset",
        description: "Unstamped source",
      },
    ],
  });

  assert.deepStrictEqual(
    getStaleSources(index, 30, now).map((entry) => entry.source.id),
    ["unstamped"],
  );
});

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

test("per-source freshness never falls back to the catalog date", () => {
  // index.lastUpdated はカタログ発行日。これを流用すると未走査 source が新鮮扱いになる
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

  const freshCatalogIndex = createIndex({
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
  assert.deepStrictEqual(
    getStaleSources(freshCatalogIndex, 30, now).map((entry) => entry.source.id),
    ["fallback-new"],
  );
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
  const age = getSourceIndexAgeDays(index.sources[0], now);
  assert.strictEqual(age.lastIndexedAt, "2026-07-01T00:00:00.000Z");
  assert.strictEqual(age.daysOld, 0);
  assert.strictEqual(age.isUnknown, false);
});

test("stale source action is decided outside activate()", () => {
  assert.deepStrictEqual(
    {
      ...decideStaleSourceIndexAction({
        mode: "never",
        staleSourceCount: 3,
        today: "2026-06-24",
      }),
    },
    { kind: "skip", reason: "mode-never" },
  );

  assert.deepStrictEqual(
    {
      ...decideStaleSourceIndexAction({
        mode: "prompt",
        staleSourceCount: 0,
        today: "2026-06-24",
      }),
    },
    { kind: "skip", reason: "no-stale-sources" },
  );

  assert.deepStrictEqual(
    {
      ...decideStaleSourceIndexAction({
        mode: "prompt",
        staleSourceCount: 2,
        lastPromptDate: "2026-06-24",
        today: "2026-06-24",
      }),
    },
    { kind: "skip", reason: "prompted-today" },
  );

  assert.deepStrictEqual(
    {
      ...decideStaleSourceIndexAction({
        mode: "prompt",
        staleSourceCount: 2,
        lastPromptDate: "2026-06-23",
        today: "2026-06-24",
      }),
    },
    { kind: "prompt" },
  );

  assert.deepStrictEqual(
    {
      ...decideStaleSourceIndexAction({
        mode: "always",
        staleSourceCount: 2,
        lastPromptDate: "2026-06-24",
        today: "2026-06-24",
      }),
    },
    { kind: "update" },
  );
});

test("a bundled catalog stamp never rewinds a newer local scan", () => {
  const older = { lastIndexedAt: "2026-08-01T00:00:00.000Z", lastIndexedBy: "catalog" };
  const newer = { lastIndexedAt: "2026-08-17T00:00:00.000Z", lastIndexedBy: "yamapan.agent-skill-ninja" };

  assert.strictEqual(pickNewerIndexedSource(newer, older), newer);
  assert.strictEqual(pickNewerIndexedSource(older, newer), newer);
  assert.strictEqual(pickNewerIndexedSource({}, newer), newer);
  assert.strictEqual(pickNewerIndexedSource(newer, {}), newer);
  assert.strictEqual(pickNewerIndexedSource({}, {}), undefined);
  assert.strictEqual(pickNewerIndexedSource({ lastIndexedAt: "nope" }, newer), newer);
});
