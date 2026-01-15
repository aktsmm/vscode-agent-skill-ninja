---
applyTo: "**/package.json,**/CHANGELOG.md,**/*.vsix"
---

# VS Code 拡張リリース手順

## バージョン更新（必須）

リリース時は以下の **4 ファイルを同時に** 更新すること：

| ファイル | 更新箇所 |
|----------|----------|
| `package.json` | `version` フィールド |
| `package.nls.json` | `config.versionInfo.markdownDescription` 内のバージョン・スキル数 |
| `package.nls.ja.json` | 同上（日本語版） |
| `CHANGELOG.md` | リリースノート追加（日付・変更内容） |

## コミット & プッシュ

```bash
git add .
git commit -m "[Release] vX.X.X - 変更内容の要約"
git push origin master  # ⚠️ main ではなく master
```

## パッケージ作成 & 公開

```bash
npm run compile          # ビルド確認
npx vsce package         # VSIX パッケージ作成
npx vsce publish         # Marketplace に公開
```

## GitHub Release 作成

```bash
gh release create vX.X.X agent-skill-ninja-X.X.X.vsix \
  --title "vX.X.X - タイトル" \
  --notes "リリースノート"
```

## 注意事項

- ⚠️ **同じバージョン番号で再公開不可** - `vsce publish` は既存バージョンを上書きできない。エラーになったらバージョン番号を上げて再実行
- ⚠️ **ブランチ名は `master`** - `git push origin main` ではエラーになる
- ✅ リリース前に `git status` で未コミットファイルがないことを確認
- ✅ `npm run compile` が成功することを確認してから公開

## 公開後の確認

- 🛒 Marketplace: https://marketplace.visualstudio.com/items?itemName=yamapan.agent-skill-ninja
- 📦 GitHub Releases: https://github.com/aktsmm/vscode-agent-skill-ninja/releases
