# Changelog

All notable changes to the "Agent Skill Ninja" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.8] - 2026-01-15

### Added

- ℹ️ **Version Info in Settings** - View extension version, skill index version, and stats directly in VS Code settings
- 📦 **Skill Index v1.9.0** - Updated with 23 new skills (141 → 164 total)

### New Skills Added

**GitHub Awesome Copilot (9 new):**
- `appinsights-instrumentation` - Application Insights計装
- `azure-resource-visualizer` - Azureリソース可視化
- `azure-role-selector` - Azure RBACロール選択
- `github-issues` - GitHub Issue管理
- `nuget-manager` - NuGetパッケージ管理
- `snowflake-semanticview` - Snowflakeセマンティックビュー
- `vscode-ext-commands` - VS Code拡張コマンド作成
- `vscode-ext-localization` - VS Code拡張ローカライズ
- `web-design-reviewer` - Webデザインレビュー

**PAI Packs (5 new):**
- `pai-algorithm-skill` - 構造化タスク実行
- `pai-hook-system` - イベント駆動自動化
- `pai-observability-server` - エージェント監視
- `pai-upgrades-skill` - システムアップデート
- `pai-voice-system` - 音声インタラクション

**Context Engineering (6 new):**
- `bdi-mental-states` - BDIメンタルステート
- `filesystem-context` - ファイルシステムコンテキスト
- `hosted-agents` - ホステッドエージェント
- `memory-systems` - メモリシステム
- `multi-agent-patterns` - マルチエージェントパターン
- `project-development` - プロジェクト開発ワークフロー

**ComposioHQ (3 new):**
- `connect-apps` - アプリ接続・統合
- `langsmith-fetch` - LangSmithデータ取得
- `tailored-resume-generator` - カスタマイズ履歴書生成

## [0.3.6] - 2026-01-05

### Improved

- 💡 **MCP Tool Suggestions** - All MCP tools now show "Next Actions" suggestions after execution
- 🛡️ **No Auto-Execution** - Agent will NOT automatically execute suggested actions, waits for user choice

## [0.3.5] - 2026-01-05

### Changed

- 🎬 Updated demo GIF (table format showcase)

## [0.3.4] - 2026-01-05

### Changed

- 🎬 Updated demo GIF
- 📖 Added GitHub Token requirement warning to README

## [0.3.3] - 2026-01-05

### Added

- 📊 **Table Format for AGENTS.md** - Skills now displayed in table with "Skill" and "When to Use" columns
- 🔍 **Auto-extract "When to Use"** - Automatically extracts from `## When to Use` section in SKILL.md
- ✏️ **Edit Description** - Right-click installed skill → "Edit When to Use" to customize description
- 🔄 **Auto Index Update on Reinstall** - Prompts to update index when skills not found
- 🚀 **Startup Index Check** - Detects missing skills at startup and offers index update

### Improved

- 📝 **Fallback Description** - If no `## When to Use` section, extracts first paragraph after title
- 💾 **Preserve Custom Descriptions** - `customWhenToUse` preserved on skill reinstall
- 📏 **Longer Descriptions** - Increased max length from 80/120 to 200 characters
- 🔧 **Auto-generate Metadata** - Creates `.skill-meta.json` for legacy skills when editing
- 🎯 **Cursor/Windsurf/Cline Support** - All output formats now use whenToUse priority

### Fixed

- 🐛 Fixed metadata not found error when editing old skills without `.skill-meta.json`
- 🐛 Fixed index update function signature errors

## [0.1.0] - 2026-01-03

### Added

- 🔍 **Skill Search** - Search 220+ skills from local index
- 📦 **One-click Install** - Install skills to `.github/skills/`
- 📝 **AGENTS.md Auto-update** - Automatically register skills in instruction file
- 🌐 **GitHub Search** - Search and discover skills from GitHub
- 🔄 **Update Index** - Fetch latest skills from all sources
- ➕ **Add Source** - Add custom GitHub repositories as skill sources
- ➖ **Remove Source** - Remove skill sources from index
- 🌍 **i18n Support** - Japanese and English UI based on VS Code locale
- 🗂️ **Sidebar Views** - Browse installed skills and sources in sidebar
- 🔑 **GitHub Token Support** - Configure token for higher API rate limits
- 🤝 **gh CLI Integration** - Auto-detect token from GitHub CLI

### Skill Sources

- [anthropics/skills](https://github.com/anthropics/skills) - Official Claude Skills
- [github/awesome-copilot](https://github.com/github/awesome-copilot) - Official Copilot Resources
- [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) - Curated Skills
- [obra/superpowers](https://github.com/obra/superpowers) - Community Skills

### Supported Instruction Files

- `AGENTS.md` (recommended)
- `.github/copilot-instructions.md` (GitHub Copilot)
- `CLAUDE.md` (Claude Code)
- Custom path

---

## [0.0.1] - 2026-01-01

### Added

- Initial development version
- Basic skill search functionality
- QuickPick-based UI

[Unreleased]: https://github.com/aktsmm/vscode-agent-skill-ninja/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aktsmm/vscode-agent-skill-ninja/releases/tag/v0.1.0
[0.0.1]: https://github.com/aktsmm/vscode-agent-skill-ninja/releases/tag/v0.0.1
