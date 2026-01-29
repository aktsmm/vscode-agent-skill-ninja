---
applyTo: "**/package.json,**/CHANGELOG.md,**/*.vsix"
---

# VS Code 拡張リリース手順

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
