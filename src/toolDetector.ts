// AI ツール自動検出
// ワークスペース内の設定ファイルから使用中の AI ツールを検出

import * as vscode from "vscode";
import { isJapanese } from "./i18n";

/**
 * 検出可能な AI ツール
 */
export type AITool =
  | "github-copilot"
  | "claude-code"
  | "cursor"
  | "windsurf"
  | "cline"
  | "unknown";

/**
 * 出力フォーマット（スキルリストの表示形式）
 * - ref: instruction ファイルには軽量 IMPORTANT + catalog link、詳細は catalog ファイルへ分離（既定）
 * - full: IMPORTANT + 詳細テーブル
 * - compact: IMPORTANT + 圧縮インデックスのみ
 * - legacy: シンプルテーブルのみ（OLD）
 */
export type OutputFormat = "full" | "compact" | "legacy" | "ref";

export function normalizeOutputFormat(value: string | undefined): OutputFormat {
  switch ((value || "").trim()) {
    case "ref":
    case "full":
    case "compact":
    case "legacy":
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
 * 検出されたツール情報
 */
export interface DetectedTool {
  tool: AITool;
  configPath: string;
  confidence: "high" | "medium" | "low";
  suggestedFormat: OutputFormat;
  suggestedInstructionFile: string;
}

/**
 * ツール検出結果
 */
export interface ToolDetectionResult {
  detectedTools: DetectedTool[];
  recommendedFormat: OutputFormat;
  recommendedInstructionFile: string;
}

const TOOL_PRIORITY_ORDER: ReadonlyArray<AITool> = [
  "cursor",
  "windsurf",
  "cline",
  "claude-code",
  "github-copilot",
];

/**
 * ワークスペース内の AI ツールを検出
 */
export async function detectAITools(
  workspaceUri: vscode.Uri,
): Promise<ToolDetectionResult> {
  const detectedTools: DetectedTool[] = [];

  // 各ツールの設定ファイルをチェック
  const checks: Array<{
    pattern: string;
    tool: AITool;
    format: OutputFormat;
    instructionFile: string;
    confidence: "high" | "medium" | "low";
  }> = [
    // Cursor
    {
      pattern: ".cursor/rules/**",
      tool: "cursor",
      format: "full",
      instructionFile: ".cursor/rules/skills.mdc",
      confidence: "high",
    },
    {
      pattern: ".cursorrules",
      tool: "cursor",
      format: "full",
      instructionFile: ".cursor/rules/skills.mdc",
      confidence: "high",
    },
    // Windsurf
    {
      pattern: ".windsurfrules",
      tool: "windsurf",
      format: "full",
      instructionFile: ".windsurfrules",
      confidence: "high",
    },
    {
      pattern: ".windsurf/**",
      tool: "windsurf",
      format: "full",
      instructionFile: ".windsurfrules",
      confidence: "high",
    },
    // Cline
    {
      pattern: ".clinerules",
      tool: "cline",
      format: "full",
      instructionFile: ".clinerules",
      confidence: "high",
    },
    {
      pattern: ".cline/**",
      tool: "cline",
      format: "full",
      instructionFile: ".clinerules",
      confidence: "high",
    },
    // Claude Code
    {
      pattern: "CLAUDE.md",
      tool: "claude-code",
      format: "ref",
      instructionFile: "CLAUDE.md",
      confidence: "high",
    },
    {
      pattern: ".claude/**",
      tool: "claude-code",
      format: "ref",
      instructionFile: "CLAUDE.md",
      confidence: "medium",
    },
    // GitHub Copilot
    {
      pattern: ".github/copilot-instructions.md",
      tool: "github-copilot",
      format: "ref",
      instructionFile: ".github/copilot-instructions.md",
      confidence: "high",
    },
    {
      pattern: ".github/instructions/**",
      tool: "github-copilot",
      format: "ref",
      instructionFile: ".github/instructions/SkillList.instructions.md",
      confidence: "high",
    },
    {
      pattern: "AGENTS.md",
      tool: "github-copilot",
      format: "ref",
      instructionFile: "AGENTS.md",
      confidence: "medium",
    },
  ];

  for (const check of checks) {
    const pattern = new vscode.RelativePattern(workspaceUri, check.pattern);
    const files = await vscode.workspace.findFiles(pattern, null, 1);

    if (files.length > 0) {
      // 既に同じツールが検出されていない場合のみ追加
      const alreadyDetected = detectedTools.some((d) => d.tool === check.tool);
      if (!alreadyDetected) {
        detectedTools.push({
          tool: check.tool,
          configPath: files[0].fsPath,
          confidence: check.confidence,
          suggestedFormat: check.format,
          suggestedInstructionFile: check.instructionFile,
        });
      }
    }
  }

  let recommendedFormat: OutputFormat = "ref";
  let recommendedInstructionFile = "AGENTS.md";

  // 推奨フォーマットを決定（優先順位: cursor > windsurf > cline > claude-code > github-copilot）
  for (const tool of TOOL_PRIORITY_ORDER) {
    const detected = detectedTools.find((d) => d.tool === tool);
    if (detected) {
      recommendedFormat = detected.suggestedFormat;
      recommendedInstructionFile = detected.suggestedInstructionFile;
      break;
    }
  }

  return {
    detectedTools,
    recommendedFormat,
    recommendedInstructionFile,
  };
}

/**
 * 検出結果をユーザーに表示し、選択させる
 */
export async function promptToolSelection(
  result: ToolDetectionResult,
): Promise<{ format: OutputFormat; instructionFile: string } | undefined> {
  if (result.detectedTools.length === 0) {
    // ツールが検出されなかった場合はデフォルトを提案
    const items: vscode.QuickPickItem[] = [
      {
        label: "$(copilot) GitHub Copilot",
        description: "AGENTS.md / copilot-instructions.md",
        detail: "Markdown format",
      },
      {
        label: "$(terminal) Claude Code",
        description: "CLAUDE.md",
        detail: "Markdown format",
      },
      {
        label: "$(code) Cursor",
        description: ".cursor/rules/",
        detail: "Cursor Rules format (.mdc)",
      },
      {
        label: "$(zap) Windsurf",
        description: ".windsurfrules",
        detail: "Windsurf Rules format",
      },
      {
        label: "$(beaker) Cline",
        description: ".clinerules",
        detail: "Cline Rules format",
      },
    ];

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: isJapanese()
        ? "AI コーディングアシスタントを選択"
        : "Select your AI coding assistant",
      title: isJapanese()
        ? "Agent Skills Ninja - ツール選択"
        : "Agent Skills Ninja - Tool Selection",
    });

    if (!selected) {
      return undefined;
    }

    // 選択に基づいてフォーマットを決定
    if (selected.label.includes("Cursor")) {
      return {
        format: "full",
        instructionFile: ".cursor/rules/skills.mdc",
      };
    } else if (selected.label.includes("Windsurf")) {
      return { format: "full", instructionFile: ".windsurfrules" };
    } else if (selected.label.includes("Cline")) {
      return { format: "full", instructionFile: ".clinerules" };
    } else if (selected.label.includes("Claude")) {
      return { format: "ref", instructionFile: "CLAUDE.md" };
    } else {
      return { format: "ref", instructionFile: "AGENTS.md" };
    }
  }

  // 複数のツールが検出された場合は選択させる
  if (result.detectedTools.length > 1) {
    const recommendedTool = TOOL_PRIORITY_ORDER.find((tool) =>
      result.detectedTools.some((d) => d.tool === tool),
    );
    const recommendedDetected = recommendedTool
      ? result.detectedTools.find((d) => d.tool === recommendedTool)
      : undefined;

    const items: vscode.QuickPickItem[] = result.detectedTools.map((d) => ({
      label: getToolDisplayName(d.tool),
      description: d.suggestedInstructionFile,
      detail: `Detected: ${d.configPath}`,
    }));

    // 推奨を先頭に
    items.unshift({
      label: `$(star) Recommended: ${getToolDisplayName(
        recommendedDetected?.tool ?? result.detectedTools[0].tool,
      )}`,
      description: result.recommendedInstructionFile,
      detail: "Based on detected configuration",
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Multiple AI tools detected. Select one:",
      title: "Agent Skills Ninja - Tool Selection",
    });

    if (!selected) {
      return undefined;
    }

    // 選択されたツールを探す
    for (const d of result.detectedTools) {
      if (selected.label.includes(getToolDisplayName(d.tool))) {
        return {
          format: d.suggestedFormat,
          instructionFile: d.suggestedInstructionFile,
        };
      }
    }

    // 推奨が選択された場合
    return {
      format: result.recommendedFormat,
      instructionFile: result.recommendedInstructionFile,
    };
  }

  // 1つのツールのみ検出された場合は確認
  const detected = result.detectedTools[0];
  const confirm = await vscode.window.showInformationMessage(
    `Detected: ${getToolDisplayName(detected.tool)}. Use ${
      detected.suggestedInstructionFile
    }?`,
    "Yes",
    "Choose Different",
    "Cancel",
  );

  if (confirm === "Yes") {
    return {
      format: detected.suggestedFormat,
      instructionFile: detected.suggestedInstructionFile,
    };
  } else if (confirm === "Choose Different") {
    // 再帰的に選択を促す（空の結果で）
    return promptToolSelection({
      detectedTools: [],
      recommendedFormat: "ref",
      recommendedInstructionFile: "AGENTS.md",
    });
  }

  return undefined;
}

/**
 * ツール名の表示用文字列を取得
 */
function getToolDisplayName(tool: AITool): string {
  switch (tool) {
    case "github-copilot":
      return "GitHub Copilot";
    case "claude-code":
      return "Claude Code";
    case "cursor":
      return "Cursor";
    case "windsurf":
      return "Windsurf";
    case "cline":
      return "Cline";
    default:
      return "Unknown";
  }
}

/**
 * 設定された出力フォーマットを取得（auto の場合は検出結果を使用）
 */
export async function resolveOutputFormat(
  _workspaceUri?: vscode.Uri,
): Promise<{ format: OutputFormat; instructionFile: string }> {
  const config = vscode.workspace.getConfiguration("skillNinja");
  const outputFormat = normalizeOutputFormat(
    config.get<string>("outputFormat"),
  );

  // ユーザーが設定した instructionFile を取得
  const userInstructionFile =
    config.get<string>("instructionFile") || "AGENTS.md";

  // カスタムパスの解決
  const resolveInstructionFile = (): string => {
    if (userInstructionFile === "custom") {
      return config.get<string>("customInstructionPath") || "AGENTS.md";
    }
    return userInstructionFile;
  };

  // instructionFile は常にユーザー設定を使用（自動検出しない）
  const instructionFile = resolveInstructionFile();

  return {
    format: outputFormat,
    instructionFile,
  };
}
