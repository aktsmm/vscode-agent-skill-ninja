# Copilot Instructions

このリポジトリは VS Code 拡張機能「Agent Skill Ninja」のソースコードです。

## プロジェクト概要

- **名前**: Agent Skill Ninja
- **目的**: GitHub Copilot、Claude Code 用の Agent Skills を検索・インストール・管理
- **言語**: TypeScript
- **フレームワーク**: VS Code Extension API

## コーディング規約

- TypeScript の strict モードを使用
- ESLint ルールに従う
- 日本語と英語の両方でローカライズ対応（package.nls.json / package.nls.ja.json）

## 重要なファイル構造

| ファイル | 役割 |
|----------|------|
| `src/extension.ts` | エントリーポイント |
| `src/skillIndex.ts` | スキルインデックス管理 |
| `src/skillInstaller.ts` | スキルのインストール処理 |
| `resources/skill-index.json` | プリセットスキル一覧 |
| `package.json` | 拡張機能マニフェスト |

## Git ブランチ

- メインブランチは `master`（`main` ではない）
- `git push origin master` を使用すること

## 関連リンク

- [Marketplace](https://marketplace.visualstudio.com/items?itemName=yamapan.agent-skill-ninja)
- [GitHub](https://github.com/aktsmm/vscode-agent-skill-ninja)
