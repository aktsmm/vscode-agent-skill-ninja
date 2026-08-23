#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const reconcilePath = path.join(repoRoot, "src", "sourceUpdateReconcile.ts");
const skillIndexPath = path.join(repoRoot, "src", "skillIndex.ts");

const warnings = [];

const vscodeStub = {
  __configBySection: {},
  window: {
    showWarningMessage(message) {
      warnings.push(message);
    },
  },
  Uri: {
    file(filePath) {
      return {
        fsPath: path.resolve(filePath),
        path: path.resolve(filePath).replace(/\\/g, "/"),
      };
    },
    joinPath(base, ...parts) {
      const fsPath = path.join(base.fsPath, ...parts);
      return { fsPath, path: fsPath.replace(/\\/g, "/") };
    },
  },
  workspace: {
    getConfiguration(section) {
      return {
        get(key, fallback) {
          const values = section
            ? vscodeStub.__configBySection[section] || {}
            : vscodeStub.__configBySection.__root || {};
          return key in values ? values[key] : fallback;
        },
      };
    },
    fs: {
      async readFile(target) {
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
    },
  },
};

function compileTsModule(entryPath, stubs = {}) {
  const cache = new Map();

  function resolveTsModule(basePath, request) {
    const candidate = path.resolve(path.dirname(basePath), `${request}.ts`);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    throw new Error(`Cannot resolve ${request} from ${basePath}`);
  }

  function loadModule(modulePath) {
    if (cache.has(modulePath)) {
      return cache.get(modulePath).exports;
    }

    const source = fs.readFileSync(modulePath, "utf8");
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: modulePath,
    });

    const module = { exports: {} };
    cache.set(modulePath, module);

    const sandbox = {
      module,
      exports: module.exports,
      process,
      console,
      Buffer,
      AbortController,
      fetch: global.fetch,
      setTimeout,
      clearTimeout,
      require(request) {
        if (request === "vscode") {
          return vscodeStub;
        }
        if (request in stubs) {
          return stubs[request];
        }
        if (request.startsWith("./") || request.startsWith("../")) {
          return loadModule(resolveTsModule(modulePath, request));
        }
        return require(request);
      },
    };

    vm.runInNewContext(transpiled.outputText, sandbox, {
      filename: modulePath,
    });

    return module.exports;
  }

  return loadModule(entryPath);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function bundle(id, source, skills) {
  return {
    id,
    name: id,
    source,
    description: id,
    skills,
  };
}

async function run() {
  const {
    createSourceBundleKey,
    hasRepositoryIdentityChanged,
    reconcileSourceBundles,
    resolveSourceRename,
    shouldPreserveSkillsOnEmptyScan,
  } = compileTsModule(reconcilePath);

  await test("a renamed repository updates an auto-generated display name", () => {
    const result = resolveSourceRename(
      {
        name: "ghc_template",
        description: "User added repository: aktsmm/ghc_template",
      },
      {
        name: "Agent-Customization",
        description: "User added repository: aktsmm/Agent-Customization",
      },
    );

    assert.strictEqual(result.renamed, true);
    assert.strictEqual(result.previousFullName, "aktsmm/ghc_template");
    assert.strictEqual(result.nextFullName, "aktsmm/Agent-Customization");
    assert.strictEqual(result.name, "Agent-Customization");
    assert.strictEqual(
      result.description,
      "User added repository: aktsmm/Agent-Customization",
    );
  });

  await test("a rename never overwrites a display name the user chose", () => {
    const result = resolveSourceRename(
      {
        name: "My favourite skills",
        description: "User added repository: aktsmm/ghc_template",
      },
      {
        name: "Agent-Customization",
        description: "User added repository: aktsmm/Agent-Customization",
      },
    );

    assert.strictEqual(result.renamed, true);
    assert.strictEqual(result.name, undefined);
    assert.strictEqual(result.description, undefined);
  });

  await test("an unchanged repository is not reported as renamed", () => {
    const same = resolveSourceRename(
      { name: "repo", description: "User added repository: owner/repo" },
      { name: "repo", description: "User added repository: owner/repo" },
    );
    assert.strictEqual(same.renamed, false);

    // プリセットなど自動生成でない description は判定対象外
    const preset = resolveSourceRename(
      { name: "Curated", description: "Official curated skills" },
      { name: "Curated", description: "User added repository: owner/repo" },
    );
    assert.strictEqual(preset.renamed, false);
  });

  await test("a repository id change is treated as a different repository", () => {
    assert.strictEqual(hasRepositoryIdentityChanged(42, 43), true);
  });

  await test("an unchanged or unknown repository id is not flagged", () => {
    assert.strictEqual(hasRepositoryIdentityChanged(42, 42), false);
    assert.strictEqual(hasRepositoryIdentityChanged(undefined, 42), false);
    assert.strictEqual(hasRepositoryIdentityChanged(42, undefined), false);
  });

  await test("empty scan with existing skills is preserved", () => {
    assert.strictEqual(shouldPreserveSkillsOnEmptyScan(0, 12), true);
  });

  await test("empty scan on an empty source is not preserved", () => {
    assert.strictEqual(shouldPreserveSkillsOnEmptyScan(0, 0), false);
  });

  await test("non-empty scan replaces existing skills", () => {
    assert.strictEqual(shouldPreserveSkillsOnEmptyScan(5, 12), false);
  });

  await test("bundle keys are scoped by source", () => {
    assert.strictEqual(
      createSourceBundleKey({ source: "alpha", id: "core" }),
      "alpha:core",
    );
    assert.notStrictEqual(
      createSourceBundleKey({ source: "alpha", id: "core" }),
      createSourceBundleKey({ source: "beta", id: "core" }),
    );
  });

  await test("scanned bundles replace the source bundles", () => {
    const result = reconcileSourceBundles(
      [bundle("old", "alpha", ["a"])],
      [bundle("fresh", "ignored", ["b"])],
      "alpha",
    );
    assert.deepStrictEqual(
      result.map((item) => `${item.source}:${item.id}`),
      ["alpha:fresh"],
    );
  });

  await test("curated bundles survive a scan that returns none", () => {
    const result = reconcileSourceBundles(
      [bundle("curated", "alpha", ["a"]), bundle("other", "beta", ["b"])],
      undefined,
      "alpha",
    );
    assert.deepStrictEqual(
      result.map((item) => `${item.source}:${item.id}`),
      ["alpha:curated"],
    );
  });

  const originalAppData = process.env.APPDATA;
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "skill-ninja-reconcile-"),
  );

  try {
    process.env.APPDATA = tempRoot;
    vscodeStub.__configBySection.skillNinja = {
      useSharedSourcesManifest: false,
    };

    const { loadSkillIndex, normalizeGitHubRepoUrl } = compileTsModule(
      skillIndexPath,
      {
        "./githubFetch": {
          createGitHubHeaders: () => ({}),
          fetchGitHubWithOptionalAuthRetry: async () => ({ ok: false }),
        },
      },
    );

    const context = {
      globalStorageUri: vscodeStub.Uri.file(
        path.join(tempRoot, "globalStorage"),
      ),
      extensionUri: vscodeStub.Uri.file(path.join(tempRoot, "extension")),
    };

    const presetSource = {
      id: "preset",
      name: "Preset",
      url: "https://github.com/example/preset",
      type: "official",
      description: "preset",
    };
    const skills = [
      {
        name: "kept-skill",
        source: "preset",
        path: "skills/kept",
        categories: [],
        description: "kept",
      },
      {
        name: "user-skill",
        source: "user",
        path: "skills/user",
        categories: [],
        description: "user",
      },
    ];

    const bundledIndex = {
      version: "1.1.0",
      lastUpdated: "2026-08-07",
      sources: [presetSource],
      skills,
      categories: [],
      bundles: [bundle("kept-bundle", "preset", ["kept-skill"])],
    };

    const localIndex = {
      version: "1.0.0",
      lastUpdated: "2026-07-01",
      sources: [
        presetSource,
        {
          id: "user",
          name: "User",
          url: "https://github.com/example/user",
          type: "user-added",
          description: "user",
        },
      ],
      skills,
      categories: [],
      bundles: [
        bundle("kept-bundle", "preset", ["kept-skill"]),
        bundle("removed-bundle", "preset", ["kept-skill"]),
        bundle("user-bundle", "user", ["user-skill"]),
      ],
    };

    await fs.promises.mkdir(
      path.join(context.extensionUri.fsPath, "resources"),
      { recursive: true },
    );
    await fs.promises.writeFile(
      path.join(context.extensionUri.fsPath, "resources", "skill-index.json"),
      JSON.stringify(bundledIndex, null, 2),
      "utf8",
    );
    await fs.promises.mkdir(context.globalStorageUri.fsPath, {
      recursive: true,
    });
    await fs.promises.writeFile(
      path.join(context.globalStorageUri.fsPath, "skill-index.json"),
      JSON.stringify(localIndex, null, 2),
      "utf8",
    );

    const merged = await loadSkillIndex(context);
    const mergedKeys = (merged.bundles || []).map(
      (item) => `${item.source}:${item.id}`,
    );

    await test("preset bundle removed from the bundled index is pruned", () => {
      assert.ok(!mergedKeys.includes("preset:removed-bundle"));
      assert.ok(mergedKeys.includes("preset:kept-bundle"));
    });

    await test("user-added source bundles are never pruned", () => {
      assert.ok(mergedKeys.includes("user:user-bundle"));
    });

    await test("pruning is persisted to the local index", async () => {
      const persisted = JSON.parse(
        await fs.promises.readFile(
          path.join(context.globalStorageUri.fsPath, "skill-index.json"),
          "utf8",
        ),
      );
      const persistedKeys = (persisted.bundles || []).map(
        (item) => `${item.source}:${item.id}`,
      );
      assert.ok(!persistedKeys.includes("preset:removed-bundle"));
    });

    const indexUpdaterPath = path.join(repoRoot, "src", "indexUpdater.ts");
    const emptyTreeResponse = () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      async json() {
        return { tree: [], truncated: false };
      },
      async text() {
        return "";
      },
      clone() {
        return emptyTreeResponse();
      },
    });

    const jsonResponse = (payload, status = 200) => {
      const build = () => ({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        async json() {
          return payload;
        },
        async text() {
          return JSON.stringify(payload);
        },
        clone() {
          return build();
        },
      });
      return build();
    };

    const requestedUrls = [];
    let repoInfoPayload = {
      full_name: "new-owner/new-repo",
      default_branch: "development",
      id: 42,
    };
    let repoInfoStatus = 200;

    const indexUpdaterStubs = {
      "./skillIndex": {
        saveSkillIndex: async () => {},
        // 実装を書き写さず同じ関数を渡す
        normalizeGitHubRepoUrl,
      },
      "./githubAuth": {
        checkGitHubAuth: async () => ({}),
        getGitHubToken: async () => undefined,
        hasStoredGitHubToken: async () => false,
      },
      "./i18n": {
        messages: {
          updatingSource: () => "updating",
          sourceIndexEmptyScanKept: (count) => `kept ${count}`,
          sourceIndexSkillsUpdatedProgress: (count) => `updated ${count}`,
          sourceIndexForeignScannerKept: (scanner) =>
            `cannot run scanner ${scanner}`,
          sourceIndexForeignScannerSkipped: (count, sources) =>
            `skipped ${count} (${sources})`,
        },
      },
      "./constants": {
        INDEX_LIMITS: { SHORT_DESCRIPTION: 200 },
        LICENSE_EXTRACTION: { FILE_NAMES: [], PATTERNS: [] },
      },
      "./githubFetch": {
        GITHUB_REQUEST_TIMEOUT_MS: 15000,
        resetGitHubSsoCache: () => {},
        fetchGitHubWithTimeout: async () => emptyTreeResponse(),
        fetchGitHubWithRetry: async () => emptyTreeResponse(),
        fetchGitHubWithOptionalAuthRetry: async (url) => {
          requestedUrls.push(url);
          if (/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(url)) {
            return jsonResponse(repoInfoPayload, repoInfoStatus);
          }
          return emptyTreeResponse();
        },
      },
    };

    const {
      updateIndexFromSources,
      scanRepositoryForSkills,
      clearRepositoryResolutionCache,
      resolveSourceScanner,
    } = compileTsModule(indexUpdaterPath, indexUpdaterStubs);

    await test("an explicit source scanner wins over the repo-name heuristic", () => {
      assert.strictEqual(
        resolveSourceScanner("awesome-claude-skills", { scanner: "skill-md" }),
        "skill-md",
      );
      assert.strictEqual(
        resolveSourceScanner("renamed-repo", { scanner: "top-level-dirs" }),
        "top-level-dirs",
      );
    });

    await test("the repo-name heuristic stays as a legacy fallback only", () => {
      assert.strictEqual(
        resolveSourceScanner("awesome-claude-skills"),
        "top-level-dirs",
      );
      assert.strictEqual(
        resolveSourceScanner("PRPs-agentic-eng"),
        "claude-commands",
      );
      assert.strictEqual(
        resolveSourceScanner("claude-skill-registry"),
        "registry-json",
      );
      assert.strictEqual(resolveSourceScanner("prp"), "skill-md");
    });

    await test("a renamed repository is resolved to its canonical owner/repo", async () => {
      clearRepositoryResolutionCache();
      requestedUrls.length = 0;

      const result = await scanRepositoryForSkills(
        "https://github.com/old-owner/old-repo",
      );

      assert.strictEqual(
        result.source.url,
        "https://github.com/new-owner/new-repo",
      );
      assert.ok(
        requestedUrls.some((url) =>
          url.includes(
            "/repos/new-owner/new-repo/git/trees/development?recursive=1",
          ),
        ),
        `tree request did not use the canonical repo: ${requestedUrls.join(", ")}`,
      );
    });

    await test("repository resolution is cached per session", async () => {
      clearRepositoryResolutionCache();
      requestedUrls.length = 0;

      await scanRepositoryForSkills("https://github.com/old-owner/old-repo");
      await scanRepositoryForSkills("https://github.com/old-owner/old-repo");

      const repoInfoCalls = requestedUrls.filter((url) =>
        /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(url),
      );
      assert.strictEqual(repoInfoCalls.length, 1);
    });

    await test("resolution failure falls back to the requested owner/repo", async () => {
      clearRepositoryResolutionCache();
      requestedUrls.length = 0;
      repoInfoStatus = 404;
      repoInfoPayload = {};

      try {
        const result = await scanRepositoryForSkills(
          "https://github.com/old-owner/old-repo",
        );
        assert.strictEqual(
          result.source.url,
          "https://github.com/old-owner/old-repo",
        );
        assert.ok(
          requestedUrls.some((url) =>
            url.includes("/repos/old-owner/old-repo/git/trees/main"),
          ),
          `tree request did not fall back: ${requestedUrls.join(", ")}`,
        );
      } finally {
        repoInfoStatus = 200;
        repoInfoPayload = {
          full_name: "new-owner/new-repo",
          default_branch: "development",
          id: 42,
        };
        clearRepositoryResolutionCache();
      }
    });

    await test("an explicit branch wins over the resolved default branch", async () => {
      clearRepositoryResolutionCache();
      requestedUrls.length = 0;

      await scanRepositoryForSkills(
        "https://github.com/old-owner/old-repo",
        undefined,
        "custom-branch",
      );

      assert.ok(
        requestedUrls.some((url) => url.includes("/git/trees/custom-branch")),
        `explicit branch was not used: ${requestedUrls.join(", ")}`,
      );
    });

    await test("bulk update keeps skills and bundles when a scan returns 0 skills", async () => {
      const before = {
        version: "1.0.0",
        lastUpdated: "2026-07-01",
        categories: [],
        sources: [
          {
            id: "preset",
            name: "Preset",
            url: "https://github.com/example/preset",
            type: "official",
            branch: "main",
            description: "preset",
          },
        ],
        skills: [
          {
            name: "kept-skill",
            source: "preset",
            path: "skills/kept",
            categories: [],
            description: "kept",
          },
        ],
        bundles: [bundle("curated", "preset", ["kept-skill"])],
      };

      const after = await updateIndexFromSources({}, before);

      assert.strictEqual(after.skills.length, 1);
      assert.strictEqual(after.skills[0].name, "kept-skill");
      assert.strictEqual(
        (after.bundles || []).map((item) => `${item.source}:${item.id}`).join(),
        "preset:curated",
      );
      assert.strictEqual(after.sources[0].lastIndexedAt, undefined);
    });

    await test("bulk update refuses a source whose URL now points at another repository", async () => {
      clearRepositoryResolutionCache();
      const before = {
        version: "1.0.0",
        lastUpdated: "2026-07-01",
        categories: [],
        bundles: [],
        sources: [
          {
            id: "preset",
            name: "Preset",
            url: "https://github.com/old-owner/old-repo",
            type: "official",
            branch: "main",
            repoId: 999,
            description: "preset",
          },
        ],
        skills: [
          {
            name: "kept-skill",
            source: "preset",
            path: "skills/kept",
            categories: [],
            description: "kept",
          },
        ],
      };

      const after = await updateIndexFromSources({}, before);

      assert.strictEqual(after.skills.length, 1);
      assert.strictEqual(after.sources[0].repoId, 999);
      assert.strictEqual(after.sources[0].lastIndexedAt, undefined);
      assert.strictEqual(
        after.sources[0].url,
        "https://github.com/old-owner/old-repo",
      );
    });

    await test("single-source update records the repository id on first scan", async () => {
      clearRepositoryResolutionCache();
      const { updateSingleSource, updateIndexFromSingleSource } =
        compileTsModule(indexUpdaterPath, indexUpdaterStubs);

      const before = {
        version: "1.0.0",
        lastUpdated: "2026-07-01",
        categories: [],
        bundles: [],
        sources: [
          {
            id: "preset",
            name: "Preset",
            url: "https://github.com/old-owner/old-repo",
            type: "official",
            branch: "main",
            description: "preset",
          },
        ],
        skills: [],
      };

      const { index } = await updateSingleSource({}, before, "preset");
      assert.strictEqual(index.sources[0].repoId, 42);

      const viaSingleSource = await updateIndexFromSingleSource(
        {},
        before,
        "preset",
      );
      assert.strictEqual(viaSingleSource.sources[0].repoId, 42);
    });

    await test("a foreign scanner is kept but never scanned", async () => {
      clearRepositoryResolutionCache();
      const before = {
        version: "1.0.0",
        lastUpdated: "2026-07-01",
        categories: [],
        sources: [
          {
            id: "sibling",
            name: "Sibling",
            url: "https://github.com/example/sibling",
            type: "community",
            branch: "main",
            description: "sibling",
            // 別拡張だけが実装している scanner
            scanner: "auto",
          },
        ],
        skills: [
          {
            name: "sibling-skill",
            source: "sibling",
            path: "skills/sibling",
            categories: [],
            description: "sibling",
          },
        ],
        bundles: [bundle("sibling-bundle", "sibling", ["sibling-skill"])],
      };

      const requestsBefore = requestedUrls.length;
      const warningsBefore = warnings.length;
      const after = await updateIndexFromSources({}, before);

      assert.strictEqual(
        requestedUrls.length,
        requestsBefore,
        "a foreign scanner must not trigger any repository request",
      );
      assert.ok(
        warnings.slice(warningsBefore).some((text) => text.includes("sibling")),
        "the skipped source must be reported, not silently ignored",
      );
      assert.strictEqual(after.skills.length, 1);
      assert.strictEqual(after.skills[0].name, "sibling-skill");
      assert.strictEqual(
        (after.bundles || []).map((item) => `${item.source}:${item.id}`).join(),
        "sibling:sibling-bundle",
      );
      assert.strictEqual(after.sources[0].scanner, "auto");
      assert.strictEqual(after.sources[0].lastIndexedAt, undefined);
      assert.strictEqual(after.lastScannedAt, undefined);

      // 単一更新も同じ境界を守る。呼び出し元はこちらだけを使う
      const { updateIndexFromSingleSource: singleUpdate } = compileTsModule(
        indexUpdaterPath,
        indexUpdaterStubs,
      );
      const requestsBeforeSingle = requestedUrls.length;
      await assert.rejects(singleUpdate({}, before, "sibling"), /auto/);
      assert.strictEqual(
        requestedUrls.length,
        requestsBeforeSingle,
        "single-source update must not scan a foreign scanner either",
      );

      // 登録済み source の再追加も同じ境界を守る
      const { addSource } = compileTsModule(
        indexUpdaterPath,
        indexUpdaterStubs,
      );
      const requestsBeforeAdd = requestedUrls.length;
      await assert.rejects(
        addSource({}, before, "https://github.com/example/sibling"),
        /auto/,
      );
      assert.strictEqual(
        requestedUrls.length,
        requestsBeforeAdd,
        "re-adding a foreign-scanner source must not scan it",
      );

      // URL 表記が違って事前判定を外れても、解決後の id 一致で上書きを止める
      const resolvedElsewhere = {
        ...before,
        sources: [
          {
            ...before.sources[0],
            id: "new-owner-new-repo",
            url: "https://github.com/other/alias",
          },
        ],
        skills: [{ ...before.skills[0], source: "new-owner-new-repo" }],
      };
      await assert.rejects(
        addSource(
          {},
          resolvedElsewhere,
          "https://github.com/new-owner/new-repo",
        ),
        /auto/,
      );
      assert.strictEqual(
        resolvedElsewhere.skills.length,
        1,
        "the existing skills must survive a blocked re-add",
      );
    });
  } finally {
    if (originalAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = originalAppData;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log("\nSource update reconcile tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
