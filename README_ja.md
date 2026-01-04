# Agent Skill Ninja 🥷

<p align="center">
  <strong>AI コーディングアシスタント用 Agent Skills の検索・インストール・管理</strong>
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

---

## Features

### 🔍 スキル検索・発見

- **100+ スキル** をキーワード検索（ローカル＆GitHub）
- **複数キーワード検索** - 名前・パス・説明の関連度でスコアリング
- **並列フェッチ** - 50 件同時取得で高速化
- **フォールバック検索** - 結果 0 件時にキーワードを減らして自動リトライ
- 説明文・カテゴリタグ付きの検索結果
- ⭐ スター数・組織バッジ表示
- 検索結果から直接インストール/プレビュー/お気に入り

### 📦 インストール・管理

- ワンクリックで `.github/skills/` に自動配置
- **instruction file** 自動更新（AGENTS.md / copilot-instructions.md / CLAUDE.md）
- アンインストール機能
- **全て再インストール** - 最新ソースから一括再インストール
- **インストール通知** - 🆕 バッジ、ステータスバー表示、ツリービューで自動選択
- **フォルダを開く** - インストール済みスキルのフォルダにクイックアクセス

### � マルチツール対応

- ワークスペース内の AI ツールを**自動検出**（Cursor, Windsurf, Cline, Claude Code, GitHub Copilot）
- 検出されたツールに基づいて出力形式を自動選択
- 設定で手動オーバーライド可能
- 対応出力形式:
  - Markdown（AGENTS.md, CLAUDE.md, copilot-instructions.md）
  - Cursor Rules（.cursor/rules/）
  - Windsurf Rules（.windsurfrules）
  - Cline Rules（.clinerules）

### �🏠 ローカルスキル管理

- ワークスペース内の **SKILL.md** を自動検出
- instruction file へ自動同期（`includeLocalSkills` 設定で制御）
- 手動での登録/解除コマンド
- テンプレートから新規スキル作成

### 🤖 GitHub Copilot Chat 連携

- `@skill` コマンドでチャットから直接操作
- `/search`, `/install`, `/list`, `/recommend`
- プロジェクトに基づくスキル推奨

### 🛠️ MCP ツール連携

- **Agent Mode** で自動的にツールとして利用可能
- **8 ツール**: `#searchSkills`, `#installSkill`, `#uninstallSkill`, `#listSkills`, `#recommendSkills`, `#updateSkillIndex`, `#webSearchSkills`, `#addSkillSource`
- 信頼度バッジ（🏢 Official / 📋 Curated / 👥 Community）
- インストール時に instruction file 自動更新

### 🌍 多言語・UI

- 日本語 / 英語 UI（自動検出 + 手動切替）
- Webview でスキルプレビュー
- お気に入り機能

## Screenshots

> 📸 スクリーンショットは近日追加予定

<!--
### サイドバー
![Sidebar](docs/screenshots/sidebar.png)

### スキル検索
![Search](docs/screenshots/search.png)

### インストール確認
![Install](docs/screenshots/install.png)
-->

## Installation

### VS Code Marketplace

```
ext install yamapan.agent-skill-ninja
```

または VS Code の拡張機能（`Ctrl+Shift+X`）で **"Agent Skill Ninja"** を検索

### 手動インストール

1. [Releases](https://github.com/aktsmm/vscode-agent-skill-ninja/releases) から `.vsix` をダウンロード
2. VS Code で `Ctrl+Shift+P` → `Extensions: Install from VSIX...`
3. ダウンロードした `.vsix` を選択

## Included Skill Sources

| Source                                                                                                                        | Type         | 説明                                |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------- |
| [anthropics/skills](https://github.com/anthropics/skills)                                                                     | 🏢 Official  | Anthropic 公式 Claude Skills        |
| [github/awesome-copilot](https://github.com/github/awesome-copilot)                                                           | 🏢 Official  | GitHub 公式 Copilot リソース        |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills)                                       | 📋 Curated   | Claude Skills キュレーションリスト  |
| [obra/superpowers](https://github.com/obra/superpowers)                                                                       | 👥 Community | 高品質スキル・エージェント集        |
| [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) | 👥 Community | Context Engineering スキル (5k+ ⭐) |
| [danielmiessler/Personal_AI_Infrastructure](https://github.com/danielmiessler/Personal_AI_Infrastructure)                     | 👥 Community | PAI Packs - スキル・フィーチャー集  |
| [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin)                               | 👥 Community | Compound Engineering (3.5k+ ⭐)     |
| [Wirasm/PRPs-agentic-eng](https://github.com/Wirasm/PRPs-agentic-eng)                                                         | 👥 Community | PRP (Prompt Recipe Patterns)        |
| [qdhenry/Claude-Command-Suite](https://github.com/qdhenry/Claude-Command-Suite)                                               | 👥 Community | Claude コマンド・スキル集           |

> 💡 `Update Index` コマンドで最新のスキルを取得できます

## Usage

### サイドバーから操作

1. アクティビティバーの **螺旋手裏剣アイコン** をクリック
2. **Workspace Skills** - インストール済み＆ローカルスキル一覧
   - ✓ インストール済みスキル（緑アイコン）とソース名を表示
   - ○ ローカルスキル（未登録、黄アイコン）
   - 🆕 新しくインストールしたスキル（一時的なバッジ）
   - ツールバー: 📄 Instruction / ➕ 新規作成 / 🔃 更新 / ⚙️ 設定
   - ... メニュー: 全て再インストール / 全削除 / 複数選択
   - 📂 スキルフォルダを開く（右クリックメニュー）
3. **Remote Skills** - ソース別にスキルを閲覧
   - ⭐ **お気に入り** セクションが最上部に表示
   - ソース順: 🏢 Official → ⭐ Curated → 📦 Community
   - ✓ インストール済みは緑アイコンで表示
   - リストからワンクリックでインストール

### アイコン凡例

| アイコン          | 意味                                      |
| ----------------- | ----------------------------------------- |
| ✓ (緑)            | インストール済みスキル                    |
| ○ (黄)            | ローカルスキル（instruction file 未登録） |
| 🆕                | 最近インストール（一時的なバッジ）        |
| ⭐ star-full (黄) | お気に入りセクション                      |
| 🏢 verified (青)  | 公式ソース（Anthropic, GitHub）           |
| ⭐ star (黄)      | キュレーション awesome-list               |
| 📦 repo           | コミュニティリポジトリ                    |

### コマンドパレット

| コマンド                                      | 説明                                     |
| --------------------------------------------- | ---------------------------------------- |
| `Agent Skill Ninja: Search Skills`            | スキルを検索してインストール             |
| `Agent Skill Ninja: Update Index`             | 全ソースからインデックスを更新           |
| `Agent Skill Ninja: Search on GitHub`         | GitHub でスキルを検索                    |
| `Agent Skill Ninja: Add Source Repository`    | 新しいソースリポジトリを追加             |
| `Agent Skill Ninja: Remove Source Repository` | ソースリポジトリを削除                   |
| `Agent Skill Ninja: Uninstall Skill`          | スキルをアンインストール                 |
| `Agent Skill Ninja: Show Installed Skills`    | インストール済みスキルを表示             |
| `Agent Skill Ninja: Create New Skill`         | 新規ローカルスキルを作成                 |
| `Agent Skill Ninja: Register Local Skill`     | ローカルスキルを instruction file に登録 |
| `Agent Skill Ninja: Unregister Local Skill`   | instruction file から登録解除            |
| `Agent Skill Ninja: Reinstall All`            | 全スキルを最新ソースから再インストール   |
| `Agent Skill Ninja: Uninstall All`            | 全スキルを削除（確認ダイアログあり）     |
| `Agent Skill Ninja: Uninstall Multiple`       | 複数スキルを選択して削除                 |
| `Agent Skill Ninja: Reinstall Multiple`       | 複数スキルを選択して再インストール       |
| `Agent Skill Ninja: Update Instruction`       | instruction file を手動更新              |
| `Agent Skill Ninja: Open Skill Folder`        | インストール済みスキルのフォルダを開く   |

### クイックスタート

```
1. Ctrl+Shift+P → "Agent Skill Ninja: Search Skills"
2. キーワードを入力（例: "pdf", "azure", "git"）
3. スキルを選択 → アクションを選択（Install / Preview / Favorite / GitHub）
4. 完了！instruction file に自動登録されます
```

### 検索のコツ 💡

| 例                  | 効果                               |
| ------------------- | ---------------------------------- |
| `azure devops`      | 複数キーワード、関連度でランキング |
| `azure-env-builder` | 名前の完全一致                     |
| `user:anthropics`   | そのユーザーの全スキル             |
| `owner/repo`        | そのリポジトリの全スキル           |

> 📝 結果が 0 件の場合、キーワードを減らして自動リトライします。

## Copilot Chat

GitHub Copilot Chat から `@skill` でスキル操作が可能です：

```
@skill /search MCP server      # スキル検索
@skill /install github-mcp     # スキルインストール
@skill /list                   # インストール済み一覧
@skill /recommend              # プロジェクトに基づく推奨
@skill what tools for Python?  # 自然言語で検索
```

### コマンド一覧

| コマンド          | 説明                       |
| ----------------- | -------------------------- |
| `/search <query>` | キーワードでスキル検索     |
| `/install <name>` | スキルをインストール       |
| `/list`           | インストール済みスキル一覧 |
| `/recommend`      | ワークスペースに基づく推奨 |

> 💡 検索結果にはインストールボタンが付いており、直接インストールできます

## MCP Tools (Agent Mode)

GitHub Copilot の **Agent Mode** では、自動的に MCP ツールとして利用されます。

### ツール一覧

| Tool Reference      | 説明                       |
| ------------------- | -------------------------- |
| `#searchSkills`     | キーワードでスキル検索     |
| `#installSkill`     | スキルをインストール       |
| `#uninstallSkill`   | スキルをアンインストール   |
| `#listSkills`       | インストール済みスキル一覧 |
| `#recommendSkills`  | プロジェクトに合った推奨   |
| `#updateSkillIndex` | スキルインデックスを更新   |
| `#webSearchSkills`  | GitHub でスキルを Web 検索 |
| `#addSkillSource`   | 新しいスキルソースを追加   |

### 使用例

```
💬 "Azure 関連のスキルを探して"
   → 自動的に #searchSkills が呼び出され、結果を表示

💬 "bicep-mcp スキルをインストールして"
   → #installSkill でインストール、instruction file 自動更新

💬 "GitHub で MCP サーバーを検索して"
   → #webSearchSkills で GitHub リポジトリを検索

💬 "このプロジェクトにおすすめのスキルは？"
   → #recommendSkills でワークスペースを分析して推奨
```

### 特徴

- 🏢 **信頼度バッジ**: Official / Curated / Community を表示
- 🌟 **おすすめスキル**: 検索結果から最適なスキルを推奨
- 📅 **インデックス更新情報**: 最終更新日と古い場合の警告
- ⚙️ **設定連動**: `autoUpdateInstruction` / `includeLocalSkills` を尊重

## Settings

| 順序 | Setting                            | Default          | Description                                             |
| :--: | ---------------------------------- | ---------------- | ------------------------------------------------------- |
|  1   | `skillNinja.autoUpdateInstruction` | `true`           | **インストール時に instruction file を自動更新**        |
|  2   | `skillNinja.instructionFile`       | `AGENTS.md`      | スキルを登録するファイル形式 _(要: Auto Update)_        |
|  3   | `skillNinja.customInstructionPath` | `""`             | カスタムパス _(instructionFile が 'custom' の時のみ)_   |
|  4   | `skillNinja.includeLocalSkills`    | `true`           | ローカルスキルも instruction file に含める              |
|  5   | `skillNinja.skillsDirectory`       | `.github/skills` | スキルをインストールするディレクトリ                    |
|  6   | `skillNinja.githubToken`           | `""`             | GitHub Token（API 制限緩和用）                          |
|  7   | `skillNinja.language`              | `auto`           | UI 言語（auto / en / ja）                               |
|  8   | `skillNinja.outputFormat`          | `auto`           | 出力形式（auto / markdown / cursor / windsurf / cline） |
|  9   | `skillNinja.enableToolDetection`   | `true`           | AI ツール自動検出を有効化                               |

> 💡 設定画面では上記の順序で表示されます

### 出力フォーマット詳細

| フォーマット     | ファイル                 | 対応ツール                  |
| ---------------- | ------------------------ | --------------------------- |
| `markdown`       | AGENTS.md, CLAUDE.md 等  | GitHub Copilot, Claude Code |
| `cursor-rules`   | .cursor/rules/skills.mdc | Cursor                      |
| `windsurf-rules` | .windsurfrules           | Windsurf                    |
| `cline-rules`    | .clinerules              | Cline                       |

`auto` を選択すると、ワークスペース内の設定ファイルから使用中の AI ツールを自動検出します。

### Instruction File 同期の仕組み

`autoUpdateInstruction` が有効な場合：

1. **スキルのインストール/アンインストール** → instruction file が自動更新
2. **ローカル SKILL.md 検出** → instruction file に追加（`includeLocalSkills` が true の場合）
3. **登録/解除コマンド** → ローカルスキルの手動制御

instruction file には管理セクションが追加されます：

```markdown
<!-- skill-ninja-START -->

## Agent Skills

- [skill-name](path/to/SKILL.md) - 説明
<!-- skill-ninja-END -->
```

### Instruction File オプション

| 値                                               | ファイルパス                                     | 用途                          |
| ------------------------------------------------ | ------------------------------------------------ | ----------------------------- |
| `AGENTS.md`                                      | `AGENTS.md` (root)                               | 推奨：汎用                    |
| `.github/copilot-instructions.md`                | `.github/copilot-instructions.md`                | GitHub Copilot                |
| `.github/instructions/SkillList.instructions.md` | `.github/instructions/SkillList.instructions.md` | Copilot Instructions フォルダ |
| `CLAUDE.md`                                      | `CLAUDE.md` (root)                               | Claude Code                   |
| `custom`                                         | 任意のパス (customInstructionPath で指定)        | カスタム                      |

## GitHub Token 設定

API レート制限を緩和するには GitHub Token を設定してください：

### 方法 1: VS Code 設定

設定画面から `Agent Skill Ninja: GitHub Token` を探し、トークンを入力：

```json
{
  "skillNinja.githubToken": "ghp_xxxxxxxxxxxx"
}
```

👉 [GitHub Token を作成する](https://github.com/settings/tokens/new?description=Agent%20Skill%20Ninja&scopes=repo,read:org)（必要なスコープ: `repo`, `read:org`）

### 方法 2: GitHub CLI（推奨）

```bash
gh auth login
```

> 💡 GitHub CLI がインストールされていれば自動でトークンを取得します（設定不要）

## Development

```bash
# 依存関係をインストール
npm install

# コンパイル
npm run compile

# 監視モードでビルド
npm run watch

# パッケージ作成
npm run package

# リント
npm run lint
```

### デバッグ

1. VS Code で `F5` を押す
2. 新しい VS Code ウィンドウで拡張機能をテスト
3. コマンドパレット (`Ctrl+Shift+P`) で `Agent Skill Ninja` コマンドを実行

## Contributing

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) © [yamapan](https://github.com/aktsmm)

- 非営利目的での利用・改変・再配布が可能
- 商用利用は要相談
- Microsoft 社員は業務利用可

> ⚠️ 本コンテンツの AI/ML トレーニング、データマイニング、その他の解析目的での使用を禁止します。

## Related Projects

- [anthropics/skills](https://github.com/anthropics/skills) - Official Claude Skills
- [github/awesome-copilot](https://github.com/github/awesome-copilot) - Official Copilot Resources
- [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) - Curated Skills List

## Author

yamapan (https://github.com/aktsmm)
