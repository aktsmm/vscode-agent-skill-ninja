// ローカルスキルのスキャンと AGENTS.md 同期
// ワークスペース内の SKILL.md を検出し、AGENTS.md と同期

import * as path from "path";
import * as vscode from "vscode";
import { Skill } from "./skillIndex";
import {
  SHARED_MARKER_END,
  SHARED_MARKER_START,
  updateInstructionFileForRoot,
} from "./instructionManager";
import {
  enrichSkillMeta,
  isFallbackSkillMd,
  type SkillMeta,
} from "./skillInstaller";
import {
  getBuiltInSkillRoots,
  getExtensionSkillRoots,
  getManagedSkillRoots,
  resolveConfiguredPathToUri,
  SkillRoot,
  SkillScope,
  normalizeFileSystemPath,
} from "./skillLocations";

/**
 * ローカルスキル情報（拡張版）
 */
export interface LocalSkill extends Skill {
  isLocal: true;
  fullPath: string; // フルパス
  relativePath: string; // スキルルート相対パス
  displayPath: string; // UI 表示用パス
  isRegistered: boolean; // managed metadata または instruction block から登録済みと判定できるか
  registrationState: "registered" | "unregistered";
  registrationSource: "metadata" | "instruction" | "none";
  registrationReason: string;
  registrationFile?: string; // 登録されているファイル (AGENTS.md など)
  metadataPath: string;
  metadataPresent: boolean;
  scope: SkillScope;
  root: SkillRoot;
  skillDirUri: vscode.Uri;
  isManaged: boolean;
  isReadOnly: boolean;
  remotePath?: string;
  incomplete?: boolean;
  reinstallDisabled?: boolean;
  reinstallDisabledReason?: string;
  reinstallDisabledAt?: string;
  installedAt?: string;
  installedVia?: SkillMeta["installedVia"];
  packageParentName?: string;
  packageParentRemotePath?: string;
  packageParentRelativePath?: string;
}

const visibleSkillsCache = new Map<string, Promise<LocalSkill[]>>();

function getVisibleSkillsCacheKey(workspaceUri?: vscode.Uri): string {
  return workspaceUri?.fsPath || "__no-workspace__";
}

export function invalidateVisibleSkillsCache(workspaceUri?: vscode.Uri): void {
  if (workspaceUri) {
    visibleSkillsCache.delete(getVisibleSkillsCacheKey(workspaceUri));
    return;
  }

  visibleSkillsCache.clear();
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

export function isSkillRegisteredByMetadata(
  meta?: Pick<SkillMeta, "registrationDisabled">,
): boolean {
  return meta !== undefined && meta.registrationDisabled !== true;
}

function buildRegistrationInfo(
  meta: SkillMeta | undefined,
): Pick<
  LocalSkill,
  | "isRegistered"
  | "registrationState"
  | "registrationSource"
  | "registrationReason"
> {
  if (!meta) {
    return {
      isRegistered: false,
      registrationState: "unregistered",
      registrationSource: "none",
      registrationReason:
        "No managed metadata or instruction reference has been detected yet.",
    };
  }

  if (meta.registrationDisabled) {
    return {
      isRegistered: false,
      registrationState: "unregistered",
      registrationSource: "none",
      registrationReason:
        "Managed metadata explicitly disables automatic registration.",
    };
  }

  return {
    isRegistered: true,
    registrationState: "registered",
    registrationSource: "metadata",
    registrationReason: "Managed metadata marks this skill as registered.",
  };
}

function unquoteYamlValue(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function stripYamlInlineComment(value: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let bracketDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (char === "[") {
      bracketDepth += 1;
      continue;
    }

    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (char === "#" && bracketDepth === 0) {
      const previousChar = index > 0 ? value[index - 1] : "";
      if (index === 0 || /\s/.test(previousChar)) {
        return value.slice(0, index).trimEnd();
      }
    }
  }

  return value.trimEnd();
}

function parseInlineYamlArray(value: string): string[] {
  const match = stripYamlInlineComment(value).match(/^\[(.*)\]$/);
  if (!match) {
    return [];
  }

  return match[1]
    .split(",")
    .map((item) => unquoteYamlValue(item))
    .filter(Boolean);
}

function getBlockScalarStyle(value: string): ">" | "|" | null {
  const match = value.match(
    /^([>|])(?:([1-9])([+-])?|([+-])([1-9])?)?(?:\s+#.*)?$/,
  );
  if (!match) {
    return null;
  }

  return match[1] as ">" | "|";
}

function parseTopLevelFrontmatter(frontmatter: string): Map<string, string> {
  const values = new Map<string, string>();
  const lines = frontmatter.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) {
      continue;
    }

    const [, key, rawValue] = keyMatch;
    const trimmedValue = rawValue.trim();
    const blockScalarStyle = getBlockScalarStyle(trimmedValue);

    if (blockScalarStyle) {
      const blockLines: string[] = [];
      let blockIndent: number | null = null;

      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1];
        if (!nextLine.trim()) {
          blockLines.push("");
          index += 1;
          continue;
        }

        const indentMatch = nextLine.match(/^(\s+)/);
        if (!indentMatch) {
          break;
        }

        const indentLength = indentMatch[1].length;
        if (blockIndent === null) {
          blockIndent = indentLength;
        }
        if (indentLength < blockIndent) {
          break;
        }

        blockLines.push(nextLine.slice(blockIndent));
        index += 1;
      }

      values.set(
        key,
        (blockScalarStyle === ">"
          ? blockLines.join(" ")
          : blockLines.join("\n")
        ).trim(),
      );
      continue;
    }

    values.set(key, unquoteYamlValue(stripYamlInlineComment(trimmedValue)));
  }

  return values;
}

async function scanSkillRootEntries(
  currentDir: vscode.Uri,
  relativeDir: string,
  results: Array<{ skillMdUri: vscode.Uri; relativePath: string }>,
  depth: number = 0,
): Promise<void> {
  if (depth > 6 || results.length >= 500) {
    return;
  }

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(currentDir);
  } catch {
    return;
  }

  const hasSkillMd = entries.some(
    ([name, fileType]) =>
      name === "SKILL.md" && fileType === vscode.FileType.File,
  );

  if (hasSkillMd) {
    results.push({
      skillMdUri: vscode.Uri.joinPath(currentDir, "SKILL.md"),
      relativePath: relativeDir,
    });
  }

  for (const [name, fileType] of entries) {
    if (fileType !== vscode.FileType.Directory) {
      continue;
    }
    if (name.startsWith(".")) {
      continue;
    }

    const childRelativePath = relativeDir ? `${relativeDir}/${name}` : name;
    await scanSkillRootEntries(
      vscode.Uri.joinPath(currentDir, name),
      childRelativePath,
      results,
      depth + 1,
    );
  }
}

function buildDefaultMeta(skill: LocalSkill): SkillMeta {
  return {
    name: skill.name,
    source: skill.source || "local",
    description: skill.description || "",
    description_ja: skill.description_ja || undefined,
    categories: skill.categories || [],
    installedAt: new Date().toISOString(),
    relativePath: skill.relativePath,
  };
}

async function readSkillMetaFile(
  skillDirUri: vscode.Uri,
  trustedRelativePath?: string,
): Promise<SkillMeta | undefined> {
  try {
    const metaContent = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(skillDirUri, ".skill-meta.json"),
    );
    return enrichSkillMeta(
      JSON.parse(Buffer.from(metaContent).toString("utf-8")) as SkillMeta,
      trustedRelativePath,
    );
  } catch {
    return undefined;
  }
}

/**
 * SKILL.md ファイルを解析してスキル情報を取得
 */
async function parseLocalSkillFile(
  fileUri: vscode.Uri,
  root: SkillRoot,
  relativePath: string,
): Promise<LocalSkill | null> {
  const content = await vscode.workspace.fs.readFile(fileUri);
  const text = Buffer.from(content).toString("utf8");
  const normalizedText = text.replace(/\r\n/g, "\n");

  // frontmatter を解析
  const frontmatterMatch = normalizedText.match(/^---\n([\s\S]*?)\n---/);

  let name = "";
  let description = "";
  let description_ja = "";
  let categories: string[] = [];

  if (frontmatterMatch) {
    const frontmatter = parseTopLevelFrontmatter(frontmatterMatch[1]);
    name = frontmatter.get("name")?.trim() || "";
    description = frontmatter.get("description")?.trim() || "";
    description_ja = frontmatter.get("description_ja")?.trim() || "";
    categories = parseInlineYamlArray(frontmatter.get("categories") || "[]");
  }

  // 名前がない場合は # ヘッダーから取得
  if (!name) {
    const headerMatch = normalizedText.match(/^#\s+(.+)$/m);
    if (headerMatch) {
      name = headerMatch[1].trim();
    }
  }

  // まだ名前がない場合はディレクトリ名を使用
  if (!name) {
    const pathParts = fileUri.fsPath.split(/[/\\]/);
    name = pathParts[pathParts.length - 2] || "Unknown";
  }

  const skillDirUri = vscode.Uri.file(path.dirname(fileUri.fsPath));
  const meta = await readSkillMetaFile(skillDirUri, relativePath);
  const registrationInfo = buildRegistrationInfo(meta);
  const metadataPath = vscode.Uri.joinPath(
    skillDirUri,
    ".skill-meta.json",
  ).fsPath;

  if (meta?.description) {
    description = meta.description;
  }
  if (meta?.description_ja) {
    description_ja = meta.description_ja;
  }
  if (meta?.categories?.length) {
    categories = meta.categories;
  }

  const source = meta?.source || "local";
  const displayPath =
    root.scope === "workspace"
      ? `${root.displayPath}/${relativePath}`
      : `${root.displayPath}/${relativePath}`;

  return {
    name,
    description,
    description_ja,
    categories,
    source,
    path: relativePath,
    license: meta?.license,
    author: meta?.author,
    version: meta?.version,
    isLocal: true,
    fullPath: fileUri.fsPath,
    relativePath,
    displayPath,
    ...registrationInfo,
    metadataPath,
    metadataPresent: meta !== undefined,
    scope: root.scope,
    root,
    skillDirUri,
    isManaged: root.isManaged,
    isReadOnly: root.isReadOnly,
    remotePath: meta?.remotePath,
    // Installs from before the flag existed are detected from the content instead
    incomplete:
      meta?.incomplete ??
      (meta?.source
        ? isFallbackSkillMd(normalizedText, meta.source)
        : undefined),
    reinstallDisabled: meta?.reinstallDisabled,
    reinstallDisabledReason: meta?.reinstallDisabledReason,
    reinstallDisabledAt: meta?.reinstallDisabledAt,
    installedAt: meta?.installedAt,
    installedVia: meta?.installedVia,
    packageParentName: meta?.packageParentName,
    packageParentRemotePath: meta?.packageParentRemotePath,
    packageParentRelativePath: meta?.packageParentRelativePath,
  };
}

/**
 * AGENTS.md などの instruction file を読み取り、登録状態をチェック
 * ※ managed マーカー内のみをチェック（手動記載との重複を避けるため）
 */
const LEGACY_SKILL_MARKER_START = "<!-- skill-ninja-START -->";
const LEGACY_SKILL_MARKER_END = "<!-- skill-ninja-END -->";

const MANAGED_SKILL_MARKERS = [
  { start: SHARED_MARKER_START, end: SHARED_MARKER_END },
  { start: LEGACY_SKILL_MARKER_START, end: LEGACY_SKILL_MARKER_END },
];

export function extractManagedSkillMarkerContent(
  text: string,
): string | undefined {
  for (const markers of MANAGED_SKILL_MARKERS) {
    const startIndex = text.indexOf(markers.start);
    if (startIndex === -1) {
      continue;
    }

    const endIndex = text.indexOf(markers.end, startIndex);
    if (endIndex === -1) {
      continue;
    }

    return text.substring(startIndex, endIndex + markers.end.length);
  }

  return undefined;
}

/**
 * managed marker ブロック内に対象スキルへのリンクが含まれているかを判定する。
 * vscode API に依存しない純粋関数。round-trip 回帰テストから直接呼ばれる。
 */
export function isSkillReferencedInManagedBlock(
  instructionText: string,
  relativeSkillsDir: string,
  skillRelativePath: string,
): boolean {
  const markerContent = extractManagedSkillMarkerContent(instructionText);
  if (!markerContent) {
    return false;
  }

  const normalizedDir = relativeSkillsDir
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const normalizedRelative = skillRelativePath.replace(/\\/g, "/");
  const skillLink = `${normalizedDir}/${normalizedRelative}/SKILL.md`.replace(
    /^\.\//,
    "",
  );
  return (
    markerContent.includes(skillLink) ||
    markerContent.includes(`./${skillLink}`)
  );
}

async function checkRegistrationStatusForRoot(
  skills: LocalSkill[],
  root: SkillRoot,
): Promise<void> {
  if (!root.instructionUri || !root.instructionPath) {
    return;
  }

  try {
    const content = await vscode.workspace.fs.readFile(root.instructionUri);
    const instructionText = Buffer.from(content).toString("utf8");
    const markerContent = extractManagedSkillMarkerContent(instructionText);

    // マーカーがない場合は未登録として扱う
    if (!markerContent) {
      return;
    }

    const relativeSkillsDir =
      root.linkPathFromInstruction ||
      computeInstructionPathFromRoot(root.instructionPath, root.rootPath);

    // スキル参照を検出（マーカー内のみ）
    for (const skill of skills) {
      if (
        isSkillReferencedInManagedBlock(
          instructionText,
          relativeSkillsDir,
          skill.relativePath,
        )
      ) {
        skill.isRegistered = true;
        skill.registrationState = "registered";
        skill.registrationSource = "instruction";
        skill.registrationReason =
          "Detected a managed instruction block reference for this skill.";
        skill.registrationFile = root.instructionPath;
      }
    }
  } catch {
    // instruction file が存在しない場合は無視
  }
}

function computeInstructionPathFromRoot(
  instructionPath: string,
  rootPath: string,
): string {
  const relativeFsPath = path
    .relative(path.dirname(instructionPath), rootPath)
    .replace(/\\/g, "/");
  return relativeFsPath || ".";
}

async function scanSkillsForRoot(root: SkillRoot): Promise<LocalSkill[]> {
  if (!(await rootExists(root.rootUri))) {
    return [];
  }

  const entries: Array<{ skillMdUri: vscode.Uri; relativePath: string }> = [];
  await scanSkillRootEntries(root.rootUri, "", entries);

  const skills: LocalSkill[] = [];
  for (const entry of entries) {
    try {
      const skill = await parseLocalSkillFile(
        entry.skillMdUri,
        root,
        entry.relativePath,
      );
      if (skill) {
        skills.push(skill);
      }
    } catch (error) {
      console.warn(`Failed to parse ${entry.skillMdUri.fsPath}:`, error);
    }
  }

  if (root.isManaged) {
    await checkRegistrationStatusForRoot(skills, root);
  }

  return skills;
}

async function rootExists(rootUri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(rootUri);
    return true;
  } catch {
    return false;
  }
}

/**
 * configured skills directory 内の SKILL.md をスキャン
 * @param workspaceUri ワークスペースの URI
 * @param includeInstalled true の場合、skills directory 配下のスキルを含める
 */
export async function scanLocalSkills(
  workspaceUri: vscode.Uri,
  includeInstalled: boolean = false,
): Promise<LocalSkill[]> {
  if (!includeInstalled) {
    return [];
  }

  const managedRoots = await getManagedSkillRoots(workspaceUri);
  const workspaceRoots = managedRoots.filter(
    (root) => root.scope === "workspace",
  );
  if (workspaceRoots.length === 0) {
    return [];
  }

  const skills = await Promise.all(
    workspaceRoots.map((root) => scanSkillsForRoot(root)),
  );
  return skills.flat();
}

export async function scanVisibleSkills(
  workspaceUri?: vscode.Uri,
): Promise<LocalSkill[]> {
  const cacheKey = getVisibleSkillsCacheKey(workspaceUri);
  const cached = visibleSkillsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    const managedRoots = await getManagedSkillRoots(workspaceUri);
    const extensionRoots = await getExtensionSkillRoots();
    const builtInRoots = await getBuiltInSkillRoots();
    const allRoots = [...managedRoots, ...extensionRoots, ...builtInRoots];

    const skills = await Promise.all(
      allRoots.map((root) => scanSkillsForRoot(root)),
    );
    return skills.flat().sort((left, right) => {
      if (left.scope !== right.scope) {
        const scopeOrder: SkillScope[] = [
          "workspace",
          "userGlobal",
          "extension",
          "builtIn",
        ];
        return scopeOrder.indexOf(left.scope) - scopeOrder.indexOf(right.scope);
      }

      const rootCompare = normalizeFileSystemPath(
        left.root.rootPath,
      ).localeCompare(normalizeFileSystemPath(right.root.rootPath));
      if (rootCompare !== 0) {
        return rootCompare;
      }

      return left.relativePath.localeCompare(right.relativePath);
    });
  })();

  visibleSkillsCache.set(cacheKey, pending);
  try {
    return await pending;
  } catch (error) {
    visibleSkillsCache.delete(cacheKey);
    throw error;
  }
}

/**
 * AGENTS.md からスキル参照を抽出
 */
export async function parseInstructionFile(
  workspaceUri: vscode.Uri,
): Promise<SkillReference[]> {
  const config = vscode.workspace.getConfiguration("skillNinja");
  const instructionFile = config.get<string>("instructionFile", "AGENTS.md");

  let instructionPath: string;
  if (instructionFile === "custom") {
    instructionPath = config.get<string>("customInstructionPath", "AGENTS.md");
  } else {
    instructionPath = instructionFile;
  }

  const instructionUri =
    resolveConfiguredPathToUri(instructionPath, workspaceUri) ||
    vscode.Uri.joinPath(workspaceUri, instructionPath);

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
  skill: LocalSkill,
  _workspaceUri: vscode.Uri,
  context: vscode.ExtensionContext,
): Promise<boolean> {
  try {
    if (!skill.isManaged || skill.isReadOnly) {
      return false;
    }

    const meta =
      (await readSkillMetaFile(skill.skillDirUri, skill.relativePath)) ||
      buildDefaultMeta(skill);
    delete meta.registrationDisabled;
    meta.relativePath = skill.relativePath;

    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(skill.skillDirUri, ".skill-meta.json"),
      Buffer.from(JSON.stringify(meta, null, 2), "utf-8"),
    );

    await updateInstructionFileForRoot(skill.root, context);
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
  skill: LocalSkill,
  _workspaceUri: vscode.Uri,
  context: vscode.ExtensionContext,
): Promise<boolean> {
  try {
    if (!skill.isManaged || skill.isReadOnly) {
      return false;
    }

    const meta =
      (await readSkillMetaFile(skill.skillDirUri, skill.relativePath)) ||
      buildDefaultMeta(skill);
    meta.registrationDisabled = true;
    meta.relativePath = skill.relativePath;

    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(skill.skillDirUri, ".skill-meta.json"),
      Buffer.from(JSON.stringify(meta, null, 2), "utf-8"),
    );

    await updateInstructionFileForRoot(skill.root, context);
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
