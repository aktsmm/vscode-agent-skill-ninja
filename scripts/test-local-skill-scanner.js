/**
 * Local skill scanner regression tests.
 * Run: node scripts/test-local-skill-scanner.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "src", "localSkillScanner.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

function loadModule() {
  const moduleExports = {};
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    Buffer,
    require(request) {
      if (request === "vscode") {
        return {
          workspace: {
            fs: {},
          },
          Uri: {
            joinPath() {
              return {};
            },
          },
        };
      }
      if (request === "./instructionManager") {
        return {
          SHARED_MARKER_START: "<!-- agent-ninja-START -->",
          SHARED_MARKER_END: "<!-- agent-ninja-END -->",
          updateInstructionFileForRoot: async () => undefined,
        };
      }
      if (request === "./skillInstaller") {
        return {};
      }
      if (request === "./skillIndex") {
        return {};
      }
      if (request === "./skillLocations") {
        return {
          normalizeFileSystemPath(value) {
            return String(value).replace(/\\/g, "/").toLowerCase();
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

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const { extractManagedSkillMarkerContent, isSkillReferencedInManagedBlock } =
  loadModule();

test("extractManagedSkillMarkerContent prefers shared coexistence markers", () => {
  const text = [
    "# AGENTS",
    "<!-- agent-ninja-START -->",
    "- [Chrome DevTools](.github/skills/chrome-devtools/SKILL.md)",
    "<!-- agent-ninja-END -->",
  ].join("\n");

  const content = extractManagedSkillMarkerContent(text);
  assert.ok(content.includes("chrome-devtools/SKILL.md"));
  assert.ok(content.includes("agent-ninja-START"));
});

test("extractManagedSkillMarkerContent falls back to legacy skill markers", () => {
  const text = [
    "# AGENTS",
    "<!-- skill-ninja-START -->",
    "- [Chrome DevTools](.github/skills/chrome-devtools/SKILL.md)",
    "<!-- skill-ninja-END -->",
  ].join("\n");

  const content = extractManagedSkillMarkerContent(text);
  assert.ok(content.includes("chrome-devtools/SKILL.md"));
  assert.ok(content.includes("skill-ninja-START"));
});

test("extractManagedSkillMarkerContent returns undefined without a managed block", () => {
  assert.strictEqual(
    extractManagedSkillMarkerContent("# AGENTS\n- no managed block"),
    undefined,
  );
});

test("isSkillReferencedInManagedBlock detects skills inside a shared block", () => {
  const text = [
    "# AGENTS",
    "<!-- agent-ninja-START -->",
    "- [Chrome DevTools](.github/skills/chrome-devtools/SKILL.md)",
    "<!-- agent-ninja-END -->",
  ].join("\n");

  assert.strictEqual(
    isSkillReferencedInManagedBlock(text, ".github/skills", "chrome-devtools"),
    true,
  );
});

test("isSkillReferencedInManagedBlock detects skills inside a legacy block", () => {
  const text = [
    "<!-- skill-ninja-START -->",
    "- [Chrome DevTools](./.github/skills/chrome-devtools/SKILL.md)",
    "<!-- skill-ninja-END -->",
  ].join("\n");

  assert.strictEqual(
    isSkillReferencedInManagedBlock(text, ".github/skills", "chrome-devtools"),
    true,
  );
});

test("isSkillReferencedInManagedBlock ignores skills not present in the block", () => {
  const text = [
    "<!-- agent-ninja-START -->",
    "- [Other Skill](.github/skills/other/SKILL.md)",
    "<!-- agent-ninja-END -->",
  ].join("\n");

  assert.strictEqual(
    isSkillReferencedInManagedBlock(text, ".github/skills", "chrome-devtools"),
    false,
  );
});

test("isSkillReferencedInManagedBlock normalizes trailing slashes and back slashes", () => {
  const text = [
    "<!-- agent-ninja-START -->",
    "- [Chrome DevTools](.github/skills/chrome-devtools/SKILL.md)",
    "<!-- agent-ninja-END -->",
  ].join("\n");

  assert.strictEqual(
    isSkillReferencedInManagedBlock(
      text,
      ".github\\skills\\",
      "chrome-devtools",
    ),
    true,
  );
});

test("isSkillReferencedInManagedBlock ignores hits outside the managed block", () => {
  const text = [
    "# AGENTS",
    "- [Manual reference](.github/skills/chrome-devtools/SKILL.md)",
    "<!-- agent-ninja-START -->",
    "- [Other Skill](.github/skills/other/SKILL.md)",
    "<!-- agent-ninja-END -->",
  ].join("\n");

  assert.strictEqual(
    isSkillReferencedInManagedBlock(text, ".github/skills", "chrome-devtools"),
    false,
  );
});

console.log("\nLocal skill scanner tests passed.");
