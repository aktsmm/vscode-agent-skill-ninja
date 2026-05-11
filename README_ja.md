# 🥷 Agent Skills Ninja

<p align="center">
  <strong>AI コーディングアシスタント用 Agent Skills の検索・インストール・管理</strong>
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
    <img src="https://img.shields.io/badge/%E4%BB%8A%E3%81%99%E3%81%90%E3%82%A4%E3%83%B3%E3%82%B9%E3%83%88%E3%83%BC%E3%83%AB-VS%20Code%20Marketplace-007ACC?style=for-the-badge&logo=visual-studio-code&logoColor=white" alt="VS Code Marketplace からインストール">
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

---

## 出力フォーマット

### フォーマットオプション

| フォーマット   | 説明                                   | IMPORTANT | 詳細テーブル | 圧縮インデックス |
| -------------- | -------------------------------------- | --------- | ------------ | ---------------- |
| ✅ **Full**    | IMPORTANT + 詳細テーブルのみ（最適化） | ✅        | ✅ 200文字   | ❌               |
| 📦 **Compact** | IMPORTANT + 圧縮インデックス           | ✅        | ❌           | ✅ 100文字       |
| 🕰️ **Legacy**  | シンプルテーブルのみ (OLD)             | ❌        | ✅ 200文字   | ❌               |

### IMPORTANT プロンプト

`full` と `compact` フォーマットには、エージェントにスキルファイルを優先するよう指示する **IMPORTANT プロンプト** が含まれます：

```markdown
> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.
> Read the relevant SKILL.md before working on tasks covered by these skills.
```

### 出力例 - Full フォーマット（既定）

```markdown
<!-- skill-ninja-START -->

## Agent Skills

> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.
> Read the relevant SKILL.md before working on tasks covered by these skills.

### Skills

| Skill                                | Description                                         |
| ------------------------------------ | --------------------------------------------------- |
| [docx](.github/skills/docx/SKILL.md) | Process Word documents (.docx). Use for .docx files |
| [pdf](.github/skills/pdf/SKILL.md)   | PDF manipulation toolkit. Extract text, create PDFs |

<!-- skill-ninja-END -->
```

### フォーマットの変更方法

設定 → **Output Format (出力フォーマット)** → `full`, `compact`, `legacy` から選択

---

## 🥷 Features

### 📁 ワークスペーススキル管理

- **SKILL.md** を workspace / user-global / built-in の 3 scope で管理
- `skillNinja.skillsDirectory` を managed な workspace root として使い、VS Code の Agent Skill Locations から user/global root も自動検出
- 書き込み可能な各 root ごとに、最寄りの instruction file へ managed skills を自動同期
- テンプレートから新規スキル作成

### 🔍 スキル検索・発見

- スキルをキーワード検索（ローカル＆GitHub）
- **複数キーワード検索** - 名前・パス・説明の関連度でスコアリング
- **並列フェッチ** - 50 件同時取得で高速化
- **フォールバック検索** - 結果 0 件時にキーワードを減らして自動リトライ
- 説明文・カテゴリタグ付きの検索結果
- スター数・組織バッジ表示
- 検索結果から直接インストール/プレビュー/お気に入り

### 📦 インストール・管理

- ワンクリックでインストール（デフォルト: `.github/skills/`、設定で変更可能）
- managed root が複数ある場合はインストール先（workspace / user-global）を選択可能
- **instruction file** 自動更新（AGENTS.md / copilot-instructions.md / CLAUDE.md）
- **テーブル形式** - 「When to Use」列付きの表形式でスキル一覧表示
- **「When to Use」自動抽出** - SKILL.md の `## When to Use` セクションから自動取得
- **説明を編集** - 右クリックでスキルの説明をカスタマイズ
- アンインストール機能
- **全て再インストール** - 最新ソースから一括再インストール（インデックス自動更新付き）
- **インストール通知** - NEW バッジ、ステータスバー表示、ツリービューで自動選択
- **フォルダを開く** - インストール済みスキルのフォルダにクイックアクセス
- **インデックス整合性チェック** - 未登録スキルを自動検出し、インデックス更新を提案

### 🔧 マルチツール対応

- ワークスペース内の AI ツールを**自動検出**（Cursor, Windsurf, Cline, Claude Code, GitHub Copilot）
- 検出されたツールに基づいて出力形式を自動選択
- 設定で手動オーバーライド可能
- 対応出力形式:
  - Markdown（AGENTS.md, CLAUDE.md, copilot-instructions.md）
  - Cursor Rules（.cursor/rules/）
  - Windsurf Rules（.windsurfrules）
  - Cline Rules（.clinerules）

### 💬 GitHub Copilot Chat 連携

- `@skill` コマンドでチャットから直接操作
- `/search`, `/install`, `/list`, `/recommend`
- プロジェクトに基づくスキル推奨

### 🤖 MCP ツール連携

- **Agent Mode** で自動的にツールとして利用可能
- **8 ツール**: `#searchSkills`, `#installSkill`, `#uninstallSkill`, `#listSkills`, `#recommendSkills`, `#updateSkillIndex`, `#webSearchSkills`, `#addSkillSource`
- 信頼度バッジ（Official / Curated / Community）
- インストール時に instruction file 自動更新

### 🌐 多言語・UI

- 日本語 / 英語 UI（自動検出 + 手動切替）
- Webview でスキルプレビュー
- お気に入り機能

## 🎬 Demo

![Demo](docs/screenshots/demo.gif)

## 📥 Installation

### VS Code Marketplace

```
ext install yamapan.agent-skill-ninja
```

または VS Code の拡張機能（`Ctrl+Shift+X`）で **"Agent Skills Ninja"** を検索

### 手動インストール

1. [Releases](https://github.com/aktsmm/vscode-agent-skill-ninja/releases) から `.vsix` をダウンロード
2. VS Code で `Ctrl+Shift+P` → `Extensions: Install from VSIX...`
3. ダウンロードした `.vsix` を選択

## 🧩 Companion Extension

- [Agent Resources Ninja](https://marketplace.visualstudio.com/items?itemName=yamapan.agent-resources-ninja) - スキルに加えて agent、prompt、instruction、hook、MCP config resource などもまとめて管理できる companion 拡張です。
- GitHub: https://github.com/aktsmm/vscode-agent-resources-ninja

## 📚 Included Skill Sources

プリセットインデックスには、公式・キュレーション・コミュニティの各ソースが初期状態で含まれます。

| Source                                                                                                                        | Type      | 説明                               |
| ----------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------- |
| [anthropics/skills](https://github.com/anthropics/skills)                                                                     | Official  | Anthropic 公式 Claude Skills       |
| [openai/skills](https://github.com/openai/skills)                                                                             | Official  | OpenAI 公式 Codex Skills (1.7k+)   |
| [github/awesome-copilot](https://github.com/github/awesome-copilot)                                                           | Official  | GitHub 公式 Copilot リソース       |
| [MicrosoftDocs/Agent-Skills](https://github.com/MicrosoftDocs/Agent-Skills)                                                   | Official  | Microsoft 公式 Azure Agent Skills  |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills)                                       | Curated   | Claude Skills キュレーションリスト |
| [obra/superpowers](https://github.com/obra/superpowers)                                                                       | Community | 高品質スキル・エージェント集       |
| [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) | Community | Context Engineering スキル (5k+)   |
| [danielmiessler/Personal_AI_Infrastructure](https://github.com/danielmiessler/Personal_AI_Infrastructure)                     | Community | PAI Packs - スキル・フィーチャー集 |
| [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin)                               | Community | Compound Engineering (3.5k+)       |
| [Wirasm/PRPs-agentic-eng](https://github.com/Wirasm/PRPs-agentic-eng)                                                         | Community | PRP (Prompt Recipe Patterns)       |
| [qdhenry/Claude-Command-Suite](https://github.com/qdhenry/Claude-Command-Suite)                                               | Community | Claude コマンド・スキル集          |

> `Update Index` コマンドで、これらのソースから最新のスキルとメタデータを再取得できます

## 🥷 Usage

### サイドバーから操作

1. アクティビティバーの **螺旋手裏剣アイコン** をクリック
2. **インストール済みスキル** - workspace managed skills を skill root ごとに表示

- **ワークスペース スキル**: `skillNinja.skillsDirectory`（既定: `.github/skills`）配下の managed skills
- 新しくインストールしたスキル（一時的なバッジ）
- ツールバー: Instruction / インストラクション更新 / 新規作成 / 更新 / 設定
- 空状態: 検索 / 新規作成 / インストラクションファイルを開く
- workspace scope のスキルフォルダ / ファイルを開けます

3. **ユーザー / グローバル スキル** - personal / built-in skills を skill root ごとに表示

- **ユーザー / グローバル スキル**: 標準の personal roots（`~/.copilot/skills`, `~/.claude/skills`, `~/.agents/skills`）と VS Code の Agent Skill Locations から見つかった managed skills
- **組み込みスキル**: Copilot / VS Code 同梱 skills を読み取り専用で表示する任意グループ
- ルートノードは短い home / product 名で表示し、件数とフルパスは description / tooltip 側に寄せます
- ツールバー: Instruction / インストラクション更新 / 新規作成 / 更新 / 設定
- 空状態: 新規作成 / 組み込みスキル表示 / 設定を開く
- どの user/global scope でもスキルフォルダ / ファイルを開けます

4. **Remote Skills** - ソース別にスキルを閲覧
   - **お気に入り** セクションが最上部に表示
   - ソース順: Official → Curated → Community
   - インストール済みは緑アイコンで表示
   - リストからワンクリックでインストール

- ツールバー: 検索 / Web Search / インデックス更新 / ソース追加 / 新規作成 / 設定

### アイコン凡例

| アイコン       | 意味                                               |
| -------------- | -------------------------------------------------- |
| check (緑)     | インストール済みスキル                             |
| NEW badge      | 最近インストール（一時的なバッジ）                 |
| star-full (黄) | お気に入りセクション                               |
| verified (青)  | 公式ソース（Anthropic, OpenAI, GitHub, Microsoft） |
| star (黄)      | キュレーション awesome-list                        |
| repo           | コミュニティリポジトリ                             |

### コマンドパレット

| コマンド                                       | 説明                                   |
| ---------------------------------------------- | -------------------------------------- |
| `Agent Skills Ninja: Search Skills`            | スキルを検索してインストール           |
| `Agent Skills Ninja: Update Index`             | 全ソースからインデックスを更新         |
| `Agent Skills Ninja: Search on GitHub`         | GitHub でスキルを検索                  |
| `Agent Skills Ninja: Add Source Repository`    | 新しいソースリポジトリを追加           |
| `Agent Skills Ninja: Remove Source Repository` | ソースリポジトリを削除                 |
| `Agent Skills Ninja: Uninstall Skill`          | スキルをアンインストール               |
| `Agent Skills Ninja: Show Installed Skills`    | インストール済みスキルを表示           |
| `Agent Skills Ninja: Create New Skill`         | 新規ワークスペーススキルを作成         |
| `Agent Skills Ninja: Reinstall All`            | 全スキルを最新ソースから再インストール |
| `Agent Skills Ninja: Uninstall All`            | 全スキルを削除（確認ダイアログあり）   |
| `Agent Skills Ninja: Uninstall Multiple`       | 複数スキルを選択して削除               |
| `Agent Skills Ninja: Reinstall Multiple`       | 複数スキルを選択して再インストール     |
| `Agent Skills Ninja: Update Instruction`       | instruction file を手動更新            |
| `Agent Skills Ninja: Open Skill Folder`        | インストール済みスキルのフォルダを開く |

### クイックスタート

```
1. Ctrl+Shift+P → "Agent Skills Ninja: Search Skills"
2. キーワードを入力（例: "pdf", "azure", "git"）
3. スキルを選択 → アクションを選択（Install / Preview / Favorite / GitHub）
4. 完了！instruction file に自動登録されます
```

### 検索のコツ 💡

| 例                 | 効果                               |
| ------------------ | ---------------------------------- |
| `azure`            | キーワード検索                     |
| `azure devops`     | 複数キーワード、関連度でランキング |
| `username keyword` | 最初の語をユーザー名として検索     |
| `user:anthropics`  | 明示的にユーザー指定               |
| `repo:owner/repo`  | リポジトリ指定                     |

> 結果が 0 件の場合、キーワードを減らして自動リトライします。

## 💬 Copilot Chat

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

> 検索結果にはインストールボタンが付いており、直接インストールできます

## 🤖 MCP Tools (Agent Mode)

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

- **信頼度バッジ**: Official / Curated / Community を表示
- **おすすめスキル**: 検索結果から最適なスキルを推奨
- **インデックス更新情報**: 最終更新日と古い場合の警告
- **設定連動**: `autoUpdateInstruction` / `skillsDirectory` を尊重
- **トークン効率**: MCP ツール経由で操作することで、会話コンテキストを節約

### MCP ツールを無効化

MCP ツールが不要な場合は、GitHub Copilot Chat のツール一覧からオフにできます：

1. Copilot Chat パネル → Settings → Tools
2. 「Agent Skills Ninja」のツールをトグルオフ

## ⚙️ Settings

| 順序 | Setting                                   | Default          | Description                                                           |
| :--: | ----------------------------------------- | ---------------- | --------------------------------------------------------------------- |
|  1   | `skillNinja.autoUpdateInstruction`        | `true`           | **インストール時に instruction file を自動更新**                      |
|  2   | `skillNinja.instructionFile`              | `AGENTS.md`      | スキルを登録するファイル形式 _(要: Auto Update)_                      |
|  3   | `skillNinja.customInstructionPath`        | `""`             | カスタムパス _(instructionFile が 'custom' の時のみ)_                 |
|  4   | `skillNinja.skillsDirectory`              | `.github/skills` | ワークスペーススキルをインストール・管理するディレクトリ              |
|  5   | `skillNinja.useVsCodeAgentSkillLocations` | `true`           | 標準 personal root と追加の user/global skill root を検出して管理する |
|  6   | `skillNinja.showBuiltInSkills`            | `false`          | 読み取り専用の built-in skills を表示する                             |
|  7   | `skillNinja.outputFormat`                 | `full`           | 出力形式（full / compact / legacy）                                   |
|  8   | `skillNinja.language`                     | `auto`           | UI 言語（auto / en / ja）                                             |
|  9   | `skillNinja.autoUpdateSkillsOnUpgrade`    | `prompt`         | 拡張機能アップグレード後のスキル更新                                  |
|  10  | `skillNinja.githubToken`                  | `""`             | GitHub Token（API 制限緩和用）                                        |
|  11  | `skillNinja.singleClickInstall`           | `false`          | リモートスキルをシングルクリックでインストール                        |

> 設定画面では上記の順序で表示されます

互換用設定: `skillNinja.includeLocalSkills` は非推奨です。ワークスペーススキルは `skillNinja.skillsDirectory` 配下を管理対象にし、personal root と追加の user/global root は `skillNinja.useVsCodeAgentSkillLocations` から検出します。設定された location では `${workspaceFolder}`, `${userHome}`, `${env:APPDATA}`, `%APPDATA%` を使えます。built-in skills は `skillNinja.showBuiltInSkills` を有効にしたときだけ表示します。

### 出力フォーマット詳細

| フォーマット | 内容                                   | 用途               |
| ------------ | -------------------------------------- | ------------------ |
| `full`       | IMPORTANT + 詳細テーブルのみ (200文字) | 完全な情報（既定） |
| `compact`    | IMPORTANT + 圧縮インデックス (100文字) | トークン節約型     |
| `legacy`     | シンプルテーブルのみ（IMPORTANT なし） | 後方互換性         |

### Instruction File 同期の仕組み

`autoUpdateInstruction` が有効な場合：

1. **スキルのインストール/アンインストール** → instruction file が自動更新
2. **`skillsDirectory` 内の SKILL.md 検出** → 管理セクションへ追加
3. **Update Instruction File の手動実行** → `skillsDirectory` から管理セクションを再生成

instruction file には **IMPORTANT プロンプト** と **Description 列** を含む管理セクションが追加されます：

```markdown
<!-- skill-ninja-START -->

## Agent Skills

> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.
> Read the relevant SKILL.md before working on tasks covered by these skills.

### Skills

| Skill                                            | Description                |
| ------------------------------------------------ | -------------------------- |
| [skill-name](.github/skills/skill-name/SKILL.md) | 説明テキスト \| いつ使うか |

<!-- skill-ninja-END -->
```

**Description 列の形式**: `{description:80} | {whenToUse:80}`（合計最大160文字）

### Instruction File オプション

| 値                                               | ファイルパス                                     | 用途                          |
| ------------------------------------------------ | ------------------------------------------------ | ----------------------------- |
| `AGENTS.md`                                      | `AGENTS.md` (root)                               | 推奨：汎用                    |
| `.github/copilot-instructions.md`                | `.github/copilot-instructions.md`                | GitHub Copilot                |
| `.github/instructions/SkillList.instructions.md` | `.github/instructions/SkillList.instructions.md` | Copilot Instructions フォルダ |
| `CLAUDE.md`                                      | `CLAUDE.md` (root)                               | Claude Code                   |
| `custom`                                         | 任意のパス (customInstructionPath で指定)        | カスタム                      |

## 🔑 GitHub Token 設定

> **重要**: GitHub 検索を使用するには GitHub Token が**必須**です。未設定の場合、API レート制限（60 リクエスト/時間）により検索がすぐに失敗します。

検索機能を有効にするには GitHub Token を設定してください：

### 方法 1: VS Code 設定

設定画面から `Agent Skills Ninja: GitHub Token` を探し、トークンを入力：

````json
{
  "skillNinja.githubToken": "ghp_xxxxxxxxxxxx"
2. **各 writable root 配下の managed SKILL.md** → その root の管理セクションに含まれる
3. **手動で Update Instruction File** → すべての writable root の管理セクションを再生成

👉 [GitHub Token を作成する](https://github.com/settings/tokens/new?description=Agent%20Skill%20Ninja&scopes=repo,read:org)（必要なスコープ: `repo`, `read:org`）

### 方法 2: GitHub CLI（推奨）

```bash
gh auth login
````

> GitHub CLI がインストールされていれば自動でトークンを取得します（設定不要）

## 🛠️ Development

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
3. コマンドパレット (`Ctrl+Shift+P`) で `Agent Skills Ninja` コマンドを実行

## 🤝 Contributing

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) © [yamapan](https://github.com/aktsmm)

- 非営利目的での利用・改変・再配布が可能
- 商用利用は要相談
- Microsoft 社員は業務利用可

> 本コンテンツの AI/ML トレーニング、データマイニング、その他の解析目的での使用を禁止します。

## 🔗 Related Projects

- [anthropics/skills](https://github.com/anthropics/skills) - Official Claude Skills
- [github/awesome-copilot](https://github.com/github/awesome-copilot) - Official Copilot Resources
- [microsoft/skills](https://github.com/microsoft/skills) - 参考: Official Microsoft Skills（プリセット未同梱）
- [MicrosoftDocs/Agent-Skills](https://github.com/MicrosoftDocs/Agent-Skills) - Official Azure Agent Skills（プリセット同梱）
- [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) - Curated Skills List

## 👤 Author

yamapan (https://github.com/aktsmm)
