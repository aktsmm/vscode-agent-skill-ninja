#!/usr/bin/env node

// 同梱 skill index のパースキャッシュを実際に動かして検証する。
//
// resources/skill-index.json は 800KB 超あり、loadSkillIndex は TreeView の
// 更新ごとに呼ばれる。キャッシュを入れる以上、(1) 実際に読み直しが減ること、
// (2) 呼び出し側が返り値を書き換えてもキャッシュが汚れないこと、
// (3) ファイルが変わったら効かなくなること、(4) 失敗を覚えないことを固定する。

const assert = require("assert");
const fs = require("fs");
const os = require("os");
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
function makeHarness(root) {
  const counters = { readFile: 0, bundledReads: 0, stat: 0 };
  let readFileError = null;
  let statError = null;

  const vscodeStub = {
    Uri: {
      file: makeUri,
      joinPath: (base, ...parts) => makeUri(path.join(base.fsPath, ...parts)),
    },
    workspace: {
      getConfiguration: () => ({
        get: (key, fallback) => fallback,
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

  const context = {
    extensionUri: makeUri(path.join(root, "extension")),
    globalStorageUri: makeUri(path.join(root, "globalStorage")),
  };

  return {
    counters,
    context,
    module: moduleObject.exports,
    bundledPath: path.join(root, "extension", "resources", "skill-index.json"),
    setReadFileError(error) {
      readFileError = error;
    },
    setStatError(error) {
      statError = error;
    },
  };
}

function writeBundled(harness, index) {
  fs.mkdirSync(path.dirname(harness.bundledPath), { recursive: true });
  fs.writeFileSync(harness.bundledPath, JSON.stringify(index), "utf8");
}

const BASE_INDEX = {
  version: "1.0.0",
  lastUpdated: "2026-01-01",
  sources: [{ id: "alpha", name: "Alpha" }],
  skills: [{ name: "one", source: "alpha", description: "first" }],
  categories: [],
};

async function main() {
  await test("a second load does not re-read the bundled index", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-index-cache-"));
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-index-cache-"));
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-index-cache-"));
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-index-cache-"));
    try {
      const harness = makeHarness(root);
      writeBundled(harness, BASE_INDEX);
      await harness.module.loadSkillIndex(harness.context);

      writeBundled(harness, {
        ...BASE_INDEX,
        skills: [
          ...BASE_INDEX.skills,
          { name: "two", source: "alpha", description: "second" },
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-index-cache-"));
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-index-cache-"));
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-index-cache-"));
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

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log("\nAll bundled skill index cache tests passed");
}

main();
