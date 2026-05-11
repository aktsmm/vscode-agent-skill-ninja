/**
 * Live verification fixture generator + scenario walker.
 *
 * Produces a temporary workspace under output_sessions/coexistence-fixture/
 * with a pre-populated `AGENTS.md`, sample skill folders, and per-scenario
 * subdirectories (A, C, D, E, G, H). Each subdirectory contains a starting
 * `AGENTS.md` and a `expected.md` showing what the file should look like
 * after the relevant action runs.
 *
 * Usage:
 *   node scripts/build-coexistence-fixture.js
 *   # Then open the printed workspace in a Code window with both extensions
 *   # installed and follow the steps in run.md.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(
  __dirname,
  "..",
  "output_sessions",
  "coexistence-fixture",
);

const SHARED_START = "<!-- agent-ninja-START -->";
const SHARED_END = "<!-- agent-ninja-END -->";
const LEGACY_SKILL_START = "<!-- skill-ninja-START -->";
const LEGACY_SKILL_END = "<!-- skill-ninja-END -->";
const LEGACY_RESOURCE_START = "<!-- resource-ninja-START -->";
const LEGACY_RESOURCE_END = "<!-- resource-ninja-END -->";
const LEGACY_FINDER_START = "<!-- SKILL-FINDER-START -->";
const LEGACY_FINDER_END = "<!-- SKILL-FINDER-END -->";

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFile(p, content) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content, "utf8");
}

function makeSkillFolder(scenarioDir, name, description) {
  const skillDir = path.join(scenarioDir, ".github", "skills", name);
  writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nSample skill for live verification.\n`,
  );
}

function buildSampleSharedBlock(skillNames) {
  const rows = skillNames
    .map((n) => `| [${n}](.github/skills/${n}/SKILL.md) | sample skill |`)
    .join("\n");
  return [
    SHARED_START,
    "## Agent Skills",
    "",
    "> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.",
    "> Read the relevant SKILL.md before working on tasks covered by these skills.",
    "",
    "### Skills",
    "",
    "| Skill | Description |",
    "|-------|-------------|",
    rows,
    "",
    SHARED_END,
  ].join("\n");
}

function buildLegacySkillBlock(skillNames) {
  const rows = skillNames
    .map((n) => `| [${n}](.github/skills/${n}/SKILL.md) | sample skill |`)
    .join("\n");
  return [
    LEGACY_SKILL_START,
    "## Agent Skills",
    "",
    "| Skill | Description |",
    "|-------|-------------|",
    rows,
    "",
    LEGACY_SKILL_END,
  ].join("\n");
}

function buildLegacyResourceBlock() {
  return [
    LEGACY_RESOURCE_START,
    "## Agent Resources (legacy)",
    "",
    "Legacy resource block from older Resource NINJA.",
    "",
    LEGACY_RESOURCE_END,
  ].join("\n");
}

function buildLegacyFinderBlock() {
  return [
    LEGACY_FINDER_START,
    "## Agent Skills (legacy SKILL-FINDER)",
    "",
    "Older SKILL-FINDER block.",
    "",
    LEGACY_FINDER_END,
  ].join("\n");
}

function header(title, intro) {
  return `# ${title}\n\n${intro}\n`;
}

function buildScenario(label, intro, sections, expectedAfter) {
  const dir = path.join(ROOT, label);
  ensureDir(dir);

  // Workspace: .github/skills/<sample>
  makeSkillFolder(dir, "sample-alpha", "First sample skill");
  makeSkillFolder(dir, "sample-beta", "Second sample skill");

  // Initial AGENTS.md
  writeFile(
    path.join(dir, "AGENTS.md"),
    [
      header(`Scenario ${label}`, intro),
      "",
      ...sections,
      "",
      "## Project notes",
      "",
      "Some other content the user maintains by hand.",
      "",
    ].join("\n"),
  );

  // Expected post-action snapshot
  writeFile(
    path.join(dir, "expected-after.md"),
    [
      `# Expected AGENTS.md state after action (Scenario ${label})`,
      "",
      "```markdown",
      ...expectedAfter,
      "```",
    ].join("\n"),
  );

  // Per-scenario steps
  return dir;
}

function main() {
  if (fs.existsSync(ROOT)) {
    fs.rmSync(ROOT, { recursive: true, force: true });
  }
  ensureDir(ROOT);

  // ---- Scenario A: Skill NINJA solo ----
  const dirA = buildScenario(
    "A-skill-solo",
    "Resource NINJA is uninstalled. Only Skill NINJA is active.",
    ["No skill block yet."],
    [
      header(
        "Scenario A-skill-solo",
        "Resource NINJA is uninstalled. Only Skill NINJA is active.",
      ),
      "",
      buildSampleSharedBlock(["sample-alpha", "sample-beta"]),
      "",
      "## Project notes",
      "",
      "Some other content the user maintains by hand.",
      "",
    ],
  );

  // ---- Scenario C: Both active, default auto, Resource owns ----
  const dirC = buildScenario(
    "C-both-auto",
    "Both extensions active. coexistenceMode=auto on both. Resource NINJA should own the shared block.",
    ["No skill block yet."],
    [
      header(
        "Scenario C-both-auto",
        "Both extensions active. coexistenceMode=auto on both. Resource NINJA should own the shared block.",
      ),
      "",
      "(Resource NINJA writes the agent-ninja block here, including all 8 kinds.)",
      SHARED_START,
      "## Agent Resources",
      "(...full kinds: skill / agent / instruction / prompt / hook / mcp / plugin / cursor-rule...)",
      SHARED_END,
      "",
      "## Project notes",
      "",
      "Some other content the user maintains by hand.",
      "",
    ],
  );

  // ---- Scenario D: Both active with custom skillsDirectory ----
  const dirD = buildScenario(
    "D-both-custom-paths",
    "Both extensions active with skillNinja.skillsDirectory='custom/skills' and resourceNinja.resourcesDirectory='custom/skills'. Same disk location, no drift.",
    ["No skill block yet."],
    [
      header(
        "Scenario D-both-custom-paths",
        "Both extensions active with skillNinja.skillsDirectory='custom/skills' and resourceNinja.resourcesDirectory='custom/skills'. Same disk location, no drift.",
      ),
      "",
      "(Resource NINJA writes the agent-ninja block, links use custom/skills/ paths.)",
      SHARED_START,
      "## Agent Resources",
      "(...links use custom/skills/<name>/SKILL.md...)",
      SHARED_END,
      "",
      "## Project notes",
      "",
      "Some other content the user maintains by hand.",
      "",
    ],
  );
  // For D, also write a custom skills directory so the user can re-target settings.
  makeSkillFolder(dirD, "custom-gamma", "Custom-path skill");
  ensureDir(path.join(dirD, "custom", "skills"));
  fs.renameSync(
    path.join(dirD, ".github", "skills", "custom-gamma"),
    path.join(dirD, "custom", "skills", "custom-gamma"),
  );

  // ---- Scenario E: Resource uninstalled while AGENTS.md has shared block ----
  const dirE = buildScenario(
    "E-uninstall-resource",
    "Start with both extensions active and an existing shared agent-ninja block written by Resource NINJA. After uninstalling Resource NINJA, Skill NINJA should rewrite the SAME marker block with skill-only content.",
    [buildSampleSharedBlock(["sample-alpha", "sample-beta"])],
    [
      header(
        "Scenario E-uninstall-resource",
        "Start with both extensions active and an existing shared agent-ninja block written by Resource NINJA. After uninstalling Resource NINJA, Skill NINJA should rewrite the SAME marker block with skill-only content.",
      ),
      "",
      buildSampleSharedBlock(["sample-alpha", "sample-beta"]),
      "",
      "## Project notes",
      "",
      "Some other content the user maintains by hand.",
      "",
      "// Marker name unchanged. Body now contains only skill kind.",
    ],
  );

  // ---- Scenario G: independent mode on both ----
  const dirG = buildScenario(
    "G-both-independent",
    "Both extensions set to coexistenceMode=independent. They each write their own legacy marker block.",
    ["No marker blocks yet."],
    [
      header(
        "Scenario G-both-independent",
        "Both extensions set to coexistenceMode=independent. They each write their own legacy marker block.",
      ),
      "",
      buildLegacySkillBlock(["sample-alpha", "sample-beta"]),
      "",
      buildLegacyResourceBlock(),
      "",
      "## Project notes",
      "",
      "Some other content the user maintains by hand.",
      "",
    ],
  );

  // ---- Scenario H: Existing legacy markers migration ----
  const dirH = buildScenario(
    "H-legacy-migration",
    "Existing AGENTS.md contains legacy skill-ninja, resource-ninja, AND SKILL-FINDER blocks. The current owner should consolidate them into ONE shared agent-ninja block.",
    [
      buildLegacyFinderBlock(),
      "",
      buildLegacySkillBlock(["sample-alpha"]),
      "",
      buildLegacyResourceBlock(),
    ],
    [
      header(
        "Scenario H-legacy-migration",
        "Existing AGENTS.md contains legacy skill-ninja, resource-ninja, AND SKILL-FINDER blocks. The current owner should consolidate them into ONE shared agent-ninja block.",
      ),
      "",
      "// All three legacy blocks gone, replaced by a single agent-ninja block at the position of the FIRST legacy marker.",
      SHARED_START,
      "## Agent Skills (or Resources, depending on owner)",
      "(...consolidated content...)",
      SHARED_END,
      "",
      "## Project notes",
      "",
      "Some other content the user maintains by hand.",
      "",
    ],
  );

  // ---- run.md walkthrough ----
  const runDoc = `# Live verification walkthrough

This folder contains 6 ready-to-open workspaces (A, C, D, E, G, H) for the
Coexistence v3.1 acceptance scenarios. Scenarios B and F live on the Resource
NINJA side and are not reproducible from this fixture alone.

## One-time setup

1. Install both dev VSIXs into VS Code:
   \`\`\`pwsh
   code --install-extension d:/03_github/00_VSC_tools/Ag-Ext-Skill-NINJA/artifacts/vsix/agent-skill-ninja-0.8.28-coexistence-dev.vsix
   code --install-extension d:/03_github/00_VSC_tools/Ag-Ext-Agent-Resources-NINJA/artifacts/vsix/agent-resources-ninja-0.2.11-coexistence-dev.vsix
   \`\`\`
   (or pass them with \`--install-extension\` to a fresh \`code --user-data-dir\` for an isolated profile)

2. Optional: open a clean profile so other extensions don't interfere:
   \`\`\`pwsh
   code --user-data-dir "$env:TEMP\\agent-ninja-verify"
   \`\`\`

## Per-scenario procedure

For each scenario folder \`<label>/\`:

1. Open the folder in VS Code.
2. Read \`AGENTS.md\` to confirm the **starting state**.
3. Trigger the action listed below. Wait for the views to refresh.
4. Re-read \`AGENTS.md\` and compare against \`expected-after.md\`.
5. Run the command **\`Agent Skills Ninja: Show Coexistence Status\`** and confirm the printed owner matches the scenario's expected owner.
6. Re-run the action twice more and confirm \`git diff\` shows no further changes (idempotency).

## Scenarios

| Folder | Scenario | Setup | Action | Expected owner | Expected marker |
|---|---|---|---|---|---|
| A-skill-solo | Skill solo | Disable / uninstall Resource NINJA | \`Agent Skills Ninja: Recompute Coexistence Ownership\` | self (Skill NINJA) | \`<!-- agent-ninja-* -->\` (skill only) |
| C-both-auto | Both, auto | Both extensions active, mode=auto on both | \`Agent Skills Ninja: Recompute Coexistence Ownership\` | sibling (Resource NINJA) | \`<!-- agent-ninja-* -->\` (full kinds) |
| D-both-custom-paths | Both, custom paths | Set \`skillNinja.skillsDirectory\` and \`resourceNinja.resourcesDirectory\` to \`custom/skills\` | Recompute on both | sibling | \`<!-- agent-ninja-* -->\` with custom path links |
| E-uninstall-resource | Resource uninstall handoff | Start with both active, then \`Disable\` or \`Uninstall\` Resource NINJA | After uninstall, run Skill NINJA recompute (or wait for \`onDidChange\`) | self | Same marker, body becomes skill-only |
| G-both-independent | Independent mode | Set \`skillNinja.coexistenceMode=independent\` AND \`resourceNinja.coexistenceMode=independent\` | Recompute on both | self on Skill, self on Resource | Two parallel blocks: \`skill-ninja-*\` + \`resource-ninja-*\` |
| H-legacy-migration | Legacy marker migration | Use the pre-built AGENTS.md as-is | Recompute on the current owner | Whichever side is owner | All 3 legacy blocks gone, single \`agent-ninja-*\` block at first legacy position |

## Pass criteria (each scenario)

- The marker structure matches \`expected-after.md\` (use \`git diff AGENTS.md\` for clarity).
- After running the action 3 times in a row, only the first invocation produces a diff.
- The "Project notes" section and any other manual content is preserved untouched.
- For E and the corresponding F (run on Resource NINJA): \`onDidChange\` triggers a rewrite within ~200 ms of the install/uninstall event.

## Diagnostic commands

- \`Agent Skills Ninja: Show Coexistence Status\`
- \`Agent Skills Ninja: Recompute Coexistence Ownership\`
- \`Agent Skills Ninja: Clean Up Orphan Instruction Block\`
- \`Agent Resources Ninja: Show Coexistence Status\`
- \`Agent Resources Ninja: Recompute Ownership\`

## Cleanup

\`\`\`pwsh
code --uninstall-extension yamapan.agent-skill-ninja
code --uninstall-extension yamapan.agent-resources-ninja
Remove-Item -Recurse -Force ${ROOT.replace(/\\/g, "/")}
\`\`\`
`;
  writeFile(path.join(ROOT, "run.md"), runDoc);

  console.log("Live verification fixture written to:");
  console.log("  " + ROOT);
  console.log("");
  console.log("Open run.md to walk through the 6 reproducible scenarios.");
}

main();
