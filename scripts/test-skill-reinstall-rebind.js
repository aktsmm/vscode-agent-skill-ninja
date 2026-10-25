#!/usr/bin/env node

// installSkillUpdate の `rebind`（出所未記録の配置への初回関連付け、明示承認済みの source 切り替え）。
//
// 実ファイルシステムで、正規のステージング + バックアップ処理を通ることと、
// 失敗時に元のフォルダが残ることを確認する。

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const sourceRoot = path.join(__dirname, "../src");
const sha = "a".repeat(40);
const revision = {
  owner: "owner",
  repo: "repo",
  ref: "main",
  remotePath: "skills/demo",
  commitSha: sha,
  contentSha: "b".repeat(40),
  kind: "tree",
};
const skill = {
  name: "demo",
  source: "test-source",
  path: "skills/demo",
  description: "demo",
  categories: [],
};
const content =
  "---\nname: demo\ndescription: From source\n---\n# From source\n";
const uri = (fsPath) => ({
  scheme: "file",
  fsPath: path.resolve(fsPath),
  path: path.resolve(fsPath).replace(/\\/g, "/"),
  toString() {
    return `file://${this.path}`;
  },
});
const outputCache = new Map();

function harness({ existingMeta } = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ninja-rebind-"));
  const rootPath = path.join(temporary, "skills");
  const destination = path.join(rootPath, "demo");
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, "SKILL.md"), "locally written skill");
  fs.writeFileSync(path.join(destination, "old-only.txt"), "not in source");
  if (existingMeta) {
    fs.writeFileSync(
      path.join(destination, ".skill-meta.json"),
      JSON.stringify(existingMeta),
    );
  }
  const root = {
    rootUri: uri(rootPath),
    rootPath,
    isManaged: true,
    isReadOnly: false,
    scope: "userGlobal",
    label: "test",
    displayPath: rootPath,
  };
  const state = { fetchHook: undefined, sources: [] };
  const workspaceFs = {
    async createDirectory(target) {
      await fs.promises.mkdir(target.fsPath, { recursive: true });
    },
    async readFile(target) {
      return fs.promises.readFile(target.fsPath);
    },
    async writeFile(target, bytes) {
      await fs.promises.writeFile(target.fsPath, bytes);
    },
    async readDirectory(target) {
      return (
        await fs.promises.readdir(target.fsPath, { withFileTypes: true })
      ).map((entry) => [
        entry.name,
        entry.isSymbolicLink() ? 64 : entry.isDirectory() ? 2 : 1,
      ]);
    },
    async stat(target) {
      const stat = await fs.promises.lstat(target.fsPath);
      return { type: stat.isSymbolicLink() ? 64 : stat.isDirectory() ? 2 : 1 };
    },
    async rename(from, to) {
      if (fs.existsSync(to.fsPath)) {
        throw new Error("Destination exists");
      }
      await fs.promises.rename(from.fsPath, to.fsPath);
    },
    async delete(target) {
      await fs.promises.rm(target.fsPath, { recursive: true });
    },
  };
  const vscode = {
    Uri: {
      file: uri,
      joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)),
    },
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    FileSystemError: class extends Error {},
    workspace: {
      fs: workspaceFs,
      getConfiguration: () => ({ get: () => undefined }),
    },
    window: {
      showErrorMessage() {},
      showWarningMessage() {},
      showInformationMessage() {},
    },
  };
  const response = (body, status = 200) => ({
    ok: status === 200,
    status,
    statusText: "test",
    headers: { get: () => null },
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    arrayBuffer: async () => {
      const data = Buffer.from(
        typeof body === "string" ? body : JSON.stringify(body),
        "utf-8",
      );
      return data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      );
    },
  });
  const fetch = async (url) => {
    const override = await state.fetchHook?.(String(url));
    if (override) {
      return override;
    }
    if (String(url).includes("api.github.com")) {
      return response([
        {
          name: "SKILL.md",
          type: "file",
          download_url:
            "https://raw.githubusercontent.com/owner/repo/main/stale",
        },
        {
          name: "new.txt",
          type: "file",
          download_url:
            "https://raw.githubusercontent.com/owner/repo/main/stale",
        },
      ]);
    }
    return response(
      String(url).endsWith("SKILL.md") ? content : "upstream companion",
    );
  };
  const cache = new Map();
  const load = (name) => {
    if (cache.has(name)) {
      return cache.get(name).exports;
    }
    const file = path.join(sourceRoot, `${name}.ts`);
    if (!outputCache.has(file)) {
      outputCache.set(
        file,
        ts.transpileModule(fs.readFileSync(file, "utf8"), {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
          },
          fileName: file,
        }).outputText,
      );
    }
    const module = { exports: {} };
    cache.set(name, module);
    const requireStub = (request) => {
      if (request === "vscode") {
        return vscode;
      }
      if (request === "./skillIndex") {
        return {
          loadSkillIndex: async () => ({
            sources: [
              {
                id: "test-source",
                url: "https://github.com/owner/repo",
                branch: "main",
              },
              {
                id: "other-source",
                url: "https://github.com/owner/other",
                branch: "main",
              },
            ],
          }),
          getSourceBranch: async () => "main",
        };
      }
      if (request === "./i18n") {
        return {
          isJapanese: () => false,
          messages: new Proxy({}, { get: () => () => "test message" }),
        };
      }
      if (request === "./githubAuth") {
        return {
          getGitHubToken: async () => undefined,
          hasStoredGitHubToken: async () => false,
        };
      }
      if (request === "./skillLocations") {
        return { resolveWorkspaceSkillsRootUri: (value) => value };
      }
      if (request === "./githubFetch") {
        return {
          fetchGitHubWithOptionalAuthRetry: fetch,
          createGitHubHeaders: () => ({}),
        };
      }
      if (request.startsWith("./")) {
        return load(request.slice(2));
      }
      return require(request);
    };
    vm.runInNewContext(
      outputCache.get(file),
      {
        module,
        exports: module.exports,
        require: requireStub,
        Buffer,
        process,
        URL,
        URLSearchParams,
        AbortController,
        console: { log() {}, warn() {}, error() {} },
      },
      { filename: file },
    );
    return module.exports;
  };
  const installer = load("skillInstaller");
  const snapshot = () => {
    const collect = (folder, prefix = "") =>
      fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
        const relative = `${prefix}${entry.name}`;
        return entry.isDirectory()
          ? collect(path.join(folder, entry.name), `${relative}/`)
          : [
              [
                relative,
                fs.readFileSync(path.join(folder, entry.name)).toString("hex"),
              ],
            ];
      });
    return collect(destination);
  };
  const original = snapshot();
  const synthetic = {
    name: "demo",
    source: existingMeta?.source ?? "local",
    remotePath: existingMeta?.remotePath,
    description: "",
    categories: [],
    installedAt: existingMeta?.installedAt ?? "",
    relativePath: "demo",
    sourceRevision: existingMeta?.sourceRevision,
  };
  return {
    rootPath,
    destination,
    state,
    response,
    run: (options, overrides = {}) =>
      installer.installSkillUpdate(
        overrides.skill ?? skill,
        uri(rootPath),
        {},
        root,
        overrides.meta ?? synthetic,
        overrides.revision ?? revision,
        options,
      ),
    readMeta: () =>
      JSON.parse(
        fs.readFileSync(path.join(destination, ".skill-meta.json"), "utf8"),
      ),
    unchanged: () => assert.deepEqual(snapshot(), original),
    cleanTransaction: () =>
      assert.deepEqual(
        fs
          .readdirSync(rootPath)
          .filter((name) => name.startsWith(".skill-update-")),
        [],
      ),
    dispose: () => fs.rmSync(temporary, { recursive: true, force: true }),
  };
}

let passed = 0;
async function test(name, options, callback) {
  const env = harness(options);
  try {
    await callback(env);
    passed += 1;
    console.log(`PASS ${name}`);
  } finally {
    env.dispose();
  }
}

async function main() {
  await test(
    "rebind associates a folder without metadata through the regular install path",
    {},
    async (env) => {
      const result = await env.run({ rebind: true });
      assert.equal(result.status, "ok");
      assert.equal(
        fs.readFileSync(path.join(env.destination, "SKILL.md"), "utf8"),
        content,
      );
      assert.equal(
        fs.existsSync(path.join(env.destination, "old-only.txt")),
        false,
      );
      const meta = env.readMeta();
      assert.equal(meta.source, "test-source");
      assert.equal(meta.remotePath, "skills/demo");
      assert.deepEqual(meta.sourceRevision, revision);
      assert.equal(meta.relativePath, "demo");
      env.cleanTransaction();
    },
  );

  await test(
    "without rebind, a folder without metadata is still refused",
    {},
    async (env) => {
      await assert.rejects(env.run({}), /ownership changed|ENOENT/);
      env.unchanged();
    },
  );

  await test(
    "rebind refuses a revision that does not match the candidate path",
    {},
    async (env) => {
      await assert.rejects(
        env.run(
          { rebind: true },
          { revision: { ...revision, remotePath: "skills/other" } },
        ),
        /ownership changed/,
      );
      env.unchanged();
      env.cleanTransaction();
    },
  );

  await test(
    "rebind refuses when the revision belongs to another repository",
    {},
    async (env) => {
      await assert.rejects(
        env.run({ rebind: true }, { revision: { ...revision, repo: "other" } }),
        /ownership changed/,
      );
      env.unchanged();
    },
  );

  await test(
    "a failed download leaves the original folder untouched",
    {},
    async (env) => {
      env.state.fetchHook = (url) => {
        if (url.endsWith("SKILL.md")) {
          return env.response("failed", 404);
        }
      };
      await assert.rejects(env.run({ rebind: true }));
      env.unchanged();
      env.cleanTransaction();
    },
  );

  await test(
    "beforeSwap can veto the swap after the download without touching the original",
    {},
    async (env) => {
      let called = 0;
      await assert.rejects(
        env.run({
          rebind: true,
          beforeSwap: async () => {
            called += 1;
            throw new Error("changed after the preview");
          },
        }),
        /changed after the preview/,
      );
      assert.equal(called, 1);
      env.unchanged();
      env.cleanTransaction();
    },
  );

  await test(
    "rebind stops when the recorded source changed after the plan",
    {},
    async (env) => {
      fs.writeFileSync(
        path.join(env.destination, ".skill-meta.json"),
        JSON.stringify({
          name: "demo",
          source: "other-source",
          remotePath: "somewhere/else",
          installedAt: "2026-01-01T00:00:00.000Z",
        }),
      );
      await assert.rejects(env.run({ rebind: true }), /ownership changed/);
      assert.equal(
        fs.readFileSync(path.join(env.destination, "SKILL.md"), "utf8"),
        "locally written skill",
      );
    },
  );

  const verifiedOther = {
    name: "demo",
    source: "other-source",
    remotePath: "elsewhere/demo",
    description: "",
    categories: [],
    installedAt: "2026-01-01T00:00:00.000Z",
    relativePath: "demo",
    sourceRevision: {
      owner: "owner",
      repo: "other",
      ref: "main",
      remotePath: "elsewhere/demo",
      commitSha: "c".repeat(40),
      contentSha: "d".repeat(40),
      kind: "tree",
    },
  };

  await test(
    "switching source needs rebind and then re-records the new source",
    { existingMeta: verifiedOther },
    async (env) => {
      await assert.rejects(env.run({}), /ownership changed/);
      env.unchanged();

      const result = await env.run({ rebind: true });
      assert.equal(result.status, "ok");
      const meta = env.readMeta();
      assert.equal(meta.source, "test-source");
      assert.equal(meta.remotePath, "skills/demo");
      assert.deepEqual(meta.sourceRevision, revision);
    },
  );

  console.log(`\nSkill reinstall rebind tests passed (${passed}).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
