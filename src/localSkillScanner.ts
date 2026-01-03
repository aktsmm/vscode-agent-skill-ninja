// ローカルスキルのスキャンと AGENTS.md 同期
// ワークスペース内の SKILL.md を検出し、AGENTS.md と同期

import * as vscode from "vscode";
import { Skill } from "./skillIndex";
import { updateInstructionFile } from "./instructionManager";

/**
 * ローカルスキル情報（拡張版）
 */
export interface LocalSkill extends Skill {
  isLocal: true;
  fullPath: string; // フルパス
  relativePath: string; // ワークスペース相対パス
  isRegistered: boolean; // AGENTS.md に登録済みか
  registrationFile?: string; // 登録されているファイル (AGENTS.md など)
}

/**
 * AGENTS.md のスキル参照情報
 */
export interface SkillReference {
  name: string;
  path: string;
  line: number;
  isLocal: boolean;
}

/**
 * ワークスペース内の SKILL.md をスキャン
 * @param workspaceUri ワークスペースの URI
 * @param includeInstalled true の場合、.github/skills 配下も含める
 */
export async function scanLocalSkills(
  workspaceUri: vscode.Uri,
  includeInstalled: boolean = false
): Promise<LocalSkill[]> {
  const skills: LocalSkill[] = [];

  // 設定からスキルディレクトリを取得
  const config = vscode.workspace.getConfiguration("skillNinja");
  const skillsDir = config.get<string>("skillsDirectory") || ".github/skills";

  // SKILL.md ファイルを検索（node_modules は除外）
  const pattern = new vscode.RelativePattern(workspaceUri, "**/SKILL.md");
  const excludePattern = "**/node_modules/**";

  const files = await vscode.workspace.findFiles(pattern, excludePattern, 100);

  for (const file of files) {
    try {
      const relativePath = vscode.workspace.asRelativePath(file, false);

      // インストール済みスキル（.github/skills 配下）を除外するか
      if (!includeInstalled && relativePath.startsWith(skillsDir)) {
        continue;
      }

      const skill = await parseLocalSkillFile(file, workspaceUri);
      if (skill) {
        skills.push(skill);
      }
    } catch (error) {
      console.warn(`Failed to parse ${file.fsPath}:`, error);
    }
  }

  // AGENTS.md の登録状態をチェック
  await checkRegistrationStatus(skills, workspaceUri);

  return skills;
}

/**
 * SKILL.md ファイルを解析してスキル情報を取得
 */
async function parseLocalSkillFile(
  fileUri: vscode.Uri,
  _workspaceUri: vscode.Uri
): Promise<LocalSkill | null> {
  const content = await vscode.workspace.fs.readFile(fileUri);
  const text = Buffer.from(content).toString("utf8");

  // frontmatter を解析
  const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---/);

  let name = "";
  let description = "";
  let categories: string[] = [];

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    const nameMatch = frontmatter.match(/^name:\s*["']?([^"'\n]+)["']?/m);
    const descMatch = frontmatter.match(
      /^description:\s*["']?([^"'\n]+)["']?/m
    );
    const categoriesMatch = frontmatter.match(/^categories:\s*\[([^\]]+)\]/m);

    name = nameMatch?.[1]?.trim() || "";
    description = descMatch?.[1]?.trim() || "";

    if (categoriesMatch) {
      categories = categoriesMatch[1]
        .split(",")
        .map((c) => c.trim().replace(/["']/g, ""));
    }
  }

  // 名前がない場合はディレクトリ名を使用
  if (!name) {
    const pathParts = fileUri.fsPath.split(/[/\\]/);
    name = pathParts[pathParts.length - 2] || "Unknown";
  }

  // 相対パスを計算
  const relativePath = vscode.workspace.asRelativePath(fileUri, false);
  const skillDir = relativePath.replace(/[/\\]SKILL\.md$/, "");

  return {
    name,
    description,
    categories,
    source: "local",
    path: skillDir,
    isLocal: true,
    fullPath: fileUri.fsPath,
    relativePath: skillDir,
    isRegistered: false,
  };
}

/**
 * AGENTS.md などの instruction file を読み取り、登録状態をチェック
 * ※ skill-ninja マーカー内のみをチェック（手動記載との重複を避けるため）
 */
async function checkRegistrationStatus(
  skills: LocalSkill[],
  workspaceUri: vscode.Uri
): Promise<void> {
  const config = vscode.workspace.getConfiguration("skillNinja");
  const instructionFile = config.get<string>("instructionFile", "AGENTS.md");

  // instruction file のパスを解決
  let instructionPath: string;
  if (instructionFile === "custom") {
    instructionPath = config.get<string>("customInstructionPath", "AGENTS.md");
  } else {
    instructionPath = instructionFile;
  }

  const instructionUri = vscode.Uri.joinPath(workspaceUri, instructionPath);

  // マーカー
  const MARKER_START = "<!-- skill-ninja-START -->";
  const MARKER_END = "<!-- skill-ninja-END -->";

  try {
    const content = await vscode.workspace.fs.readFile(instructionUri);
    const text = Buffer.from(content).toString("utf8");

    // マーカー内の部分のみを抽出
    const startIndex = text.indexOf(MARKER_START);
    const endIndex = text.indexOf(MARKER_END);

    // マーカーがない場合は未登録として扱う
    if (startIndex === -1 || endIndex === -1) {
      return;
    }

    const markerContent = text.substring(
      startIndex,
      endIndex + MARKER_END.length
    );

    // スキル参照を検出（マーカー内のみ）
    for (const skill of skills) {
      // .github/skills/xxx または skills/xxx などのパターンをチェック
      const patterns = [
        skill.relativePath,
        `./${skill.relativePath}`,
        skill.name,
      ];

      for (const pattern of patterns) {
        if (markerContent.includes(pattern)) {
          skill.isRegistered = true;
          skill.registrationFile = instructionPath;
          break;
        }
      }
    }
  } catch {
    // instruction file が存在しない場合は無視
  }
}

/**
 * AGENTS.md からスキル参照を抽出
 */
export async function parseInstructionFile(
  workspaceUri: vscode.Uri
): Promise<SkillReference[]> {
  const config = vscode.workspace.getConfiguration("skillNinja");
  const instructionFile = config.get<string>("instructionFile", "AGENTS.md");

  let instructionPath: string;
  if (instructionFile === "custom") {
    instructionPath = config.get<string>("customInstructionPath", "AGENTS.md");
  } else {
    instructionPath = instructionFile;
  }

  const instructionUri = vscode.Uri.joinPath(workspaceUri, instructionPath);

  try {
    const content = await vscode.workspace.fs.readFile(instructionUri);
    const text = Buffer.from(content).toString("utf8");
    const lines = text.split("\n");
    const references: SkillReference[] = [];

    // Skills セクションを探す
    let inSkillsSection = false;
    const skillsSectionPattern = /^##\s*(Skills|Installed Skills|スキル)/i;
    const nextSectionPattern = /^##\s/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (skillsSectionPattern.test(line)) {
        inSkillsSection = true;
        continue;
      }

      if (
        inSkillsSection &&
        nextSectionPattern.test(line) &&
        !skillsSectionPattern.test(line)
      ) {
        inSkillsSection = false;
        continue;
      }

      if (inSkillsSection) {
        // - [スキル名](パス) または - スキル名: パス 形式を検出
        const linkMatch = line.match(/^-\s*\[([^\]]+)\]\(([^)]+)\)/);
        const colonMatch = line.match(/^-\s*([^:]+):\s*(.+)/);
        const simpleMatch = line.match(/^-\s*`?([^`\n]+)`?\s*$/);

        if (linkMatch) {
          references.push({
            name: linkMatch[1].trim(),
            path: linkMatch[2].trim(),
            line: i + 1,
            isLocal: !linkMatch[2].startsWith("http"),
          });
        } else if (colonMatch) {
          references.push({
            name: colonMatch[1].trim(),
            path: colonMatch[2].trim(),
            line: i + 1,
            isLocal: !colonMatch[2].startsWith("http"),
          });
        } else if (simpleMatch && simpleMatch[1].includes("/")) {
          references.push({
            name: simpleMatch[1].split("/").pop() || simpleMatch[1],
            path: simpleMatch[1].trim(),
            line: i + 1,
            isLocal: true,
          });
        }
      }
    }

    return references;
  } catch {
    return [];
  }
}

/**
 * ローカルスキルを AGENTS.md に登録
 * ※ updateInstructionFile を呼び出してマーカー内で統一管理
 */
export async function registerLocalSkill(
  _skill: LocalSkill,
  workspaceUri: vscode.Uri,
  context?: vscode.ExtensionContext
): Promise<boolean> {
  try {
    // instructionManager の updateInstructionFile を使用
    // これにより、全てのスキル（インストール済み＋ローカル）がマーカー内で管理される
    await updateInstructionFile(workspaceUri, context!);
    return true;
  } catch (error) {
    console.error("Failed to register local skill:", error);
    return false;
  }
}

/**
 * ローカルスキルを AGENTS.md から登録解除
 * ※ includeLocalSkills を一時的に false にして updateInstructionFile を呼ぶか、
 *   または手動で除外リストを管理する必要がある
 *   現在は updateInstructionFile を再呼び出しして同期
 */
export async function unregisterLocalSkill(
  _skill: LocalSkill,
  workspaceUri: vscode.Uri,
  context?: vscode.ExtensionContext
): Promise<boolean> {
  try {
    // 注: 現在の実装では、ローカルスキルは自動的にスキャンされるため、
    // 「登録解除」は実質的に意味がない（次回 updateInstructionFile で再登録される）
    // 本当に除外するには、除外リストを設定に持つ必要がある
    //
    // 暫定: includeLocalSkills が false の場合のみ解除が有効
    const config = vscode.workspace.getConfiguration("skillNinja");
    if (!config.get<boolean>("includeLocalSkills")) {
      await updateInstructionFile(workspaceUri, context!);
    }
    return true;
  } catch (error) {
    console.error("Failed to unregister local skill:", error);
    return false;
  }
}

/**
 * 正規表現用エスケープ（未使用だが将来用に保持）
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
