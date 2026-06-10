// Agent Skills Ninja - VS Code Extension

import * as path from "path";
import * as vscode from "vscode";
import {
  SkillIndex,
  Skill,
  Source,
  buildGitHubContentUrl,
  normalizeGitHubRepoUrl,
  loadSkillIndex,
  getSkillGitHubUrl,
  getSkillGitHubUrlAsync,
} from "./skillIndex";
import { searchSkills, SkillQuickPickItem } from "./skillSearch";
import {
  installSkill,
  uninstallSkill,
  uninstallSkillByPath,
  getInstalledSkillsWithMeta,
  getManagedInstalledSkillsWithMeta,
  refreshManagedSkillMetadata,
  refreshSingleSkillMetadata,
} from "./skillInstaller";
import {
  updateAllInstructionFiles,
  updateInstructionFileForRoot,
  removeSkillSectionFromFile,
} from "./instructionManager";
import {
  BrowseSkillsProvider,
  getSkillRootFromTreeItem,
  getSkillRootGroupLabel,
  SkillTreeItem,
  setViewRegistrationContext,
  UserGlobalSkillsProvider,
  WorkspaceSkillsProvider,
} from "./treeProvider";
import {
  updateIndexFromSources,
  updateIndexFromSingleSource,
  addSource,
  removeSource,
  searchGitHub,
  showAuthHelp,
} from "./indexUpdater";
import { messages, isJapanese } from "./i18n";
import {
  findIndexedSkillForInstalledMeta,
  isLocalInstalledSkillMeta,
  resolveSingleAffectedSourceId,
  summarizeBatchOutcome,
  shouldAutoUpdateManagedInstalledSkillFromIndex,
  shouldCheckManagedInstalledSkillAgainstIndex,
  shouldWarnManagedInstalledSkillMissingFromIndex,
} from "./installedSkillIndex";
import { showSkillPreview, getSkillId } from "./skillPreview";
import {
  LocalSkill,
  invalidateVisibleSkillsCache,
  registerLocalSkill,
  unregisterLocalSkill,
} from "./localSkillScanner";
import {
  getManagedSkillRoots,
  isInsidePath,
  resolveConfiguredPathToUri,
  resolveWorkspaceSkillsRootUri,
  SkillRoot,
} from "./skillLocations";
import { resolveOutputFormat } from "./toolDetector";
import { MAX_SEARCH_RESULTS } from "./skillSearch";
import { createChatParticipant } from "./chatParticipant";
import { registerMcpTools } from "./mcpTools";
import { getGitHubToken } from "./githubAuth";
import {
  publishBeacon,
  clearBeacon,
  buildExtensionApi,
  getPublishedSelfBeacon,
  getEffectiveOwnership,
  subscribeOwnershipChanges,
  SELF_EXTENSION_ID,
  SIBLING_EXTENSION_ID,
  MIGRATION_GUARD_DELAY_MS,
  AgentNinjaExtensionApi,
} from "./coexistence";
import { readSharedSourcesManifest } from "./shared-sources-manifest-store";

// 現在の拡張機能バージョン
const EXTENSION_VERSION =
  vscode.extensions.getExtension("yamapan.agent-skill-ninja")?.packageJSON
    ?.version || "0.0.0";

// activation 時に保存し、deactivate で beacon をクリアするために使用。
let activeContext: vscode.ExtensionContext | undefined;
let extensionShuttingDown = false;

const LAST_MANAGED_INSTRUCTION_PATHS_KEY =
  "skillNinja.lastManagedInstructionPaths";

async function resolveSkillGitHubUrl(
  skill: Skill,
  sources: Source[],
): Promise<string | undefined> {
  const token = await getGitHubToken();
  return (
    (await getSkillGitHubUrlAsync(skill, sources, token)) ||
    getSkillGitHubUrl(skill, sources)
  );
}

function getSearchResultGitHubUrl(result: {
  repoUrl: string;
  path: string;
  defaultBranch?: string;
}): string {
  return buildGitHubContentUrl(
    result.repoUrl,
    result.defaultBranch || "main",
    result.path,
  );
}

export function activate(
  context: vscode.ExtensionContext,
): AgentNinjaExtensionApi {
  console.log("Agent Skills Ninja is now active!");
  activeContext = context;
  extensionShuttingDown = false;

  // Coexistence beacon を publish。Resource NINJA とのオーナー判定で使われる。
  publishBeacon(context).catch((err) => {
    console.error("[Skill Ninja] publishBeacon failed:", err);
  });

  // Output channel for coexistence diagnostics
  const coexistenceChannel = vscode.window.createOutputChannel(
    "Agent Skills Ninja: Coexistence",
  );
  const skillStateChannel = vscode.window.createOutputChannel(
    "Agent Skills Ninja: Skill State",
  );
  context.subscriptions.push(coexistenceChannel, skillStateChannel);

  // 設定値のマイグレーション（旧フォーマット名 → 新フォーマット名）
  const formatMigrated = migrateOutputFormatSetting();

  let skillIndex: SkillIndex | undefined;

  // 最近インストールしたスキル（🆕 表示用）
  const recentlyInstalled = new Set<string>();
  const recentInstallTimeouts = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  // ステータスバーアイテム
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  context.subscriptions.push(statusBarItem);
  context.subscriptions.push(
    new vscode.Disposable(() => {
      for (const timeout of recentInstallTimeouts.values()) {
        clearTimeout(timeout);
      }
      recentInstallTimeouts.clear();
      recentlyInstalled.clear();
    }),
  );

  // バージョンアップ時のメタデータ再抽出
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  let initialSyncSettled = false;
  let initialSyncTimer: ReturnType<typeof setTimeout> | undefined;
  const deferredInstructionRoots = new Set<string>();

  function isContextActive(): boolean {
    return activeContext === context && !extensionShuttingDown;
  }

  async function flushDeferredInstructionUpdates(): Promise<void> {
    if (!workspaceFolder || !isContextActive()) {
      deferredInstructionRoots.clear();
      return;
    }

    if (deferredInstructionRoots.size === 0) {
      return;
    }

    const roots = await getManagedSkillRoots(workspaceFolder.uri);
    const pendingRootPaths = [...deferredInstructionRoots];
    deferredInstructionRoots.clear();

    for (const rootPath of pendingRootPaths) {
      const root = roots.find((candidate) => candidate.rootPath === rootPath);
      if (!root) {
        continue;
      }

      await updateInstructionFileForRoot(root, context);
    }
  }

  async function settleInitialSync(): Promise<void> {
    if (initialSyncSettled) {
      return;
    }

    initialSyncSettled = true;
    if (initialSyncTimer) {
      clearTimeout(initialSyncTimer);
      initialSyncTimer = undefined;
    }

    setViewRegistrationContext({ initialSyncPending: false });
    await flushDeferredInstructionUpdates();
    if (isContextActive()) {
      refreshInstalledViews();
    }
  }

  setViewRegistrationContext({ initialSyncPending: true });
  initialSyncTimer = setTimeout(() => {
    void settleInitialSync();
  }, 3000);
  context.subscriptions.push(
    new vscode.Disposable(() => {
      if (initialSyncTimer) {
        clearTimeout(initialSyncTimer);
        initialSyncTimer = undefined;
      }
      deferredInstructionRoots.clear();
    }),
  );

  async function refreshViewRegistrationContext(): Promise<void> {
    if (!isContextActive()) {
      return;
    }
    const decision = await getEffectiveOwnership(context);
    if (!isContextActive()) {
      return;
    }
    setViewRegistrationContext({
      owner: decision.owner,
      ownerReason: decision.reason,
    });
  }

  void refreshViewRegistrationContext();

  void checkVersionAndRefreshMetadata(
    context,
    workspaceFolder?.uri,
    formatMigrated,
  ).finally(() => {
    void settleInitialSync();
  });

  loadSkillIndex(context).then(async (index: SkillIndex) => {
    skillIndex = index;
    console.log(`Loaded ${index.skills.length} skills from index`);

    // インストール済みスキルのインデックス整合性チェック
    if (workspaceFolder) {
      const installedEntries = await getManagedInstalledEntries(
        workspaceFolder.uri,
      );
      const missingSkills: string[] = [];
      for (const entry of installedEntries) {
        if (!shouldWarnManagedInstalledSkillMissingFromIndex(entry)) {
          continue;
        }
        const skill = findIndexedSkillForInstalledMeta(
          index.skills,
          entry.meta,
        );
        if (!skill) {
          missingSkills.push(entry.meta.name);
        }
      }

      if (missingSkills.length > 0) {
        const message = isJapanese()
          ? `⚠️ ${
              missingSkills.length
            } 個のスキルがインデックスに見つかりません: ${missingSkills
              .slice(0, 3)
              .join(", ")}${missingSkills.length > 3 ? "..." : ""}`
          : `⚠️ ${
              missingSkills.length
            } skill(s) not found in index: ${missingSkills
              .slice(0, 3)
              .join(", ")}${missingSkills.length > 3 ? "..." : ""}`;

        const action = await vscode.window.showWarningMessage(
          message,
          isJapanese() ? "インデックスを更新" : "Update Index",
          isJapanese() ? "無視" : "Ignore",
        );

        if (action === (isJapanese() ? "インデックスを更新" : "Update Index")) {
          skillIndex = await updateIndexFromSources(context, index);
          browseProvider.refresh();
        }
      }
    }
  });

  // 統合ワークスペーススキルビュー
  const workspaceProvider = new WorkspaceSkillsProvider(
    workspaceFolder?.uri,
    recentlyInstalled,
  );
  const userGlobalProvider = new UserGlobalSkillsProvider(
    workspaceFolder?.uri,
    recentlyInstalled,
  );
  const browseProvider = new BrowseSkillsProvider(context);

  function refreshInstalledViews(): void {
    invalidateVisibleSkillsCache(workspaceFolder?.uri);
    workspaceProvider.refresh();
    userGlobalProvider.refresh();
  }

  function refreshAllViews(): void {
    refreshInstalledViews();
    browseProvider.refresh();
  }

  function isSharedSourcesManifestEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("skillNinja")
      .get<boolean>("useSharedSourcesManifest", false);
  }

  async function getRemoteSourceIndex(
    forceReload: boolean = false,
  ): Promise<SkillIndex> {
    if (forceReload || isSharedSourcesManifestEnabled() || !skillIndex) {
      skillIndex = await loadSkillIndex(context);
    }

    return skillIndex!;
  }

  function markRecentlyInstalled(skill: Skill): void {
    const existingTimeout = recentInstallTimeouts.get(skill.name);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    recentlyInstalled.add(skill.name);

    const timeout = setTimeout(() => {
      recentInstallTimeouts.delete(skill.name);
      if (recentlyInstalled.delete(skill.name)) {
        refreshInstalledViews();
      }
    }, 15000);

    recentInstallTimeouts.set(skill.name, timeout);
  }

  async function getManagedRootsForWorkspace(
    workspaceUri: vscode.Uri,
  ): Promise<SkillRoot[]> {
    const roots = await getManagedSkillRoots(workspaceUri);
    return roots.filter((root) => root.isManaged && !root.isReadOnly);
  }

  function normalizeInstructionPathForSet(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  }

  function uniqueInstructionPaths(paths: string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const filePath of paths) {
      const normalized = normalizeInstructionPathForSet(filePath);
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      result.push(filePath);
    }
    return result;
  }

  function getStoredManagedInstructionPaths(): string[] {
    return context.workspaceState.get<string[]>(
      LAST_MANAGED_INSTRUCTION_PATHS_KEY,
      [],
    );
  }

  async function getCurrentManagedInstructionPaths(
    workspaceUri: vscode.Uri,
  ): Promise<string[]> {
    const roots = await getManagedRootsForWorkspace(workspaceUri);
    return uniqueInstructionPaths(
      roots.flatMap((root) =>
        root.instructionUri ? [root.instructionUri.fsPath] : [],
      ),
    );
  }

  async function rememberCurrentManagedInstructionPaths(
    workspaceUri: vscode.Uri,
  ): Promise<void> {
    await context.workspaceState.update(
      LAST_MANAGED_INSTRUCTION_PATHS_KEY,
      await getCurrentManagedInstructionPaths(workspaceUri),
    );
  }

  async function cleanupInstructionFiles(
    filePaths: string[],
    keepShared: boolean,
  ): Promise<void> {
    for (const filePath of uniqueInstructionPaths(filePaths)) {
      try {
        await removeSkillSectionFromFile(vscode.Uri.file(filePath), {
          keepShared,
        });
      } catch {
        // ファイルが存在しない場合は無視
      }
    }
  }

  async function cleanupStaleStoredInstructionPaths(
    workspaceUri: vscode.Uri,
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration("skillNinja");
    if (config.get<boolean>("autoUpdateInstruction") === false) {
      return;
    }

    const storedPaths = getStoredManagedInstructionPaths();
    if (storedPaths.length === 0) {
      return;
    }

    const currentPaths = await getCurrentManagedInstructionPaths(workspaceUri);
    const currentSet = new Set(
      currentPaths.map(normalizeInstructionPathForSet),
    );
    const stalePaths = storedPaths.filter(
      (filePath) => !currentSet.has(normalizeInstructionPathForSet(filePath)),
    );
    if (stalePaths.length === 0) {
      await context.workspaceState.update(
        LAST_MANAGED_INSTRUCTION_PATHS_KEY,
        currentPaths,
      );
      return;
    }

    const ownership = await getEffectiveOwnership(context);
    const keepShared =
      config.get<string>("coexistenceMode") !== "independent" &&
      ownership.owner === "sibling";
    await cleanupInstructionFiles(stalePaths, keepShared);
    await context.workspaceState.update(
      LAST_MANAGED_INSTRUCTION_PATHS_KEY,
      currentPaths,
    );
  }

  async function getManagedInstalledEntries(workspaceUri: vscode.Uri) {
    return getManagedInstalledSkillsWithMeta(workspaceUri);
  }

  async function refreshIndexForInstalledMetas(
    index: SkillIndex,
    metas: Array<{ name: string; source: string; remotePath?: string }>,
  ): Promise<SkillIndex> {
    const affectedSourceId = resolveSingleAffectedSourceId(
      metas,
      index.sources,
    );
    const affectedSource = affectedSourceId
      ? index.sources.find((source) => source.id === affectedSourceId)
      : undefined;
    const missingSkillNames = metas.map((meta) => meta.name);

    const tryUpdate = await vscode.window.showWarningMessage(
      affectedSource
        ? isJapanese()
          ? `${missingSkillNames.length} 個のスキルがインデックスに見つかりません（${missingSkillNames
              .slice(0, 3)
              .join(
                ", ",
              )}${missingSkillNames.length > 3 ? "..." : ""}）。${affectedSource.name || affectedSourceId} のみ更新しますか？`
          : `${missingSkillNames.length} skill(s) not found in index (${missingSkillNames
              .slice(0, 3)
              .join(
                ", ",
              )}${missingSkillNames.length > 3 ? "..." : ""}). Update ${affectedSource.name || affectedSourceId} only?`
        : isJapanese()
          ? `${missingSkillNames.length} 個のスキルがインデックスに見つかりません（${missingSkillNames
              .slice(0, 3)
              .join(
                ", ",
              )}${missingSkillNames.length > 3 ? "..." : ""}）。インデックスを更新しますか？`
          : `${missingSkillNames.length} skill(s) not found in index (${missingSkillNames
              .slice(0, 3)
              .join(
                ", ",
              )}${missingSkillNames.length > 3 ? "..." : ""}). Update index now?`,
      isJapanese() ? "更新する" : "Update",
      isJapanese() ? "スキップ" : "Skip",
    );

    if (tryUpdate !== (isJapanese() ? "更新する" : "Update")) {
      return index;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: affectedSource
          ? messages.updatingSource(affectedSource.name || affectedSourceId!)
          : isJapanese()
            ? "インデックスを更新中..."
            : "Updating index...",
      },
      async (progress) => {
        index = affectedSourceId
          ? await updateIndexFromSingleSource(
              context,
              index,
              affectedSourceId,
              progress,
            )
          : await updateIndexFromSources(context, index, progress);
      },
    );

    return index;
  }

  async function updateInstructionFilesForRoots(
    roots: SkillRoot[],
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration("skillNinja");
    if (!config.get<boolean>("autoUpdateInstruction")) {
      return;
    }

    const uniqueRoots = new Map<string, SkillRoot>();
    for (const root of roots) {
      uniqueRoots.set(root.rootPath, root);
    }

    for (const root of uniqueRoots.values()) {
      await updateInstructionFileForRoot(root, context);
    }

    const rememberedPaths = uniqueInstructionPaths(
      [...uniqueRoots.values()].flatMap((root) =>
        root.instructionUri ? [root.instructionUri.fsPath] : [],
      ),
    );
    if (rememberedPaths.length > 0) {
      await context.workspaceState.update(
        LAST_MANAGED_INSTRUCTION_PATHS_KEY,
        rememberedPaths,
      );
    }
  }

  async function getReinstallableEntriesForRoot(root: SkillRoot) {
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (!wsFolder) {
      return [];
    }

    const installedMeta = await getInstalledSkillsWithMeta(
      wsFolder.uri,
      root.rootUri,
    );

    return installedMeta
      .map((meta) => ({ root, meta }))
      .filter((entry) => shouldCheckManagedInstalledSkillAgainstIndex(entry));
  }

  if (workspaceFolder) {
    cleanupStaleStoredInstructionPaths(workspaceFolder.uri).catch((err) => {
      console.error(
        "[Skill Ninja] Failed to clean stale instruction files:",
        err,
      );
    });
  }

  async function findManagedRootForSkillFile(
    workspaceUri: vscode.Uri,
    skillFileUri: vscode.Uri,
  ): Promise<SkillRoot | undefined> {
    const managedRoots = await getManagedRootsForWorkspace(workspaceUri);
    return managedRoots.find((root) =>
      isInsidePath(root.rootPath, skillFileUri.fsPath),
    );
  }

  async function pickManagedRoot(
    workspaceUri: vscode.Uri,
    placeHolder: string,
  ): Promise<SkillRoot | undefined> {
    const roots = await getManagedRootsForWorkspace(workspaceUri);
    if (roots.length === 0) {
      return undefined;
    }
    if (roots.length === 1) {
      return roots[0];
    }

    const selection = await vscode.window.showQuickPick(
      roots.map((root) => ({
        label: getSkillRootGroupLabel(root),
        description: root.displayPath,
        detail: root.instructionPath,
        root,
      })),
      {
        placeHolder,
      },
    );

    return selection?.root;
  }

  async function resolvePreferredManagedRoot(
    workspaceUri: vscode.Uri,
    preferredScope: "workspace" | "userGlobal",
  ): Promise<SkillRoot | undefined> {
    const roots = await getManagedRootsForWorkspace(workspaceUri);
    if (preferredScope === "workspace") {
      return roots.find((root) => root.scope === "workspace");
    }

    const userGlobalRoots = roots.filter((root) => root.scope === "userGlobal");
    if (userGlobalRoots.length === 0) {
      return undefined;
    }

    const scoreUserGlobalRoot = (root: SkillRoot): number => {
      const normalizedRootPath = root.rootPath
        .replace(/\\/g, "/")
        .toLowerCase();
      const normalizedInstructionPath = (root.instructionPath || "")
        .replace(/\\/g, "/")
        .toLowerCase();

      if (normalizedRootPath.includes("/appdata/roaming/code/user/")) {
        return 0;
      }
      if (normalizedInstructionPath.endsWith("/.copilot/instructions.md")) {
        return 1;
      }
      if (normalizedRootPath.endsWith("/.copilot/skills")) {
        return 2;
      }
      if (normalizedRootPath.endsWith("/.claude/skills")) {
        return 3;
      }
      if (normalizedRootPath.endsWith("/.agents/skills")) {
        return 4;
      }
      return 10;
    };

    return userGlobalRoots
      .slice()
      .sort(
        (left, right) => scoreUserGlobalRoot(left) - scoreUserGlobalRoot(right),
      )[0];
  }

  async function openManagedOutputForRoot(
    targetRoot: SkillRoot,
  ): Promise<void> {
    if (!targetRoot.instructionUri || !targetRoot.instructionPath) {
      return;
    }

    const instructionUri = targetRoot.instructionUri;
    const instructionPath = targetRoot.instructionPath;
    let fileUri = instructionUri;
    let openedTarget: "instruction" | "catalog" = "instruction";

    const describeError = (error: unknown): string => {
      if (error instanceof Error && error.message) {
        return error.message;
      }
      return String(error);
    };

    const isFileNotFoundError = (error: unknown): boolean => {
      if (error instanceof vscode.FileSystemError) {
        return error.code === "FileNotFound";
      }
      const candidate = error as
        | { code?: string; message?: string }
        | undefined;
      return (
        candidate?.code === "FileNotFound" ||
        candidate?.message?.includes("FileNotFound") === true
      );
    };

    const reportOpenFailure = (
      label: "instruction" | "catalog",
      uri: vscode.Uri,
      error: unknown,
    ): void => {
      console.warn(
        `[Skill Ninja] Failed to open ${label}: ${uri.fsPath}`,
        error,
      );
    };

    const targetLabel = (label: "instruction" | "catalog"): string =>
      isJapanese()
        ? label === "catalog"
          ? "Ref catalog"
          : "インストラクションファイル"
        : label;

    const { format } = await resolveOutputFormat(workspaceFolder!.uri);
    if (format === "ref") {
      const config = vscode.workspace.getConfiguration("skillNinja");
      const configuredCatalogPath =
        config.get<string>("refCatalogPath") || ".github/skills/README.md";
      const instructionDirUri = vscode.Uri.file(
        path.dirname(instructionUri.fsPath),
      );
      const catalogUri =
        (targetRoot.scope === "workspace"
          ? resolveConfiguredPathToUri(
              configuredCatalogPath,
              workspaceFolder!.uri,
            )
          : resolveConfiguredPathToUri(configuredCatalogPath)) ||
        vscode.Uri.joinPath(instructionDirUri, configuredCatalogPath);
      fileUri = catalogUri;
      openedTarget = "catalog";
    }

    const tryOpen = async (
      uri: vscode.Uri,
    ): Promise<{ opened: boolean; missing: boolean; error?: unknown }> => {
      try {
        await vscode.workspace.fs.stat(uri);
      } catch (error) {
        if (isFileNotFoundError(error)) {
          return { opened: false, missing: true };
        }
        return { opened: false, missing: false, error };
      }

      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
        return { opened: true, missing: false };
      } catch (error) {
        return { opened: false, missing: false, error };
      }
    };

    const firstOpenAttempt = await tryOpen(fileUri);
    if (firstOpenAttempt.opened) {
      return;
    }

    if (firstOpenAttempt.error) {
      reportOpenFailure(openedTarget, fileUri, firstOpenAttempt.error);
      vscode.window.showWarningMessage(
        isJapanese()
          ? `設定された${targetLabel(openedTarget)}を開けませんでした: ${describeError(firstOpenAttempt.error)}`
          : `The configured ${openedTarget} could not be opened: ${describeError(firstOpenAttempt.error)}`,
      );
      return;
    }

    try {
      await updateInstructionFileForRoot(targetRoot, context);
    } catch (error) {
      console.warn(
        `[Skill Ninja] Failed to regenerate managed output for ${instructionPath}`,
        error,
      );
    }

    const regeneratedOpenAttempt = await tryOpen(fileUri);
    if (regeneratedOpenAttempt.opened) {
      return;
    }

    if (regeneratedOpenAttempt.error) {
      reportOpenFailure(openedTarget, fileUri, regeneratedOpenAttempt.error);
      vscode.window.showWarningMessage(
        isJapanese()
          ? `再生成後も${targetLabel(openedTarget)}を開けませんでした: ${describeError(regeneratedOpenAttempt.error)}`
          : `The ${openedTarget} still could not be opened after regeneration: ${describeError(regeneratedOpenAttempt.error)}`,
      );
      return;
    }

    if (openedTarget === "catalog") {
      const instructionFallbackAttempt = await tryOpen(instructionUri);
      if (instructionFallbackAttempt.opened) {
        vscode.window.showInformationMessage(
          isJapanese()
            ? "Ref catalog がまだ生成されていなかったため、インストラクションファイルを開きました。"
            : "The Ref catalog was not available yet, so the instruction file was opened instead.",
        );
        return;
      }
      if (instructionFallbackAttempt.error) {
        reportOpenFailure(
          "instruction",
          instructionUri,
          instructionFallbackAttempt.error,
        );
        vscode.window.showWarningMessage(
          isJapanese()
            ? `Ref catalog もインストラクションファイルも開けませんでした: ${describeError(instructionFallbackAttempt.error)}`
            : `Neither the Ref catalog nor the instruction file could be opened: ${describeError(instructionFallbackAttempt.error)}`,
        );
        return;
      }
    }

    const create = await vscode.window.showInformationMessage(
      isJapanese()
        ? `${instructionPath} が見つかりません。作成しますか？`
        : `${instructionPath} was not found. Create it now?`,
      isJapanese() ? "作成" : "Create",
      isJapanese() ? "キャンセル" : "Cancel",
    );
    if (create === (isJapanese() ? "作成" : "Create")) {
      await vscode.workspace.fs.writeFile(
        instructionUri,
        Buffer.from("# Agent Skills\n\n"),
      );
      const doc = await vscode.workspace.openTextDocument(instructionUri);
      await vscode.window.showTextDocument(doc);
    }
  }

  async function openManagedOutputForPreferredScope(
    preferredScope: "workspace" | "userGlobal",
    selectedRoot?: SkillRoot,
  ): Promise<void> {
    if (!workspaceFolder) {
      vscode.window.showErrorMessage(messages.noWorkspace());
      return;
    }

    const scopedSelection =
      selectedRoot && selectedRoot.scope === preferredScope
        ? selectedRoot
        : undefined;
    const targetRoot =
      scopedSelection ||
      (await resolvePreferredManagedRoot(workspaceFolder.uri, preferredScope));

    if (!targetRoot) {
      vscode.window.showInformationMessage(
        preferredScope === "workspace"
          ? isJapanese()
            ? "開けるワークスペース スキル出力が見つかりません。"
            : "No workspace skill output is available to open."
          : isJapanese()
            ? "開けるユーザー / グローバル スキル出力が見つかりません。"
            : "No user/global skill output is available to open.",
      );
      return;
    }

    await openManagedOutputForRoot(targetRoot);
  }

  async function resolveInstallTargetRoot(
    workspaceUri: vscode.Uri,
  ): Promise<SkillRoot | undefined> {
    return pickManagedRoot(
      workspaceUri,
      isJapanese()
        ? "インストール先のスキルルートを選択"
        : "Select the target skill root",
    );
  }

  async function resolveDefaultInstallTargetRoot(
    workspaceUri: vscode.Uri,
  ): Promise<SkillRoot | undefined> {
    const roots = await getManagedRootsForWorkspace(workspaceUri);
    if (roots.length === 0) {
      return undefined;
    }

    return roots.find((root) => root.scope === "workspace") || roots[0];
  }

  const getSkillRootFromItem = getSkillRootFromTreeItem;

  const installedTreeView = vscode.window.createTreeView(
    "skillNinja.installedView",
    {
      treeDataProvider: workspaceProvider,
      showCollapseAll: false,
    },
  );

  const userGlobalTreeView = vscode.window.createTreeView(
    "skillNinja.userGlobalView",
    {
      treeDataProvider: userGlobalProvider,
      showCollapseAll: true,
    },
  );

  const browseTreeView = vscode.window.createTreeView("skillNinja.browseView", {
    treeDataProvider: browseProvider,
    showCollapseAll: true,
  });

  // ダブルクリックでインストール機能
  let lastClickTime = 0;
  let lastClickedItem: string | undefined;

  // ダブルクリック検出用コマンド
  const doubleClickCmd = vscode.commands.registerCommand(
    "skillNinja.onSkillClick",
    async (skill: Skill) => {
      if (!skill) return;

      // インストール済みの場合は無視
      if (browseProvider.isSkillInstalled(skill.name)) return;

      const now = Date.now();
      const itemId = `${skill.source}/${skill.name}`;

      // 同じアイテムを500ms以内にクリック → ダブルクリック
      if (lastClickedItem === itemId && now - lastClickTime < 500) {
        const wsFolder = vscode.workspace.workspaceFolders?.[0];
        const defaultTargetRoot = wsFolder
          ? await resolveDefaultInstallTargetRoot(wsFolder.uri)
          : undefined;
        await vscode.commands.executeCommand(
          "skillNinja.install",
          skill,
          defaultTargetRoot,
        );
        lastClickTime = 0;
        lastClickedItem = undefined;
      } else {
        lastClickTime = now;
        lastClickedItem = itemId;
      }
    },
  );

  // 設定変更を監視してビューをリフレッシュ
  const configWatcher = vscode.workspace.onDidChangeConfiguration(async (e) => {
    if (e.affectsConfiguration("skillNinja.language")) {
      // 言語設定が変わったらインデックスを再読み込みしてツリービューをリフレッシュ
      // バンドル版の description_ja を反映させるため
      skillIndex = await loadSkillIndex(context);
      refreshAllViews();
    }

    if (e.affectsConfiguration("skillNinja.useSharedSourcesManifest")) {
      skillIndex = await loadSkillIndex(context);
      refreshAllViews();
    }

    if (
      e.affectsConfiguration("skillNinja.skillsDirectory") ||
      e.affectsConfiguration("skillNinja.useVsCodeAgentSkillLocations") ||
      e.affectsConfiguration("skillNinja.showBuiltInSkills")
    ) {
      refreshAllViews();
    }

    // インストラクションファイルまたは出力フォーマット関連設定が変更されたら自動更新
    if (
      e.affectsConfiguration("skillNinja.instructionFile") ||
      e.affectsConfiguration("skillNinja.customInstructionPath") ||
      e.affectsConfiguration("skillNinja.outputFormat") ||
      e.affectsConfiguration("skillNinja.refCatalogPath") ||
      e.affectsConfiguration("skillNinja.refCatalogFormat")
    ) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        const config = vscode.workspace.getConfiguration("skillNinja");
        const autoUpdate =
          config.get<boolean>("autoUpdateInstruction") !== false;

        if (autoUpdate) {
          // インストラクションファイルが変更された場合は古いファイルから削除
          if (
            e.affectsConfiguration("skillNinja.instructionFile") ||
            e.affectsConfiguration("skillNinja.customInstructionPath")
          ) {
            const ownership = await getEffectiveOwnership(context);
            const keepShared =
              vscode.workspace
                .getConfiguration("skillNinja")
                .get<string>("coexistenceMode") !== "independent" &&
              ownership.owner === "sibling";

            // 古いファイルパスを使ってスキルセクションを削除
            // （変更前の値は取得できないので、全ての候補ファイルから削除を試みる）
            const candidateFiles = [
              "AGENTS.md",
              ".github/copilot-instructions.md",
              ".github/instructions/SkillList.instructions.md",
              "CLAUDE.md",
              ".cursor/rules/skills.mdc",
              ".windsurfrules",
              ".clinerules",
            ];
            await cleanupInstructionFiles(
              [
                ...candidateFiles.map(
                  (file) =>
                    vscode.Uri.joinPath(workspaceFolders[0].uri, file).fsPath,
                ),
                ...getStoredManagedInstructionPaths(),
              ],
              keepShared,
            );
          }

          // 少し待ってから更新（設定が完全に反映されるのを待つ）
          setTimeout(async () => {
            try {
              await updateAllInstructionFiles(workspaceFolders[0].uri, context);
              await rememberCurrentManagedInstructionPaths(
                workspaceFolders[0].uri,
              );
              vscode.window.showInformationMessage(
                messages.instructionFileUpdatedOnSettingChange(),
              );
            } catch (err) {
              console.error(
                "Failed to update instruction file on setting change:",
                err,
              );
            }
          }, 500);
        }
      }
    }
  });

  // GitHub Copilot Chat Participant
  createChatParticipant(context);

  // MCP Tools for Language Model API
  registerMcpTools(context);

  // Command: Refresh
  const refreshCmd = vscode.commands.registerCommand(
    "skillNinja.refresh",
    () => {
      refreshAllViews();
    },
  );

  // Command: Refresh Local
  const refreshLocalCmd = vscode.commands.registerCommand(
    "skillNinja.refreshLocal",
    () => {
      refreshInstalledViews();
    },
  );

  // Command: Open SKILL.md
  const openSkillFileCmd = vscode.commands.registerCommand(
    "skillNinja.openSkillFile",
    async (item: SkillTreeItem) => {
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const skill = item.skill as Skill & {
        fullPath?: string;
        isLocal?: boolean;
      };
      if (skill?.fullPath) {
        try {
          await vscode.window.showTextDocument(vscode.Uri.file(skill.fullPath));
          return;
        } catch (error) {
          console.warn(
            `[Skill Ninja] Failed to open local skill file directly: ${skill.fullPath}`,
            error,
          );
        }
      }

      const skillName = (item.label as string).replace(/^[✓○]\s*/, "");
      const skillRootUri =
        getSkillRootFromItem(item)?.rootUri ||
        resolveWorkspaceSkillsRootUri(workspaceFolder.uri);
      const skillPath = vscode.Uri.joinPath(
        skillRootUri,
        skillName,
        "SKILL.md",
      );

      try {
        await vscode.window.showTextDocument(skillPath);
      } catch (error) {
        console.warn(
          `[Skill Ninja] Failed to open skill file: ${skillPath.fsPath}`,
          error,
        );
        vscode.window.showWarningMessage(messages.skillNotFound(skillName));
      }
    },
  );

  // Command: Open skill folder
  const openSkillFolderCmd = vscode.commands.registerCommand(
    "skillNinja.openSkillFolder",
    async (item: SkillTreeItem) => {
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      // ローカルスキルの場合は fullPath からフォルダパスを取得
      const skill = item.skill as Skill & {
        fullPath?: string;
        isLocal?: boolean;
      };
      if (skill?.fullPath) {
        const folderPath = skill.fullPath.replace(/[/\\]SKILL\.md$/i, "");
        await vscode.commands.executeCommand(
          "revealFileInOS",
          vscode.Uri.file(folderPath),
        );
        return;
      }

      // インストール済みスキル（.github/skills 配下）の場合
      // ラベルからステータスアイコンを削除してスキル名を取得
      const skillName = (item.label as string).replace(/^[✓○]\s*/, "");
      const skillRootUri =
        getSkillRootFromItem(item)?.rootUri ||
        resolveWorkspaceSkillsRootUri(workspaceFolder.uri);

      const folderPath = vscode.Uri.joinPath(skillRootUri, skillName);

      await vscode.commands.executeCommand("revealFileInOS", folderPath);
    },
  );

  // Command: Edit "When to Use" description
  const editWhenToUseCmd = vscode.commands.registerCommand(
    "skillNinja.editWhenToUse",
    async (item: SkillTreeItem) => {
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const skill = item.skill;
      if (!skill?.name) {
        return;
      }
      const config = vscode.workspace.getConfiguration("skillNinja");
      const skillAny = skill as unknown as Record<string, unknown>;
      const skillRoot = getSkillRootFromItem(item);

      if (!skillRoot || skillRoot.isReadOnly) {
        vscode.window.showErrorMessage(
          isJapanese()
            ? "このスキルは説明を編集できません"
            : "This skill description cannot be edited.",
        );
        return;
      }

      const explicitSkillDir = skillAny.skillDirUri as vscode.Uri | undefined;
      const fullPath = skillAny.fullPath as string | undefined;
      const skillDirUri =
        explicitSkillDir ||
        (fullPath
          ? vscode.Uri.file(fullPath.replace(/[/\\]SKILL\.md$/i, ""))
          : undefined);

      if (!skillDirUri) {
        return;
      }

      // メタデータファイルのパス
      const metaPath = vscode.Uri.joinPath(skillDirUri, ".skill-meta.json");

      // SKILL.md のパス
      const skillMdPath = vscode.Uri.joinPath(skillDirUri, "SKILL.md");

      // 既存のメタデータを読み込む（なければ生成）
      let meta: {
        name: string;
        source: string;
        description: string;
        description_ja?: string;
        whenToUse?: string;
        customWhenToUse?: string;
        categories: string[];
        installedAt: string;
      };
      try {
        const content = await vscode.workspace.fs.readFile(metaPath);
        meta = JSON.parse(Buffer.from(content).toString("utf-8"));
      } catch {
        // メタデータがない場合は SKILL.md から生成
        try {
          const skillMdContent =
            await vscode.workspace.fs.readFile(skillMdPath);
          const text = Buffer.from(skillMdContent).toString("utf-8");

          // frontmatter から description を抽出
          let description = "";
          const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---/);
          if (frontmatterMatch) {
            const descMatch = frontmatterMatch[1].match(
              /^description:\s*["']?([^"'\n]+)["']?/m,
            );
            if (descMatch) {
              description = descMatch[1].trim();
            }
          }

          meta = {
            name: skill.name,
            source: "local",
            description: description,
            categories: [],
            installedAt: new Date().toISOString(),
          };
        } catch {
          vscode.window.showErrorMessage(
            isJapanese()
              ? "スキルファイルが見つかりません"
              : "Skill file not found",
          );
          return;
        }
      }

      // 現在の値を取得（カスタム > whenToUse > description）
      const currentValue =
        meta.customWhenToUse || meta.whenToUse || meta.description || "";

      // 入力ダイアログを表示
      const newValue = await vscode.window.showInputBox({
        title: isJapanese()
          ? `${skill.name} の説明を編集`
          : `Edit description for ${skill.name}`,
        prompt: isJapanese()
          ? "AGENTS.md に表示される説明文を入力してください（空にするとデフォルトに戻ります）"
          : "Enter the description shown in AGENTS.md (leave empty to reset to default)",
        value: currentValue,
        placeHolder: isJapanese()
          ? "例: エージェントワークフローの設計・レビュー・改善"
          : "e.g., Design, review, and improve agent workflows",
      });

      // キャンセルされた場合
      if (newValue === undefined) {
        return;
      }

      // メタデータを更新
      if (newValue.trim() === "") {
        // 空の場合はカスタム値を削除
        delete meta.customWhenToUse;
      } else {
        meta.customWhenToUse = newValue.trim();
      }

      // 保存
      await vscode.workspace.fs.writeFile(
        metaPath,
        Buffer.from(JSON.stringify(meta, null, 2), "utf-8"),
      );

      // AGENTS.md を更新
      if (config.get<boolean>("autoUpdateInstruction")) {
        await updateInstructionFileForRoot(skillRoot, context);
      }

      vscode.window.showInformationMessage(
        isJapanese()
          ? `${skill.name} の説明を更新しました`
          : `Updated description for ${skill.name}`,
      );

      refreshInstalledViews();
    },
  );

  // Command: Search skills
  const searchCmd = vscode.commands.registerCommand(
    "skillNinja.search",
    async () => {
      if (!skillIndex) {
        skillIndex = await loadSkillIndex(context);
      }

      const quickPick = vscode.window.createQuickPick<SkillQuickPickItem>();
      quickPick.matchOnDescription = true;
      quickPick.matchOnDetail = true;

      const updateSearchQuickPick = (value: string): void => {
        const result = searchSkills(skillIndex!, value);
        quickPick.items = result.items;
        quickPick.placeholder = result.truncated
          ? value.trim()
            ? `${messages.searchPlaceholder()} ${messages.searchResultsLimited(MAX_SEARCH_RESULTS, result.totalMatches)}`
            : `${messages.searchPlaceholder()} ${messages.browseResultsLimited(MAX_SEARCH_RESULTS)}`
          : messages.searchPlaceholder();
      };

      updateSearchQuickPick("");

      quickPick.onDidChangeValue((value) => {
        updateSearchQuickPick(value);
      });

      quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0];
        if (selected) {
          quickPick.hide();

          // アクションメニューを表示
          const action = await vscode.window.showQuickPick(
            [
              { label: `$(add) ${messages.actionInstall()}`, value: "install" },
              { label: `$(eye) ${messages.actionPreview()}`, value: "preview" },
              {
                label: `$(star) ${messages.addToFavorites()}`,
                value: "favorite",
              },
              {
                label: `$(link-external) ${messages.openOnGitHub()}`,
                value: "github",
              },
              { label: `$(close) ${messages.actionCancel()}`, value: "cancel" },
            ],
            {
              placeHolder: `${selected.skill.name}: ${
                selected.skill.description || ""
              }`,
            },
          );

          if (action?.value === "install") {
            await vscode.commands.executeCommand(
              "skillNinja.install",
              selected.skill,
            );
          } else if (action?.value === "preview") {
            await showSkillPreview(selected.skill, context);
          } else if (action?.value === "favorite") {
            await vscode.commands.executeCommand(
              "skillNinja.toggleFavorite",
              selected.skill,
            );
          } else if (action?.value === "github") {
            const url = await resolveSkillGitHubUrl(
              selected.skill,
              skillIndex?.sources || [],
            );
            if (url) {
              await vscode.env.openExternal(vscode.Uri.parse(url));
            }
          }
        }
      });

      quickPick.onDidHide(() => quickPick.dispose());
      quickPick.show();
    },
  );

  // Command: Install skill
  const installCmd = vscode.commands.registerCommand(
    "skillNinja.install",
    async (skillOrItem?: any, explicitTargetRoot?: SkillRoot) => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const skill = skillOrItem?.skill || skillOrItem;

      if (!skill && skillIndex) {
        await vscode.commands.executeCommand("skillNinja.search");
        return;
      }

      if (!skill?.name) {
        vscode.window.showErrorMessage(messages.invalidSkillInfo());
        return;
      }

      const targetRoot =
        explicitTargetRoot || (await resolveInstallTargetRoot(wsFolder.uri));
      if (!targetRoot) {
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: messages.installing(skill.name),
          },
          async () => {
            await installSkill(skill, wsFolder.uri, context, targetRoot);

            const config = vscode.workspace.getConfiguration("skillNinja");
            if (config.get<boolean>("autoUpdateInstruction")) {
              await updateInstructionFileForRoot(targetRoot, context);
            }
          },
        );

        // 🆕 バッジを一時表示
        markRecentlyInstalled(skill);

        // ステータスバーに表示
        statusBarItem.text = `$(check) ${skill.name} ${
          isJapanese() ? "インストール完了" : "installed"
        }`;
        statusBarItem.show();
        setTimeout(() => statusBarItem.hide(), 4000);

        vscode.window.showInformationMessage(
          messages.installSuccess(skill.name),
        );
        refreshAllViews();

        // ツリービューでスキルを選択状態にする
        const targetProvider =
          targetRoot.scope === "workspace"
            ? workspaceProvider
            : userGlobalProvider;
        const targetTreeView =
          targetRoot.scope === "workspace"
            ? installedTreeView
            : userGlobalTreeView;
        const groups = await targetProvider.getChildren();
        for (const group of groups) {
          const items = await targetProvider.getChildren(group);
          const installedItem = items.find((treeItem) => {
            const root = getSkillRootFromItem(treeItem);
            return (
              treeItem.skill?.name === skill.name &&
              root?.rootPath === targetRoot.rootPath
            );
          });
          if (installedItem) {
            await targetTreeView.reveal(installedItem, {
              select: true,
              focus: true,
            });
            break;
          }
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes("rate limit") ||
          errorMessage.includes("403") ||
          errorMessage.includes("authentication")
        ) {
          await showAuthHelp();
        } else {
          vscode.window.showErrorMessage(messages.installFailed(errorMessage));
        }
      }
    },
  );

  // Command: Uninstall skill
  const uninstallCmd = vscode.commands.registerCommand(
    "skillNinja.uninstall",
    async (item?: SkillTreeItem) => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      let skillName: string | undefined;
      let relativePath: string | undefined;
      let targetRoot: SkillRoot | undefined;

      if (item && item.skill) {
        // ツリーアイテムからスキル情報を取得
        skillName = item.skill.name;
        const skillAny = item.skill as unknown as Record<string, unknown>;
        relativePath = (skillAny.relativePath || skillAny.path) as
          | string
          | undefined;
        targetRoot = getSkillRootFromItem(item);
      } else if (item && item.label) {
        // ラベルからステータスアイコンを除去してスキル名を取得
        skillName = (item.label as string).replace(/^(?:🆕\s*)?[✓○]\s*/, "");
      } else {
        const managedRoots = await getManagedRootsForWorkspace(wsFolder.uri);
        const installedChoices: Array<{
          label: string;
          description: string;
          root: SkillRoot;
          relativePath?: string;
        }> = [];

        for (const root of managedRoots) {
          const installedMeta = await getInstalledSkillsWithMeta(
            wsFolder.uri,
            root.rootUri,
          );
          installedMeta.forEach((meta) => {
            installedChoices.push({
              label: meta.name,
              description: root.displayPath,
              root,
              relativePath: meta.relativePath,
            });
          });
        }

        if (installedChoices.length === 0) {
          vscode.window.showInformationMessage(messages.noInstalledSkills());
          return;
        }

        const selected = await vscode.window.showQuickPick(installedChoices, {
          placeHolder: messages.selectSkillToUninstall(),
        });
        skillName = selected?.label;
        relativePath = selected?.relativePath;
        targetRoot = selected?.root;
      }

      if (skillName) {
        try {
          // relativePath がある場合はそれを使って削除（より確実）
          if (relativePath) {
            await uninstallSkillByPath(
              relativePath,
              wsFolder.uri,
              targetRoot?.rootUri,
            );
          } else {
            await uninstallSkill(skillName, wsFolder.uri, targetRoot?.rootUri);
          }

          const config = vscode.workspace.getConfiguration("skillNinja");
          if (config.get<boolean>("autoUpdateInstruction")) {
            if (targetRoot) {
              await updateInstructionFileForRoot(targetRoot, context);
            } else {
              await updateAllInstructionFiles(wsFolder.uri, context);
            }
          }

          vscode.window.showInformationMessage(
            messages.uninstallSuccess(skillName),
          );
          refreshAllViews();
        } catch (error) {
          vscode.window.showErrorMessage(
            messages.uninstallFailed(String(error)),
          );
        }
      }
    },
  );

  // Command: Reinstall all skills
  const reinstallAllCmd = vscode.commands.registerCommand(
    "skillNinja.reinstallAll",
    async () => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const installedEntries = await getManagedInstalledEntries(wsFolder.uri);
      if (installedEntries.length === 0) {
        vscode.window.showInformationMessage(messages.noInstalledSkills());
        return;
      }

      const reinstallableEntries = installedEntries.filter((entry) =>
        shouldCheckManagedInstalledSkillAgainstIndex(entry),
      );
      const skippedLocalCount =
        installedEntries.length - reinstallableEntries.length;

      if (reinstallableEntries.length === 0) {
        vscode.window.showInformationMessage(
          isJapanese()
            ? "インデックスから再インストールできるリモートスキルはありません。ローカルスキルは対象外です。"
            : "No remote-index skills can be reinstalled. Local skills are excluded.",
        );
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        isJapanese()
          ? `${reinstallableEntries.length} 個のスキルを再インストールしますか？${
              skippedLocalCount > 0
                ? `（ローカルスキル ${skippedLocalCount} 個は対象外）`
                : ""
            }`
          : `Reinstall ${reinstallableEntries.length} skills?${
              skippedLocalCount > 0
                ? ` (${skippedLocalCount} local skill(s) excluded)`
                : ""
            }`,
        { modal: true },
        isJapanese() ? "再インストール" : "Reinstall",
      );

      if (!confirm) {
        return;
      }

      let index = await loadSkillIndex(context);

      const missingSkills: string[] = [];
      for (const { meta } of reinstallableEntries) {
        const skill = findIndexedSkillForInstalledMeta(index.skills, meta);
        if (!skill) {
          missingSkills.push(meta.name);
        }
      }

      if (missingSkills.length > 0) {
        index = await refreshIndexForInstalledMetas(
          index,
          reinstallableEntries
            .filter(({ meta }) => missingSkills.includes(meta.name))
            .map(({ meta }) => meta),
        );
      }

      let failed = 0;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? "スキルを再インストール中..."
            : "Reinstalling skills...",
          cancellable: false,
        },
        async (progress) => {
          let completed = 0;
          for (const { root, meta } of reinstallableEntries) {
            progress.report({
              message: `${meta.name} (${completed + 1}/${reinstallableEntries.length})`,
              increment: 100 / reinstallableEntries.length,
            });

            const skill = findIndexedSkillForInstalledMeta(index.skills, meta);

            if (skill) {
              try {
                await uninstallSkillByPath(
                  meta.relativePath || meta.name,
                  wsFolder.uri,
                  root.rootUri,
                );
                await installSkill(skill, wsFolder.uri, context, root);
              } catch (error) {
                console.error(`Failed to reinstall ${meta.name}:`, error);
                failed += 1;
              }
            } else {
              failed += 1;
            }
            completed++;
          }
        },
      );

      await updateInstructionFilesForRoots(
        reinstallableEntries.map((entry) => entry.root),
      );

      refreshAllViews();
      const summary = summarizeBatchOutcome(
        reinstallableEntries.length,
        failed,
      );
      const summarySuffix =
        skippedLocalCount > 0
          ? isJapanese()
            ? `（ローカルスキル ${skippedLocalCount} 個は対象外）`
            : ` (${skippedLocalCount} local skill(s) excluded)`
          : "";
      if (summary.isPartialFailure || summary.isTotalFailure) {
        vscode.window.showWarningMessage(
          isJapanese()
            ? `${summary.succeededCount}/${summary.totalCount} 個のスキルを再インストールしました（${summary.failedCount} 個失敗）${summarySuffix}`
            : `Reinstalled ${summary.succeededCount}/${summary.totalCount} skills (${summary.failedCount} failed)${summarySuffix}`,
        );
      } else {
        vscode.window.showInformationMessage(
          isJapanese()
            ? `${summary.totalCount} 個のスキルを再インストールしました${summarySuffix}`
            : `Reinstalled ${summary.totalCount} skills${summarySuffix}`,
        );
      }
    },
  );

  const reinstallRootCmd = vscode.commands.registerCommand(
    "skillNinja.reinstallRoot",
    async (item?: SkillTreeItem) => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const targetRoot = getSkillRootFromItem(item);
      if (!targetRoot || targetRoot.isReadOnly) {
        vscode.window.showInformationMessage(
          isJapanese()
            ? "このスキルルートでは再インストールできません。"
            : "This skill root cannot reinstall remote skills.",
        );
        return;
      }

      const reinstallableEntries =
        await getReinstallableEntriesForRoot(targetRoot);
      const installedMeta = await getInstalledSkillsWithMeta(
        wsFolder.uri,
        targetRoot.rootUri,
      );
      const skippedLocalCount =
        installedMeta.length - reinstallableEntries.length;

      if (reinstallableEntries.length === 0) {
        vscode.window.showInformationMessage(
          isJapanese()
            ? "このスキルルートには、インデックスから再インストールできるリモートスキルがありません。"
            : "This skill root has no remote-index skills to reinstall.",
        );
        return;
      }

      const rootLabel = getSkillRootGroupLabel(targetRoot);
      const confirm = await vscode.window.showWarningMessage(
        isJapanese()
          ? `${rootLabel} の ${reinstallableEntries.length} 個のリモートスキルを再インストールしますか？${
              skippedLocalCount > 0
                ? `（ローカルスキル ${skippedLocalCount} 個は対象外）`
                : ""
            }`
          : `Reinstall ${reinstallableEntries.length} remote skill(s) in ${rootLabel}?${
              skippedLocalCount > 0
                ? ` (${skippedLocalCount} local skill(s) excluded)`
                : ""
            }`,
        { modal: true },
        isJapanese() ? "再インストール" : "Reinstall",
      );

      if (!confirm) {
        return;
      }

      let index = await loadSkillIndex(context);
      const missingSkills = reinstallableEntries
        .filter(
          ({ meta }) => !findIndexedSkillForInstalledMeta(index.skills, meta),
        )
        .map(({ meta }) => meta.name);

      if (missingSkills.length > 0) {
        index = await refreshIndexForInstalledMetas(
          index,
          reinstallableEntries
            .filter(({ meta }) => missingSkills.includes(meta.name))
            .map(({ meta }) => meta),
        );
      }

      let failed = 0;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? `${rootLabel} のリモートスキルを再インストール中...`
            : `Reinstalling remote skills in ${rootLabel}...`,
          cancellable: false,
        },
        async (progress) => {
          let completed = 0;
          for (const { root, meta } of reinstallableEntries) {
            progress.report({
              message: `${meta.name} (${completed + 1}/${reinstallableEntries.length})`,
              increment: 100 / reinstallableEntries.length,
            });

            const skill = findIndexedSkillForInstalledMeta(index.skills, meta);
            if (skill) {
              try {
                await uninstallSkillByPath(
                  meta.relativePath || meta.name,
                  wsFolder.uri,
                  root.rootUri,
                );
                await installSkill(skill, wsFolder.uri, context, root);
                markRecentlyInstalled(skill);
              } catch (error) {
                console.error(
                  `Failed to reinstall ${meta.name} in ${root.rootPath}:`,
                  error,
                );
                failed += 1;
              }
            } else {
              failed += 1;
            }

            completed++;
          }
        },
      );

      await updateInstructionFilesForRoots([targetRoot]);
      refreshAllViews();
      const rootSummary = summarizeBatchOutcome(
        reinstallableEntries.length,
        failed,
      );
      const rootSummarySuffix =
        skippedLocalCount > 0
          ? isJapanese()
            ? `（ローカルスキル ${skippedLocalCount} 個は対象外）`
            : ` (${skippedLocalCount} local skill(s) excluded)`
          : "";
      if (rootSummary.isPartialFailure || rootSummary.isTotalFailure) {
        vscode.window.showWarningMessage(
          isJapanese()
            ? `${rootLabel}: ${rootSummary.succeededCount}/${rootSummary.totalCount} 個のリモートスキルを再インストールしました（${rootSummary.failedCount} 個失敗）${rootSummarySuffix}`
            : `${rootLabel}: reinstalled ${rootSummary.succeededCount}/${rootSummary.totalCount} remote skill(s) (${rootSummary.failedCount} failed)${rootSummarySuffix}`,
        );
      } else {
        vscode.window.showInformationMessage(
          isJapanese()
            ? `${rootLabel} の ${rootSummary.totalCount} 個のリモートスキルを再インストールしました${rootSummarySuffix}`
            : `Reinstalled ${rootSummary.totalCount} remote skill(s) in ${rootLabel}${rootSummarySuffix}`,
        );
      }
    },
  );

  // Command: Reinstall single skill
  const reinstallCmd = vscode.commands.registerCommand(
    "skillNinja.reinstall",
    async (item?: SkillTreeItem) => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      // ツリーアイテムからスキル情報を取得
      const skill = item?.skill;
      if (!skill?.name) {
        vscode.window.showErrorMessage(messages.invalidSkillInfo());
        return;
      }

      const targetRoot = getSkillRootFromItem(item);
      if (!targetRoot) {
        vscode.window.showErrorMessage(
          isJapanese()
            ? "再インストール先のスキルルートを特定できません"
            : "Could not resolve the target skill root for reinstall.",
        );
        return;
      }

      // メタデータからソース情報を取得
      const installedMeta = await getInstalledSkillsWithMeta(
        wsFolder.uri,
        targetRoot.rootUri,
      );
      const meta = installedMeta.find((m) => m.name === skill.name);
      if (!meta) {
        vscode.window.showErrorMessage(
          isJapanese()
            ? `${skill.name} のメタデータが見つかりません`
            : `Metadata not found for ${skill.name}`,
        );
        return;
      }

      // インデックスからスキル情報を取得
      let index = await loadSkillIndex(context);
      if (isLocalInstalledSkillMeta(meta)) {
        vscode.window.showInformationMessage(
          isJapanese()
            ? `${skill.name} はローカルスキルのため、インデックスからの再インストール対象外です。`
            : `${skill.name} is a local skill, so it cannot be reinstalled from the remote index.`,
        );
        return;
      }
      let fullSkill = findIndexedSkillForInstalledMeta(index.skills, meta);

      // インデックスに見つからない場合は自動で更新を試みる
      if (!fullSkill) {
        index = await refreshIndexForInstalledMetas(index, [meta]);

        // 再検索
        fullSkill = findIndexedSkillForInstalledMeta(index.skills, meta);

        if (!fullSkill) {
          vscode.window.showErrorMessage(
            isJapanese()
              ? `${skill.name} がインデックスに見つかりません。ソースリポジトリを確認してください。`
              : `${skill.name} not found in index. Please check source repositories.`,
          );
          return;
        }
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: isJapanese()
              ? `${skill.name} を再インストール中...`
              : `Reinstalling ${skill.name}...`,
          },
          async () => {
            await uninstallSkillByPath(
              meta.relativePath || skill.name,
              wsFolder.uri,
              targetRoot.rootUri,
            );
            await installSkill(fullSkill, wsFolder.uri, context, targetRoot);

            const config = vscode.workspace.getConfiguration("skillNinja");
            if (config.get<boolean>("autoUpdateInstruction")) {
              await updateInstructionFileForRoot(targetRoot, context);
            }
          },
        );

        // 🆕 バッジを一時表示
        markRecentlyInstalled(skill);

        // ステータスバーに表示
        statusBarItem.text = `$(sync) ${skill.name} ${
          isJapanese() ? "再インストール完了" : "reinstalled"
        }`;
        statusBarItem.show();
        setTimeout(() => statusBarItem.hide(), 4000);

        vscode.window.showInformationMessage(
          isJapanese()
            ? `${skill.name} を再インストールしました`
            : `Reinstalled ${skill.name}`,
        );
        refreshAllViews();
      } catch (error) {
        vscode.window.showErrorMessage(
          isJapanese()
            ? `再インストール失敗: ${String(error)}`
            : `Reinstall failed: ${String(error)}`,
        );
      }
    },
  );

  // Command: Uninstall all skills (with warning)
  const uninstallAllCmd = vscode.commands.registerCommand(
    "skillNinja.uninstallAll",
    async () => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const installedEntries = await getManagedInstalledEntries(wsFolder.uri);
      if (installedEntries.length === 0) {
        vscode.window.showInformationMessage(messages.noInstalledSkills());
        return;
      }

      // 2段階確認
      const confirm1 = await vscode.window.showWarningMessage(
        isJapanese()
          ? `⚠️ ${installedEntries.length} 個のスキルを全て削除しますか？`
          : `⚠️ Delete all ${installedEntries.length} skills?`,
        { modal: true },
        isJapanese() ? "続ける" : "Continue",
      );

      if (!confirm1) {
        return;
      }

      const confirm2 = await vscode.window.showWarningMessage(
        isJapanese()
          ? `本当に全てのスキルを削除しますか？この操作は元に戻せません。`
          : `Are you sure you want to delete ALL skills? This cannot be undone.`,
        { modal: true },
        isJapanese() ? "全て削除" : "Delete All",
      );

      if (!confirm2) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? "全スキルを削除中..."
            : "Deleting all skills...",
          cancellable: false,
        },
        async (progress) => {
          let completed = 0;
          for (const { root, meta } of installedEntries) {
            progress.report({
              message: `${meta.name} (${completed + 1}/${installedEntries.length})`,
              increment: 100 / installedEntries.length,
            });
            try {
              await uninstallSkillByPath(
                meta.relativePath || meta.name,
                wsFolder.uri,
                root.rootUri,
              );
            } catch (error) {
              console.error(`Failed to uninstall ${meta.name}:`, error);
            }
            completed++;
          }
        },
      );

      await updateInstructionFilesForRoots(
        installedEntries.map((entry) => entry.root),
      );

      refreshAllViews();
      vscode.window.showInformationMessage(
        isJapanese()
          ? `${installedEntries.length} 個のスキルを削除しました`
          : `Deleted ${installedEntries.length} skills`,
      );
    },
  );

  // Command: Install Bundle (全スキル一括インストール)
  const installBundleCmd = vscode.commands.registerCommand(
    "skillNinja.installBundle",
    async (item?: SkillTreeItem) => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const bundle = item?.bundle;
      if (!bundle) {
        vscode.window.showErrorMessage(
          isJapanese() ? "バンドル情報がありません" : "No bundle information",
        );
        return;
      }

      const index = await loadSkillIndex(context);

      // インストール順序を決定（installOrderがあればそれを使用、なければskills配列）
      const installOrder = bundle.installOrder || bundle.skills;

      // 確認ダイアログ
      const confirm = await vscode.window.showInformationMessage(
        isJapanese()
          ? `「${bundle.name}」の ${installOrder.length} 個のスキルをインストールしますか？`
          : `Install ${installOrder.length} skills from "${bundle.name}"?`,
        { modal: true },
        isJapanese() ? "インストール" : "Install",
      );

      if (!confirm) {
        return;
      }

      const targetRoot = await resolveInstallTargetRoot(wsFolder.uri);
      if (!targetRoot) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? `${bundle.name} をインストール中...`
            : `Installing ${bundle.name}...`,
          cancellable: false,
        },
        async (progress) => {
          let completed = 0;
          let failed = 0;

          for (const skillName of installOrder) {
            progress.report({
              message: `${skillName} (${completed + 1}/${installOrder.length})`,
              increment: 100 / installOrder.length,
            });

            // スキルを検索
            const skill = index.skills.find(
              (s: Skill) => s.name === skillName && s.source === bundle.source,
            );

            if (skill) {
              try {
                await installSkill(skill, wsFolder.uri, context, targetRoot);
                markRecentlyInstalled(skill);
              } catch (error) {
                console.error(`Failed to install ${skillName}:`, error);
                failed++;
              }
            } else {
              console.warn(`Skill not found in index: ${skillName}`);
              failed++;
            }
            completed++;
          }

          // 結果を表示
          if (failed > 0) {
            vscode.window.showWarningMessage(
              isJapanese()
                ? `${bundle.name}: ${completed - failed}/${
                    installOrder.length
                  } 個インストール完了（${failed} 個失敗）`
                : `${bundle.name}: ${completed - failed}/${
                    installOrder.length
                  } installed (${failed} failed)`,
            );
          } else {
            vscode.window.showInformationMessage(
              isJapanese()
                ? `${bundle.name} のインストール完了（${installOrder.length} 個のスキル）`
                : `${bundle.name} installed (${installOrder.length} skills)`,
            );
          }
        },
      );

      await updateInstructionFilesForRoots([targetRoot]);

      refreshAllViews();
    },
  );

  // Command: Uninstall multiple skills (QuickPick)
  const uninstallMultipleCmd = vscode.commands.registerCommand(
    "skillNinja.uninstallMultiple",
    async () => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const installedEntries = await getManagedInstalledEntries(wsFolder.uri);
      if (installedEntries.length === 0) {
        vscode.window.showInformationMessage(messages.noInstalledSkills());
        return;
      }

      const selected = await vscode.window.showQuickPick(
        installedEntries.map((entry) => ({
          label: entry.meta.name,
          description: entry.root.displayPath,
          detail: entry.meta.relativePath || entry.meta.name,
          picked: false,
          entry,
        })),
        {
          canPickMany: true,
          placeHolder: isJapanese()
            ? "削除するスキルを選択（複数選択可）"
            : "Select skills to uninstall (multiple selection)",
        },
      );

      if (!selected || selected.length === 0) {
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        isJapanese()
          ? `${selected.length} 個のスキルを削除しますか？`
          : `Delete ${selected.length} skills?`,
        { modal: true },
        isJapanese() ? "削除" : "Delete",
      );

      if (!confirm) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese() ? "スキルを削除中..." : "Deleting skills...",
          cancellable: false,
        },
        async (progress) => {
          let completed = 0;
          for (const item of selected) {
            progress.report({
              message: `${item.label} (${completed + 1}/${selected.length})`,
              increment: 100 / selected.length,
            });
            try {
              await uninstallSkillByPath(
                item.entry.meta.relativePath || item.entry.meta.name,
                wsFolder.uri,
                item.entry.root.rootUri,
              );
            } catch (error) {
              console.error(`Failed to uninstall ${item.label}:`, error);
            }
            completed++;
          }
        },
      );

      await updateInstructionFilesForRoots(
        selected.map((item) => item.entry.root),
      );

      refreshAllViews();
      vscode.window.showInformationMessage(
        isJapanese()
          ? `${selected.length} 個のスキルを削除しました`
          : `Deleted ${selected.length} skills`,
      );
    },
  );

  // Command: Reinstall multiple skills (QuickPick)
  const reinstallMultipleCmd = vscode.commands.registerCommand(
    "skillNinja.reinstallMultiple",
    async () => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const installedEntries = await getManagedInstalledEntries(wsFolder.uri);
      if (installedEntries.length === 0) {
        vscode.window.showInformationMessage(messages.noInstalledSkills());
        return;
      }

      const selected = await vscode.window.showQuickPick(
        installedEntries.map((entry) => ({
          label: entry.meta.name,
          description: entry.root.displayPath,
          detail: entry.meta.source,
          picked: false,
          entry,
        })),
        {
          canPickMany: true,
          placeHolder: isJapanese()
            ? "再インストールするスキルを選択（複数選択可）"
            : "Select skills to reinstall (multiple selection)",
        },
      );

      if (!selected || selected.length === 0) {
        return;
      }

      const reinstallableSelected = selected.filter((item) =>
        shouldCheckManagedInstalledSkillAgainstIndex(item.entry),
      );
      const skippedLocalCount = selected.length - reinstallableSelected.length;

      if (reinstallableSelected.length === 0) {
        vscode.window.showInformationMessage(
          isJapanese()
            ? "選択したスキルはローカルスキルのみのため、インデックスからの再インストール対象外です。"
            : "The selected skills are local only, so they cannot be reinstalled from the remote index.",
        );
        return;
      }

      let index = await loadSkillIndex(context);
      const missingMetas = reinstallableSelected
        .filter(
          (item) =>
            !findIndexedSkillForInstalledMeta(index.skills, item.entry.meta),
        )
        .map((item) => item.entry.meta);

      if (missingMetas.length > 0) {
        index = await refreshIndexForInstalledMetas(index, missingMetas);
      }

      let failed = 0;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? "スキルを再インストール中..."
            : "Reinstalling skills...",
          cancellable: false,
        },
        async (progress) => {
          let completed = 0;
          for (const item of reinstallableSelected) {
            progress.report({
              message: `${item.label} (${completed + 1}/${reinstallableSelected.length})`,
              increment: 100 / reinstallableSelected.length,
            });

            const skill = findIndexedSkillForInstalledMeta(
              index.skills,
              item.entry.meta,
            );

            if (skill) {
              try {
                await uninstallSkillByPath(
                  item.entry.meta.relativePath || item.entry.meta.name,
                  wsFolder.uri,
                  item.entry.root.rootUri,
                );
                await installSkill(
                  skill,
                  wsFolder.uri,
                  context,
                  item.entry.root,
                );
                markRecentlyInstalled(skill);
              } catch (error) {
                console.error(
                  `Failed to reinstall ${item.entry.meta.name}:`,
                  error,
                );
                failed += 1;
              }
            } else {
              failed += 1;
            }
            completed++;
          }
        },
      );

      await updateInstructionFilesForRoots(
        reinstallableSelected.map((item) => item.entry.root),
      );

      refreshAllViews();
      const multiSummary = summarizeBatchOutcome(
        reinstallableSelected.length,
        failed,
      );
      const multiSummarySuffix =
        skippedLocalCount > 0
          ? isJapanese()
            ? `（ローカルスキル ${skippedLocalCount} 個は対象外）`
            : ` (${skippedLocalCount} local skill(s) excluded)`
          : "";
      if (multiSummary.isPartialFailure || multiSummary.isTotalFailure) {
        vscode.window.showWarningMessage(
          isJapanese()
            ? `${multiSummary.succeededCount}/${multiSummary.totalCount} 個のスキルを再インストールしました（${multiSummary.failedCount} 個失敗）${multiSummarySuffix}`
            : `Reinstalled ${multiSummary.succeededCount}/${multiSummary.totalCount} skills (${multiSummary.failedCount} failed)${multiSummarySuffix}`,
        );
      } else {
        vscode.window.showInformationMessage(
          isJapanese()
            ? `${multiSummary.totalCount} 個のスキルを再インストールしました${multiSummarySuffix}`
            : `Reinstalled ${multiSummary.totalCount} skills${multiSummarySuffix}`,
        );
      }
    },
  );

  // Command: Show installed skills
  const showInstalledCmd = vscode.commands.registerCommand(
    "skillNinja.showInstalled",
    async () => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const installedEntries = await getManagedInstalledEntries(wsFolder.uri);
      if (installedEntries.length === 0) {
        vscode.window.showInformationMessage(messages.noInstalledSkills());
        return;
      }

      const selected = await vscode.window.showQuickPick(
        installedEntries.map((entry) => ({
          label: entry.meta.name,
          description: entry.root.displayPath,
          detail: entry.meta.relativePath || entry.meta.name,
          entry,
        })),
        {
          placeHolder: messages.installedSkillsPlaceholder(),
          canPickMany: false,
        },
      );

      if (selected) {
        const skillPath = vscode.Uri.joinPath(
          selected.entry.root.rootUri,
          selected.entry.meta.relativePath || selected.entry.meta.name,
          "SKILL.md",
        );

        try {
          await vscode.window.showTextDocument(skillPath);
        } catch (error) {
          console.warn(
            `[Skill Ninja] Failed to open installed skill file: ${skillPath.fsPath}`,
            error,
          );
          vscode.window.showWarningMessage(
            messages.skillNotFound(selected.label),
          );
        }
      }
    },
  );

  // Command: Update index
  const updateIndexCmd = vscode.commands.registerCommand(
    "skillNinja.updateIndex",
    async () => {
      skillIndex = await getRemoteSourceIndex();

      const oldCount = skillIndex.skills.length;

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: messages.updatingIndex(),
            cancellable: false,
          },
          async (progress) => {
            skillIndex = await updateIndexFromSources(
              context,
              skillIndex!,
              progress,
            );
          },
        );
        const newCount = skillIndex.skills.length;
        const diff = newCount - oldCount;
        const diffText = diff > 0 ? `+${diff}` : diff === 0 ? "±0" : `${diff}`;
        vscode.window.showInformationMessage(
          messages.indexUpdated(oldCount, newCount, diffText),
        );
        browseProvider.refresh();
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes("rate limit") ||
          errorMessage.includes("authentication")
        ) {
          await showAuthHelp();
        } else {
          vscode.window.showErrorMessage(messages.updateFailed(errorMessage));
        }
      }
    },
  );

  // Command: Update single source
  const updateSourceIndexCmd = vscode.commands.registerCommand(
    "skillNinja.updateSourceIndex",
    async (item?: SkillTreeItem) => {
      if (!item || item.contextValue !== "source") {
        vscode.window.showErrorMessage(messages.updateSourceSelectRequired());
        return;
      }

      const sourceId = item.source?.id;
      if (!sourceId) {
        vscode.window.showErrorMessage(messages.sourceIdNotFound());
        return;
      }

      skillIndex = await getRemoteSourceIndex();

      const oldCount = skillIndex.skills.filter(
        (s) => s.source === sourceId,
      ).length;

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: messages.updatingSource(item.source?.name || sourceId),
            cancellable: false,
          },
          async (progress) => {
            skillIndex = await updateIndexFromSingleSource(
              context,
              skillIndex!,
              sourceId,
              progress,
            );
          },
        );
        const newCount = skillIndex.skills.filter(
          (s) => s.source === sourceId,
        ).length;
        const diff = newCount - oldCount;
        const diffText = diff > 0 ? `+${diff}` : diff === 0 ? "±0" : `${diff}`;
        vscode.window.showInformationMessage(
          `Updated ${item.source?.name || sourceId}: ${oldCount} → ${newCount} skills (${diffText})`,
        );
        browseProvider.refresh();
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes("rate limit") ||
          errorMessage.includes("authentication")
        ) {
          await showAuthHelp();
        } else {
          vscode.window.showErrorMessage(messages.updateFailed(errorMessage));
        }
      }
    },
  );

  // Command: Add source
  const addSourceCmd = vscode.commands.registerCommand(
    "skillNinja.addSource",
    async (urlArg?: string | unknown) => {
      const normalizeRepoUrl = (value: string): string | undefined => {
        const trimmed = value.trim();
        if (!trimmed) return undefined;

        if (trimmed.startsWith("http")) {
          return trimmed.match(/github\.com\/[^/]+\/[^/]+/)
            ? normalizeGitHubRepoUrl(trimmed)
            : undefined;
        }

        return trimmed.match(/^[^/]+\/[^/]+$/)
          ? normalizeGitHubRepoUrl(`https://github.com/${trimmed}`)
          : undefined;
      };

      // 引数で URL が渡された場合はそれを使用、なければ入力を求める
      // TreeViewから呼ばれた場合、urlArgがオブジェクトになる可能性があるため型チェック
      let repoUrl: string | undefined =
        typeof urlArg === "string" ? normalizeRepoUrl(urlArg) : undefined;

      // 渡された URL のバリデーション
      if (typeof urlArg === "string" && !repoUrl) {
        vscode.window.showErrorMessage(messages.invalidRepoUrl());
        return;
      }

      if (!repoUrl) {
        repoUrl = await vscode.window.showInputBox({
          prompt: messages.enterRepoUrl(),
          placeHolder: messages.repoUrlPlaceholder(),
          validateInput: (value) => {
            if (!normalizeRepoUrl(value)) {
              return messages.invalidRepoUrl();
            }
            return null;
          },
        });
        if (repoUrl) {
          repoUrl = normalizeRepoUrl(repoUrl);
        }
      }

      if (!repoUrl) {
        return;
      }

      skillIndex = await getRemoteSourceIndex();

      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: messages.scanningRepo(),
            cancellable: false,
          },
          async () => {
            return await addSource(context, skillIndex!, repoUrl);
          },
        );

        skillIndex = result.index;
        vscode.window.showInformationMessage(
          messages.sourceAdded(result.addedSkills),
        );
        // 更新されたインデックスを直接設定
        browseProvider.setIndex(skillIndex);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes("rate limit") ||
          errorMessage.includes("authentication")
        ) {
          await showAuthHelp();
        } else if (errorMessage.includes("No skills found")) {
          vscode.window.showWarningMessage(messages.noSkillsInRepo());
        } else {
          vscode.window.showErrorMessage(
            messages.addSourceFailed(errorMessage),
          );
        }
      }
    },
  );

  // Command: Web search (improved with continuous search and preview)
  const webSearchCmd = vscode.commands.registerCommand(
    "skillNinja.webSearch",
    async () => {
      const config = vscode.workspace.getConfiguration("skillNinja");
      const token = config.get<string>("githubToken");

      // 連続検索のためのループ
      let continueSearch = true;
      while (continueSearch) {
        const query = await vscode.window.showInputBox({
          prompt: messages.webSearchPrompt(),
          placeHolder: messages.webSearchPlaceholder(),
        });

        if (!query) {
          return;
        }

        try {
          const results = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: messages.searchingGitHub(),
              cancellable: false,
            },
            async () => {
              return await searchGitHub(query, token);
            },
          );

          if (results.length === 0) {
            const retry = await vscode.window.showInformationMessage(
              messages.noSearchResults(query),
              messages.actionNewSearch(),
              messages.actionCancel(),
            );
            if (retry !== messages.actionNewSearch()) {
              continueSearch = false;
            }
            continue;
          }

          interface WebSearchQuickPickItem extends vscode.QuickPickItem {
            result: (typeof results)[0];
            action?: string;
            buttons?: vscode.QuickInputButton[];
          }

          // アイテムボタンの定義
          const openGitHubButton: vscode.QuickInputButton = {
            iconPath: new vscode.ThemeIcon("link-external"),
            tooltip: messages.actionOpenGitHub(),
          };
          const copyUrlButton: vscode.QuickInputButton = {
            iconPath: new vscode.ThemeIcon("copy"),
            tooltip: isJapanese() ? "URLをコピー" : "Copy URL",
          };

          // スター数でソート（人気順）
          const sortedResults = [...results].sort((a, b) => {
            const starsA = a.stars ?? 0;
            const starsB = b.stars ?? 0;
            return starsB - starsA;
          });

          // 結果選択ループ
          let selectMore = true;
          while (selectMore) {
            const items: WebSearchQuickPickItem[] = [
              // 新しい検索オプションを先頭に
              {
                label: `$(search) ${messages.actionNewSearch()}`,
                description: "",
                detail: "",
                result: sortedResults[0],
                action: "new-search",
              },
              // 検索結果（スター数・組織情報でハイライト）
              ...sortedResults.map((r) => {
                // ラベルにバッジを追加
                let label = `$(package) ${r.name}`;
                const badges: string[] = [];

                if (r.stars && r.stars >= 100) {
                  badges.push(`⭐${r.stars}`);
                }
                if (r.isOrg) {
                  badges.push("🏢");
                }

                if (badges.length > 0) {
                  label = `${badges.join(" ")} ${label}`;
                }

                return {
                  label,
                  description: r.repo,
                  detail:
                    r.description + (r.stars ? ` (${r.stars} stars)` : ""),
                  result: r,
                  buttons: [openGitHubButton, copyUrlButton],
                };
              }),
            ];

            // createQuickPick API でボタン対応
            const quickPick =
              vscode.window.createQuickPick<WebSearchQuickPickItem>();
            quickPick.items = items;
            quickPick.placeholder = messages.searchResultsCount(results.length);
            quickPick.matchOnDescription = true;
            quickPick.matchOnDetail = true;

            const selected = await new Promise<
              WebSearchQuickPickItem | undefined
            >((resolve) => {
              quickPick.onDidAccept(() => {
                resolve(quickPick.selectedItems[0]);
                quickPick.hide();
              });
              quickPick.onDidHide(() => {
                resolve(undefined);
                quickPick.dispose();
              });
              quickPick.onDidTriggerItemButton(async (e) => {
                const item = e.item;
                const url = getSearchResultGitHubUrl(item.result);

                if (e.button === openGitHubButton) {
                  // GitHub を開く（QuickPick は閉じない）
                  await vscode.env.openExternal(vscode.Uri.parse(url));
                } else if (e.button === copyUrlButton) {
                  // URL をクリップボードにコピー
                  await vscode.env.clipboard.writeText(url);
                  vscode.window.showInformationMessage(
                    isJapanese()
                      ? `URLをコピーしました: ${item.result.name}`
                      : `URL copied: ${item.result.name}`,
                  );
                }
              });
              quickPick.show();
            });

            if (!selected) {
              selectMore = false;
              continueSearch = false;
              break;
            }

            if (selected.action === "new-search") {
              selectMore = false;
              break;
            }

            // アクション選択
            const action = await vscode.window.showQuickPick(
              [
                {
                  label: `$(eye) ${messages.actionPreview()}`,
                  value: "preview",
                },
                {
                  label: `$(add) ${messages.actionAddSourceRepo()}`,
                  value: "add-source",
                },
                {
                  label: `$(link-external) ${messages.actionOpenGitHub()}`,
                  value: "open",
                },
                {
                  label: `$(copy) ${isJapanese() ? "URLをコピー" : "Copy URL"}`,
                  value: "copy-url",
                },
                {
                  label: `$(arrow-left) ${messages.actionBack()}`,
                  value: "back",
                },
              ],
              {
                placeHolder: `${selected.result.name} (${selected.result.repo})`,
              },
            );

            if (!action || action.value === "back") {
              // 結果一覧に戻る
              continue;
            }

            if (action.value === "preview") {
              // プレビュー表示
              // パスが .md で終わる場合はそのまま使用
              const pathEndsWithMd = selected.result.path.endsWith(".md");
              const urlPath = pathEndsWithMd
                ? selected.result.path
                : `${selected.result.path}/SKILL.md`;
              const branch = selected.result.defaultBranch || "main";
              const skill: Skill = {
                name: selected.result.name,
                description: selected.result.description || "",
                source: selected.result.repo,
                url: `${selected.result.repoUrl}/blob/${branch}/${urlPath}`,
                rawUrl: `https://raw.githubusercontent.com/${selected.result.repo}/${branch}/${urlPath}`,
                path: selected.result.path,
                categories: [],
                stars: selected.result.stars,
                owner: selected.result.repo.split("/")[0],
                isOrg: selected.result.isOrg,
              };
              await showSkillPreview(skill, context);
              // 結果一覧に戻る
              continue;
            } else if (action.value === "add-source") {
              await vscode.commands.executeCommand(
                "skillNinja.addSource",
                selected.result.repoUrl,
              );
              selectMore = false;
              continueSearch = false;
            } else if (action.value === "open") {
              const url = getSearchResultGitHubUrl(selected.result);
              await vscode.env.openExternal(vscode.Uri.parse(url));
              // 結果一覧に戻る
              continue;
            } else if (action.value === "copy-url") {
              const url = getSearchResultGitHubUrl(selected.result);
              await vscode.env.clipboard.writeText(url);
              vscode.window.showInformationMessage(
                isJapanese()
                  ? `URLをコピーしました: ${selected.result.name}`
                  : `URL copied: ${selected.result.name}`,
              );
              // 結果一覧に戻る
              continue;
            }
          }
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          if (
            errorMessage.includes("rate limit") ||
            errorMessage.includes("authentication")
          ) {
            await showAuthHelp();
          } else {
            vscode.window.showErrorMessage(messages.searchFailed(errorMessage));
          }
          continueSearch = false;
        }
      }
    },
  );

  // Command: Remove source
  const removeSourceCmd = vscode.commands.registerCommand(
    "skillNinja.removeSource",
    async (item?: SkillTreeItem) => {
      skillIndex = await getRemoteSourceIndex();

      let sourceId: string | undefined;
      let sourceName: string | undefined;

      if (item && item.source) {
        sourceId = item.source.id;
        sourceName = item.source.name;
      } else {
        interface SourceQuickPickItem extends vscode.QuickPickItem {
          sourceId: string;
        }

        const sources: SourceQuickPickItem[] = skillIndex.sources.map(
          (s: Source) => ({
            label: s.name,
            description: s.url,
            detail: `${
              skillIndex!.skills.filter((sk: Skill) => sk.source === s.id)
                .length
            } skills`,
            sourceId: s.id,
          }),
        );

        const selected = await vscode.window.showQuickPick(sources, {
          placeHolder: messages.selectSourceToRemove(),
        });

        if (!selected) {
          return;
        }

        sourceId = selected.sourceId;
        sourceName = selected.label;
      }

      const confirm = await vscode.window.showWarningMessage(
        messages.confirmRemoveSource(sourceName!),
        { modal: true },
        messages.actionRemove(),
      );

      if (confirm !== messages.actionRemove()) {
        return;
      }

      try {
        const result = await removeSource(context, skillIndex, sourceId!);
        skillIndex = result.index;
        vscode.window.showInformationMessage(
          messages.sourceRemoved(result.removedSkills),
        );
        browseProvider.refresh();
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(
          messages.removeSourceFailed(errorMessage),
        );
      }
    },
  );

  // Command: Preview skill
  const previewCmd = vscode.commands.registerCommand(
    "skillNinja.preview",
    async (skillOrItem?: Skill | SkillTreeItem) => {
      let skill: Skill | undefined;

      if (skillOrItem && "skill" in skillOrItem) {
        skill = skillOrItem.skill;
      } else if (skillOrItem && "name" in skillOrItem) {
        skill = skillOrItem as Skill;
      } else {
        // QuickPick で選択
        if (!skillIndex) {
          skillIndex = await loadSkillIndex(context);
        }

        const result = searchSkills(skillIndex, "");
        const selected = await vscode.window.showQuickPick(result.items, {
          placeHolder: result.truncated
            ? `${messages.searchPlaceholder()} ${messages.browseResultsLimited(MAX_SEARCH_RESULTS)}`
            : messages.searchPlaceholder(),
          matchOnDescription: true,
          matchOnDetail: true,
        });

        skill = selected?.skill;
      }

      if (skill) {
        await showSkillPreview(skill, context);
      }
    },
  );

  // Command: Toggle favorite
  const toggleFavoriteCmd = vscode.commands.registerCommand(
    "skillNinja.toggleFavorite",
    async (skillOrItem?: Skill | SkillTreeItem) => {
      let skill: Skill | undefined;

      if (skillOrItem && "skill" in skillOrItem) {
        skill = skillOrItem.skill;
      } else if (skillOrItem && "name" in skillOrItem) {
        skill = skillOrItem as Skill;
      }

      if (!skill) {
        return;
      }

      const skillId = getSkillId(skill);
      const favorites = context.globalState.get<string[]>("favorites", []);
      const isFavorite = favorites.includes(skillId);

      if (isFavorite) {
        // 削除
        const newFavorites = favorites.filter((f) => f !== skillId);
        await context.globalState.update("favorites", newFavorites);
        vscode.window.showInformationMessage(messages.removeFromFavorites());
      } else {
        // 追加
        favorites.push(skillId);
        await context.globalState.update("favorites", favorites);
        vscode.window.showInformationMessage(messages.addToFavorites());
      }

      browseProvider.refresh();
    },
  );

  // Command: Show favorites
  const showFavoritesCmd = vscode.commands.registerCommand(
    "skillNinja.showFavorites",
    async () => {
      if (!skillIndex) {
        skillIndex = await loadSkillIndex(context);
      }

      const favorites = context.globalState.get<string[]>("favorites", []);

      if (favorites.length === 0) {
        vscode.window.showInformationMessage(messages.noFavorites());
        return;
      }

      const favoriteSkills = skillIndex.skills.filter((s) =>
        favorites.includes(getSkillId(s)),
      );

      if (favoriteSkills.length === 0) {
        vscode.window.showInformationMessage(messages.noFavorites());
        return;
      }

      interface FavoriteQuickPickItem extends vscode.QuickPickItem {
        skill: Skill;
      }

      const items: FavoriteQuickPickItem[] = favoriteSkills.map((s) => ({
        label: `$(star-full) ${s.name}`,
        description: s.source,
        detail: s.description,
        skill: s,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: messages.favorites(),
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (selected) {
        const action = await vscode.window.showQuickPick(
          [
            { label: `$(eye) ${messages.actionPreview()}`, value: "preview" },
            { label: `$(add) ${messages.actionInstall()}`, value: "install" },
            {
              label: `$(star) ${messages.removeFromFavorites()}`,
              value: "unfavorite",
            },
          ],
          { placeHolder: selected.skill.name },
        );

        if (action?.value === "preview") {
          await showSkillPreview(selected.skill, context);
        } else if (action?.value === "install") {
          await vscode.commands.executeCommand(
            "skillNinja.install",
            selected.skill,
          );
        } else if (action?.value === "unfavorite") {
          await vscode.commands.executeCommand(
            "skillNinja.toggleFavorite",
            selected.skill,
          );
        }
      }
    },
  );

  // Command: Open on GitHub
  const openOnGitHubCmd = vscode.commands.registerCommand(
    "skillNinja.openOnGitHub",
    async (skillOrItem?: SkillTreeItem | Skill) => {
      let url: string | undefined;
      const currentSources = skillIndex?.sources || [];

      if (skillOrItem instanceof SkillTreeItem) {
        if (skillOrItem.skill) {
          url = await resolveSkillGitHubUrl(skillOrItem.skill, currentSources);
        } else if (skillOrItem.source) {
          url = skillOrItem.source.url;
        }
      } else if (skillOrItem && "name" in skillOrItem) {
        const skill = skillOrItem as Skill;
        url = await resolveSkillGitHubUrl(skill, currentSources);
      }

      if (url) {
        await vscode.env.openExternal(vscode.Uri.parse(url));
      }
    },
  );

  // Command: Register local skill in AGENTS.md
  const registerLocalSkillCmd = vscode.commands.registerCommand(
    "skillNinja.registerLocalSkill",
    async (item?: SkillTreeItem) => {
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      if (!item?.skill || !("isLocal" in item.skill)) {
        return;
      }

      const localSkill = item.skill as LocalSkill;

      if (localSkill.isRegistered) {
        vscode.window.showInformationMessage(
          messages.localSkillAlreadyRegistered(localSkill.name),
        );
        return;
      }

      const success = await registerLocalSkill(
        localSkill,
        workspaceFolder.uri,
        context,
      );
      if (success) {
        vscode.window.showInformationMessage(
          messages.localSkillRegistered(localSkill.name),
        );
        refreshInstalledViews();
      }
    },
  );

  // Command: Unregister local skill from AGENTS.md
  const unregisterLocalSkillCmd = vscode.commands.registerCommand(
    "skillNinja.unregisterLocalSkill",
    async (item?: SkillTreeItem) => {
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      if (!item?.skill || !("isLocal" in item.skill)) {
        return;
      }

      const localSkill = item.skill as LocalSkill;

      const success = await unregisterLocalSkill(
        localSkill,
        workspaceFolder.uri,
        context,
      );
      if (success) {
        vscode.window.showInformationMessage(
          messages.localSkillUnregistered(localSkill.name),
        );
        refreshInstalledViews();
      }
    },
  );

  // Command: Create new skill
  const createSkillCmd = vscode.commands.registerCommand(
    "skillNinja.createSkill",
    async () => {
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const skillName = await vscode.window.showInputBox({
        prompt: messages.createSkillPrompt(),
        placeHolder: messages.createSkillPlaceholder(),
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return "Skill name is required";
          }
          if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
            return "Skill name can only contain letters, numbers, hyphens and underscores";
          }
          return null;
        },
      });

      if (!skillName) {
        return;
      }

      const targetRoot = await resolveInstallTargetRoot(workspaceFolder.uri);
      if (!targetRoot) {
        return;
      }

      const skillDirUri = vscode.Uri.joinPath(targetRoot.rootUri, skillName);
      const skillPath = vscode.Uri.joinPath(skillDirUri, "SKILL.md");

      const skillContent = `---
name: ${skillName}
description: Describe what this skill does. Use when [describe the conditions when agents should use this skill].
license: YOUR-LICENSE
metadata:
  author: your-name
  version: "1.0"
---

# ${skillName}

## When to use this skill

Use this skill when:
- The user needs to...
- Working with...
- The task involves...

## Instructions

1. Step one
2. Step two
3. Step three

## Examples

\`\`\`
Add examples here
\`\`\`
`;

      await vscode.workspace.fs.createDirectory(skillDirUri);
      await vscode.workspace.fs.writeFile(
        skillPath,
        Buffer.from(skillContent, "utf8"),
      );

      await updateInstructionFilesForRoots([targetRoot]);

      vscode.window.showInformationMessage(messages.skillCreated(skillName));
      refreshInstalledViews();

      // Open the new file
      const doc = await vscode.workspace.openTextDocument(skillPath);
      await vscode.window.showTextDocument(doc);
    },
  );

  // Command: Update instruction file manually
  const updateInstructionCmd = vscode.commands.registerCommand(
    "skillNinja.updateInstruction",
    async (item?: SkillTreeItem) => {
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      try {
        const targetRoot = getSkillRootFromItem(item);
        if (targetRoot && !targetRoot.isReadOnly) {
          await updateInstructionFileForRoot(targetRoot, context);
        } else {
          await updateAllInstructionFiles(workspaceFolder.uri, context);
        }
        vscode.window.showInformationMessage(
          isJapanese()
            ? targetRoot
              ? `${getSkillRootGroupLabel(targetRoot)} のスキル出力を更新しました`
              : "スキル出力を更新しました"
            : targetRoot
              ? `Updated skill output for ${getSkillRootGroupLabel(targetRoot)}`
              : "Updated skill output",
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          isJapanese()
            ? `スキル出力の更新に失敗しました: ${error}`
            : `Failed to update skill output: ${error}`,
        );
      }
    },
  );

  // Command: Open the primary managed output (instruction file or ref catalog)
  const openInstructionFileCmd = vscode.commands.registerCommand(
    "skillNinja.openInstructionFile",
    async () => {
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const targetRoot = await pickManagedRoot(
        workspaceFolder.uri,
        isJapanese()
          ? "開くスキル出力のルートを選択"
          : "Select the skill output root to open",
      );

      if (!targetRoot?.instructionUri || !targetRoot.instructionPath) {
        return;
      }

      await openManagedOutputForRoot(targetRoot);
    },
  );

  const openWorkspaceOutputCmd = vscode.commands.registerCommand(
    "skillNinja.openWorkspaceOutput",
    async () => {
      const selectedRoot = getSkillRootFromItem(installedTreeView.selection[0]);
      await openManagedOutputForPreferredScope("workspace", selectedRoot);
    },
  );

  const openUserGlobalOutputCmd = vscode.commands.registerCommand(
    "skillNinja.openUserGlobalOutput",
    async () => {
      const selectedRoot = getSkillRootFromItem(
        userGlobalTreeView.selection[0],
      );
      await openManagedOutputForPreferredScope("userGlobal", selectedRoot);
    },
  );

  // Command: Open settings
  const openSettingsCmd = vscode.commands.registerCommand(
    "skillNinja.openSettings",
    async () => {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:yamapan.agent-skill-ninja",
      );
    },
  );

  const showBuiltInSkillsCmd = vscode.commands.registerCommand(
    "skillNinja.showBuiltInSkills",
    async () => {
      const skillNinjaConfig = vscode.workspace.getConfiguration("skillNinja");
      const alreadyEnabled = skillNinjaConfig.get<boolean>("showBuiltInSkills");

      if (!alreadyEnabled) {
        await skillNinjaConfig.update(
          "showBuiltInSkills",
          true,
          vscode.ConfigurationTarget.Global,
        );
      }

      refreshInstalledViews();

      vscode.window.showInformationMessage(
        isJapanese()
          ? "Built-in Skills を表示しました"
          : "Built-in skills are now visible",
      );
    },
  );

  // Command: Reset settings
  const resetSettingsCmd = vscode.commands.registerCommand(
    "skillNinja.resetSettings",
    async () => {
      const options = [
        { label: messages.resetCache(), value: "cache" },
        { label: messages.resetAllSettings(), value: "settings" },
        { label: messages.resetAllIncludingToken(), value: "all" },
      ];

      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: messages.resetSettingsPrompt(),
        title: messages.resetSettingsTitle(),
      });

      if (!selected) {
        return;
      }

      const config = vscode.workspace.getConfiguration("skillNinja");

      // キャッシュをクリア（GlobalStorage内のファイル削除）
      if (
        selected.value === "cache" ||
        selected.value === "settings" ||
        selected.value === "all"
      ) {
        const globalStoragePath = context.globalStorageUri.fsPath;
        try {
          await vscode.workspace.fs.delete(vscode.Uri.file(globalStoragePath), {
            recursive: true,
          });
        } catch {
          // フォルダが存在しない場合は無視
        }
      }

      // 設定をリセット（トークン以外）
      if (selected.value === "settings" || selected.value === "all") {
        await config.update(
          "language",
          undefined,
          vscode.ConfigurationTarget.Global,
        );
      }

      // トークンもリセット
      if (selected.value === "all") {
        await config.update(
          "githubToken",
          undefined,
          vscode.ConfigurationTarget.Global,
        );
      }

      const restart = await vscode.window.showInformationMessage(
        messages.resetComplete(),
        "Reload Window",
      );
      if (restart === "Reload Window") {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
      }
    },
  );

  // Command: Copy URL (for Browse view)
  const copyUrlCmd = vscode.commands.registerCommand(
    "skillNinja.copyUrl",
    async (item: SkillTreeItem) => {
      if (!item.skill) {
        return;
      }

      const currentIndex = await loadSkillIndex(context);
      const url = await resolveSkillGitHubUrl(item.skill, currentIndex.sources);
      if (url) {
        await vscode.env.clipboard.writeText(url);
        vscode.window.showInformationMessage(
          messages.copiedToClipboardWithValue(url),
        );
      }
    },
  );

  // Command: Copy Path (for Installed/Local skills)
  const copyPathCmd = vscode.commands.registerCommand(
    "skillNinja.copyPath",
    async (item: SkillTreeItem) => {
      if (item.resourceUri) {
        const path = item.resourceUri.fsPath;
        await vscode.env.clipboard.writeText(path);
        vscode.window.showInformationMessage(
          messages.copiedToClipboardWithValue(path),
        );
      }
    },
  );

  // Command: Open in Terminal (for Installed/Local skills)
  const openInTerminalCmd = vscode.commands.registerCommand(
    "skillNinja.openInTerminal",
    async (item: SkillTreeItem) => {
      if (item.resourceUri) {
        const filePath = item.resourceUri.fsPath;
        const folderPath = filePath.replace(/[/\\]SKILL\.md$/i, "");
        const terminal = vscode.window.createTerminal({
          name: `Skill: ${item.label}`,
          cwd: folderPath,
        });
        terminal.show();
      }
    },
  );

  const explainSkillStateCmd = vscode.commands.registerCommand(
    "skillNinja.explainSkillState",
    async (item: SkillTreeItem) => {
      if (!item?.skill) {
        return;
      }

      const skill = item.skill as Skill & Partial<LocalSkill>;
      const root = getSkillRootFromItem(item);
      const decision = await getEffectiveOwnership(context);
      let markerState = "none";

      if (root?.instructionUri) {
        try {
          const content = await vscode.workspace.fs.readFile(
            root.instructionUri,
          );
          const text = Buffer.from(content).toString("utf-8");
          if (text.includes("<!-- agent-ninja-START -->")) {
            markerState = "agent-ninja";
          } else if (text.includes("<!-- skill-ninja-START -->")) {
            markerState = "skill-ninja";
          }
        } catch {
          markerState = "missing";
        }
      }

      const lines: string[] = [];
      lines.push("=== Agent Skills Ninja: Skill State ===");
      lines.push(`Name             : ${skill.name}`);
      lines.push(
        `Relative Path    : ${skill.relativePath || skill.path || ""}`,
      );
      lines.push(`Display Path     : ${skill.displayPath || ""}`);
      lines.push(
        `Registration     : ${skill.registrationState || (skill.isRegistered ? "registered" : "unknown")}`,
      );
      lines.push(`Registration Src : ${skill.registrationSource || "unknown"}`);
      lines.push(`Registration Why : ${skill.registrationReason || "(none)"}`);
      lines.push(`Metadata Present : ${skill.metadataPresent ? "yes" : "no"}`);
      lines.push(`Metadata Path    : ${skill.metadataPath || "(none)"}`);
      lines.push(`Source           : ${skill.source || "(none)"}`);
      lines.push(`Remote Path      : ${skill.remotePath || "(none)"}`);
      lines.push(`Installed Via    : ${skill.installedVia || "(none)"}`);
      lines.push(`Installed At     : ${skill.installedAt || "(none)"}`);
      lines.push(
        `Package Parent   : ${skill.packageParentName || skill.packageParentRelativePath || "(none)"}`,
      );
      lines.push(`Scope            : ${skill.scope || "(none)"}`);
      lines.push(`Root Path        : ${root?.rootPath || "(none)"}`);
      lines.push(`Instruction Path : ${root?.instructionPath || "(none)"}`);
      lines.push(`Marker           : ${markerState}`);
      lines.push(`Owner            : ${decision.owner}`);
      lines.push(`Owner Reason     : ${decision.reason}`);

      skillStateChannel.clear();
      skillStateChannel.appendLine(lines.join("\n"));
      skillStateChannel.show(true);
    },
  );

  // Command: Report Bug
  const reportBugCmd = vscode.commands.registerCommand(
    "skillNinja.reportBug",
    async () => {
      const extensionVersion =
        vscode.extensions.getExtension("yamapan.agent-skill-ninja")?.packageJSON
          ?.version || "unknown";

      const config = vscode.workspace.getConfiguration("skillNinja");
      const language = config.get<string>("language", "en");
      const isJapaneseLanguage = language === "ja";

      const issueTitle = isJapaneseLanguage ? "[バグ報告] " : "[Bug] ";
      const issueBody = isJapaneseLanguage
        ? `**問題の説明**\n` +
          `<!-- 発生したバグについて説明してください -->\n\n` +
          `**再現手順**\n` +
          `1. \n2. \n3. \n\n` +
          `**期待される動作**\n` +
          `<!-- どのような動作を期待していましたか？ -->\n\n` +
          `**実際の動作**\n` +
          `<!-- 実際に何が起こりましたか？ -->\n\n` +
          `**スクリーンショット**\n` +
          `<!-- 可能であれば、問題がわかるスクリーンショットを添付してください -->\n\n` +
          `**環境**\n` +
          `- 拡張機能バージョン: ${extensionVersion}\n` +
          `- VS Code: ${vscode.version}\n` +
          `- OS: ${process.platform}\n`
        : `**Issue Description**\n` +
          `<!-- Please describe the bug you encountered -->\n\n` +
          `**Steps to Reproduce**\n` +
          `1. \n2. \n3. \n\n` +
          `**Expected Behavior**\n` +
          `<!-- What did you expect to happen? -->\n\n` +
          `**Actual Behavior**\n` +
          `<!-- What actually happened? -->\n\n` +
          `**Screenshots**\n` +
          `<!-- If possible, please attach screenshots that show the issue -->\n\n` +
          `**Environment**\n` +
          `- Extension Version: ${extensionVersion}\n` +
          `- VS Code: ${vscode.version}\n` +
          `- OS: ${process.platform}\n`;

      const params = new URLSearchParams();
      params.set("title", issueTitle);
      params.set("body", issueBody);
      const issueUrl = `https://github.com/aktsmm/vscode-agent-skill-ninja/issues/new?${params.toString()}`;
      await vscode.env.openExternal(vscode.Uri.parse(issueUrl));
    },
  );

  // Coexistence: status / recompute / orphan cleanup
  const showCoexistenceStatusCmd = vscode.commands.registerCommand(
    "skillNinja.showCoexistenceStatus",
    async () => {
      const decision = await getEffectiveOwnership(context);
      const sibling = decision.siblingBeacon;
      const selfPublished = getPublishedSelfBeacon(context);
      const siblingExt = vscode.extensions.getExtension(SIBLING_EXTENSION_ID);
      const useSharedSourcesManifest = vscode.workspace
        .getConfiguration("skillNinja")
        .get<boolean>("useSharedSourcesManifest", false);
      const sharedSourcesManifest = useSharedSourcesManifest
        ? await readSharedSourcesManifest()
        : undefined;
      const lines: string[] = [];
      lines.push("=== Agent Skills Ninja: Coexistence Status ===");
      lines.push(`Self extensionId : ${SELF_EXTENSION_ID}`);
      lines.push(`Sibling expected : ${SIBLING_EXTENSION_ID}`);
      lines.push(
        `Sibling installed: ${siblingExt ? "yes" : "no"}` +
          (siblingExt ? ` (active=${siblingExt.isActive})` : ""),
      );
      lines.push(
        `Sibling beacon   : ${sibling ? "present (via exports API)" : "absent / not exposed"}`,
      );
      if (sibling) {
        lines.push(`  - version      : ${sibling.version}`);
        lines.push(`  - kinds        : ${sibling.kinds.join(", ")}`);
        lines.push(`  - updatedAt    : ${sibling.updatedAt}`);
        lines.push(
          `  - capabilities : ${(sibling.capabilities || []).join(", ") || "(none)"}`,
        );
        lines.push(`  - protocol     : v${sibling.protocolVersion ?? "?"}`);
      }
      lines.push("");
      if (selfPublished) {
        lines.push(`Self beacon snapshot (diagnostic, in own globalState):`);
        lines.push(`  - version      : ${selfPublished.version}`);
        lines.push(`  - kinds        : ${selfPublished.kinds.join(", ")}`);
        lines.push(`  - updatedAt    : ${selfPublished.updatedAt}`);
      }
      lines.push("");
      lines.push(`Owner            : ${decision.owner}`);
      lines.push(`Reason           : ${decision.reason}`);
      lines.push(`Self kinds       : ${decision.selfKinds.join(", ")}`);
      if (decision.siblingKinds) {
        lines.push(`Sibling kinds    : ${decision.siblingKinds.join(", ")}`);
      }
      lines.push("");
      lines.push(
        `Coexistence mode : ${vscode.workspace.getConfiguration("skillNinja").get<string>("coexistenceMode") ?? "auto"}`,
      );
      lines.push(
        `Shared sources   : ${useSharedSourcesManifest ? (sharedSourcesManifest ? `${sharedSourcesManifest.sources.length} sources via ~/.agent-ninja/sources.json` : "enabled (not initialized)") : "disabled"}`,
      );
      lines.push(
        decision.owner === "self"
          ? "Action           : Skill Ninja will write the shared `<!-- agent-ninja-* -->` block."
          : "Action           : Skill Ninja defers; sibling extension owns the shared block.",
      );
      // Hint: while sibling owns the block, Resources Ninja's
      // `kindsExcluded` is ignored at runtime so skill rows stay visible.
      // Once Resources Ninja becomes standalone, that exclusion re-applies.
      const resourceNinjaConfig =
        vscode.workspace.getConfiguration("resourceNinja");
      const siblingExcluded =
        resourceNinjaConfig.get<string[]>("kindsExcluded") ?? [];
      if (decision.owner === "sibling" && siblingExcluded.includes("skill")) {
        lines.push("");
        lines.push(
          "Hint             : `resourceNinja.kindsExcluded` includes 'skill'.",
        );
        lines.push(
          "                   While Skill Ninja is active, Resources Ninja",
        );
        lines.push(
          "                   ignores this and writes skill rows. If you",
        );
        lines.push("                   uninstall Skill Ninja, those rows will");
        lines.push(
          "                   disappear unless you remove 'skill' from",
        );
        lines.push("                   resourceNinja.kindsExcluded.");
      }
      coexistenceChannel.clear();
      coexistenceChannel.appendLine(lines.join("\n"));
      coexistenceChannel.show(true);
    },
  );

  const recomputeOwnershipCmd = vscode.commands.registerCommand(
    "skillNinja.recomputeOwnership",
    async () => {
      // 自分の beacon を再 publish して updatedAt を更新し、その後 instruction
      // ファイルを更新（owner==self の場合は実書き込み、sibling ならスキップ）。
      await publishBeacon(context);
      await refreshViewRegistrationContext();
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (wsFolder) {
        await updateAllInstructionFiles(wsFolder.uri, context);
        refreshAllViews();
      }
      const decision = await getEffectiveOwnership(context);
      const message = isJapanese()
        ? `共存オーナーを再評価しました: ${decision.owner} (${decision.reason})`
        : `Coexistence ownership recomputed: ${decision.owner} (${decision.reason})`;
      const showStatus = isJapanese() ? "詳細を表示" : "Show Status";
      vscode.window.showInformationMessage(message, showStatus).then((sel) => {
        if (sel === showStatus) {
          void vscode.commands.executeCommand(
            "skillNinja.showCoexistenceStatus",
          );
        }
      });
    },
  );

  const cleanupOrphanBlockCmd = vscode.commands.registerCommand(
    "skillNinja.cleanupOrphanBlock",
    async () => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showWarningMessage(
          isJapanese()
            ? "ワークスペースが開かれていません"
            : "No workspace folder is open.",
        );
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        isJapanese()
          ? "AGENTS.md などから skill-ninja / resource-ninja / agent-ninja のマーカーブロックを削除します。よろしいですか？"
          : "This removes skill-ninja / resource-ninja / agent-ninja marker blocks from AGENTS.md and similar files. Continue?",
        { modal: true },
        isJapanese() ? "削除" : "Remove",
      );
      if (!confirm) {
        return;
      }
      const roots = await getManagedSkillRoots(wsFolder.uri);
      for (const root of roots) {
        if (root.instructionUri) {
          await removeSkillSectionFromFile(root.instructionUri);
        }
      }
      vscode.window.showInformationMessage(
        isJapanese()
          ? "孤児ブロックの掃除が完了しました"
          : "Orphan block cleanup complete.",
      );
    },
  );

  // Owner ownership change subscription: re-run instruction sync if our role changes.
  const ownershipDisposable = subscribeOwnershipChanges(async () => {
    if (!isContextActive()) {
      return;
    }
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (!wsFolder) {
      return;
    }
    // Sibling install/uninstall race: small delay so the sibling can publish
    // its beacon (or fully unregister) before we make a decision.
    await new Promise((resolve) =>
      setTimeout(resolve, MIGRATION_GUARD_DELAY_MS),
    );
    if (!isContextActive()) {
      return;
    }
    await refreshViewRegistrationContext();
    await updateAllInstructionFiles(wsFolder.uri, context);
    refreshAllViews();
  });
  context.subscriptions.push(ownershipDisposable);

  context.subscriptions.push(
    searchCmd,
    installCmd,
    uninstallCmd,
    reinstallAllCmd,
    reinstallRootCmd,
    reinstallCmd,
    uninstallAllCmd,
    installBundleCmd,
    uninstallMultipleCmd,
    reinstallMultipleCmd,
    showInstalledCmd,
    refreshCmd,
    refreshLocalCmd,
    openSkillFileCmd,
    updateIndexCmd,
    updateSourceIndexCmd,
    addSourceCmd,
    webSearchCmd,
    removeSourceCmd,
    previewCmd,
    toggleFavoriteCmd,
    showFavoritesCmd,
    openOnGitHubCmd,
    registerLocalSkillCmd,
    unregisterLocalSkillCmd,
    createSkillCmd,
    updateInstructionCmd,
    openInstructionFileCmd,
    openWorkspaceOutputCmd,
    openUserGlobalOutputCmd,
    openSettingsCmd,
    showBuiltInSkillsCmd,
    resetSettingsCmd,
    copyUrlCmd,
    copyPathCmd,
    openInTerminalCmd,
    explainSkillStateCmd,
    reportBugCmd,
    openSkillFolderCmd,
    editWhenToUseCmd,
    doubleClickCmd,
    showCoexistenceStatusCmd,
    recomputeOwnershipCmd,
    cleanupOrphanBlockCmd,
    configWatcher,
    installedTreeView,
    userGlobalTreeView,
    browseTreeView,
  );

  const refreshViews = () => {
    refreshAllViews();
  };

  context.subscriptions.push(
    vscode.workspace.onDidCreateFiles(() => refreshViews()),
    vscode.workspace.onDidDeleteFiles(() => refreshViews()),
  );

  // SKILL.md の変更を監視してメタデータを自動更新
  const skillMdWatcher = vscode.workspace.createFileSystemWatcher(
    workspaceFolder
      ? new vscode.RelativePattern(
          resolveWorkspaceSkillsRootUri(workspaceFolder.uri),
          "**/SKILL.md",
        )
      : new vscode.RelativePattern("", ".github/skills/**/SKILL.md"),
  );

  // デバウンス用の Map（同じファイルへの連続保存を1回にまとめる）
  const pendingUpdates = new Map<string, NodeJS.Timeout>();

  const handleSkillMdChange = async (uri: vscode.Uri) => {
    if (!isContextActive()) {
      return;
    }

    const key = uri.fsPath;

    // 既存のタイマーをクリア
    if (pendingUpdates.has(key)) {
      clearTimeout(pendingUpdates.get(key));
    }

    // 500ms のデバウンス
    pendingUpdates.set(
      key,
      setTimeout(async () => {
        pendingUpdates.delete(key);

        if (!isContextActive()) {
          return;
        }

        const skillRoot = workspaceFolder
          ? await findManagedRootForSkillFile(workspaceFolder.uri, uri)
          : undefined;
        if (!skillRoot) {
          return;
        }

        const updated = await refreshSingleSkillMetadata(uri);
        if (updated) {
          // ビューを更新
          refreshAllViews();

          // 自動更新が有効な場合は instruction file も更新
          const autoUpdate = vscode.workspace
            .getConfiguration("skillNinja")
            .get<boolean>("autoUpdateInstruction", true);
          if (autoUpdate) {
            if (initialSyncSettled) {
              await updateInstructionFileForRoot(skillRoot, context);
            } else {
              deferredInstructionRoots.add(skillRoot.rootPath);
            }
          }
        }
      }, 500),
    );
  };

  skillMdWatcher.onDidChange(handleSkillMdChange);
  const skillMdSaveWatcher = vscode.workspace.onDidSaveTextDocument(
    async (document) => {
      if (/[/\\]SKILL\.md$/i.test(document.uri.fsPath)) {
        await handleSkillMdChange(document.uri);
      }
    },
  );
  context.subscriptions.push(skillMdWatcher, skillMdSaveWatcher);

  // Expose the coexistence beacon to the sibling extension via
  // `vscode.extensions.getExtension(...).activate()`. globalState is
  // per-extension and not shared, so this exports API is the only reliable
  // cross-extension read path.
  return buildExtensionApi();
}

/**
 * バージョンアップ時にメタデータを再抽出 & スキル自動更新
 * 拡張機能のバージョンが変わった場合、インストール済みスキルの whenToUse を再抽出
 * オプションでスキルを自動再インストール
 */
async function checkVersionAndRefreshMetadata(
  context: vscode.ExtensionContext,
  workspaceUri: vscode.Uri | undefined,
  formatMigrated: boolean = false,
): Promise<void> {
  if (!workspaceUri) return;

  const LAST_VERSION_KEY = "skillNinja.lastVersion";
  const lastVersion = context.globalState.get<string>(LAST_VERSION_KEY);

  // フォーマットがマイグレーションされた場合は、インストラクションファイルを更新
  if (formatMigrated) {
    console.log("[Skill Ninja] Format migrated, updating instruction file...");
    try {
      if (activeContext === context && !extensionShuttingDown) {
        await updateAllInstructionFiles(workspaceUri, context);
      }
      vscode.window.showInformationMessage(
        isJapanese()
          ? "🥷 出力フォーマット設定が更新されました。インストラクションファイルを新フォーマットで再生成しました。"
          : "🥷 Output format setting migrated. Regenerated instruction file with new format.",
      );
    } catch (error) {
      console.error(
        "[Skill Ninja] Failed to update instruction file after format migration:",
        error,
      );
    }
  }

  if (lastVersion === EXTENSION_VERSION) {
    // バージョンが同じなら何もしない
    return;
  }

  console.log(
    `[Skill Ninja] Version changed: ${lastVersion || "none"} → ${EXTENSION_VERSION}`,
  );

  // バージョンを更新
  await context.globalState.update(LAST_VERSION_KEY, EXTENSION_VERSION);

  // 初回起動（lastVersion がない）の場合はスキップ
  if (!lastVersion) {
    console.log("[Skill Ninja] First activation, skipping metadata refresh");
    return;
  }

  // インストール済みスキルを取得
  const installedSkills = await getManagedInstalledSkillsWithMeta(workspaceUri);
  const remoteSkillCount = installedSkills.filter((entry) =>
    shouldAutoUpdateManagedInstalledSkillFromIndex(entry),
  ).length;

  // スキル自動更新設定を確認
  const config = vscode.workspace.getConfiguration("skillNinja");
  const autoUpdateSkills =
    config.get<string>("autoUpdateSkillsOnUpgrade") ?? "prompt";

  if (remoteSkillCount > 0 && autoUpdateSkills !== "never") {
    const shouldUpdate =
      autoUpdateSkills === "always" ||
      (await promptForSkillUpdate(remoteSkillCount));

    if (shouldUpdate) {
      try {
        // 全スキルを再インストール
        await vscode.commands.executeCommand("skillNinja.reinstallAll");
        vscode.window.showInformationMessage(
          isJapanese()
            ? `🥷 v${EXTENSION_VERSION} にアップデートしました。${remoteSkillCount} 個のスキルを最新版に更新しました。`
            : `🥷 Updated to v${EXTENSION_VERSION}. Updated ${remoteSkillCount} skill(s) to latest version.`,
        );
        await showRefFormatUpdateNotice(context);
        return; // 再インストールしたのでメタデータ更新はスキップ
      } catch (error) {
        console.error("[Skill Ninja] Failed to reinstall skills:", error);
      }
    }
  }

  // メタデータを再抽出（再インストールしなかった場合）
  try {
    const updatedCount = await refreshManagedSkillMetadata(workspaceUri);

    if (updatedCount > 0) {
      console.log(
        `[Skill Ninja] Refreshed metadata for ${updatedCount} skills`,
      );

      // instruction ファイルを更新
      const autoUpdate = config.get<boolean>("autoUpdateInstruction") ?? true;

      if (autoUpdate && activeContext === context && !extensionShuttingDown) {
        await updateAllInstructionFiles(workspaceUri, context);
        console.log("[Skill Ninja] Instruction files updated");
      }

      // 通知
      vscode.window.showInformationMessage(
        isJapanese()
          ? `🥷 v${EXTENSION_VERSION} にアップデートしました。${updatedCount} 個のスキルのメタデータを更新しました。`
          : `🥷 Updated to v${EXTENSION_VERSION}. Refreshed metadata for ${updatedCount} skill(s).`,
      );
    }
  } catch (error) {
    console.error("[Skill Ninja] Failed to refresh metadata:", error);
  }

  await showRefFormatUpdateNotice(context);
}

async function showRefFormatUpdateNotice(
  context: vscode.ExtensionContext,
): Promise<void> {
  const REF_FORMAT_NOTICE_KEY =
    "skillNinja.refFormatNoticeShown.ref-default-intro";
  const alreadyShown = context.globalState.get<boolean>(REF_FORMAT_NOTICE_KEY);
  if (alreadyShown) {
    return;
  }

  const config = vscode.workspace.getConfiguration("skillNinja");
  const inspected = config.inspect<string>("outputFormat");
  const explicitValue =
    inspected?.workspaceFolderValue ??
    inspected?.workspaceValue ??
    inspected?.globalValue;
  const currentValue = (config.get<string>("outputFormat") || "ref").trim();

  const message = isJapanese()
    ? explicitValue && currentValue !== "ref"
      ? `🥷 出力フォーマットの既定は Ref に変わりました。現在の設定（${currentValue}）はそのまま維持されます。AGENTS.md には参照だけを書き、詳細を別 catalog に分けるので、常時ロードのコンテキストを抑えたいときは Ref を試せます。`
      : "🥷 新しい Ref 出力フォーマットが既定になりました。AGENTS.md には参照だけを書き、詳細は別 catalog に分けるので、常時ロードのコンテキストを抑えたいときに向いています。"
    : explicitValue && currentValue !== "ref"
      ? `🥷 Ref is now the default output format. Your current setting (${currentValue}) stays as-is. Ref keeps AGENTS.md as a lightweight reference and moves the detailed catalog to a separate file, so it can help reduce always-loaded context.`
      : "🥷 Ref is now the default output format. It keeps AGENTS.md as a lightweight reference and writes the detailed catalog to a separate file, which helps reduce always-loaded context.";

  const openSettingsLabel = isJapanese() ? "設定を開く" : "Open Settings";
  const selection = await vscode.window.showInformationMessage(
    message,
    openSettingsLabel,
  );

  await context.globalState.update(REF_FORMAT_NOTICE_KEY, true);

  if (selection === openSettingsLabel) {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "skillNinja.outputFormat",
    );
  }
}

/**
 * スキル更新の確認ダイアログを表示
 */
async function promptForSkillUpdate(skillCount: number): Promise<boolean> {
  const message = isJapanese()
    ? `🥷 拡張機能がアップデートされました。${skillCount} 個のリモートスキルを最新版に更新しますか？`
    : `🥷 Extension updated. Update ${skillCount} remote skill(s) to latest version?`;

  const result = await vscode.window.showInformationMessage(
    message,
    { modal: false },
    isJapanese() ? "更新する" : "Update",
    isJapanese() ? "スキップ" : "Skip",
  );

  return result === (isJapanese() ? "更新する" : "Update");
}

/**
 * 出力フォーマット設定のマイグレーション
 * v0.8.3 で命名を変更:
 *   - markdown → legacy
 *   - compressed-index → compact
 *   - markdown-with-index → full
 * @returns マイグレーションが行われた場合は true
 */
function migrateOutputFormatSetting(): boolean {
  const config = vscode.workspace.getConfiguration("skillNinja");

  // マイグレーションマップ（旧値 → 新値）
  const migrationMap: Record<string, string> = {
    markdown: "legacy",
    "compressed-index": "compact",
    "markdown-with-index": "full",
  };

  let migrated = false;

  // Global / Workspace / WorkspaceFolder の各スコープで独立して確認してマイグレーション
  const inspected = config.inspect<string>("outputFormat");
  const targets: Array<[string | undefined, vscode.ConfigurationTarget]> = [
    [inspected?.globalValue, vscode.ConfigurationTarget.Global],
    [inspected?.workspaceValue, vscode.ConfigurationTarget.Workspace],
    [
      inspected?.workspaceFolderValue,
      vscode.ConfigurationTarget.WorkspaceFolder,
    ],
  ];

  for (const [value, target] of targets) {
    if (value && migrationMap[value]) {
      const newValue = migrationMap[value];
      config.update("outputFormat", newValue, target);
      console.log(
        `[Skill Ninja] Migrated outputFormat (${vscode.ConfigurationTarget[target]}): ${value} → ${newValue}`,
      );
      migrated = true;
    }
  }

  return migrated;
}

export function deactivate(): Thenable<void> | void {
  const ctx = activeContext;
  extensionShuttingDown = true;
  activeContext = undefined;
  if (ctx) {
    return clearBeacon(ctx).catch((err) => {
      console.error("[Skill Ninja] clearBeacon failed:", err);
    });
  }
}
