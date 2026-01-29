# 🥷 Agent Skill Ninja

<p align="center">
  <strong>Search, Install, and Manage Agent Skills for AI Coding Assistants</strong>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=yamapan.agent-skill-ninja">
    <img src="https://img.shields.io/badge/VS%20Code-Marketplace-007ACC?style=for-the-badge&logo=visual-studio-code&logoColor=white" alt="VS Code Marketplace">
  </a>
  <a href="https://github.com/aktsmm/vscode-agent-skill-ninja/blob/master/LICENSE">
    <img src="https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey?style=for-the-badge" alt="License CC BY-NC-SA 4.0">
  </a>
  <a href="https://github.com/aktsmm/vscode-agent-skill-ninja">
    <img src="https://img.shields.io/badge/GitHub-Source-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub">
  </a>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=yamapan.agent-skill-ninja">
    <img src="https://img.shields.io/badge/Install%20Now-VS%20Code%20Marketplace-007ACC?style=for-the-badge&logo=visual-studio-code&logoColor=white" alt="Install from VS Code Marketplace">
  </a>
</p>

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

### IMPORTANT Prompt

All output formats include the **IMPORTANT prompt** that instructs agents to prioritize skill files:

```markdown
> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.
> Read the relevant SKILL.md before working on tasks covered by these skills.
```

### Example Output (AGENTS.md)

```markdown
<!-- skill-ninja-START -->

## Agent Skills (Compressed Index)

> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.
> Read the relevant SKILL.md before working on tasks covered by these skills.

### Skills Index

| Skill                                | Path   | Description                                           |
| ------------------------------------ | ------ | ----------------------------------------------------- |
| [docx](.github/skills/docx/SKILL.md) | `docx` | Process Word documents (.docx)                        |
| [pdf](.github/skills/pdf/SKILL.md)   | `pdf`  | PDF manipulation toolkit \| Extract text, create PDFs |

<!-- skill-ninja-END -->
```

### How to Enable

Settings → **Output Format** → `Compressed Index`

---

## 🥷 Features

### 📁 Local Skill Management

- Auto-detect **SKILL.md** files anywhere in workspace
- Automatically sync to instruction file (with `includeLocalSkills` setting)
- Manual register / unregister commands
- Create new skill from template

### 🔍 Skill Search & Discovery

- Search **100+ skills** by keyword (local & GitHub)
- **Multi-keyword Search** - Scored by name, path, description relevance
- **Parallel Fetch** - Fast results with 50 concurrent requests
- **Fallback Search** - Auto-retry with fewer keywords if no results
- Search results with descriptions & category tags
- Star counts & organization badges
- Install / Preview / Favorite directly from search results

### 📦 Install & Manage

- One-click installation (default: `.github/skills/`, configurable in settings)
- Auto-update **instruction file** (AGENTS.md / copilot-instructions.md / CLAUDE.md)
- **Table Format** - Skills displayed in table with "When to Use" column
- **Auto-extract "When to Use"** - Extracted from SKILL.md `## When to Use` section
- **Edit Description** - Right-click to customize skill description
- Uninstall functionality
- **Reinstall All** - Batch reinstall from latest source (with auto index update)
- **Install Feedback** - NEW badge, status bar notification, auto-select in tree view
- **Open Folder** - Quick access to installed skill folder
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
- **8 Tools**: `#searchSkills`, `#installSkill`, `#uninstallSkill`, `#listSkills`, `#recommendSkills`, `#updateSkillIndex`, `#webSearchSkills`, `#addSkillSource`
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

Or search for **"Agent Skill Ninja"** in VS Code Extensions (`Ctrl+Shift+X`)

### Manual Installation

1. Download `.vsix` from [Releases](https://github.com/aktsmm/vscode-agent-skill-ninja/releases)
2. In VS Code: `Ctrl+Shift+P` → `Extensions: Install from VSIX...`
3. Select the downloaded `.vsix` file

## 📚 Included Skill Sources

| Source                                                                                                                        | Type      | Description                          |
| ----------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------ |
| [anthropics/skills](https://github.com/anthropics/skills)                                                                     | Official  | Anthropic official Claude Skills     |
| [openai/skills](https://github.com/openai/skills)                                                                             | Official  | OpenAI official Codex Skills (1.7k+) |
| [github/awesome-copilot](https://github.com/github/awesome-copilot)                                                           | Official  | GitHub official Copilot resources    |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills)                                       | Curated   | Curated Claude Skills list           |
| [obra/superpowers](https://github.com/obra/superpowers)                                                                       | Community | High-quality skills & agents         |
| [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) | Community | Context Engineering skills (5k+)     |
| [danielmiessler/Personal_AI_Infrastructure](https://github.com/danielmiessler/Personal_AI_Infrastructure)                     | Community | PAI Packs - Skills & Features        |
| [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin)                               | Community | Compound Engineering (3.5k+)         |
| [Wirasm/PRPs-agentic-eng](https://github.com/Wirasm/PRPs-agentic-eng)                                                         | Community | PRP (Prompt Recipe Patterns)         |
| [qdhenry/Claude-Command-Suite](https://github.com/qdhenry/Claude-Command-Suite)                                               | Community | Claude commands & skills             |

> Use `Update Index` command to fetch the latest skills

## 🥷 Usage

### Sidebar Operations

1. Click the **spiral shuriken icon** in the Activity Bar
2. **Workspace Skills** - Installed & local skills list
   - Installed skills (green icon) with source name
   - Local skills (unregistered, yellow icon)
   - Newly installed skills (temporary badge)
   - Toolbar: Instruction File / Create / Refresh / Settings
   - Menu: Reinstall All / Uninstall All / Multiple selection
   - Open skill folder (right-click menu)
3. **Remote Skills** - Browse skills by source
   - **Favorites** section at top
   - Sources sorted: Official → Curated → Community
   - Shows installed status with green icons
   - One-click install from list

### Icon Legend

| Icon               | Meaning                                          |
| ------------------ | ------------------------------------------------ |
| check (green)      | Installed skill                                  |
| circle (yellow)    | Local skill (not registered in instruction file) |
| NEW badge          | Recently installed (temporary badge)             |
| star-full (yellow) | Favorites section                                |
| verified (blue)    | Official source (Anthropic, GitHub)              |
| star (yellow)      | Curated awesome-list                             |
| repo               | Community repository                             |

### Command Palette

| Command                                       | Description                              |
| --------------------------------------------- | ---------------------------------------- |
| `Agent Skill Ninja: Search Skills`            | Search and install skills                |
| `Agent Skill Ninja: Update Index`             | Update index from all sources            |
| `Agent Skill Ninja: Search on GitHub`         | Search skills on GitHub                  |
| `Agent Skill Ninja: Add Source Repository`    | Add new source repository                |
| `Agent Skill Ninja: Remove Source Repository` | Remove source repository                 |
| `Agent Skill Ninja: Uninstall Skill`          | Uninstall a skill                        |
| `Agent Skill Ninja: Show Installed Skills`    | Show installed skills                    |
| `Agent Skill Ninja: Create New Skill`         | Create new local skill                   |
| `Agent Skill Ninja: Register Local Skill`     | Register local skill to instruction file |
| `Agent Skill Ninja: Unregister Local Skill`   | Unregister from instruction file         |
| `Agent Skill Ninja: Reinstall All`            | Reinstall all skills from latest source  |
| `Agent Skill Ninja: Uninstall All`            | Uninstall all skills (with confirmation) |
| `Agent Skill Ninja: Uninstall Multiple`       | Select multiple skills to uninstall      |
| `Agent Skill Ninja: Reinstall Multiple`       | Select multiple skills to reinstall      |
| `Agent Skill Ninja: Update Instruction`       | Update instruction file manually         |
| `Agent Skill Ninja: Open Skill Folder`        | Open installed skill folder in OS        |

### Quick Start

```
1. Ctrl+Shift+P → "Agent Skill Ninja: Search Skills"
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

| Tool Reference      | Description                       |
| ------------------- | --------------------------------- |
| `#searchSkills`     | Search skills by keyword          |
| `#installSkill`     | Install a skill                   |
| `#uninstallSkill`   | Uninstall a skill                 |
| `#listSkills`       | List installed skills             |
| `#recommendSkills`  | Get project-based recommendations |
| `#updateSkillIndex` | Update skill index                |
| `#webSearchSkills`  | Web search skills on GitHub       |
| `#addSkillSource`   | Add new skill source              |

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
- **Settings Integration**: Respects `autoUpdateInstruction` / `includeLocalSkills`
- **Token Efficiency**: Save conversation context by using MCP tools

### Disable MCP Tools

If you don't need MCP tools, you can disable them from GitHub Copilot Chat:

1. Copilot Chat panel → Settings → Tools
2. Toggle off "Agent Skill Ninja" tools

## ⚙️ Settings

| Order | Setting                            | Default          | Description                                                 |
| :---: | ---------------------------------- | ---------------- | ----------------------------------------------------------- |
|   1   | `skillNinja.autoUpdateInstruction` | `true`           | **Auto-update instruction file on install**                 |
|   2   | `skillNinja.instructionFile`       | `AGENTS.md`      | Instruction file format _(requires Auto Update)_            |
|   3   | `skillNinja.customInstructionPath` | `""`             | Custom path _(only when 'custom' selected)_                 |
|   4   | `skillNinja.includeLocalSkills`    | `true`           | Include local skills in instruction file                    |
|   5   | `skillNinja.skillsDirectory`       | `.github/skills` | Directory to install skills                                 |
|   6   | `skillNinja.githubToken`           | `""`             | GitHub Token (for API rate limit)                           |
|   7   | `skillNinja.language`              | `auto`           | UI language (auto / en / ja)                                |
|   8   | `skillNinja.outputFormat`          | `auto`           | Output format (auto / markdown / cursor / windsurf / cline) |
|   9   | `skillNinja.enableToolDetection`   | `true`           | Auto-detect AI tools in workspace                           |

> Settings are displayed in the order above

### Output Format Details

| Format           | File                       | Compatible Tools            |
| ---------------- | -------------------------- | --------------------------- |
| `markdown`       | AGENTS.md, CLAUDE.md, etc. | GitHub Copilot, Claude Code |
| `cursor-rules`   | .cursor/rules/skills.mdc   | Cursor                      |
| `windsurf-rules` | .windsurfrules             | Windsurf                    |
| `cline-rules`    | .clinerules                | Cline                       |

When `auto` is selected, the extension automatically detects which AI tool is being used based on configuration files in your workspace.

### How Instruction File Sync Works

When `autoUpdateInstruction` is enabled:

1. **Install/Uninstall skill** → Instruction file is automatically updated
2. **Local SKILL.md detected** → Added to instruction file (if `includeLocalSkills` is true)
3. **Register/Unregister command** → Manual control for local skills

The instruction file contains a managed section with **IMPORTANT prompt** and **Description column**:

```markdown
<!-- skill-ninja-START -->

## Agent Skills (Compressed Index)

> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.
> Read the relevant SKILL.md before working on tasks covered by these skills.

### Skills Index

| Skill                                            | Path         | Description                          |
| ------------------------------------------------ | ------------ | ------------------------------------ |
| [skill-name](.github/skills/skill-name/SKILL.md) | `skill-name` | Description text \| When to use text |

<!-- skill-ninja-END -->
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

> **Important**: GitHub Token is **required** for GitHub Search. Without it, API rate limits (60 requests/hour) will be exhausted quickly and searches will fail.

Set up a GitHub Token to enable full search functionality:

### Option 1: VS Code Settings

Find `Agent Skill Ninja: GitHub Token` in settings and enter your token:

```json
{
  "skillNinja.githubToken": "ghp_xxxxxxxxxxxx"
}
```

👉 [Create a GitHub Token](https://github.com/settings/tokens/new?description=Agent%20Skill%20Ninja&scopes=repo,read:org) (Required scopes: `repo`, `read:org`)

### Option 2: GitHub CLI (Recommended)

```bash
gh auth login
```

> If GitHub CLI is installed, the token is automatically retrieved (no configuration needed)

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
3. Run `Agent Skill Ninja` commands from Command Palette (`Ctrl+Shift+P`)

## � Contributing

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
- [github/awesome-copilot](https://github.com/github/awesome-copilot) - Official Copilot Resources
- [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) - Curated Skills List

## 👤 Author

yamapan (https://github.com/aktsmm)
