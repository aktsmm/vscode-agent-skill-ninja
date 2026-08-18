#!/usr/bin/env node

// デフォルトブランチ解決のキャッシュ挙動を実行して検証する。
//
// 推測した "main" を永続キャッシュすると、そのセッションの取得が全て 404 になる。
// 逆に毎回探索すると、一括インストールで skill 数に比例してプローブが増える。
// ここでは「推測は短い窓だけ覚える」「成功したら覚え直す」を実際に呼んで固定する。

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const SRC_DIR = path.join(__dirname, "..", "src");
const sourcePath = path.join(SRC_DIR, "skillIndex.ts");

const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourcePath,
});

let failures = 0;

/** vscode に依存しない src モジュールを、実装そのまま読み込む */
function loadPureTsModule(filePath) {
  const output = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  }).outputText;

  const sandbox = { module: { exports: {} }, exports: {}, require };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(output, sandbox, { filename: filePath });
  return sandbox.module.exports;
}

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`PASS ${name}`))
    .catch((error) => {
      failures += 1;
      console.error(`FAIL ${name}`);
      console.error(`  ${error.stack || error.message}`);
    });
}

function loadSkillIndexModule({ respond, clock }) {
  const requests = [];
  const RealDate = Date;
  class FakeDate extends RealDate {
    static now() {
      return clock ? clock.value : RealDate.now();
    }
  }

  const vscodeStub = {
    Uri: {
      file: (fsPath) => ({ fsPath, path: fsPath }),
      joinPath: (base, ...parts) => ({
        fsPath: path.join(base.fsPath, ...parts),
        path: path.join(base.fsPath, ...parts),
      }),
    },
    workspace: {
      fs: {
        readFile: async () => {
          throw new Error("FileNotFound");
        },
        writeFile: async () => undefined,
        createDirectory: async () => undefined,
      },
      getConfiguration: () => ({ get: () => undefined }),
      workspaceFolders: [],
    },
    window: {
      showErrorMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showInformationMessage: async () => undefined,
    },
    extensions: { getExtension: () => undefined },
    env: { language: "en" },
  };

  const moduleExports = {};
  const sandbox = {
    module: { exports: moduleExports },
    exports: moduleExports,
    console: { log() {}, warn() {}, error() {} },
    Buffer,
    process,
    URL,
    URLSearchParams,
    Date: FakeDate,
    require(request) {
      if (request === "vscode") {
        return vscodeStub;
      }
      if (request === "./githubFetch") {
        return {
          fetchGitHubWithOptionalAuthRetry: async (url, init) => {
            requests.push(String(url));
            return respond(String(url), init);
          },
        };
      }
      if (request === "./shared-sources-manifest-store") {
        return {
          applySharedSourcesManifestToSkillIndex: async (index) => index,
          bootstrapSharedSourcesManifest: async () => undefined,
          readSharedSourcesManifest: async () => undefined,
          syncSharedSourcesManifestFromSources: async () => undefined,
        };
      }
      if (request === "./retiredSources") {
        return {
          applyRetiredSources: (index) => index,
          getRetiredSourceIds: () => new Set(),
        };
      }
      if (request === "./sourceIndexFreshness") {
        return {
          pickNewerIndexedSource: (local, bundled) =>
            local.lastIndexedAt
              ? local
              : bundled.lastIndexedAt
                ? bundled
                : undefined,
        };
      }
      // vscode 非依存の純粋ヘルパーは実モジュールを使う。書き写すと実装と乖離する
      if (request === "./sourceRefs") {
        return loadPureTsModule(path.join(SRC_DIR, "sourceRefs.ts"));
      }
      return require(request);
    },
  };

  vm.runInNewContext(transpiled.outputText, sandbox, { filename: sourcePath });
  return { module: sandbox.module.exports, requests };
}

function notFound() {
  return {
    ok: false,
    status: 404,
    headers: { get: () => null },
    json: async () => ({}),
  };
}

const REPO_URL = "https://github.com/owner/repo";

async function main() {
  await test("a resolved branch is cached and probed only once", async () => {
    const { module, requests } = loadSkillIndexModule({
      respond: (url) =>
        url.includes("/master/")
          ? { ok: true, status: 200, headers: { get: () => null } }
          : notFound(),
    });

    assert.strictEqual(await module.getDefaultBranch(REPO_URL), "master");
    const afterFirst = requests.length;
    assert.strictEqual(await module.getDefaultBranch(REPO_URL), "master");
    assert.strictEqual(
      requests.length,
      afterFirst,
      "a resolved branch must not be probed again",
    );
  });

  await test("an undeterminable branch is probed once per window, not per call", async () => {
    const { module, requests } = loadSkillIndexModule({
      respond: () => notFound(),
    });

    assert.strictEqual(await module.getDefaultBranch(REPO_URL), "main");
    const afterFirst = requests.length;
    assert.ok(afterFirst >= 2, "the first attempt must actually probe");

    assert.strictEqual(await module.getDefaultBranch(REPO_URL), "main");
    assert.strictEqual(
      requests.length,
      afterFirst,
      "a bulk install must not re-probe an undeterminable repo per skill",
    );
  });

  await test("the guess is not promoted into the resolved cache", async () => {
    const { module } = loadSkillIndexModule({ respond: () => notFound() });

    await module.getDefaultBranch(REPO_URL);
    assert.strictEqual(
      module.getCachedSourceBranch({ url: REPO_URL }),
      undefined,
      "a guessed branch must never look like a resolved one",
    );
  });

  await test("clearing the cache re-enables discovery", async () => {
    const { module, requests } = loadSkillIndexModule({
      respond: () => notFound(),
    });

    await module.getDefaultBranch(REPO_URL);
    const afterFirst = requests.length;

    module.clearResolvedBranchCache();
    await module.getDefaultBranch(REPO_URL);
    assert.ok(
      requests.length > afterFirst,
      "clearing the cache must drop the negative entry too",
    );
  });

  await test("the negative entry expires instead of pinning the guess", async () => {
    const clock = { value: 1_000_000 };
    const { module, requests } = loadSkillIndexModule({
      respond: () => notFound(),
      clock,
    });

    await module.getDefaultBranch(REPO_URL);
    const afterFirst = requests.length;

    clock.value += 59_000;
    await module.getDefaultBranch(REPO_URL);
    assert.strictEqual(
      requests.length,
      afterFirst,
      "inside the window the repo must not be probed again",
    );

    clock.value += 2_000;
    await module.getDefaultBranch(REPO_URL);
    assert.ok(
      requests.length > afterFirst,
      "after the window the repo must be probed again",
    );
  });

  await test("an aborted probe ends discovery instead of trying the next branch", async () => {
    const { module, requests } = loadSkillIndexModule({
      respond: () => {
        const error = new Error("Request aborted");
        error.name = "AbortError";
        throw error;
      },
    });

    await assert.rejects(
      () => module.getDefaultBranch(REPO_URL),
      (error) => error.name === "AbortError",
      "a cancelled probe must not be swallowed as 'branch not found'",
    );
    assert.strictEqual(
      requests.length,
      1,
      "discovery must stop at the first aborted probe, not fall through to master and the API",
    );
  });

  await test("a later successful resolution replaces the negative entry", async () => {
    let branchExists = false;
    const { module } = loadSkillIndexModule({
      respond: (url) =>
        branchExists && url.includes("/master/")
          ? { ok: true, status: 200, headers: { get: () => null } }
          : notFound(),
    });

    assert.strictEqual(await module.getDefaultBranch(REPO_URL), "main");

    branchExists = true;
    module.cacheResolvedBranch(REPO_URL, "master");
    assert.strictEqual(
      await module.getDefaultBranch(REPO_URL),
      "master",
      "a known branch must win over a cached guess",
    );
  });
}

main().then(() => {
  if (failures > 0) {
    process.exitCode = 1;
  }
});
