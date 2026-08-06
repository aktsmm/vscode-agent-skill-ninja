---
description: "Preset skill index curation rules for resources/skill-index.json"
applyTo: "**/resources/skill-index.json"
---

# Skill Index 管理ルール

## プリセットソースの基準

### ✅ 含めるべきソース

1. **Official リポジトリ**
   - `anthropics/skills` - Anthropic 公式
   - `openai/skills` - OpenAI 公式
   - `google/skills` - Google 公式
   - `github/awesome-copilot` - GitHub 公式
   - `MicrosoftDocs/Agent-Skills` - Microsoft 公式 Azure Agent Skills

2. **Curated リポジトリ（awesome-list）**
   - `ComposioHQ/awesome-claude-skills` - キュレーション済みリスト
   - Star 数が多く、活発にメンテナンスされているもの

3. **Community リポジトリ（有名・高品質）**
   - `obra/superpowers` - 高品質スキル集
   - `muratcankoylan/Agent-Skills-for-Context-Engineering` - Context Engineering (5k+ stars)
   - `danielmiessler/LifeOS` - LifeOS Skills, PAI successor (3.5k+ stars)
   - `EveryInc/compound-engineering-plugin` - Compound Engineering (3.5k+ stars)
   - `Wirasm/prp` - PRP (Prompt Recipe Patterns)
   - `qdhenry/Claude-Command-Suite` - Claude Command Suite

### 除外済みソース

- `microsoft/skills` - 2026-03 にプリセット対象から除外
  - 理由: 公開 compatibility path (`skills/...`) が upstream で broken state になっており、プリセット登録済みなのにインストール失敗する UX リスクがある
  - 扱い: Related Projects での参照は可。ただし bundled preset source には戻さない

### ❌ 含めないソース

1. **個人リポジトリ**
   - 開発者個人のリポジトリ（例: `aktsmm/Agent-Skills`）
   - テスト用・実験的なリポジトリ
   - プライベートまたは非公開予定のリポジトリ

2. **低品質・メンテナンス停止**
   - Star 数が少ない（目安: 100 未満）
   - 最終更新が 1 年以上前
   - README やドキュメントが不十分

3. **重複・派生リポジトリ**
   - 既存ソースの単純なフォーク
   - 内容が重複しているもの

## バージョン管理

- マイナーアップデート（スキル追加・削除、メタデータ更新）: `1.X.0` → `1.(X+1).0`
- パッチ（説明文修正など軽微な変更）: `1.X.Y` → `1.X.(Y+1)`

## scanner の指定

- 既定は SKILL.md 走査。`SKILL.md` 以外の並び（`.claude/commands` 配下、トップレベルディレクトリ、`registry.json`）に依存する source は `scanner` を明示する
- 指定値: `skill-md` / `claude-commands` / `top-level-dirs` / `registry-json`
- 未指定のときだけ repo 名ベースの legacy 判定へ落ちる。この判定は rename で黙って外れるため、プリセット source では依存しない
- `skill-md` 以外を指定した source は `scripts/update-preset-index.js` で再生成できない（SKILL.md が 0 件のとき明示的に失敗する）。その場合は拡張機能側から更新する

## 更新時のチェックリスト

- [ ] ソースの type が適切か（official / awesome-list / community）
- [ ] 個人リポジトリが含まれていないか
- [ ] バージョン番号を更新したか
- [ ] lastUpdated を現在の日付に更新したか

## ソース削除時の対応

1. sources セクションから該当ソースを削除
2. skills セクションから `"source": "削除するソースID"` のスキルをすべて削除
3. バージョンをインクリメント
4. README の「Included Skill Sources」も更新
