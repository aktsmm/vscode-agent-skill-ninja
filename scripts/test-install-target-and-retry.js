#!/usr/bin/env node

// インストール先の所有権ガードと、失敗分類 / リトライ判定の回帰テスト。
//
// 同名スキルは別ソースにも存在するため、インストール先フォルダの所有者が
// 違うときに無言で上書きしないこと、リトライ可否を message ではなく
// kind で判定できることを、実ファイルを触らずに検証する。

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const repoRoot = path.join(__dirname, "..");
const SRC_DIR = path.join(repoRoot, "src");
const sourcePath = path.join(SRC_DIR, "skillInstaller.ts");
const skillIndexJson = require("../resources/skill-index.json");

const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

function requireSrcModule(relativeRequest) {
  const filePath = path.join(SRC_DIR, `${relativeRequest.slice(2)}.ts`);
  const output = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  }).outputText;

  const loaded = new Module(filePath, module);
  loaded.filename = filePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(filePath));
  loaded._compile(output, filePath);
  return loaded.exports;
}

const FileType = { File: 1, Directory: 2, SymbolicLink: 64 };
const ROOT_POSIX = "/c:/ninja/skills";
const RAW = "https://raw.githubusercontent.com";

function posixPathToFsPath(posixPath) {
  const driveMatch = posixPath.match(/^\/([a-zA-Z]:)(\/.*)?$/);
  if (driveMatch) {
    return `${driveMatch[1]}${(driveMatch[2] || "").replace(/\//g, "\\")}`;
  }
  return posixPath;
}

function makeUri(posixPath) {
  return {
    scheme: "file",
    path: posixPath,
    get fsPath() {
      return posixPathToFsPath(posixPath);
    },
    toString() {
      return `file://${posixPath}`;
    },
  };
}

function joinPath(base, ...parts) {
  return makeUri(path.posix.join(base.path, ...parts));
}

function fileUri(fsPath) {
  const normalized = String(fsPath).replace(/\\/g, "/");
  return makeUri(/^[a-zA-Z]:/.test(normalized) ? `/${normalized}` : normalized);
}

function createResponse({ ok = true, status = 200, json, text, headers = {} }) {
  const headerMap = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    headers: {
      get: (name) => headerMap.get(String(name).toLowerCase()) ?? null,
    },
    json: async () => json,
    text: async () => text ?? "",
  };
}

let failures = 0;

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

function loadInstaller({
  directories = {},
  rawFiles = {},
  rawFailures = {},
  rawThrows = {},
  existingFiles = {},
  existingDirs = [],
  unreadableDirs = [],
  unreadableError,
} = {}) {
  const writes = [];
  const deletes = [];
  const createdDirs = [...existingDirs];
  const files = new Map(Object.entries(existingFiles));
  const modals = [];

  const listChildren = (dirFsPath) => {
    const prefix = `${dirFsPath.replace(/\\/g, "/")}/`;
    const names = new Set();
    for (const key of files.keys()) {
      const normalized = key.replace(/\\/g, "/");
      if (normalized.startsWith(prefix)) {
        names.add(normalized.slice(prefix.length).split("/")[0]);
      }
    }
    return [...names].map((name) => [name, FileType.File]);
  };

  const workspaceFs = {
    async createDirectory(uri) {
      createdDirs.push(uri.fsPath);
    },
    async readDirectory(uri) {
      if (unreadableDirs.includes(uri.fsPath)) {
        if (unreadableError) {
          throw unreadableError();
        }
        const error = new Error(`EACCES: ${uri.fsPath}`);
        error.code = "NoPermissions";
        throw error;
      }
      const children = listChildren(uri.fsPath);
      if (
        children.length === 0 &&
        !createdDirs.includes(uri.fsPath) &&
        !existingDirs.includes(uri.fsPath)
      ) {
        const error = new Error(`ENOENT: ${uri.fsPath}`);
        error.code = "FileNotFound";
        throw error;
      }
      return children;
    },
    async stat(uri) {
      if (files.has(uri.fsPath)) {
        return { type: FileType.File, ctime: 0, mtime: 0, size: 1 };
      }
      if (createdDirs.includes(uri.fsPath)) {
        return { type: FileType.Directory, ctime: 0, mtime: 0, size: 0 };
      }
      throw new Error(`ENOENT: ${uri.fsPath}`);
    },
    async readFile(uri) {
      if (!files.has(uri.fsPath)) {
        throw new Error(`ENOENT: ${uri.fsPath}`);
      }
      return Buffer.from(files.get(uri.fsPath), "utf-8");
    },
    async writeFile(uri, content) {
      writes.push(uri.fsPath);
      files.set(uri.fsPath, Buffer.from(content).toString("utf-8"));
    },
    async delete(uri) {
      deletes.push(uri.fsPath);
      for (const key of [...files.keys()]) {
        if (key.startsWith(uri.fsPath)) {
          files.delete(key);
        }
      }
    },
  };

  const vscodeStub = {
    Uri: { file: fileUri, joinPath, parse: (value) => makeUri(String(value)) },
    FileType,
    FileSystemError: class FileSystemError extends Error {},
    workspace: {
      fs: workspaceFs,
      getConfiguration: () => ({ get: () => undefined }),
      workspaceFolders: [],
    },
    window: {
      showErrorMessage: async () => undefined,
      showWarningMessage: (message, options) => {
        if (options && options.modal) {
          modals.push(message);
        }
        return Promise.resolve(undefined);
      },
      showInformationMessage: async () => undefined,
    },
    commands: { executeCommand: async () => undefined },
    env: { openExternal: async () => undefined },
    extensions: { getExtension: () => undefined },
    version: "1.99.0",
    ConfigurationTarget: { Global: 1 },
  };

  const fetchStub = async (url) => {
    const key = String(url);

    if (Object.prototype.hasOwnProperty.call(rawThrows, key)) {
      throw rawThrows[key]();
    }

    if (Object.prototype.hasOwnProperty.call(rawFailures, key)) {
      return createResponse({
        ok: false,
        status: rawFailures[key],
        text: "failed",
      });
    }

    if (Object.prototype.hasOwnProperty.call(rawFiles, key)) {
      return createResponse({ text: rawFiles[key] });
    }

    const apiMatch = key.match(
      /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\/(.*)\?ref=/,
    );
    if (apiMatch) {
      const remotePath = apiMatch[1]
        .split("/")
        .map((segment) => decodeURIComponent(segment))
        .join("/");
      if (Object.prototype.hasOwnProperty.call(directories, remotePath)) {
        return createResponse({ json: directories[remotePath] });
      }
    }

    return createResponse({ ok: false, status: 404, text: "not found" });
  };

  const skillIndex = {
    sources: [
      {
        id: "test-source",
        name: "Test Source",
        url: "https://github.com/owner/repo",
        branch: "main",
      },
      {
        id: "other-source",
        name: "Other Source",
        url: "https://github.com/other/repo",
        branch: "main",
      },
    ],
    skills: [],
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
    fetch: fetchStub,
    require(request) {
      if (request === "vscode") {
        return vscodeStub;
      }
      if (request === "./skillIndex") {
        return {
          loadSkillIndex: async () => skillIndex,
          getSourceBranch: async (source) => source.branch || "main",
        };
      }
      if (request === "./i18n") {
        return {
          isJapanese: () => false,
          messages: new Proxy(
            {},
            { get: (_target, prop) => () => String(prop) },
          ),
        };
      }
      if (request === "./githubAuth") {
        return {
          getGitHubToken: async () => undefined,
          hasStoredGitHubToken: async () => false,
        };
      }
      if (request === "./skillLocations") {
        return {
          getManagedSkillRoots: async () => [],
          resolveWorkspaceSkillsRootUri: (workspaceUri) => workspaceUri,
        };
      }
      if (request === "./githubFetch") {
        return {
          createGitHubHeaders: () => ({}),
          fetchGitHubWithOptionalAuthRetry: async (url) => fetchStub(url),
        };
      }
      if (request.startsWith("./")) {
        return requireSrcModule(request);
      }
      return require(request);
    },
  };

  vm.runInNewContext(transpiled.outputText, sandbox, { filename: sourcePath });

  return {
    installer: sandbox.module.exports,
    writes,
    deletes,
    createdDirs,
    files,
    modals,
  };
}

function remoteFile(name, rawPath) {
  return {
    name,
    type: "file",
    download_url: `${RAW}/owner/repo/main/${rawPath}`,
  };
}

const SKILL_MD = "---\nname: demo\ndescription: demo\n---\n\n# demo\n";

function demoSources() {
  return {
    directories: {
      "skills/demo": [
        remoteFile("SKILL.md", "skills/demo/SKILL.md"),
        remoteFile("extra.md", "skills/demo/extra.md"),
      ],
    },
    rawFiles: {
      [`${RAW}/owner/repo/main/skills/demo/SKILL.md`]: SKILL_MD,
      [`${RAW}/owner/repo/main/skills/demo/extra.md`]: "extra",
    },
  };
}

function installDemo(harness, overrides = {}, installOptions = {}) {
  return harness.installer.installSkill(
    {
      name: "demo",
      source: "test-source",
      path: "skills/demo",
      description: "demo",
      categories: [],
      ...overrides,
    },
    makeUri(ROOT_POSIX),
    {},
    undefined,
    { interactive: false, allowRetry: false, ...installOptions },
  );
}

const DEMO_DIR_FS = posixPathToFsPath(`${ROOT_POSIX}/demo`);
const DEMO_META_FS = posixPathToFsPath(`${ROOT_POSIX}/demo/.skill-meta.json`);
const DEMO_SKILL_MD_FS = posixPathToFsPath(`${ROOT_POSIX}/demo/SKILL.md`);

async function main() {
  await test("install into a folder owned by another source is refused", async () => {
    const harness = loadInstaller({
      ...demoSources(),
      existingDirs: [DEMO_DIR_FS],
      existingFiles: {
        [DEMO_META_FS]: JSON.stringify({
          name: "demo",
          source: "other-source",
          relativePath: "demo",
        }),
        [DEMO_SKILL_MD_FS]: "# other source content\n",
      },
    });

    await assert.rejects(
      () => installDemo(harness),
      (error) => error.name === "SkillInstallTargetConflictError",
      "a foreign owner must abort the install",
    );

    assert.deepStrictEqual(
      Array.from(harness.writes),
      [],
      "nothing may be written while the target is owned by another source",
    );
    assert.deepStrictEqual(
      Array.from(harness.deletes),
      [],
      "a refused install must not delete the existing skill",
    );
  });

  await test("reinstall over the same source proceeds", async () => {
    const harness = loadInstaller({
      ...demoSources(),
      existingDirs: [DEMO_DIR_FS],
      existingFiles: {
        [DEMO_META_FS]: JSON.stringify({
          name: "demo",
          source: "test-source",
          relativePath: "demo",
          customWhenToUse: "keep me",
        }),
        [DEMO_SKILL_MD_FS]: SKILL_MD,
      },
    });

    const result = await installDemo(harness);
    assert.strictEqual(result.status, "ok");
    assert.deepStrictEqual(
      Array.from(harness.deletes),
      [],
      "same-owner reinstall must not delete the folder",
    );

    const meta = JSON.parse(harness.files.get(DEMO_META_FS));
    assert.strictEqual(
      meta.customWhenToUse,
      "keep me",
      "user metadata must survive a same-owner reinstall",
    );
  });

  await test("existing folder without metadata is treated as unknown owner", async () => {
    const harness = loadInstaller({
      ...demoSources(),
      existingDirs: [DEMO_DIR_FS],
      existingFiles: {
        [DEMO_SKILL_MD_FS]: "# hand written local skill\n",
      },
    });

    await assert.rejects(
      () => installDemo(harness),
      (error) => error.name === "SkillInstallTargetConflictError",
      "an unidentifiable owner must not be overwritten silently",
    );
  });

  await test("empty leftover folder does not block the install", async () => {
    const harness = loadInstaller({
      ...demoSources(),
      existingDirs: [DEMO_DIR_FS],
    });

    const result = await installDemo(harness);
    assert.strictEqual(result.status, "ok");
  });

  await test("an unreadable target folder is not treated as free space", async () => {
    const harness = loadInstaller({
      ...demoSources(),
      existingDirs: [DEMO_DIR_FS],
      unreadableDirs: [DEMO_DIR_FS],
    });

    await assert.rejects(
      () => installDemo(harness),
      (error) => error.name === "SkillInstallTargetConflictError",
      "a permission error must not be read as an absent folder",
    );
    assert.deepStrictEqual(Array.from(harness.writes), []);
  });

  await test("a permission error mentioning FileNotFound is still not absence", async () => {
    const harness = loadInstaller({
      ...demoSources(),
      existingDirs: [DEMO_DIR_FS],
      unreadableDirs: [DEMO_DIR_FS],
      unreadableError: () => {
        // 対象パスや詳細に FileNotFound の語が混ざっても code を優先する
        const error = new Error(
          "NoPermissions: cannot read /skills/FileNotFound-demo",
        );
        error.code = "NoPermissions";
        return error;
      },
    });

    await assert.rejects(
      () => installDemo(harness),
      (error) => error.name === "SkillInstallTargetConflictError",
      "the error code must win over the message text",
    );
    assert.deepStrictEqual(Array.from(harness.writes), []);
  });

  await test("a request timeout is classified as a retryable transport failure", async () => {
    const harness = loadInstaller({
      ...demoSources(),
      rawThrows: {
        [`${RAW}/owner/repo/main/skills/demo/extra.md`]: () => {
          const error = new Error(
            `Request timeout: ${RAW}/owner/repo/main/skills/demo/extra.md`,
          );
          error.name = "TimeoutError";
          error.code = "ETIMEDOUT";
          return error;
        },
      },
    });

    const result = await installDemo(harness);
    assert.strictEqual(result.status, "partial");
    assert.deepStrictEqual(
      Array.from(result.failures).map((failure) => failure.kind),
      ["transport"],
      "a timeout must reach the batch layer as transport, not unknown",
    );
    assert.strictEqual(
      harness.installer.isRetryableInstallFailure(Array.from(result.failures)),
      true,
    );
  });

  await test("the timeout thrown by the fetch layer carries a transport code", () => {
    const githubFetchSource = fs.readFileSync(
      path.join(SRC_DIR, "githubFetch.ts"),
      "utf8",
    );
    const timeoutBranch = githubFetchSource.slice(
      githubFetchSource.indexOf("if (timedOut)"),
      githubFetchSource.indexOf("throw error;"),
    );
    assert.ok(
      /code\s*=\s*"ETIMEDOUT"/.test(timeoutBranch),
      "the timeout error must be classifiable without parsing its message",
    );
  });

  await test("an undetermined default branch is not cached", () => {
    const skillIndexSource = fs.readFileSync(
      path.join(SRC_DIR, "skillIndex.ts"),
      "utf8",
    );
    const start = skillIndexSource.indexOf(
      "export async function getDefaultBranch(",
    );
    const body = skillIndexSource.slice(
      start,
      skillIndexSource.indexOf("\nexport ", start + 1),
    );
    assert.ok(
      !/cacheResolvedBranch\([^)]*"main"\)/.test(body),
      "a guessed branch must not be cached for the whole session",
    );
  });

  await test("install result exposes the real write target", async () => {
    const harness = loadInstaller(demoSources());
    const result = await installDemo(harness, { name: "Demo Skill" });

    assert.strictEqual(
      result.installedPath,
      "demo-skill",
      "callers must not have to recompute the sanitized folder name",
    );
    assert.strictEqual(
      result.installedRoot.replace(/\\/g, "/").toLowerCase(),
      DEMO_DIR_FS.replace(/\\/g, "/").toLowerCase().replace("/demo", ""),
    );
  });

  await test("server errors are classified as retryable, 404 is not", async () => {
    const serverErrorHarness = loadInstaller({
      ...demoSources(),
      rawFailures: {
        [`${RAW}/owner/repo/main/skills/demo/extra.md`]: 503,
      },
    });

    const serverResult = await installDemo(serverErrorHarness);
    assert.strictEqual(serverResult.status, "partial");
    assert.deepStrictEqual(
      Array.from(serverResult.failures).map((failure) => failure.kind),
      ["server-error"],
      "5xx must survive as a structured kind instead of a message string",
    );
    assert.strictEqual(
      serverErrorHarness.installer.isRetryableInstallFailure(
        Array.from(serverResult.failures),
      ),
      true,
    );

    const notFoundHarness = loadInstaller({
      ...demoSources(),
      rawFailures: {
        [`${RAW}/owner/repo/main/skills/demo/extra.md`]: 404,
      },
    });

    const notFoundResult = await installDemo(notFoundHarness);
    assert.strictEqual(notFoundResult.status, "partial");
    assert.deepStrictEqual(
      Array.from(notFoundResult.failures).map((failure) => failure.kind),
      ["not-found"],
    );
    assert.strictEqual(
      notFoundHarness.installer.isRetryableInstallFailure(
        Array.from(notFoundResult.failures),
      ),
      false,
      "permanent failures must never enter the retry set",
    );
  });

  await test("partial installs stay detectable after a restart", async () => {
    const harness = loadInstaller({
      ...demoSources(),
      rawFailures: {
        [`${RAW}/owner/repo/main/skills/demo/extra.md`]: 503,
      },
    });

    await installDemo(harness);
    const meta = JSON.parse(harness.files.get(DEMO_META_FS));
    assert.strictEqual(
      meta.repairState,
      "partial",
      "a partial install must be recorded so repair can find it later",
    );
  });

  await test("conflict is not raised for an unknown kind of empty failure set", () => {
    const harness = loadInstaller(demoSources());
    assert.strictEqual(
      harness.installer.isRetryableInstallFailure([]),
      false,
      "an empty failure list must not be treated as retryable",
    );
    assert.strictEqual(
      harness.installer.isRetryableInstallFailure([
        { message: "x", kind: "transport" },
        { message: "y", kind: "rate-limit" },
      ]),
      false,
      "a mixed set containing a permanent failure must not be retried",
    );
  });

  await test("preset index has no install target collision", () => {
    const harness = loadInstaller(demoSources());
    const byFolder = new Map();
    const collisions = [];

    for (const skill of skillIndexJson.skills) {
      const folder = harness.installer.resolveSkillFolderName(skill);
      const previous = byFolder.get(folder);
      if (previous && previous.source !== skill.source) {
        collisions.push(`${folder}: ${previous.source} vs ${skill.source}`);
      }
      byFolder.set(folder, skill);
    }

    assert.deepStrictEqual(
      collisions,
      [],
      `skills from different sources must not share an install folder: ${collisions.join(", ")}`,
    );
  });

  await test("single-source index updates keep the global freshness date", () => {
    const indexUpdaterSource = fs.readFileSync(
      path.join(SRC_DIR, "indexUpdater.ts"),
      "utf8",
    );

    const partialScanFunctions = [
      "updateSingleSource",
      "updateIndexFromSingleSource",
      "addSource",
      "removeSource",
    ];

    for (const functionName of partialScanFunctions) {
      const start = indexUpdaterSource.indexOf(`function ${functionName}(`);
      assert.ok(start >= 0, `${functionName} must exist`);
      const nextFunction = indexUpdaterSource.indexOf(
        "\nexport async function ",
        start + 1,
      );
      const body = indexUpdaterSource.slice(
        start,
        nextFunction > 0 ? nextFunction : undefined,
      );
      assert.ok(
        body.includes("lastUpdated: currentIndex.lastUpdated"),
        `${functionName} must keep the previous lastUpdated so unscanned sources do not look fresh`,
      );
    }

    assert.ok(
      indexUpdaterSource.includes("scannedEverySource"),
      "full scans must only stamp lastUpdated when every source succeeded",
    );
  });

  await test("batch retry stays bounded and non-destructive", () => {
    const extensionSource = fs
      .readFileSync(path.join(SRC_DIR, "extension.ts"), "utf8")
      .replace(/\r\n/g, "\n");

    // 制御そのものは bulkInstall.ts 側で実行テストしている
    assert.ok(
      /runBulkInstallPlan\(/.test(extensionSource),
      "the bulk flows must delegate retry control to the tested plan helper",
    );
    assert.ok(
      /installBulkItem\(item, context, workspaceUri, allowUninstall, isCancelled\)/.test(
        extensionSource,
      ),
      "the plan must decide whether an attempt may uninstall first",
    );

    const manualRetry = extensionSource.slice(
      extensionSource.indexOf("async function showBulkInstallSummary("),
    );
    assert.ok(
      /autoRetry:\s*false/.test(manualRetry),
      "a manual retry must not start another automatic retry round",
    );
  });

  await test("cancelling mid-download stops before the next file", async () => {
    const harness = loadInstaller({
      directories: {
        "skills/demo": [
          remoteFile("SKILL.md", "skills/demo/SKILL.md"),
          remoteFile("extra.md", "skills/demo/extra.md"),
          remoteFile("more.md", "skills/demo/more.md"),
        ],
      },
      rawFiles: {
        [`${RAW}/owner/repo/main/skills/demo/SKILL.md`]: SKILL_MD,
        [`${RAW}/owner/repo/main/skills/demo/extra.md`]: "extra",
        [`${RAW}/owner/repo/main/skills/demo/more.md`]: "more",
      },
    });

    let cancelled = false;
    const result = await installDemo(
      harness,
      {},
      {
        isCancelled: () => {
          const previous = cancelled;
          cancelled = true;
          return previous;
        },
      },
    );

    assert.strictEqual(result.status, "partial");
    assert.deepStrictEqual(
      Array.from(result.failures).map((failure) => failure.kind),
      ["cancelled"],
      "a cancelled install must be recorded as cancelled, not as a transport error",
    );
    assert.strictEqual(
      harness.installer.isRetryableInstallFailure(Array.from(result.failures)),
      false,
      "a user cancellation must never trigger the automatic retry",
    );
    assert.strictEqual(
      Array.from(harness.writes).some((target) => target.endsWith("more.md")),
      false,
      "no further file may be fetched after the cancellation is observed",
    );
  });

  await test("cancelling during the listing does not start a new fetch", async () => {
    const harness = loadInstaller({
      directories: {
        "skills/demo": [remoteFile("notes.md", "skills/demo/notes.md")],
      },
      rawFiles: {
        [`${RAW}/owner/repo/main/skills/demo/notes.md`]: "notes",
        [`${RAW}/owner/repo/main/skills/demo/SKILL.md`]: SKILL_MD,
      },
    });

    // 最初のファイルへ進む前に中断する。SKILL.md 補完へ進んではいけない
    const result = await installDemo(harness, {}, { isCancelled: () => true });

    assert.strictEqual(result.status, "partial");
    assert.deepStrictEqual(
      Array.from(result.failures).map((failure) => failure.kind),
      ["cancelled"],
    );
    assert.strictEqual(
      Array.from(harness.writes).some((target) => target.endsWith("SKILL.md")),
      false,
      "no primary SKILL.md fallback may run after a cancellation",
    );
  });

  await test("every long bulk operation can be cancelled", () => {    const extensionSource = fs
      .readFileSync(path.join(SRC_DIR, "extension.ts"), "utf8")
      .replace(/\r\n/g, "\n");

    const bulkRuns = [
      ...extensionSource.matchAll(/withProgress\(\s*\{([\s\S]*?)\},/g),
    ].filter((match) => {
      const blockEnd = extensionSource.indexOf(match[0]) + match[0].length;
      return extensionSource
        .slice(blockEnd, blockEnd + 400)
        .includes("runBulkInstall(");
    });

    assert.ok(
      bulkRuns.length >= 6,
      `expected the bulk entry points to be found, got ${bulkRuns.length}`,
    );
    const nonCancellable = bulkRuns.filter(
      (match) => !/cancellable:\s*true/.test(match[1]),
    );
    assert.strictEqual(
      nonCancellable.length,
      0,
      "a long bulk install must let the user stop it",
    );
  });

  await test("a sanitized-name uninstall cannot delete another skill", async () => {
    const otherSkillDir = posixPathToFsPath(`${ROOT_POSIX}/demo`);
    const harness = loadInstaller({
      ...demoSources(),
      existingDirs: [otherSkillDir],
      existingFiles: {
        [`${otherSkillDir}\\.skill-meta.json`.replace(/\\/g, path.sep)]:
          JSON.stringify({ name: "demo", source: "test-source" }),
      },
    });

    // "demo!" は sanitize すると "demo" になるが、その demo は別スキル
    await assert.rejects(
      () =>
        harness.installer.uninstallSkill(
          "demo!",
          makeUri(ROOT_POSIX),
          undefined,
        ),
      /Refusing to delete/,
      "the sanitized fallback must prove ownership before deleting",
    );
    assert.deepStrictEqual(
      Array.from(harness.deletes),
      [],
      "no folder may be deleted when ownership cannot be proven",
    );
  });

  await test("a sanitized-name uninstall still removes its own legacy folder", async () => {
    const legacyDir = posixPathToFsPath(`${ROOT_POSIX}/demo`);
    const harness = loadInstaller({
      ...demoSources(),
      existingDirs: [legacyDir],
      existingFiles: {
        [`${legacyDir}\\.skill-meta.json`.replace(/\\/g, path.sep)]:
          JSON.stringify({ name: "demo!", source: "test-source" }),
      },
    });

    await harness.installer.uninstallSkill(
      "demo!",
      makeUri(ROOT_POSIX),
      undefined,
    );
    assert.strictEqual(
      Array.from(harness.deletes).length,
      1,
      "a legacy install recorded under the sanitized name must still be removable",
    );
  });

  await test("a metadata-less folder is not deleted by a sanitized-name uninstall", async () => {
    const localDir = posixPathToFsPath(`${ROOT_POSIX}/demo`);
    const harness = loadInstaller({
      ...demoSources(),
      existingDirs: [localDir],
      existingFiles: {
        [`${localDir}\\SKILL.md`.replace(/\\/g, path.sep)]:
          "# hand written local skill\n",
      },
    });

    await assert.rejects(
      () =>
        harness.installer.uninstallSkill(
          "demo!",
          makeUri(ROOT_POSIX),
          undefined,
        ),
      /Refusing to delete/,
      "a user-authored folder without metadata must not be deleted",
    );
    assert.deepStrictEqual(Array.from(harness.deletes), []);
  });

  await test("corrupt metadata does not authorise a sanitized-name uninstall", async () => {
    const corruptDir = posixPathToFsPath(`${ROOT_POSIX}/demo`);
    const harness = loadInstaller({
      ...demoSources(),
      existingDirs: [corruptDir],
      existingFiles: {
        [`${corruptDir}\\.skill-meta.json`.replace(/\\/g, path.sep)]:
          "{ not json",
      },
    });

    await assert.rejects(
      () =>
        harness.installer.uninstallSkill(
          "demo!",
          makeUri(ROOT_POSIX),
          undefined,
        ),
      /Refusing to delete/,
      "unreadable metadata must not be read as proof of ownership",
    );
    assert.deepStrictEqual(Array.from(harness.deletes), []);
  });

  await test("an undeterminable branch is re-probed at most once per window", () => {
    const skillIndexSource = fs.readFileSync(
      path.join(SRC_DIR, "skillIndex.ts"),
      "utf8",
    );

    assert.ok(
      /unresolvedBranchCache/.test(skillIndexSource),
      "an undeterminable branch must be remembered briefly to avoid per-skill probing",
    );
    assert.ok(
      /UNRESOLVED_BRANCH_TTL_MS/.test(skillIndexSource),
      "the negative cache must expire instead of pinning a guess for the session",
    );
    assert.ok(
      /unresolvedBranchCache\.delete\(repoUrl\)/.test(skillIndexSource),
      "a later successful resolution must clear the negative entry",
    );
  });

  await test("repair notice fingerprint ignores volatile fields", () => {
    const extensionSource = fs
      .readFileSync(path.join(SRC_DIR, "extension.ts"), "utf8")
      .replace(/\r\n/g, "\n");

    const start = extensionSource.indexOf(
      "export function buildRepairFingerprint(",
    );
    assert.ok(start >= 0, "buildRepairFingerprint must exist");
    const body = extensionSource.slice(
      start,
      extensionSource.indexOf("\n}", start),
    );

    for (const volatileField of ["installedAt", "Date", "errors", "message"]) {
      assert.ok(
        !body.includes(volatileField),
        `the fingerprint must not depend on ${volatileField}`,
      );
    }
    assert.ok(
      body.includes("rootPath") && body.includes("repairState"),
      "the fingerprint must identify the repair target set",
    );
  });
}

main().then(() => {
  if (failures > 0) {
    process.exitCode = 1;
  }
});
