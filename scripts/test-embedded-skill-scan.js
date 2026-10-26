/**
 * Embedded skill scan test: a SKILL.md inside another skill's folder is marked
 * as embedded and never reads as "unregistered".
 * Run: node scripts/test-embedded-skill-scan.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");
const { loadSrcModule } = require("./load-src-module");

const sourcePath = path.join(__dirname, "..", "src", "localSkillScanner.ts");
const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

async function scanFolder(tmp) {
  const uri = (fsPath) => ({ fsPath });
  const root = {
    rootPath: tmp,
    rootUri: uri(tmp),
    displayPath: "skills",
    scope: "workspace",
    isManaged: true,
    isReadOnly: false,
  };
  const exports = {};
  const sandbox = {
    exports,
    module: { exports },
    Buffer,
    Date,
    JSON,
    console: { ...console, warn() {} },
    require(request) {
      if (request === "vscode") {
        return {
          FileType: { File: 1, Directory: 2 },
          Uri: {
            file: uri,
            joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)),
          },
          workspace: {
            getConfiguration: () => ({ get: () => undefined }),
            fs: {
              async readDirectory(target) {
                return fs
                  .readdirSync(target.fsPath, { withFileTypes: true })
                  .map((entry) => [entry.name, entry.isDirectory() ? 2 : 1]);
              },
              async readFile(target) {
                return fs.readFileSync(target.fsPath);
              },
              async stat(target) {
                return fs.statSync(target.fsPath);
              },
            },
          },
        };
      }
      if (request === "./gitignoreManager") {
        return {};
      }
      if (request === "./instructionManager") {
        return {
          SHARED_MARKER_START: "<!-- agent-ninja-START -->",
          SHARED_MARKER_END: "<!-- agent-ninja-END -->",
          updateInstructionFileForRoot: async () => undefined,
        };
      }
      if (request === "./skillInstaller") {
        return {
          enrichSkillMeta: (meta, relativePath) => ({
            ...meta,
            relativePath: relativePath ?? meta.relativePath,
          }),
          isFallbackSkillMd: () => false,
        };
      }
      if (request === "./installedSkillIndex") {
        return { needsRepair: () => false };
      }
      if (request === "./skillIndex") {
        return {};
      }
      if (request === "./skillLocations") {
        return {
          getManagedSkillRoots: async () => [root],
          getExtensionSkillRoots: async () => [],
          getBuiltInSkillRoots: async () => [],
          normalizeFileSystemPath: (value) =>
            String(value).replace(/\\/g, "/").toLowerCase(),
        };
      }
      if (request === "./skillInvocation" || request === "./embeddedSkills") {
        return loadSrcModule(request);
      }
      return require(request);
    },
  };
  vm.runInNewContext(transpiled.outputText, sandbox, { filename: sourcePath });
  const skills = await sandbox.module.exports.scanVisibleSkills(uri(tmp));
  return Object.fromEntries(skills.map((skill) => [skill.name, skill]));
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-scan-embedded-"));
  try {
    const writeSkill = (relativePath, name) => {
      const dir = path.join(tmp, ...relativePath.split("/"));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "SKILL.md"),
        ["---", `name: ${name}`, "description: demo", "---", ""].join("\n"),
      );
    };
    writeSkill("pack", "pack");
    writeSkill("pack/assets/workspace-skills/inbox", "inbox");
    writeSkill("pack/assets/workspace-skills/inbox/deep/leaf", "leaf");
    writeSkill("plain", "plain");
    writeSkill("plain-extra", "plain-extra");

    const skills = await scanFolder(tmp);

    assert.strictEqual(skills["pack"].embeddedParentPath, undefined);
    assert.strictEqual(skills["pack"].registrationState, "unregistered");
    assert.strictEqual(skills["plain"].embeddedParentPath, undefined);
    assert.strictEqual(skills["plain-extra"].embeddedParentPath, undefined);

    assert.strictEqual(skills["inbox"].embeddedParentPath, "pack");
    assert.strictEqual(
      skills["leaf"].embeddedParentPath,
      "pack/assets/workspace-skills/inbox",
    );
    for (const name of ["inbox", "leaf"]) {
      assert.strictEqual(skills[name].registrationState, "registered", name);
      assert.strictEqual(skills[name].isRegistered, true, name);
      assert.match(skills[name].registrationReason, /Embedded in the parent/);
    }
    console.log("PASS scan marks embedded skills and keeps others unchanged");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error("FAIL embedded skill scan");
  console.error(error);
  process.exitCode = 1;
});
