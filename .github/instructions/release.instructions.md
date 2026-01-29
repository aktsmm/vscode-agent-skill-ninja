---
applyTo: "**/package.json,**/CHANGELOG.md,**/*.vsix"
---

# VS Code 拡張リリース手順

## ⚠️ 重要: テストファーストの原則

**コードを変更したら、ビルド・リリース前に必ずテストを実行すること！**

### テスト実行（必須）

```bash
# 1. TypeScript コンパイル & Lint（型エラー・構文エラーの検出）
npm run compile

# 2. 単体テスト（When to Use 抽出ロジック）
node scripts/test-whenToUse.js

# 3. 検索ロジックテスト
node scripts/test-search-logic.js
```

### テストが必要なケース

| 変更内容 | 必須テスト |
|----------|-----------|
| `instructionManager.ts` | `npm run compile` + 手動で Update Instruction File 確認 |
| `skillInstaller.ts` | `npm run compile` + 手動でスキルインストール確認 |
| `skillIndex.ts` | `npm run compile` + インデックス読み込み確認 |
| `indexUpdater.ts` | `npm run compile` + ソース更新・追加確認 |
| `treeProvider.ts` | `npm run compile` + TreeView 表示確認 |
| `i18n.ts` | `npm run compile` + 日英両方で UI 確認 |
| `skillSearch.ts` | `npm run compile` + `node scripts/test-search-logic.js` |
| When to Use 抽出ロジック | `node scripts/test-whenToUse.js` |

### 結合テスト（手動）

新機能やバグ修正後、以下を手動確認：

1. **スキルインストール** - リモートスキルをダブルクリックでインストール
2. **スキルアンインストール** - インストール済みスキルを右クリック → アンインストール
3. **AGENTS.md 更新** - Update Instruction File コマンドで正しく更新されるか
4. **設定変更** - instructionFile を変更して古いファイルがクリーンアップされるか
5. **ソース更新** - リモートスキルのソースを右クリック → Update Source

## クイックリリース（ドキュメント修正など軽微な変更）

⚠️ **コード変更がある場合は必ずテストを実行すること！**

変更をコミット済みの場合、以下のコマンドで一括リリース：

```bash
npx vsce package && npx vsce publish && gh release create vX.X.X agent-skill-ninja-X.X.X.vsix --title "vX.X.X - タイトル" --notes "リリースノート"
```

## フルリリース手順

### 1. テスト実行（必須）

コード変更がある場合は、必ずテストを実行すること：

```bash
# When to Use 抽出ロジックのテスト
node scripts/test-whenToUse.js

# TypeScript コンパイル & Lint
npm run compile
```

**テストが全て PASS していることを確認してからリリースに進む。**

### 2. バージョン更新（必須）

リリース時は以下の **4 ファイルを同時に** 更新すること：

| ファイル              | 更新箇所                                                      |
| --------------------- | ------------------------------------------------------------- |
| `package.json`        | `version` フィールド                                          |
| `package.nls.json`    | `config.versionInfo.markdownDescription` 内のバージョン・日付 |
| `package.nls.ja.json` | 同上（日本語版）                                              |
| `CHANGELOG.md`        | リリースノート追加（日付・変更内容）                          |

### 3. CHANGELOG の書き方

- **英日併記形式**（`English / 日本語`）
- 絵文字 + **太字タイトル** + 英語説明 / 日本語説明

例:

```markdown
### Fixed

- 🐛 **Skill Install Fix** - Fixed issue / 問題を修正
```

### 4. コミット & プッシュ

```bash
git add .
git commit -m "[Release] vX.X.X - 変更内容の要約"
git push origin master  # ⚠️ main ではなく master
```

### 5. パッケージ作成 & Marketplace 公開

```bash
npm run compile          # ビルド確認
npx vsce package         # VSIX パッケージ作成
npx vsce publish         # Marketplace に公開
```

### 6. GitHub Release 作成

```bash
gh release create vX.X.X agent-skill-ninja-X.X.X.vsix --title "vX.X.X - タイトル" --notes "リリースノート"
```

## ワンライナー（コミット済み & テスト済みの場合）

```bash
npx vsce package && npx vsce publish && gh release create vX.X.X agent-skill-ninja-X.X.X.vsix --title "vX.X.X - Title" --notes "Notes"
```

## テストファイル一覧

| ファイル                        | 内容                                  |
| ------------------------------- | ------------------------------------- |
| `scripts/test-whenToUse.js`     | When to Use 抽出ロジックのテスト      |
| `scripts/test-search-logic.js`  | 検索ロジックのテスト（存在する場合）  |

## 注意事項

- ⚠️ **同じバージョン番号で再公開不可** - エラーになったらバージョン番号を上げて再実行
- ⚠️ **ブランチ名は `master`** - `git push origin main` ではエラー
- ✅ **コード変更時は必ずテストを実行**
- ✅ リリース前に `git status` で未コミットファイルがないことを確認
- ✅ `npm run compile` が成功することを確認してから公開

## 公開後の確認

- 🛒 Marketplace: https://marketplace.visualstudio.com/items?itemName=yamapan.agent-skill-ninja
- 📦 GitHub Releases: https://github.com/aktsmm/vscode-agent-skill-ninja/releases
