#!/usr/bin/env node

// 共有ストア（%APPDATA%/agent-ninja）を untrusted input として扱えているかを検証する。

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ts = require("typescript");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-ninja-shared-"));
process.env.APPDATA = tempRoot;
process.env.HOME = tempRoot;
process.env.USERPROFILE = tempRoot;

// 共有ストア層は vscode に依存しないので、実装をそのまま読み込んで検証する
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

const srcDir = path.join(__dirname, "..", "src");

const {
  applySharedSourcesManifestToSkillIndex,
  bootstrapSharedSourcesManifest,
  getLastRejectedSharedSources,
  readSharedSourcesManifest,
  readSharedSourcesManifestResult,
  sanitizeSourceEntry,
  syncSharedSourcesManifestFromSources,
  updateSharedSourcesManifest,
  writeSharedSourcesManifest,
} = require(path.join(srcDir, "shared-sources-manifest-store.ts"));
const { withSharedStoreLock } = require(
  path.join(srcDir, "shared-store-lock.ts"),
);
const {
  getAgentNinjaSharedDirectoryPath,
  getSharedSourcesManifestPath,
  SHARED_SOURCES_MANIFEST_MAX_BYTES,
  SHARED_SOURCES_MANIFEST_MAX_ENTRIES,
} = require(path.join(srcDir, "shared-manifest.ts"));

const sharedDir = getAgentNinjaSharedDirectoryPath();
const manifestPath = getSharedSourcesManifestPath();
const lockPath = path.join(sharedDir, "index.lock");

let failures = 0;

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

async function writeRawManifest(value) {
  await fs.promises.mkdir(sharedDir, { recursive: true });
  await fs.promises.writeFile(
    manifestPath,
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
    "utf8",
  );
}

async function cleanSharedDir() {
  await fs.promises.rm(sharedDir, { recursive: true, force: true });
  await fs.promises.mkdir(sharedDir, { recursive: true });
}

async function run() {
  await test("oversized manifests are rejected without parsing", async () => {
    await cleanSharedDir();
    const filler = "x".repeat(SHARED_SOURCES_MANIFEST_MAX_BYTES + 1024);
    await writeRawManifest({
      schemaVersion: 1,
      lastUpdated: new Date().toISOString(),
      updatedBy: "other.extension",
      sources: [validEntry({ description: filler })],
    });

    assert.strictEqual(await readSharedSourcesManifest(), undefined);
    // 上限超過は切り詰めず拒否するので、退避もしない
    assert.ok(fs.existsSync(manifestPath));
  });

  await test("entry count over the cap rejects the whole manifest", async () => {
    await cleanSharedDir();
    await writeRawManifest({
      schemaVersion: 1,
      lastUpdated: new Date().toISOString(),
      updatedBy: "other.extension",
      sources: Array.from(
        { length: SHARED_SOURCES_MANIFEST_MAX_ENTRIES + 1 },
        (_, index) => validEntry({ id: `alpha-${index}` }),
      ),
    });

    assert.strictEqual(await readSharedSourcesManifest(), undefined);
  });

  await test("unsafe entries are dropped without dropping the manifest", async () => {
    await cleanSharedDir();
    await writeRawManifest({
      schemaVersion: 1,
      lastUpdated: new Date().toISOString(),
      updatedBy: "other.extension",
      sources: [
        validEntry(),
        validEntry({ id: "evil-url", url: "https://evil.example.com/a/b" }),
        validEntry({ id: "evil-scheme", url: "http://github.com/a/b" }),
        validEntry({ id: "bad id with space" }),
        validEntry({
          id: "escape-path",
          includePaths: ["../../../etc"],
        }),
        validEntry({
          id: "absolute-path",
          excludePaths: ["/etc/passwd"],
        }),
        validEntry({ id: "alpha" }),
      ],
    });

    const manifest = await readSharedSourcesManifest();
    assert.ok(manifest);
    assert.deepStrictEqual(
      Array.from(manifest.sources.map((source) => source.id)),
      ["alpha"],
    );
  });

  await test("dropped entries are reported so they do not vanish silently", async () => {
    await cleanSharedDir();
    await writeRawManifest({
      schemaVersion: 1,
      lastUpdated: new Date().toISOString(),
      updatedBy: "other.extension",
      sources: [
        validEntry(),
        validEntry({ id: "evil-url", url: "https://evil.example.com/a/b" }),
        validEntry({ id: "bad id with space" }),
      ],
    });

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      await readSharedSourcesManifest();
    } finally {
      console.warn = originalWarn;
    }

    const report = warnings.find((line) =>
      line.includes("invalid shared source"),
    );
    assert.ok(report, "rejected entries must be reported");
    assert.ok(report.includes("evil-url"));
    // 安全な書式でない id はそのまま出さず、位置だけ示す
    assert.ok(!report.includes("bad id with space"));
    assert.ok(report.includes("#2"));

    // console を開かないユーザー向けに、診断コマンドから読める形でも残す
    assert.deepStrictEqual(Array.from(getLastRejectedSharedSources()), [
      "evil-url (#1)",
      "#2",
    ]);
  });

  await test("a source we cannot write to the shared store is reported", async () => {
    await cleanSharedDir();

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      await writeSharedSourcesManifest({
        schemaVersion: 1,
        sources: [validEntry(), validEntry({ id: "beta", name: "" })],
        lastUpdated: new Date().toISOString(),
        updatedBy: "yamapan.agent-skill-ninja",
      });
    } finally {
      console.warn = originalWarn;
    }

    assert.ok(
      warnings.some((line) =>
        line.includes("do not satisfy the shared manifest contract"),
      ),
      "a dropped write must not be silent",
    );

    const manifest = await readSharedSourcesManifest();
    assert.deepStrictEqual(
      Array.from(manifest.sources.map((source) => source.id)),
      ["alpha"],
    );
  });

  await test("unknown source types survive but are format checked", () => {
    assert.strictEqual(
      sanitizeSourceEntry(validEntry({ type: "preset" }))?.type,
      "preset",
    );
    assert.strictEqual(
      sanitizeSourceEntry(validEntry({ type: "a".repeat(200) }))?.type,
      "community",
    );
  });

  await test("an unparsable manifest is left untouched, not quarantined", async () => {
    await cleanSharedDir();
    await writeRawManifest("{ not json");
    assert.strictEqual(
      (await readSharedSourcesManifestResult()).status,
      "rejected",
    );

    await writeRawManifest("{ still not json");
    assert.strictEqual(
      (await readSharedSourcesManifestResult()).status,
      "rejected",
    );

    // 再確認と rename の間に別プロセスが直したファイルを退避させないため、読み手は触らない
    assert.strictEqual(
      await fs.promises.readFile(manifestPath, "utf8"),
      "{ still not json",
    );
    assert.deepStrictEqual(Array.from(await fs.promises.readdir(sharedDir)), [
      "sources.json",
    ]);
  });

  await test("read, decide and write happen inside one lock", async () => {
    await cleanSharedDir();
    await bootstrapSharedSourcesManifest([validEntry()]);

    const observed = [];
    await updateSharedSourcesManifest((current) => {
      observed.push(current?.sources.length ?? 0);
      assert.ok(
        fs.existsSync(lockPath),
        "mutate should run while holding the lock",
      );
      return {
        schemaVersion: 1,
        sources: [...(current?.sources || []), validEntry({ id: "beta" })],
        lastUpdated: new Date().toISOString(),
        updatedBy: "yamapan.agent-skill-ninja",
      };
    });

    assert.deepStrictEqual(Array.from(observed), [1]);
    const manifest = await readSharedSourcesManifest();
    assert.deepStrictEqual(
      Array.from(manifest.sources.map((source) => source.id)),
      ["alpha", "beta"],
    );
    assert.ok(!fs.existsSync(lockPath), "the lock should be released");
  });

  await test("sync keeps preserved ids and other extension scan stamps", async () => {
    await cleanSharedDir();
    await writeSharedSourcesManifest({
      schemaVersion: 1,
      sources: [
        validEntry({
          id: "retired",
          lastIndexedAt: "2026-05-01T00:00:00.000Z",
          lastIndexedBy: "yamapan.agent-resources-ninja",
        }),
        validEntry({
          id: "alpha",
          lastIndexedAt: "2026-05-02T00:00:00.000Z",
          lastIndexedBy: "yamapan.agent-resources-ninja",
        }),
        validEntry({ id: "dropped" }),
      ],
      lastUpdated: new Date().toISOString(),
      updatedBy: "yamapan.agent-resources-ninja",
    });

    await syncSharedSourcesManifestFromSources([validEntry({ id: "alpha" })], {
      preservedIds: ["retired"],
    });

    const manifest = await readSharedSourcesManifest();
    const byId = new Map(manifest.sources.map((source) => [source.id, source]));
    assert.deepStrictEqual(Array.from(byId.keys()).sort(), [
      "alpha",
      "retired",
    ]);
    assert.strictEqual(
      byId.get("alpha").lastIndexedAt,
      "2026-05-02T00:00:00.000Z",
      "another extension's scan stamp must not be wiped",
    );
  });

  await test("local scan history wins over shared manifest stamps", () => {
    const applied = applySharedSourcesManifestToSkillIndex(
      {
        version: "1",
        lastUpdated: "2026-06-01",
        sources: [
          {
            id: "alpha",
            name: "Alpha",
            url: "https://github.com/example/alpha",
            type: "official",
            description: "",
            lastIndexedAt: "2026-05-16T00:00:00.000Z",
            lastIndexedBy: "yamapan.agent-skill-ninja",
          },
        ],
        skills: [
          {
            name: "s",
            source: "alpha",
            path: "",
            categories: [],
            description: "",
          },
        ],
        categories: [],
      },
      {
        schemaVersion: 1,
        lastUpdated: new Date().toISOString(),
        updatedBy: "yamapan.agent-resources-ninja",
        sources: [
          {
            id: "alpha",
            name: "Alpha",
            url: "https://github.com/example/alpha",
            type: "official",
            description: "",
            lastIndexedAt: "2026-08-01T00:00:00.000Z",
            lastIndexedBy: "yamapan.agent-resources-ninja",
          },
          {
            id: "retired",
            name: "Retired",
            url: "https://github.com/example/retired",
            type: "official",
            description: "",
          },
        ],
      },
      { retiredSourceIds: ["retired"] },
    );

    assert.deepStrictEqual(
      Array.from(applied.sources.map((source) => source.id)),
      ["alpha"],
    );
    assert.strictEqual(
      applied.sources[0].lastIndexedAt,
      "2026-05-16T00:00:00.000Z",
    );
  });

  await test("a foreign lock is neither deleted on release nor stolen while fresh", async () => {
    await cleanSharedDir();

    let sawForeignLock = false;
    await withSharedStoreLock("yamapan.agent-skill-ninja", async () => {
      // 別プロセスが stale 判定で取り直した状況を再現する
      await fs.promises.writeFile(
        lockPath,
        JSON.stringify({
          pid: 1,
          acquiredAt: new Date().toISOString(),
          extensionId: "yamapan.agent-resources-ninja",
          generation: "other-generation",
        }),
        "utf8",
      );
      sawForeignLock = true;
    });

    assert.ok(sawForeignLock);
    assert.ok(
      fs.existsSync(lockPath),
      "release must not delete a lock owned by another generation",
    );

    const payload = JSON.parse(await fs.promises.readFile(lockPath, "utf8"));
    assert.strictEqual(payload.generation, "other-generation");
  });

  await test("unreadable locks fail acquisition instead of being removed", async () => {
    await cleanSharedDir();
    await fs.promises.writeFile(lockPath, "{ broken", "utf8");

    await assert.rejects(
      withSharedStoreLock("yamapan.agent-skill-ninja", async () => undefined),
      /Failed to acquire shared store lock/,
    );
    assert.ok(fs.existsSync(lockPath));
  });

  await test("stale locks are reclaimed", async () => {
    await cleanSharedDir();
    await fs.promises.writeFile(
      lockPath,
      JSON.stringify({
        pid: 1,
        acquiredAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        extensionId: "yamapan.agent-resources-ninja",
        generation: "abandoned",
      }),
      "utf8",
    );

    const result = await withSharedStoreLock(
      "yamapan.agent-skill-ninja",
      async () => "acquired",
    );
    assert.strictEqual(result, "acquired");
    assert.ok(!fs.existsSync(lockPath));
  });

  await test("data written before the contract change still works", async () => {
    await cleanSharedDir();
    // generation を持たない旧世代のロックでも、stale なら回収できる
    await fs.promises.writeFile(
      lockPath,
      JSON.stringify({
        pid: 1,
        acquiredAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        extensionId: "yamapan.agent-resources-ninja",
      }),
      "utf8",
    );
    assert.strictEqual(
      await withSharedStoreLock(
        "yamapan.agent-skill-ninja",
        async () => "acquired",
      ),
      "acquired",
    );

    // lastIndexedBy を持たない旧マニフェストも、登録情報として読める
    await cleanSharedDir();
    await writeRawManifest({
      schemaVersion: 1,
      lastUpdated: new Date().toISOString(),
      updatedBy: "yamapan.agent-resources-ninja",
      sources: [validEntry({ lastIndexedAt: "2026-08-01T00:00:00.000Z" })],
    });

    const manifest = await readSharedSourcesManifest();
    assert.ok(manifest);
    assert.strictEqual(manifest.sources[0].lastIndexedBy, undefined);

    const applied = applySharedSourcesManifestToSkillIndex(
      {
        version: "1",
        lastUpdated: "2026-06-01",
        sources: [],
        skills: [],
        categories: [],
      },
      manifest,
    );
    assert.strictEqual(applied.sources[0].id, "alpha");
    assert.strictEqual(
      applied.sources[0].lastIndexedAt,
      undefined,
      "an unknown scan stamp must not count as this extension's freshness",
    );
  });

  await test("a rejected manifest is never overwritten by bootstrap", async () => {
    await cleanSharedDir();
    await writeRawManifest({
      schemaVersion: 1,
      lastUpdated: new Date().toISOString(),
      updatedBy: "other.extension",
      sources: Array.from(
        { length: SHARED_SOURCES_MANIFEST_MAX_ENTRIES + 1 },
        (_, index) => validEntry({ id: `alpha-${index}` }),
      ),
    });
    const before = await fs.promises.readFile(manifestPath, "utf8");

    const result = await readSharedSourcesManifestResult();
    assert.strictEqual(result.status, "rejected");

    // read だけでなく、実際の writer を叩いても中身が変わらないこと
    assert.strictEqual(
      await bootstrapSharedSourcesManifest([validEntry({ id: "mine" })]),
      undefined,
    );
    assert.strictEqual(
      await writeSharedSourcesManifest({
        schemaVersion: 1,
        sources: [validEntry({ id: "mine" })],
        lastUpdated: new Date().toISOString(),
        updatedBy: "yamapan.agent-skill-ninja",
      }),
      "refused",
    );
    assert.strictEqual(
      await syncSharedSourcesManifestFromSources([validEntry({ id: "mine" })]),
      "refused",
    );

    assert.strictEqual(
      await fs.promises.readFile(manifestPath, "utf8"),
      before,
    );

    await fs.promises.rm(manifestPath, { force: true });
    assert.strictEqual(
      (await readSharedSourcesManifestResult()).status,
      "missing",
    );
  });

  await test("bootstrap does not clobber a manifest another process just created", async () => {
    await cleanSharedDir();
    await writeSharedSourcesManifest({
      schemaVersion: 1,
      sources: [validEntry({ id: "sibling-only" })],
      lastUpdated: new Date().toISOString(),
      updatedBy: "yamapan.agent-resources-ninja",
    });

    await bootstrapSharedSourcesManifest([validEntry({ id: "mine" })]);

    const manifest = await readSharedSourcesManifest();
    assert.deepStrictEqual(
      Array.from(manifest.sources.map((source) => source.id)),
      ["sibling-only"],
    );
  });

  await test("a lock left unreadable by a crash is reclaimed once it is old", async () => {
    await cleanSharedDir();
    // wx 作成直後に落ちた残骸を再現する
    await fs.promises.writeFile(lockPath, "", "utf8");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    await fs.promises.utimes(lockPath, old, old);

    assert.strictEqual(
      await withSharedStoreLock(
        "yamapan.agent-skill-ninja",
        async () => "acquired",
      ),
      "acquired",
      "an aged unreadable lock must not deadlock the shared store forever",
    );

    // まだ新しい未読ロックは従来どおり取得失敗に倒す
    await cleanSharedDir();
    await fs.promises.writeFile(lockPath, "{ broken", "utf8");
    await assert.rejects(
      withSharedStoreLock("yamapan.agent-skill-ninja", async () => undefined),
      /Failed to acquire shared store lock/,
    );
    assert.ok(fs.existsSync(lockPath));
  });

  await test("a stale sweep does not delete a lock a heartbeat just refreshed", async () => {
    await cleanSharedDir();
    const staleAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await fs.promises.writeFile(
      lockPath,
      JSON.stringify({
        pid: 1,
        acquiredAt: staleAt,
        extensionId: "yamapan.agent-resources-ninja",
        generation: "owner",
      }),
      "utf8",
    );

    // readLockState は stat と read を同じ handle で行うので、handle 側に差し込む
    const originalOpen = fs.promises.open;
    let lockReads = 0;
    fs.promises.open = async (...args) => {
      const handle = await originalOpen.apply(fs.promises, args);
      if (!String(args[0]).endsWith("index.lock")) {
        return handle;
      }

      const originalHandleReadFile = handle.readFile.bind(handle);
      handle.readFile = async (...readArgs) => {
        lockReads += 1;
        // 各試行の 2 回目の読み取りで heartbeat が延長した状況にする
        if (lockReads % 2 === 0) {
          return JSON.stringify({
            pid: 1,
            acquiredAt: new Date().toISOString(),
            extensionId: "yamapan.agent-resources-ninja",
            generation: "owner",
          });
        }
        return originalHandleReadFile(...readArgs);
      };
      return handle;
    };

    try {
      await assert.rejects(
        withSharedStoreLock("yamapan.agent-skill-ninja", async () => undefined),
        /Failed to acquire shared store lock/,
      );
    } finally {
      fs.promises.open = originalOpen;
    }

    assert.ok(fs.existsSync(lockPath), "a refreshed lock must survive");
  });

  await test("a stale lock held by a live process is not stolen", async () => {
    await cleanSharedDir();
    await fs.promises.writeFile(
      lockPath,
      JSON.stringify({
        // 停止中の生存プロセスから奪うと、再開時に両者が書ける
        pid: process.pid,
        acquiredAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        extensionId: "yamapan.agent-resources-ninja",
        generation: "live-owner",
      }),
      "utf8",
    );

    await assert.rejects(
      withSharedStoreLock("yamapan.agent-skill-ninja", async () => undefined),
      /Failed to acquire shared store lock/,
    );
    assert.ok(fs.existsSync(lockPath));

    // PID 再利用で恒久停止しないよう、十分に古ければ生存判定に関わらず回収する
    await fs.promises.writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        acquiredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        extensionId: "yamapan.agent-resources-ninja",
        generation: "very-old",
      }),
      "utf8",
    );
    assert.strictEqual(
      await withSharedStoreLock(
        "yamapan.agent-skill-ninja",
        async () => "acquired",
      ),
      "acquired",
    );
  });

  await test("the write decision uses this read's rejections, not a shared latch", async () => {
    await cleanSharedDir();
    await writeRawManifest({
      schemaVersion: 1,
      lastUpdated: new Date().toISOString(),
      updatedBy: "other.extension",
      sources: [validEntry(), validEntry({ id: "evil", url: "http://x/y/z" })],
    });

    const result = await readSharedSourcesManifestResult();
    assert.strictEqual(result.status, "valid");
    assert.deepStrictEqual(Array.from(result.rejectedEntries), ["evil (#1)"]);

    // 並行 read がモジュール変数を消しても、書き込み判定は現在のファイル内容で決まる
    await fs.promises.rm(manifestPath, { force: true });
    await readSharedSourcesManifestResult();
    await writeRawManifest({
      schemaVersion: 1,
      lastUpdated: new Date().toISOString(),
      updatedBy: "other.extension",
      sources: [validEntry(), validEntry({ id: "evil", url: "http://x/y/z" })],
    });

    assert.strictEqual(
      await syncSharedSourcesManifestFromSources([validEntry({ id: "mine" })]),
      "refused",
    );
  });

  await fs.promises.rm(tempRoot, { recursive: true, force: true });

  if (failures > 0) {
    throw new Error(`${failures} shared store hardening test(s) failed`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
