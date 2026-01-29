# Changelog

All notable changes to the "Agent Skill Ninja" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.1] - 2026-01-30

### Added

- 📜 **LICENSE.txt からライセンス名抽出** - "Complete terms in LICENSE.txt" のような曖昧な記述の場合、LICENSE.txt の内容から実際のライセンス名を抽出 / Auto-extract license name from LICENSE.txt when SKILL.md has ambiguous license field
- ✅ **対応ライセンス** - MIT, Apache-2.0, GPL, BSD, CC BY-NC-SA 4.0, Anthropic Proprietary など / Supports common licenses

## [0.8.0] - 2026-01-30

### Added

- 🔄 **スキル自動更新機能** - 拡張機能アップデート時にインストール済みスキルを自動更新 / Auto-update installed skills when extension is upgraded
- ⚙️ **設定追加** - `autoUpdateSkillsOnUpgrade`: `always` / `prompt` / `never` から選択 / New setting to control skill auto-update behavior

## [0.7.3] - 2026-01-30

### Changed

- 📜 **プリセットインデックス更新** - 35件 license、12件 author、最新 description を取得 / Updated preset index with latest metadata (35 licenses, 12 authors)

## [0.7.2] - 2026-01-30

### Changed

- 📝 **フォーマット簡略化** - Markdown / Compressed Index の出力を統一、Vercel 宣伝文を削除 / Simplified output formats, removed Vercel promotional text
- 🆕 **Compressed Index** - Description のみ100文字の超圧縮版に変更 / Now uses description only (100 chars max)
- 🆕 **Markdown** - Description + WhenToUse 200文字版に変更 / Now uses description + whenToUse (200 chars max)

## [0.7.1] - 2026-01-30

### Changed

- 📜 **プリセットインデックス更新** - license/author 情報をプリセットにマージ（9件 license, 10件 author） / Merged license/author metadata into preset index

## [0.7.0] - 2026-01-30

### Added

- 📝 **Description 200文字対応** - 合計最大200文字に拡張（片方が短ければもう片方に回す） / Extended to max 200 chars total (dynamic allocation)
- 📜 **author/license/version 取得** - インデックス更新時に frontmatter から取得、ツールチップに表示 / Fetch author/license/version from frontmatter during index update

## [0.6.9] - 2026-01-30

### Added

- 🔄 **Description フォールバック** - frontmatter に description がない場合、When to Use セクションから自動抽出 / Fallback to When to Use section when frontmatter description is missing

## [0.6.8] - 2026-01-30

### Fixed

- 🛠️ **メタデータ自動更新** - SKILL.md の保存時に `.skill-meta.json` の description/whenToUse を自動更新 / Auto-refresh description and whenToUse in `.skill-meta.json` when SKILL.md changes
- 🧩 **依存表示の維持** - リモートスキルで依存がある場合もツールチップの説明・ライセンス・著者が消えないように修正 / Preserve tooltip metadata when skills have dependencies

## [0.6.7] - 2026-01-30

### Fixed

- 🐛 **Description 文字数修正** - 全形式で Description + When to Use を連結（各最大80文字、合計160文字）が正しく動作するように修正 / Fixed description truncation to work correctly across all formats (80+80=160 chars max)

## [0.6.6] - 2026-01-30

### Changed

- 📝 **ツールチップ改善** - リモートスキルのマウスオーバー時にカテゴリではなくライセンス・作成者・バージョンを表示 / Show license, author, version instead of categories in tooltip

## [0.6.5] - 2026-01-30

### Changed

- 📝 **Description 列** - Compressed Index のテーブル列を `When to Use` から `Description` に変更。Description + When to Use を連結表示（各最大80文字、合計160文字） / Changed table column from "When to Use" to "Description", combining description and when-to-use text

## [0.6.4] - 2026-01-30

### Changed

- 🌐 **英日併記** - 日本語版設定のラベルに英語を併記 / Added English labels to Japanese settings for clarity

## [0.6.3] - 2026-01-30

### Fixed

- 🔄 **リポジトリ単位の更新** - `skillNinja.updateSourceIndex` コマンドが登録されていなかったバグを修正 / Fixed updateSourceIndex command not being registered

## [0.6.2] - 2026-01-30

### Fixed

- 📁 **設定変更時のクリーンアップ** - Cursor/Windsurf/Cline のファイルも候補に追加 / Added Cursor/Windsurf/Cline files to cleanup candidates

## [0.6.1] - 2026-01-30

### Added

- 🧠 **IMPORTANT プロンプト追加** - Vercel 調査に基づき、全形式に "Prefer skill-led reasoning over pre-training-led reasoning" を追加 / Added IMPORTANT prompt to all formats

## [0.6.0] - 2026-01-30

### ⚠️ Breaking Changes

- **設定の簡素化** - `outputFormat` と `instructionFile` を明確に分離
  - `outputFormat`: スキルリストの表示形式のみ（markdown, compressed-index, markdown-with-index）
  - `instructionFile`: 出力先ファイル（AGENTS.md, CLAUDE.md, .cursor/rules/, .windsurfrules, .clinerules など）
  - `cursor-rules`, `windsurf-rules`, `cline-rules` は `outputFormat` から削除され `instructionFile` に移動

### Added

- 🎯 **ツール別出力先** - Cursor (.cursor/rules/skills.mdc), Windsurf (.windsurfrules), Cline (.clinerules) を `instructionFile` に追加

### Changed

- 📝 **設定 UI 改善** - 各設定の説明をわかりやすく改善、テーブルでツールとファイルの対応を表示

## [0.5.3] - 2026-01-29

### Fixed

- 🧹 **古いファイルのクリーンアップ** - インストラクションファイル変更時、古いファイルからスキルセクションを削除 / Clean up old files when changing instruction file
- 📝 **説明文改善** - 設定の説明をよりわかりやすく改善 / Improved settings description

## [0.5.2] - 2026-01-29

### Added

- 📄 **メタデータ表示** - ツールチップに License, Author, Version を表示 / Show license, author, version in tooltip
- 📝 **SKILL.md テンプレート更新** - 公式仕様に従ったライセンス、メタデータ欄を追加 / Updated template with license and metadata fields

### Fixed

- 🏷️ **README バッジ修正** - 静的バッジに変更して Rate Limit エラーを回避 / Fixed badges to avoid rate limit errors

## [0.5.1] - 2026-01-29

### Added

- 🔄 **設定変更時の自動更新** - `instructionFile` や `outputFormat` の変更時に AGENTS.md を自動更新 / Auto-update AGENTS.md when settings change

### Changed

- 🏷️ **カテゴリー変更** - Marketplace のカテゴリーを AI, Chat, Other に変更 / Updated categories to AI, Chat, Other

## [0.5.0] - 2026-01-29

### Added

- 🚀 **Compressed Index Format (PREVIEW)** - Vercel-style output format achieving 100% pass rate in agent evals / Vercel方式の圧縮インデックス形式でエージェント評価100%パス
  - [📖 Research](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)
- 🌟 **Markdown + Index (Both)** - Combine traditional table with compressed index / 従来テーブルと圧縮インデックスの併用
- 📋 **Output Format setting moved to top** - Most important setting now first / 出力フォーマット設定を最上部に移動

### Changed

- ⚠️ Settings description now includes usage notes and research link / 設定の説明に使用注意と調査リンクを追加

## [0.4.14] - 2026-01-29

### Changed

- 🏷️ **README Badges** - Added version, installs, license badges and quick install button / README にバージョン・インストール数・ライセンスバッジとクイックインストールボタンを追加

## [0.4.13] - 2026-01-29

### Added

- 📁 **Nested Skill Support** - Recursively scan subfolders to detect nested skills (e.g., `document-skills/docx/SKILL.md`) / サブフォルダを再帰的にスキャンしてネストされたスキルを検出
- 📍 **Relative Path in AGENTS.md** - Links now use correct relative path for nested skills / AGENTS.md のリンクがネストされたスキルの正しい相対パスを使用

## [0.4.12] - 2026-01-29

### Improved

- ✨ **Table Format Full Extraction** - When to Use now extracts ALL columns from tables in "key: value" format, not just first column / テーブル形式の When to Use から全列を「キー: 値」形式で抽出（最初の列のみではなく）
- 📏 **More Informative Output** - AGENTS.md now shows up to 200 chars of detailed context instead of just keywords / AGENTS.md にキーワードだけでなく詳細なコンテキストを200文字まで表示

## [0.4.11] - 2026-01-29

### Fixed

- 🐛 **Fallback Template Detection** - When "When to Use" is fallback pattern like "{name} skill" or too short (<15 chars), use description instead / 「When to Use」がフォールバックパターン（「{name} skill」）または短すぎる場合は description を使用

## [0.4.10] - 2026-01-29

### Changed

- 📝 **Docs** - Clarify installation path is configurable in settings / インストールパスが設定で変更可能であることを明記

## [0.4.9] - 2026-01-29

### Added

- 🔄 **Auto Metadata Refresh** - Automatically refreshes skill metadata (whenToUse) when extension is updated / 拡張機能のアップデート時にスキルのメタデータ（whenToUse）を自動で再抽出

## [0.4.8] - 2026-01-29

### Fixed

- 🐛 **When to Use Extraction Fix** - Fixed incorrect extraction of "When to Use" section from SKILL.md. Now correctly handles bullet lists, tables, and numbered lists / SKILL.md からの "When to Use" セクション抽出のバグを修正。箇条書き・テーブル・番号リストに正しく対応

### Improved

- ✨ **Better Table Support** - "When to Use" section with table format now extracts first column values correctly / テーブル形式の When to Use セクションから最初の列を正しく抽出
- 📏 **200 Character Optimization** - Includes as many items as possible within 200 character limit instead of fixed 3 items / 固定3項目ではなく200文字以内で可能な限り多くの項目を結合

## [0.4.7] - 2026-01-28

### Changed

- 📦 **Build** - Exclude `.github/` folder from VSIX package to prevent prompt duplication / パッケージから `.github/` フォルダを除外し、プロンプト二重表示を防止

## [0.4.6] - 2026-01-28

### Fixed

- 🐛 **Skill Install Fix** - Fixed SKILL.md being overwritten with fallback content when subdirectory download fails ([#1](https://github.com/aktsmm/vscode-agent-skill-ninja/issues/1)) / サブディレクトリのダウンロード失敗時に SKILL.md がフォールバック版で上書きされる問題を修正

### Added

- 📦 **Skill Index v1.12.0** - Updated with 63 new skills from multiple sources (178 → 241 total) / 63 個の新スキルを追加

### Recommended

- 💡 **GitHub Token** - Setting `skillNinja.githubToken` is recommended to avoid API rate limits (60 → 5000 requests/hour) / API レート制限回避のため GitHub Token の設定を推奨

## [0.4.4] - 2026-01-22

### Fixed

- 🐛 **Copy Path Fix** - Fixed right-click "Copy Path" not working for installed skills / インストール済みスキルの「パスをコピー」が機能しない問題を修正
- 🔗 **Changelog Link Fix** - Fixed 404 error when opening changelog from settings (main → master branch) / 設定からの変更履歴リンクが404になる問題を修正

## [0.4.3] - 2026-01-21

### Added

- 📦 **Skill Index v1.11.0** - Added 8 new skills from GitHub awesome-copilot and OpenAI (170 → 178 total)

### New Skills Added

**GitHub Awesome Copilot (5 new):**

- `azure-static-web-apps` - Create, configure, deploy Azure Static Web Apps / SWA CLI でデプロイ
- `make-skill-template` - Create new Agent Skills from prompts/templates / スキル作成テンプレート
- `microsoft-code-reference` - Look up Microsoft API references with MS Learn MCP / API参照・SDK検証
- `microsoft-docs` - Query official Microsoft documentation / Microsoft公式ドキュメント検索

**OpenAI Skills (4 new):**

- `gh-address-comments` - Address PR review comments using gh CLI / PRレビューコメント対応
- `gh-fix-ci` - Inspect and fix failing GitHub Actions checks / CI失敗の調査と修正
- `notion-meeting-intelligence` - Prepare meeting materials with Notion context / 会議資料準備
- `notion-research-documentation` - Research Notion content and produce reports / リサーチドキュメント作成

## [0.4.2] - 2026-01-19

### Fixed

- 📝 **README Update** - Added OpenAI Skills to Included Skill Sources table / スキルソース一覧にOpenAI Skillsを追加

## [0.4.1] - 2026-01-19

### Changed

- 📝 **Bilingual Changelog** - Updated changelog to English/Japanese bilingual format / チェンジログを日英併記に変更

## [0.4.0] - 2026-01-19

### Added

- 🆕 **OpenAI Skills (Official)** - Added official OpenAI Codex Skills repository as a new source (1.7k+ Stars)
- 📦 **Skill Index v1.10.0** - Added 6 new skills from OpenAI (164 → 170 total)

### New Skills Added

**OpenAI Skills (6 new):**

- `skill-creator` - Guide for creating Codex skills / Codex スキル作成ガイド
- `skill-installer` - Install skills from curated list or GitHub / スキルのインストール
- `linear` - Manage issues, projects & workflows in Linear / Linear 連携
- `create-plan` - Create concise plans for coding tasks / プラン作成
- `notion-knowledge-capture` - Capture and organize knowledge in Notion / Notion ナレッジ保存
- `notion-spec-to-implementation` - Convert Notion specs to implementation / 仕様→実装変換

## [0.3.9] - 2026-01-15

### Fixed

- 🐛 **Add Source Command** - Fixed `m.match is not a function` error when adding source from TreeView / TreeView からソース追加時のエラーを修正

## [0.3.8] - 2026-01-15

### Added

- ℹ️ **Version Info in Settings** - View extension version, skill index version, and stats directly in VS Code settings / 設定画面でバージョン情報を表示
- 📦 **Skill Index v1.9.0** - Updated with 23 new skills (141 → 164 total) / 23個の新スキル追加

### New Skills Added

**GitHub Awesome Copilot (9 new):**

- `appinsights-instrumentation` - Application Insights instrumentation / 計装
- `azure-resource-visualizer` - Azure resource visualization / リソース可視化
- `azure-role-selector` - Azure RBAC role selection / ロール選択
- `github-issues` - GitHub Issue management / Issue 管理
- `nuget-manager` - NuGet package management / パッケージ管理
- `snowflake-semanticview` - Snowflake semantic view / セマンティックビュー
- `vscode-ext-commands` - VS Code extension commands / 拡張コマンド作成
- `vscode-ext-localization` - VS Code extension localization / 拡張ローカライズ
- `web-design-reviewer` - Web design review / デザインレビュー

**PAI Packs (5 new):**

- `pai-algorithm-skill` - Structured task execution / 構造化タスク実行
- `pai-hook-system` - Event-driven automation / イベント駆動自動化
- `pai-observability-server` - Agent monitoring / エージェント監視
- `pai-upgrades-skill` - System updates / システムアップデート
- `pai-voice-system` - Voice interaction / 音声インタラクション

**Context Engineering (6 new):**

- `bdi-mental-states` - BDI mental states / メンタルステート
- `filesystem-context` - Filesystem context / ファイルシステムコンテキスト
- `hosted-agents` - Hosted agents / ホステッドエージェント
- `memory-systems` - Memory systems / メモリシステム
- `multi-agent-patterns` - Multi-agent patterns / マルチエージェントパターン
- `project-development` - Project development workflow / プロジェクト開発

**ComposioHQ (3 new):**

- `connect-apps` - App connection & integration / アプリ接続・統合
- `langsmith-fetch` - LangSmith data fetching / データ取得
- `tailored-resume-generator` - Customized resume generation / 履歴書生成

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
