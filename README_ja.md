# Agent Skill Ninja 🥷

> ⚠️ **注意**: 本コンテンツは、AI/ML トレーニング、データマイニング、その他の解析目的での使用を明示的な許可なく禁止します。

<p align="center">
  <strong>Agent Skills（GitHub Copilot / Claude Code）の検索・インストール・管理</strong>
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

- **59 スキル** をキーワード検索（ローカル＆GitHub）
- 説明文・カテゴリタグ付きの検索結果
- ⭐ スター数・組織バッジ表示
- 検索結果から直接インストール/プレビュー/お気に入り

### 📦 インストール・管理

- ワンクリックで `.github/skills/` に自動配置
- **AGENTS.md** 自動更新
- アンインストール機能

### 🏠 ローカルスキル管理

- ワークスペースの **SKILL.md** を自動検出
- AGENTS.md への登録/解除
- 新規スキル作成コマンド

### 🤖 GitHub Copilot Chat 連携

- `@skill` コマンドでチャットから直接操作
- `/search`, `/install`, `/list`, `/recommend`
- プロジェクトに基づくスキル推奨

### 🛠️ MCP ツール連携

- **Agent Mode** で自動的にツールとして利用可能
- **8 ツール**: `#searchSkills`, `#installSkill`, `#uninstallSkill`, `#listSkills`, `#recommendSkills`, `#updateSkillIndex`, `#webSearchSkills`, `#addSkillSource`
- 信頼度バッジ（🏢 Official / 📋 Curated / 👥 Community）
- インストール時に AGENTS.md 自動更新

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

### VS Code Marketplace（準備中）

```
ext install yamapan.skill-ninja
```

### 手動インストール

1. [Releases](https://github.com/aktsmm/vscode-agent-skill-ninja/releases) から `.vsix` をダウンロード
2. VS Code で `Ctrl+Shift+P` → `Extensions: Install from VSIX...`
3. ダウンロードした `.vsix` を選択

## Included Skill Sources

| Source                                                                                  | Type         | Skills |
| --------------------------------------------------------------------------------------- | ------------ | -----: |
| [anthropics/skills](https://github.com/anthropics/skills)                               | 🏢 Official  |     17 |
| [github/awesome-copilot](https://github.com/github/awesome-copilot)                     | 🏢 Official  |      1 |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | 📋 Curated   |     27 |
| [obra/superpowers](https://github.com/obra/superpowers)                                 | 👥 Community |     14 |
| **Total**                                                                               |              | **59** |

> 💡 `Update Index` コマンドで最新のスキル数を取得できます

## Usage

### サイドバーから操作

1. アクティビティバーの **螺旋手裏剣アイコン** をクリック
2. **Workspace Skills** - インストール済み＆ローカルスキル一覧
   - ✓ インストール済みスキル
   - ○ ローカルスキル（未登録）
   - 📄 Instruction File を開くボタン
   - ⚙️ 設定を開くボタン
3. **Browse** - ソース別にスキルを閲覧

### コマンドパレット

| コマンド                                      | 説明                              |
| --------------------------------------------- | --------------------------------- |
| `Agent Skill Ninja: Search Skills`            | スキルを検索してインストール      |
| `Agent Skill Ninja: Update Index`             | 全ソースからインデックスを更新    |
| `Agent Skill Ninja: Search on GitHub`         | GitHub でスキルを検索             |
| `Agent Skill Ninja: Add Source Repository`    | 新しいソースリポジトリを追加      |
| `Agent Skill Ninja: Remove Source Repository` | ソースリポジトリを削除            |
| `Agent Skill Ninja: Uninstall Skill`          | スキルをアンインストール          |
| `Agent Skill Ninja: Show Installed Skills`    | インストール済みスキルを表示      |
| `Agent Skill Ninja: Create New Skill`         | 新規ローカルスキルを作成          |
| `Agent Skill Ninja: Register Local Skill`     | ローカルスキルを AGENTS.md に登録 |
| `Agent Skill Ninja: Unregister Local Skill`   | AGENTS.md から登録解除            |

### クイックスタート

```
1. Ctrl+Shift+P → "Agent Skill Ninja: Search Skills"
2. キーワードを入力（例: "pdf", "azure", "git"）
3. スキルを選択 → アクションを選択（Install / Preview / Favorite / GitHub）
4. 完了！AGENTS.md に自動登録されます
```

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
   → #installSkill でインストール、AGENTS.md 自動更新

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

| 順序 | Setting                            | Default          | Description                                           |
| :--: | ---------------------------------- | ---------------- | ----------------------------------------------------- |
|  1   | `skillNinja.autoUpdateInstruction` | `true`           | **インストール時に instruction file を自動更新**      |
|  2   | `skillNinja.instructionFile`       | `agents`         | スキルを登録するファイル形式 _(要: Auto Update)_      |
|  3   | `skillNinja.customInstructionPath` | `""`             | カスタムパス _(instructionFile が 'custom' の時のみ)_ |
|  4   | `skillNinja.includeLocalSkills`    | `true`           | ローカルスキルも instruction file に含める            |
|  5   | `skillNinja.skillsDirectory`       | `.github/skills` | スキルをインストールするディレクトリ                  |
|  6   | `skillNinja.githubToken`           | `""`             | GitHub Token（API 制限緩和用）                        |
|  7   | `skillNinja.language`              | `auto`           | UI 言語（auto / en / ja）                             |

> 💡 設定画面では上記の順序で表示されます

### Instruction File オプション

| 値        | ファイルパス                      | 用途           |
| --------- | --------------------------------- | -------------- |
| `agents`  | `AGENTS.md` (root)                | 推奨：汎用     |
| `copilot` | `.github/copilot-instructions.md` | GitHub Copilot |
| `claude`  | `CLAUDE.md` (root)                | Claude Code    |
| `custom`  | 任意のパス                        | カスタム       |

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

## Related Projects

- [anthropics/skills](https://github.com/anthropics/skills) - Official Claude Skills
- [github/awesome-copilot](https://github.com/github/awesome-copilot) - Official Copilot Resources
- [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) - Curated Skills List

## Author

yamapan (https://github.com/aktsmm)
