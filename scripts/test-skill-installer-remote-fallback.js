#!/usr/bin/env node

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

function loadModule(options = {}) {
  const moduleExports = {};
  const errorMessages = options.errorMessages || [];
  const executedCommands = options.executedCommands || [];
  const openedUrls = options.openedUrls || [];
  const skillIndex = options.skillIndex || { skills: [], sources: [] };
  const vscodeStub = {
    FileType,
    version: "test",
    extensions: {
      getExtension() {
        return { packageJSON: { version: "test" } };
      },
    },
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
      async showErrorMessage(...args) {
        errorMessages.push(args);
        return options.errorMessageChoice;
      },
      async showWarningMessage() {
        return undefined;
      },
      async showInformationMessage() {
        return undefined;
      },
    },
    commands: {
      async executeCommand(...args) {
        executedCommands.push(args);
        return undefined;
      },
    },
    env: {
      async openExternal(uri) {
        openedUrls.push(uri.toString());
        return true;
      },
    },
  };

  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    Buffer,
    console,
    process,
    URL,
    URLSearchParams,
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
          loadSkillIndex: async () => skillIndex,
          getSourceBranch: async (source) => source.branch || "main",
        };
      }
      if (request === "./i18n") {
        return {
          isJapanese: () => false,
          messages: {
            skillDownloadNotFoundNoAuth: (name) =>
              `Skill "${name}" was not found. Private repositories require GitHub authentication.`,
            skillDownloadNotFoundWithAuth: (name) =>
              `Skill "${name}" was not found. GitHub authentication may not have Contents: read access.`,
            openSettings: () => "Open Settings",
            actionUpdateIndex: () => "Update Index",
            actionReportBug: () => "Report Bug",
            actionRetryInstall: () => "Retry Install",
            actionRemoveSkill: () => "Remove",
            installIncomplete: (name) =>
              `Skill "${name}" was not installed completely.`,
            installPartial: (name) =>
              `Some files for skill "${name}" could not be downloaded.`,
            actionClearStoredGitHubToken: () => "Clear Stored GitHub Token",
          },
        };
      }
      if (request === "./githubAuth") {
        return {
          getGitHubToken: async () => options.token,
          hasStoredGitHubToken: async () => options.hasStoredToken === true,
        };
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
            if (url.startsWith("https://raw.githubusercontent.com/")) {
              return sandbox.fetch(url);
            }

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
      return requireSrcOrNodeModule(request);
    },
  };

  vm.runInNewContext(transpiled.outputText, sandbox, {
    filename: sourcePath,
  });

  return sandbox.module.exports;
}

async function main() {
  const { installSkill, isFallbackSkillMd } = loadModule();
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

    const foundryResult = await installSkill(
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

    assert.strictEqual(
      foundryResult.status,
      "partial",
      "recovering only SKILL.md must be reported as a partial install",
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

    await assert.rejects(
      installSkill(
        {
          name: "unresolvable-skill",
          source: "unknown-source",
          path: "",
          categories: [],
          description: "A skill whose download target cannot be resolved",
        },
        makeUri(tmp),
        {},
      ),
      (error) => error.name === "SkillInstallIncompleteError",
      "a placeholder-only install must not be reported as success",
    );

    const unresolvableMeta = JSON.parse(
      fs.readFileSync(
        path.join(tmp, "unresolvable-skill", ".skill-meta.json"),
        "utf8",
      ),
    );
    assert.strictEqual(
      unresolvableMeta.incomplete,
      true,
      "metadata must record that only placeholder content was written",
    );

    console.log(
      "PASS installSkill throws when only placeholder content exists",
    );

    const silentErrors = [];
    const { installSkill: silentInstall } = loadModule({
      errorMessages: silentErrors,
    });

    await assert.rejects(
      silentInstall(
        {
          name: "bulk-unresolvable-skill",
          source: "unknown-source",
          path: "",
          categories: [],
          description: "A skill installed as part of a bulk operation",
        },
        makeUri(tmp),
        {},
        undefined,
        { interactive: false },
      ),
      (error) => error.name === "SkillInstallIncompleteError",
    );

    assert.strictEqual(
      silentErrors.length,
      0,
      "bulk installs must not raise a per-skill dialog",
    );

    console.log("PASS installSkill stays silent during bulk installs");

    assert.strictEqual(
      isFallbackSkillMd(
        "# demo\n\nA short description.\n\nSource: demo-source\n",
        "demo-source",
      ),
      true,
    );

    const longPlaceholder = `# demo\n\n${"A very long placeholder description. ".repeat(
      10,
    )}\n\nSource: demo-source\n`;
    assert.ok(longPlaceholder.length > 100);
    assert.strictEqual(
      isFallbackSkillMd(longPlaceholder, "demo-source"),
      true,
      "placeholders larger than 100 bytes must still be detected",
    );

    assert.strictEqual(
      isFallbackSkillMd(
        `---\nname: demo\n---\n\n# demo\n\nReal content that is long enough to pass the length guard.\n`,
        "demo-source",
      ),
      false,
    );

    assert.strictEqual(
      isFallbackSkillMd(
        `---\nname: demo\ndescription: d\n---\n`,
        "demo-source",
      ),
      false,
      "a real SKILL.md with frontmatter must never be treated as a placeholder",
    );

    console.log("PASS isFallbackSkillMd detects legacy placeholder installs");

    const privateSourceIndex = {
      skills: [],
      sources: [
        {
          id: "private-source",
          url: "https://github.com/owner/private-repo",
          branch: "main",
        },
      ],
    };
    const noAuthErrorMessages = [];
    const noAuthCommands = [];
    const { installSkill: installPrivateSkillWithoutAuth } = loadModule({
      skillIndex: privateSourceIndex,
      errorMessageChoice: "Open Settings",
      errorMessages: noAuthErrorMessages,
      executedCommands: noAuthCommands,
    });

    await assert.rejects(
      installPrivateSkillWithoutAuth(
        {
          name: "private-demo",
          source: "private-source",
          path: "skills/private-demo",
          categories: [],
          description: "Private demo skill",
        },
        makeUri(tmp),
        {},
      ),
      /Skill not found: private-demo/,
    );
    assert.strictEqual(noAuthErrorMessages.length, 1);
    assert.match(
      noAuthErrorMessages[0][0],
      /Private repositories require GitHub authentication/,
    );
    assert.deepStrictEqual(noAuthCommands[0], [
      "workbench.action.openSettings",
      "skillNinja.githubToken",
    ]);
    assert.strictEqual(
      fs.existsSync(path.join(tmp, "private-demo")),
      false,
      "failed private skill directory should be removed",
    );
    console.log(
      "PASS unauthenticated private 404 opens GitHub authentication settings",
    );

    const storedTokenErrorMessages = [];
    const storedTokenCommands = [];
    const { installSkill: installPrivateSkillWithStoredToken } = loadModule({
      skillIndex: privateSourceIndex,
      token: "stale-token-must-not-leak",
      hasStoredToken: true,
      errorMessageChoice: "Clear Stored GitHub Token",
      errorMessages: storedTokenErrorMessages,
      executedCommands: storedTokenCommands,
    });

    await assert.rejects(
      installPrivateSkillWithStoredToken(
        {
          name: "private-demo",
          source: "private-source",
          path: "skills/private-demo",
          categories: [],
          description: "Private demo skill",
        },
        makeUri(tmp),
        {},
      ),
      /Skill not found: private-demo/,
    );
    assert.ok(
      storedTokenErrorMessages[0].includes("Clear Stored GitHub Token"),
    );
    assert.deepStrictEqual(storedTokenCommands[0], [
      "skillNinja.clearGitHubToken",
    ]);
    assert.strictEqual(
      storedTokenErrorMessages[0]
        .join(" ")
        .includes("stale-token-must-not-leak"),
      false,
    );
    console.log("PASS stored private token 404 offers SecretStorage recovery");

    const authErrorMessages = [];
    const openedUrls = [];
    const { installSkill: installPrivateSkillWithAuth } = loadModule({
      skillIndex: privateSourceIndex,
      token: "test-token-must-not-leak",
      errorMessageChoice: "Report Bug",
      errorMessages: authErrorMessages,
      openedUrls,
    });

    await assert.rejects(
      installPrivateSkillWithAuth(
        {
          name: "private-demo",
          source: "private-source",
          path: "skills/private-demo",
          categories: [],
          description: "Private demo skill",
        },
        makeUri(tmp),
        {},
      ),
      /Skill not found: private-demo/,
    );
    assert.match(authErrorMessages[0][0], /Contents: read access/);
    assert.strictEqual(openedUrls.length, 1);
    const reportUrl = new URL(openedUrls[0]);
    const reportBody = reportUrl.searchParams.get("body") || "";
    assert.match(reportBody, /GitHub Authentication: configured/);
    assert.match(reportBody, /Contents: read access/);
    assert.strictEqual(reportBody.includes("test-token-must-not-leak"), false);
    console.log(
      "PASS authenticated private 404 reports access diagnostics without token leakage",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
