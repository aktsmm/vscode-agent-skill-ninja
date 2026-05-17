/**
 * Marker migration regression tests for instructionManager.updateSection.
 *
 * Verifies the v3 (Single Block + Owner Handoff) migration rules:
 *   - Pre-existing legacy markers (skill-ninja-*, resource-ninja-*,
 *     SKILL-FINDER-*) are stripped and the new shared block is written in
 *     their place (idempotent).
 *   - When the target marker is the legacy skill-ninja pair (independent
 *     mode), the shared block is also stripped and the legacy block is
 *     written.
 *   - Re-running the same operation produces a stable file (no diff loop).
 *
 * Run after compile: node scripts/test-marker-migration.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "src", "instructionManager.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

const moduleExports = {};
const sandbox = {
  exports: moduleExports,
  module: { exports: moduleExports },
  process,
  console,
  Promise,
  Buffer,
  setTimeout,
  Set,
  Map,
  Date,
  require(request) {
    if (request === "vscode") {
      return {
        Uri: { joinPath() {}, file() {} },
        workspace: { fs: { readFile() {}, writeFile() {} } },
      };
    }
    if (request === "./skillInstaller") {
      return { getInstalledSkillsWithMeta: async () => [] };
    }
    if (request === "./localSkillScanner") {
      return {};
    }
    if (request === "./toolDetector") {
      return { resolveOutputFormat: async () => ({ format: "full" }) };
    }
    if (request === "./constants") {
      return {
        SKILL_DESCRIPTION_LIMITS: { MAX_TOTAL: 200, MAX_EACH: 100 },
      };
    }
    if (request === "./skillLocations") {
      return {
        computeRelativeDirectoryPath: () => ".",
        getManagedSkillRoots: async () => [],
        resolveConfiguredPathToUri: () => undefined,
      };
    }
    if (request === "./coexistence") {
      return {
        getCoexistenceMode: () => "auto",
        getEffectiveOwnership: () =>
          Promise.resolve({
            owner: "self",
            reason: "no-sibling",
            selfKinds: ["skill"],
            siblingInstalled: false,
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
  cleanupManagedSkillBlocks,
  updateSection,
  SHARED_MARKER_START,
  SHARED_MARKER_END,
} =
  sandbox.module.exports;

assert.ok(
  typeof updateSection === "function",
  "updateSection must be exported",
);
assert.ok(
  typeof cleanupManagedSkillBlocks === "function",
  "cleanupManagedSkillBlocks must be exported",
);
assert.strictEqual(SHARED_MARKER_START, "<!-- agent-ninja-START -->");
assert.strictEqual(SHARED_MARKER_END, "<!-- agent-ninja-END -->");

const SHARED_MARKERS = {
  start: "<!-- agent-ninja-START -->",
  end: "<!-- agent-ninja-END -->",
};
const LEGACY_SKILL_MARKERS = {
  start: "<!-- skill-ninja-START -->",
  end: "<!-- skill-ninja-END -->",
};

function buildSharedBlock(body = "Hello shared!") {
  return `${SHARED_MARKERS.start}\n${body}\n${SHARED_MARKERS.end}`;
}

function buildLegacySkillBlock(body = "Hello legacy!") {
  return `${LEGACY_SKILL_MARKERS.start}\n${body}\n${LEGACY_SKILL_MARKERS.end}`;
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

function countMarkerPairs(text, markers) {
  const startCount = (
    text.match(new RegExp(escapeRegExp(markers.start), "g")) || []
  ).length;
  const endCount = (
    text.match(new RegExp(escapeRegExp(markers.end), "g")) || []
  ).length;
  return { startCount, endCount };
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- Migration: legacy -> shared (auto/owner mode) ---

test("legacy skill-ninja block is replaced by shared block", () => {
  const existing = `# AGENTS.md\n\n${buildLegacySkillBlock("OLD")}\n\nTrailing text.\n`;
  const newSection = buildSharedBlock("NEW");
  const result = updateSection(existing, newSection, "full", SHARED_MARKERS);

  assert.ok(
    result.includes(SHARED_MARKERS.start),
    "shared marker must be present",
  );
  assert.ok(
    !result.includes(LEGACY_SKILL_MARKERS.start),
    "legacy skill-ninja marker must be stripped",
  );
  const counts = countMarkerPairs(result, SHARED_MARKERS);
  assert.strictEqual(counts.startCount, 1);
  assert.strictEqual(counts.endCount, 1);
});

test("legacy resource-ninja block is replaced by shared block", () => {
  const existing = `# AGENTS.md\n\n<!-- resource-ninja-START -->\nresource body\n<!-- resource-ninja-END -->\n`;
  const newSection = buildSharedBlock("NEW");
  const result = updateSection(existing, newSection, "full", SHARED_MARKERS);
  assert.ok(result.includes(SHARED_MARKERS.start));
  assert.ok(!result.includes("<!-- resource-ninja-START -->"));
});

test("legacy SKILL-FINDER block is replaced by shared block", () => {
  const existing = `# Top\n\n<!-- SKILL-FINDER-START -->\nfinder body\n<!-- SKILL-FINDER-END -->\nTail\n`;
  const newSection = buildSharedBlock("NEW");
  const result = updateSection(existing, newSection, "full", SHARED_MARKERS);
  assert.ok(result.includes(SHARED_MARKERS.start));
  assert.ok(!result.includes("<!-- SKILL-FINDER-START -->"));
});

test("multiple legacy blocks are merged into one shared block", () => {
  const existing =
    `# Header\n\n` +
    buildLegacySkillBlock("a") +
    `\n\nMid\n\n` +
    `<!-- resource-ninja-START -->\nb\n<!-- resource-ninja-END -->\n\n` +
    `<!-- SKILL-FINDER-START -->\nc\n<!-- SKILL-FINDER-END -->\n`;
  const result = updateSection(
    existing,
    buildSharedBlock("UNIFIED"),
    "full",
    SHARED_MARKERS,
  );
  assert.strictEqual(
    countMarkerPairs(result, SHARED_MARKERS).startCount,
    1,
    "exactly one shared start marker",
  );
  assert.ok(!result.includes(LEGACY_SKILL_MARKERS.start));
  assert.ok(!result.includes("<!-- resource-ninja-START -->"));
  assert.ok(!result.includes("<!-- SKILL-FINDER-START -->"));
});

test("cleanupManagedSkillBlocks keeps shared block when requested", () => {
  const existing =
    `# Header\n\n` +
    buildSharedBlock("KEEP") +
    `\n\n` +
    buildLegacySkillBlock("DROP") +
    `\n\n<!-- resource-ninja-START -->\nDROP\n<!-- resource-ninja-END -->\n`;

  const result = cleanupManagedSkillBlocks(existing, { keepShared: true });
  assert.ok(result.includes(SHARED_MARKERS.start));
  assert.ok(!result.includes(LEGACY_SKILL_MARKERS.start));
  assert.ok(!result.includes("<!-- resource-ninja-START -->"));
});

test("cleanupManagedSkillBlocks removes shared block by default", () => {
  const existing = `# Header\n\n${buildSharedBlock("DROP")}\n`;

  const result = cleanupManagedSkillBlocks(existing);
  assert.ok(!result.includes(SHARED_MARKERS.start));
});

test("idempotent: re-running with same inputs is a no-op", () => {
  const existing = `# AGENTS.md\n\n${buildSharedBlock("SAME")}\n\nTail\n`;
  const newSection = buildSharedBlock("SAME");
  const first = updateSection(existing, newSection, "full", SHARED_MARKERS);
  const second = updateSection(first, newSection, "full", SHARED_MARKERS);
  assert.strictEqual(first, second);
});

test("preserves the existing block position (does not move to end)", () => {
  const before = "# Title\n\nIntro\n\n";
  const after = "\n\nOutro at the end\n";
  const existing = before + buildSharedBlock("OLD") + after;
  const result = updateSection(
    existing,
    buildSharedBlock("NEW"),
    "full",
    SHARED_MARKERS,
  );
  // Index of new shared start should be near where the old block was, not at EOF.
  const startIdx = result.indexOf(SHARED_MARKERS.start);
  assert.ok(startIdx >= before.length - 4 && startIdx <= before.length + 4);
  assert.ok(result.endsWith(after));
});

test("appends shared block when no marker exists", () => {
  const existing = `# AGENTS.md\n\nSome text.\n`;
  const result = updateSection(
    existing,
    buildSharedBlock("FRESH"),
    "full",
    SHARED_MARKERS,
  );
  assert.ok(result.includes(SHARED_MARKERS.start));
  assert.strictEqual(countMarkerPairs(result, SHARED_MARKERS).startCount, 1);
});

// --- Independent mode: target = legacy skill-ninja, also strips shared ---

test("independent mode: writes legacy skill-ninja block and removes shared", () => {
  const existing = `# Top\n\n${buildSharedBlock("PREV-SHARED")}\n\n${buildLegacySkillBlock("PREV-LEGACY")}\n`;
  const newSection = buildLegacySkillBlock("NEW-LEGACY");
  const result = updateSection(
    existing,
    newSection,
    "full",
    LEGACY_SKILL_MARKERS,
  );
  assert.ok(!result.includes(SHARED_MARKERS.start));
  assert.strictEqual(
    countMarkerPairs(result, LEGACY_SKILL_MARKERS).startCount,
    1,
  );
});

console.log("All marker migration tests passed.");
