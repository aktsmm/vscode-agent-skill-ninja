// Agent Skills Ninja - VS Code Extension

import * as vscode from "vscode";
import {
  SkillIndex,
  Skill,
  Source,
  buildGitHubContentUrl,
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
  SkillTreeItem,
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
  shouldAutoUpdateInstalledSkillFromIndex,
  shouldCheckInstalledSkillAgainstIndex,
} from "./installedSkillIndex";
import { showSkillPreview, getSkillId } from "./skillPreview";
import {
  LocalSkill,
  registerLocalSkill,
  unregisterLocalSkill,
} from "./localSkillScanner";
import {
  getManagedSkillRoots,
  isInsidePath,
  SkillRoot,
} from "./skillLocations";
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

// 現在の拡張機能バージョン
const EXTENSION_VERSION =
  vscode.extensions.getExtension("yamapan.agent-skill-ninja")?.packageJSON
    ?.version || "0.0.0";

// activation 時に保存し、deactivate で beacon をクリアするために使用。
let activeContext: vscode.ExtensionContext | undefined;

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

  // Coexistence beacon を publish。Resource NINJA とのオーナー判定で使われる。
  publishBeacon(context).catch((err) => {
    console.error("[Skill Ninja] publishBeacon failed:", err);
  });

  // Output channel for coexistence diagnostics
  const coexistenceChannel = vscode.window.createOutputChannel(
    "Agent Skills Ninja: Coexistence",
  );
  context.subscriptions.push(coexistenceChannel);

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
  checkVersionAndRefreshMetadata(context, workspaceFolder?.uri, formatMigrated);

  loadSkillIndex(context).then(async (index: SkillIndex) => {
    skillIndex = index;
    console.log(`Loaded ${index.skills.length} skills from index`);

    // インストール済みスキルのインデックス整合性チェック
    if (workspaceFolder) {
      const installedEntries = await getManagedInstalledEntries(
        workspaceFolder.uri,
      );
      const missingSkills: string[] = [];
      for (const { meta } of installedEntries) {
        if (!shouldCheckInstalledSkillAgainstIndex(meta)) {
          continue;
        }
        const skill = findIndexedSkillForInstalledMeta(index.skills, meta);
        if (!skill) {
          missingSkills.push(meta.name);
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
    workspaceProvider.refresh();
    userGlobalProvider.refresh();
  }

  function refreshAllViews(): void {
    refreshInstalledViews();
    browseProvider.refresh();
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

  function getLocalizedRootLabel(root: SkillRoot): string {
    switch (root.scope) {
      case "workspace":
        return isJapanese() ? "ワークスペース スキル" : "Workspace Skills";
      case "userGlobal":
        return isJapanese()
          ? "ユーザー / グローバル スキル"
          : "User / Global Skills";
      case "extension":
        return isJapanese()
          ? "インストール済み拡張機能"
          : "Installed Extensions";
      case "builtIn":
        return "Built-in Skills";
      default:
        return root.label;
    }
  }

  async function getManagedInstalledEntries(workspaceUri: vscode.Uri) {
    return getManagedInstalledSkillsWithMeta(workspaceUri);
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
        label: getLocalizedRootLabel(root),
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

  async function resolveInstallTargetRoot(
    workspaceUri: vscode.Uri,
  ): Promise<SkillRoot | undefined> {
    return pickManagedRoot(
      workspaceUri,
      isJapanese()
        ? "インストール先のスキルスコープを選択"
        : "Select the target skill scope",
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

  function getSkillRootFromItem(item?: SkillTreeItem): SkillRoot | undefined {
    if (!item?.skill) {
      return undefined;
    }

    const skillAny = item.skill as unknown as Record<string, unknown>;
    const root = skillAny.root;
    if (root && typeof root === "object") {
      return root as SkillRoot;
    }

    return item.skillRoot;
  }

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

    if (
      e.affectsConfiguration("skillNinja.skillsDirectory") ||
      e.affectsConfiguration("skillNinja.useVsCodeAgentSkillLocations") ||
      e.affectsConfiguration("skillNinja.showBuiltInSkills")
    ) {
      refreshAllViews();
    }

    // インストラクションファイルまたは出力フォーマットが変更されたら自動更新
    if (
      e.affectsConfiguration("skillNinja.instructionFile") ||
      e.affectsConfiguration("skillNinja.customInstructionPath") ||
      e.affectsConfiguration("skillNinja.outputFormat")
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
            for (const file of candidateFiles) {
              try {
                await removeSkillSectionFromFile(
                  vscode.Uri.joinPath(workspaceFolders[0].uri, file),
                );
              } catch {
                // ファイルが存在しない場合は無視
              }
            }
          }

          // 少し待ってから更新（設定が完全に反映されるのを待つ）
          setTimeout(async () => {
            try {
              await updateAllInstructionFiles(workspaceFolders[0].uri, context);
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
        } catch {
          // フォールバック
        }
      }

      const config = vscode.workspace.getConfiguration("skillNinja");
      const skillsDir =
        config.get<string>("skillsDirectory") || ".github/skills";
      const skillName = (item.label as string).replace(/^[✓○]\s*/, "");
      const skillPath = vscode.Uri.joinPath(
        workspaceFolder.uri,
        skillsDir,
        skillName,
        "SKILL.md",
      );

      try {
        await vscode.window.showTextDocument(skillPath);
      } catch {
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
      const config = vscode.workspace.getConfiguration("skillNinja");
      const skillsDir =
        config.get<string>("skillsDirectory") || ".github/skills";

      // ラベルからステータスアイコンを削除してスキル名を取得
      const skillName = (item.label as string).replace(/^[✓○]\s*/, "");

      const folderPath = vscode.Uri.joinPath(
        workspaceFolder.uri,
        skillsDir,
        skillName,
      );

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
            source: "unknown",
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
      quickPick.placeholder = messages.searchPlaceholder();
      quickPick.matchOnDescription = true;
      quickPick.matchOnDetail = true;

      quickPick.items = searchSkills(skillIndex, "");

      quickPick.onDidChangeValue((value) => {
        quickPick.items = searchSkills(skillIndex!, value);
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

      const reinstallableEntries = installedEntries.filter(({ meta }) =>
        shouldCheckInstalledSkillAgainstIndex(meta),
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
        const tryUpdate = await vscode.window.showWarningMessage(
          isJapanese()
            ? `${
                missingSkills.length
              } 個のスキルがインデックスに見つかりません（${missingSkills
                .slice(0, 3)
                .join(", ")}${
                missingSkills.length > 3 ? "..." : ""
              }）。インデックスを更新しますか？`
            : `${
                missingSkills.length
              } skill(s) not found in index (${missingSkills
                .slice(0, 3)
                .join(", ")}${
                missingSkills.length > 3 ? "..." : ""
              }). Update index now?`,
          isJapanese() ? "更新する" : "Update",
          isJapanese() ? "スキップ" : "Skip",
        );

        if (tryUpdate === (isJapanese() ? "更新する" : "Update")) {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: isJapanese()
                ? "インデックスを更新中..."
                : "Updating index...",
            },
            async (progress) => {
              index = await updateIndexFromSources(context, index, progress);
            },
          );
        }
      }

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
              }
            }
            completed++;
          }
        },
      );

      await updateInstructionFilesForRoots(
        reinstallableEntries.map((entry) => entry.root),
      );

      refreshAllViews();
      vscode.window.showInformationMessage(
        isJapanese()
          ? `${reinstallableEntries.length} 個のスキルを再インストールしました${
              skippedLocalCount > 0
                ? `（ローカルスキル ${skippedLocalCount} 個は対象外）`
                : ""
            }`
          : `Reinstalled ${reinstallableEntries.length} skills${
              skippedLocalCount > 0
                ? ` (${skippedLocalCount} local skill(s) excluded)`
                : ""
            }`,
      );
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
        const tryUpdate = await vscode.window.showWarningMessage(
          isJapanese()
            ? `${skill.name} がインデックスに見つかりません。インデックスを更新しますか？`
            : `${skill.name} not found in index. Update index now?`,
          isJapanese() ? "更新する" : "Update",
          isJapanese() ? "キャンセル" : "Cancel",
        );

        if (tryUpdate === (isJapanese() ? "更新する" : "Update")) {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: isJapanese()
                ? "インデックスを更新中..."
                : "Updating index...",
            },
            async (progress) => {
              index = await updateIndexFromSources(context, index, progress);
            },
          );

          // 再検索
          fullSkill = findIndexedSkillForInstalledMeta(index.skills, meta);
        }

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
        shouldCheckInstalledSkillAgainstIndex(item.entry.meta),
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

      const index = await loadSkillIndex(context);

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
              }
            }
            completed++;
          }
        },
      );

      await updateInstructionFilesForRoots(
        reinstallableSelected.map((item) => item.entry.root),
      );

      refreshAllViews();
      vscode.window.showInformationMessage(
        isJapanese()
          ? `${reinstallableSelected.length} 個のスキルを再インストールしました${
              skippedLocalCount > 0
                ? `（ローカルスキル ${skippedLocalCount} 個は対象外）`
                : ""
            }`
          : `Reinstalled ${reinstallableSelected.length} skills${
              skippedLocalCount > 0
                ? ` (${skippedLocalCount} local skill(s) excluded)`
                : ""
            }`,
      );
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
        } catch {
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
      if (!skillIndex) {
        skillIndex = await loadSkillIndex(context);
      }

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

      if (!skillIndex) {
        skillIndex = await loadSkillIndex(context);
      }

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
            ? trimmed
            : undefined;
        }

        return trimmed.match(/^[^/]+\/[^/]+$/)
          ? `https://github.com/${trimmed}`
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

      if (!skillIndex) {
        skillIndex = await loadSkillIndex(context);
      }

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
      if (!skillIndex) {
        skillIndex = await loadSkillIndex(context);
      }

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

        const items: SkillQuickPickItem[] = searchSkills(skillIndex, "");
        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: messages.searchPlaceholder(),
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
    async () => {
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      try {
        await updateAllInstructionFiles(workspaceFolder.uri, context);
        vscode.window.showInformationMessage(
          isJapanese()
            ? "インストラクションファイルを更新しました"
            : "Instruction file updated",
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          isJapanese()
            ? `更新に失敗しました: ${error}`
            : `Failed to update: ${error}`,
        );
      }
    },
  );

  // Command: Open instruction file (AGENTS.md etc.)
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
          ? "開くインストラクションファイルのスコープを選択"
          : "Select the instruction file scope to open",
      );

      if (!targetRoot?.instructionUri || !targetRoot.instructionPath) {
        return;
      }

      const fileUri = targetRoot.instructionUri;
      const filePath = targetRoot.instructionPath;

      try {
        // ファイルが存在するか確認
        await vscode.workspace.fs.stat(fileUri);
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc);
      } catch {
        // ファイルがなければ作成するか確認
        const create = await vscode.window.showInformationMessage(
          `${filePath} が見つかりません。作成しますか？`,
          "作成",
          "キャンセル",
        );
        if (create === "作成") {
          // 空のファイルを作成
          await vscode.workspace.fs.writeFile(
            fileUri,
            Buffer.from("# Agent Skills\n\n"),
          );
          const doc = await vscode.workspace.openTextDocument(fileUri);
          await vscode.window.showTextDocument(doc);
        }
      }
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
      const alreadyEnabled = skillNinjaConfig.get<boolean>(
        "showBuiltInSkills",
        false,
      );

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
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (!wsFolder) {
      return;
    }
    // Sibling install/uninstall race: small delay so the sibling can publish
    // its beacon (or fully unregister) before we make a decision.
    await new Promise((resolve) =>
      setTimeout(resolve, MIGRATION_GUARD_DELAY_MS),
    );
    await updateAllInstructionFiles(wsFolder.uri, context);
    refreshAllViews();
  });
  context.subscriptions.push(ownershipDisposable);

  context.subscriptions.push(
    searchCmd,
    installCmd,
    uninstallCmd,
    reinstallAllCmd,
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
    openSettingsCmd,
    showBuiltInSkillsCmd,
    resetSettingsCmd,
    copyUrlCmd,
    copyPathCmd,
    openInTerminalCmd,
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
  const config = vscode.workspace.getConfiguration("skillNinja");
  const skillsDir = config.get<string>("skillsDirectory") || ".github/skills";
  const skillMdWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(
      vscode.workspace.workspaceFolders?.[0] || "",
      `${skillsDir}/**/SKILL.md`,
    ),
  );

  // デバウンス用の Map（同じファイルへの連続保存を1回にまとめる）
  const pendingUpdates = new Map<string, NodeJS.Timeout>();

  const handleSkillMdChange = async (uri: vscode.Uri) => {
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
            await updateInstructionFileForRoot(skillRoot, context);
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
      await updateAllInstructionFiles(workspaceUri, context);
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
  const remoteSkillCount = installedSkills.filter(({ meta }) =>
    shouldAutoUpdateInstalledSkillFromIndex(meta),
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

      if (autoUpdate) {
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
  const currentValue = config.get<string>("outputFormat");

  // マイグレーションマップ（旧値 → 新値）
  const migrationMap: Record<string, string> = {
    markdown: "legacy",
    "compressed-index": "compact",
    "markdown-with-index": "full",
  };

  if (currentValue && migrationMap[currentValue]) {
    const newValue = migrationMap[currentValue];
    config.update("outputFormat", newValue, vscode.ConfigurationTarget.Global);
    console.log(
      `[Skill Ninja] Migrated outputFormat: ${currentValue} → ${newValue}`,
    );
    return true;
  }
  return false;
}

export function deactivate(): Thenable<void> | void {
  const ctx = activeContext;
  activeContext = undefined;
  if (ctx) {
    return clearBeacon(ctx).catch((err) => {
      console.error("[Skill Ninja] clearBeacon failed:", err);
    });
  }
}
