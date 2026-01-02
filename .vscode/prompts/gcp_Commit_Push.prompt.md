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
