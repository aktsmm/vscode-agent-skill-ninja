# Skill Finder

<p align="center">
  <strong>Agent Skills（Copilot / Claude）の検索・インストール・管理</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#settings">Settings</a> •
  <a href="#development">Development</a>
</p>

---

## Features

- 🔍 **スキル検索** - 220+ スキルをキーワード検索
- 📦 **ワンクリックインストール** - `.github/skills/` に自動配置
- 📝 **AGENTS.md 自動更新** - インストール時に instruction file を更新
- 🌐 **GitHub 検索** - Web からスキルを発見・追加
- 🔄 **インデックス更新** - 最新スキルを取得
- 🌍 **多言語対応** - 日本語 / 英語 UI

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
ext install yamapan.skill-finder
```

### 手動インストール

1. [Releases](https://github.com/aktsmm/Ext-Skillfinder/releases) から `.vsix` をダウンロード
2. VS Code で `Ctrl+Shift+P` → `Extensions: Install from VSIX...`
3. ダウンロードした `.vsix` を選択

## Included Skill Sources

| Source                                                                                  | Type         |   Skills |
| --------------------------------------------------------------------------------------- | ------------ | -------: |
| [anthropics/skills](https://github.com/anthropics/skills)                               | 🏢 Official  |       16 |
| [github/awesome-copilot](https://github.com/github/awesome-copilot)                     | 🏢 Official  |        1 |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | 📋 Curated   |      50+ |
| [obra/superpowers](https://github.com/obra/superpowers)                                 | 👥 Community |       14 |
| **Total**                                                                               |              | **200+** |

> 💡 `Update Index` コマンドで最新のスキル数を取得できます

## Usage

### サイドバーから操作

1. アクティビティバーの **螺旋手裏剣アイコン** をクリック
2. **Installed** - インストール済みスキル一覧
3. **Browse** - ソース別にスキルを閲覧

### コマンドパレット

| コマンド                                 | 説明                           |
| ---------------------------------------- | ------------------------------ |
| `Skill Finder: Search Skills`            | スキルを検索してインストール   |
| `Skill Finder: Update Index`             | 全ソースからインデックスを更新 |
| `Skill Finder: Search on GitHub`         | GitHub でスキルを検索          |
| `Skill Finder: Add Source Repository`    | 新しいソースリポジトリを追加   |
| `Skill Finder: Remove Source Repository` | ソースリポジトリを削除         |
| `Skill Finder: Uninstall Skill`          | スキルをアンインストール       |
| `Skill Finder: Show Installed Skills`    | インストール済みスキルを表示   |

### クイックスタート

```
1. Ctrl+Shift+P → "Skill Finder: Search Skills"
2. キーワードを入力（例: "pdf", "azure", "git"）
3. スキルを選択 → "Install" をクリック
4. 完了！AGENTS.md に自動登録されます
```

## Settings

| Setting                             | Default          | Description                                    |
| ----------------------------------- | ---------------- | ---------------------------------------------- |
| `skillFinder.instructionFile`       | `agents`         | スキルを登録するファイル形式                   |
| `skillFinder.customInstructionPath` | `""`             | カスタムパス（custom 選択時）                  |
| `skillFinder.skillsDirectory`       | `.github/skills` | スキルをインストールするディレクトリ           |
| `skillFinder.autoUpdateInstruction` | `true`           | インストール時に instruction file を自動更新   |
| `skillFinder.githubToken`           | `""`             | GitHub Personal Access Token（API 制限緩和用） |

### Instruction File オプション

| 値        | ファイルパス                      | 用途           |
| --------- | --------------------------------- | -------------- |
| `agents`  | `AGENTS.md` (root)                | 推奨：汎用     |
| `copilot` | `.github/copilot-instructions.md` | GitHub Copilot |
| `claude`  | `CLAUDE.md` (root)                | Claude Code    |
| `custom`  | 任意のパス                        | カスタム       |

## GitHub Token 設定

API 制限を緩和するには GitHub Token を設定してください：

### 方法 1: VS Code 設定

```json
{
  "skillFinder.githubToken": "ghp_xxxxxxxxxxxx"
}
```

### 方法 2: GitHub CLI（推奨）

```bash
gh auth login
```

> 💡 gh CLI がインストールされていれば自動でトークンを取得します

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
3. コマンドパレット (`Ctrl+Shift+P`) で `Skill Finder` コマンドを実行

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
