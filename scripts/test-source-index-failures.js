#!/usr/bin/env node

// 再試行しても変わらない source 更新失敗の記録・間隔・通知抑止を検証する。

const assert = require("assert");
const { loadSrcModule } = require("./load-src-module");

const {
  PERSISTENT_FAILURE_RETRY_DAYS,
  classifyPersistentFailure,
  clearFailure,
  clearRecoveredSources,
  filterEligibleEntries,
  isEligibleForAutoUpdate,
  muteSource,
  normalizeFailureState,
  pruneFailureState,
  recordPersistentFailure,
} = loadSrcModule("./sourceIndexFailures");
const { SourceScanError, createEmptyScanError } = loadSrcModule(
  "./sourceUpdateReconcile",
);

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-10-21T00:00:00.000Z");
const after = (days) => new Date(T0.getTime() + days * DAY_MS);

function source(overrides = {}) {
  return {
    id: "openai-codex",
    name: "OpenAI Codex Skills",
    url: "https://github.com/openai/codex",
    type: "official",
    description: "",
    includePaths: [".codex/skills/"],
    ...overrides,
  };
}

test("only SourceScanError counts as a persistent failure", () => {
  assert.strictEqual(
    classifyPersistentFailure(new SourceScanError("empty-scan", "x")),
    "empty-scan",
  );
  assert.strictEqual(
    classifyPersistentFailure(new Error("rate limit")),
    undefined,
  );
  assert.strictEqual(classifyPersistentFailure("empty"), undefined);
});

test("the first failure notifies and a repeat of the same kind does not", () => {
  const first = recordPersistentFailure({}, source(), "empty-scan", T0);
  assert.strictEqual(first.shouldNotify, true);

  const repeat = recordPersistentFailure(
    first.state,
    source(),
    "empty-scan",
    after(8),
  );
  assert.strictEqual(repeat.shouldNotify, false);
  assert.strictEqual(
    repeat.state["openai-codex"].lastFailedAt,
    after(8).toISOString(),
  );
});

test("a different failure kind notifies again", () => {
  const first = recordPersistentFailure({}, source(), "empty-scan", T0);
  const changed = recordPersistentFailure(
    first.state,
    source(),
    "not-found",
    after(8),
  );
  assert.strictEqual(changed.shouldNotify, true);
});

test("a persistent failure is retried only after the retry interval", () => {
  const { state } = recordPersistentFailure({}, source(), "not-found", T0);
  assert.strictEqual(isEligibleForAutoUpdate(state, source(), after(1)), false);
  assert.strictEqual(
    isEligibleForAutoUpdate(
      state,
      source(),
      after(PERSISTENT_FAILURE_RETRY_DAYS - 0.01),
    ),
    false,
  );
  assert.strictEqual(
    isEligibleForAutoUpdate(
      state,
      source(),
      after(PERSISTENT_FAILURE_RETRY_DAYS),
    ),
    true,
  );
});

test("a muted source stays out of automatic updates indefinitely", () => {
  const recorded = recordPersistentFailure(
    {},
    source(),
    "empty-scan",
    T0,
  ).state;
  const muted = muteSource(recorded, source());
  assert.strictEqual(
    isEligibleForAutoUpdate(muted, source(), after(365)),
    false,
  );
  // 失敗記録のない source は mute できない
  assert.deepStrictEqual(muteSource({}, source()), {});
});

test("a record is ignored once the source definition changes", () => {
  const { state } = recordPersistentFailure({}, source(), "empty-scan", T0);
  const edited = source({ includePaths: ["skills/"] });
  assert.strictEqual(isEligibleForAutoUpdate(state, edited, after(1)), true);
  assert.deepStrictEqual(Object.keys(pruneFailureState(state, [edited])), []);
  assert.deepStrictEqual(Object.keys(pruneFailureState(state, [])), []);
  assert.deepStrictEqual(Object.keys(pruneFailureState(state, [source()])), [
    "openai-codex",
  ]);
});

test("filterEligibleEntries keeps only sources that may be retried", () => {
  const { state } = recordPersistentFailure({}, source(), "empty-scan", T0);
  const other = source({ id: "other", url: "https://github.com/o/other" });
  const kept = filterEligibleEntries(
    [{ source: source() }, { source: other }],
    state,
    after(1),
  );
  assert.deepStrictEqual(
    kept.map((entry) => entry.source.id),
    ["other"],
  );
});

test("clearFailure removes only the named source", () => {
  const a = recordPersistentFailure({}, source(), "empty-scan", T0).state;
  const both = recordPersistentFailure(
    a,
    source({ id: "b", url: "https://github.com/o/b" }),
    "not-found",
    T0,
  ).state;
  assert.deepStrictEqual(Object.keys(clearFailure(both, "b")), [
    "openai-codex",
  ]);
  assert.strictEqual(clearFailure(both, "missing"), both);
});

test("only sources whose lastIndexedAt advanced are treated as recovered", () => {
  const stateA = recordPersistentFailure({}, source(), "empty-scan", T0).state;
  const state = recordPersistentFailure(
    stateA,
    source({ id: "b", url: "https://github.com/o/b" }),
    "not-found",
    T0,
  ).state;
  const before = [
    source({ lastIndexedAt: "2026-09-06T00:00:00.000Z" }),
    source({
      id: "b",
      url: "https://github.com/o/b",
      lastIndexedAt: "2026-09-06T00:00:00.000Z",
    }),
  ];
  const updated = [
    source({ lastIndexedAt: "2026-09-06T00:00:00.000Z" }),
    source({
      id: "b",
      url: "https://github.com/o/b",
      lastIndexedAt: "2026-10-21T00:00:00.000Z",
    }),
  ];

  assert.deepStrictEqual(
    Object.keys(clearRecoveredSources(state, before, updated)),
    ["openai-codex"],
  );
  assert.strictEqual(clearRecoveredSources(state, before, before), state);
});

test("a failure that could not be announced is announced on the next failure", () => {
  const silent = recordPersistentFailure({}, source(), "empty-scan", T0, false);
  assert.strictEqual(silent.shouldNotify, false);
  assert.strictEqual(silent.state["openai-codex"].notified, false);

  const later = recordPersistentFailure(
    silent.state,
    source(),
    "empty-scan",
    after(8),
  );
  assert.strictEqual(later.shouldNotify, true);
});

test("an empty result with remote candidates is a transient failure, not a persistent one", () => {
  // SKILL.md が見えているのに 0 件なら、取得失敗（タイムアウト等）の可能性がある
  assert.strictEqual(
    classifyPersistentFailure(createEmptyScanError("empty", 5)),
    undefined,
  );
  assert.strictEqual(
    classifyPersistentFailure(createEmptyScanError("empty", 0)),
    "empty-scan",
  );
  assert.strictEqual(
    classifyPersistentFailure(createEmptyScanError("empty", undefined)),
    "empty-scan",
  );
});

test("corrupt persisted state is discarded entry by entry", () => {
  assert.deepStrictEqual(Object.keys(normalizeFailureState(undefined)), []);
  assert.deepStrictEqual(Object.keys(normalizeFailureState([1, 2])), []);

  const normalized = normalizeFailureState({
    good: {
      kind: "empty-scan",
      lastFailedAt: T0.toISOString(),
      notified: true,
      muted: false,
      fingerprint: "f",
    },
    badKind: {
      kind: "weird",
      lastFailedAt: T0.toISOString(),
      fingerprint: "f",
    },
    badDate: { kind: "empty-scan", lastFailedAt: "nope", fingerprint: "f" },
    notObject: 5,
  });
  assert.deepStrictEqual(Object.keys(normalized), ["good"]);
});
