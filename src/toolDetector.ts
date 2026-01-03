// AI ツール自動検出
// ワークスペース内の設定ファイルから使用中の AI ツールを検出

import * as vscode from "vscode";

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
 * 出力フォーマット
 */
export type OutputFormat =
  | "markdown"
  | "cursor-rules"
  | "windsurf-rules"
  | "cline-rules";

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

/**
 * ワークスペース内の AI ツールを検出
 */
export async function detectAITools(
  workspaceUri: vscode.Uri
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
      format: "cursor-rules",
      instructionFile: ".cursor/rules/skills.mdc",
      confidence: "high",
    },
    {
      pattern: ".cursorrules",
      tool: "cursor",
      format: "cursor-rules",
      instructionFile: ".cursor/rules/skills.mdc",
      confidence: "high",
    },
    // Windsurf
    {
      pattern: ".windsurfrules",
      tool: "windsurf",
      format: "windsurf-rules",
      instructionFile: ".windsurfrules",
      confidence: "high",
    },
    {
      pattern: ".windsurf/**",
      tool: "windsurf",
      format: "windsurf-rules",
      instructionFile: ".windsurfrules",
      confidence: "high",
    },
    // Cline
    {
      pattern: ".clinerules",
      tool: "cline",
      format: "cline-rules",
      instructionFile: ".clinerules",
      confidence: "high",
    },
    {
      pattern: ".cline/**",
      tool: "cline",
      format: "cline-rules",
      instructionFile: ".clinerules",
      confidence: "high",
    },
    // Claude Code
    {
      pattern: "CLAUDE.md",
      tool: "claude-code",
      format: "markdown",
      instructionFile: "CLAUDE.md",
      confidence: "high",
    },
    {
      pattern: ".claude/**",
      tool: "claude-code",
      format: "markdown",
      instructionFile: "CLAUDE.md",
      confidence: "medium",
    },
    // GitHub Copilot
    {
      pattern: ".github/copilot-instructions.md",
      tool: "github-copilot",
      format: "markdown",
      instructionFile: ".github/copilot-instructions.md",
      confidence: "high",
    },
    {
      pattern: ".github/instructions/**",
      tool: "github-copilot",
      format: "markdown",
      instructionFile: ".github/instructions/SkillList.instructions.md",
      confidence: "high",
    },
    {
      pattern: "AGENTS.md",
      tool: "github-copilot",
      format: "markdown",
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

  // 推奨フォーマットを決定（優先順位: cursor > windsurf > cline > claude-code > github-copilot）
  const priorityOrder: AITool[] = [
    "cursor",
    "windsurf",
    "cline",
    "claude-code",
    "github-copilot",
  ];

  let recommendedFormat: OutputFormat = "markdown";
  let recommendedInstructionFile = "AGENTS.md";

  for (const tool of priorityOrder) {
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
  result: ToolDetectionResult
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
      placeHolder: "Select your AI coding assistant",
      title: "Agent Skill Ninja - Tool Selection",
    });

    if (!selected) {
      return undefined;
    }

    // 選択に基づいてフォーマットを決定
    if (selected.label.includes("Cursor")) {
      return {
        format: "cursor-rules",
        instructionFile: ".cursor/rules/skills.mdc",
      };
    } else if (selected.label.includes("Windsurf")) {
      return { format: "windsurf-rules", instructionFile: ".windsurfrules" };
    } else if (selected.label.includes("Cline")) {
      return { format: "cline-rules", instructionFile: ".clinerules" };
    } else if (selected.label.includes("Claude")) {
      return { format: "markdown", instructionFile: "CLAUDE.md" };
    } else {
      return { format: "markdown", instructionFile: "AGENTS.md" };
    }
  }

  // 複数のツールが検出された場合は選択させる
  if (result.detectedTools.length > 1) {
    const items: vscode.QuickPickItem[] = result.detectedTools.map((d) => ({
      label: getToolDisplayName(d.tool),
      description: d.suggestedInstructionFile,
      detail: `Detected: ${d.configPath}`,
    }));

    // 推奨を先頭に
    items.unshift({
      label: `$(star) Recommended: ${getToolDisplayName(
        result.detectedTools[0].tool
      )}`,
      description: result.recommendedInstructionFile,
      detail: "Based on detected configuration",
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Multiple AI tools detected. Select one:",
      title: "Agent Skill Ninja - Tool Selection",
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
    "Cancel"
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
      recommendedFormat: "markdown",
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
  workspaceUri: vscode.Uri
): Promise<{ format: OutputFormat; instructionFile: string }> {
  const config = vscode.workspace.getConfiguration("skillNinja");
  const outputFormat = config.get<string>("outputFormat") || "auto";
  const enableToolDetection =
    config.get<boolean>("enableToolDetection") ?? true;

  // auto でない場合は設定値を使用
  if (outputFormat !== "auto") {
    let instructionFile = config.get<string>("instructionFile") || "AGENTS.md";
    if (instructionFile === "custom") {
      instructionFile =
        config.get<string>("customInstructionPath") || "AGENTS.md";
    }
    return {
      format: outputFormat as OutputFormat,
      instructionFile,
    };
  }

  // auto の場合は検出
  if (enableToolDetection) {
    const result = await detectAITools(workspaceUri);
    if (result.detectedTools.length > 0) {
      return {
        format: result.recommendedFormat,
        instructionFile: result.recommendedInstructionFile,
      };
    }
  }

  // 検出できなかった場合はデフォルト
  let instructionFile = config.get<string>("instructionFile") || "AGENTS.md";
  if (instructionFile === "custom") {
    instructionFile =
      config.get<string>("customInstructionPath") || "AGENTS.md";
  }
  return {
    format: "markdown",
    instructionFile,
  };
}
