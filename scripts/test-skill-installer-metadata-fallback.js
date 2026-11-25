/**
 * skillInstaller metadata-less fallback regression tests.
 * Run: node scripts/test-skill-installer-metadata-fallback.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");
const { requireSrcOrNodeModule } = require("./load-src-module");

const sourcePath = path.join(__dirname, "..", "src", "skillInstaller.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

const FileType = { File: 1, Directory: 2, SymbolicLink: 64 };

function makeUri(fsPath) {
  const normalized = path.normalize(fsPath);
  return {
    fsPath: normalized,
    path: normalized.replace(/\\/g, "/"),
    scheme: "file",
  };
}

function joinPath(base, ...parts) {
  return makeUri(path.join(base.fsPath, ...parts));
}

class FsBackedFs {
  async stat(uri) {
    const stat = fs.statSync(uri.fsPath);
    return {
      type: stat.isDirectory()
        ? FileType.Directory
        : stat.isFile()
          ? FileType.File
          : FileType.SymbolicLink,
      ctime: stat.ctimeMs,
      mtime: stat.mtimeMs,
      size: stat.size,
    };
  }

  async readDirectory(uri) {
    return fs
      .readdirSync(uri.fsPath, { withFileTypes: true })
      .map((entry) => [
        entry.name,
        entry.isDirectory()
          ? FileType.Directory
          : entry.isFile()
            ? FileType.File
            : FileType.SymbolicLink,
      ]);
  }

  async readFile(uri) {
    return fs.readFileSync(uri.fsPath);
  }

  async writeFile(uri, content) {
    fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
    fs.writeFileSync(uri.fsPath, content);
  }
}

function loadModule(fsImpl = new FsBackedFs(), textDocuments = [], managedRoots = []) {
  const moduleExports = {};
  const vscodeStub = {
    FileType,
    Uri: {
      file: makeUri,
      joinPath,
    },
    workspace: {
      fs: fsImpl,
      textDocuments,
      getConfiguration() {
        return {
          get(_key, defaultValue) {
            return defaultValue;
          },
        };
      },
    },
  };

  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    Buffer,
    console,
    process,
    require(request) {
      if (request === "vscode") {
        return vscodeStub;
      }
      if (request === "./skillIndex") {
        return {
          loadSkillIndex: async () => ({ skills: [], sources: [] }),
          getSourceBranch: async () => "main",
        };
      }
      if (request === "./i18n") {
        return { isJapanese: () => false };
      }
      if (request === "./githubAuth") {
        return { getGitHubToken: async () => undefined };
      }
      if (request === "./skillLocations") {
        return {
          getManagedSkillRoots: async () => managedRoots,
          resolveWorkspaceSkillsRootUri: (workspaceUri) => workspaceUri,
        };
      }
      if (request === "./skillUpdates") {
        return {
          createSkillRevisionResolver: () => async () => {
            throw new Error("Revision unavailable in legacy fallback fixture");
          },
        };
      }
      if (request === "./githubFetch") {
        return {
          createGitHubHeaders: () => ({}),
          fetchGitHubWithOptionalAuthRetry: async () => {
            throw new Error("not used in this test");
          },
        };
      }
      if (request === "./githubDirectoryTraversal") {
        return {
          partitionGitHubDirectoryEntries: () => ({
            files: [],
            directories: [],
          }),
          resolveSymlinkTargetPath: () => "",
        };
      }
      if (request === "./installedSkillIndex") {
        return {
          normalizeInstalledSkillSource(source, remotePath) {
            const trimmedSource = source?.trim();
            if (trimmedSource) {
              return trimmedSource;
            }

            return remotePath ? "unknown" : "local";
          },
        };
      }
      return requireSrcOrNodeModule(request);
    },
  };

  vm.runInNewContext(transpiled.outputText, sandbox, {
    filename: sourcePath,
  });

  return sandbox.module.exports;
}

function writeSkill(rootPath, skillName, frontmatterDescription) {
  const skillDir = path.join(rootPath, skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    [
      "---",
      `name: ${skillName}`,
      `description: ${frontmatterDescription}`,
      "---",
      "",
      `# ${skillName}`,
    ].join("\n"),
    "utf8",
  );
}

async function main() {
  const {
    getInstalledSkillsWithMeta,
    refreshSkillMetadata,
    refreshSingleSkillMetadata,
  } = loadModule();

  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-fallback-"));
    try {
      writeSkill(tmp, "excalidraw", "Generate diagrams");

      const metas = await getInstalledSkillsWithMeta(
        makeUri(tmp),
        makeUri(tmp),
      );
      assert.strictEqual(metas.length, 1);
      assert.strictEqual(metas[0].name, "excalidraw");
      assert.strictEqual(metas[0].source, "local");
      assert.strictEqual(metas[0].relativePath, "excalidraw");
      console.log(
        "PASS metadata-less installed skills fallback to local source",
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-strict-scan-"));
    try {
      writeSkill(tmp, "local", "Local skill");
      const strict = { strict: true };
      const local = await getInstalledSkillsWithMeta(
        makeUri(tmp),
        makeUri(tmp),
        strict,
      );
      assert.strictEqual(local.length, 1);
      assert.strictEqual(local[0].source, "local");
      const missing = await getInstalledSkillsWithMeta(
        makeUri(tmp),
        makeUri(path.join(tmp, "missing")),
        strict,
      );
      assert.strictEqual(missing.length, 0);

      fs.writeFileSync(path.join(tmp, "local", ".skill-meta.json"), "{bad");
      await assert.rejects(
        getInstalledSkillsWithMeta(makeUri(tmp), makeUri(tmp), strict),
        /JSON|property name|Unexpected/i,
      );
      const fallback = await getInstalledSkillsWithMeta(
        makeUri(tmp),
        makeUri(tmp),
      );
      assert.strictEqual(fallback[0].source, "local");

      class DeniedFs extends FsBackedFs {
        async readDirectory(uri) {
          if (uri.fsPath === path.join(tmp, "local")) {
            const error = new Error("access denied");
            error.code = "EACCES";
            throw error;
          }
          return super.readDirectory(uri);
        }
      }
      const denied = loadModule(new DeniedFs());
      await assert.rejects(
        denied.getInstalledSkillsWithMeta(makeUri(tmp), makeUri(tmp), strict),
        /access denied/,
      );
      console.log("PASS strict installed-skill scan reports errors and permits absent files");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-refresh-"));
    try {
      writeSkill(tmp, "expense-report", "Create expense reports");

      const updatedCount = await refreshSkillMetadata(
        makeUri(tmp),
        makeUri(tmp),
      );
      assert.strictEqual(updatedCount, 1);

      const meta = JSON.parse(
        fs.readFileSync(
          path.join(tmp, "expense-report", ".skill-meta.json"),
          "utf8",
        ),
      );
      assert.strictEqual(meta.source, "local");
      assert.strictEqual(meta.name, "expense-report");
      console.log("PASS refreshSkillMetadata creates local source metadata");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-refresh-managed-"));
    try {
      const configured = path.join(tmp, "configured");
      const detected = path.join(tmp, "detected");
      writeSkill(configured, "managed-demo", "Managed skill");
      writeSkill(detected, "hand-written", "Committed by hand");
      const rootOf = (rootPath, extra = {}) => ({
        scope: "workspace",
        label: "Workspace Skills",
        rootUri: makeUri(rootPath),
        rootPath,
        displayPath: rootPath,
        isManaged: true,
        isReadOnly: false,
        ...extra,
      });
      const withRoots = loadModule(new FsBackedFs(), [], [
        rootOf(configured),
        rootOf(detected, { isAutoDetected: true }),
      ]);

      const updatedCount = await withRoots.refreshManagedSkillMetadata(
        makeUri(tmp),
      );
      assert.strictEqual(updatedCount, 1);
      assert.ok(
        fs.existsSync(path.join(configured, "managed-demo", ".skill-meta.json")),
      );
      // 設定していないフォルダのスキルへは、メタデータを書き込まない
      assert.ok(
        !fs.existsSync(path.join(detected, "hand-written", ".skill-meta.json")),
      );
      console.log("PASS metadata refresh leaves auto-detected roots untouched");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-refresh-errors-"));
    try {
      writeSkill(tmp, "demo", "New description");
      const metaPath = path.join(tmp, "demo", ".skill-meta.json");
      const skillPath = path.join(tmp, "demo", "SKILL.md");
      const original = JSON.stringify({
        name: "demo",
        source: "remote",
        remotePath: "skills/demo",
        description: "Old description",
        whenToUse: "Keep this",
        customWhenToUse: "User edit",
        categories: [],
        installedAt: "",
      });
      const refresh = async (module) => {
        let failures = 0;
        const updated = await module.refreshSkillMetadata(
          makeUri(tmp),
          makeUri(tmp),
          { onFailure: () => failures++ },
        );
        assert.strictEqual(updated, 0);
        assert.strictEqual(failures, 1);
      };

      fs.writeFileSync(metaPath, "{bad");
      await refresh(loadModule());
      assert.strictEqual(fs.readFileSync(metaPath, "utf8"), "{bad");

      fs.writeFileSync(metaPath, original);
      class DeniedMetadata extends FsBackedFs {
        async readFile(uri) {
          if (uri.fsPath === metaPath) {
            throw Object.assign(new Error("denied"), { code: "EACCES" });
          }
          return super.readFile(uri);
        }
      }
      await refresh(loadModule(new DeniedMetadata()));
      assert.strictEqual(fs.readFileSync(metaPath, "utf8"), original);

      class DeniedSkill extends FsBackedFs {
        async readFile(uri) {
          if (uri.fsPath === skillPath) {
            throw Object.assign(new Error("denied"), { code: "EACCES" });
          }
          return super.readFile(uri);
        }
      }
      await refresh(loadModule(new DeniedSkill()));
      assert.strictEqual(fs.readFileSync(metaPath, "utf8"), original);

      const changed = JSON.stringify({
        ...JSON.parse(original),
        customWhenToUse: "Changed during refresh",
      });
      class ConcurrentEdit extends FsBackedFs {
        edited = false;
        async readFile(uri) {
          const value = await super.readFile(uri);
          if (uri.fsPath === metaPath && !this.edited) {
            this.edited = true;
            fs.writeFileSync(metaPath, changed);
          }
          return value;
        }
      }
      await refresh(loadModule(new ConcurrentEdit()));
      assert.strictEqual(fs.readFileSync(metaPath, "utf8"), changed);

      fs.writeFileSync(metaPath, original);
      await refresh(
        loadModule(new FsBackedFs(), [{ isDirty: true, uri: makeUri(metaPath) }]),
      );
      assert.strictEqual(fs.readFileSync(metaPath, "utf8"), original);

      fs.unlinkSync(metaPath);
      await refresh(loadModule(new DeniedSkill()));
      assert.strictEqual(fs.existsSync(metaPath), false);
      console.log("PASS metadata refresh preserves unreadable, invalid, dirty and concurrently edited files");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-invocation-"));
    try {
      const skillMd = (name, extra) =>
        ["---", `name: ${name}`, "description: demo", ...extra, "---", "", "# x"].join(
          "\n",
        );
      const write = (name, extra, meta) => {
        const dir = path.join(tmp, name);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "SKILL.md"), skillMd(name, extra));
        if (meta) {
          fs.writeFileSync(
            path.join(dir, ".skill-meta.json"),
            JSON.stringify({
              name,
              source: "local",
              description: "demo",
              categories: [],
              installedAt: "",
              ...meta,
            }),
          );
        }
      };
      write("plain", []);
      write("manual", ["disable-model-invocation: true"]);
      write("hidden", ["user-invocable: false"]);
      // SKILL.md が正本。保存済みの古い値には従わない
      write("stale-meta", [], { invocation: "explicitOnly" });
      write("fresh-meta", ["disable-model-invocation: true"], {});

      const metas = await getInstalledSkillsWithMeta(
        makeUri(tmp),
        makeUri(tmp),
      );
      const byName = Object.fromEntries(metas.map((meta) => [meta.name, meta]));
      assert.strictEqual(byName["plain"].invocation, undefined);
      assert.ok(!("invocation" in byName["plain"]));
      assert.strictEqual(byName["manual"].invocation, "explicitOnly");
      assert.strictEqual(byName["hidden"].invocation, "modelOnly");
      assert.ok(!("invocation" in byName["stale-meta"]));
      assert.strictEqual(byName["fresh-meta"].invocation, "explicitOnly");

      // frontmatter が変わったら refreshSingleSkillMetadata が変更ありと返し、meta を揃える
      const staleDir = path.join(tmp, "stale-meta");
      assert.strictEqual(
        await refreshSingleSkillMetadata(
          makeUri(path.join(staleDir, "SKILL.md")),
          makeUri(tmp),
        ),
        true,
      );
      const refreshed = JSON.parse(
        fs.readFileSync(path.join(staleDir, ".skill-meta.json"), "utf8"),
      );
      assert.ok(!("invocation" in refreshed));
      const freshDir = path.join(tmp, "fresh-meta");
      await refreshSingleSkillMetadata(
        makeUri(path.join(freshDir, "SKILL.md")),
        makeUri(tmp),
      );
      assert.strictEqual(
        JSON.parse(
          fs.readFileSync(path.join(freshDir, ".skill-meta.json"), "utf8"),
        ).invocation,
        "explicitOnly",
      );
      console.log("PASS installed skills read their invocation mode from SKILL.md");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  console.log("\nSkill installer metadata fallback tests passed.");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
