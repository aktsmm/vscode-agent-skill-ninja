// インストラクションファイル管理
// agents.md などにインストール済みスキルを登録

import * as vscode from "vscode";
import { getInstalledSkillsWithMeta, SkillMeta } from "./skillInstaller";
import { scanLocalSkills, LocalSkill } from "./localSkillScanner";

// セクションマーカー
const MARKER_START = "<!-- skill-ninja-START -->";
const MARKER_END = "<!-- skill-ninja-END -->";

/**
 * インストラクションファイルを更新する
 */
export async function updateInstructionFile(
  workspaceUri: vscode.Uri,
  _context: vscode.ExtensionContext
): Promise<void> {
  const config = vscode.workspace.getConfiguration("skillNinja");
  let instructionPath = config.get<string>("instructionFile") || "AGENTS.md";

  // custom の場合はカスタムパスを使用
  if (instructionPath === "custom") {
    instructionPath =
      config.get<string>("customInstructionPath") || "AGENTS.md";
  }

  const skillsDir = config.get<string>("skillsDirectory") || ".github/skills";
  const includeLocalSkills = config.get<boolean>("includeLocalSkills") ?? true;
  const instructionUri = vscode.Uri.joinPath(workspaceUri, instructionPath);

  // インストール済みスキルをメタデータ付きで取得
  const installedSkills = await getInstalledSkillsWithMeta(workspaceUri);

  // ローカルスキルを取得（設定で有効な場合のみ）
  let localSkills: LocalSkill[] = [];
  if (includeLocalSkills) {
    const allLocalSkills = await scanLocalSkills(workspaceUri);
    // インストール済みスキル（.github/skills 配下）は除外
    localSkills = allLocalSkills.filter(
      (ls) => !ls.relativePath.startsWith(skillsDir)
    );
  }

  // スキルセクションを生成
  const skillSection = generateSkillSection(
    installedSkills,
    localSkills,
    skillsDir
  );

  // 既存のファイルを読み込む
  let existingContent = "";
  try {
    const content = await vscode.workspace.fs.readFile(instructionUri);
    existingContent = Buffer.from(content).toString("utf-8");
  } catch {
    // ファイルが存在しない場合は新規作成
    existingContent = "";
  }

  // マーカーで囲まれた部分を更新
  const newContent = updateSection(existingContent, skillSection);

  // ディレクトリを作成してファイルを書き込む
  const dir = vscode.Uri.joinPath(instructionUri, "..");
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(
    instructionUri,
    Buffer.from(newContent, "utf-8")
  );
}

/**
 * スキルセクションを生成
 */
function generateSkillSection(
  installedSkills: SkillMeta[],
  localSkills: LocalSkill[],
  skillsDir: string
): string {
  const hasInstalled = installedSkills.length > 0;
  const hasLocal = localSkills.length > 0;

  if (!hasInstalled && !hasLocal) {
    return `${MARKER_START}
## Installed Skills

No skills installed yet. Use "Agent Skill Ninja: Search Skills" to install skills.

${MARKER_END}`;
  }

  let content = `${MARKER_START}
## Installed Skills

The following skills are available in this workspace.

`;

  // インストール済みスキル
  if (hasInstalled) {
    const installedList = installedSkills
      .map((skill) => {
        const desc = skill.description ? ` - ${skill.description}` : "";
        return `- [${skill.name}](${skillsDir}/${skill.name}/SKILL.md)${desc}`;
      })
      .join("\n");
    content += installedList + "\n";
  }

  // ローカルスキル
  if (hasLocal) {
    if (hasInstalled) {
      content += "\n### Local Skills\n\n";
    }
    const localList = localSkills
      .map((skill) => {
        const desc = skill.description ? ` - ${skill.description}` : "";
        return `- [${skill.name}](${skill.relativePath}/SKILL.md)${desc}`;
      })
      .join("\n");
    content += localList + "\n";
  }

  content += `\n${MARKER_END}`;

  return content;
}

/**
 * 既存コンテンツのマーカー部分を更新
 */
function updateSection(existingContent: string, newSection: string): string {
  // マーカーが存在する場合は置換
  const startIndex = existingContent.indexOf(MARKER_START);
  const endIndex = existingContent.indexOf(MARKER_END);

  if (startIndex !== -1 && endIndex !== -1) {
    const before = existingContent.substring(0, startIndex);
    const after = existingContent.substring(endIndex + MARKER_END.length);
    return before + newSection + after;
  }

  // マーカーが存在しない場合は末尾に追加
  if (existingContent.trim()) {
    return existingContent.trimEnd() + "\n\n" + newSection + "\n";
  }

  return newSection + "\n";
}

/**
 * インストラクションファイルからスキルセクションを削除
 */
export async function removeSkillSection(
  workspaceUri: vscode.Uri
): Promise<void> {
  const config = vscode.workspace.getConfiguration("skillNinja");
  let instructionPath =
    config.get<string>("instructionFile") || ".github/agents.md";

  if (instructionPath === "custom") {
    instructionPath =
      config.get<string>("customInstructionPath") || ".github/agents.md";
  }

  const instructionUri = vscode.Uri.joinPath(workspaceUri, instructionPath);

  try {
    const content = await vscode.workspace.fs.readFile(instructionUri);
    let existingContent = Buffer.from(content).toString("utf-8");

    // マーカーで囲まれた部分を削除
    const startIndex = existingContent.indexOf(MARKER_START);
    const endIndex = existingContent.indexOf(MARKER_END);

    if (startIndex !== -1 && endIndex !== -1) {
      const before = existingContent.substring(0, startIndex);
      const after = existingContent.substring(endIndex + MARKER_END.length);
      existingContent = (before + after).replace(/\n{3,}/g, "\n\n").trim();
      await vscode.workspace.fs.writeFile(
        instructionUri,
        Buffer.from(existingContent, "utf-8")
      );
    }
  } catch {
    // ファイルが存在しない場合は何もしない
  }
}
