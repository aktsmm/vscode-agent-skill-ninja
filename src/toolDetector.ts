// 出力フォーマットの解決
// ユーザー設定を正規化し、instruction ファイルの出力形式を返す。

import * as vscode from "vscode";

/**
 * 出力フォーマット（スキルリストの表示形式）
 * - ref: instruction ファイルには軽量 IMPORTANT + catalog link、詳細は catalog ファイルへ分離（既定）
 * - full: IMPORTANT + 詳細テーブル
 * - compact: IMPORTANT + 圧縮インデックスのみ
 * - legacy: シンプルテーブルのみ（OLD）
 * - none: 何も書かない。既存の管理ブロックと生成 catalog は掃除される
 */
export type OutputFormat = "full" | "compact" | "legacy" | "ref" | "none";

export function normalizeOutputFormat(value: string | undefined): OutputFormat {
  switch ((value || "").trim()) {
    case "ref":
    case "full":
    case "compact":
    case "legacy":
    case "none":
      return value as OutputFormat;
    case "markdown":
      return "legacy";
    case "compressed-index":
      return "compact";
    case "markdown-with-index":
      return "full";
    default:
      return "ref";
  }
}

/**
 * 設定された出力フォーマットと instruction ファイルを返す。
 * ツールの自動検出は行わず、ユーザー設定をそのまま正本にする。
 */
export async function resolveOutputFormat(
  _workspaceUri?: vscode.Uri,
): Promise<{ format: OutputFormat; instructionFile: string }> {
  const config = vscode.workspace.getConfiguration("skillNinja");
  const outputFormat = normalizeOutputFormat(
    config.get<string>("outputFormat"),
  );

  const userInstructionFile =
    config.get<string>("instructionFile") || "AGENTS.md";
  const instructionFile =
    userInstructionFile === "custom"
      ? config.get<string>("customInstructionPath") || "AGENTS.md"
      : userInstructionFile;

  return {
    format: outputFormat,
    instructionFile,
  };
}
