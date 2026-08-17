# 🥷 Agent Skills Ninja

<p align="center">
  <strong>AI コーディングアシスタント用 Agent Skills の検索・インストール・管理</strong>
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
  <a href="#-development">Development</a>
</p>

---

## 出力フォーマット

### フォーマットオプション

| フォーマット   | instruction file                   | catalog file (`refCatalogFormat`)                  |
| -------------- | ---------------------------------- | -------------------------------------------------- |
| 🔗 **Ref**     | IMPORTANT + リンクのみ             | 別ファイル: `full` / `compact` / `legacy` から選択 |
| ✅ **Full**    | IMPORTANT + 詳細テーブル           | —                                                  |
| 📦 **Compact** | IMPORTANT + 圧縮インデックス       | —                                                  |
| 🕰️ **Legacy**  | シンプルテーブル（IMPORTANT なし） | —                                                  |

### IMPORTANT プロンプト

`ref`、`full`、`compact` フォーマットには、エージェントにスキルファイルを優先するよう指示する **IMPORTANT プロンプト** が含まれます。`ref` は常時ロードされる instruction file には routing prompt と catalog link だけを残し、詳細を別 Markdown ファイルに分離します。リンク先 catalog の形式は `skillNinja.refCatalogFormat` で `full` / `compact` / `legacy` から選べます：

```markdown
> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.
> Read the relevant SKILL.md before working on tasks covered by these skills.
```

### 出力例 - Ref フォーマット（既定）

```markdown
<!-- agent-ninja-START -->

## Agent Skills

> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.
> See [Agent Skills](.github/skills/README.md) before working on tasks covered by these skills.

<!-- agent-ninja-END -->
```

catalog は `.github/skills/README.md` に出力されます。catalog 内の形式は `skillNinja.refCatalogFormat` で指定します（既定は `full`、必要に応じて `compact` / `legacy`）。

workspace skills では `skillNinja.refCatalogPath` の相対パスは workspace root 基準で解決されます。user/global skills では personal instruction file を持ち運びやすくするため、instruction file の親ディレクトリ基準で解決されます。

### 出力例 - Full フォーマット

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

### フォーマットの変更方法

設定 → **Output Format (出力フォーマット)** → `ref`, `full`, `compact`, `legacy` から選択

---

<a id="features"></a>

## 🥷 Features

### 📁 ワークスペーススキル管理

- **SKILL.md** を workspace / user-global / インストール済み拡張機能 / built-in の 4 scope で管理
- `skillNinja.skillsDirectory` を primary managed workspace root として使い、`skillNinja.additionalSkillRoots` で repo-local root を追加し、VS Code の Agent Skill Locations から user/global root も自動検出
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

- Remote Skills の行をダブルクリックすると、既定で workspace skill root（`skillNinja.skillsDirectory`、既定: `.github/skills`）へインストール
- Browse ビューでは `skillNinja.singleClickInstall` でシングルクリックインストールに切り替え可能
- ツールバー / 検索 / プレビュー経由などでは、managed root が複数ある場合にインストール先（workspace / user-global）を選択可能
- **instruction file** 自動更新（AGENTS.md / copilot-instructions.md / CLAUDE.md）
- **テーブル形式** - 「When to Use」列付きの表形式でスキル一覧表示
- **「When to Use」自動抽出** - SKILL.md の `## When to Use` セクションから自動取得
- **説明を編集** - 右クリックでスキルの説明をカスタマイズ
- アンインストール機能
- **全て再インストール** - 最新ソースから一括再インストール（インデックス自動更新付き）
- **source-aware な missing index 回復** - 再インストール時に index から見つからない skill が出た場合、affected source を特定できるときは全 source ではなくその source だけを更新します
- **partial failure warning** - 一括再インストール系では、selection の一部だけ成功した場合に成功件数 / 失敗件数を warning で表示します
- **ルート単位 inline アクション** - 書き込み可能な各 skill root 行の右端に **スキル出力を再生成** を表示します。これは `AGENTS.md` / `copilot-instructions.md` / `CLAUDE.md` または `ref` モードのリンク先 catalog を再生成する操作です。さらに、remote-backed skill を 1 件以上含む root にだけ **このルートのリモートスキルを再インストール** を表示します
- **インストール通知** - NEW バッジ、ステータスバー表示、ツリービューで自動選択
- **フォルダを開く** - インストール済みスキルのフォルダにクイックアクセス
- **スキル状態を診断** - ツリー項目のコンテキストメニューから、登録ソース、metadata path、共存オーナー、instruction file の向き先を確認可能
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
- **10 ツール**: `#searchSkills`, `#installSkill`, `#uninstallSkill`, `#listSkills`, `#recommendSkills`, `#updateSkillIndex`, `#webSearchSkills`, `#addSkillSource`, `#removeSkillSource`, `#localizeSkill`
- 信頼度バッジ（Official / Curated / Community）
- インストール時に instruction file 自動更新

### 🌐 多言語・UI

- 日本語 / 英語 UI（自動検出 + 手動切替）
- Webview でスキルプレビュー
- お気に入り機能

## 🎬 Demo

![Demo](docs/screenshots/demo.gif)

<a id="installation"></a>

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
| [google/skills](https://github.com/google/skills)                                                                             | Official  | Google 公式プロダクト Skills       |
| [github/awesome-copilot](https://github.com/github/awesome-copilot)                                                           | Official  | GitHub 公式 Copilot リソース       |
| [MicrosoftDocs/Agent-Skills](https://github.com/MicrosoftDocs/Agent-Skills)                                                   | Official  | Microsoft 公式 Azure Agent Skills  |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills)                                       | Curated   | Claude Skills キュレーションリスト |
| [obra/superpowers](https://github.com/obra/superpowers)                                                                       | Community | 高品質スキル・エージェント集       |
| [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) | Community | Context Engineering スキル (5k+)   |
| [danielmiessler/LifeOS](https://github.com/danielmiessler/LifeOS)                                                             | Community | LifeOS Skills - PAI 後継スキル集   |
| [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin)                               | Community | Compound Engineering (3.5k+)       |
| [Wirasm/prp](https://github.com/Wirasm/prp)                                                                                   | Community | PRP (Prompt Recipe Patterns)       |
| [qdhenry/Claude-Command-Suite](https://github.com/qdhenry/Claude-Command-Suite)                                               | Community | Claude コマンド・スキル集          |
| [Yeachan-Heo/oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex)                                                         | Community | OMX Codex ワークフロースキル       |

> `Update Index` コマンドで、これらのソースから最新のスキルとメタデータを再取得できます

<a id="usage"></a>

## 🥷 Usage

### サイドバーから操作

1. アクティビティバーの **螺旋手裏剣アイコン** をクリック
2. **インストール済みスキル** - workspace managed skills を skill root ごとに表示

- **ワークスペース スキル**: `skillNinja.skillsDirectory`（既定: `.github/skills`）と `skillNinja.additionalSkillRoots` 配下の managed skills
- 新しくインストールしたスキル（一時的なバッジ）
- ツールバー: スキル出力 / スキル出力を再生成 / 新規作成 / ビューを更新 / 設定
- 書き込み可能な各 root 行の右端にも **スキル出力を再生成** が表示され、remote-backed skill を 1 件以上含む root にだけ **このルートのリモートスキルを再インストール** が表示されます
- remote-backed skill が上流から消えている場合、再インストール flow から「今後確認しない」に設定でき、一括操作をブロックし続けないようにできます
- workspace view の **スキル出力** は全 root の QuickPick を出さず、workspace root をそのまま開きます
- `ref` モードでは **スキル出力** がリンク先 catalog を開き、`full` / `compact` / `legacy` では instruction file 自体を開きます
- 空状態: 検索 / 新規作成 / スキル出力を開く
- workspace root のスキルフォルダ / ファイルを開けます

3. **ユーザー / グローバル スキル** - personal skills は skill root ごと、インストール済み拡張機能の読み取り専用スキルと Built-in Skills は別セクションで表示

- **ユーザー / グローバル スキル**: 標準の personal roots（`~/.copilot/skills`, `~/.claude/skills`, `~/.agents/skills`）と VS Code の Agent Skill Locations から見つかった managed skills
- **インストール済み拡張機能**: インストール済み VS Code 拡張に同梱された skill folder から見つかった読み取り専用スキル。拡張ごと、その下に variant/root ごとに表示します
- **Built-in Skills**: Copilot / VS Code 同梱 skills を読み取り専用で表示するグループ。GitHub Copilot Chat、GitHub Copilot CLI、VS Code などの provider/origin で先にまとめ、その配下に Prompts、Skills、Package (Universal) などの variant/root を表示します。既定で表示され、設定から非表示にもできます
- ルートノードは短い home / product 名で表示し、件数とフルパスは description / tooltip 側に寄せます
- ツールバー: スキル出力 / スキル出力を再生成 / 新規作成 / ビューを更新 / 設定
- 書き込み可能な各 root 行の右端にも **スキル出力を再生成** が表示され、remote-backed skill を 1 件以上含む root にだけ **このルートのリモートスキルを再インストール** が表示されます。これで GitHub Copilot Home / Claude Home / Global Agent Home などをコマンドパレットなしで更新できます
- `source: unknown` かつ `remotePath` が無い legacy skill は個別 lookup 候補としてだけ扱い、それ単体で一括再インストール導線を表示しないようにします
- user/global view の **スキル出力** は全 root の QuickPick を出さず、既定の user/global root をそのまま開きます
  既定優先順は VS Code ユーザーカスタマイズ、Copilot home、Claude home、最後に global agent home です
- `ref` モードでは **スキル出力** がリンク先 catalog を開き、`full` / `compact` / `legacy` では instruction file 自体を開きます
- 空状態: 新規作成 / 設定 / スキル出力を開く
- どの user/global root でもスキルフォルダ / ファイルを開けます

4. **Remote Skills** - ソース別にスキルを閲覧
   - **お気に入り** セクションが最上部に表示
   - ソース順: Official → Curated → Community
   - インストール済みは緑アイコンで表示

- 行のダブルクリックで既定の workspace root にインストール。ルートを選びたい場合は inline の Install を利用

- ツールバー: 検索 / Web Search / インデックス更新 / ソース追加 / 新規作成 / 設定
- ソース追加では、リポジトリ root URL だけでなく GitHub 上のフォルダ / ファイル URL も受け付けます。保存時には自動でリポジトリ root を解決します。
- Private source repository は、その repository の contents を読める GitHub 認証がある場合に追加できます。

### アイコン凡例

| アイコン       | 意味                                               |
| -------------- | -------------------------------------------------- |
| check (緑)     | インストール済みスキル                             |
| NEW badge      | 最近インストール（一時的なバッジ）                 |
| star-full (黄) | お気に入りセクション                               |
| verified (青)  | 公式ソース（Anthropic, OpenAI, GitHub, Microsoft） |
| star (黄)      | キュレーション awesome-list                        |
| repo           | コミュニティリポジトリ                             |
| warning (赤)   | 内容が不完全なスキル（再インストールで復旧）       |

### コマンドパレット

| コマンド                                           | 説明                                                                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------- | ---------------------------------------------------------------------------- | --- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `Agent Skills Ninja: スキルを検索`                 | スキルを検索してインストール                                                                                                  |
| `Agent Skills Ninja: インデックスを更新`           | 全ソースからインデックスを更新                                                                                                |
| `Agent Skills Ninja: GitHub で検索`                | GitHub でスキルを検索                                                                                                         |
| `Agent Skills Ninja: ソースリポジトリを追加`       | 新しいソースリポジトリを追加                                                                                                  |
| `Agent Skills Ninja: ソースリポジトリを削除`       | ソースリポジトリを削除                                                                                                        |
| `Agent Skills Ninja: スキルをアンインストール`     | スキルをアンインストール                                                                                                      |
| `Agent Skills Ninja: インストール済みスキルを表示` | インストール済みスキルを表示                                                                                                  |
| `Agent Skills Ninja: 新規スキル作成`               | 新規ワークスペーススキルを作成                                                                                                |
| `Agent Skills Ninja: 全スキルを再インストール`     | 全スキルを最新ソースから再インストール                                                                                        |
| `Agent Skills Ninja: 不完全なスキルを修復`         | 不完全 / 一部未取得と記録されたスキルだけを入れ直す                                                                           |
| `Agent Skills Ninja: 全スキルを削除`               | 全スキルを削除（確認ダイアログあり）                                                                                          |
| `Agent Skills Ninja: 複数スキルを削除`             | 複数スキルを選択して削除                                                                                                      |
| `Agent Skills Ninja: 複数スキルを再インストール`   | 複数スキルを選択して再インストール                                                                                            |
| `Agent Skills Ninja: スキル出力を開く`             | managed root を選んで、`ref` ではリンク先 catalog、それ以外では instruction file を開く                                       |
| `Agent Skills Ninja: スキル出力を再生成`           | 選択した root のスキル出力ファイルを手動で再生成 (`AGENTS.md` / `copilot-instructions.md` / `CLAUDE.md` または `ref` catalog) |
| `Agent Skills Ninja: スキルフォルダを開く`         | インストール済みスキルのフォルダを開く                                                                                        |     | `Agent Skills Ninja: 中断したソース更新を再開` | GitHub のレート制限や 1 回あたりの更新上限で持ち越した source 更新を再開する |     | `Agent Skills Ninja: GitHub トークンをクリア（SecretStorage のみ）` | VS Code SecretStorage の GitHub token だけを削除し、ほかの認証元で再試行できるようにする |
| `Agent Skills Ninja: スキル状態を診断`             | token 値を表示せず、スキルの登録状態と現在の GitHub token source を表示する                                                   |

### クイックスタート

```
1. Ctrl+Shift+P → "Agent Skills Ninja: スキルを検索"
2. キーワードを入力（例: "pdf", "azure", "git"）
3. スキルを選択 → アクションを選択（インストール / プレビュー / お気に入りに追加 / GitHub で開く）
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

<a id="copilot-chat"></a>

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

| Tool Reference       | 説明                       |
| -------------------- | -------------------------- |
| `#searchSkills`      | キーワードでスキル検索     |
| `#installSkill`      | スキルをインストール       |
| `#uninstallSkill`    | スキルをアンインストール   |
| `#listSkills`        | インストール済みスキル一覧 |
| `#recommendSkills`   | プロジェクトに合った推奨   |
| `#updateSkillIndex`  | スキルインデックスを更新   |
| `#webSearchSkills`   | GitHub でスキルを Web 検索 |
| `#addSkillSource`    | 新しいスキルソースを追加   |
| `#removeSkillSource` | スキルソースを削除         |
| `#localizeSkill`     | スキル説明をローカライズ   |

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

<a id="settings"></a>

## ⚙️ Settings

| 順序 | Setting                                   | Default                    | Description                                                                           |
| :--: | ----------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------- |
|  1   | `skillNinja.autoUpdateInstruction`        | `true`                     | **インストール時に instruction file を自動更新**                                      |
|  2   | `skillNinja.instructionFile`              | `AGENTS.md`                | スキルを登録するファイル形式 _(要: Auto Update)_                                      |
|  3   | `skillNinja.customInstructionPath`        | `""`                       | カスタムパス _(instructionFile が 'custom' の時のみ)_                                 |
|  4   | `skillNinja.skillsDirectory`              | `.github/skills`           | ワークスペーススキルをインストール・管理する primary ディレクトリ                     |
|  5   | `skillNinja.additionalSkillRoots`         | `[]`                       | 追加の workspace skill root。例: `copilot-skills/skills`                              |
|  6   | `skillNinja.useVsCodeAgentSkillLocations` | `true`                     | 標準 personal root と追加の user/global skill root を検出して管理する                 |
|  7   | `skillNinja.showBuiltInSkills`            | `true`                     | 読み取り専用の Built-in Skills を表示する                                             |
|  8   | `skillNinja.outputFormat`                 | `ref`                      | 出力形式（ref / full / compact / legacy）                                             |
|  9   | `skillNinja.refCatalogPath`               | `.github/skills/README.md` | `ref` 形式で使う catalog file path                                                    |
|  10  | `skillNinja.refCatalogFormat`             | `full`                     | `outputFormat` が `ref` のときの catalog 詳細形式                                     |
|  11  | `skillNinja.language`                     | `auto`                     | UI 言語（auto / en / ja）                                                             |
|  12  | `skillNinja.autoUpdateSkillsOnUpgrade`    | `prompt`                   | 拡張機能アップグレード後のスキル更新                                                  |
|  13  | `skillNinja.staleSourceIndexUpdateMode`   | `prompt`                   | 30 日以上古い source index を起動時に更新（`always` / `prompt` / `never`）            |
|  14  | `skillNinja.githubToken`                  | `""`                       | 互換用 GitHub Token 設定（ユーザー設定のみ）。設定時は SecretStorage にコピーして利用 |
|  15  | `skillNinja.singleClickInstall`           | `false`                    | リモートスキルをシングルクリックでインストール                                        |
|  16  | `skillNinja.coexistenceMode`              | `auto`                     | Agent Resources Ninja との共存モード（`auto` / `independent`）                        |
|  17  | `skillNinja.useSharedSourcesManifest`     | `false`                    | `~/.agent-ninja/sources.json` 経由で Agent Resources Ninja と source list SSOT を共有 |

> 設定画面では上記の順序で表示されます

### ソースインデックス更新の挙動

`skillNinja.staleSourceIndexUpdateMode` による更新では、既存インデックスを壊さないための保護が働きます。

- **1 回の実行で最大 5 ソースまで。** 古いものから順に処理し、残りは次回以降へ回します。1 回の起動で GitHub のレート制限を使い切らないための上限です。繰り越したソースは `Agent Skills Ninja: Source Index` 出力チャネルに記録されます。
- **取得結果が 0 件でも既存スキルを消しません。** 既存のスキルを保持し、その更新は失敗として扱います。
- **リネームされたリポジトリには自動で追従します。** GitHub から canonical な `owner/repo` を解決し、ソース URL を書き戻します。
- **URL の参照先が別リポジトリに変わった場合は更新しません。** GitHub から数値リポジトリ ID を取得できた時点で記録し、以降変化したらスキップします。意図した変更なら、そのソースを削除してから追加し直してください。

互換用設定: `skillNinja.includeLocalSkills` は非推奨です。ワークスペーススキルは `skillNinja.skillsDirectory` と `skillNinja.additionalSkillRoots` 配下を管理対象にし、personal root と追加の user/global root は `skillNinja.useVsCodeAgentSkillLocations` から検出します。設定された location では `${workspaceFolder}`, `${userHome}`, `${env:APPDATA}`, `%APPDATA%` を使えます。Built-in Skills は `skillNinja.showBuiltInSkills` で制御され、既定で表示されます。

### インストール失敗時の挙動

インストール、残骸の検出、削除のいずれも、実際に起きたことを報告します。

- **プレースホルダーだけのインストールは失敗扱いです。** 生成テンプレートしか書けなかった場合はインストールを失敗とし、`.skill-meta.json` に不完全であることを記録します。単体インストールでは 再インストール / 削除 / バグ報告 を提示し、再インストールは初回のみ表示されます。
- **一括操作では個別ダイアログを出しません。** すべて再インストール、root 単位の再インストール、複数選択の再インストール、bundle インストールでは skill ごとのダイアログを出さず、最後のサマリで失敗件数を報告します。
- **レート制限と一時的なネットワーク失敗は再試行します。** 共通のバックオフ層が再試行するのは `429`, `502`, `503`, `504` だけで、合計で最大 3 回まで、`Retry-After` と、`x-ratelimit-remaining` が `0` のときの `x-ratelimit-reset` を尊重します。待機が 20 秒を超える場合は再試行せずに諦めます。`401`, `403`, `404` はバックオフ対象外で、従来どおり認証フォールバックへ流れ、そこで残りの認証情報を順に試します。
- **organization が SAML SSO で拒否した認証情報は、その owner に対して外します。** owner と認証情報の組をセッション中は覚えておき、以降のリクエストを匿名で送るため、public なソースは失敗せず更新を続けられます。他の保存済み認証情報は従来どおり試し、ブロック済みと分かっている認証情報で同じ匿名リクエストを繰り返さず、報告する理由も「最後に試した結果」ではなく最も根本原因に近い `401` / `403` になります。ソースインデックス更新の失敗通知には `SSO セッションを開く` を表示し、`X-GitHub-SSO` ヘッダーの organization / enterprise の SSO ページだけを使います（短命な `authorization_request` は保存もログ出力もしません）。インデックス更新の各入口がブロック済み認証情報を 1 度再検証するため、別経路で SSO を認可すればリロードなしで回復します。
- **一括操作は途中で止められます。** すべて再インストール、root 単位の再インストール、複数選択の再インストール、bundle インストール、不完全なスキルの修復、再試行のいずれもキャンセルできます。実行中のスキルは次のファイルの手前で止まり、不完全として記録されるので後から「不完全なスキルを修復」で仕上げられます。次の 1 件は開始せず、サマリには要求件数のうち実際に処理した件数を表示します。
- **一部だけ取得できたインストールを成功扱いしません。** SKILL.md は取得できても他のファイルが落とせなかった場合は、成功通知を出さず、ステータスバーに未取得があることを示し、`.skill-meta.json` に `repairState` を記録し、一括操作のサマリに「一部ファイル未取得」の件数を加えます。
- **自動リトライは一時的な失敗だけ、1 回だけです。** 一括実行の後、`5xx` と通信エラーで失敗したスキルだけを、削除せずその場で 1 回だけ入れ直します。レート制限、認証失敗、`404`、サブディレクトリ上限、分類できない失敗は自動リトライしません。それでも失敗が残る場合は `失敗した N 件を再試行` から、その分だけ再実行できます。
- **別ソースが所有するフォルダを無言で上書きしません。** 書き込み前に、インストール先の `.skill-meta.json` が示す所有ソースと、これから入れるソースを比較します。所有者が違う、または特定できない場合は確認を求め、承認したときだけ既存フォルダを削除してから入れ直します。一括実行では確認を出さず失敗として数えます。
- **ワークスペースに残っている不完全なスキルは、対象が変わるたびに通知します。** 起動時に最大 5 件まで一覧し、`不完全なスキルを修復` で該当スキルだけを入れ直せます。全件再インストールは行いません。
- **配布元の安全でないファイル名は、インストールせずに除外します。** 単一の安全なパスセグメントでないリモートのファイル名 / フォルダ名（`..`、パス区切り、Windows の予約デバイス名を含むものなど）は、書き込み前に除外します。インストール自体は成功扱いのままです。単体インストールでは除外した内容を専用の警告で一覧し、一括操作では最後のサマリに除外件数を加えるため、敵対的な配布元が正常なインストールに見えることはありません。
- **symlink / junction を経由してスキルルートの外へ書き込んだり削除したりしません。** スキルフォルダの作成前、ダウンロードする各エントリ、再帰削除の前に、リンクを解決した実パスでルート配下かを再確認します。ルート外を指すリンクは拒否し、リンク切れも「未使用の名前」と見なさず拒否します。
- **配布元が同梱した `.skill-meta.json` は使いません。** このファイルは拡張機能が所有します。リポジトリに含まれていてもダウンロードせず、記録するインストール位置は必ず走査が実際に見つけた場所から再計算します。
- **ASCII に落とせないスキル名でも専用フォルダを作ります。** 非 ASCII 文字・括弧・記号だけの名前は、配布元パスの末尾セグメント、次に安定した `skill-<hash>` フォルダへフォールバックします。フォルダ名がスキルルート自身に潰れることはありません。
- **スキルルート直下の残骸は 1 回だけ通知します。** ルート直下にあり、インストール位置が空で記録された `.skill-meta.json` は、旧バージョンのフォルダ名不具合の痕跡です。警告で通知するだけで、自動削除は行いません。ルート直下の `SKILL.md` 単体はルートを 1 スキルとする正規構成なので対象外です。
- **一括削除は実際の結果を報告します。** 全スキルを削除 / 複数スキルを削除では、実際に成功した件数を数え、削除できなかった件数を報告します。要求件数をそのまま削除済みとして表示することはありません。
- **名前指定のアンインストールが別のスキルを消すことはありません。** `foo!` のような名前はフォルダ名 `foo` にサニタイズされますが、そのフォルダが実在する場合は `.skill-meta.json` が同じスキルを記録しているときだけ削除します。別スキルのフォルダ、メタデータの無い手作りのローカルスキル、壊れたメタデータは拒否します。
- **再インストールが失敗しても唯一のコピーを失いません。** アンインストール、再インストール時の置き換え、既存フォルダへの上書きインストールが失敗したときの後片付けは、いずれもフォルダを OS のごみ箱へ移動するので復元できます。永久削除するのはそのインストールが自分で作ったフォルダだけで、確認ダイアログの文言も実際の削除方式に合わせています。
- **破壊的なチャットツールは先に確認します。** `#installSkill`、`#uninstallSkill`、`#addSkillSource`、`#removeSkillSource`、`#localizeSkill` は実行前に確認ダイアログを出します。`#uninstallSkill` は解決済みのスキル名とスキルルートを確認し、複数のインストール済みスキルに一致する場合は何も削除しないため、確認した対象がそのまま削除対象になります。
- **見えている操作は、動くか理由を返すかのどちらかです。** ツリービューのコンテキストメニューに出るコマンドは、その表示条件が許す全 context value に対して検査され、実行できない場合は無言で終わらず理由を表示します。
- **起動時のプロンプトは止められます。** 起動中に出るダイアログはすべて再表示を止める手段を持ち、その選択を覚えます。`すべての設定をリセット（トークン含む）` で再表示できます。

### Agent Resources Ninja との共存

姉妹拡張 [Agent Resources Ninja](https://marketplace.visualstudio.com/items?itemName=yamapan.agent-resources-ninja) を同時にインストールしている場合、両拡張は協調して AGENTS.md / CLAUDE.md などに **共通ブロック 1 つ**（`<!-- agent-ninja-START -->` / `<!-- agent-ninja-END -->`）だけを保つようにします。両方が active のときは Resources Ninja が owner となり、Skill Ninja は黙って書き込みを譲ります。既存の `<!-- skill-ninja-* -->` ブロックは初回起動時に共通マーカーへ自動で migration されます。

どちらの拡張からインストールした remote skill でも、`.skill-meta.json` の契約は共通です。共存モードでは Skill Ninja もこの共有 metadata を登録状態の SSOT として扱うため、Resources Ninja から入れた skill でも Skill Ninja 側で managed skill として表示され、再インストールや登録解除の導線を維持します。

Resources Ninja が管理する workspace skill で、`.skill-meta.json` に `remotePath` などの remote 情報が残っているものは、Skill Ninja でも remote-backed skill として扱います。この場合、root 単位 / 個別 / 複数選択の再インストール対象に含まれます。`remotePath` が無い純粋なローカル skill だけは、従来どおりリモート index からの再インストール対象外です。

姉妹拡張がアンインストールされた場合、`vscode.extensions.onDidChange` を契機に Skill Ninja が同じ共通ブロックの owner に昇格 — 並列ブロックも孤児マーカーも残らず、通常は手動掃除不要です。

任意の shared source list: `skillNinja.useSharedSourcesManifest` を有効にすると、Skill Ninja と Agent Resources Ninja が `~/.agent-ninja/sources.json` の同じ remote source 定義を使います。共有されるのは source 一覧だけで、各拡張の index 本体や scan cache までは共有しません。

走査履歴も共有しません。姉妹拡張が登録しただけで Skill Ninja が一度も走査していない source は、`0 skills` ではなく `未インデックス` と表示され、鮮度も他拡張の時刻ではなく Skill Ninja 自身の走査で判定します。`このソースを更新` を実行するか、古い source index の確認に任せると埋まります。共有ファイル内の entry が検証に落ちた場合はスキップされ、何件スキップしたかは `スキル状態を診断` で確認できます。

#### 注: Skill Ninja アンインストール後の `resourceNinja.kindsExcluded` の挙動

Resources Ninja を使っていて `resourceNinja.kindsExcluded` に `"skill"` を含めている状態（standalone デフォルト）で **Skill Ninja をアンインストール** すると、Resources Ninja は standalone 動作に戻り、その除外を再適用します。つまり共通ブロックから **skill 行が消える** ことになります。戻すには：

1. 設定の `resourceNinja.kindsExcluded` から `"skill"` を削除する、または
2. 設定編集後に `Agent Resources Ninja: Recompute Coexistence Ownership` を実行する。

Skill Ninja が active な間は、Resources Ninja は runtime で `kindsExcluded` を無視して全 kind（skill 含む）を共通ブロックに書きます。この挙動はアンインストール後の状態にだけ影響します。

`skillNinja.coexistenceMode` を `independent` にすると協調を opt-out し、Resources Ninja の有無に関わらず legacy `<!-- skill-ninja-* -->` ブロックを書き続けます（上級者向け、並列ブロック許容）。詳細は [`.github/instructions/SkillList.instructions.md`](.github/instructions/SkillList.instructions.md) を参照。

診断コマンド: `Agent Skills Ninja: Show Coexistence Status` / `Recompute Coexistence Ownership` / `Clean Up Orphan Instruction Block`。

### 出力フォーマット詳細

| フォーマット | 内容                                                              | 用途                                    |
| ------------ | ----------------------------------------------------------------- | --------------------------------------- |
| `ref`        | IMPORTANT + instruction file にリンク、catalog は別ファイルへ分離 | 常時ロードのコンテキスト軽量化 _(既定)_ |
| `full`       | IMPORTANT + 詳細テーブル (200文字)                                | 1ファイルで完全な情報                   |
| `compact`    | IMPORTANT + 圧縮インデックス (100文字)                            | 1ファイルでトークン節約                 |
| `legacy`     | シンプルテーブルのみ（IMPORTANT なし）                            | 後方互換性                              |

`ref` を使う場合は `skillNinja.refCatalogPath`（catalog の出力先）と `skillNinja.refCatalogFormat`（`full` / `compact` / `legacy`）で catalog 内の詳細レベルを設定します。

文字数上限は説明文そのものに適用されます。内容が不完全なスキルには、その上限とは別に `[incomplete]` の接頭辞が付きます。`ref` の場合、この接頭辞は instruction ファイルではなく catalog ファイル側に出ます。

### Instruction File 同期の仕組み

`autoUpdateInstruction` が有効な場合：

1. **スキルのインストール/アンインストール** → instruction file が自動更新
2. **`skillsDirectory` 内の SKILL.md 検出** → 管理セクションへ追加
3. **Update Instruction File の手動実行** → `skillsDirectory` から管理セクションを再生成

instruction file には **IMPORTANT プロンプト** と **Description 列** を含む管理セクションが追加されます：

```markdown
<!-- agent-ninja-START -->

## Agent Skills

> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.
> Read the relevant SKILL.md before working on tasks covered by these skills.

### Skills

| Skill                                            | Description                |
| ------------------------------------------------ | -------------------------- |
| [skill-name](.github/skills/skill-name/SKILL.md) | 説明テキスト \| いつ使うか |

<!-- agent-ninja-END -->
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

> **重要**: Private source repository を使う場合は GitHub 認証が必要です。GitHub 検索でも認証を強く推奨します。未設定の場合、API レート制限（60 リクエスト/時間）により検索が失敗しやすくなります。

検索機能と Private source repository を有効にするには GitHub 認証を設定してください。Agent Skills Ninja は VS Code SecretStorage、`GH_TOKEN` / `GITHUB_TOKEN`、`gh` CLI、互換用 `skillNinja.githubToken` 設定の順に token を解決します。

### 方法 1: GitHub CLI（推奨）

```bash
gh auth login
```

GitHub CLI が入っていれば token は自動取得され、拡張機能側の設定は不要です。

### 方法 2: 環境変数

`GITHUB_TOKEN` または `GH_TOKEN` を shell や OS の環境変数に設定します。VS Code settings に credential を保存せずに済みます。

### 方法 3: 互換用 VS Code 設定

設定画面から `Agent Skills Ninja: GitHub Token` を探し、トークンを入力：

```json
{
  "skillNinja.githubToken": "<github-token>"
}
```

この互換用設定がある場合、Agent Skills Ninja は値を VS Code SecretStorage にコピーし、安全な保存先を優先して使います。この設定は後方互換と reset workflow のために残しています。

`skillNinja.githubToken` は **machine scope** の設定なので、`.vscode/settings.json` 経由で repository にコミットされることはありません。旧い workspace に平文の entry が残っている場合は起動時に削除を提案します。手動で `.vscode/settings.json` から `skillNinja.githubToken` を削除しても構いません。repository へコミット済みの token は漏えいとみなして失効させてください。

SecretStorage の token が古い、または別アカウントのものになった場合は、`Agent Skills Ninja: GitHub トークンをクリア（SecretStorage のみ）` を実行してください。SecretStorage のコピーと `settings.json` の平文コピーが削除され、環境変数と `gh` CLI 認証は変更されません。

Private repository を読む場合は、対象 repository だけに限定した fine-grained personal access token に `Contents: read` を付与する構成を推奨します。classic personal access token では `repo` scope が必要です。

Private source で `404` または「見つかりません」と表示された場合は、エラーメッセージから GitHub token 設定を開き、インデックス更新やバグ報告の前に対象 repository の読み取り権限を確認してください。

👉 [Fine-grained GitHub Token を作成する](https://github.com/settings/personal-access-tokens/new?name=Agent%20Skill%20Ninja&description=Read%20skill%20source%20repositories&contents=read)

> GitHub CLI がインストールされていれば自動でトークンを取得します（設定不要）

<a id="development" name="development"></a>

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

[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) © [yamapan](https://github.com/aktsmm)

- 非営利目的での利用・改変・再配布が可能
- 商用利用は要相談
- Microsoft 社員は業務利用可

> 本コンテンツの AI/ML トレーニング、データマイニング、その他の解析目的での使用を禁止します。

## 🔗 Related Projects

- [anthropics/skills](https://github.com/anthropics/skills) - Official Claude Skills
- [google/skills](https://github.com/google/skills) - Official Google Skills（プリセット同梱）
- [github/awesome-copilot](https://github.com/github/awesome-copilot) - Official Copilot Resources
- [microsoft/skills](https://github.com/microsoft/skills) - 参考: Official Microsoft Skills（プリセット未同梱）
- [MicrosoftDocs/Agent-Skills](https://github.com/MicrosoftDocs/Agent-Skills) - Official Azure Agent Skills（プリセット同梱）
- [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) - Curated Skills List

## 👤 Author

yamapan (https://github.com/aktsmm)
