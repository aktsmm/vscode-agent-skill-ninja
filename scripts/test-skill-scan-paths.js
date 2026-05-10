/**
 * Skill scan path boundary tests.
 * Run after compile: node scripts/test-skill-scan-paths.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "src", "skillScanPaths.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

const sandbox = {
  exports: {},
  module: { exports: {} },
  require,
};

vm.runInNewContext(transpiled.outputText, sandbox, {
  filename: sourcePath,
});

const {
  getSkillsDirectorySearchPattern,
  isPathInSkillsDirectory,
  normalizeWorkspacePath,
} = sandbox.exports;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("normalizes Windows separators", () => {
  assert.strictEqual(
    normalizeWorkspacePath(".github\\skills\\foo\\SKILL.md"),
    ".github/skills/foo/SKILL.md",
  );
});

test("builds a skills-directory-only search pattern", () => {
  assert.strictEqual(
    getSkillsDirectorySearchPattern(".github\\skills"),
    ".github/skills/**/SKILL.md",
  );
});

test("defaults empty skills directory to .github/skills", () => {
  assert.strictEqual(
    getSkillsDirectorySearchPattern(""),
    ".github/skills/**/SKILL.md",
  );
});

test("includes SKILL.md files under the configured skills directory", () => {
  assert.strictEqual(
    isPathInSkillsDirectory(".github/skills/foo/SKILL.md", ".github/skills"),
    true,
  );
});

test("excludes VS Code test archive skills outside the skills directory", () => {
  assert.strictEqual(
    isPathInSkillsDirectory(
      ".vscode-test/vscode-win32-x64/resources/app/extensions/copilot/assets/prompts/skills/init/SKILL.md",
      ".github/skills",
    ),
    false,
  );
});

test("excludes arbitrary workspace SKILL.md files by default", () => {
  assert.strictEqual(
    isPathInSkillsDirectory("some-random-folder/SKILL.md", ".github/skills"),
    false,
  );
});

test("honors a custom configured skills directory", () => {
  assert.strictEqual(
    isPathInSkillsDirectory("custom-skills/foo/SKILL.md", "custom-skills"),
    true,
  );
  assert.strictEqual(
    isPathInSkillsDirectory(".github/skills/foo/SKILL.md", "custom-skills"),
    false,
  );
});

console.log("\nSkill scan path tests passed.");
