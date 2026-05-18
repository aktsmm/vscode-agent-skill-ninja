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
  resolveConfiguredPathToUri,
  SkillRoot,
} from "./skillLocations";
import { getCoexistenceMode, getEffectiveOwnership } from "./coexistence";

// セクションマーカー（共通マーカー / coexistence v3 で導入）。
// 同居拡張 (Resource NINJA) と Skill NINJA はこの共通マーカーへ書く。
// 後方互換のため、現状の generator は内部的にこのマーカー名を使う。
export const SHARED_MARKER_START = "<!-- agent-ninja-START -->";
export const SHARED_MARKER_END = "<!-- agent-ninja-END -->";

// `independent` モードは旧マーカー名のままブロックを書く（後方互換）。
const LEGACY_SKILL_MARKER_START = "<!-- skill-ninja-START -->";
const LEGACY_SKILL_MARKER_END = "<!-- skill-ninja-END -->";

// 互換性のため検出・削除する旧マーカー集合
const LEGACY_FINDER_MARKER_START = "<!-- SKILL-FINDER-START -->";
const LEGACY_FINDER_MARKER_END = "<!-- SKILL-FINDER-END -->";
const LEGACY_RESOURCE_MARKER_START = "<!-- resource-ninja-START -->";
const LEGACY_RESOURCE_MARKER_END = "<!-- resource-ninja-END -->";

// generator は内部的にこのマーカーを使う（generator から見た既定）。
// 書き出し直前に必要に応じて `independent` モード用の旧マーカーへ swap する。
const MARKER_START = SHARED_MARKER_START;
const MARKER_END = SHARED_MARKER_END;

interface MarkerPair {
  start: string;
  end: string;
}

const SHARED_MARKERS: MarkerPair = {
  start: SHARED_MARKER_START,
  end: SHARED_MARKER_END,
};
const LEGACY_SKILL_MARKERS: MarkerPair = {
  start: LEGACY_SKILL_MARKER_START,
  end: LEGACY_SKILL_MARKER_END,
};
const LEGACY_FINDER_MARKERS: MarkerPair = {
  start: LEGACY_FINDER_MARKER_START,
  end: LEGACY_FINDER_MARKER_END,
};
const LEGACY_RESOURCE_MARKERS: MarkerPair = {
  start: LEGACY_RESOURCE_MARKER_START,
  end: LEGACY_RESOURCE_MARKER_END,
};

// generator が出力する SHARED マーカーを別のマーカーへ差し替える。
function swapMarkers(
  section: string,
  from: MarkerPair,
  to: MarkerPair,
): string {
  if (from.start === to.start && from.end === to.end) {
    return section;
  }
  return section.split(from.start).join(to.start).split(from.end).join(to.end);
}

// content から marker pair で囲まれたブロックを 1 度だけ削除する。
function stripMarkerBlock(content: string, markers: MarkerPair): string {
  const startIndex = content.indexOf(markers.start);
  if (startIndex === -1) {
    return content;
  }
  const endIndex = content.indexOf(markers.end, startIndex);
  if (endIndex === -1) {
    return content;
  }
  const before = content.substring(0, startIndex);
  const after = content.substring(endIndex + markers.end.length);
  return before + after;
}

// 既知のレガシーマーカー（SKILL-FINDER / skill-ninja / resource-ninja）を全て除去する。
// `keepShared` が true のときは共通マーカーは温存（owner が後で書き直す）。
function stripAllManagedBlocks(
  content: string,
  options: { keepShared: boolean; keepLegacySkill?: boolean },
): string {
  let result = content;
  // 既知の旧マーカーを全て除去
  result = stripMarkerBlock(result, LEGACY_FINDER_MARKERS);
  result = stripMarkerBlock(result, LEGACY_RESOURCE_MARKERS);
  if (!options.keepLegacySkill) {
    result = stripMarkerBlock(result, LEGACY_SKILL_MARKERS);
  }
  if (!options.keepShared) {
    result = stripMarkerBlock(result, SHARED_MARKERS);
  }
  // 連続改行を 2 行までに整形
  return result.replace(/\n{3,}/g, "\n\n");
}

export function cleanupManagedSkillBlocks(
  content: string,
  options: { keepShared?: boolean; keepLegacySkill?: boolean } = {},
): string {
  return stripAllManagedBlocks(content, {
    keepShared: options.keepShared ?? false,
    keepLegacySkill: options.keepLegacySkill,
  }).trim();
}

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
  return (config.get<string>("outputFormat") || "ref") as OutputFormat;
}

function getWorkspaceFolderUriForRoot(root: SkillRoot): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.find((folder) =>
    normalizeFsPath(root.rootPath).startsWith(
      normalizeFsPath(folder.uri.fsPath),
    ),
  )?.uri;
}

function getInstructionDirectoryUri(root: SkillRoot): vscode.Uri | undefined {
  if (!root.instructionUri) {
    return undefined;
  }
  return vscode.Uri.file(path.dirname(root.instructionUri.fsPath));
}

function resolveCatalogUriForRoot(
  root: SkillRoot,
  configuredPath: string,
): vscode.Uri {
  const baseUri =
    (root.scope === "workspace" ? getWorkspaceFolderUriForRoot(root) : undefined) ||
    getInstructionDirectoryUri(root) ||
    root.rootUri;

  return (
    resolveConfiguredPathToUri(configuredPath, baseUri) ||
    vscode.Uri.joinPath(baseUri, configuredPath)
  );
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
  context: vscode.ExtensionContext,
): Promise<void> {
  if (!root.instructionUri || !root.instructionPath) {
    return;
  }

  const mode = getCoexistenceMode();
  const ownership = await getEffectiveOwnership(context);

  // owner==sibling のときは何も書かない（Single Block + Owner Handoff）。
  // independent モードでは owner 判定を無視して従来どおり書く。
  if (mode === "auto" && ownership.owner === "sibling") {
    console.log(
      `[Skill Ninja] Deferring instruction file write to sibling extension ` +
        `(${ownership.siblingBeacon?.extensionId ?? "yamapan.agent-resources-ninja"}). ` +
        `Reason: ${ownership.reason}.`,
    );
    return;
  }

  const format = await resolveInstructionFormatForRoot(root);
  const relativeSkillsDir =
    root.linkPathFromInstruction ||
    computeRelativeDirectoryPath(root.instructionPath, root.rootPath);

  console.log(
    `[Skill Ninja] Updating instruction file: ${root.instructionPath} ` +
      `(mode=${mode}, owner=${ownership.owner}, reason=${ownership.reason})`,
  );

  const installedSkills = (
    await getInstalledSkillsWithMeta(root.rootUri, root.rootUri)
  ).filter((skill) => !skill.registrationDisabled);
  const localSkills: LocalSkill[] = [];

  // generator は SHARED_MARKERS で出力する。independent モードでは旧 skill-ninja マーカーへ swap。
  const targetMarkers: MarkerPair =
    mode === "independent" ? LEGACY_SKILL_MARKERS : SHARED_MARKERS;

  let skillSection: string;
  if (format === "ref") {
    // ref モード: catalog ファイルに詳細を書き出し、instruction ファイルには参照リンクのみ
    const catalogLink = await writeCatalogFile(root, installedSkills, localSkills);
    skillSection = swapMarkers(
      generateRefSection(catalogLink),
      SHARED_MARKERS,
      targetMarkers,
    );
  } else {
    skillSection = swapMarkers(
      generateSkillSectionForFormat(
        installedSkills,
        localSkills,
        relativeSkillsDir,
        format,
      ),
      SHARED_MARKERS,
      targetMarkers,
    );
  }

  let existingContent = "";
  try {
    const content = await vscode.workspace.fs.readFile(root.instructionUri);
    existingContent = Buffer.from(content).toString("utf-8");
  } catch {
    existingContent = "";
  }

  const newContent = updateSection(
    existingContent,
    skillSection,
    format,
    targetMarkers,
  );

  if (newContent === existingContent) {
    return;
  }

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
    case "ref":
    case "full":
    default:
      return generateFullSection(installedSkills, localSkills, skillsDir);
  }
}

/**
 * ref モード用: instruction ファイルに書く参照リンクセクションを生成
 */
function generateRefSection(catalogLinkFromInstruction: string): string {
  return `${MARKER_START}
## Agent Skills

> See [Agent Skills](${catalogLinkFromInstruction})

${MARKER_END}`;
}

/**
 * ref モード用: catalog ファイルに詳細スキルリストを書き出し、
 * instruction ファイルから catalog への相対リンクを返す。
 */
async function writeCatalogFile(
  root: SkillRoot,
  installedSkills: SkillMeta[],
  localSkills: LocalSkill[],
): Promise<string> {
  const config = vscode.workspace.getConfiguration("skillNinja");
  const catalogRelPath =
    config.get<string>("refCatalogPath") || ".github/skills/README.md";

  const catalogUri = resolveCatalogUriForRoot(root, catalogRelPath);

  // instruction ファイルから catalog への相対リンクを計算
  const instructionAbsPath = root.instructionUri!.fsPath;
  const catalogAbsPath = catalogUri.fsPath;
  const catalogLinkFromInstruction = path
    .relative(path.dirname(instructionAbsPath), catalogAbsPath)
    .replace(/\\/g, "/");

  const relativeSkillsDirFromCatalog = computeRelativeDirectoryPath(
    catalogAbsPath,
    root.rootPath,
  );

  // catalog ファイルにフルセクションを書き出す
  const catalogSection = generateFullSection(
    installedSkills,
    localSkills,
    relativeSkillsDirFromCatalog,
  );

  let existingCatalogContent = "";
  try {
    const raw = await vscode.workspace.fs.readFile(catalogUri);
    existingCatalogContent = Buffer.from(raw).toString("utf-8");
  } catch {
    existingCatalogContent = "";
  }

  const newCatalogContent = updateSection(
    existingCatalogContent,
    catalogSection,
    "full",
  );

  if (newCatalogContent !== existingCatalogContent) {
    const catalogDir = vscode.Uri.joinPath(catalogUri, "..");
    await vscode.workspace.fs.createDirectory(catalogDir);
    await vscode.workspace.fs.writeFile(
      catalogUri,
      Buffer.from(newCatalogContent, "utf-8"),
    );
    console.log(
      `[Skill Ninja] Written skill catalog to ${catalogUri.fsPath}`,
    );
  }

  return catalogLinkFromInstruction;
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
 * 既存コンテンツのマーカー部分を更新する。
 *
 * coexistence v3 動作:
 *   - owner として書くときは、既知の旧マーカー（skill-ninja / resource-ninja /
 *     SKILL-FINDER）を全て除去し、ターゲットマーカー（共通 or 旧 skill-ninja）
 *     のブロックを 1 つだけ残す。
 *   - 旧マーカー区間が複数あっても 1 ブロックに統合する（migration 冪等）。
 *   - ターゲットマーカーの既存位置を維持し、なければ末尾に追加する。
 */
export function updateSection(
  existingContent: string,
  newSection: string,
  _format: OutputFormat = "full",
  targetMarkers: MarkerPair = SHARED_MARKERS,
): string {
  // 1) ターゲットマーカーの既存位置を記録（あれば置換、なければ末尾追加）
  const targetStartIdx = existingContent.indexOf(targetMarkers.start);

  // 2) 既存ターゲットブロックがあれば、そこに anchor を作るためのプレースホルダ
  //    を置いてから他のマーカー除去をする（位置を維持するため）。
  const ANCHOR = "\u0000__AGENT_NINJA_BLOCK_ANCHOR__\u0000";
  let working = existingContent;
  if (targetStartIdx !== -1) {
    const targetEndIdx = working.indexOf(targetMarkers.end, targetStartIdx);
    if (targetEndIdx !== -1) {
      const before = working.substring(0, targetStartIdx);
      const after = working.substring(targetEndIdx + targetMarkers.end.length);
      working = before + ANCHOR + after;
    }
  }

  // 3) ターゲット以外の既知マーカー（旧含む）を全て除去。
  //    targetMarkers が SHARED 以外（= LEGACY_SKILL）なら、SHARED ブロックも除去。
  //    targetMarkers が SHARED なら、LEGACY_SKILL も除去（すべて統合）。
  const targetIsLegacySkill = targetMarkers.start === LEGACY_SKILL_MARKER_START;
  working = stripAllManagedBlocks(working, {
    keepShared: targetIsLegacySkill ? false : false, // 常に除去（後で 1 つだけ書く）
    keepLegacySkill: targetIsLegacySkill ? false : false,
  });
  // 念押し: 連続削除で残った同種マーカー（複数あった場合）を全て除去
  while (
    working.indexOf(LEGACY_FINDER_MARKERS.start) !== -1 ||
    working.indexOf(LEGACY_RESOURCE_MARKERS.start) !== -1 ||
    working.indexOf(LEGACY_SKILL_MARKERS.start) !== -1 ||
    working.indexOf(SHARED_MARKERS.start) !== -1
  ) {
    const beforeLen = working.length;
    working = stripAllManagedBlocks(working, {
      keepShared: false,
      keepLegacySkill: false,
    });
    if (working.length === beforeLen) {
      break;
    }
  }

  // 4) anchor 位置に新ブロックを差し込む。anchor が無ければ末尾追加。
  const anchorIdx = working.indexOf(ANCHOR);
  if (anchorIdx !== -1) {
    const before = working.substring(0, anchorIdx);
    const after = working.substring(anchorIdx + ANCHOR.length);
    return before + newSection + after;
  }

  if (working.trim()) {
    return working.trimEnd() + "\n\n" + newSection + "\n";
  }
  return newSection + "\n";
}

/**
 * 指定されたファイルからスキルセクションを削除
 * ファイルパスを直接指定する版
 */
export async function removeSkillSectionFromFile(
  fileUri: vscode.Uri,
  options: { keepShared?: boolean; keepLegacySkill?: boolean } = {},
): Promise<void> {
  try {
    const content = await vscode.workspace.fs.readFile(fileUri);
    let existingContent = Buffer.from(content).toString("utf-8");

    const stripped = cleanupManagedSkillBlocks(existingContent, options);

    if (stripped !== existingContent.trim()) {
      existingContent = stripped;
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

  const instructionUri =
    resolveConfiguredPathToUri(instructionPath, workspaceUri) ||
    vscode.Uri.joinPath(workspaceUri, instructionPath);
  await removeSkillSectionFromFile(instructionUri);
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
