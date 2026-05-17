#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const skillIndexPath = path.join(repoRoot, "src", "skillIndex.ts");
const sharedStorePath = path.join(
  repoRoot,
  "src",
  "shared-sources-manifest-store.ts",
);
const indexUpdaterPath = path.join(repoRoot, "src", "indexUpdater.ts");
const packageJsonPath = path.join(repoRoot, "package.json");

const vscodeStub = {
  __configBySection: {},
  Uri: {
    file(filePath) {
      return {
        fsPath: path.resolve(filePath),
        path: path.resolve(filePath).replace(/\\/g, "/"),
      };
    },
    joinPath(base, ...parts) {
      const fsPath = path.join(base.fsPath, ...parts);
      return {
        fsPath,
        path: fsPath.replace(/\\/g, "/"),
      };
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
    const indexCandidate = path.resolve(
      path.dirname(basePath),
      request,
      "index.ts",
    );
    if (fs.existsSync(indexCandidate)) {
      return indexCandidate;
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

async function run() {
  const originalAppData = process.env.APPDATA;
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "skill-ninja-shared-"),
  );
  try {
    process.env.APPDATA = tempRoot;

    const skillIndexExports = compileTsModule(skillIndexPath, {
      "./githubFetch": {
        createGitHubHeaders: () => ({}),
        fetchGitHubWithOptionalAuthRetry: async () => ({ ok: false }),
      },
    });
    const sharedStoreExports = compileTsModule(sharedStorePath);
    const indexUpdaterSource = fs.readFileSync(indexUpdaterPath, "utf8");
    const extensionSource = fs.readFileSync(
      path.join(repoRoot, "src", "extension.ts"),
      "utf8",
    );
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

    const { loadSkillIndex, saveSkillIndex } = skillIndexExports;
    const {
      applySharedSourcesManifestToSkillIndex,
      readSharedSourcesManifest,
    } = sharedStoreExports;

    const context = {
      globalStorageUri: vscodeStub.Uri.file(
        path.join(tempRoot, "globalStorage"),
      ),
      extensionUri: vscodeStub.Uri.file(path.join(tempRoot, "extension")),
    };
    await fs.promises.mkdir(
      path.join(context.extensionUri.fsPath, "resources"),
      {
        recursive: true,
      },
    );

    const bundledIndex = {
      version: "1.0.0",
      lastUpdated: "2026-05-17",
      sources: [
        {
          id: "alpha",
          name: "Alpha",
          url: "https://github.com/example/alpha",
          type: "preset",
          description: "Alpha source",
        },
        {
          id: "beta",
          name: "Beta",
          url: "https://github.com/example/beta",
          type: "preset",
          description: "Beta source",
        },
      ],
      skills: [
        {
          name: "alpha-skill",
          source: "alpha",
          path: "skills/alpha",
          categories: [],
          description: "alpha",
        },
        {
          name: "beta-skill",
          source: "beta",
          path: "skills/beta",
          categories: [],
          description: "beta",
        },
      ],
      categories: [],
      bundles: [
        {
          id: "alpha-bundle",
          name: "Alpha Bundle",
          source: "alpha",
          description: "alpha bundle",
          skills: ["alpha-skill"],
        },
        {
          id: "beta-bundle",
          name: "Beta Bundle",
          source: "beta",
          description: "beta bundle",
          skills: ["beta-skill"],
        },
      ],
    };

    await fs.promises.writeFile(
      path.join(context.extensionUri.fsPath, "resources", "skill-index.json"),
      JSON.stringify(bundledIndex, null, 2),
      "utf8",
    );

    vscodeStub.__configBySection.skillNinja = {
      useSharedSourcesManifest: true,
    };

    await test("loadSkillIndex bootstraps shared sources manifest when enabled", async () => {
      const index = await loadSkillIndex(context);
      assert.strictEqual(index.sources.length, 2);

      const manifest = await readSharedSourcesManifest();
      assert.ok(manifest, "shared sources manifest should be created");
      assert.deepStrictEqual(
        JSON.parse(JSON.stringify(manifest.sources)),
        JSON.parse(JSON.stringify(bundledIndex.sources)),
      );
    });

    await test("shared manifest overrides source list and prunes stale skills and bundles", async () => {
      const manifestPath = path.join(tempRoot, "agent-ninja", "sources.json");
      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(
          {
            schemaVersion: 1,
            lastUpdated: new Date().toISOString(),
            updatedBy: "yamapan.agent-resources-ninja",
            sources: [
              {
                id: "alpha",
                name: "Alpha",
                url: "https://github.com/example/alpha",
                type: "preset",
                description: "Alpha source",
                includePaths: ["skills/alpha"],
                excludePaths: ["skills/alpha/tests"],
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );

      const index = await loadSkillIndex(context);
      assert.deepStrictEqual(
        JSON.parse(JSON.stringify(index.sources[0].includePaths)),
        ["skills/alpha"],
      );
      assert.deepStrictEqual(
        JSON.parse(JSON.stringify(index.sources[0].excludePaths)),
        ["skills/alpha/tests"],
      );
      assert.deepStrictEqual(
        JSON.parse(JSON.stringify(index.skills.map((skill) => skill.source))),
        ["alpha"],
      );
      assert.deepStrictEqual(
        JSON.parse(
          JSON.stringify((index.bundles || []).map((bundle) => bundle.source)),
        ),
        ["alpha"],
      );
    });

    await test("saveSkillIndex syncs source definitions back to shared manifest", async () => {
      const updatedIndex = {
        ...bundledIndex,
        sources: [
          {
            id: "gamma",
            name: "Gamma",
            url: "https://github.com/example/gamma",
            type: "user-added",
            branch: "main",
            description: "Gamma source",
            includePaths: ["skills/gamma"],
            excludePaths: ["skills/gamma/archive"],
          },
        ],
        skills: [],
        bundles: [],
      };

      await saveSkillIndex(context, updatedIndex);
      const manifest = await readSharedSourcesManifest();
      assert.ok(manifest);
      assert.deepStrictEqual(
        JSON.parse(JSON.stringify(manifest.sources)),
        JSON.parse(JSON.stringify(updatedIndex.sources)),
      );
    });

    await test("applySharedSourcesManifestToSkillIndex prunes removed source entries", async () => {
      const nextIndex = applySharedSourcesManifestToSkillIndex(bundledIndex, {
        schemaVersion: 1,
        lastUpdated: new Date().toISOString(),
        updatedBy: "yamapan.agent-resources-ninja",
        sources: [bundledIndex.sources[1]],
      });

      assert.deepStrictEqual(
        JSON.parse(
          JSON.stringify(nextIndex.sources.map((source) => source.id)),
        ),
        ["beta"],
      );
      assert.deepStrictEqual(
        JSON.parse(
          JSON.stringify(nextIndex.skills.map((skill) => skill.source)),
        ),
        ["beta"],
      );
      assert.deepStrictEqual(
        JSON.parse(
          JSON.stringify(
            (nextIndex.bundles || []).map((bundle) => bundle.source),
          ),
        ),
        ["beta"],
      );
    });

    await test("manifest and updater wire shared source filters through runtime", async () => {
      assert.ok(
        packageJson.contributes.configuration.properties[
          "skillNinja.useSharedSourcesManifest"
        ],
      );
      assert.match(
        indexUpdaterSource,
        /sourceOptions\?: Pick<Source, "includePaths" \| "excludePaths">/,
      );
      assert.match(indexUpdaterSource, /function isSkillPathAllowed\(/);
      assert.match(
        indexUpdaterSource,
        /export function normalizeSkillRootPathFromSkillFile\(/,
      );
      assert.ok(
        indexUpdaterSource.includes(
          'return normalizedPath.replace(/\\/skill\\.md$/i, "");',
        ),
      );
      assert.match(
        indexUpdaterSource,
        /scanRepositoryForSkills\([\s\S]*source\.branch,[\s\S]*source/,
      );
      assert.match(
        indexUpdaterSource,
        /canUseLegacyFallbackScanner = skillFiles\.length === 0/,
      );
      assert.match(
        extensionSource,
        /function isSharedSourcesManifestEnabled\(/,
      );
      assert.match(extensionSource, /async function getRemoteSourceIndex\(/);
      assert.match(
        extensionSource,
        /skillIndex = await getRemoteSourceIndex\(\);/,
      );
    });

    console.log("Shared sources manifest tests passed.");
  } finally {
    process.env.APPDATA = originalAppData;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
