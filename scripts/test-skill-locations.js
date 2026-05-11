/**
 * Skill location resolver regression tests.
 * Run after compile: node scripts/test-skill-locations.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "src", "skillLocations.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

const vscodeStub = {
  Uri: {
    file(filePath) {
      return {
        fsPath: path.resolve(filePath),
        path: path.resolve(filePath).replace(/\\/g, "/"),
      };
    },
    parse(value) {
      const url = new URL(value);
      return {
        fsPath: url.pathname.replace(/^\//, ""),
        path: url.pathname,
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
    getConfiguration() {
      return {
        get() {
          return undefined;
        },
      };
    },
    fs: {
      stat() {
        throw new Error("not implemented");
      },
    },
  },
  extensions: {
    getExtension() {
      return undefined;
    },
  },
  env: {
    appRoot: path.join(__dirname, "..", "fake-app-root"),
  },
};

const moduleExports = {};
const sandbox = {
  exports: moduleExports,
  module: { exports: moduleExports },
  process,
  require(request) {
    if (request === "vscode") {
      return vscodeStub;
    }
    if (request === "./toolDetector") {
      return {
        resolveOutputFormat: async () => ({
          format: "full",
          instructionFile: "AGENTS.md",
        }),
      };
    }
    return require(request);
  },
};

vm.runInNewContext(transpiled.outputText, sandbox, {
  filename: sourcePath,
});

const {
  computeRelativeDirectoryPath,
  parseAgentSkillLocationConfig,
  pathToDisplayPath,
  resolveConfiguredPath,
  resolveUserGlobalInstructionPath,
} = sandbox.module.exports;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("parses string and object agent skill location entries", () => {
  const parsed = JSON.parse(
    JSON.stringify(
      parseAgentSkillLocationConfig([
        "~/.copilot/skills",
        { path: "./.github/skills", enabled: true },
        { path: "./disabled", enabled: false },
      ]),
    ),
  );

  assert.deepStrictEqual(parsed, [
    { path: "~/.copilot/skills", enabled: true },
    { path: "./.github/skills", enabled: true },
    { path: "./disabled", enabled: false },
  ]);
});

test("parses object-shaped agent skill location maps", () => {
  const parsed = JSON.parse(
    JSON.stringify(
      parseAgentSkillLocationConfig({
        "~/.copilot/skills": true,
        "~/.claude/skills": { enabled: true },
        "~/.ignored/skills": false,
      }),
    ),
  );

  assert.deepStrictEqual(parsed, [
    { path: "~/.copilot/skills", enabled: true },
    { path: "~/.claude/skills", enabled: true },
  ]);
});

test("resolves home-relative and workspace-relative skill locations", () => {
  const workspacePath = path.resolve(path.sep, "workspace", "project");

  assert.strictEqual(
    resolveConfiguredPath(
      "~/.copilot/skills",
      workspacePath,
      path.join(path.sep, "home", "tester"),
    ),
    path.normalize(path.join(path.sep, "home", "tester", ".copilot", "skills")),
  );
  assert.strictEqual(
    resolveConfiguredPath(
      ".github/skills",
      workspacePath,
      path.join(path.sep, "home", "tester"),
    ),
    path.resolve(workspacePath, ".github", "skills"),
  );
});

test("computes instruction-relative links to skill roots", () => {
  assert.strictEqual(
    computeRelativeDirectoryPath(
      "/home/tester/.copilot/instructions.md",
      "/home/tester/.copilot/skills",
    ),
    "skills",
  );
  assert.strictEqual(
    computeRelativeDirectoryPath(
      "/workspace/project/.github/instructions/skills.md",
      "/workspace/project/.github/skills",
    ),
    "../skills",
  );
});

test("chooses tool-compatible user/global instruction files", () => {
  assert.strictEqual(
    resolveUserGlobalInstructionPath(
      path.normalize("/home/tester/.copilot/skills"),
    ),
    path.normalize("/home/tester/.copilot/instructions.md"),
  );
  assert.strictEqual(
    resolveUserGlobalInstructionPath(
      path.normalize("/home/tester/.claude/skills"),
    ),
    path.normalize("/home/tester/.claude/CLAUDE.md"),
  );
  assert.strictEqual(
    resolveUserGlobalInstructionPath(
      path.normalize("/home/tester/.agents/skills"),
    ),
    path.normalize("/home/tester/.agents/AGENTS.md"),
  );
});

test("renders home-relative display paths with a tilde prefix", () => {
  assert.strictEqual(
    pathToDisplayPath("/home/tester/.copilot/skills", "/home/tester"),
    "~/.copilot/skills",
  );
});

console.log("\nSkill location tests passed.");
