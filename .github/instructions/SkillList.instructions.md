---
description: "Shared Skill List block coexistence contract for AGENTS.md and copilot-instructions.md"
applyTo: "AGENTS.md,**/copilot-instructions.md,CLAUDE.md,**/CLAUDE.md"
---

# Skill List Block — Coexistence Contract (v3)

This file documents the rules Agent Skills Ninja follows when writing the
"Skill List" block into AGENTS.md / copilot-instructions.md / CLAUDE.md /
similar instruction files. It is also the contract used by the sister
extension **Agent Resources Ninja** (`yamapan.agent-resources-ninja`) so the
two extensions can coexist without competing for the same block.

## Markers

- **Shared marker (preferred, written in `auto` mode):**
  - `<!-- agent-ninja-START -->` ... `<!-- agent-ninja-END -->`
- **Legacy markers (auto-migrated to the shared marker by the active owner):**
  - `<!-- skill-ninja-START -->` ... `<!-- skill-ninja-END -->`
  - `<!-- resource-ninja-START -->` ... `<!-- resource-ninja-END -->`
  - `<!-- SKILL-FINDER-START -->` ... `<!-- SKILL-FINDER-END -->`

Only one block per file. Owner handoff replaces the contents in place; no
parallel blocks are created.

## Coexistence Mode

Setting: `skillNinja.coexistenceMode` (default: `auto`)

| Mode          | Behavior                                                                 |
| ------------- | ------------------------------------------------------------------------ |
| `auto`        | Single shared block. Owner is decided by capability (kinds set).         |
| `independent` | Always write the legacy `<!-- skill-ninja-* -->` block (advanced users). |

## Owner Decision (Capability Beacon, protocol v3)

Each extension publishes a beacon to `globalState` under
`agentNinja.beacon.<extensionId>` describing the resource `kinds` it manages
(skill / agent / instruction / prompt / hook / mcp / plugin / cursor-rule).

Decision rules (deterministic, identical on both extensions):

1. No sibling beacon → **self** is owner.
2. `self.kinds` is a strict subset of `sibling.kinds` → **sibling** is owner.
3. `sibling.kinds` is a strict subset of `self.kinds` → **self** is owner.
4. Otherwise tie-break by lexicographic `extensionId` order.

For Skill Ninja (`kinds = ["skill"]`) vs Resources Ninja (full set), this
means **Resources Ninja is the owner whenever both are active**, and Skill
Ninja silently defers.

## Uninstall Handoff

- `vscode.extensions.onDidChange` triggers a re-evaluation, so installing or
  uninstalling either extension causes the surviving owner to refresh the
  shared block in place (same marker name; only the body changes).
- The block is never auto-deleted on uninstall (VS Code does not provide a
  reliable uninstall hook). The command
  `Agent Skills Ninja: Clean Up Orphan Instruction Block` removes leftover
  markers manually after both extensions have been uninstalled.
- **`resourceNinja.kindsExcluded` semantics after Skill Ninja uninstall**:
  Resources Ninja ignores `kindsExcluded` at runtime while Skill Ninja is
  active (so the shared block always includes skill rows). Once Skill Ninja
  is uninstalled, Resources Ninja returns to standalone mode and re-applies
  the user-configured `kindsExcluded`. If `"skill"` is in that list, the
  skill rows will be omitted. To restore them, remove `"skill"` from
  `resourceNinja.kindsExcluded` (or run
  `Agent Resources Ninja: Recompute Coexistence Ownership` after editing).

## Diagnostic Commands

- `Agent Skills Ninja: Show Coexistence Status` — Output channel dump of the
  current ownership decision, sibling beacon, and configured mode.
- `Agent Skills Ninja: Recompute Coexistence Ownership` — Re-publishes the
  beacon and re-runs the instruction file sync (useful after manual edits).
- `Agent Skills Ninja: Clean Up Orphan Instruction Block` — Strips all known
  marker pairs from instruction files (with confirmation).

## Workspace Path Drift Prevention

When `skillNinja.skillsDirectory` is left at its default (`.github/skills`)
and `resourceNinja.resourcesDirectory` is configured to a different value,
Skill Ninja mirrors the sister extension's value so both views point at the
same workspace folder. Setting `skillNinja.skillsDirectory` explicitly always
wins.
