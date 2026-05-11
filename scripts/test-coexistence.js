/**
 * Coexistence layer regression tests (protocol v3.1, exports-API IPC).
 * Run after compile: node scripts/test-coexistence.js
 *
 * Sibling beacons are read via `vscode.extensions.getExtension(...).activate()`,
 * NOT via globalState (which is per-extension and not shared). These tests
 * inject a stub `vscode` module that simulates the sibling extension exposing
 * (or not exposing) an `AgentNinjaExtensionApi` from `activate()`.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "src", "coexistence.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

const SIBLING_ID = "yamapan.agent-resources-ninja";
const SELF_ID = "yamapan.agent-skill-ninja";

function makeContext(initialState = {}) {
  const state = new Map(Object.entries(initialState));
  return {
    globalState: {
      get(key) {
        return state.get(key);
      },
      update(key, value) {
        if (value === undefined) {
          state.delete(key);
        } else {
          state.set(key, value);
        }
        return Promise.resolve();
      },
    },
    _state: state,
  };
}

/**
 * Build a fake vscode module.
 *
 * @param {object} opts
 * @param {boolean} [opts.siblingInstalled] Whether `getExtension(SIBLING_ID)`
 *   returns an extension descriptor.
 * @param {object|undefined} [opts.siblingBeacon] Beacon returned by the
 *   sibling's exported `getAgentNinjaBeacon()`. `undefined` simulates a
 *   sibling that exists but does not expose a beacon (older version or
 *   activation not yet complete).
 * @param {boolean} [opts.siblingActivateThrows] Make `activate()` reject.
 * @param {string} [opts.coexistenceMode] User setting value.
 */
function makeVscodeStub({
  siblingInstalled = false,
  siblingBeacon = undefined,
  siblingActivateThrows = false,
  coexistenceMode = "auto",
  selfVersion = "9.9.9",
  onDidChangeListeners = [],
  onDidChangeConfigListeners = [],
} = {}) {
  return {
    extensions: {
      getExtension(id) {
        if (id === SELF_ID) {
          return {
            isActive: true,
            packageJSON: { version: selfVersion },
            activate() {
              return Promise.resolve({});
            },
          };
        }
        if (id === SIBLING_ID && siblingInstalled) {
          return {
            isActive: true,
            packageJSON: { version: "0.2.11" },
            activate() {
              if (siblingActivateThrows) {
                return Promise.reject(new Error("activate failed"));
              }
              if (siblingBeacon === undefined) {
                return Promise.resolve(undefined);
              }
              return Promise.resolve({
                getAgentNinjaBeacon: () => siblingBeacon,
              });
            },
          };
        }
        return undefined;
      },
      onDidChange(cb) {
        onDidChangeListeners.push(cb);
        return {
          dispose() {
            const idx = onDidChangeListeners.indexOf(cb);
            if (idx !== -1) onDidChangeListeners.splice(idx, 1);
          },
        };
      },
    },
    workspace: {
      getConfiguration() {
        return {
          get(key) {
            if (key === "coexistenceMode") return coexistenceMode;
            return undefined;
          },
        };
      },
      onDidChangeConfiguration(cb) {
        onDidChangeConfigListeners.push(cb);
        return {
          dispose() {
            const idx = onDidChangeConfigListeners.indexOf(cb);
            if (idx !== -1) onDidChangeConfigListeners.splice(idx, 1);
          },
        };
      },
    },
    Disposable: class {
      constructor(fn) {
        this._fn = fn;
      }
      dispose() {
        if (this._fn) this._fn();
      }
    },
  };
}

function loadModule(vscodeStub) {
  const moduleExports = {};
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    process,
    console,
    Promise,
    setImmediate,
    setTimeout,
    Date,
    Set,
    Map,
    Buffer,
    require(request) {
      if (request === "vscode") return vscodeStub;
      return require(request);
    },
  };
  vm.runInNewContext(transpiled.outputText, sandbox, {
    filename: sourcePath,
  });
  return sandbox.module.exports;
}

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(
      () => console.log(`PASS ${name}`),
      (err) => {
        console.error(`FAIL ${name}`);
        throw err;
      },
    );
}

function deepEqualJson(actual, expected, message) {
  assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected), message);
}

function freshSiblingBeacon(overrides = {}) {
  return {
    extensionId: SIBLING_ID,
    version: "0.2.11",
    kinds: ["skill", "agent", "instruction", "prompt"],
    capabilities: ["owner-handoff-v3"],
    protocolVersion: 3,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function main() {
  // --- computeOwnership: pure logic ---

  await test("computeOwnership: no sibling -> self", () => {
    const m = loadModule(makeVscodeStub());
    const decision = m.computeOwnership(
      { extensionId: SELF_ID, kinds: ["skill"] },
      undefined,
    );
    assert.strictEqual(decision.owner, "self");
    assert.strictEqual(decision.reason, "no-sibling");
    assert.strictEqual(decision.siblingInstalled, false);
  });

  await test("computeOwnership: self is strict subset -> sibling owns", () => {
    const m = loadModule(makeVscodeStub());
    const decision = m.computeOwnership(
      { extensionId: SELF_ID, kinds: ["skill"] },
      { extensionId: SIBLING_ID, kinds: ["skill", "agent", "prompt"] },
    );
    assert.strictEqual(decision.owner, "sibling");
    assert.strictEqual(decision.reason, "sibling-superset");
  });

  await test("computeOwnership: sibling is strict subset -> self owns", () => {
    const m = loadModule(makeVscodeStub());
    const decision = m.computeOwnership(
      { extensionId: SELF_ID, kinds: ["skill", "agent", "prompt"] },
      { extensionId: SIBLING_ID, kinds: ["skill"] },
    );
    assert.strictEqual(decision.owner, "self");
    assert.strictEqual(decision.reason, "self-superset");
  });

  await test("computeOwnership: equal sets -> tiebreak by extensionId order", () => {
    const m = loadModule(makeVscodeStub());
    const decision = m.computeOwnership(
      { extensionId: SELF_ID, kinds: ["skill"] },
      { extensionId: SIBLING_ID, kinds: ["skill"] },
    );
    assert.strictEqual(decision.reason, "tiebreak");
    // 'agent-resources' < 'agent-skill' lexicographically.
    assert.strictEqual(decision.owner, "sibling");
  });

  await test("computeOwnership: disjoint sets -> tiebreak", () => {
    const m = loadModule(makeVscodeStub());
    const decision = m.computeOwnership(
      { extensionId: "ext.zzz", kinds: ["skill"] },
      { extensionId: "ext.aaa", kinds: ["agent"] },
    );
    assert.strictEqual(decision.reason, "tiebreak");
    assert.strictEqual(decision.owner, "sibling");
  });

  // --- Beacon publish/clear/cache ---

  await test("publishBeacon writes a v3 beacon and updates exports cache", async () => {
    const m = loadModule(makeVscodeStub());
    const ctx = makeContext();
    const beacon = await m.publishBeacon(ctx);
    assert.strictEqual(beacon.extensionId, m.SELF_EXTENSION_ID);
    assert.strictEqual(beacon.protocolVersion, 3);
    deepEqualJson(beacon.kinds, [...m.SELF_KINDS]);

    // Diagnostic copy in our own globalState.
    const stored = ctx._state.get(
      `${m.BEACON_KEY_PREFIX}${m.SELF_EXTENSION_ID}`,
    );
    deepEqualJson(stored, beacon);

    // The exports API returns the cached beacon.
    const api = m.buildExtensionApi();
    deepEqualJson(api.getAgentNinjaBeacon(), beacon);
  });

  await test("clearBeacon removes the beacon entry from globalState", async () => {
    const m = loadModule(makeVscodeStub());
    const ctx = makeContext();
    await m.publishBeacon(ctx);
    assert.ok(ctx._state.has(`${m.BEACON_KEY_PREFIX}${m.SELF_EXTENSION_ID}`));
    await m.clearBeacon(ctx);
    assert.strictEqual(
      ctx._state.has(`${m.BEACON_KEY_PREFIX}${m.SELF_EXTENSION_ID}`),
      false,
    );
  });

  await test("getSelfBeacon falls back to a fresh beacon if publishBeacon was not called", () => {
    const m = loadModule(makeVscodeStub());
    const beacon = m.getSelfBeacon();
    assert.strictEqual(beacon.extensionId, m.SELF_EXTENSION_ID);
    assert.strictEqual(beacon.protocolVersion, 3);
  });

  // --- readSiblingBeacon: now goes through extension.exports ---

  await test("readSiblingBeacon: returns undefined when sibling is not installed", async () => {
    const m = loadModule(makeVscodeStub({ siblingInstalled: false }));
    const ctx = makeContext();
    const beacon = await m.readSiblingBeacon(ctx);
    assert.strictEqual(beacon, undefined);
  });

  await test("readSiblingBeacon: returns undefined when sibling exposes no API", async () => {
    const m = loadModule(
      makeVscodeStub({ siblingInstalled: true, siblingBeacon: undefined }),
    );
    const ctx = makeContext();
    const beacon = await m.readSiblingBeacon(ctx);
    assert.strictEqual(beacon, undefined);
  });

  await test("readSiblingBeacon: returns sibling beacon via exports API", async () => {
    const sibling = freshSiblingBeacon();
    const m = loadModule(
      makeVscodeStub({ siblingInstalled: true, siblingBeacon: sibling }),
    );
    const ctx = makeContext();
    const beacon = await m.readSiblingBeacon(ctx);
    deepEqualJson(beacon, sibling);
  });

  await test("readSiblingBeacon: rejects beacons older than TTL", async () => {
    const stale = freshSiblingBeacon({
      updatedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const m = loadModule(
      makeVscodeStub({ siblingInstalled: true, siblingBeacon: stale }),
    );
    const ctx = makeContext();
    const beacon = await m.readSiblingBeacon(ctx);
    assert.strictEqual(beacon, undefined);
  });

  await test("readSiblingBeacon: returns undefined when sibling.activate() throws", async () => {
    const m = loadModule(
      makeVscodeStub({
        siblingInstalled: true,
        siblingBeacon: freshSiblingBeacon(),
        siblingActivateThrows: true,
      }),
    );
    const ctx = makeContext();
    const beacon = await m.readSiblingBeacon(ctx);
    assert.strictEqual(beacon, undefined);
  });

  // --- isSiblingActive: AND of installed + valid beacon ---

  await test("isSiblingActive: false when sibling not installed", async () => {
    const m = loadModule(makeVscodeStub({ siblingInstalled: false }));
    const ctx = makeContext();
    assert.strictEqual(await m.isSiblingActive(ctx), false);
  });

  await test("isSiblingActive: false when installed but no beacon", async () => {
    const m = loadModule(
      makeVscodeStub({ siblingInstalled: true, siblingBeacon: undefined }),
    );
    const ctx = makeContext();
    assert.strictEqual(await m.isSiblingActive(ctx), false);
  });

  await test("isSiblingActive: true when installed AND beacon valid", async () => {
    const m = loadModule(
      makeVscodeStub({
        siblingInstalled: true,
        siblingBeacon: freshSiblingBeacon(),
      }),
    );
    const ctx = makeContext();
    assert.strictEqual(await m.isSiblingActive(ctx), true);
  });

  // --- getEffectiveOwnership: integration ---

  await test("getEffectiveOwnership: independent mode -> always self", async () => {
    const m = loadModule(
      makeVscodeStub({
        siblingInstalled: true,
        siblingBeacon: freshSiblingBeacon(),
        coexistenceMode: "independent",
      }),
    );
    const ctx = makeContext();
    const decision = await m.getEffectiveOwnership(ctx);
    assert.strictEqual(decision.owner, "self");
    assert.strictEqual(decision.reason, "independent");
  });

  await test("getEffectiveOwnership: auto + sibling beacon present -> sibling", async () => {
    const m = loadModule(
      makeVscodeStub({
        siblingInstalled: true,
        siblingBeacon: freshSiblingBeacon(),
        coexistenceMode: "auto",
      }),
    );
    const ctx = makeContext();
    const decision = await m.getEffectiveOwnership(ctx);
    assert.strictEqual(decision.owner, "sibling");
    assert.strictEqual(decision.reason, "sibling-superset");
    assert.ok(decision.siblingBeacon, "siblingBeacon should be populated");
  });

  await test("getEffectiveOwnership: auto + sibling installed but no beacon -> defer (race window fallback)", async () => {
    const m = loadModule(
      makeVscodeStub({
        siblingInstalled: true,
        siblingBeacon: undefined,
        coexistenceMode: "auto",
      }),
    );
    const ctx = makeContext();
    const decision = await m.getEffectiveOwnership(ctx);
    // Falls back to SIBLING_KINDS_FALLBACK so we stay deferred until the
    // sibling exposes its real beacon.
    assert.strictEqual(decision.owner, "sibling");
    assert.strictEqual(decision.reason, "sibling-superset");
    assert.strictEqual(decision.siblingInstalled, true);
    assert.strictEqual(decision.siblingBeacon, undefined);
  });

  await test("getEffectiveOwnership: auto + no sibling -> self", async () => {
    const m = loadModule(
      makeVscodeStub({
        siblingInstalled: false,
        coexistenceMode: "auto",
      }),
    );
    const ctx = makeContext();
    const decision = await m.getEffectiveOwnership(ctx);
    assert.strictEqual(decision.owner, "self");
    assert.strictEqual(decision.reason, "no-sibling");
  });

  // --- subscribeOwnershipChanges ---

  await test("subscribeOwnershipChanges: fires on extensions change", async () => {
    const onDidChangeListeners = [];
    const onDidChangeConfigListeners = [];
    const stub = makeVscodeStub({
      onDidChangeListeners,
      onDidChangeConfigListeners,
    });
    const m = loadModule(stub);

    let calls = 0;
    const disposable = m.subscribeOwnershipChanges(() => {
      calls += 1;
    });

    assert.strictEqual(onDidChangeListeners.length, 1);
    onDidChangeListeners[0]();
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(calls, 1);

    disposable.dispose();
    assert.strictEqual(onDidChangeListeners.length, 0);
  });

  await test("subscribeOwnershipChanges: fires on coexistenceMode change only", async () => {
    const onDidChangeListeners = [];
    const onDidChangeConfigListeners = [];
    const stub = makeVscodeStub({
      onDidChangeListeners,
      onDidChangeConfigListeners,
    });
    const m = loadModule(stub);

    let calls = 0;
    m.subscribeOwnershipChanges(() => {
      calls += 1;
    });

    assert.strictEqual(onDidChangeConfigListeners.length, 1);
    onDidChangeConfigListeners[0]({
      affectsConfiguration(key) {
        return key === "skillNinja.coexistenceMode";
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(calls, 1);

    onDidChangeConfigListeners[0]({
      affectsConfiguration() {
        return false;
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(calls, 1);
  });

  // --- buildExtensionApi: the contract returned from activate() ---

  await test("buildExtensionApi: returns an object whose getAgentNinjaBeacon yields a v3 beacon", () => {
    const m = loadModule(makeVscodeStub());
    const api = m.buildExtensionApi();
    assert.ok(api && typeof api.getAgentNinjaBeacon === "function");
    const beacon = api.getAgentNinjaBeacon();
    assert.strictEqual(beacon.extensionId, m.SELF_EXTENSION_ID);
    assert.strictEqual(beacon.protocolVersion, 3);
    deepEqualJson(beacon.kinds, [...m.SELF_KINDS]);
  });

  // --- Protocol contract constants: must match Resource NINJA side exactly ---

  await test("Protocol constants stay aligned with v3.1 contract", () => {
    const m = loadModule(makeVscodeStub());
    // Sister extension contract: do NOT change without coordinating both sides.
    assert.strictEqual(m.SELF_EXTENSION_ID, "yamapan.agent-skill-ninja");
    assert.strictEqual(m.SIBLING_EXTENSION_ID, "yamapan.agent-resources-ninja");
    assert.strictEqual(m.BEACON_KEY_PREFIX, "agentNinja.beacon.");
    assert.strictEqual(m.BEACON_TTL_MS, 30 * 24 * 60 * 60 * 1000);
    assert.strictEqual(m.BEACON_PROTOCOL_VERSION, 3);
    assert.strictEqual(m.MIGRATION_GUARD_DELAY_MS, 200);
    deepEqualJson([...m.SELF_KINDS], ["skill"]);
    // SIBLING_KINDS_FALLBACK should cover all 8 kinds so subset-side defers
    // when the sibling is installed but not yet exposing a beacon.
    deepEqualJson([...m.SIBLING_KINDS_FALLBACK].sort(), [
      "agent",
      "cursor-rule",
      "hook",
      "instruction",
      "mcp",
      "plugin",
      "prompt",
      "skill",
    ]);
  });
}

main()
  .then(() => console.log("All coexistence tests passed."))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
