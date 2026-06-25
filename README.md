# 🥷 Agent Skills Ninja

<p align="center">
  <strong>Search, Install, and Manage Agent Skills for AI Coding Assistants</strong>
</p>

[![Status](https://badgen.net/badge/Status/Stable/green)](https://marketplace.visualstudio.com/items?itemName=yamapan.agent-skill-ninja)
[![VS Marketplace](https://badgen.net/vs-marketplace/v/yamapan.agent-skill-ninja)](https://marketplace.visualstudio.com/items?itemName=yamapan.agent-skill-ninja)
[![Installs](https://badgen.net/vs-marketplace/i/yamapan.agent-skill-ninja)](https://marketplace.visualstudio.com/items?itemName=yamapan.agent-skill-ninja)
[![License](https://badgen.net/badge/License/CC%20BY-NC-SA%204.0/gray)](LICENSE)
[![GitHub](https://badgen.net/badge/GitHub/Source/black)](https://github.com/aktsmm/vscode-agent-skill-ninja)
[![Stars](https://badgen.net/github/stars/aktsmm/vscode-agent-skill-ninja)](https://github.com/aktsmm/vscode-agent-skill-ninja)

<p align="center">
  <b>GitHub Copilot • Claude Code • Cursor • Windsurf • Cline</b>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#copilot-chat">Copilot Chat</a> •
  <a href="#settings">Settings</a> •
  <a href="#development">Development</a>
</p>

<p align="center">
  <a href="https://github.com/aktsmm/vscode-agent-skill-ninja/blob/master/README_ja.md">Japanese / 日本語版はこちら</a>
</p>

---

## Output Formats

### Format Options

| Format         | Instruction file             | Catalog file (`refCatalogFormat`)            |
| -------------- | ---------------------------- | -------------------------------------------- |
| 🔗 **Ref**     | IMPORTANT + link only        | Separate file: `full` / `compact` / `legacy` |
| ✅ **Full**    | IMPORTANT + detailed table   | —                                            |
| 📦 **Compact** | IMPORTANT + compressed index | —                                            |
| 🕰️ **Legacy**  | Simple table (no IMPORTANT)  | —                                            |

### IMPORTANT Prompt

The `ref`, `full`, and `compact` formats include the **IMPORTANT prompt** that instructs agents to prioritize skill files. `ref` keeps the always-loaded instruction file lighter by keeping only the routing prompt and catalog link in the instruction file, while moving the detailed catalog into a separate Markdown file. Use `skillNinja.refCatalogFormat` to choose whether that linked catalog is `full`, `compact`, or `legacy`.

```markdown
> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.
> Read the relevant SKILL.md before working on tasks covered by these skills.
```

### Example Output - Ref Format (Default)

```markdown
<!-- agent-ninja-START -->

## Agent Skills

> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.
> See [Agent Skills](.github/skills/README.md) before working on tasks covered by these skills.

<!-- agent-ninja-END -->
```

The catalog is written to `.github/skills/README.md`. Its internal format is controlled by `skillNinja.refCatalogFormat` (`full` by default, or `compact` / `legacy`).

For workspace skills, relative `skillNinja.refCatalogPath` values are resolved from the workspace root. For user/global skills, they are resolved from the instruction file directory so personal instruction files stay portable.

### Example Output - Full Format

```markdown
<!-- agent-ninja-START -->

## Agent Skills

> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.
> Read the relevant SKILL.md before working on tasks covered by these skills.

### Skills

| Skill                                | Description                                         |
| ------------------------------------ | --------------------------------------------------- |
| [docx](.github/skills/docx/SKILL.md) | Process Word documents (.docx). Use for .docx files |
| [pdf](.github/skills/pdf/SKILL.md)   | PDF manipulation toolkit. Extract text, create PDFs |

<!-- agent-ninja-END -->
```

### How to Change Format

Settings → **Output Format** → Select `ref`, `full`, `compact`, or `legacy`

---

## 🥷 Features

### 📁 Workspace Skill Management

- Manage **SKILL.md** files across four scopes: workspace, user/global, read-only installed extensions, and optional built-in
- Use `skillNinja.skillsDirectory` as the primary managed workspace root, add repo-local roots with `skillNinja.additionalSkillRoots`, and auto-discover extra user/global roots from VS Code Agent Skill Locations
- Automatically sync managed skills to the closest instruction file for each writable root
- Create new skill from template

### 🔍 Skill Search & Discovery

- Search skills by keyword (local & GitHub)
- **Multi-keyword Search** - Scored by name, path, description relevance
- **Parallel Fetch** - Fast results with 50 concurrent requests
- **Fallback Search** - Auto-retry with fewer keywords if no results
- Search results with descriptions & category tags
- Star counts & organization badges
- Install / Preview / Favorite directly from search results

### 📦 Install & Manage

- Double-click a remote skill row to install it into the workspace skill root by default (`skillNinja.skillsDirectory`, default: `.github/skills`)
- Optional single-click install toggle for Browse view (`skillNinja.singleClickInstall`)
- Install target picker for toolbar/search/preview flows and other cases with multiple managed roots (workspace or user/global)
- Auto-update **instruction file** (AGENTS.md / copilot-instructions.md / CLAUDE.md)
- **Table Format** - Skills displayed in table with "When to Use" column
- **Auto-extract "When to Use"** - Extracted from SKILL.md `## When to Use` section
- **Edit Description** - Right-click to customize skill description
- Uninstall functionality
- **Reinstall All** - Batch reinstall from latest source (with auto index update)
- **Source-aware Missing Index Recovery** - When reinstall hits missing index entries, the extension now updates only the affected source when it can be identified, instead of always refreshing every source
- **Partial Failure Warnings** - Batch reinstall flows now warn with succeeded/failed counts when only part of the selection could be reinstalled
- **Root-level Inline Actions** - Each writable skill root row exposes inline **Regenerate Skill Output** (regenerates AGENTS.md / copilot-instructions.md / CLAUDE.md or the linked `ref` catalog), and rows that contain at least one remote-backed skill also show **Reinstall Remote Skills in This Root**
- **Install Feedback** - NEW badge, status bar notification, auto-select in tree view
- **Open Folder** - Quick access to installed skill folder
- **Explain Skill State** - Diagnose registration source, metadata path, coexistence owner, and instruction target from the tree item context menu
- **Index Integrity Check** - Auto-detect missing skills and prompt for index update

### 🔧 Multi-Tool Support

- **Auto-detection** of AI tools in workspace (Cursor, Windsurf, Cline, Claude Code, GitHub Copilot)
- Automatic format selection based on detected tool
- Manual override available in settings
- Supported output formats:
  - Markdown (AGENTS.md, CLAUDE.md, copilot-instructions.md)
  - Cursor Rules (.cursor/rules/)
  - Windsurf Rules (.windsurfrules)
  - Cline Rules (.clinerules)

### 💬 GitHub Copilot Chat Integration

- `@skill` commands for direct chat operations
- `/search`, `/install`, `/list`, `/recommend`
- Project-based skill recommendations

### 🤖 MCP Tools Integration

- Automatically available as tools in **Agent Mode**
- **10 Tools**: `#searchSkills`, `#installSkill`, `#uninstallSkill`, `#listSkills`, `#recommendSkills`, `#updateSkillIndex`, `#webSearchSkills`, `#addSkillSource`, `#removeSkillSource`, `#localizeSkill`
- Trust badges (Official / Curated / Community)
- Auto-update instruction file on install

### 🌐 Multi-language & UI

- Japanese / English UI (auto-detect + manual switch)
- Skill preview in Webview
- Favorites feature

## 🎬 Demo

![Demo](docs/screenshots/demo.gif)

## 📥 Installation

### VS Code Marketplace

```
ext install yamapan.agent-skill-ninja
```

Or search for **"Agent Skills Ninja"** in VS Code Extensions (`Ctrl+Shift+X`)

### Manual Installation

1. Download `.vsix` from [Releases](https://github.com/aktsmm/vscode-agent-skill-ninja/releases)
2. In VS Code: `Ctrl+Shift+P` → `Extensions: Install from VSIX...`
3. Select the downloaded `.vsix` file

## 🧩 Companion Extension

- [Agent Resources Ninja](https://marketplace.visualstudio.com/items?itemName=yamapan.agent-resources-ninja) - Resource-oriented companion extension for managing skills plus agents, prompts, instructions, hooks, MCP config resources, and related AI coding resources.
- GitHub: https://github.com/aktsmm/vscode-agent-resources-ninja

## 📚 Included Skill Sources

Preset index includes skills from official, curated, and community sources out of the box.

| Source                                                                                                                        | Type      | Description                           |
| ----------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------- |
| [anthropics/skills](https://github.com/anthropics/skills)                                                                     | Official  | Anthropic official Claude Skills      |
| [openai/skills](https://github.com/openai/skills)                                                                             | Official  | OpenAI official Codex Skills (1.7k+)  |
| [google/skills](https://github.com/google/skills)                                                                             | Official  | Google official product skills        |
| [github/awesome-copilot](https://github.com/github/awesome-copilot)                                                           | Official  | GitHub official Copilot resources     |
| [MicrosoftDocs/Agent-Skills](https://github.com/MicrosoftDocs/Agent-Skills)                                                   | Official  | Microsoft official Azure agent skills |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills)                                       | Curated   | Curated Claude Skills list            |
| [obra/superpowers](https://github.com/obra/superpowers)                                                                       | Community | High-quality skills & agents          |
| [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) | Community | Context Engineering skills (5k+)      |
| [danielmiessler/Personal_AI_Infrastructure](https://github.com/danielmiessler/Personal_AI_Infrastructure)                     | Community | PAI Packs - Skills & Features         |
| [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin)                               | Community | Compound Engineering (3.5k+)          |
| [Wirasm/PRPs-agentic-eng](https://github.com/Wirasm/PRPs-agentic-eng)                                                         | Community | PRP (Prompt Recipe Patterns)          |
| [qdhenry/Claude-Command-Suite](https://github.com/qdhenry/Claude-Command-Suite)                                               | Community | Claude commands & skills              |
| [Yeachan-Heo/oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex)                                                         | Community | OMX Codex workflow skills             |

> Use `Update Index` to refresh the latest skills and metadata from these sources.

## 🥷 Usage

### Sidebar Operations

1. Click the **spiral shuriken icon** in the Activity Bar
2. **Installed Skills** - Workspace managed skills grouped by skill root

- **Workspace Skills**: managed under `skillNinja.skillsDirectory` (default: `.github/skills`) plus any `skillNinja.additionalSkillRoots`
- Newly installed skills (temporary badge)
- Toolbar: Skill Output / Regenerate Skill Output / Create / Refresh View / Settings
- Each writable root row also exposes inline **Regenerate Skill Output** on the right edge, and roots with at least one remote-backed skill also show **Reinstall Remote Skills in This Root**
- If a remote-backed skill is no longer present upstream, reinstall flows can mark it as disabled for future reinstall checks so it no longer blocks batch operations
- In the workspace view, **Skill Output** opens the workspace root directly without showing the all-roots picker
- In `ref` mode, **Skill Output** opens the linked catalog; in `full` / `compact` / `legacy`, it opens the instruction file itself
- Empty state: Search / Create / Open Skill Output quick links
- Open skill folder or file from the workspace root

3. **User / Global Skills** - Personal skills grouped by skill root, plus read-only installed extension skills and read-only built-in skills

- **User / Global Skills**: discovered from standard personal roots (`~/.copilot/skills`, `~/.claude/skills`, `~/.agents/skills`) plus VS Code Agent Skill Locations
- **Installed Extensions**: read-only skills discovered from skill folders bundled with installed VS Code extensions, grouped by extension first and then by variant/root
- **Built-in Skills**: read-only group for Copilot / VS Code packaged skills, grouped first by provider/origin (for example GitHub Copilot Chat, GitHub Copilot CLI, VS Code) and then by variant/root (for example Prompts, Skills, Package (Universal)); this group is shown by default and can be hidden from Settings
- Root nodes use concise home/product labels, while counts and full paths stay in the secondary description / tooltip
- Toolbar: Skill Output / Regenerate Skill Output / Create / Refresh View / Settings
- Each writable root row also exposes inline **Regenerate Skill Output** on the right edge, and roots with at least one remote-backed skill also show **Reinstall Remote Skills in This Root**, so GitHub Copilot Home / Claude Home / Global Agent Home can be refreshed without opening the command palette
- Legacy `source: unknown` skills without a `remotePath` are treated as individual lookup candidates only; they no longer make batch reinstall actions look reinstallable by themselves
- In the user/global view, **Skill Output** opens the default writable user/global root directly without showing the all-roots picker
  Default priority: VS Code user customizations, then Copilot home, Claude home, and finally the global agent home
- In `ref` mode, **Skill Output** opens the linked catalog; in `full` / `compact` / `legacy`, it opens the instruction file itself
- Empty state: Create / Settings / Open Skill Output quick links
- Open skill folder or file from any visible user/global root

4. **Remote Skills** - Browse skills by source
   - **Favorites** section at top
   - Sources sorted: Official → Curated → Community
   - Shows installed status with green icons

- Double-click a row to install to the workspace root by default, or use the inline Install action when you want the root picker

- Toolbar: Search / Web Search / Update Index / Add Source / Create / Settings
- Add Source accepts a repository root URL or a GitHub folder/file URL inside that repository. The repository root is detected automatically.
- Private source repositories are supported when GitHub authentication has access to read that repository's contents.

### Icon Legend

| Icon               | Meaning                                                |
| ------------------ | ------------------------------------------------------ |
| check (green)      | Installed skill                                        |
| NEW badge          | Recently installed (temporary badge)                   |
| star-full (yellow) | Favorites section                                      |
| verified (blue)    | Official source (Anthropic, OpenAI, GitHub, Microsoft) |
| star (yellow)      | Curated awesome-list                                   |
| repo               | Community repository                                   |

### Command Palette

| Command                                         | Description                                                                                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `Agent Skills Ninja: Search Skills`             | Search and install skills                                                                                                                     |
| `Agent Skills Ninja: Update Index`              | Update index from all sources                                                                                                                 |
| `Agent Skills Ninja: Search on GitHub`          | Search skills on GitHub                                                                                                                       |
| `Agent Skills Ninja: Add Source Repository`     | Add new source repository                                                                                                                     |
| `Agent Skills Ninja: Remove Source Repository`  | Remove source repository                                                                                                                      |
| `Agent Skills Ninja: Uninstall Skill`           | Uninstall a skill                                                                                                                             |
| `Agent Skills Ninja: Show Installed Skills`     | Show installed skills                                                                                                                         |
| `Agent Skills Ninja: Create New Skill`          | Create new workspace skill                                                                                                                    |
| `Agent Skills Ninja: Reinstall All Skills`      | Reinstall all skills from latest source                                                                                                       |
| `Agent Skills Ninja: Uninstall All Skills`      | Uninstall all skills (with confirmation)                                                                                                      |
| `Agent Skills Ninja: Uninstall Multiple Skills` | Select multiple skills to uninstall                                                                                                           |
| `Agent Skills Ninja: Reinstall Multiple Skills` | Select multiple skills to reinstall                                                                                                           |
| `Agent Skills Ninja: Open Skill Output`         | Choose a managed root, then open the linked catalog in `ref`, or the instruction file in other formats                                        |
| `Agent Skills Ninja: Regenerate Skill Output`   | Regenerate the selected root's skill output files manually (`AGENTS.md`, `copilot-instructions.md`, `CLAUDE.md`, or the linked `ref` catalog) |
| `Agent Skills Ninja: Open Skill Folder`         | Open installed skill folder in OS                                                                                                             |

### Quick Start

```
1. Ctrl+Shift+P → "Agent Skills Ninja: Search Skills"
2. Enter keywords (e.g., "pdf", "azure", "git")
3. Select skill → Choose action (Install / Preview / Favorite / GitHub)
4. Done! Auto-registered in instruction file
```

### Search Tips 💡

| Example            | Effect                                 |
| ------------------ | -------------------------------------- |
| `azure`            | Keyword search                         |
| `azure devops`     | Multiple keywords, ranked by relevance |
| `username keyword` | First word searched as username        |
| `user:anthropics`  | Explicit user search                   |
| `repo:owner/repo`  | Repository search                      |

> If no results found, keywords are automatically reduced and retried.

## 💬 Copilot Chat

Use `@skill` in GitHub Copilot Chat for skill operations:

```
@skill /search MCP server      # Search skills
@skill /install github-mcp     # Install skill
@skill /list                   # List installed
@skill /recommend              # Project-based recommendations
@skill what tools for Python?  # Natural language search
```

### Commands

| Command           | Description                        |
| ----------------- | ---------------------------------- |
| `/search <query>` | Search skills by keyword           |
| `/install <name>` | Install a skill                    |
| `/list`           | List installed skills              |
| `/recommend`      | Recommendations based on workspace |

> Search results include install buttons for direct installation

## 🤖 MCP Tools (Agent Mode)

In GitHub Copilot's **Agent Mode**, tools are automatically available.

### Tool List

| Tool Reference       | Description                       |
| -------------------- | --------------------------------- |
| `#searchSkills`      | Search skills by keyword          |
| `#installSkill`      | Install a skill                   |
| `#uninstallSkill`    | Uninstall a skill                 |
| `#listSkills`        | List installed skills             |
| `#recommendSkills`   | Get project-based recommendations |
| `#updateSkillIndex`  | Update skill index                |
| `#webSearchSkills`   | Web search skills on GitHub       |
| `#addSkillSource`    | Add new skill source              |
| `#removeSkillSource` | Remove a skill source             |
| `#localizeSkill`     | Localize skill descriptions       |

### Usage Examples

```
💬 "Find Azure-related skills"
   → #searchSkills automatically invoked, displays results

💬 "Install the bicep-mcp skill"
   → #installSkill installs, auto-updates instruction file

💬 "Search GitHub for MCP servers"
   → #webSearchSkills searches GitHub repositories

💬 "What skills would you recommend for this project?"
   → #recommendSkills analyzes workspace and recommends
```

### Features

- **Trust Badges**: Shows Official / Curated / Community
- **Recommended Skills**: Suggests best skills from search results
- **Index Update Info**: Shows last update date with warnings if outdated
- **Settings Integration**: Respects `autoUpdateInstruction` / `skillsDirectory`
- **Token Efficiency**: Save conversation context by using MCP tools

### Disable MCP Tools

If you don't need MCP tools, you can disable them from GitHub Copilot Chat:

1. Copilot Chat panel → Settings → Tools
2. Toggle off "Agent Skills Ninja" tools

## ⚙️ Settings

| Order | Setting                                   | Default                    | Description                                                                         |
| :---: | ----------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------- |
|   1   | `skillNinja.autoUpdateInstruction`        | `true`                     | **Auto-update instruction file on install**                                         |
|   2   | `skillNinja.instructionFile`              | `AGENTS.md`                | Instruction file format _(requires Auto Update)_                                    |
|   3   | `skillNinja.customInstructionPath`        | `""`                       | Custom path _(only when 'custom' selected)_                                         |
|   4   | `skillNinja.skillsDirectory`              | `.github/skills`           | Primary directory to install and manage workspace skills                            |
|   5   | `skillNinja.additionalSkillRoots`         | `[]`                       | Additional workspace skill roots, for example `copilot-skills/skills`               |
|   6   | `skillNinja.useVsCodeAgentSkillLocations` | `true`                     | Discover standard personal roots and extra user/global skill roots                  |
|   7   | `skillNinja.showBuiltInSkills`            | `true`                     | Show read-only built-in skills                                                      |
|   8   | `skillNinja.outputFormat`                 | `ref`                      | Output format (ref / full / compact / legacy)                                       |
|   9   | `skillNinja.refCatalogPath`               | `.github/skills/README.md` | Catalog file path used by the `ref` format                                          |
|  10   | `skillNinja.refCatalogFormat`             | `full`                     | Catalog detail format used when `outputFormat` is `ref`                             |
|  11   | `skillNinja.language`                     | `auto`                     | UI language (auto / en / ja)                                                        |
|  12   | `skillNinja.autoUpdateSkillsOnUpgrade`    | `prompt`                   | Update installed skills after extension upgrade                                     |
|  13   | `skillNinja.githubToken`                  | `""`                       | Legacy GitHub Token setting; copied to SecretStorage when present                   |
|  14   | `skillNinja.singleClickInstall`           | `false`                    | Install remote skills with single click                                             |
|  15   | `skillNinja.coexistenceMode`              | `auto`                     | Coexistence with Agent Resources Ninja (`auto` / `independent`)                     |
|  16   | `skillNinja.useSharedSourcesManifest`     | `false`                    | Share source-list SSOT with Agent Resources Ninja via `~/.agent-ninja/sources.json` |

> Settings are displayed in the order above

Legacy compatibility setting: `skillNinja.includeLocalSkills` is deprecated. Workspace skills stay scoped to `skillNinja.skillsDirectory` and `skillNinja.additionalSkillRoots`, while personal roots and additional user/global roots are discovered from `skillNinja.useVsCodeAgentSkillLocations`. Configured locations support `${workspaceFolder}`, `${userHome}`, `${env:APPDATA}`, and `%APPDATA%`. Built-in read-only skills are controlled by `skillNinja.showBuiltInSkills` and are shown by default.

### Coexistence with Agent Resources Ninja

When the companion extension [Agent Resources Ninja](https://marketplace.visualstudio.com/items?itemName=yamapan.agent-resources-ninja) is also installed, both extensions cooperate so that AGENTS.md / CLAUDE.md / etc. always contains exactly **one shared block** (`<!-- agent-ninja-START -->` / `<!-- agent-ninja-END -->`). Resources Ninja is the owner whenever both are active; Skill Ninja silently defers and migrates any pre-existing `<!-- skill-ninja-* -->` block into the shared marker.

Remote skills installed by either extension reuse the same `.skill-meta.json` contract. In coexistence mode, Skill Ninja now treats those shared metadata files as the source of truth for registration state as well, so skills installed from Resources Ninja still appear as managed skills and keep reinstall / unregister actions in Skill Ninja.

Local workspace skills managed by Resources Ninja keep `source: "local"` metadata. Skill Ninja lists them as local skills, but does not treat them as missing from the remote skill index and excludes them from remote-index reinstall commands.

If the sibling extension is uninstalled, Skill Ninja takes over the same shared block on the next `vscode.extensions.onDidChange` event — no parallel blocks, no orphan markers, no manual cleanup needed in the normal case.

Optional shared source list: enable `skillNinja.useSharedSourcesManifest` when you want Skill Ninja and Agent Resources Ninja to reuse the same remote source definitions through `~/.agent-ninja/sources.json`. This shares the source list only; each extension still refreshes and stores its own index contents.

#### Note: `resourceNinja.kindsExcluded` after uninstalling Skill Ninja

If you have used Resources Ninja with `resourceNinja.kindsExcluded` containing `"skill"` (the standalone default) and then **uninstall Skill Ninja**, Resources Ninja will fall back to its standalone behavior and re-apply that exclusion — i.e. the **skill rows will disappear** from the shared block. To bring them back:

1. Remove `"skill"` from `resourceNinja.kindsExcluded` in your settings, **or**
2. Run `Agent Resources Ninja: Recompute Coexistence Ownership` after editing the setting.

While Skill Ninja is active, Resources Ninja ignores `kindsExcluded` at runtime and writes all kinds (including skill) into the shared block, so this only affects the post-uninstall state.

Set `skillNinja.coexistenceMode` to `independent` to opt out and keep the legacy `<!-- skill-ninja-* -->` block regardless of Resources Ninja (advanced, allows parallel blocks). See [`.github/instructions/SkillList.instructions.md`](.github/instructions/SkillList.instructions.md) for the full contract.

Diagnostics: `Agent Skills Ninja: Show Coexistence Status` / `Recompute Coexistence Ownership` / `Clean Up Orphan Instruction Block`.

### Output Format Details

| Format    | Content                                                          | Best For                                  |
| --------- | ---------------------------------------------------------------- | ----------------------------------------- |
| `ref`     | IMPORTANT + link in instruction file; catalog in a separate file | Always-loaded context hygiene _(Default)_ |
| `full`    | IMPORTANT + Detailed table (200 chars)                           | Complete information in one file          |
| `compact` | IMPORTANT + Compressed index (100 chars)                         | Token-efficient prompts in one file       |
| `legacy`  | Simple table only (no IMPORTANT)                                 | Backward compatibility                    |

When using `ref`, configure `skillNinja.refCatalogPath` (where the catalog is written) and `skillNinja.refCatalogFormat` (`full` / `compact` / `legacy`) to set the detail level inside that catalog file.

### How Instruction File Sync Works

When `autoUpdateInstruction` is enabled:

1. **Install/Uninstall skill** → Instruction file is automatically updated
2. **Managed SKILL.md detected under each writable root** → Included in that root's managed section
3. **Manual Update Instruction File** → Regenerates the managed section for every writable root

The instruction file contains a managed section with **IMPORTANT prompt** and **Description column**:

```markdown
<!-- agent-ninja-START -->

## Agent Skills

> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.
> Read the relevant SKILL.md before working on tasks covered by these skills.

### Skills

| Skill                                            | Description                          |
| ------------------------------------------------ | ------------------------------------ |
| [skill-name](.github/skills/skill-name/SKILL.md) | Description text \| When to use text |

<!-- agent-ninja-END -->
```

**Description column format**: `{description:80} | {whenToUse:80}` (max 160 chars total)

### Instruction File Options

| Value                                            | File Path                                        | Use Case                    |
| ------------------------------------------------ | ------------------------------------------------ | --------------------------- |
| `AGENTS.md`                                      | `AGENTS.md` (root)                               | Recommended: General        |
| `.github/copilot-instructions.md`                | `.github/copilot-instructions.md`                | GitHub Copilot              |
| `.github/instructions/SkillList.instructions.md` | `.github/instructions/SkillList.instructions.md` | Copilot Instructions folder |
| `CLAUDE.md`                                      | `CLAUDE.md` (root)                               | Claude Code                 |
| `custom`                                         | Any path (set in customInstructionPath)          | Custom                      |

## 🔑 GitHub Token Setup

> **Important**: GitHub authentication is required for private source repositories and strongly recommended for GitHub Search. Without it, API rate limits (60 requests/hour) will be exhausted quickly and searches may fail.

Set up GitHub authentication to enable full search functionality and private source repositories. Agent Skills Ninja resolves tokens in this order: VS Code SecretStorage, `GITHUB_TOKEN` / `GH_TOKEN`, `gh` CLI, then the legacy `skillNinja.githubToken` setting.

### Option 1: GitHub CLI (Recommended)

```bash
gh auth login
```

If GitHub CLI is installed, the token is automatically retrieved and no extension setting is required.

### Option 2: Environment Variable

Set `GITHUB_TOKEN` or `GH_TOKEN` in your shell or OS environment. This avoids storing credentials in VS Code settings.

### Option 3: Legacy VS Code Setting

Find `Agent Skills Ninja: GitHub Token` in settings and enter your token:

```json
{
  "skillNinja.githubToken": "<github-token>"
}
```

When this legacy setting is present, Agent Skills Ninja copies the value into VS Code SecretStorage and uses the secure copy first. The setting is retained for backward compatibility and reset workflows.

For private repositories, prefer a fine-grained personal access token limited to the selected repositories with `Contents: read`. Classic personal access tokens need the `repo` scope to read private repositories.

👉 [Create a fine-grained GitHub Token](https://github.com/settings/personal-access-tokens/new?name=Agent%20Skill%20Ninja&description=Read%20skill%20source%20repositories&contents=read)

## 🛠️ Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Build in watch mode
npm run watch

# Package
npm run package

# Lint
npm run lint
```

### Debugging

1. Press `F5` in VS Code
2. Test the extension in a new VS Code window
3. Run `Agent Skills Ninja` commands from Command Palette (`Ctrl+Shift+P`)

## Contributing

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) © [yamapan](https://github.com/aktsmm)

- Free for non-commercial use, modification, and redistribution
- Commercial use requires permission
- Microsoft employees may use for work purposes

> Use of this content for AI/ML training, data mining, or other analytical purposes is prohibited.

## 🔗 Related Projects

- [anthropics/skills](https://github.com/anthropics/skills) - Official Claude Skills
- [google/skills](https://github.com/google/skills) - Official Google Skills (bundled in preset)
- [github/awesome-copilot](https://github.com/github/awesome-copilot) - Official Copilot Resources
- [microsoft/skills](https://github.com/microsoft/skills) - Upstream Microsoft Skills reference (not bundled in preset)
- [MicrosoftDocs/Agent-Skills](https://github.com/MicrosoftDocs/Agent-Skills) - Official Azure Agent Skills (bundled in preset)
- [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) - Curated Skills List

## 👤 Author

yamapan (https://github.com/aktsmm)
