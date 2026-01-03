---
description: "セッション終了時に内容をエクスポート（次回継続・知識蓄積・ブログネタ用）"
---

# セッションエクスポート

セッションの内容を構造化して出力してください。
**本質的な情報のみ抽出**し、雑談・試行錯誤の過程・失敗した試みは除外してください。

## 入力

このセッションの会話履歴を分析してください。

## 出力フォーマット

```yaml
session:
  meta:
    date: "YYYY-MM-DD"
    project: "プロジェクト名（あれば）"
    summary: "セッション全体の一行要約"

  # ===== 成果物 =====
  accomplishments:
    - what: "何を達成したか"
      files: ["変更/作成したファイルパス"]
      detail: "具体的な内容（必要なら）"

  # ===== 収集した知識 =====
  knowledge:
    snippets:
      - name: "スニペット名"
        code: |
          # 再利用可能なコード/コマンド
        usage: "使い方・用途"

    patterns:
      - name: "パターン名"
        description: "ベストプラクティス/発見したパターン"

    keywords:
      - "技術キーワード1"
      - "技術キーワード2"

  # ===== 参考URL（必須・漏れなく記載） =====
  references:
    - url: "https://example.com/page"
      title: "ページタイトル"
      purpose: "何のために使ったか（例: 公式ドキュメント参照、エラー解決、API仕様確認）"

  # ===== 次回継続用 =====
  continuation:
    current_state: "現在の状態（どこまで終わったか）"
    pending:
      - task: "残タスク"
        context: "必要な背景情報"
    next_actions:
      - "次回やること1"
      - "次回やること2"
    open_questions:
      - "未解決の疑問（あれば）"

  # ===== ブログネタ候補 =====
  blog_seeds:
    - title: "記事タイトル案"
      category: "作ってみた | 宣伝・紹介 | 解説・入門 | Tips | 比較・検証 | トラブルシューティング | まとめ・ログ"
      hook: "読者の興味を引くポイント"
```

## 抽出ルール

### ✅ 含める情報

- 最終的に採用した解決策・コード
- 確定した設計判断・決定事項
- 今後も使える知識・パターン
- 参照した URL（目的を明記）
- 次回に必要なコンテキスト

### ❌ 除外する情報

- 試行錯誤の過程（失敗した試み）
- 雑談・本題と関係ない話題
- 一時的なデバッグ出力
- 最終的に使わなかったコード/アプローチ
- 自明な情報（「ファイルを保存した」等）

## 参考 URL の記載ルール

URL は以下の形式で**漏れなく**記載：

```yaml
references:
  - url: "https://docs.microsoft.com/..."
    title: "Azure Functions Python 開発者ガイド"
    purpose: "Python でのトリガー設定方法を確認"
```

**purpose（目的）の例**:

- 公式ドキュメント参照
- エラーメッセージの解決
- API 仕様の確認
- サンプルコードの参考
- ライブラリのインストール手順
- ベストプラクティスの確認

## 出力先

```
/output/sessions/YYYY-MM-DD_セッション名.md
```

例: `/output/sessions/2026-01-04_skill-finder更新.md`
