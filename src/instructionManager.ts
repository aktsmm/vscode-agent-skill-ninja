// インストラクションファイル管理
// agents.md などにインストール済みスキルを登録

import * as vscode from "vscode";
import { getInstalledSkillsWithMeta, SkillMeta } from "./skillInstaller";
import type { LocalSkill } from "./localSkillScanner";
import { OutputFormat, resolveOutputFormat } from "./toolDetector";
import * as path from "path";
import { SKILL_DESCRIPTION_LIMITS } from "./constants";
import {
  computeRelativeDirectoryPath,
  getManagedSkillRoots,
  SkillRoot,
} from "./skillLocations";

// セクションマーカー
const MARKER_START = "<!-- skill-ninja-START -->";
const MARKER_END = "<!-- skill-ninja-END -->";

// 旧マーカー（互換性のため検出・削除用）
const LEGACY_MARKER_START = "<!-- SKILL-FINDER-START -->";
const LEGACY_MARKER_END = "<!-- SKILL-FINDER-END -->";

/**
 * Description + When to Use を連結する関数（合計最大200文字）
 * - 片方だけの場合: 最大200文字
 * - 両方ある場合: 合計200文字を分配（片方が短ければもう片方に回す）
 */
function buildDescription(description?: string, whenToUse?: string): string {
  const { MAX_TOTAL, MAX_EACH } = SKILL_DESCRIPTION_LIMITS;

  const desc = description?.trim() || "";
  const when = whenToUse?.trim() || "";

  if (!desc && !when) return "";
  if (!desc)
    return when.length > MAX_TOTAL
      ? when.substring(0, MAX_TOTAL - 3) + "..."
      : when;
  if (!when)
    return desc.length > MAX_TOTAL
      ? desc.substring(0, MAX_TOTAL - 3) + "..."
      : desc;

  // 両方ある場合は連結（片方が短ければもう片方に回す）
  const descLen = desc.length;
  const whenLen = when.length;

  let shortDesc: string;
  let shortWhen: string;

  if (descLen <= MAX_EACH && whenLen <= MAX_EACH) {
    // 両方100文字以内
    shortDesc = desc;
    shortWhen = when;
  } else if (descLen <= MAX_EACH) {
    // desc が短いので when に余りを回す
    const whenMax = MAX_TOTAL - descLen - 3; // " | " の分
    shortDesc = desc;
    shortWhen =
      when.length > whenMax ? when.substring(0, whenMax - 3) + "..." : when;
  } else if (whenLen <= MAX_EACH) {
    // when が短いので desc に余りを回す
    const descMax = MAX_TOTAL - whenLen - 3; // " | " の分
    shortDesc =
      desc.length > descMax ? desc.substring(0, descMax - 3) + "..." : desc;
    shortWhen = when;
  } else {
    // 両方100文字超え: 各97文字 + "..."
    shortDesc = desc.substring(0, MAX_EACH - 3) + "...";
    shortWhen = when.substring(0, MAX_EACH - 3) + "...";
  }

  return `${shortDesc} | ${shortWhen}`;
}

async function resolveInstructionFormatForRoot(
  root: SkillRoot,
): Promise<OutputFormat> {
  if (root.scope === "workspace") {
    const workspaceFolder = vscode.workspace.workspaceFolders?.find((folder) =>
      normalizeFsPath(root.rootPath).startsWith(
        normalizeFsPath(folder.uri.fsPath),
      ),
    );
    if (
      workspaceFolder &&
      normalizeFsPath(root.rootPath).startsWith(
        normalizeFsPath(workspaceFolder.uri.fsPath),
      )
    ) {
      const { format } = await resolveOutputFormat(workspaceFolder.uri);
      return format;
    }
  }

  const config = vscode.workspace.getConfiguration("skillNinja");
  return (config.get<string>("outputFormat") || "full") as OutputFormat;
}

function normalizeFsPath(targetPath: string): string {
  const normalized = path.normalize(targetPath).replace(/\\/g, "/");
  if (process.platform === "win32") {
    return normalized.toLowerCase();
  }
  return normalized;
}

/**
 * インストラクションファイルを更新する
 */
export async function updateInstructionFile(
  workspaceUri: vscode.Uri,
  context: vscode.ExtensionContext,
): Promise<void> {
  const roots = await getManagedSkillRoots(workspaceUri);
  const workspaceRoot = roots.find((root) => root.scope === "workspace");
  if (!workspaceRoot) {
    return;
  }

  await updateInstructionFileForRoot(workspaceRoot, context);
}

export async function updateInstructionFileForRoot(
  root: SkillRoot,
  _context: vscode.ExtensionContext,
): Promise<void> {
  if (!root.instructionUri || !root.instructionPath) {
    return;
  }

  const format = await resolveInstructionFormatForRoot(root);
  const relativeSkillsDir =
    root.linkPathFromInstruction ||
    computeRelativeDirectoryPath(root.instructionPath, root.rootPath);

  console.log(
    `[Skill Ninja] Updating instruction file: ${root.instructionPath}`,
  );

  const installedSkills = (
    await getInstalledSkillsWithMeta(root.rootUri, root.rootUri)
  ).filter((skill) => !skill.registrationDisabled);
  const localSkills: LocalSkill[] = [];

  const skillSection = generateSkillSectionForFormat(
    installedSkills,
    localSkills,
    relativeSkillsDir,
    format,
  );

  let existingContent = "";
  try {
    const content = await vscode.workspace.fs.readFile(root.instructionUri);
    existingContent = Buffer.from(content).toString("utf-8");
  } catch {
    existingContent = "";
  }

  const newContent = updateSection(existingContent, skillSection, format);

  const dir = vscode.Uri.joinPath(root.instructionUri, "..");
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(
    root.instructionUri,
    Buffer.from(newContent, "utf-8"),
  );
}

export async function updateAllInstructionFiles(
  workspaceUri: vscode.Uri,
  context: vscode.ExtensionContext,
): Promise<void> {
  const roots = await getManagedSkillRoots(workspaceUri);
  for (const root of roots) {
    await updateInstructionFileForRoot(root, context);
  }
}

/**
 * フォーマットに応じたスキルセクションを生成
 */
function generateSkillSectionForFormat(
  installedSkills: SkillMeta[],
  localSkills: LocalSkill[],
  skillsDir: string,
  format: OutputFormat,
): string {
  switch (format) {
    case "compact":
      return generateCompactSection(installedSkills, localSkills, skillsDir);
    case "legacy":
      return generateLegacySection(installedSkills, localSkills, skillsDir);
    case "full":
    default:
      return generateFullSection(installedSkills, localSkills, skillsDir);
  }
}

/**
 * Legacy 形式のスキルセクションを生成
 * シンプルな2列テーブル（IMPORTANT プロンプトなし）
 */
function generateLegacySection(
  installedSkills: SkillMeta[],
  localSkills: LocalSkill[],
  skillsDir: string,
): string {
  const hasInstalled = installedSkills.length > 0;
  const hasLocal = localSkills.length > 0;

  if (!hasInstalled && !hasLocal) {
    return `${MARKER_START}
## Agent Skills

No skills installed yet. Use "Agent Skills Ninja: Search Skills" to install skills.

${MARKER_END}`;
  }

  let content = `${MARKER_START}
## Agent Skills

| Skill | Description |
|-------|-------------|
`;

  // インストール済みスキル
  if (hasInstalled) {
    const installedRows = installedSkills
      .map((skill) => {
        // Description + When to Use を連結（合計最大200文字）
        const desc = buildDescription(
          skill.description,
          skill.customWhenToUse || skill.whenToUse,
        );
        // テーブル内のパイプ文字をエスケープ
        const safeDesc = desc.replace(/\|/g, "\\|");
        // relativePath がある場合はそれを使用、なければ name を使用
        const skillPath = skill.relativePath || skill.name;
        return `| [${skill.name}](${skillsDir}/${skillPath}/SKILL.md) | ${safeDesc} |`;
      })
      .join("\n");
    content += installedRows + "\n";
  }

  // ローカルスキル
  if (hasLocal) {
    const localRows = localSkills
      .map((skill) => {
        // LocalSkill は description のみ（whenToUse はない）
        const desc = skill.description || "";
        const truncatedDesc =
          desc.length > 200 ? desc.substring(0, 197) + "..." : desc;
        const safeDesc = truncatedDesc.replace(/\|/g, "\\|");
        return `| [${skill.name}](${skill.relativePath}/SKILL.md) | ${safeDesc} |`;
      })
      .join("\n");
    content += localRows + "\n";
  }

  content += `\n${MARKER_END}`;

  return content;
}

/**
 * 既存コンテンツのマーカー部分を更新
 */
function updateSection(
  existingContent: string,
  newSection: string,
  _format: OutputFormat = "full",
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
 * 指定されたファイルからスキルセクションを削除
 * ファイルパスを直接指定する版
 */
export async function removeSkillSectionFromFile(
  fileUri: vscode.Uri,
): Promise<void> {
  try {
    const content = await vscode.workspace.fs.readFile(fileUri);
    let existingContent = Buffer.from(content).toString("utf-8");

    // マーカーで囲まれた部分を削除
    const startIndex = existingContent.indexOf(MARKER_START);
    const endIndex = existingContent.indexOf(MARKER_END);

    if (startIndex !== -1 && endIndex !== -1) {
      const before = existingContent.substring(0, startIndex);
      const after = existingContent.substring(endIndex + MARKER_END.length);
      existingContent = (before + after).replace(/\n{3,}/g, "\n\n").trim();
      await vscode.workspace.fs.writeFile(
        fileUri,
        Buffer.from(existingContent, "utf-8"),
      );
      console.log(`[Skill Ninja] Removed skill section from ${fileUri.fsPath}`);
    }
  } catch {
    // ファイルが存在しない場合は何もしない
  }
}

/**
 * インストラクションファイルからスキルセクションを削除
 */
export async function removeSkillSection(
  workspaceUri: vscode.Uri,
): Promise<void> {
  const config = vscode.workspace.getConfiguration("skillNinja");
  let instructionPath = config.get<string>("instructionFile") || "AGENTS.md";

  if (instructionPath === "custom") {
    instructionPath =
      config.get<string>("customInstructionPath") || "AGENTS.md";
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
        Buffer.from(existingContent, "utf-8"),
      );
    }
  } catch {
    // ファイルが存在しない場合は何もしない
  }
}

/**
 * Compact 形式のスキルセクションを生成
 * IMPORTANT + 3列コンパクトテーブル（Description 100文字）
 */
function generateCompactSection(
  installedSkills: SkillMeta[],
  localSkills: LocalSkill[],
  skillsDir: string,
): string {
  const allSkills = [
    ...installedSkills.map((s) => ({
      name: s.name,
      path: s.relativePath || s.name,
      // Description のみ（100文字）
      description: s.description
        ? s.description.length > 100
          ? s.description.substring(0, 97) + "..."
          : s.description
        : "",
    })),
    ...localSkills.map((s) => ({
      name: s.name,
      path: s.relativePath,
      description: s.description
        ? s.description.length > 100
          ? s.description.substring(0, 97) + "..."
          : s.description
        : "",
    })),
  ];

  if (allSkills.length === 0) {
    return `${MARKER_START}
## Agent Skills (Compressed Index)

No skills installed yet. Use "Agent Skills Ninja: Search Skills" to install skills.

${MARKER_END}`;
  }

  // ヘッダー部分
  let content = `${MARKER_START}
## Agent Skills (Compressed Index)

> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.
> Read the relevant SKILL.md before working on tasks covered by these skills.

### Skills Index

| Skill | Path | Description |
|-------|------|-------------|
`;

  // 各スキルのインデックスを生成（テーブル形式）
  for (const skill of allSkills) {
    // パイプをエスケープ
    const safeDesc = skill.description.replace(/\|/g, "\\|");
    content += `| [${skill.name}](${skillsDir}/${skill.path}/SKILL.md) | \`${skill.path}\` | ${safeDesc} |\n`;
  }

  content += `\n${MARKER_END}`;
  return content;
}

/**
 * Full 形式のスキルセクションを生成（既定）
 * IMPORTANT + 詳細テーブル（200文字）
 */
function generateFullSection(
  installedSkills: SkillMeta[],
  localSkills: LocalSkill[],
  skillsDir: string,
): string {
  const allSkills = [
    ...installedSkills.map((s) => ({
      name: s.name,
      path: s.relativePath || s.name,
      description: buildDescription(
        s.description,
        s.customWhenToUse || s.whenToUse,
      ),
    })),
    ...localSkills.map((s) => ({
      name: s.name,
      path: s.relativePath,
      // LocalSkill は description のみ（whenToUse はない）
      description:
        s.description && s.description.length > 200
          ? s.description.substring(0, 197) + "..."
          : s.description || "",
    })),
  ];

  if (allSkills.length === 0) {
    return `${MARKER_START}
## Agent Skills

No skills installed yet. Use "Agent Skills Ninja: Search Skills" to install skills.

${MARKER_END}`;
  }

  // 従来の Markdown テーブル
  let content = `${MARKER_START}
## Agent Skills

> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.
> Read the relevant SKILL.md before working on tasks covered by these skills.

### Skills

| Skill | Description |
|-------|-------------|
`;

  for (const skill of allSkills) {
    const safeDesc = skill.description.replace(/\|/g, "\\|");
    content += `| [${skill.name}](${skillsDir}/${skill.path}/SKILL.md) | ${safeDesc} |\n`;
  }

  content += `\n${MARKER_END}`;
  return content;
}
