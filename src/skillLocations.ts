import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { resolveOutputFormat } from "./toolDetector";

export type SkillScope = "workspace" | "userGlobal" | "extension" | "builtIn";

export interface SkillRoot {
  scope: SkillScope;
  label: string;
  rootUri: vscode.Uri;
  rootPath: string;
  displayPath: string;
  isManaged: boolean;
  isReadOnly: boolean;
  extensionId?: string;
  extensionDisplayName?: string;
  instructionUri?: vscode.Uri;
  instructionPath?: string;
  linkPathFromInstruction?: string;
}

interface RawSkillLocation {
  path: string;
  enabled: boolean;
}

const CHAT_AGENT_SKILL_LOCATION_KEYS = [
  "chat.agent.skillsLocations",
  "chat.agent.skills.locations",
  "chat.agentSkillsLocations",
  "chat.agentSkills.locations",
  "chat.agent.skillLocations",
  "chat.agent.skill.locations",
];

const CHAT_CONFIGURATION_KEYS = [
  "agent.skillsLocations",
  "agent.skills.locations",
  "agentSkillsLocations",
  "agentSkills.locations",
  "agent.skillLocations",
  "agent.skill.locations",
];

const BUILT_IN_RELATIVE_ROOTS = [
  ["node_modules", "@github", "copilot", "builtin-skills"],
  ["extensions", "copilot", "skills"],
  ["extensions", "copilot", "dist", "skills"],
  ["extensions", "copilot", "assets", "skills"],
  ["extensions", "copilot", "assets", "prompts", "skills"],
  ["extensions", "copilot", "dist", "prompts", "skills"],
  ["extensions", "github.copilot-chat", "dist", "skills"],
  ["extensions", "github.copilot-chat", "skills"],
  ["extensions", "github.copilot-chat", "assets", "skills"],
  ["extensions", "github.copilot-chat", "assets", "prompts", "skills"],
  ["extensions", "github.copilot-chat", "dist", "prompts", "skills"],
  ["out", "vs", "sessions", "skills"],
];

const COPILOT_EXTENSION_IDS = [
  "GitHub.copilot-chat",
  "github.copilot-chat",
  "GitHub.copilot",
  "github.copilot",
];

const OWN_EXTENSION_IDS = ["yamapan.agent-skill-ninja"];

const EXTENSION_SKILL_SUBDIRS = [
  ["skills"],
  ["resources", "skills"],
  ["dist", "skills"],
  ["assets", "skills"],
  ["resources", "prompts", "skills"],
  ["assets", "prompts", "skills"],
  ["dist", "prompts", "skills"],
  ["prompts", "skills"],
];

function isCopilotExtensionId(extensionId: string): boolean {
  const normalizedId = extensionId.toLowerCase();
  return COPILOT_EXTENSION_IDS.some(
    (candidate) => candidate.toLowerCase() === normalizedId,
  );
}

function isOwnExtensionId(extensionId: string): boolean {
  const normalizedId = extensionId.toLowerCase();
  return OWN_EXTENSION_IDS.some(
    (candidate) => candidate.toLowerCase() === normalizedId,
  );
}

function isBundledExtensionPath(extensionPath: string): boolean {
  const normalizedExtensionPath = normalizeFileSystemPath(extensionPath);
  const normalizedAppExtensionsPath = normalizeFileSystemPath(
    path.join(vscode.env.appRoot, "extensions"),
  );
  return (
    normalizedExtensionPath === normalizedAppExtensionsPath ||
    normalizedExtensionPath.startsWith(`${normalizedAppExtensionsPath}/`)
  );
}

export function normalizeFileSystemPath(filePath: string): string {
  const normalized = path.normalize(filePath).replace(/\\/g, "/");
  if (process.platform === "win32") {
    return normalized.toLowerCase();
  }
  return normalized;
}

export function computeRelativeDirectoryPath(
  fromFilePath: string,
  toDirectoryPath: string,
): string {
  const fromDir = path.dirname(fromFilePath);
  const relativePath = path
    .relative(fromDir, toDirectoryPath)
    .replace(/\\/g, "/");
  return relativePath || ".";
}

export function pathToDisplayPath(
  targetPath: string,
  homeDir: string = os.homedir(),
): string {
  const normalizedTarget = targetPath.replace(/\\/g, "/");
  const normalizedHome = homeDir.replace(/\\/g, "/");
  const comparableTarget = normalizeFileSystemPath(normalizedTarget);
  const comparableHome = normalizeFileSystemPath(normalizedHome);

  if (comparableTarget === comparableHome) {
    return "~";
  }

  if (comparableTarget.startsWith(`${comparableHome}/`)) {
    return `~/${normalizedTarget.slice(normalizedHome.length + 1)}`;
  }

  return normalizedTarget;
}

function getEnvironmentVariable(variableName: string): string | undefined {
  const exactMatch = process.env[variableName];
  if (exactMatch) {
    return exactMatch;
  }

  const upperCaseMatch = process.env[variableName.toUpperCase()];
  if (upperCaseMatch) {
    return upperCaseMatch;
  }

  const lowerCaseMatch = process.env[variableName.toLowerCase()];
  if (lowerCaseMatch) {
    return lowerCaseMatch;
  }

  return undefined;
}

function expandConfiguredPathVariables(
  configuredPath: string,
  workspacePath?: string,
  homeDir: string = os.homedir(),
): string | undefined {
  let unresolvedVariable = false;

  const replaceVariable = (match: string, variableName: string): string => {
    const resolved = getEnvironmentVariable(variableName);
    if (!resolved) {
      unresolvedVariable = true;
      return match;
    }
    return resolved;
  };

  let expanded = configuredPath;
  if (workspacePath) {
    expanded = expanded.replace(/\$\{workspaceFolder\}/g, workspacePath);
  }
  expanded = expanded.replace(/\$\{userHome\}/g, homeDir);
  expanded = expanded.replace(
    /\$\{env:([^}]+)\}/g,
    (match, variableName: string) => replaceVariable(match, variableName),
  );
  expanded = expanded.replace(/%([^%]+)%/g, (match, variableName: string) =>
    replaceVariable(match, variableName),
  );

  if (unresolvedVariable) {
    return undefined;
  }

  return expanded;
}

export function getDefaultUserGlobalSkillLocationPaths(
  homeDir: string = os.homedir(),
): string[] {
  return [
    path.join(homeDir, ".copilot", "skills"),
    path.join(homeDir, ".claude", "skills"),
    path.join(homeDir, ".agents", "skills"),
  ];
}

export function getBuiltInCandidatePaths(
  appRoot: string,
  extensionPaths: string[] = [],
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (candidatePath: string): void => {
    const normalizedCandidatePath = normalizeFileSystemPath(candidatePath);
    if (seen.has(normalizedCandidatePath)) {
      return;
    }

    seen.add(normalizedCandidatePath);
    candidates.push(path.normalize(candidatePath));
  };

  for (const parts of BUILT_IN_RELATIVE_ROOTS) {
    addCandidate(path.join(appRoot, ...parts));
  }

  for (const extensionPath of extensionPaths) {
    for (const parts of EXTENSION_SKILL_SUBDIRS) {
      addCandidate(path.join(extensionPath, ...parts));
    }
  }

  return candidates;
}

export function compareVersionStrings(a: string, b: string): number {
  const parse = (s: string): number[] =>
    s.split(/[.-]/).map((seg) => {
      const n = parseInt(seg, 10);
      return Number.isNaN(n) ? 0 : n;
    });
  const aParts = parse(a);
  const bParts = parse(b);
  const maxLen = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < maxLen; i++) {
    const diff = (aParts[i] || 0) - (bParts[i] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export async function getPackagedBuiltInSkillLocationPaths(
  homeDir: string = os.homedir(),
): Promise<string[]> {
  const packageRootUri = vscode.Uri.file(path.join(homeDir, ".copilot", "pkg"));
  const candidates: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (candidatePath: string): void => {
    const normalizedCandidatePath = normalizeFileSystemPath(candidatePath);
    if (seen.has(normalizedCandidatePath)) {
      return;
    }

    seen.add(normalizedCandidatePath);
    candidates.push(path.normalize(candidatePath));
  };

  // Collect versioned entries per channel for consolidation
  const channelVersions = new Map<
    string,
    Array<{ version: string; path: string }>
  >();

  const packageChannels = await readDirectoryIfExists(packageRootUri);
  for (const [channelName, channelType] of packageChannels) {
    if (!isDirectoryEntry(channelType)) {
      continue;
    }

    const channelUri = vscode.Uri.joinPath(packageRootUri, channelName);
    const channelEntries = await readDirectoryIfExists(channelUri);

    for (const [entryName, entryType] of channelEntries) {
      if (!isDirectoryEntry(entryType)) {
        continue;
      }

      if (entryName === "builtin-skills") {
        addCandidate(vscode.Uri.joinPath(channelUri, entryName).fsPath);
        continue;
      }

      const versionUri = vscode.Uri.joinPath(channelUri, entryName);
      const versionEntries = await readDirectoryIfExists(versionUri);
      for (const [versionEntryName, versionEntryType] of versionEntries) {
        if (
          versionEntryName === "builtin-skills" &&
          isDirectoryEntry(versionEntryType)
        ) {
          if (!channelVersions.has(channelName)) {
            channelVersions.set(channelName, []);
          }
          channelVersions.get(channelName)!.push({
            version: entryName,
            path: vscode.Uri.joinPath(versionUri, versionEntryName).fsPath,
          });
        }
      }
    }
  }

  // Keep only the latest version per channel
  for (const [, versions] of channelVersions) {
    if (versions.length === 0) {
      continue;
    }
    versions.sort((a, b) => compareVersionStrings(b.version, a.version));
    addCandidate(versions[0].path);
  }

  return candidates;
}

export function resolveConfiguredPath(
  configuredPath: string,
  workspacePath?: string,
  homeDir: string = os.homedir(),
): string | undefined {
  const trimmed = configuredPath.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("file://")) {
    try {
      return path.normalize(vscode.Uri.parse(trimmed).fsPath);
    } catch {
      return undefined;
    }
  }

  const expandedPath = expandConfiguredPathVariables(
    trimmed,
    workspacePath,
    homeDir,
  );
  if (!expandedPath) {
    return undefined;
  }

  let expanded = expandedPath;

  if (expanded === "~") {
    return path.normalize(homeDir);
  }

  if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
    return path.normalize(path.join(homeDir, expanded.slice(2)));
  }

  if (path.isAbsolute(expanded)) {
    return path.normalize(expanded);
  }

  if (workspacePath) {
    return path.normalize(path.resolve(workspacePath, expanded));
  }

  return undefined;
}

export function resolveConfiguredPathToUri(
  configuredPath: string,
  workspaceUri?: vscode.Uri,
): vscode.Uri | undefined {
  const resolvedPath = resolveConfiguredPath(
    configuredPath,
    workspaceUri?.fsPath,
  );
  return resolvedPath ? vscode.Uri.file(resolvedPath) : undefined;
}

export function parseAgentSkillLocationConfig(
  rawValue: unknown,
): RawSkillLocation[] {
  if (!rawValue) {
    return [];
  }

  if (Array.isArray(rawValue)) {
    return rawValue.flatMap((entry) => normalizeSkillLocationEntry(entry));
  }

  if (typeof rawValue === "object") {
    const candidateObject = rawValue as Record<string, unknown>;
    if (Array.isArray(candidateObject.locations)) {
      return parseAgentSkillLocationConfig(candidateObject.locations);
    }

    return Object.entries(candidateObject).flatMap(([key, value]) => {
      if (typeof value === "boolean") {
        return value ? [{ path: key, enabled: true }] : [];
      }

      if (typeof value === "string") {
        return [{ path: value, enabled: true }];
      }

      if (typeof value === "object" && value) {
        const nested = value as Record<string, unknown>;
        const nestedPath = pickFirstString([
          nested.path,
          nested.location,
          nested.uri,
          typeof key === "string" ? key : undefined,
        ]);
        if (!nestedPath) {
          return [];
        }
        return [
          {
            path: nestedPath,
            enabled: nested.enabled !== false && nested.isEnabled !== false,
          },
        ];
      }

      return [];
    });
  }

  return [];
}

function normalizeSkillLocationEntry(entry: unknown): RawSkillLocation[] {
  if (typeof entry === "string") {
    return [{ path: entry, enabled: true }];
  }

  if (typeof entry === "object" && entry) {
    const candidate = entry as Record<string, unknown>;
    const configuredPath = pickFirstString([
      candidate.path,
      candidate.location,
      candidate.uri,
      candidate.value,
    ]);
    if (!configuredPath) {
      return [];
    }

    return [
      {
        path: configuredPath,
        enabled: candidate.enabled !== false && candidate.isEnabled !== false,
      },
    ];
  }

  return [];
}

function pickFirstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function isInsidePath(parentPath: string, targetPath: string): boolean {
  const normalizedParent = path.resolve(parentPath);
  const normalizedTarget = path.resolve(targetPath);
  const relativePath = path.relative(normalizedParent, normalizedTarget);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

async function pathExists(targetUri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(targetUri);
    return true;
  } catch {
    return false;
  }
}

async function readDirectoryIfExists(
  targetUri: vscode.Uri,
): Promise<Array<[string, vscode.FileType]>> {
  try {
    return await vscode.workspace.fs.readDirectory(targetUri);
  } catch {
    return [];
  }
}

function isDirectoryEntry(fileType: vscode.FileType): boolean {
  return fileType === vscode.FileType.Directory;
}

function getRawAgentSkillLocationsSetting(): unknown {
  const rootConfig = vscode.workspace.getConfiguration();
  for (const key of CHAT_AGENT_SKILL_LOCATION_KEYS) {
    const value = rootConfig.get<unknown>(key);
    if (value !== undefined) {
      return value;
    }
  }

  const chatConfig = vscode.workspace.getConfiguration("chat");
  for (const key of CHAT_CONFIGURATION_KEYS) {
    const value = chatConfig.get<unknown>(key);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

export function resolveUserGlobalInstructionPath(
  skillsRootPath: string,
): string {
  const parentDir = path.dirname(skillsRootPath);
  const containerName = path.basename(parentDir).toLowerCase();

  switch (containerName) {
    case ".copilot":
      return path.join(parentDir, "instructions.md");
    case ".claude":
      return path.join(parentDir, "CLAUDE.md");
    case ".cursor":
      return path.join(parentDir, "rules", "skills.mdc");
    case ".windsurf":
      return path.join(parentDir, ".windsurfrules");
    case ".cline":
      return path.join(parentDir, ".clinerules");
    case ".agents":
      return path.join(parentDir, "AGENTS.md");
    default:
      return path.join(parentDir, "AGENTS.md");
  }
}

export const DEFAULT_WORKSPACE_SKILLS_DIRECTORY = ".github/skills";

/**
 * Resolve the workspace skills directory for the workspace scope. Honors the
 * Skill NINJA setting first; if Skill NINJA is left at its default value but
 * the sister extension Resource NINJA has a non-default `resourcesDirectory`
 * configured, mirror that value to keep both extensions pointing at the same
 * folder (Workspace Path Drift prevention, see plan v3 §6).
 *
 * Pure helper; no I/O. Reads VS Code workspace configuration only.
 */
export function resolveWorkspaceSkillsDirectory(
  skillNinjaConfig: vscode.WorkspaceConfiguration,
  resourceNinjaConfig: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(
    "resourceNinja",
  ),
): string {
  const own = skillNinjaConfig.get<string>("skillsDirectory");
  const ownTrimmed = (own || "").trim();
  const isOwnDefault =
    !ownTrimmed || ownTrimmed === DEFAULT_WORKSPACE_SKILLS_DIRECTORY;

  if (!isOwnDefault) {
    return ownTrimmed;
  }

  // resourceNinja.resourcesDirectory が明示的に設定されていれば尊重する。
  // resourceNinja 側のデフォルトも `.github/skills` のため、デフォルト値の
  // ときは敢えて空にしてくれる前提（または同値で安全）。
  const sibling = resourceNinjaConfig.get<string>("resourcesDirectory");
  const siblingTrimmed = (sibling || "").trim();
  if (siblingTrimmed) {
    return siblingTrimmed;
  }

  return DEFAULT_WORKSPACE_SKILLS_DIRECTORY;
}

export function resolveWorkspaceSkillsRootUri(
  workspaceUri: vscode.Uri,
  skillNinjaConfig: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(
    "skillNinja",
  ),
  resourceNinjaConfig: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(
    "resourceNinja",
  ),
): vscode.Uri {
  const skillsDirectory = resolveWorkspaceSkillsDirectory(
    skillNinjaConfig,
    resourceNinjaConfig,
  );

  return (
    resolveConfiguredPathToUri(skillsDirectory, workspaceUri) ||
    vscode.Uri.joinPath(workspaceUri, skillsDirectory)
  );
}

function getWorkspaceSkillsDisplayPath(
  workspaceUri: vscode.Uri,
  workspaceRootUri: vscode.Uri,
): string {
  const relativePath = path
    .relative(workspaceUri.fsPath, workspaceRootUri.fsPath)
    .replace(/\\/g, "/");

  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  ) {
    return relativePath || ".";
  }

  return pathToDisplayPath(workspaceRootUri.fsPath);
}

export async function getManagedSkillRoots(
  workspaceUri?: vscode.Uri,
): Promise<SkillRoot[]> {
  const roots: SkillRoot[] = [];
  const seen = new Set<string>();
  const skillNinjaConfig = vscode.workspace.getConfiguration("skillNinja");

  const addManagedRoot = (locationUri: vscode.Uri): void => {
    const normalizedRootPath = normalizeFileSystemPath(locationUri.fsPath);
    if (seen.has(normalizedRootPath)) {
      return;
    }

    if (workspaceUri && isInsidePath(workspaceUri.fsPath, locationUri.fsPath)) {
      return;
    }

    const instructionPath = resolveUserGlobalInstructionPath(
      locationUri.fsPath,
    );
    const instructionUri = vscode.Uri.file(instructionPath);

    roots.push({
      scope: "userGlobal",
      label: "User / Global Skills",
      rootUri: locationUri,
      rootPath: locationUri.fsPath,
      displayPath: pathToDisplayPath(locationUri.fsPath),
      isManaged: true,
      isReadOnly: false,
      instructionUri,
      instructionPath,
      linkPathFromInstruction: computeRelativeDirectoryPath(
        instructionPath,
        locationUri.fsPath,
      ),
    });
    seen.add(normalizedRootPath);
  };

  if (workspaceUri) {
    const workspaceRootUri = resolveWorkspaceSkillsRootUri(
      workspaceUri,
      skillNinjaConfig,
    );
    const { instructionFile } = await resolveOutputFormat(workspaceUri);
    const instructionUri =
      resolveConfiguredPathToUri(instructionFile, workspaceUri) ||
      vscode.Uri.joinPath(workspaceUri, instructionFile);
    const normalizedWorkspaceRoot = normalizeFileSystemPath(
      workspaceRootUri.fsPath,
    );

    roots.push({
      scope: "workspace",
      label: "Workspace Skills",
      rootUri: workspaceRootUri,
      rootPath: workspaceRootUri.fsPath,
      displayPath: getWorkspaceSkillsDisplayPath(
        workspaceUri,
        workspaceRootUri,
      ),
      isManaged: true,
      isReadOnly: false,
      instructionUri,
      instructionPath: instructionUri.fsPath,
      linkPathFromInstruction: computeRelativeDirectoryPath(
        instructionUri.fsPath,
        workspaceRootUri.fsPath,
      ),
    });
    seen.add(normalizedWorkspaceRoot);
  }

  const useVsCodeAgentSkillLocations =
    skillNinjaConfig.get<boolean>("useVsCodeAgentSkillLocations") !== false;
  if (!useVsCodeAgentSkillLocations) {
    return roots;
  }

  for (const defaultPath of getDefaultUserGlobalSkillLocationPaths()) {
    addManagedRoot(vscode.Uri.file(defaultPath));
  }

  const rawSettingValue = getRawAgentSkillLocationsSetting();
  const rawLocations = parseAgentSkillLocationConfig(rawSettingValue).filter(
    (entry) => entry.enabled,
  );

  for (const location of rawLocations) {
    const locationUri = resolveConfiguredPathToUri(location.path, workspaceUri);
    if (!locationUri) {
      continue;
    }

    addManagedRoot(locationUri);
  }

  return roots;
}

export async function getBuiltInSkillRoots(): Promise<SkillRoot[]> {
  const skillNinjaConfig = vscode.workspace.getConfiguration("skillNinja");
  if (!skillNinjaConfig.get<boolean>("showBuiltInSkills")) {
    return [];
  }

  const candidates = new Set<string>();
  const extensionPaths: string[] = [];

  for (const extensionId of COPILOT_EXTENSION_IDS) {
    const extension = vscode.extensions.getExtension(extensionId);
    if (!extension) {
      continue;
    }
    extensionPaths.push(extension.extensionUri.fsPath);
  }

  for (const candidatePath of getBuiltInCandidatePaths(
    vscode.env.appRoot,
    extensionPaths,
  )) {
    candidates.add(candidatePath);
  }

  for (const candidatePath of await getPackagedBuiltInSkillLocationPaths()) {
    candidates.add(candidatePath);
  }

  const roots: SkillRoot[] = [];
  const seen = new Set<string>();
  for (const candidatePath of candidates) {
    const normalizedCandidatePath = normalizeFileSystemPath(candidatePath);
    if (seen.has(normalizedCandidatePath)) {
      continue;
    }

    const candidateUri = vscode.Uri.file(candidatePath);
    if (!(await pathExists(candidateUri))) {
      continue;
    }

    roots.push({
      scope: "builtIn",
      label: "Built-in Skills",
      rootUri: candidateUri,
      rootPath: candidateUri.fsPath,
      displayPath: pathToDisplayPath(candidateUri.fsPath),
      isManaged: false,
      isReadOnly: true,
    });
    seen.add(normalizedCandidatePath);
  }

  return roots;
}

export async function getExtensionSkillRoots(): Promise<SkillRoot[]> {
  const roots: SkillRoot[] = [];
  const seen = new Set<string>();

  for (const extension of vscode.extensions.all) {
    const extensionId = extension.id || "";
    if (!extensionId) {
      continue;
    }

    if (isCopilotExtensionId(extensionId) || isOwnExtensionId(extensionId)) {
      continue;
    }

    const extensionPath = extension.extensionUri.fsPath;
    if (isBundledExtensionPath(extensionPath)) {
      continue;
    }

    const extensionDisplayName =
      pickFirstString([
        extension.packageJSON?.displayName,
        extension.packageJSON?.name,
      ]) || extensionId;

    for (const parts of EXTENSION_SKILL_SUBDIRS) {
      const rootUri = vscode.Uri.joinPath(extension.extensionUri, ...parts);
      const normalizedRootPath = normalizeFileSystemPath(rootUri.fsPath);
      if (seen.has(normalizedRootPath) || !(await pathExists(rootUri))) {
        continue;
      }

      roots.push({
        scope: "extension",
        label: "Installed Extensions",
        rootUri,
        rootPath: rootUri.fsPath,
        displayPath: pathToDisplayPath(rootUri.fsPath),
        isManaged: false,
        isReadOnly: true,
        extensionId,
        extensionDisplayName,
      });
      seen.add(normalizedRootPath);
    }
  }

  return roots.sort((left, right) => {
    const leftName = (
      left.extensionDisplayName ||
      left.extensionId ||
      ""
    ).toLowerCase();
    const rightName = (
      right.extensionDisplayName ||
      right.extensionId ||
      ""
    ).toLowerCase();
    const labelCompare = leftName.localeCompare(rightName);
    if (labelCompare !== 0) {
      return labelCompare;
    }

    return normalizeFileSystemPath(left.rootPath).localeCompare(
      normalizeFileSystemPath(right.rootPath),
    );
  });
}
