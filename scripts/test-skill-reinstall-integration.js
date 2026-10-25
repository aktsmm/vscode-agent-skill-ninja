#!/usr/bin/env node

// skillReinstall.ts（ルート列挙・計画作成・実行・実行後検証）の結合テスト。
//
// 実ファイルシステム上の複数ルートに同名スキルを置き、取り違えないこと、
// メタなしは明示的な採用までは触らないこと、実行後の読み戻しで成功を判定することを確認する。
// ネットワークと VS Code は差し替え、正規のインストール処理（installSkillUpdate）は
// 成功・不整合・例外を返すスタブにする（その本体は test-skill-reinstall-rebind.js で検証）。

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { createHash } = require("node:crypto");

// vm 内で作られた値は prototype が違うので、構造だけを比べる
const same = (actual, expected) =>
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected);

const srcDir = path.join(__dirname, "../src");
const uri = (fsPath) => ({
  scheme: "file",
  fsPath: path.resolve(fsPath),
  path: path.resolve(fsPath).replace(/\\/g, "/"),
});
const blobSha = (text) =>
  createHash("sha1")
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest("hex");
const hex = (char) => char.repeat(40);

const REMOTE = {
  "mine::skills/demo": { "SKILL.md": "public demo\n" },
  "mine-private::.github/skills/demo": { "SKILL.md": "private demo\n" },
  "vendor::skills/other": { "SKILL.md": "vendor other\n" },
};
const COMMIT = { mine: hex("1"), "mine-private": hex("2"), vendor: hex("3") };

const INDEX = {
  sources: [
    { id: "mine", url: "https://github.com/owner/mine" },
    { id: "mine-private", url: "https://github.com/owner/mine-private" },
    { id: "vendor", url: "https://github.com/owner/vendor" },
  ],
  skills: [
    { name: "demo", source: "mine", path: "skills/demo", categories: [], description: "" },
    {
      name: "demo",
      source: "mine-private",
      path: ".github/skills/demo",
      categories: [],
      description: "",
    },
    { name: "other", source: "vendor", path: "skills/other", categories: [], description: "" },
  ],
};

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function setup(installBehavior = "ok") {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ninja-reinstall-"));
  const fakeHome = path.join(temporary, "home");
  const workspace = path.join(temporary, "repo");
  const roots = {
    workspace: path.join(workspace, ".github", "skills"),
    copilot: path.join(fakeHome, ".copilot", "skills"),
    codex: path.join(fakeHome, ".codex", "skills"),
  };

  const recorded = {
    owner: "owner",
    repo: "mine",
    ref: "main",
    remotePath: "skills/demo",
    commitSha: hex("d"),
    contentSha: hex("e"),
    kind: "tree",
  };
  // ワークスペース: 記録済み（public "mine" 由来）。内容はインストール時のまま
  write(path.join(roots.workspace, "demo", "SKILL.md"), "installed public\n");
  write(
    path.join(roots.workspace, "demo", ".skill-meta.json"),
    JSON.stringify({
      name: "demo",
      source: "mine",
      remotePath: "skills/demo",
      installedAt: "2026-01-01T00:00:00.000Z",
      sourceRevision: recorded,
    }),
  );
  // Copilot Home: メタなし。private 版と内容が同じ
  write(path.join(roots.copilot, "demo", "SKILL.md"), "private demo\n");
  // Codex Home: メタなし。どの候補とも内容が違う。他社 source 由来のスキルも置く
  write(path.join(roots.codex, "demo", "SKILL.md"), "codex flavoured demo\n");
  write(path.join(roots.codex, "other", "SKILL.md"), "vendor other\n");
  write(
    path.join(roots.codex, "other", ".skill-meta.json"),
    JSON.stringify({
      name: "other",
      source: "vendor",
      remotePath: "skills/other",
      installedAt: "2026-01-01T00:00:00.000Z",
    }),
  );

  const log = { install: [], refresh: 0 };
  const baselineBySha = { [hex("d")]: { "SKILL.md": "installed public\n" } };

  const skillRoot = (rootPath, scope, displayPath, instruction) => ({
    scope,
    label: "root",
    rootUri: uri(rootPath),
    rootPath,
    displayPath,
    isManaged: true,
    isReadOnly: false,
    ...(instruction
      ? { instructionPath: instruction, instructionUri: uri(instruction) }
      : {}),
  });
  const managedRoots = [
    skillRoot(roots.workspace, "workspace", ".github/skills"),
    skillRoot(roots.copilot, "userGlobal", "~/.copilot/skills", path.join(fakeHome, ".copilot", "copilot-instructions.md")),
    skillRoot(roots.codex, "userGlobal", "~/.codex/skills"),
  ];

  const stubs = {
    vscode: {
      Uri: { file: uri, joinPath: (base, ...p) => uri(path.join(base.fsPath, ...p)) },
      workspace: { getWorkspaceFolder: () => undefined },
    },
    os: { ...os, homedir: () => fakeHome },
    "./githubAuth": { getGitHubToken: async () => undefined },
    "./skillLocations": { getManagedSkillRoots: async () => managedRoots },
    "./skillInstaller": {
      resolveSkillFolderName: (skill) => skill.name,
      resolveManagedSkillDirUri: (rootUri, relative) =>
        uri(path.join(rootUri.fsPath, relative)),
      resolveSkillDownloadTarget: async (skill) => ({
        owner: "owner",
        repo: skill.source,
        branch: "main",
        remotePath: skill.path,
      }),
      getInstalledSkillsWithMeta: async (_scope, rootUri) => {
        const metas = [];
        const walk = (dirPath, prefix, depth) => {
          if (depth > 3) return;
          for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
            const dir = path.join(dirPath, entry.name);
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (fs.existsSync(path.join(dir, "SKILL.md"))) {
              const metaFile = path.join(dir, ".skill-meta.json");
              const base = fs.existsSync(metaFile)
                ? JSON.parse(fs.readFileSync(metaFile, "utf8"))
                : { name: entry.name, source: "local", installedAt: "" };
              metas.push({ description: "", categories: [], ...base, relativePath: relative });
            }
            walk(dir, relative, depth + 1);
          }
        };
        walk(rootUri.fsPath, "", 0);
        return metas;
      },
      installSkillUpdate: async (skill, _ws, _ctx, root, meta, revision, options) => {
        log.install.push({
          skill: skill.name,
          source: skill.source,
          root: root.rootPath,
          rebind: options?.rebind === true,
        });
        if (installBehavior === "throw" && root.rootPath === roots.codex) {
          throw new Error("simulated install failure");
        }
        // 実装と同じく、取得をステージングへ書いてから、入れ替える直前に確認する
        if (installBehavior === "edit-during-download") {
          fs.appendFileSync(
            path.join(root.rootPath, meta.relativePath, "SKILL.md"),
            "edited while downloading\n",
          );
        }
        const dir = path.join(root.rootPath, meta.relativePath);
        const files = REMOTE[`${skill.source}::${skill.path}`];
        const staged = path.join(root.rootPath, ".skill-update-stage", meta.relativePath);
        fs.rmSync(staged, { recursive: true, force: true });
        for (const [name, text] of Object.entries(files)) {
          write(
            path.join(staged, name),
            installBehavior === "corrupt-download" ? `${text}\u0000corrupted` : text,
          );
        }
        try {
          await options?.beforeSwap?.(uri(staged));
        } finally {
          fs.rmSync(path.join(root.rootPath, ".skill-update-stage"), {
            recursive: true,
            force: true,
          });
        }
        fs.rmSync(dir, { recursive: true, force: true });
        for (const [name, text] of Object.entries(files)) write(path.join(dir, name), text);
        write(
          path.join(dir, ".skill-meta.json"),
          JSON.stringify({
            name: skill.name,
            source: skill.source,
            remotePath: skill.path,
            installedAt: "now",
            relativePath: meta.relativePath,
            sourceRevision:
              installBehavior === "wrong-revision"
                ? { ...revision, commitSha: hex("9") }
                : revision,
          }),
        );
        return { status: "ok", installedPath: meta.relativePath, errors: [], failures: [] };
      },
    },
    "./skillUpdates": {
      createSkillRevisionResolver: () => async (target) => {
        const files = REMOTE[`${target.repo}::${target.remotePath}`];
        if (!files) {
          const error = new Error("Skill source path no longer exists.");
          error.name = "SkillSourcePathMissingError";
          throw error;
        }
        return {
          owner: target.owner,
          repo: target.repo,
          ref: target.branch,
          remotePath: target.remotePath,
          commitSha: COMMIT[target.repo],
          contentSha: hex("f"),
          kind: "tree",
        };
      },
      readSkillRemoteFiles: async (revision) => {
        // ステージング内容の照合中（取得元の読み出し中）にユーザーが編集した状況を再現する
        if (log.armEditDuringVerify) {
          log.armEditDuringVerify = false;
          fs.appendFileSync(
            path.join(roots.workspace, "demo", "SKILL.md"),
            "edited during verification\n",
          );
        }
        const files =
          baselineBySha[revision.commitSha] ??
          REMOTE[`${revision.repo}::${revision.remotePath}`];
        return {
          files: new Map(Object.entries(files).map(([n, t]) => [n, blobSha(t)])),
          truncated: false,
        };
      },
    },
  };

  const cache = new Map();
  const load = (name) => {
    if (cache.has(name)) return cache.get(name).exports;
    const file = path.join(srcDir, `${name}.ts`);
    const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: file,
    }).outputText;
    const module = { exports: {} };
    cache.set(name, module);
    const requireStub = (request) => {
      if (request in stubs) return stubs[request];
      if (request.startsWith("./")) return load(request.slice(2));
      return require(request);
    };
    vm.runInNewContext(
      output,
      { module, exports: module.exports, require: requireStub, Buffer, process, URL, console },
      { filename: file },
    );
    return module.exports;
  };

  return {
    roots,
    log,
    reinstall: load("skillReinstall"),
    dispose: () => fs.rmSync(temporary, { recursive: true, force: true }),
  };
}

let passed = 0;
async function test(name, behavior, callback) {
  const env = setup(behavior);
  try {
    await callback(env);
    passed += 1;
    console.log(`PASS ${name}`);
  } finally {
    env.dispose();
  }
}

const options = { workspaceUri: undefined, index: INDEX, japanese: false };
const statusOf = (plan) =>
  Object.fromEntries(plan.items.map((item) => [item.entryId, item.status + (item.reason ? `:${item.reason}` : "")]));

async function main() {
  await test("rootIds separate Copilot Home, Codex Home and the workspace, even for the same skill name", "ok", async ({ reinstall }) => {
    const roots = await reinstall.listManagedRoots(undefined, false);
    same(
      roots.map((entry) => entry.rootId),
      ["workspace:.github/skills", "home-copilot", "home-codex"],
    );
    assert.match(
      roots.find((entry) => entry.rootId === "home-codex").label,
      /^Codex Home \(~\/\.codex\/skills\) \[home-codex\]$/,
    );
    const { entries } = await reinstall.collectInstalledEntries(undefined, false);
    const demos = entries.filter((entry) => entry.plan.name === "demo");
    same(
      demos.map((entry) => entry.plan.entryId).sort(),
      ["home-codex::demo", "home-copilot::demo", "workspace:.github/skills::demo"],
    );
  });

  await test("a root-and-source selection only touches those roots and never offers another source", "ok", async ({ reinstall }) => {
    const created = await reinstall.createReinstallPlan(
      {
        mode: "preview",
        targets: { rootIds: ["home-copilot", "home-codex"], sources: ["mine-private", "mine"] },
      },
      options,
    );
    assert.ok(!("error" in created), created.error);
    // vendor 由来の other は source で除外され、ワークスペースの demo は root で除外される
    same(statusOf(created.plan), {
      "home-copilot::demo": "hold:no-provenance",
      "home-codex::demo": "hold:no-provenance",
    });
    const copilot = created.plan.items.find((i) => i.entryId === "home-copilot::demo");
    same(
      copilot.candidates.map((c) => [c.candidate.candidateId, c.diff.identical]),
      [
        ["mine::skills/demo", false],
        ["mine-private::.github/skills/demo", true],
      ],
    );
    const codex = created.plan.items.find((i) => i.entryId === "home-codex::demo");
    assert.ok(codex.candidates.every((c) => c.diff.identical === false));
  });

  await test("an entryId pins exactly one copy and unknown ids are reported, not guessed", "ok", async ({ reinstall }) => {
    const created = await reinstall.createReinstallPlan(
      {
        mode: "preview",
        targets: { entryIds: ["workspace:.github/skills::demo", "home-codex::missing"], rootIds: ["ghost"] },
      },
      options,
    );
    same(statusOf(created.plan), {
      "workspace:.github/skills::demo": "ready",
      "home-codex::missing": "skipped:not-found",
      "root:ghost": "skipped:not-found",
    });
    const ready = created.plan.items[0];
    assert.equal(ready.action, "reinstall");
    assert.equal(ready.baseline, "recorded");
    assert.equal(ready.candidate.candidateId, "mine::skills/demo");
  });

  await test("targets must be explicit; flags must refer to selected entries", "ok", async ({ reinstall }) => {
    assert.match(
      (await reinstall.createReinstallPlan({ mode: "preview", targets: {} }, options)).error,
      /entryIds or rootIds/,
    );
    const outside = await reinstall.createReinstallPlan(
      {
        mode: "preview",
        targets: { rootIds: ["home-copilot"] },
        adopt: [{ entryId: "home-codex::demo", candidateId: "mine::skills/demo" }],
      },
      options,
    );
    assert.match(outside.error, /not part of the selected targets: home-codex::demo/);
  });

  await test("apply adopts the approved candidate through the regular update path and verifies the result", "ok", async ({ reinstall, roots, log }) => {
    const input = {
      mode: "apply",
      targets: { rootIds: ["home-copilot", "home-codex"], sources: ["mine-private"] },
      adopt: [
        { entryId: "home-copilot::demo", candidateId: "mine-private::.github/skills/demo" },
      ],
    };
    const created = await reinstall.createReinstallPlan(input, options);
    same(statusOf(created.plan), {
      "home-copilot::demo": "ready",
      "home-codex::demo": "hold:no-provenance",
    });

    const codexBefore = fs.readFileSync(path.join(roots.codex, "demo", "SKILL.md"), "utf8");
    const results = await reinstall.applyReinstallPlan(created, {}, undefined);
    same(
      results.map((r) => [r.entryId, r.status]),
      [
        ["home-copilot::demo", "updated"],
        ["home-codex::demo", "held"],
      ],
    );
    const updated = results[0];
    assert.equal(updated.installedPath, path.join(roots.copilot, "demo"));
    assert.equal(updated.source, "mine-private");
    same(updated.recorded, {
      commitSha: COMMIT["mine-private"],
      contentSha: hex("f"),
      ref: "main",
    });
    same(updated.verification, {
      metaRecorded: true,
      revisionMatches: true,
      skillMdPresent: true,
      contentMatchesRemote: true,
    });

    // 正規の更新処理を 1 回だけ、初回関連付け（rebind）として呼ぶ
    same(log.install, [
      { skill: "demo", source: "mine-private", root: roots.copilot, rebind: true },
    ]);
    // 保留の項目と対象外のルートには触れない
    assert.equal(fs.readFileSync(path.join(roots.codex, "demo", "SKILL.md"), "utf8"), codexBefore);
    assert.equal(fs.existsSync(path.join(roots.codex, "demo", ".skill-meta.json")), false);
    assert.equal(fs.readFileSync(path.join(roots.workspace, "demo", "SKILL.md"), "utf8"), "installed public\n");
  });

  await test("a recorded skill is reinstalled without rebind and kept on its own source", "ok", async ({ reinstall, log }) => {
    const created = await reinstall.createReinstallPlan(
      { mode: "apply", targets: { entryIds: ["workspace:.github/skills::demo"] } },
      options,
    );
    const [result] = await reinstall.applyReinstallPlan(created, {}, undefined);
    assert.equal(result.status, "updated");
    assert.equal(result.source, "mine");
    assert.equal(log.install[0].rebind, false);
  });

  await test("a result whose recorded revision does not match is reported as failed, not as up to date", "wrong-revision", async ({ reinstall }) => {
    const created = await reinstall.createReinstallPlan(
      { mode: "apply", targets: { entryIds: ["workspace:.github/skills::demo"] } },
      options,
    );
    const [result] = await reinstall.applyReinstallPlan(created, {}, undefined);
    assert.equal(result.status, "failed");
    assert.equal(result.verification.revisionMatches, false);
    assert.match(result.message, /verification failed/);
  });

  await test("one failure does not stop an independent item, and the failure is reported per item", "throw", async ({ reinstall, roots }) => {
    const input = {
      mode: "apply",
      targets: { rootIds: ["home-copilot", "home-codex"], sources: ["mine-private"] },
      adopt: [
        { entryId: "home-codex::demo", candidateId: "mine-private::.github/skills/demo" },
        { entryId: "home-copilot::demo", candidateId: "mine-private::.github/skills/demo" },
      ],
      allowLocalEdits: ["home-codex::demo"],
    };
    const created = await reinstall.createReinstallPlan(input, options);
    same(statusOf(created.plan), {
      "home-copilot::demo": "ready",
      "home-codex::demo": "ready",
    });
    const results = await reinstall.applyReinstallPlan(created, {}, undefined);
    same(
      Object.fromEntries(results.map((r) => [r.entryId, r.status])),
      { "home-copilot::demo": "updated", "home-codex::demo": "failed" },
    );
    assert.match(results.find((r) => r.status === "failed").message, /simulated install failure/);
    assert.equal(
      fs.readFileSync(path.join(roots.codex, "demo", "SKILL.md"), "utf8"),
      "codex flavoured demo\n",
    );
  });

  await test("the plan id changes when the installed content changes after the preview", "ok", async ({ reinstall, roots }) => {
    const input = {
      mode: "preview",
      targets: { entryIds: ["workspace:.github/skills::demo"] },
    };
    const before = await reinstall.createReinstallPlan(input, options);
    const again = await reinstall.createReinstallPlan(input, options);
    assert.equal(before.plan.planId, again.plan.planId);
    fs.appendFileSync(path.join(roots.workspace, "demo", "SKILL.md"), "edited after preview\n");
    const after = await reinstall.createReinstallPlan(input, options);
    assert.notEqual(before.plan.planId, after.plan.planId);
    assert.equal(statusOf(after.plan)["workspace:.github/skills::demo"], "hold:local-edits");
  });

  await test("content edited while the source is downloading aborts the swap and keeps the edit", "edit-during-download", async ({ reinstall, roots }) => {
    const created = await reinstall.createReinstallPlan(
      { mode: "apply", targets: { entryIds: ["workspace:.github/skills::demo"] } },
      options,
    );
    assert.equal(statusOf(created.plan)["workspace:.github/skills::demo"], "ready");
    const [result] = await reinstall.applyReinstallPlan(created, {}, undefined);
    assert.equal(result.status, "failed");
    assert.match(result.message, /changed after the preview/);
    assert.equal(
      fs.readFileSync(path.join(roots.workspace, "demo", "SKILL.md"), "utf8"),
      "installed public\nedited while downloading\n",
    );
  });

  await test("an edit made while the staged content is being verified still aborts the swap", "ok", async ({ reinstall, roots, log }) => {
    const created = await reinstall.createReinstallPlan(
      { mode: "apply", targets: { entryIds: ["workspace:.github/skills::demo"] } },
      options,
    );
    assert.equal(statusOf(created.plan)["workspace:.github/skills::demo"], "ready");
    log.armEditDuringVerify = true;
    const [result] = await reinstall.applyReinstallPlan(created, {}, undefined);
    assert.equal(result.status, "failed");
    assert.match(result.message, /changed after the preview/);
    assert.equal(
      fs.readFileSync(path.join(roots.workspace, "demo", "SKILL.md"), "utf8"),
      "installed public\nedited during verification\n",
    );
  });

  await test("a corrupted download is caught before the swap and the installed copy is untouched", "corrupt-download", async ({ reinstall, roots }) => {
    const created = await reinstall.createReinstallPlan(
      { mode: "apply", targets: { entryIds: ["workspace:.github/skills::demo"] } },
      options,
    );
    assert.equal(statusOf(created.plan)["workspace:.github/skills::demo"], "ready");
    const [result] = await reinstall.applyReinstallPlan(created, {}, undefined);
    assert.equal(result.status, "failed");
    assert.match(result.message, /does not match the source revision/);
    assert.match(result.message, /SKILL\.md \(differs; local [0-9a-f]{7}, \d+ B, binary; source [0-9a-f]{7}\)/);
    assert.match(result.message, /nothing was replaced/);
    assert.equal(
      fs.readFileSync(path.join(roots.workspace, "demo", "SKILL.md"), "utf8"),
      "installed public\n",
    );
  });

  await test("an existing skill folder is detected so a new install never overlays it", "ok", async ({ reinstall, roots }) => {
    const all = await reinstall.listManagedRoots(undefined, false);
    const copilot = all.find((entry) => entry.rootId === "home-copilot").root;
    assert.equal(
      reinstall.findExistingSkillFolder(copilot, { name: "demo", source: "mine", path: "skills/demo" }),
      path.join(roots.copilot, "demo"),
    );
    assert.equal(
      reinstall.findExistingSkillFolder(copilot, { name: "fresh", source: "mine", path: "skills/fresh" }),
      undefined,
    );
  });

  await test("skills synced by an app are never reinstalled, even when selected by entryId or adopt", "ok", async ({ reinstall, roots, log }) => {
    const syncedDir = path.join(roots.codex, "synced", "bucket-1");
    write(path.join(syncedDir, "manifest.json"), JSON.stringify({ skills: [] }));
    write(path.join(syncedDir, "docs", "SKILL.md"), "synced docs\n");
    // 近い名前でも manifest の無い synced フォルダは、通常のスキルとして扱う
    write(path.join(roots.codex, "synced", "plain", "demo", "SKILL.md"), "not app managed\n");

    const { entries } = await reinstall.collectInstalledEntries(undefined, false);
    const flags = Object.fromEntries(
      entries
        .filter((entry) => entry.plan.relativePath.startsWith("synced/"))
        .map((entry) => [entry.plan.relativePath, entry.plan.appManaged]),
    );
    same(flags, { "synced/bucket-1/docs": true, "synced/plain/demo": false });

    const created = await reinstall.createReinstallPlan(
      {
        mode: "apply",
        targets: { entryIds: ["home-codex::synced/bucket-1/docs"] },
        adopt: [
          { entryId: "home-codex::synced/bucket-1/docs", candidateId: "mine::skills/demo" },
        ],
      },
      options,
    );
    same(statusOf(created.plan), {
      "home-codex::synced/bucket-1/docs": "skipped:app-managed",
    });
    const [result] = await reinstall.applyReinstallPlan(created, {}, undefined);
    assert.equal(result.status, "skipped");
    same(log.install, []);
    assert.equal(fs.readFileSync(path.join(syncedDir, "docs", "SKILL.md"), "utf8"), "synced docs\n");
  });

  await test("a second apply cannot overlap a running one", "ok", async ({ reinstall }) => {
    const created = await reinstall.createReinstallPlan(
      { mode: "apply", targets: { entryIds: ["workspace:.github/skills::demo"] } },
      options,
    );
    const first = reinstall.applyReinstallPlan(created, {}, undefined);
    await assert.rejects(
      reinstall.applyReinstallPlan(created, {}, undefined),
      /already running/,
    );
    await first;
  });

  console.log(`\nSkill reinstall integration tests passed (${passed}).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
