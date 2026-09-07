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

function loadModule() {
  const moduleExports = {};
  const vscodeStub = {
    FileType,
    Uri: {
      file: makeUri,
      joinPath,
    },
    workspace: {
      fs: new FsBackedFs(),
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
          getManagedSkillRoots: async () => [],
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
  const { getInstalledSkillsWithMeta, refreshSkillMetadata } = loadModule();

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

  console.log("\nSkill installer metadata fallback tests passed.");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
