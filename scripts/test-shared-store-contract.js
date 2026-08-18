#!/usr/bin/env node

// Agent Resources Ninja と共有する %APPDATA%/agent-ninja の相互運用契約を pin する。
//
// lock payload のフィールド集合・3 つのしきい値・共有ディレクトリ解決は両拡張が同じ形を
// 前提にしている。ここで検出できるのは「この repo 側が先に契約を変えた」場合だけで、
// sibling 側の変更は sibling 側の同等テストが受け持つ。両側に置いて初めて双方向になる。
// 併せて、相手の登録を消さないための保持規則も固定する。

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const ts = require("typescript");

const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "skill-ninja-contract-"),
);
process.env.APPDATA = tempRoot;
process.env.HOME = tempRoot;
process.env.USERPROFILE = tempRoot;

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

// skillIndex.ts は vscode を import するだけで、ここで検証する関数は純粋なので最小スタブで足りる
const VSCODE_STUB_ID = "vscode-stub";
// lock 側は fs/promises を差し替えて、link 非対応環境の分岐を実際に通す
const FS_PROMISES_STUB_ID = "fs-promises-stub";

const realFsPromises = require("fs/promises");
// null 以外なら fs.link がその code で失敗する。link が使えない環境の再現用
let forcedLinkErrorCode = null;

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveFilename(request, parent, ...rest) {
  if (request === "vscode") {
    return VSCODE_STUB_ID;
  }
  if (
    request === "fs/promises" &&
    /shared-store-lock\.ts$/.test(parent?.filename || "")
  ) {
    return FS_PROMISES_STUB_ID;
  }
  return originalResolveFilename.call(this, request, parent, ...rest);
};
require.cache[VSCODE_STUB_ID] = {
  id: VSCODE_STUB_ID,
  filename: VSCODE_STUB_ID,
  loaded: true,
  exports: {
    Uri: { file: (p) => ({ fsPath: p }), joinPath: () => ({ fsPath: "" }) },
    workspace: {
      getConfiguration: () => ({ get: (_key, fallback) => fallback }),
      fs: {},
    },
    window: {},
    env: {},
    commands: {},
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  },
};
require.cache[FS_PROMISES_STUB_ID] = {
  id: FS_PROMISES_STUB_ID,
  filename: FS_PROMISES_STUB_ID,
  loaded: true,
  exports: {
    ...realFsPromises,
    async link(...args) {
      if (forcedLinkErrorCode) {
        const error = new Error(`forced ${forcedLinkErrorCode}`);
        error.code = forcedLinkErrorCode;
        throw error;
      }
      return realFsPromises.link(...args);
    },
  },
};

const srcDir = path.join(__dirname, "..", "src");

const sharedManifest = require(path.join(srcDir, "shared-manifest.ts"));
const { sanitizeSourceEntry } = require(
  path.join(srcDir, "shared-sources-manifest-store.ts"),
);
const { withSharedStoreLock } = require(
  path.join(srcDir, "shared-store-lock.ts"),
);
const { encodeGitRef, hasForeignScanner, isSourceScanner } = require(
  path.join(srcDir, "sourceRefs.ts"),
);
const { isRateLimitAccountError, selectGhCliSwitchCandidates } = require(
  path.join(srcDir, "githubAuth.ts"),
);

const lockSource = fs.readFileSync(
  path.join(srcDir, "shared-store-lock.ts"),
  "utf8",
);

let failures = 0;

const sharedDir = sharedManifest.getAgentNinjaSharedDirectoryPath();
const lockPath = path.join(sharedDir, sharedManifest.SHARED_STORE_LOCK_FILE);

async function cleanSharedDir() {
  await fs.promises.rm(sharedDir, { recursive: true, force: true });
  await fs.promises.mkdir(sharedDir, { recursive: true });
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

function validEntry(overrides = {}) {
  return {
    id: "alpha",
    name: "Alpha",
    url: "https://github.com/example/alpha",
    type: "official",
    description: "Alpha source",
    ...overrides,
  };
}

async function run() {
  await test("shared directory resolution stays on agent-ninja", () => {
    assert.strictEqual(
      sharedManifest.SHARED_AGENT_NINJA_DIR_WINDOWS,
      "agent-ninja",
    );
    assert.strictEqual(
      sharedManifest.SHARED_SOURCES_MANIFEST_FILE,
      "sources.json",
    );
    assert.strictEqual(sharedManifest.SHARED_STORE_LOCK_FILE, "index.lock");
    assert.strictEqual(
      path.basename(sharedManifest.getSharedSourcesManifestPath()),
      "sources.json",
    );

    // 定数だけでなく resolver の実結果を見る。別場所へ移すと sibling と交差しなくなる
    assert.strictEqual(path.basename(sharedDir), "agent-ninja");
    assert.strictEqual(path.dirname(sharedDir), process.env.APPDATA);
    assert.strictEqual(
      sharedManifest.getSharedSourcesManifestPath(),
      path.join(sharedDir, "sources.json"),
    );
  });

  await test("lock thresholds match the cross-extension contract", () => {
    assert.strictEqual(sharedManifest.SHARED_STORE_LOCK_STALE_MS, 60 * 1000);
    assert.strictEqual(
      sharedManifest.SHARED_STORE_LOCK_HARD_STALE_MS,
      10 * 60 * 1000,
    );
    assert.strictEqual(
      sharedManifest.SHARED_STORE_LOCK_HEARTBEAT_MS,
      15 * 1000,
    );
  });

  await test("lock payload exposes exactly the four contract fields", async () => {
    await cleanSharedDir();

    await withSharedStoreLock("contract-test", async () => {
      const payload = JSON.parse(await fs.promises.readFile(lockPath, "utf8"));
      assert.deepStrictEqual(Object.keys(payload).sort(), [
        "acquiredAt",
        "extensionId",
        "generation",
        "pid",
      ]);
    });
  });

  await test("stale locks are reclaimed by rename, not deletion (source pin)", () => {
    // rename 後に reclaim path を消すので観測可能な痕跡が残らない。ここだけ source 固定
    assert.match(lockSource, /\.reclaim-\$\{/);
  });

  await test("an oversized lock body is ignored instead of being parsed", async () => {
    await cleanSharedDir();

    // 中身は「今 acquire した」有効 payload。上限を無視して読むと fresh と判定される
    const freshPayload = JSON.stringify({
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      extensionId: "oversized-writer",
      generation: "oversized-generation",
    });
    const padding = " ".repeat(
      sharedManifest.SHARED_STORE_LOCK_MAX_BYTES + 512,
    );
    await fs.promises.writeFile(lockPath, `${freshPayload}${padding}`, "utf8");

    // mtime だけ古くする。payload が読まれなければ「古い読めない lock」として回収される
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    await fs.promises.utimes(lockPath, twoMinutesAgo, twoMinutesAgo);

    let acquired = false;
    await withSharedStoreLock("contract-test", async () => {
      acquired = true;
    });

    assert.ok(
      acquired,
      "an oversized lock must not be trusted as a live payload",
    );
  });

  await test("lock contention never escapes the retry loop as an exception", async () => {
    await cleanSharedDir();

    // link が使えない環境を作り、fallback の wx 生成を必ず通す
    forcedLinkErrorCode = "EPERM";
    // 既存 lock を fresh payload で置く。wx は EEXIST、stale 回収も起きない
    await fs.promises.writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
        extensionId: "other-extension",
        generation: "held-generation",
      }),
      "utf8",
    );

    try {
      let thrown;
      try {
        await withSharedStoreLock("contract-test", async () => {
          throw new Error("task must not run while another lock is held");
        });
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, "acquisition should fail while the lock is held");
      assert.strictEqual(
        thrown.code,
        undefined,
        `EEXIST must not escape the retry loop (got code ${thrown.code})`,
      );
      assert.match(thrown.message, /Failed to acquire shared store lock/);
    } finally {
      forcedLinkErrorCode = null;
      await fs.promises.rm(lockPath, { force: true });
    }
  });

  await test("unknown scanner values survive a write-back", () => {
    const entry = sanitizeSourceEntry(validEntry({ scanner: "auto" }));
    assert.ok(entry, "entry should survive sanitization");
    assert.strictEqual(
      entry.scanner,
      "auto",
      "another extension's scanner must not be dropped",
    );

    // 保持しても自分では走らせない
    assert.strictEqual(isSourceScanner("auto"), false);
    assert.strictEqual(isSourceScanner("skill-md"), true);
  });

  await test("a foreign scanner is distinguished from an undeclared one", () => {
    // 未宣言は repo 名推定に落として良い。宣言済みで実装が無いものだけ走査を見送る
    assert.strictEqual(hasForeignScanner({}), false);
    assert.strictEqual(hasForeignScanner({ scanner: undefined }), false);
    assert.strictEqual(hasForeignScanner({ scanner: "   " }), false);
    assert.strictEqual(hasForeignScanner({ scanner: "skill-md" }), false);
    assert.strictEqual(hasForeignScanner({ scanner: "top-level-dirs" }), false);
    assert.strictEqual(hasForeignScanner({ scanner: "auto" }), true);
  });

  await test("skillIndex re-exports the same helpers, not a copy", () => {
    const reexported = require(path.join(srcDir, "skillIndex.ts"));
    assert.strictEqual(reexported.encodeGitRef, encodeGitRef);
    assert.strictEqual(reexported.isSourceScanner, isSourceScanner);
    assert.strictEqual(reexported.hasForeignScanner, hasForeignScanner);
  });

  await test("scanner values are still format-limited", () => {
    const entry = sanitizeSourceEntry(
      validEntry({ scanner: "../../etc/passwd" }),
    );
    assert.ok(entry);
    assert.strictEqual(entry.scanner, undefined);
  });

  await test("unknown source types are preserved", () => {
    const entry = sanitizeSourceEntry(validEntry({ type: "resource-pack" }));
    assert.ok(entry);
    assert.strictEqual(entry.type, "resource-pack");
  });

  await test("branch refs keep slashes but escape each segment", () => {
    assert.strictEqual(encodeGitRef("feature/x"), "feature/x");
    assert.strictEqual(encodeGitRef("release/1.0"), "release/1.0");
    assert.strictEqual(encodeGitRef("a b"), "a%20b");
    assert.strictEqual(encodeGitRef("a?b#c"), "a%3Fb%23c");
  });

  await test("branch entries reject traversal segments", () => {
    assert.strictEqual(
      sanitizeSourceEntry(validEntry({ branch: "../main" })).branch,
      undefined,
    );
    assert.strictEqual(
      sanitizeSourceEntry(validEntry({ branch: "feature/x" })).branch,
      "feature/x",
    );
  });

  await test("gh switch candidates exclude unhealthy and active accounts", () => {
    const accounts = [
      { login: "broken", active: true, healthy: false, error: "bad token" },
      { login: "healthy-inactive", active: false, healthy: true },
      { login: "broken-inactive", active: false, healthy: false },
    ];

    assert.deepStrictEqual(
      selectGhCliSwitchCandidates(accounts).map((a) => a.login),
      ["healthy-inactive"],
    );
  });

  await test("rate limited accounts are not reported as invalid tokens", () => {
    assert.strictEqual(
      isRateLimitAccountError(
        "HTTP 403: API rate limit exceeded for user ID 1",
      ),
      true,
    );
    assert.strictEqual(
      isRateLimitAccountError("The token in keyring is invalid."),
      false,
    );
    assert.strictEqual(isRateLimitAccountError(undefined), false);
  });

  if (failures > 0) {
    console.error(`\n${failures} shared store contract test(s) failed.`);
    process.exitCode = 1;
    return;
  }

  console.log("\nShared store contract tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
