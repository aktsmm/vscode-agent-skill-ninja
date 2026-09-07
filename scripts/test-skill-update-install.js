#!/usr/bin/env node
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
const downloadTarget = {
  owner: "owner",
  repo: "repo",
  branch: "main",
  remotePath: skill.path,
};
const content = "---\nname: demo\ndescription: Updated\n---\n# Updated\n";
const uri = (fsPath) => ({
  scheme: "file",
  fsPath: path.resolve(fsPath),
  path: path.resolve(fsPath).replace(/\\/g, "/"),
  toString() {
    return `file://${this.path}`;
  },
});
const outputCache = new Map();

function harness() {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "ninja-update-test-"),
  );
  const rootPath = path.join(temporary, "skills");
  const installedPath = "group/original-name";
  const destination = path.join(rootPath, installedPath);
  fs.mkdirSync(destination, { recursive: true });
  const meta = {
    ...skill,
    remotePath: skill.path,
    relativePath: installedPath,
    installedAt: "2026-01-01T00:00:00.000Z",
    sourceRevision: {
      ...revision,
      commitSha: "c".repeat(40),
      contentSha: "d".repeat(40),
    },
    customWhenToUse: "my custom text",
    registrationDisabled: true,
  };
  fs.writeFileSync(
    path.join(destination, "SKILL.md"),
    "locally edited original",
  );
  fs.writeFileSync(path.join(destination, "removed.txt"), "deleted upstream");
  fs.writeFileSync(
    path.join(destination, ".skill-meta.json"),
    JSON.stringify(meta),
  );
  const root = {
    rootUri: uri(rootPath),
    rootPath,
    isManaged: true,
    isReadOnly: false,
    scope: "workspace",
    label: "test",
    displayPath: rootPath,
  };
  const requests = [];
  const requestOptions = [];
  const state = {
    fetchHook: undefined,
    renameHook: undefined,
    deleteHook: undefined,
    sourceBranch: undefined,
    token: undefined,
    revisionEntries: undefined,
  };
  const fileType = { File: 1, Directory: 2, SymbolicLink: 64 };
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
      await state.renameHook?.(from, to);
      if (fs.existsSync(to.fsPath)) {
        throw new Error("Destination exists");
      }
      await fs.promises.rename(from.fsPath, to.fsPath);
    },
    async delete(target) {
      await state.deleteHook?.(target);
      await fs.promises.rm(target.fsPath, { recursive: true });
    },
  };
  const vscode = {
    Uri: {
      file: uri,
      joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)),
    },
    FileType: fileType,
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
  });
  const fetch = async (url, options) => {
    requests.push(String(url));
    requestOptions.push(options);
    const override = await state.fetchHook?.(String(url), options);
    if (override) {
      return override;
    }
    if (state.revisionEntries) {
      const rootSha = "e".repeat(40);
      if (String(url).includes("/commits/")) {
        return response({ sha, commit: { tree: { sha: rootSha } } });
      }
      if (String(url).includes("/git/trees/")) {
        return response({
          sha: rootSha,
          truncated: false,
          tree: state.revisionEntries,
        });
      }
    }
    if (String(url).includes("api.github.com")) {
      const nested = String(url).includes("/assets?");
      return response(
        nested
          ? [
              {
                name: "nested.txt",
                type: "file",
                download_url:
                  "https://raw.githubusercontent.com/owner/repo/main/stale",
              },
            ]
          : [
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
              {
                name: ".skill-meta.json",
                type: "file",
                download_url: "https://example.invalid/metadata",
              },
              { name: "assets", type: "dir" },
            ],
      );
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
            ],
          }),
          getSourceBranch: async () => {
            if (state.sourceBranch) {
              return state.sourceBranch;
            }
            throw new Error("Pinned update resolved a mutable branch");
          },
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
          getGitHubToken: async () => state.token,
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
  return {
    temporary,
    rootPath,
    installedPath,
    destination,
    meta,
    root,
    state,
    installer,
    requests,
    requestOptions,
    response,
    createRevisionResolver: load("skillUpdates").createSkillRevisionResolver,
    runFresh: (options = {}, candidate = skill) => {
      state.sourceBranch = "main";
      return installer.installSkill(candidate, uri(rootPath), {}, root, {
        interactive: false,
        ...options,
      });
    },
    readFreshMeta: (installedPath = "demo") =>
      JSON.parse(
        fs.readFileSync(
          path.join(rootPath, installedPath, ".skill-meta.json"),
          "utf8",
        ),
      ),
    run: (options) =>
      installer.installSkillUpdate(
        skill,
        uri(rootPath),
        {},
        root,
        meta,
        revision,
        options,
      ),
    unchanged: () => assert.deepEqual(snapshot(), original),
    clean: () =>
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
async function test(name, callback) {
  const env = harness();
  try {
    await callback(env);
    passed += 1;
    console.log(`PASS ${name}`);
  } finally {
    env.dispose();
  }
}

async function main() {
  const treeEntry = {
    path: skill.path,
    sha: revision.contentSha,
    type: "tree",
    mode: "040000",
  };
  for (const interactive of [true, false]) {
    await test(`fresh install resolves and pins a baseline (interactive=${interactive})`, async (env) => {
      env.state.revisionEntries = [treeEntry];
      env.state.token = "fixture-token";
      const controller = new AbortController();
      const result = await env.runFresh({
        interactive,
        signal: controller.signal,
      });
      assert.equal(result.status, "ok");
      assert.deepEqual(
        env.readFreshMeta(result.installedPath).sourceRevision,
        revision,
      );
      assert.ok(env.requests[0].endsWith("/commits/main"));
      assert.ok(env.requests[1].includes("/git/trees/"));
      assert.ok(env.requests.slice(2).every((url) => url.includes(sha)));
      assert.ok(
        env.requestOptions.every(
          (options) => options.token === env.state.token,
        ),
      );
      assert.ok(
        env.requestOptions.every(
          (options) => options.retry.signal === controller.signal,
        ),
      );
      env.unchanged();
    });
  }
  for (const failure of [403, 404, 429, 500, "malformed", "network"]) {
    await test(`revision ${failure} preserves legacy install without a baseline`, async (env) => {
      env.state.fetchHook = (url) => {
        if (url.includes("/commits/")) {
          if (failure === "network") {
            throw new TypeError("fetch failed");
          }
          return env.response({}, typeof failure === "number" ? failure : 200);
        }
      };
      const result = await env.runFresh();
      assert.equal(result.status, "ok");
      assert.equal(
        env.readFreshMeta(result.installedPath).sourceRevision,
        undefined,
      );
      assert.ok(env.requests.some((url) => url.includes("?ref=main")));
      assert.ok(env.requests.every((url) => !url.includes(sha)));
      env.unchanged();
    });
  }
  for (const outcome of ["partial", "unsafe", "placeholder"]) {
    await test(`fresh pinned ${outcome} has no authoritative baseline`, async (env) => {
      env.state.revisionEntries = [treeEntry];
      env.state.fetchHook = (url) => {
        if (outcome === "partial" && url.endsWith("new.txt")) {
          return env.response("failed", 500);
        }
        if (outcome === "unsafe" && url.includes("/contents/")) {
          return env.response([
            {
              name: "SKILL.md",
              type: "file",
              download_url: "https://example.invalid/stale",
            },
            {
              name: "../unsafe",
              type: "file",
              download_url: "https://example.invalid/unsafe",
            },
          ]);
        }
        if (outcome === "placeholder" && url.endsWith("SKILL.md")) {
          return env.response("failed", 404);
        }
      };
      if (outcome === "placeholder") {
        await assert.rejects(env.runFresh());
      } else {
        const result = await env.runFresh();
        assert.equal(result.status, outcome === "partial" ? "partial" : "ok");
        if (outcome === "unsafe") {
          assert.ok(result.skippedUnsafeEntries.length > 0);
        }
      }
      assert.equal(env.readFreshMeta().sourceRevision, undefined);
      assert.ok(env.requests.slice(2).every((url) => url.includes(sha)));
      env.unchanged();
    });
  }
  await test("fresh single-file install pins a blob baseline", async (env) => {
    const remotePath = "demo.MD";
    env.state.revisionEntries = [
      { ...treeEntry, path: remotePath, type: "blob", mode: "100644" },
    ];
    env.state.fetchHook = (url) =>
      url.endsWith(`/${remotePath}`) ? env.response(content) : undefined;
    const result = await env.runFresh({}, { ...skill, path: remotePath });
    assert.equal(result.status, "ok");
    assert.deepEqual(env.readFreshMeta(result.installedPath).sourceRevision, {
      ...revision,
      remotePath,
      kind: "blob",
    });
    assert.equal(
      env.requests[2],
      `https://raw.githubusercontent.com/owner/repo/${sha}/${remotePath}`,
    );
  });
  await test("bulk callers can share one resolver snapshot without a global cache", async (env) => {
    const second = { ...skill, name: "second", path: "skills/second" };
    env.state.revisionEntries = [
      treeEntry,
      { ...treeEntry, path: second.path },
    ];
    const resolveSourceRevision = env.createRevisionResolver();
    const results = await Promise.all([
      env.runFresh({ resolveSourceRevision }),
      env.runFresh({ resolveSourceRevision }, second),
    ]);
    assert.equal(
      env.requests.filter((url) => url.includes("/commits/")).length,
      1,
    );
    assert.equal(
      env.requests.filter((url) => url.includes("/git/trees/")).length,
      1,
    );
    for (const result of results) {
      assert.equal(result.status, "ok");
      assert.equal(
        env.readFreshMeta(result.installedPath).sourceRevision.commitSha,
        sha,
      );
    }
    await env.runFresh({}, { ...skill, name: "third" });
    assert.equal(
      env.requests.filter((url) => url.includes("/commits/")).length,
      2,
    );
  });
  await test("explicit revision bypasses discovery and retains exact pinned requests", async (env) => {
    const result = await env.runFresh({
      downloadTarget,
      sourceRevision: revision,
      resolveSourceRevision: async () => {
        throw new Error("Must not resolve");
      },
    });
    assert.equal(result.status, "ok");
    assert.deepEqual(
      env.readFreshMeta(result.installedPath).sourceRevision,
      revision,
    );
    assert.ok(env.requests.every((url) => url.includes(sha)));
  });
  for (const options of [
    { sourceRevision: revision },
    { downloadTarget, sourceRevision: { ...revision, commitSha: "main" } },
    { downloadTarget, sourceRevision: { ...revision, owner: "other" } },
    {
      downloadTarget,
      sourceRevision: { ...revision, remotePath: "elsewhere" },
    },
    {
      downloadTarget,
      resolveSourceRevision: async () => ({ ...revision, owner: "other" }),
    },
  ]) {
    await test("invalid explicit or injected revision is refused before downloads", async (env) => {
      await assert.rejects(
        env.runFresh(options),
        /Invalid skill source revision/,
      );
      assert.equal(env.requests.length, 0);
      assert.equal(fs.existsSync(path.join(env.rootPath, "demo")), false);
      env.unchanged();
    });
  }
  await test("metadata scanner excludes staged and backup transaction directories", async (env) => {
    const staged = path.join(
      env.rootPath,
      ".skill-update-fixture",
      "download",
      "demo",
    );
    fs.mkdirSync(staged, { recursive: true });
    fs.writeFileSync(path.join(staged, "SKILL.md"), content);
    fs.writeFileSync(
      path.join(staged, ".skill-meta.json"),
      JSON.stringify({ ...env.meta, name: "staged" }),
    );
    const installed = await env.installer.getInstalledSkillsWithMeta(
      uri(env.rootPath),
    );
    assert.deepEqual(
      Array.from(installed, (meta) => meta.relativePath),
      [env.installedPath],
    );
  });
  await test("pinned recursive update replaces edits and deleted files, preserving nested path and flags", async (env) => {
    const result = await env.run();
    assert.equal(result.status, "ok");
    assert.equal(result.installedRoot, env.rootPath);
    assert.equal(result.installedPath, env.installedPath);
    assert.equal(
      fs.readFileSync(path.join(env.destination, "SKILL.md"), "utf8"),
      content,
    );
    assert.equal(
      fs.existsSync(path.join(env.destination, "removed.txt")),
      false,
    );
    assert.equal(
      fs.readFileSync(path.join(env.destination, "assets/nested.txt"), "utf8"),
      "upstream companion",
    );
    const saved = JSON.parse(
      fs.readFileSync(path.join(env.destination, ".skill-meta.json"), "utf8"),
    );
    assert.deepEqual(saved.sourceRevision, revision);
    assert.equal(saved.customWhenToUse, env.meta.customWhenToUse);
    assert.equal(saved.registrationDisabled, true);
    assert.equal(saved.relativePath, env.installedPath);
    assert.notEqual(saved.installedAt, env.meta.installedAt);
    assert.ok(env.requests.length >= 5);
    assert.ok(env.requests.every((url) => url.includes(sha)));
    env.clean();
  });
  for (const failure of [
    "partial",
    "network",
    "cancel",
    "placeholder",
    "unsafe",
  ]) {
    await test(`${failure} preserves original bytes and revision`, async (env) => {
      let cancelled = false;
      env.state.fetchHook = (url) => {
        if (failure === "network") {
          throw new TypeError("fetch failed");
        }
        if (failure === "partial" && url.endsWith("new.txt")) {
          return env.response("failed", 500);
        }
        if (failure === "cancel" && url.endsWith("SKILL.md")) {
          cancelled = true;
        }
        if (failure === "placeholder" && url.endsWith("SKILL.md")) {
          return env.response("failed", 404);
        }
        if (failure === "unsafe" && url.includes("api.github.com")) {
          return env.response([
            {
              name: "../evil",
              type: "file",
              download_url: "https://example.invalid",
            },
          ]);
        }
      };
      await assert.rejects(env.run({ isCancelled: () => cancelled }));
      env.unchanged();
      env.clean();
    });
  }
  await test("pre-aborted signal performs no downloads or modification", async (env) => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(env.run({ signal: controller.signal }), {
      name: "AbortError",
    });
    assert.equal(env.requests.length, 0);
    env.unchanged();
    env.clean();
  });
  for (const filePath of ["demo.md", "demo.MD"]) {
    await test(`single file ${filePath} update pins SHA and keeps installed location`, async (env) => {
      env.state.fetchHook = () => env.response(content);
      const fileRevision = { ...revision, remotePath: filePath, kind: "blob" };
      const fileMeta = {
        ...env.meta,
        remotePath: filePath,
        sourceRevision: {
          ...env.meta.sourceRevision,
          remotePath: filePath,
          kind: "blob",
        },
      };
      fs.writeFileSync(
        path.join(env.destination, ".skill-meta.json"),
        JSON.stringify(fileMeta),
      );
      const result = await env.installer.installSkillUpdate(
        { ...skill, path: filePath },
        uri(env.rootPath),
        {},
        env.root,
        fileMeta,
        fileRevision,
      );
      assert.equal(result.status, "ok");
      assert.equal(result.installedPath, env.installedPath);
      assert.deepEqual(env.requests, [
        `https://raw.githubusercontent.com/owner/repo/${sha}/${filePath}`,
      ]);
      env.clean();
    });
  }
  await test("legacy metadata gains a revision only after successful sync", async (env) => {
    delete env.meta.sourceRevision;
    fs.writeFileSync(
      path.join(env.destination, ".skill-meta.json"),
      JSON.stringify(env.meta),
    );
    assert.equal((await env.run()).status, "ok");
    const saved = JSON.parse(
      fs.readFileSync(path.join(env.destination, ".skill-meta.json"), "utf8"),
    );
    assert.deepEqual(saved.sourceRevision, revision);
    assert.equal(saved.customWhenToUse, env.meta.customWhenToUse);
    assert.equal(saved.registrationDisabled, true);
    env.clean();
  });
  await test("custom settings changed during download are preserved", async (env) => {
    env.state.fetchHook = () => {
      fs.writeFileSync(
        path.join(env.destination, ".skill-meta.json"),
        JSON.stringify({
          ...env.meta,
          customWhenToUse: "changed during download",
          registrationDisabled: false,
        }),
      );
    };
    assert.equal((await env.run()).status, "ok");
    const saved = JSON.parse(
      fs.readFileSync(path.join(env.destination, ".skill-meta.json"), "utf8"),
    );
    assert.equal(saved.customWhenToUse, "changed during download");
    assert.equal(saved.registrationDisabled, false);
    env.clean();
  });
  await test("changed on-disk owner during download is not overwritten", async (env) => {
    const changed = JSON.stringify({ ...env.meta, source: "new-owner" });
    env.state.fetchHook = () => {
      fs.writeFileSync(path.join(env.destination, ".skill-meta.json"), changed);
    };
    await assert.rejects(env.run(), /ownership changed/);
    assert.equal(
      fs.readFileSync(path.join(env.destination, ".skill-meta.json"), "utf8"),
      changed,
    );
    assert.equal(
      fs.readFileSync(path.join(env.destination, "SKILL.md"), "utf8"),
      "locally edited original",
    );
    env.clean();
  });
  await test("cancellation after backup rename restores original", async (env) => {
    const controller = new AbortController();
    env.state.renameHook = (from) => {
      if (from.fsPath === env.destination) {
        controller.abort();
      }
    };
    await assert.rejects(
      env.run({ signal: controller.signal }),
      /original was restored/,
    );
    env.unchanged();
    env.clean();
  });
  await test("partial staged install does not persist successful revision", async (env) => {
    env.state.fetchHook = (url) =>
      url.endsWith("new.txt") ? env.response("failure", 500) : undefined;
    const stagePath = path.join(env.temporary, "direct-stage");
    fs.mkdirSync(stagePath);
    const result = await env.installer.installSkill(
      skill,
      uri(stagePath),
      {},
      {
        ...env.root,
        rootUri: uri(stagePath),
        rootPath: stagePath,
      },
      {
        interactive: false,
        allowRetry: false,
        downloadTarget: {
          owner: revision.owner,
          repo: revision.repo,
          remotePath: revision.remotePath,
          branch: "main",
        },
        sourceRevision: revision,
      },
    );
    assert.equal(result.status, "partial");
    const saved = JSON.parse(
      fs.readFileSync(path.join(stagePath, "demo/.skill-meta.json"), "utf8"),
    );
    assert.equal(saved.sourceRevision, undefined);
    assert.ok(env.requests.every((url) => url.includes(sha)));
    env.unchanged();
    env.clean();
  });
  await test("failed switch restores original and removes stage", async (env) => {
    env.state.renameHook = (from) => {
      if (from.fsPath.includes(`${path.sep}stage${path.sep}`)) {
        throw new Error("switch failed");
      }
    };
    await assert.rejects(env.run(), /original was restored/);
    env.unchanged();
    env.clean();
  });
  await test("failed backup rename leaves original intact", async (env) => {
    env.state.renameHook = () => {
      throw new Error("rename failed");
    };
    await assert.rejects(env.run());
    env.unchanged();
    env.clean();
  });
  await test("failed rollback retains the only original backup", async (env) => {
    env.state.renameHook = (from) => {
      if (from.fsPath !== env.destination) {
        throw new Error("rename failed");
      }
    };
    await assert.rejects(env.run(), /recovery required/);
    const transaction = fs
      .readdirSync(env.rootPath)
      .find((name) => name.startsWith(".skill-update-"));
    assert.ok(transaction);
    assert.equal(
      fs.readFileSync(
        path.join(env.rootPath, transaction, "backup/SKILL.md"),
        "utf8",
      ),
      "locally edited original",
    );
    assert.equal(
      JSON.parse(
        fs.readFileSync(
          path.join(env.rootPath, transaction, "backup/.skill-meta.json"),
        ),
      ).sourceRevision.commitSha,
      "c".repeat(40),
    );
  });
  await test("cleanup failure after swap remains successful", async (env) => {
    env.state.deleteHook = () => {
      throw new Error("cleanup failed");
    };
    assert.equal((await env.run()).status, "ok");
    assert.equal(
      fs.readFileSync(path.join(env.destination, "SKILL.md"), "utf8"),
      content,
    );
  });
  await test("concurrent destination and overlapping parent are locked", async (env) => {
    let release;
    let entered;
    const waiting = new Promise((resolve) => {
      entered = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    env.state.fetchHook = async () => {
      entered();
      await gate;
    };
    const pending = env.run();
    await waiting;
    try {
      await assert.rejects(env.run(), /already running/);
      await assert.rejects(
        env.installer.installSkillUpdate(
          skill,
          uri(env.rootPath),
          {},
          env.root,
          { ...env.meta, relativePath: "group" },
          revision,
        ),
        /already running/,
      );
    } finally {
      release();
    }
    await pending;
    env.clean();
  });
  for (const boundary of [
    "readOnly",
    "unmanaged",
    "traversal",
    "absolute",
    "owner",
    "remote",
    "parent",
    "child",
    "symlink",
  ]) {
    await test(`${boundary} boundary refuses mutation`, async (env) => {
      if (boundary === "readOnly") {
        env.root.isReadOnly = true;
      }
      if (boundary === "unmanaged") {
        env.root.isManaged = false;
      }
      if (boundary === "traversal") {
        env.meta.relativePath = "../outside";
      }
      if (boundary === "absolute") {
        env.meta.relativePath = "/group/original-name";
      }
      if (boundary === "owner") {
        env.meta.source = "someone-else";
      }
      if (boundary === "remote") {
        env.meta.remotePath = "another/skill";
      }
      if (boundary === "parent") {
        fs.writeFileSync(
          path.join(env.rootPath, "group/SKILL.md"),
          "parent skill",
        );
      }
      if (boundary === "child") {
        fs.mkdirSync(path.join(env.destination, "child"));
        fs.writeFileSync(
          path.join(env.destination, "child/SKILL.md"),
          "child skill",
        );
      }
      if (boundary === "symlink") {
        const outside = path.join(env.temporary, "outside");
        fs.mkdirSync(outside);
        fs.symlinkSync(outside, path.join(env.rootPath, "escape"), "junction");
        env.meta.relativePath = "escape";
      }
      await assert.rejects(env.run());
      assert.equal(env.requests.length, 0);
      if (boundary === "child") {
        fs.rmSync(path.join(env.destination, "child"), { recursive: true });
      }
      env.unchanged();
      env.clean();
    });
  }
  console.log(`PASS ${passed} skill update transaction tests`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
