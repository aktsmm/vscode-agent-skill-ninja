# Prompt: Create New Agent

新しいエージェントマニフェスト (`.agent.md`) を作成するためのプロンプトです。
ユーザーから「〜をするエージェントを作って」と言われたときに使用します。

## 前提条件

- 参照: `.github/instructions/agents/agent-design.instructions.md` (設計原則)
- 参照: `.github/agents/sample.agent.md` (テンプレート)

## 指示

1. ユーザーの要望から、エージェントの **Role** (役割) と **Goals** (ゴール) を定義してください。
2. **Permissions** (権限) は、タスクに必要な最小限の範囲に設定してください（`git push` は原則禁止）。
3. **Workflow** (手順) は、具体的かつ実行可能なステップに分解してください。
4. 作成した内容は `.github/agents/<name>.agent.md` として保存する形式で出力してください。

## 出力フォーマット

```markdown
# [Agent Name]

## Role

...

## Goals

...

## Permissions

...

## References

- [Git Rules](../instructions/dev/git.instructions.md)
- [Terminal Rules](../instructions/dev/terminal.instructions.md)

## Workflow

...
```
