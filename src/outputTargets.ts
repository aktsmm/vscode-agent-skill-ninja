// 出力ターゲット解決
// 「どのファイルに一覧を書くか」「出すか」「どの形式か」を出力先ごとに決める。
//
// 設定単位はターゲットだが、書き込み単位はファイル。複数ターゲットが同じ
// instruction ファイルへ寄ることがあるため、解決の最終形は
// ResolvedOutputGroup（= 1 ファイル = 1 形式 = 1 catalog = 1 ブロック）にする。

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  normalizeOutputFormat,
  OutputFormat,
  resolveOutputFormat,
} from "./toolDetector";
import {
  normalizeFileSystemPath,
  resolveConfiguredPathToUri,
  SkillRoot,
} from "./skillLocations";

export type RefCatalogFormat = Exclude<OutputFormat, "ref" | "none">;

export const DEFAULT_REF_CATALOG_PATH = ".github/skills/README.md";

/** settings.json に書かれる生の要素。すべて optional（未指定は全体既定に追従）。 */
export interface OutputTargetConfig {
  id?: string;
  root?: string;
  instructionFile?: string;
  format?: string;
  catalogPath?: string;
  catalogFormat?: string;
  enabled?: boolean;
}

/** scalar 設定から読んだ全体既定。ターゲット個別指定がなければこれが使われる。 */
export interface OutputDefaults {
  format: OutputFormat;
  catalogPath: string;
  catalogFormat: RefCatalogFormat;
}

export type OutputTargetsMode = "legacy" | "array";

export interface ResolvedOutputGroup {
  id: string;
  scope: "workspace" | "userGlobal";
  instructionUri: vscode.Uri;
  instructionPath: string;
  format: OutputFormat;
  formatIsExplicit: boolean;
  catalogPath: string;
  catalogFormat: RefCatalogFormat;
  catalogUri?: vscode.Uri;
  workspaceFolderUri?: vscode.Uri;
  members: SkillRoot[];
  targetIds: string[];
}

// グループ設定が衝突したときの優先順。数値が小さいほど優先。
const TARGET_PRIORITY: Record<string, number> = {
  workspace: 0,
  copilot: 1,
  claude: 2,
  agents: 3,
};

const CUSTOM_TARGET_PRIORITY = 10;

function getTargetPriority(targetId: string): number {
  return TARGET_PRIORITY[targetId] ?? CUSTOM_TARGET_PRIORITY;
}

function normalizeRefCatalogFormat(value: unknown): RefCatalogFormat {
  return value === "compact" || value === "legacy" ? value : "full";
}

/**
 * 存在する最も近い祖先ディレクトリを realpath して正規化する。
 * symlink された home（例 /home/x と /Users/x）が別グループに割れるのを防ぐ。
 */
export function canonicalizeOutputPath(filePath: string): string {
  const absolute = path.resolve(filePath);
  let current = path.dirname(absolute);
  const tail: string[] = [path.basename(absolute)];

  for (;;) {
    try {
      const real = fs.realpathSync.native(current);
      return normalizeFileSystemPath(path.join(real, ...tail.reverse()));
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return normalizeFileSystemPath(absolute);
      }
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * ネストした workspace folder を取り違えないよう、セパレーター境界で判定して
 * 最も深く包含する folder を返す。素朴な startsWith は `C:/repo2` を
 * `C:/repo` 配下と誤認する。
 */
export function findDeepestContainingFolder(
  targetPath: string,
  folderUris: readonly vscode.Uri[],
): vscode.Uri | undefined {
  const normalizedTarget = normalizeFileSystemPath(targetPath);
  let best: vscode.Uri | undefined;
  let bestLength = -1;

  for (const folderUri of folderUris) {
    const normalizedFolder = normalizeFileSystemPath(folderUri.fsPath).replace(
      /\/+$/,
      "",
    );
    const contains =
      normalizedTarget === normalizedFolder ||
      normalizedTarget.startsWith(`${normalizedFolder}/`);
    if (contains && normalizedFolder.length > bestLength) {
      best = folderUri;
      bestLength = normalizedFolder.length;
    }
  }

  return best;
}

/** root がどのターゲット ID に属するかを決める。global は home 直下の容器名で判定する。 */
export function deriveTargetId(
  root: SkillRoot,
  homeDir: string = os.homedir(),
): string {
  if (root.scope === "workspace") {
    return "workspace";
  }

  const containerDir = path.dirname(root.rootPath);
  const containerName = path.basename(containerDir).toLowerCase();
  const isDirectlyUnderHome =
    normalizeFileSystemPath(path.dirname(containerDir)) ===
    normalizeFileSystemPath(homeDir);

  if (isDirectlyUnderHome) {
    switch (containerName) {
      case ".copilot":
        return "copilot";
      case ".claude":
        return "claude";
      case ".agents":
        return "agents";
      default:
        break;
    }
  }

  return `custom:${normalizeFileSystemPath(root.rootPath)}`;
}

export function parseOutputTargets(rawValue: unknown): OutputTargetConfig[] {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  return rawValue.filter(
    (entry): entry is OutputTargetConfig =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry),
  );
}

/**
 * `outputTargets` が未設定なら legacy（従来の scalar 設定どおり）。
 * 明示的に設定されていれば array モード。空配列は「全出力 OFF」を意味する。
 */
export function getOutputTargetsMode(
  config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(
    "skillNinja",
  ),
): OutputTargetsMode {
  const inspected = config.inspect<unknown>("outputTargets");
  if (!inspected) {
    return "legacy";
  }

  const explicit =
    inspected.workspaceFolderValue ??
    inspected.workspaceValue ??
    inspected.globalValue;

  return Array.isArray(explicit) ? "array" : "legacy";
}

export async function getOutputDefaults(
  config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(
    "skillNinja",
  ),
): Promise<OutputDefaults> {
  const { format } = await resolveOutputFormat();
  return {
    format,
    catalogPath: config.get<string>("refCatalogPath") || DEFAULT_REF_CATALOG_PATH,
    catalogFormat: normalizeRefCatalogFormat(
      config.get<string>("refCatalogFormat"),
    ),
  };
}

function findTargetConfig(
  targets: readonly OutputTargetConfig[],
  targetId: string,
  root: SkillRoot,
  baseUri?: vscode.Uri,
): { config: OutputTargetConfig; index: number } | undefined {
  const normalizedRootPath = normalizeFileSystemPath(root.rootPath);

  for (let index = 0; index < targets.length; index++) {
    const candidate = targets[index];
    if (candidate.id && candidate.id === targetId) {
      return { config: candidate, index };
    }
    if (!candidate.root) {
      continue;
    }
    // 相対 root は workspace folder 基準で解決してから比較する
    const candidateUri =
      resolveConfiguredPathToUri(candidate.root, baseUri) ||
      resolveConfiguredPathToUri(candidate.root);
    if (
      candidateUri &&
      normalizeFileSystemPath(candidateUri.fsPath) === normalizedRootPath
    ) {
      return { config: candidate, index };
    }
  }

  return undefined;
}

function resolveCatalogUri(
  catalogPath: string,
  scope: "workspace" | "userGlobal",
  instructionUri: vscode.Uri,
  workspaceFolderUri?: vscode.Uri,
): vscode.Uri {
  const baseUri =
    (scope === "workspace" ? workspaceFolderUri : undefined) ||
    vscode.Uri.file(path.dirname(instructionUri.fsPath));

  return (
    resolveConfiguredPathToUri(catalogPath, baseUri) ||
    vscode.Uri.joinPath(baseUri, catalogPath)
  );
}

/**
 * 管理対象 root からファイル単位の出力グループを組み立てる。
 * 無効なターゲットの root はここで落とすので、有効グループへ混入しない。
 */
export async function resolveOutputGroups(
  roots: readonly SkillRoot[],
  options: {
    config?: vscode.WorkspaceConfiguration;
    workspaceFolderUris?: readonly vscode.Uri[];
  } = {},
): Promise<ResolvedOutputGroup[]> {
  const config =
    options.config || vscode.workspace.getConfiguration("skillNinja");
  const mode = getOutputTargetsMode(config);
  const targets =
    mode === "array" ? parseOutputTargets(config.get("outputTargets")) : [];
  const defaults = await getOutputDefaults(config);
  const folderUris =
    options.workspaceFolderUris ||
    (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri);

  const groups = new Map<string, ResolvedOutputGroup>();
  const groupPriority = new Map<string, { priority: number; index: number }>();

  for (const root of roots) {
    if (root.scope !== "workspace" && root.scope !== "userGlobal") {
      continue;
    }
    if (!root.isManaged || root.isReadOnly || !root.instructionPath) {
      continue;
    }

    const targetId = deriveTargetId(root);
    const workspaceFolderUri =
      root.scope === "workspace"
        ? findDeepestContainingFolder(root.rootPath, folderUris)
        : undefined;
    const match = findTargetConfig(targets, targetId, root, workspaceFolderUri);

    // array モードでは、明示的に列挙されたターゲットだけが有効。
    // これにより空配列が自然に「全 OFF」になる。
    const enabled =
      mode === "array" ? !!match && match.config.enabled !== false : true;
    if (!enabled) {
      continue;
    }

    const targetConfig = match?.config;

    const instructionUri = targetConfig?.instructionFile
      ? resolveConfiguredPathToUri(
          targetConfig.instructionFile,
          workspaceFolderUri,
        ) || vscode.Uri.file(root.instructionPath)
      : vscode.Uri.file(root.instructionPath);

    const groupKey = canonicalizeOutputPath(instructionUri.fsPath);
    const priority = {
      priority: getTargetPriority(targetId),
      index: match?.index ?? Number.MAX_SAFE_INTEGER,
    };

    const existing = groups.get(groupKey);
    if (existing) {
      existing.members.push(root);
      if (!existing.targetIds.includes(targetId)) {
        existing.targetIds.push(targetId);
      }

      // 同じファイルへ寄ったターゲット間では、優先順の高いほうの形式を採る。
      const currentPriority = groupPriority.get(groupKey)!;
      const winsPriority =
        priority.priority < currentPriority.priority ||
        (priority.priority === currentPriority.priority &&
          priority.index < currentPriority.index);
      if (winsPriority) {
        groupPriority.set(groupKey, priority);
        existing.format = normalizeOutputFormat(
          targetConfig?.format ?? defaults.format,
        );
        existing.formatIsExplicit = !!targetConfig?.format;
        existing.catalogPath = targetConfig?.catalogPath ?? defaults.catalogPath;
        existing.catalogFormat = normalizeRefCatalogFormat(
          targetConfig?.catalogFormat ?? defaults.catalogFormat,
        );
        existing.catalogUri = resolveCatalogUri(
          existing.catalogPath,
          existing.scope,
          existing.instructionUri,
          existing.workspaceFolderUri,
        );
      }
      continue;
    }

    const scope = root.scope;
    const format = normalizeOutputFormat(targetConfig?.format ?? defaults.format);
    const catalogPath = targetConfig?.catalogPath ?? defaults.catalogPath;
    const group: ResolvedOutputGroup = {
      id: groupKey,
      scope,
      instructionUri,
      instructionPath: instructionUri.fsPath,
      format,
      formatIsExplicit: !!targetConfig?.format,
      catalogPath,
      catalogFormat: normalizeRefCatalogFormat(
        targetConfig?.catalogFormat ?? defaults.catalogFormat,
      ),
      catalogUri: resolveCatalogUri(
        catalogPath,
        scope,
        instructionUri,
        workspaceFolderUri,
      ),
      workspaceFolderUri,
      members: [root],
      targetIds: [targetId],
    };

    groups.set(groupKey, group);
    groupPriority.set(groupKey, priority);
  }

  // format は優先順で決まるので、`none` の判定もグループ確定後に行う。
  // 落ちたグループのパスは desired に入らず、既存ブロックと catalog は掃除対象になる。
  return [...groups.values()].filter((group) => group.format !== "none");
}

/**
 * array モードで、まだ一度も判断されていない出力先の target id を返す。
 * 明示的に無効化されたものは entry を持つので含まれない。判断済みと未判断を
 * 区別できないと、あとから現れた出力先が黙って書かれないままになる。
 */
export function findUndecidedTargetIds(
  roots: readonly SkillRoot[],
  targets: readonly OutputTargetConfig[],
  folderUris: readonly vscode.Uri[] = [],
): string[] {
  const undecided: string[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    if (root.scope !== "workspace" && root.scope !== "userGlobal") {
      continue;
    }
    if (!root.isManaged || root.isReadOnly || !root.instructionPath) {
      continue;
    }

    const targetId = deriveTargetId(root);
    if (seen.has(targetId)) {
      continue;
    }
    seen.add(targetId);

    const workspaceFolderUri =
      root.scope === "workspace"
        ? findDeepestContainingFolder(root.rootPath, folderUris)
        : undefined;
    if (!findTargetConfig(targets, targetId, root, workspaceFolderUri)) {
      undecided.push(targetId);
    }
  }

  return undecided;
}

/** VS Code が chat request へ常時注入する可能性のある instruction ファイルか。 */
export function isAutoLoadedInstructionPath(
  instructionPath: string,
  homeDir: string = os.homedir(),
): boolean {
  const normalized = normalizeFileSystemPath(instructionPath);
  const candidates = [
    path.join(homeDir, ".copilot", "copilot-instructions.md"),
    path.join(homeDir, ".claude", "CLAUDE.md"),
  ];
  return candidates.some(
    (candidate) => normalizeFileSystemPath(candidate) === normalized,
  );
}

/** 前回書いた出力パスの在庫。workspace folder ごと + user/global 用の 1 束で持つ。 */
export interface OutputPathBucket {
  instruction: string[];
  catalog: string[];
}

export interface OutputCleanupPlan {
  /** 今回処理する bucket。workspace から外れた folder の bucket も含む。 */
  buckets: string[];
  /** 管理ブロックだけ剥がすファイル。ユーザー所有かもしれないので削除しない。 */
  staleInstruction: string[];
  /** 全体が生成物なので、空になったら削除してよいファイル。 */
  staleCatalog: string[];
}

/**
 * workspaceState に保存した在庫を読む。不正な形は黙って落とすが、
 * v1 の flat array を bucket として誤読みしないことが重要。誤読みすると
 * 掃除対象を見失い、古い一覧が永遠に残る。
 */
export function parseOutputPathBuckets(
  raw: unknown,
): Record<string, OutputPathBucket> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const toStringArray = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];

  const result: Record<string, OutputPathBucket> = {};
  for (const [bucket, value] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    result[bucket] = {
      instruction: toStringArray((value as Record<string, unknown>).instruction),
      catalog: toStringArray((value as Record<string, unknown>).catalog),
    };
  }
  return result;
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const filePath of paths) {
    const key = normalizeFileSystemPath(filePath);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(filePath);
  }
  return result;
}

/**
 * 在庫と今回の desired から掃除対象を決める。
 * instruction と catalog を分けて返すのは、catalog だけが「空なら削除してよい生成物」だから。
 */
export function planOutputCleanup(input: {
  desired: Readonly<Record<string, OutputPathBucket>>;
  stored: Readonly<Record<string, OutputPathBucket>>;
  legacyInstructionPaths?: readonly string[];
}): OutputCleanupPlan {
  const desiredPaths = new Set(
    Object.values(input.desired).flatMap((bucket) =>
      [...bucket.instruction, ...bucket.catalog].map(normalizeFileSystemPath),
    ),
  );
  const isStale = (filePath: string): boolean =>
    !desiredPaths.has(normalizeFileSystemPath(filePath));

  const buckets = [
    ...new Set([...Object.keys(input.desired), ...Object.keys(input.stored)]),
  ];

  const staleInstruction: string[] = [];
  const staleCatalog: string[] = [];
  for (const bucket of buckets) {
    const storedBucket = input.stored[bucket];
    if (!storedBucket) {
      continue;
    }
    staleInstruction.push(...storedBucket.instruction.filter(isStale));
    staleCatalog.push(...storedBucket.catalog.filter(isStale));
  }
  staleInstruction.push(
    ...(input.legacyInstructionPaths || []).filter(isStale),
  );

  const instructionPaths = uniquePaths(staleInstruction);
  // 同じパスをどこかが instruction として持つなら削除させない。
  // 設定次第で catalogPath は他ターゲットの instruction file と一致し得る。
  const instructionKeys = new Set(instructionPaths.map(normalizeFileSystemPath));

  return {
    buckets,
    staleInstruction: instructionPaths,
    staleCatalog: uniquePaths(staleCatalog).filter(
      (filePath) => !instructionKeys.has(normalizeFileSystemPath(filePath)),
    ),
  };
}

/**
 * 次回の在庫を組み立てる。掃除できなかったパス（lock 未取得など）は残し、
 * 次の reconcile で再試行できるようにする。空になった bucket は落とす。
 */
export function buildOutputInventory(input: {
  buckets: readonly string[];
  desired: Readonly<Record<string, OutputPathBucket>>;
  stored: Readonly<Record<string, OutputPathBucket>>;
  unhandledPaths: readonly string[];
}): Record<string, OutputPathBucket> {
  const unhandled = new Set(input.unhandledPaths.map(normalizeFileSystemPath));
  const keepUnhandled = (filePath: string): boolean =>
    unhandled.has(normalizeFileSystemPath(filePath));

  const next: Record<string, OutputPathBucket> = {};
  for (const bucket of input.buckets) {
    const storedBucket = input.stored[bucket];
    const desiredBucket = input.desired[bucket];

    const instruction = uniquePaths([
      ...(desiredBucket?.instruction || []),
      ...(storedBucket?.instruction || []).filter(keepUnhandled),
    ]);
    const catalog = uniquePaths([
      ...(desiredBucket?.catalog || []),
      ...(storedBucket?.catalog || []).filter(keepUnhandled),
    ]);

    if (instruction.length > 0 || catalog.length > 0) {
      next[bucket] = { instruction, catalog };
    }
  }
  return next;
}
