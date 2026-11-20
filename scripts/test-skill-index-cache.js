#!/usr/bin/env node

// 同梱 skill index のパースキャッシュを実際に動かして検証する。
//
// resources/skill-index.json は 800KB 超あり、loadSkillIndex は TreeView の
// 更新ごとに呼ばれる。キャッシュを入れる以上、(1) 実際に読み直しが減ること、
// (2) 呼び出し側が返り値を書き換えてもキャッシュが汚れないこと、
// (3) ファイルが変わったら効かなくなること、(4) 失敗を覚えないことを固定する。

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const skillIndexPath = path.join(repoRoot, "src", "skillIndex.ts");

let failures = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(`  ${error.stack || error.message}`);
  }
}

function makeUri(filePath) {
  const resolved = path.resolve(filePath);
  return { fsPath: resolved, path: resolved.replace(/\\/g, "/") };
}

/**
 * 実ファイルを読むが、読み取り回数を数える vscode スタブ。
 * shared manifest は無効にしてあるので、この経路は通らない。
 */
function makeHarness(root, { sharedManifest, attachChannel = true } = {}) {
  const counters = { readFile: 0, bundledReads: 0, stat: 0, writes: 0, bootstraps: 0 };
  const warnings = [];
  let readFileError = null;
  let statError = null;
  let writeFileError = null;

  const vscodeStub = {
    Uri: {
      file: makeUri,
      joinPath: (base, ...parts) => makeUri(path.join(base.fsPath, ...parts)),
    },
    workspace: {
      getConfiguration: () => ({
        get: (key, fallback) =>
          key === "useSharedSourcesManifest" ? sharedManifest !== undefined : fallback,
      }),
      fs: {
        async readFile(target) {
          counters.readFile += 1;
          const isBundled = target.fsPath.includes(
            `${path.sep}extension${path.sep}resources${path.sep}`,
          );
          if (isBundled) {
            counters.bundledReads += 1;
            if (readFileError) {
              throw readFileError;
            }
          }
          return fs.promises.readFile(target.fsPath);
        },
        async writeFile(target, content) {
          counters.writes += 1;
          if (writeFileError) {
            throw writeFileError;
          }
          await fs.promises.mkdir(path.dirname(target.fsPath), {
            recursive: true,
          });
          await fs.promises.writeFile(target.fsPath, content);
        },
        async createDirectory(target) {
          await fs.promises.mkdir(target.fsPath, { recursive: true });
        },
        async stat(target) {
          counters.stat += 1;
          if (statError) {
            throw statError;
          }
          const stats = await fs.promises.stat(target.fsPath);
          return { mtime: stats.mtimeMs, size: stats.size };
        },
      },
    },
  };

  const source = fs.readFileSync(skillIndexPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: skillIndexPath,
  }).outputText;

  const moduleObject = { exports: {} };
  const sandbox = {
    module: moduleObject,
    exports: moduleObject.exports,
    process,
    console,
    Buffer,
    require(request) {
      if (request === "vscode") {
        return vscodeStub;
      }
      if (request === "./githubFetch") {
        return {
          createGitHubHeaders: () => ({}),
          fetchGitHubWithOptionalAuthRetry: async () => ({ ok: false }),
        };
      }
      if (request === "./i18n") {
        return { isJapanese: () => false };
      }
      if (request === "./shared-sources-manifest-store" && sharedManifest !== undefined) {
        const real = loadDependency(request);
        return {
          ...real,
          readSharedSourcesManifestResult: async () => sharedManifest,
          bootstrapSharedSourcesManifest: async () => {
            counters.bootstraps += 1;
          },
        };
      }
      if (request.startsWith(".")) {
        return loadDependency(request);
      }
      return require(request);
    },
  };

  function loadDependency(request) {
    const depPath = path.resolve(path.dirname(skillIndexPath), `${request}.ts`);
    const depSource = fs.readFileSync(depPath, "utf8");
    const depTranspiled = ts.transpileModule(depSource, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: depPath,
    }).outputText;
    const depModule = { exports: {} };
    vm.runInNewContext(
      depTranspiled,
      {
        module: depModule,
        exports: depModule.exports,
        process,
        console,
        Buffer,
        require: sandbox.require,
      },
      { filename: depPath },
    );
    return depModule.exports;
  }

  vm.runInNewContext(transpiled, sandbox, { filename: skillIndexPath });
  const setOutputChannel = () => moduleObject.exports.setSkillIndexOutputChannel({
    appendLine: (line) => warnings.push(line),
  });
  if (attachChannel) {
    setOutputChannel();
  }

  const context = {
    extensionUri: makeUri(path.join(root, "extension")),
    globalStorageUri: makeUri(path.join(root, "globalStorage")),
  };

  return {
    counters,
    warnings,
    setOutputChannel,
    context,
    module: moduleObject.exports,
    searchSkills: loadDependency("./skillSearch").searchSkills,
    bundledPath: path.join(root, "extension", "resources", "skill-index.json"),
    setReadFileError(error) {
      readFileError = error;
    },
    setStatError(error) {
      statError = error;
    },
    setWriteFileError(error) {
      writeFileError = error;
    },
  };
}

function writeBundled(harness, index) {
  fs.mkdirSync(path.dirname(harness.bundledPath), { recursive: true });
  fs.writeFileSync(harness.bundledPath, JSON.stringify(index), "utf8");
}

function writeLocal(harness, index) {
  const target = path.join(harness.context.globalStorageUri.fsPath, "skill-index.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(index), "utf8");
  return target;
}

const BASE_INDEX = {
  version: "1.0.0",
  lastUpdated: "2026-01-01",
  sources: [{
    id: "alpha", name: "Alpha", url: "https://github.com/example/alpha",
    type: "community", description: "",
  }],
  skills: [{
    name: "one", source: "alpha", path: "", categories: [], description: "first",
  }],
  categories: [],
};

async function main() {
  await test("a second load does not re-read the bundled index", async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, ".skill-index-cache-"));
    try {
      const harness = makeHarness(root);
      writeBundled(harness, BASE_INDEX);

      await harness.module.loadSkillIndex(harness.context);
      const afterFirst = harness.counters.bundledReads;
      await harness.module.loadSkillIndex(harness.context);

      assert.strictEqual(afterFirst, 1, "the first load must read the bundle");
      assert.strictEqual(
        harness.counters.bundledReads,
        1,
        "the second load must not re-read the bundle",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("concurrent first loads parse the bundle once", async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, ".skill-index-cache-"));
    try {
      const harness = makeHarness(root);
      writeBundled(harness, BASE_INDEX);

      await Promise.all([
        harness.module.loadSkillIndex(harness.context),
        harness.module.loadSkillIndex(harness.context),
        harness.module.loadSkillIndex(harness.context),
      ]);

      assert.strictEqual(
        harness.counters.bundledReads,
        1,
        `three concurrent loads must parse the bundle once, saw ${harness.counters.bundledReads}`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("mutating the returned index does not poison the cache", async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, ".skill-index-cache-"));
    try {
      const harness = makeHarness(root);
      writeBundled(harness, BASE_INDEX);

      const first = await harness.module.loadSkillIndex(harness.context);
      first.skills.push({ name: "injected", source: "alpha" });
      first.sources[0].name = "tampered";

      // ローカル index も汚れないよう、別の globalStorage で読み直す
      const second = await harness.module.loadSkillIndex({
        extensionUri: harness.context.extensionUri,
        globalStorageUri: makeUri(path.join(root, "globalStorage2")),
      });

      assert.strictEqual(
        second.skills.some((skill) => skill.name === "injected"),
        false,
        "a mutated result must not leak back through the cache",
      );
      assert.strictEqual(second.sources[0].name, "Alpha");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("a changed bundled file invalidates the cache", async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, ".skill-index-cache-"));
    try {
      const harness = makeHarness(root);
      writeBundled(harness, BASE_INDEX);
      await harness.module.loadSkillIndex(harness.context);

      writeBundled(harness, {
        ...BASE_INDEX,
        skills: [
          ...BASE_INDEX.skills,
          { ...BASE_INDEX.skills[0], name: "two", description: "second" },
        ],
      });

      const reloaded = await harness.module.loadSkillIndex({
        extensionUri: harness.context.extensionUri,
        globalStorageUri: makeUri(path.join(root, "globalStorage3")),
      });

      assert.strictEqual(
        reloaded.skills.some((skill) => skill.name === "two"),
        true,
        "a rewritten bundle must be picked up",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("a failed bundle read is not cached", async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, ".skill-index-cache-"));
    try {
      const harness = makeHarness(root);
      writeBundled(harness, BASE_INDEX);

      harness.setReadFileError(new Error("transient read failure"));
      const failed = await harness.module.loadSkillIndex(harness.context);
      assert.strictEqual(
        failed.skills.length,
        0,
        "a failing bundle read should fall back to an empty index",
      );
      assert.strictEqual(harness.counters.writes, 0);
      assert.ok(harness.warnings.some((line) => line.includes("Bundled index could not")));

      harness.setReadFileError(null);
      const recovered = await harness.module.loadSkillIndex({
        extensionUri: harness.context.extensionUri,
        globalStorageUri: makeUri(path.join(root, "globalStorage4")),
      });

      assert.strictEqual(
        recovered.skills.some((skill) => skill.name === "one"),
        true,
        "the next load must retry instead of serving a cached failure",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("an unusable stat falls back to reading every time", async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, ".skill-index-cache-"));
    try {
      const harness = makeHarness(root);
      writeBundled(harness, BASE_INDEX);
      harness.setStatError(new Error("stat is unavailable"));

      const first = await harness.module.loadSkillIndex(harness.context);
      const second = await harness.module.loadSkillIndex(harness.context);

      assert.strictEqual(first.skills.length, 1);
      assert.strictEqual(second.skills.length, 1);
      assert.strictEqual(
        harness.counters.bundledReads,
        2,
        "without a fingerprint the bundle must be re-read, never cached blindly",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("the fingerprint is taken from stat", async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, ".skill-index-cache-"));
    try {
      const harness = makeHarness(root);
      writeBundled(harness, BASE_INDEX);

      const index = await harness.module.loadSkillIndex(harness.context);
      assert.strictEqual(index.skills.length, 1);
      assert.ok(harness.counters.stat >= 1, "the fingerprint must use stat");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("malformed cached entries do not break search and normalization is idempotent", async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, ".skill-index-cache-"));
    try {
      const harness = makeHarness(root);
      writeLocal(harness, {
        ...BASE_INDEX,
        sources: [
          { ...BASE_INDEX.sources[0], includePaths: [""], excludePaths: [""] },
          null, 2, [],
          { ...BASE_INDEX.sources[0], id: "bad-scope", includePaths: [true] },
          { ...BASE_INDEX.sources[0], id: "bad-branch", branch: {} },
        ],
        skills: [
          {
            ...BASE_INDEX.skills[0], standalone: false, requires: ["base"],
            bundle: "framework", license: "MIT", author: "author", version: "2",
            invocation: "explicitOnly", argumentHint: "[topic]", context: "fork",
          },
          null, [], false, { ...BASE_INDEX.skills[0], name: 7 },
          { ...BASE_INDEX.skills[0], path: null },
          {
            ...BASE_INDEX.skills[0], name: "broken-metadata",
            description: {}, description_ja: 1, categories: ["safe", null, 3],
            requires: [false, "one"], standalone: "no", isOrg: {},
            invocation: "unknown", context: [], stars: "many", url: {},
            argumentHint: 4,
          },
        ],
        categories: [null, { id: 3 }, { id: "safe", name: "Safe", description: 4 }],
        bundles: [false, { id: "framework", name: "Framework", source: "alpha",
          description: [], skills: ["one"], installOrder: 5 },
          { id: "bad-bundle", name: "Bad", source: "alpha", skills: ["one", null] }],
        retiredSources: [null, { id: "retired", supersededBy: 7 }],
      });

      const index = await harness.module.loadSkillIndex(harness.context);
      assert.strictEqual(index.sources.length, 1, "invalid scan fields must not widen a scan");
      assert.deepStrictEqual(Array.from(index.sources[0].includePaths), [""]);
      assert.deepStrictEqual(Array.from(index.sources[0].excludePaths), [""]);
      assert.strictEqual(index.skills.length, 2);
      assert.strictEqual(index.skills[0].path, "", "repository-root skills remain valid");
      assert.strictEqual(index.skills[0].standalone, false);
      assert.strictEqual(index.skills[0].invocation, "explicitOnly");
      assert.strictEqual(index.skills[0].context, "fork");
      assert.strictEqual(index.skills[0].argumentHint, "[topic]");
      assert.strictEqual(index.skills[0].license, "MIT");
      assert.strictEqual(index.skills[0].bundle, "framework");
      assert.strictEqual(index.skills[1].description, "");
      assert.strictEqual(index.skills[1].description_ja, undefined);
      assert.deepStrictEqual(Array.from(index.skills[1].categories), ["safe"]);
      assert.deepStrictEqual(Array.from(index.skills[1].requires), ["one"]);
      assert.strictEqual(index.skills[1].invocation, undefined);
      assert.strictEqual(index.skills[1].url, undefined);
      assert.strictEqual(index.bundles[0].installOrder, undefined);
      assert.deepStrictEqual(Array.from(index.bundles[0].skills), ["one"]);
      assert.strictEqual(harness.searchSkills(index, "one").items.length, 1);
      assert.strictEqual(harness.searchSkills(index, "").items.length, 2);
      assert.ok(harness.warnings.some((line) => line.includes("invalid identity")));
      assert.ok(harness.warnings.some((line) => line.includes("invalid metadata")));
      writeLocal(harness, index);
      const warningCount = harness.warnings.filter((line) => /ignored|repaired/.test(line)).length;
      const again = await harness.module.loadSkillIndex(harness.context);
      assert.strictEqual(JSON.stringify(again), JSON.stringify(index));
      assert.strictEqual(
        harness.warnings.filter((line) => /ignored|repaired/.test(line)).length,
        warningCount,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("legacy indexes missing categories retain local sources and skills", async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, ".skill-index-cache-"));
    try {
      const harness = makeHarness(root);
      writeBundled(harness, BASE_INDEX);
      const local = { ...BASE_INDEX, sources: [{ ...BASE_INDEX.sources[0], id: "custom" }],
        skills: [{ ...BASE_INDEX.skills[0], source: "custom" }] };
      delete local.categories;
      writeLocal(harness, local);
      const result = await harness.module.loadSkillIndex(harness.context);
      assert.ok(result.sources.some((source) => source.id === "custom"));
      assert.ok(result.skills.some((skill) => skill.source === "custom"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("invalid local scan restrictions never fall back to an unrestricted preset or overwrite the cache", async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, ".skill-index-cache-"));
    try {
      const harness = makeHarness(root);
      writeBundled(harness, { ...BASE_INDEX, version: "2.0.0" });
      const target = writeLocal(harness, { ...BASE_INDEX,
        sources: [{ ...BASE_INDEX.sources[0], includePaths: ["restricted", false] }] });
      const before = fs.readFileSync(target, "utf8");
      const result = await harness.module.loadSkillIndex(harness.context);
      assert.ok(!result.sources.some((source) => source.id === "alpha"));
      assert.ok(!result.skills.some((skill) => skill.source === "alpha"));
      assert.strictEqual(harness.counters.writes, 0);
      assert.strictEqual(fs.readFileSync(target, "utf8"), before);
      await assert.rejects(harness.module.saveSkillIndex(harness.context, result), /repair or restore/);
      assert.strictEqual(fs.readFileSync(target, "utf8"), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("a corrupt local index is never replaced by the bundled index", async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, ".skill-index-cache-"));
    try {
      const harness = makeHarness(root);
      writeBundled(harness, BASE_INDEX);
      const target = writeLocal(harness, { sources: {}, skills: [], categories: [] });
      const before = fs.readFileSync(target, "utf8");
      const result = await harness.module.loadSkillIndex(harness.context);
      assert.strictEqual(harness.counters.writes, 0);
      assert.strictEqual(fs.readFileSync(target, "utf8"), before);
      await assert.rejects(harness.module.saveSkillIndex(harness.context, result), /repair or restore/);
      assert.strictEqual(fs.readFileSync(target, "utf8"), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("invalid shared restrictions do not revive the matching unrestricted preset", async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, ".skill-index-cache-"));
    try {
      const harness = makeHarness(root, { sharedManifest: {
        status: "valid", manifest: { sources: [
          { ...BASE_INDEX.sources[0], excludePaths: ["private", false] },
        ] },
      } });
      writeBundled(harness, BASE_INDEX);
      const target = writeLocal(harness, BASE_INDEX);
      const before = fs.readFileSync(target, "utf8");
      const result = await harness.module.loadSkillIndex(harness.context);
      assert.ok(!result.sources.some((source) => source.id === "alpha"));
      assert.ok(!result.skills.some((skill) => skill.source === "alpha"));
      assert.strictEqual(harness.counters.writes, 0);
      assert.strictEqual(fs.readFileSync(target, "utf8"), before);
      await assert.rejects(harness.module.saveSkillIndex(harness.context, result), /shared source index is invalid/);
      assert.strictEqual(fs.readFileSync(target, "utf8"), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("missing local and bundled indexes can still read a valid shared source without bootstrapping", async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, ".skill-index-cache-"));
    try {
      const harness = makeHarness(root, { sharedManifest: {
        status: "valid", manifest: { sources: BASE_INDEX.sources },
      } });
      const result = await harness.module.loadSkillIndex(harness.context);
      assert.strictEqual(result.sources[0].id, "alpha");
      assert.strictEqual(harness.counters.writes, 0);
      assert.strictEqual(harness.counters.bootstraps, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("bundled input and shared merged sources use the same entry validation", async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, ".skill-index-cache-"));
    try {
      const harness = makeHarness(root, {
        sharedManifest: {
          status: "valid",
          manifest: {
            sources: [
              ...BASE_INDEX.sources, null,
              { ...BASE_INDEX.sources[0], id: "other", name: false },
            ],
          },
        },
      });
      writeBundled(harness, {
        ...BASE_INDEX,
        sources: [null, ...BASE_INDEX.sources],
        skills: [null, { ...BASE_INDEX.skills[0], description: true }],
      });
      const index = await harness.module.loadSkillIndex(harness.context);
      assert.strictEqual(index.sources.length, 1);
      assert.strictEqual(index.skills.length, 1);
      assert.strictEqual(index.skills[0].description, "");
      assert.strictEqual(harness.searchSkills(index, "one").items.length, 1);
      assert.ok(harness.warnings.some((line) => line.includes("sources: ignored 2")));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("the real bundled catalog is unchanged by normalization", async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, ".skill-index-cache-"));
    try {
      const harness = makeHarness(root);
      const bundled = JSON.parse(fs.readFileSync(
        path.join(repoRoot, "resources", "skill-index.json"), "utf8",
      ));
      writeBundled(harness, bundled);
      const index = await harness.module.loadSkillIndex(harness.context);
      assert.deepStrictEqual(JSON.parse(JSON.stringify(index)), bundled);
      assert.ok(!harness.warnings.some((line) => /ignored|repaired/.test(line)));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("unreadable indexes never persist or bootstrap an empty success", async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, ".skill-index-cache-"));
    try {
      const harness = makeHarness(root, { sharedManifest: { status: "missing" } });
      for (const invalid of [null, [], { sources: {}, skills: [], categories: [] }]) {
        const target = writeLocal(harness, invalid);
        const before = fs.readFileSync(target, "utf8");
        const index = await harness.module.loadSkillIndex(harness.context);
        assert.strictEqual(index.skills.length, 0);
        assert.strictEqual(harness.counters.writes, 0);
        assert.strictEqual(harness.counters.bootstraps, 0);
        assert.strictEqual(fs.readFileSync(target, "utf8"), before);
      }
      assert.ok(harness.warnings.some((line) => line.includes("unsaved empty fallback")));
      assert.ok(!harness.warnings.some((line) => line.includes(root)));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("early invalid-data diagnostics are queued until the output channel is ready", async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, ".skill-index-cache-"));
    try {
      const harness = makeHarness(root, { attachChannel: false });
      writeBundled(harness, { ...BASE_INDEX, skills: [null] });
      await harness.module.loadSkillIndex(harness.context);
      assert.strictEqual(harness.warnings.length, 0);
      harness.setOutputChannel();
      assert.ok(harness.warnings.some((line) => line.includes("skills: ignored 1")));
      const count = harness.warnings.length;
      harness.setOutputChannel();
      assert.strictEqual(harness.warnings.length, count, "queued warnings are drained once");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("a failed merged-cache write does not replace local data with the bundled fallback", async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, ".skill-index-cache-"));
    try {
      const harness = makeHarness(root);
      writeBundled(harness, { ...BASE_INDEX, version: "2.0.0" });
      const target = writeLocal(harness, {
        ...BASE_INDEX,
        skills: [{ ...BASE_INDEX.skills[0], name: "local-only" }],
      });
      const before = fs.readFileSync(target, "utf8");
      harness.setWriteFileError(new Error("write failed"));
      await assert.rejects(harness.module.loadSkillIndex(harness.context), /write failed/);
      assert.strictEqual(harness.counters.writes, 1, "do not retry a write with bundled-only data");
      assert.strictEqual(fs.readFileSync(target, "utf8"), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log("\nAll bundled skill index cache tests passed");
}

main();
