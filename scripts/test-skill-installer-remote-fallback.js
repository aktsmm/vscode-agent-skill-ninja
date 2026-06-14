#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

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
  async createDirectory(uri) {
    fs.mkdirSync(uri.fsPath, { recursive: true });
  }

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

  async readFile(uri) {
    return fs.readFileSync(uri.fsPath);
  }

  async writeFile(uri, content) {
    fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
    fs.writeFileSync(uri.fsPath, content);
  }

  async delete(uri, options = {}) {
    fs.rmSync(uri.fsPath, {
      recursive: Boolean(options.recursive),
      force: true,
    });
  }
}

function createResponse({
  ok = true,
  status = 200,
  statusText = "OK",
  json,
  text,
}) {
  return {
    ok,
    status,
    statusText,
    async json() {
      return json;
    },
    async text() {
      return text || "";
    },
  };
}

function loadModule() {
  const moduleExports = {};
  const vscodeStub = {
    FileType,
    Uri: {
      file: makeUri,
      joinPath,
      parse(value) {
        return { toString: () => value };
      },
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
    window: {
      async showErrorMessage() {
        return undefined;
      },
      async showWarningMessage() {
        return undefined;
      },
      async showInformationMessage() {
        return undefined;
      },
    },
    commands: {
      async executeCommand() {
        return undefined;
      },
    },
    env: {
      async openExternal() {
        return false;
      },
    },
  };

  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    Buffer,
    console,
    process,
    fetch: async (url) => {
      if (
        url ===
        "https://raw.githubusercontent.com/aktsmm/Agent-Skills/master/local-media-transcription/SKILL.md"
      ) {
        return createResponse({
          text: [
            "---",
            "name: local-media-transcription",
            'description: "Transcribe local media"',
            "---",
            "",
            "# Local Media Transcription",
            "",
            "## When to Use",
            "- transcription",
          ].join("\n"),
        });
      }

      if (
        url ===
        "https://raw.githubusercontent.com/aktsmm/Agent-Skills/master/local-media-transcription/references/transcription-workflow.md"
      ) {
        return createResponse({
          text: "# Workflow\n\nReference details.",
        });
      }

      if (
        url ===
        "https://raw.githubusercontent.com/MicrosoftDocs/Agent-Skills/main/skills/microsoft-foundry/SKILL.md"
      ) {
        return createResponse({
          text: [
            "---",
            "name: microsoft-foundry",
            "description: Expert knowledge for Microsoft Foundry",
            "---",
            "",
            "# Microsoft Foundry",
            "",
            "Full upstream skill content.",
          ].join("\n"),
        });
      }

      return createResponse({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });
    },
    require(request) {
      if (request === "vscode") {
        return vscodeStub;
      }
      if (request === "./skillIndex") {
        return {
          loadSkillIndex: async () => ({ skills: [], sources: [] }),
          getSourceBranch: async () => {
            throw new Error("getSourceBranch should not be used in this test");
          },
        };
      }
      if (request === "./i18n") {
        return { isJapanese: () => false };
      }
      if (request === "./githubAuth") {
        return { getGitHubToken: async () => undefined };
      }
      if (request === "./installedSkillIndex") {
        return { normalizeInstalledSkillSource: (source) => source };
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
          fetchGitHubWithOptionalAuthRetry: async (url) => {
            if (
              url ===
              "https://api.github.com/repos/aktsmm/Agent-Skills/contents/local-media-transcription?ref=master"
            ) {
              return createResponse({
                json: [
                  {
                    name: "SKILL.md",
                    type: "file",
                    download_url:
                      "https://raw.githubusercontent.com/aktsmm/Agent-Skills/master/local-media-transcription/SKILL.md",
                  },
                  {
                    name: "references",
                    type: "dir",
                    download_url: null,
                  },
                ],
              });
            }

            if (
              url ===
              "https://api.github.com/repos/MicrosoftDocs/Agent-Skills/contents/skills/microsoft-foundry?ref=main"
            ) {
              return createResponse({
                ok: false,
                status: 403,
                statusText: "Forbidden",
              });
            }

            if (
              url ===
              "https://api.github.com/repos/aktsmm/Agent-Skills/contents/local-media-transcription/references?ref=master"
            ) {
              return createResponse({
                json: [
                  {
                    name: "transcription-workflow.md",
                    type: "file",
                    download_url:
                      "https://raw.githubusercontent.com/aktsmm/Agent-Skills/master/local-media-transcription/references/transcription-workflow.md",
                  },
                ],
              });
            }

            return createResponse({
              ok: false,
              status: 404,
              statusText: "Not Found",
            });
          },
        };
      }
      if (request === "./githubDirectoryTraversal") {
        return {
          partitionGitHubDirectoryEntries(entries) {
            return {
              files: entries.filter(
                (entry) => entry.type === "file" && entry.download_url,
              ),
              directoriesToTraverse: entries.filter(
                (entry) => entry.type === "dir",
              ),
            };
          },
          resolveSymlinkTargetPath(targetPath) {
            return targetPath;
          },
        };
      }
      return require(request);
    },
  };

  vm.runInNewContext(transpiled.outputText, sandbox, {
    filename: sourcePath,
  });

  return sandbox.module.exports;
}

async function main() {
  const { installSkill } = loadModule();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-remote-fallback-"));

  try {
    await installSkill(
      {
        name: "local-media-transcription",
        source: "aktsmm/Agent-Skills",
        path: "local-media-transcription",
        categories: [],
        description: "Transcribe local media",
        url: "https://github.com/aktsmm/Agent-Skills/tree/master/local-media-transcription",
        rawUrl:
          "https://raw.githubusercontent.com/aktsmm/Agent-Skills/master/local-media-transcription/SKILL.md",
      },
      makeUri(tmp),
      {},
    );

    const skillMdPath = path.join(tmp, "local-media-transcription", "SKILL.md");
    const referencePath = path.join(
      tmp,
      "local-media-transcription",
      "references",
      "transcription-workflow.md",
    );
    assert.ok(fs.existsSync(skillMdPath), "SKILL.md should be downloaded");
    assert.ok(
      fs.existsSync(referencePath),
      "nested reference file should be downloaded",
    );

    const skillMd = fs.readFileSync(skillMdPath, "utf8");
    assert.ok(
      skillMd.includes("# Local Media Transcription"),
      "downloaded SKILL.md content should be preserved",
    );

    console.log("PASS installSkill resolves rawUrl/url when source is missing");

    await installSkill(
      {
        name: "microsoft-foundry",
        source: "MicrosoftDocs/Agent-Skills",
        path: "skills/microsoft-foundry",
        categories: [],
        description: "Expert knowledge for Microsoft Foundry",
        url: "https://github.com/MicrosoftDocs/Agent-Skills/tree/main/skills/microsoft-foundry",
        rawUrl:
          "https://raw.githubusercontent.com/MicrosoftDocs/Agent-Skills/main/skills/microsoft-foundry/SKILL.md",
      },
      makeUri(tmp),
      {},
    );

    const foundrySkillMdPath = path.join(tmp, "microsoft-foundry", "SKILL.md");
    assert.ok(
      fs.existsSync(foundrySkillMdPath),
      "SKILL.md should be recovered from the raw URL when contents API fails",
    );

    const foundrySkillMd = fs.readFileSync(foundrySkillMdPath, "utf8");
    assert.ok(
      foundrySkillMd.includes("# Microsoft Foundry"),
      "raw SKILL.md content should be preserved after contents API failure",
    );
    assert.strictEqual(
      foundrySkillMd.includes("Source: MicrosoftDocs/Agent-Skills"),
      false,
      "fallback template content should not overwrite recovered raw content",
    );

    const foundryMetaPath = path.join(
      tmp,
      "microsoft-foundry",
      ".skill-meta.json",
    );
    assert.ok(
      fs.existsSync(foundryMetaPath),
      "metadata should be written after primary SKILL.md recovery",
    );
    const foundryMeta = JSON.parse(fs.readFileSync(foundryMetaPath, "utf8"));
    assert.strictEqual(foundryMeta.name, "microsoft-foundry");
    assert.strictEqual(foundryMeta.source, "MicrosoftDocs/Agent-Skills");
    assert.strictEqual(foundryMeta.remotePath, "skills/microsoft-foundry");

    console.log(
      "PASS installSkill recovers primary SKILL.md when directory listing fails",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
