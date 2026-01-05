// インストラクションファイル管理
// agents.md などにインストール済みスキルを登録

import * as vscode from "vscode";
import { getInstalledSkillsWithMeta, SkillMeta } from "./skillInstaller";
import { scanLocalSkills, LocalSkill } from "./localSkillScanner";
import { OutputFormat, resolveOutputFormat } from "./toolDetector";
import * as path from "path";

// セクションマーカー
const MARKER_START = "<!-- skill-ninja-START -->";
const MARKER_END = "<!-- skill-ninja-END -->";

// 旧マーカー（互換性のため検出・削除用）
const LEGACY_MARKER_START = "<!-- SKILL-FINDER-START -->";
const LEGACY_MARKER_END = "<!-- SKILL-FINDER-END -->";

/**
 * instructionFile から skillsDir への相対パスを計算
 * 例: instructionFile = ".github/instructions/SkillList.instructions.md"
 *     skillsDir = ".github/skills"
 *     → 結果: "../skills"
 */
function calculateRelativePath(
  instructionFile: string,
  skillsDir: string
): string {
  // instructionFile のディレクトリを取得
  const instructionDir = path.dirname(instructionFile);

  // ルート（ワークスペース直下）の場合はそのまま
  if (instructionDir === "." || instructionDir === "") {
    return skillsDir;
  }

  // 相対パスを計算
  const relativePath = path.relative(instructionDir, skillsDir);

  // Windows パス区切りを / に変換
  return relativePath.replace(/\\/g, "/");
}

/**
 * インストラクションファイルを更新する
 */
export async function updateInstructionFile(
  workspaceUri: vscode.Uri,
  _context: vscode.ExtensionContext
): Promise<void> {
  // 出力フォーマットとインストラクションファイルを解決
  const { format, instructionFile } = await resolveOutputFormat(workspaceUri);

  const config = vscode.workspace.getConfiguration("skillNinja");
  const skillsDir = config.get<string>("skillsDirectory") || ".github/skills";
  const includeLocalSkills = config.get<boolean>("includeLocalSkills") ?? true;
  const instructionUri = vscode.Uri.joinPath(workspaceUri, instructionFile);

  console.log(`[Skill Ninja] Updating instruction file: ${instructionFile}`);

  // インストール済みスキルをメタデータ付きで取得
  const installedSkills = await getInstalledSkillsWithMeta(workspaceUri);
  console.log(
    `[Skill Ninja] Found ${installedSkills.length} installed skills:`,
    installedSkills.map((s) => s.name)
  );

  // ローカルスキルを取得（設定で有効な場合のみ）
  let localSkills: LocalSkill[] = [];
  if (includeLocalSkills) {
    const allLocalSkills = await scanLocalSkills(workspaceUri);
    // インストール済みスキル（.github/skills 配下）は除外
    localSkills = allLocalSkills.filter(
      (ls) => !ls.relativePath.startsWith(skillsDir)
    );
    console.log(`[Skill Ninja] Found ${localSkills.length} local skills`);
  }

  // instructionFile からの相対パスを計算
  const relativeSkillsDir = calculateRelativePath(instructionFile, skillsDir);

  // フォーマットに応じてスキルセクションを生成
  const skillSection = generateSkillSectionForFormat(
    installedSkills,
    localSkills,
    relativeSkillsDir,
    format
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
  const newContent = updateSection(existingContent, skillSection, format);

  // ディレクトリを作成してファイルを書き込む
  const dir = vscode.Uri.joinPath(instructionUri, "..");
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(
    instructionUri,
    Buffer.from(newContent, "utf-8")
  );
}

/**
 * フォーマットに応じたスキルセクションを生成
 */
function generateSkillSectionForFormat(
  installedSkills: SkillMeta[],
  localSkills: LocalSkill[],
  skillsDir: string,
  format: OutputFormat
): string {
  switch (format) {
    case "cursor-rules":
      return generateCursorRulesSection(
        installedSkills,
        localSkills,
        skillsDir
      );
    case "windsurf-rules":
      return generateWindsurfRulesSection(
        installedSkills,
        localSkills,
        skillsDir
      );
    case "cline-rules":
      return generateClineRulesSection(installedSkills, localSkills, skillsDir);
    default:
      return generateSkillSection(installedSkills, localSkills, skillsDir);
  }
}

/**
 * スキルセクションを生成（Markdown 形式）
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

| Skill | When to Use |
|-------|-------------|
`;

  // インストール済みスキル
  if (hasInstalled) {
    const installedRows = installedSkills
      .map((skill) => {
        // 優先順位: customWhenToUse > whenToUse > description
        const whenToUse =
          skill.customWhenToUse || skill.whenToUse || skill.description || "";
        // テーブル内のパイプ文字をエスケープ
        const safeDesc = whenToUse.replace(/\|/g, "\\|");
        return `| [${skill.name}](${skillsDir}/${skill.name}/SKILL.md) | ${safeDesc} |`;
      })
      .join("\n");
    content += installedRows + "\n";
  }

  // ローカルスキル
  if (hasLocal) {
    if (hasInstalled) {
      content += `
### Local Skills

| Skill | When to Use |
|-------|-------------|
`;
    }
    const localRows = localSkills
      .map((skill) => {
        const desc = skill.description || "";
        const safeDesc = desc.replace(/\|/g, "\\|");
        return `| [${skill.name}](${skill.relativePath}/SKILL.md) | ${safeDesc} |`;
      })
      .join("\n");
    content += localRows + "\n";
  }

  content += `\n${MARKER_END}`;

  return content;
}

/**
 * Cursor Rules 形式のスキルセクションを生成
 */
function generateCursorRulesSection(
  installedSkills: SkillMeta[],
  localSkills: LocalSkill[],
  skillsDir: string
): string {
  const allSkills = [
    ...installedSkills.map((s) => ({
      name: s.name,
      path: `${skillsDir}/${s.name}/SKILL.md`,
      description: s.customWhenToUse || s.whenToUse || s.description || "",
    })),
    ...localSkills.map((s) => ({
      name: s.name,
      path: `${s.relativePath}/SKILL.md`,
      description: s.description || "",
    })),
  ];

  if (allSkills.length === 0) {
    return `---
description: Installed Agent Skills (managed by Agent Skill Ninja)
globs: *
---
${MARKER_START}
# Agent Skills

No skills installed yet. Use "Agent Skill Ninja: Search Skills" to install skills.

${MARKER_END}`;
  }

  let content = `---
description: Installed Agent Skills (managed by Agent Skill Ninja)
globs: *
---
${MARKER_START}
# Agent Skills

The following skills are available in this workspace. Read each SKILL.md for detailed instructions.

`;

  for (const skill of allSkills) {
    const desc = skill.description ? ` - ${skill.description}` : "";
    content += `- @${skill.path}${desc}\n`;
  }

  content += `\n${MARKER_END}`;
  return content;
}

/**
 * Windsurf Rules 形式のスキルセクションを生成
 */
function generateWindsurfRulesSection(
  installedSkills: SkillMeta[],
  localSkills: LocalSkill[],
  skillsDir: string
): string {
  const allSkills = [
    ...installedSkills.map((s) => ({
      name: s.name,
      path: `${skillsDir}/${s.name}/SKILL.md`,
      description: s.customWhenToUse || s.whenToUse || s.description || "",
    })),
    ...localSkills.map((s) => ({
      name: s.name,
      path: `${s.relativePath}/SKILL.md`,
      description: s.description || "",
    })),
  ];

  if (allSkills.length === 0) {
    return `${MARKER_START}
# Agent Skills

No skills installed yet. Use "Agent Skill Ninja: Search Skills" to install skills.

${MARKER_END}`;
  }

  let content = `${MARKER_START}
# Agent Skills

The following skills are available. Include the SKILL.md content when relevant:

`;

  for (const skill of allSkills) {
    const desc = skill.description ? `: ${skill.description}` : "";
    content += `## ${skill.name}${desc}\n`;
    content += `Read: ${skill.path}\n\n`;
  }

  content += `${MARKER_END}`;
  return content;
}

/**
 * Cline Rules 形式のスキルセクションを生成
 */
function generateClineRulesSection(
  installedSkills: SkillMeta[],
  localSkills: LocalSkill[],
  skillsDir: string
): string {
  const allSkills = [
    ...installedSkills.map((s) => ({
      name: s.name,
      path: `${skillsDir}/${s.name}/SKILL.md`,
      description: s.customWhenToUse || s.whenToUse || s.description || "",
    })),
    ...localSkills.map((s) => ({
      name: s.name,
      path: `${s.relativePath}/SKILL.md`,
      description: s.description || "",
    })),
  ];

  if (allSkills.length === 0) {
    return `${MARKER_START}
# Agent Skills

No skills installed yet. Use "Agent Skill Ninja: Search Skills" to install skills.

${MARKER_END}`;
  }

  let content = `${MARKER_START}
# Agent Skills

Available skills in this workspace:

`;

  for (const skill of allSkills) {
    const desc = skill.description ? ` - ${skill.description}` : "";
    content += `- **${skill.name}**${desc}\n`;
    content += `  File: ${skill.path}\n`;
  }

  content += `\nWhen working on related tasks, read the corresponding SKILL.md file for instructions.\n`;
  content += `\n${MARKER_END}`;
  return content;
}

/**
 * 既存コンテンツのマーカー部分を更新
 */
function updateSection(
  existingContent: string,
  newSection: string,
  _format: OutputFormat = "markdown"
): string {
  // 旧マーカーが存在する場合は先に削除
  let content = removeLegacySection(existingContent);

  // 新マーカーが存在する場合は置換
  const startIndex = content.indexOf(MARKER_START);
  const endIndex = content.indexOf(MARKER_END);

  if (startIndex !== -1 && endIndex !== -1) {
    const before = content.substring(0, startIndex);
    const after = content.substring(endIndex + MARKER_END.length);
    return before + newSection + after;
  }

  // マーカーが存在しない場合は末尾に追加
  if (content.trim()) {
    return content.trimEnd() + "\n\n" + newSection + "\n";
  }

  return newSection + "\n";
}

/**
 * 旧マーカー（SKILL-FINDER）のセクションを削除
 */
function removeLegacySection(content: string): string {
  const startIndex = content.indexOf(LEGACY_MARKER_START);
  const endIndex = content.indexOf(LEGACY_MARKER_END);

  if (startIndex !== -1 && endIndex !== -1) {
    const before = content.substring(0, startIndex);
    const after = content.substring(endIndex + LEGACY_MARKER_END.length);
    return (before + after).replace(/\n{3,}/g, "\n\n");
  }

  return content;
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
