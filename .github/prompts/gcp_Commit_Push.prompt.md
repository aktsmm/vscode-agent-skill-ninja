# Prompt: Commit & Push

保存していないファイルを保存して commit & Push してください。

## 手順

0. 正しいディレクトリにいることを確認
1. VS Code コマンド `workbench.action.files.saveAll` で未保存ファイルを保存
2. `git config user.name` でコミットユーザー名を確認（出力例に表示用）
3. `git add .` で新規ファイルを含むすべての変更をステージング
4. `git commit -m "<コミットメッセージ>"` でコミット
5. `git push origin main` でリモートにプッシュ
6. Remote リポジトリへの URL を表示

## コミットメッセージのフォーマット

以下の形式でコミットメッセージを作成してください：

```
[カテゴリ] 変更内容の要約（25文字以内）
```

## VS Code 拡張公開時の追加手順

VS Code 拡張を公開する場合は、以下も実行：

7. `npx vsce package` で VSIX パッケージ作成
8. `npx vsce publish` で Marketplace に公開
9. `gh release create vX.X.X <vsix-file> --title "vX.X.X - タイトル" --notes "<リリースノート>"` で GitHub Release 作成
10. Marketplace URL と GitHub Release URL を表示
