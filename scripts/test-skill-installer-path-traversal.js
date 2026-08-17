#!/usr/bin/env node

// インストール経路のパス封じ込めを検証する。
//
// 既存テストの fake `Uri.joinPath` は Node の `path.join` を使っているため、
// 実際の `vscode.Uri.joinPath`（POSIX 結合 + fsPath 変換）とは挙動が違う。
// ここでは実挙動を再現し、Windows / Linux どちらでも同じ結論になるようにする。
// 書き込みは全てメモリ上に記録するので、退行しても実ファイルは汚さない。

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const SRC_DIR = path.join(__dirname, "..", "src");

// スタブしない相対 import は src の TypeScript をそのまま読み込む
function requireSrcModule(relativeRequest) {
  const filePath = path.join(SRC_DIR, `${relativeRequest.slice(2)}.ts`);
  const source = fs.readFileSync(filePath, "utf8");
  const output = ts.transpileModule(source, {
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

const sourcePath = path.join(__dirname, "..", "src", "skillInstaller.ts");
const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

const FileType = { File: 1, Directory: 2, SymbolicLink: 64 };

// --- 実 vscode.Uri.joinPath 相当 -------------------------------------------
// path は常に POSIX 形式で保持し、fsPath でプラットフォーム表現へ変換する。
// `..\..\x` は POSIX 結合では 1 セグメントのまま通り、
// fsPath 変換後に Windows の区切りとして解決される。

const WIN_DRIVE = /^\/([a-zA-Z]:)(\/.*)?$/;

function posixPathToFsPath(posixPath) {
  const driveMatch = posixPath.match(WIN_DRIVE);
  if (driveMatch) {
    const rest = driveMatch[2] || "";
    return `${driveMatch[1]}${rest.replace(/\//g, "\\")}`;
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

// Windows での脱出を再現するため、常にドライブ付きルートを使う
const ROOT_POSIX = "/c:/ninja/skills";
const ROOT_FS = posixPathToFsPath(ROOT_POSIX);

function joinPath(base, ...parts) {
  return makeUri(path.posix.join(base.path, ...parts));
}

function fileUri(fsPath) {
  const normalized = String(fsPath).replace(/\\/g, "/");
  return makeUri(/^[a-zA-Z]:/.test(normalized) ? `/${normalized}` : normalized);
}

// fsPath は実行 OS に依存するので、比較はプラットフォーム非依存の形に正規化する
// vm sandbox が返す配列は別 realm なので、比較前に Array.from で host 側へ移す
function normalizeForCompare(fsPath) {
  return String(fsPath).replace(/\\/g, "/").toLowerCase();
}

function isUnder(parentFsPath, targetFsPath) {
  const parent = normalizeForCompare(parentFsPath).replace(/\/$/, "");
  return normalizeForCompare(targetFsPath).startsWith(`${parent}/`);
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

const RAW = "https://raw.githubusercontent.com";
const API = "https://api.github.com";

function createResponse({ ok = true, status = 200, json, text }) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => json,
    text: async () => text ?? "",
  };
}

function loadInstaller({
  directories = {},
  rawFiles = {},
  managedRoots = [],
} = {}) {
  const writes = [];
  const createdDirs = [];
  const deletes = [];
  const deleteCalls = [];
  const files = new Map();
  const warnings = [];
  const requestedUrls = [];

  const workspaceFs = {
    async createDirectory(uri) {
      createdDirs.push(uri.fsPath);
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
    async readDirectory() {
      return [];
    },
    async delete(uri, options) {
      deletes.push(uri.fsPath);
      deleteCalls.push({ path: uri.fsPath, options });
    },
  };

  const vscodeStub = {
    Uri: { file: fileUri, joinPath, parse: (value) => makeUri(String(value)) },
    FileType,
    workspace: {
      fs: workspaceFs,
      getConfiguration: () => ({ get: () => undefined }),
      workspaceFolders: [],
    },
    window: {
      showErrorMessage: async () => undefined,
      showWarningMessage: (message) => {
        warnings.push(message);
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
    requestedUrls.push(key);

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
      if (request === "./installedSkillIndex") {
        return { normalizeInstalledSkillSource: (source) => source };
      }
      if (request === "./skillLocations") {
        return {
          getManagedSkillRoots: async () => managedRoots,
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
    createdDirs,
    deletes,
    deleteCalls,
    files,
    warnings,
    requestedUrls,
  };
}

function remoteFile(name, rawPath) {
  return {
    name,
    type: "file",
    download_url: `${RAW}/owner/repo/main/${rawPath}`,
  };
}

function installDemo(harness, overrides = {}) {
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
    { interactive: false, allowRetry: false },
  );
}

async function main() {
  await test("unsafe remote entry names produce zero writes outside the skill folder", async () => {
    const harness = loadInstaller({
      directories: {
        "skills/demo": [
          remoteFile("SKILL.md", "skills/demo/SKILL.md"),
          remoteFile("..\\..\\..\\evil.txt", "skills/demo/evil"),
          remoteFile("../escape.txt", "skills/demo/escape"),
          remoteFile("nested/inner.md", "skills/demo/inner"),
          { name: "..\\..\\evil-dir", type: "dir", download_url: null },
        ],
      },
      rawFiles: {
        [`${RAW}/owner/repo/main/skills/demo/SKILL.md`]:
          "---\nname: demo\ndescription: demo\n---\n\n# demo\n",
        [`${RAW}/owner/repo/main/skills/demo/evil`]: "pwned",
        [`${RAW}/owner/repo/main/skills/demo/escape`]: "pwned",
        [`${RAW}/owner/repo/main/skills/demo/inner`]: "pwned",
      },
    });

    const result = await installDemo(harness);

    const skillFolderFs = posixPathToFsPath(`${ROOT_POSIX}/demo`);
    const escaping = harness.writes.filter(
      (target) => !isUnder(skillFolderFs, target),
    );
    assert.deepStrictEqual(
      escaping,
      [],
      `writes escaped the skill folder: ${escaping.join(", ")}`,
    );

    const escapingDirs = harness.createdDirs.filter(
      (target) =>
        normalizeForCompare(target) !== normalizeForCompare(skillFolderFs) &&
        !isUnder(skillFolderFs, target),
    );
    assert.deepStrictEqual(
      escapingDirs,
      [],
      `createDirectory escaped the skill folder: ${escapingDirs.join(", ")}`,
    );

    assert.ok(
      harness.writes.some((target) => target.endsWith("SKILL.md")),
      "the legitimate SKILL.md must still be written",
    );
    assert.strictEqual(
      harness.writes.some((target) => /evil|escape|inner/i.test(target)),
      false,
      "unsafe entries must never be written",
    );

    assert.strictEqual(
      result.status,
      "ok",
      "policy skips must not downgrade the install to partial",
    );
    assert.ok(
      (result.skippedUnsafeEntries || []).length >= 4,
      `skipped entries must be reported separately, got ${JSON.stringify(result.skippedUnsafeEntries)}`,
    );
  });

  await test("remote .skill-meta.json is never written from the source", async () => {
    const harness = loadInstaller({
      directories: {
        "skills/demo": [
          remoteFile("SKILL.md", "skills/demo/SKILL.md"),
          remoteFile(".skill-meta.json", "skills/demo/meta"),
          remoteFile(".SKILL-META.JSON", "skills/demo/meta-upper"),
        ],
      },
      rawFiles: {
        [`${RAW}/owner/repo/main/skills/demo/SKILL.md`]:
          "---\nname: demo\ndescription: demo\n---\n\n# demo\n",
        [`${RAW}/owner/repo/main/skills/demo/meta`]:
          '{"relativePath":"../../../evil","name":"hostile"}',
        [`${RAW}/owner/repo/main/skills/demo/meta-upper`]:
          '{"relativePath":"../../../evil","name":"hostile"}',
      },
    });

    const result = await installDemo(harness);

    const metaFsPath = posixPathToFsPath(`${ROOT_POSIX}/demo/.skill-meta.json`);
    const written = harness.files.get(metaFsPath);
    assert.ok(written, "the extension must write its own metadata");
    assert.deepStrictEqual(
      result.skippedUnsafeEntries,
      undefined,
      "extension-owned metadata must not be reported as an unsafe file name",
    );

    const parsed = JSON.parse(written);
    assert.strictEqual(
      parsed.relativePath,
      "demo",
      "metadata must record the real install location",
    );
    assert.strictEqual(parsed.name, "demo");
  });

  await test("degenerate skill names never resolve to the skill root", () => {
    const { resolveSkillFolderName } = loadInstaller().installer;

    for (const name of ["()", "スキル", "日本語スキル", "---", "!!!", ""]) {
      const folder = resolveSkillFolderName({
        name,
        source: "test-source",
        path: "skills/日本語",
      });
      assert.ok(folder.length > 0, `empty folder name for ${name}`);
      assert.strictEqual(folder.includes("/"), false);
      assert.strictEqual(folder.includes("\\"), false);
    }

    // 配布元パスの末尾セグメントが使えるならそちらを優先する
    assert.strictEqual(
      resolveSkillFolderName({
        name: "スキル",
        source: "s",
        path: "skills/my-skill",
      }),
      "my-skill",
    );

    // 通常の名前は従来どおり（既存インストールとの互換）
    assert.strictEqual(
      resolveSkillFolderName({ name: "Docx Helper", source: "s", path: "p" }),
      "docx-helper",
    );
    assert.strictEqual(
      resolveSkillFolderName({
        name: "expense-report",
        source: "s",
        path: "p",
      }),
      "expense-report",
    );
  });

  await test("hashed fallback is stable and identity-scoped", () => {
    const { resolveSkillFolderName } = loadInstaller().installer;

    const a = resolveSkillFolderName({ name: "スキル", source: "src-a" });
    const b = resolveSkillFolderName({ name: "スキル", source: "src-a" });
    const c = resolveSkillFolderName({ name: "スキル", source: "src-b" });

    assert.strictEqual(a, b, "same identity must map to the same folder");
    assert.notStrictEqual(a, c, "different sources must not collide");
    assert.match(a, /^skill-[0-9a-f]{16}$/);

    // source に `/` を含む場合でも境界が混ざらない
    const split = resolveSkillFolderName({
      name: "スキル",
      source: "a/b",
      path: "c/日本語",
    });
    const merged = resolveSkillFolderName({
      name: "スキル",
      source: "a",
      path: "b/c/日本語",
    });
    assert.notStrictEqual(
      split,
      merged,
      "identity parts must not be ambiguous when concatenated",
    );
  });

  await test("refreshSingleSkillMetadata refuses paths outside the given root", async () => {
    const harness = loadInstaller();
    const { refreshSingleSkillMetadata } = harness.installer;

    const outsideSkillMd = makeUri("/c:/elsewhere/demo/SKILL.md");
    harness.files.set(
      posixPathToFsPath("/c:/elsewhere/demo/.skill-meta.json"),
      JSON.stringify({ name: "demo", source: "local", description: "" }),
    );

    const updated = await refreshSingleSkillMetadata(
      outsideSkillMd,
      makeUri(ROOT_POSIX),
    );

    assert.strictEqual(updated, false);
    assert.deepStrictEqual(
      harness.writes,
      [],
      "metadata outside the root must never be rewritten",
    );
  });

  await test("installing a degenerate name never targets the skill root", async () => {
    const harness = loadInstaller({
      directories: {
        "skills/日本語": [remoteFile("SKILL.md", "skills/jp/SKILL.md")],
      },
      rawFiles: {
        [`${RAW}/owner/repo/main/skills/jp/SKILL.md`]:
          "---\nname: スキル\ndescription: jp\n---\n\n# スキル\n",
      },
    });

    await harness.installer.installSkill(
      {
        name: "スキル",
        source: "test-source",
        path: "skills/日本語",
        description: "jp",
        categories: [],
      },
      makeUri(ROOT_POSIX),
      {},
      undefined,
      { interactive: false, allowRetry: false },
    );

    for (const dir of harness.createdDirs) {
      assert.notStrictEqual(
        normalizeForCompare(dir),
        normalizeForCompare(ROOT_FS),
        "createDirectory must not target the skill root itself",
      );
    }
    assert.deepStrictEqual(
      harness.deletes,
      [],
      "a successful install must not delete anything",
    );
  });

  await test("uninstallSkillByPath refuses escaping and degenerate paths", async () => {
    const harness = loadInstaller();
    const { uninstallSkillByPath } = harness.installer;
    const rootUri = makeUri(ROOT_POSIX);

    for (const relativePath of [
      "",
      ".",
      "./",
      "/SKILL.md",
      "SKILL.md",
      "..",
      "../../evil",
      "..\\..\\evil",
      "a/../../b",
      "..\\..\\..\\evil/SKILL.md",
      "c:/windows",
    ]) {
      await assert.rejects(
        () => uninstallSkillByPath(relativePath, rootUri, rootUri),
        `expected rejection for ${JSON.stringify(relativePath)}`,
      );
    }

    assert.deepStrictEqual(
      harness.deletes,
      [],
      "no delete should have been attempted for unsafe input",
    );

    await uninstallSkillByPath("demo/SKILL.md", rootUri, rootUri);
    await uninstallSkillByPath("pkg/child", rootUri, rootUri);
    assert.deepStrictEqual(harness.deletes.map(normalizeForCompare), [
      normalizeForCompare(posixPathToFsPath(`${ROOT_POSIX}/demo`)),
      normalizeForCompare(posixPathToFsPath(`${ROOT_POSIX}/pkg/child`)),
    ]);
    assert.deepStrictEqual(
      harness.deleteCalls.map(({ options }) => ({ ...options })),
      [
        { recursive: true, useTrash: true },
        { recursive: true, useTrash: true },
      ],
      "uninstall must stay recoverable from the trash",
    );
  });

  await test("uninstallSkill refuses separators and degenerate names", async () => {
    const harness = loadInstaller();
    const { uninstallSkill } = harness.installer;
    const rootUri = makeUri(ROOT_POSIX);

    for (const name of [
      "",
      "..",
      ".",
      "../evil",
      "..\\evil",
      "a/b",
      "c:/windows",
    ]) {
      await assert.rejects(
        () => uninstallSkill(name, rootUri, rootUri),
        `expected rejection for ${JSON.stringify(name)}`,
      );
    }
    assert.deepStrictEqual(harness.deletes, []);

    // 単一セグメントとして正当な名前は従来どおり削除できる
    await uninstallSkill("スキル", rootUri, rootUri);
    await uninstallSkill("Docx Helper", rootUri, rootUri);
    assert.deepStrictEqual(harness.deletes.map(normalizeForCompare), [
      normalizeForCompare(posixPathToFsPath(`${ROOT_POSIX}/スキル`)),
      normalizeForCompare(posixPathToFsPath(`${ROOT_POSIX}/docx-helper`)),
    ]);
    assert.ok(
      harness.deleteCalls.every(({ options }) => options?.useTrash === true),
      "uninstall must stay recoverable from the trash",
    );
  });

  await test("enrichSkillMeta canonicalizes local position fields", () => {
    const { enrichSkillMeta } = loadInstaller().installer;

    const hostile = enrichSkillMeta(
      {
        name: "demo",
        source: "test-source",
        description: "",
        categories: [],
        installedAt: "",
        relativePath: "../../../evil",
        packageParentRelativePath: "../../..",
        remotePath: "skills/pkg/demo",
        packageParentName: "pkg",
        packageParentRemotePath: "skills/pkg",
      },
      "pkg-local/demo",
    );

    assert.strictEqual(hostile.relativePath, "pkg-local/demo");
    assert.strictEqual(hostile.packageParentRelativePath, "pkg-local");
    assert.strictEqual(hostile.installedVia, "packageChild");
    // 走査から復元できないリモート側の情報は保持する（混在契約）
    assert.strictEqual(hostile.packageParentName, "pkg");
    assert.strictEqual(hostile.packageParentRemotePath, "skills/pkg");

    const topLevel = enrichSkillMeta(
      {
        name: "demo",
        source: "test-source",
        description: "",
        categories: [],
        installedAt: "",
        relativePath: "../../../evil",
        packageParentRelativePath: "../../..",
        remotePath: "skills/pkg/demo",
      },
      "demo",
    );

    assert.strictEqual(topLevel.relativePath, "demo");
    assert.strictEqual(
      topLevel.packageParentRelativePath,
      undefined,
      "a top-level install must not keep a package parent path",
    );
    assert.strictEqual(topLevel.installedVia, "packageChild");
    assert.strictEqual(topLevel.packageParentName, "pkg");
  });

  await test("enrichSkillMeta without a trusted path keeps legacy behavior", () => {
    const { enrichSkillMeta } = loadInstaller().installer;

    const meta = enrichSkillMeta({
      name: "demo",
      source: "test-source",
      description: "",
      categories: [],
      installedAt: "",
      relativePath: "pkg/demo",
      remotePath: "skills/pkg/demo",
    });

    assert.strictEqual(meta.relativePath, "pkg/demo");
    assert.strictEqual(meta.packageParentRelativePath, "pkg");
    assert.strictEqual(meta.installedVia, "packageChild");
    assert.strictEqual(meta.metadataVersion, 2);
  });

  await test("unsafe remote paths are rejected before any URL is built", async () => {
    const harness = loadInstaller();

    const result = await installDemo(harness, {
      name: "hostile",
      path: "skills/%2e%2e/%2e%2e/other-owner/other-repo/main/evil",
    }).catch((error) => ({ status: "incomplete", error }));

    const crossRepo = harness.requestedUrls.filter((url) =>
      url.includes("other-owner"),
    );
    assert.deepStrictEqual(
      crossRepo,
      [],
      `unsafe remote path reached the network: ${crossRepo.join(", ")}`,
    );
    assert.strictEqual(result.status, "incomplete");
  });

  await test("safe remote paths still resolve normally", async () => {
    const harness = loadInstaller({
      directories: {
        "skills/demo": [remoteFile("SKILL.md", "skills/demo/SKILL.md")],
      },
      rawFiles: {
        [`${RAW}/owner/repo/main/skills/demo/SKILL.md`]:
          "---\nname: demo\ndescription: demo\n---\n\n# demo\n",
      },
    });

    const result = await installDemo(harness);

    assert.strictEqual(result.status, "ok");
    assert.ok(
      harness.requestedUrls.some((url) =>
        url.startsWith(`${API}/repos/owner/repo/contents/skills/demo`),
      ),
      "the directory listing must still be requested",
    );
  });

  await test("root artifact detection ignores a supported single-skill root", async () => {
    const harness = loadInstaller({
      managedRoots: [{ rootUri: makeUri(ROOT_POSIX) }],
    });

    // ルート自身を 1 スキルとする構成は localSkillScanner が正規サポートする
    harness.files.set(
      posixPathToFsPath(`${ROOT_POSIX}/SKILL.md`),
      "---\nname: root-skill\n---\n\n# root skill\n",
    );

    const actual = await harness.installer.findRootLevelSkillArtifacts(
      makeUri(ROOT_POSIX),
    );
    assert.strictEqual(
      actual.length,
      0,
      `a plain root-level SKILL.md must not be reported as leftover, got ${JSON.stringify(actual)}`,
    );
  });

  await test("root artifact detection flags an empty recorded install location", async () => {
    const rootFs = posixPathToFsPath(ROOT_POSIX);

    for (const relativePath of [undefined, "", ".", "./"]) {
      const harness = loadInstaller({
        managedRoots: [{ rootUri: makeUri(ROOT_POSIX) }],
      });
      harness.files.set(
        posixPathToFsPath(`${ROOT_POSIX}/.skill-meta.json`),
        JSON.stringify({ name: "demo", source: "local", relativePath }),
      );

      const actual = await harness.installer.findRootLevelSkillArtifacts(
        makeUri(ROOT_POSIX),
      );
      assert.deepStrictEqual(
        Array.from(actual, (value) => normalizeForCompare(value)),
        [normalizeForCompare(rootFs)],
        `expected leftover for relativePath ${JSON.stringify(relativePath)}`,
      );
    }

    // 正しい位置が記録されているなら残骸ではない
    const healthy = loadInstaller({
      managedRoots: [{ rootUri: makeUri(ROOT_POSIX) }],
    });
    healthy.files.set(
      posixPathToFsPath(`${ROOT_POSIX}/.skill-meta.json`),
      JSON.stringify({ name: "demo", source: "local", relativePath: "demo" }),
    );
    assert.deepStrictEqual(
      Array.from(
        await healthy.installer.findRootLevelSkillArtifacts(
          makeUri(ROOT_POSIX),
        ),
      ),
      [],
    );
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exitCode = 1;
  } else {
    console.log("\nAll installer path traversal tests passed");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
