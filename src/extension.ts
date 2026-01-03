// Agent Skill Ninja - VS Code Extension

import * as vscode from "vscode";
import { SkillIndex, Skill, Source, loadSkillIndex } from "./skillIndex";
import { searchSkills, SkillQuickPickItem } from "./skillSearch";
import {
  installSkill,
  uninstallSkill,
  getInstalledSkills,
} from "./skillInstaller";
import { updateInstructionFile } from "./instructionManager";
import {
  BrowseSkillsProvider,
  SkillTreeItem,
  WorkspaceSkillsProvider,
} from "./treeProvider";
import {
  updateIndexFromSources,
  addSource,
  removeSource,
  searchGitHub,
  showAuthHelp,
} from "./indexUpdater";
import { messages } from "./i18n";
import {
  showSkillPreview,
  getSkillId,
  getSkillGitHubUrl,
} from "./skillPreview";
import {
  LocalSkill,
  registerLocalSkill,
  unregisterLocalSkill,
} from "./localSkillScanner";
import { createChatParticipant } from "./chatParticipant";
import { registerMcpTools } from "./mcpTools";

export function activate(context: vscode.ExtensionContext) {
  console.log("Agent Skill Ninja is now active!");

  let skillIndex: SkillIndex | undefined;

  loadSkillIndex(context).then((index: SkillIndex) => {
    skillIndex = index;
    console.log(`Loaded ${index.skills.length} skills from index`);
  });

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  // 統合ワークスペーススキルビュー
  const workspaceProvider = new WorkspaceSkillsProvider(workspaceFolder?.uri);
  const browseProvider = new BrowseSkillsProvider(context);

  // 後方互換のためのエイリアス
  const installedProvider = workspaceProvider;

  const installedTreeView = vscode.window.createTreeView(
    "skillNinja.installedView",
    {
      treeDataProvider: workspaceProvider,
      showCollapseAll: true,
    }
  );

  const browseTreeView = vscode.window.createTreeView("skillNinja.browseView", {
    treeDataProvider: browseProvider,
    showCollapseAll: true,
  });

  // GitHub Copilot Chat Participant
  createChatParticipant(context);

  // MCP Tools for Language Model API
  registerMcpTools(context);

  // Command: Refresh
  const refreshCmd = vscode.commands.registerCommand(
    "skillNinja.refresh",
    () => {
      installedProvider.refresh();
      browseProvider.refresh();
    }
  );

  // Command: Refresh Local
  const refreshLocalCmd = vscode.commands.registerCommand(
    "skillNinja.refreshLocal",
    () => {
      workspaceProvider.refresh();
    }
  );

  // Command: Open SKILL.md
  const openSkillFileCmd = vscode.commands.registerCommand(
    "skillNinja.openSkillFile",
    async (item: SkillTreeItem) => {
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      // ローカルスキルの場合は fullPath を使用
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

      // インストール済みスキル（.github/skills 配下）の場合
      const config = vscode.workspace.getConfiguration("skillNinja");
      const skillsDir =
        config.get<string>("skillsDirectory") || ".github/skills";

      // ラベルからステータスアイコンを削除してスキル名を取得
      const skillName = (item.label as string).replace(/^[✓○]\s*/, "");

      const skillPath = vscode.Uri.joinPath(
        workspaceFolder.uri,
        skillsDir,
        skillName,
        "SKILL.md"
      );
      try {
        await vscode.window.showTextDocument(skillPath);
      } catch {
        vscode.window.showWarningMessage(messages.skillNotFound(skillName));
      }
    }
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
            }
          );

          if (action?.value === "install") {
            await vscode.commands.executeCommand(
              "skillNinja.install",
              selected.skill
            );
          } else if (action?.value === "preview") {
            await showSkillPreview(selected.skill, context);
          } else if (action?.value === "favorite") {
            await vscode.commands.executeCommand(
              "skillNinja.toggleFavorite",
              selected.skill
            );
          } else if (action?.value === "github") {
            const url = getSkillGitHubUrl(selected.skill);
            await vscode.env.openExternal(vscode.Uri.parse(url));
          }
        }
      });

      quickPick.onDidHide(() => quickPick.dispose());
      quickPick.show();
    }
  );

  // Command: Install skill
  const installCmd = vscode.commands.registerCommand(
    "skillNinja.install",
    async (skillOrItem?: any) => {
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

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: messages.installing(skill.name),
          },
          async () => {
            await installSkill(skill, wsFolder.uri, context);

            const config = vscode.workspace.getConfiguration("skillNinja");
            if (config.get<boolean>("autoUpdateInstruction")) {
              await updateInstructionFile(wsFolder.uri, context);
            }
          }
        );
        vscode.window.showInformationMessage(
          messages.installSuccess(skill.name)
        );
        installedProvider.refresh();
      } catch (error) {
        vscode.window.showErrorMessage(messages.installFailed(String(error)));
      }
    }
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

      if (item && item.label) {
        // ラベルからステータスアイコンを除去してスキル名を取得
        skillName = (item.label as string).replace(/^[✓○]\s*/, "");
      } else {
        const installed = await getInstalledSkills(wsFolder.uri);
        if (installed.length === 0) {
          vscode.window.showInformationMessage(messages.noInstalledSkills());
          return;
        }

        const selected =
          await vscode.window.showQuickPick<vscode.QuickPickItem>(
            installed.map((name: string) => ({ label: name })),
            { placeHolder: messages.selectSkillToUninstall() }
          );
        skillName = selected?.label;
      }

      if (skillName) {
        try {
          await uninstallSkill(skillName, wsFolder.uri);

          const config = vscode.workspace.getConfiguration("skillNinja");
          if (config.get<boolean>("autoUpdateInstruction")) {
            await updateInstructionFile(wsFolder.uri, context);
          }

          vscode.window.showInformationMessage(
            messages.uninstallSuccess(skillName)
          );
          installedProvider.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(
            messages.uninstallFailed(String(error))
          );
        }
      }
    }
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

      const installed = await getInstalledSkills(wsFolder.uri);
      if (installed.length === 0) {
        vscode.window.showInformationMessage(messages.noInstalledSkills());
        return;
      }

      const selected = await vscode.window.showQuickPick<vscode.QuickPickItem>(
        installed.map((name: string) => ({
          label: name,
          description: `$(folder) ${messages.installedFolder()}`,
        })),
        {
          placeHolder: messages.installedSkillsPlaceholder(),
          canPickMany: false,
        }
      );

      if (selected) {
        const config = vscode.workspace.getConfiguration("skillNinja");
        const skillsDir =
          config.get<string>("skillsDirectory") || ".github/skills";
        const skillPath = vscode.Uri.joinPath(
          wsFolder.uri,
          skillsDir,
          selected.label,
          "SKILL.md"
        );

        try {
          await vscode.window.showTextDocument(skillPath);
        } catch {
          vscode.window.showWarningMessage(
            messages.skillNotFound(selected.label)
          );
        }
      }
    }
  );

  // Command: Update index
  const updateIndexCmd = vscode.commands.registerCommand(
    "skillNinja.updateIndex",
    async () => {
      if (!skillIndex) {
        skillIndex = await loadSkillIndex(context);
      }

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
              progress
            );
          }
        );
        vscode.window.showInformationMessage(
          messages.indexUpdated(skillIndex.skills.length)
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
    }
  );

  // Command: Add source
  const addSourceCmd = vscode.commands.registerCommand(
    "skillNinja.addSource",
    async () => {
      const repoUrl = await vscode.window.showInputBox({
        prompt: messages.enterRepoUrl(),
        placeHolder: messages.repoUrlPlaceholder(),
        validateInput: (value) => {
          if (!value.match(/github\.com\/[^/]+\/[^/]+/)) {
            return messages.invalidRepoUrl();
          }
          return null;
        },
      });

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
          }
        );

        skillIndex = result.index;
        vscode.window.showInformationMessage(
          messages.sourceAdded(result.addedSkills)
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
        } else if (errorMessage.includes("No skills found")) {
          vscode.window.showWarningMessage(messages.noSkillsInRepo());
        } else {
          vscode.window.showErrorMessage(
            messages.addSourceFailed(errorMessage)
          );
        }
      }
    }
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
            }
          );

          if (results.length === 0) {
            const retry = await vscode.window.showInformationMessage(
              messages.noSearchResults(query),
              messages.actionNewSearch(),
              messages.actionCancel()
            );
            if (retry !== messages.actionNewSearch()) {
              continueSearch = false;
            }
            continue;
          }

          interface WebSearchQuickPickItem extends vscode.QuickPickItem {
            result: (typeof results)[0];
            action?: string;
          }

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
                };
              }),
            ];

            const selected = await vscode.window.showQuickPick(items, {
              placeHolder: messages.searchResultsCount(results.length),
              matchOnDescription: true,
              matchOnDetail: true,
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
                  label: `$(arrow-left) ${messages.actionBack()}`,
                  value: "back",
                },
              ],
              {
                placeHolder: `${selected.result.name} (${selected.result.repo})`,
              }
            );

            if (!action || action.value === "back") {
              // 結果一覧に戻る
              continue;
            }

            if (action.value === "preview") {
              // プレビュー表示
              const skill: Skill = {
                name: selected.result.name,
                description: selected.result.description || "",
                source: selected.result.repo,
                url: `${selected.result.repoUrl}/blob/HEAD/${selected.result.path}/SKILL.md`,
                rawUrl: `https://raw.githubusercontent.com/${selected.result.repo}/HEAD/${selected.result.path}/SKILL.md`,
                path: selected.result.path,
                categories: [],
                stars: selected.result.stars,
                owner: selected.result.repo.split("/")[0],
                isOrg: selected.result.isOrg,
              };
              await showSkillPreview(skill, context);
            } else if (action.value === "add-source") {
              await vscode.commands.executeCommand(
                "skillNinja.addSource",
                selected.result.repoUrl
              );
              selectMore = false;
              continueSearch = false;
            } else if (action.value === "open") {
              const skillPath = selected.result.path
                ? `/tree/HEAD/${selected.result.path}`
                : "";
              const url = `${selected.result.repoUrl}${skillPath}`;
              await vscode.env.openExternal(vscode.Uri.parse(url));
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
    }
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
          })
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
        messages.actionRemove()
      );

      if (confirm !== messages.actionRemove()) {
        return;
      }

      try {
        const result = await removeSource(context, skillIndex, sourceId!);
        skillIndex = result.index;
        vscode.window.showInformationMessage(
          messages.sourceRemoved(result.removedSkills)
        );
        browseProvider.refresh();
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(
          messages.removeSourceFailed(errorMessage)
        );
      }
    }
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
    }
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
    }
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
        favorites.includes(getSkillId(s))
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
          { placeHolder: selected.skill.name }
        );

        if (action?.value === "preview") {
          await showSkillPreview(selected.skill, context);
        } else if (action?.value === "install") {
          await vscode.commands.executeCommand(
            "skillNinja.install",
            selected.skill
          );
        } else if (action?.value === "unfavorite") {
          await vscode.commands.executeCommand(
            "skillNinja.toggleFavorite",
            selected.skill
          );
        }
      }
    }
  );

  // Command: Open on GitHub
  const openOnGitHubCmd = vscode.commands.registerCommand(
    "skillNinja.openOnGitHub",
    async (skillOrItem?: SkillTreeItem | Skill) => {
      let url: string | undefined;

      if (skillOrItem instanceof SkillTreeItem) {
        if (skillOrItem.skill) {
          url = getSkillGitHubUrl(skillOrItem.skill);
        } else if (skillOrItem.source) {
          url = skillOrItem.source.url;
        }
      } else if (skillOrItem && "name" in skillOrItem) {
        const skill = skillOrItem as Skill;
        url = getSkillGitHubUrl(skill);
      }

      if (url) {
        await vscode.env.openExternal(vscode.Uri.parse(url));
      }
    }
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
          messages.localSkillAlreadyRegistered(localSkill.name)
        );
        return;
      }

      const success = await registerLocalSkill(
        localSkill,
        workspaceFolder.uri,
        context
      );
      if (success) {
        vscode.window.showInformationMessage(
          messages.localSkillRegistered(localSkill.name)
        );
        workspaceProvider.refresh();
      }
    }
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
        context
      );
      if (success) {
        vscode.window.showInformationMessage(
          messages.localSkillUnregistered(localSkill.name)
        );
        workspaceProvider.refresh();
      }
    }
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

      const config = vscode.workspace.getConfiguration("skillNinja");
      const skillsDir =
        config.get<string>("skillsDirectory") || ".github/skills";
      const skillPath = vscode.Uri.joinPath(
        workspaceFolder.uri,
        skillsDir,
        skillName,
        "SKILL.md"
      );

      const skillContent = `---
name: "${skillName}"
description: "Add description here"
categories: ["development"]
---

# ${skillName}

## Description

Add your skill description here.

## Instructions

1. Step one
2. Step two
3. Step three

## Examples

\`\`\`
Add examples here
\`\`\`
`;

      await vscode.workspace.fs.writeFile(
        skillPath,
        Buffer.from(skillContent, "utf8")
      );

      vscode.window.showInformationMessage(messages.skillCreated(skillName));
      workspaceProvider.refresh();

      // Open the new file
      const doc = await vscode.workspace.openTextDocument(skillPath);
      await vscode.window.showTextDocument(doc);
    }
  );

  // Command: Open instruction file (AGENTS.md etc.)
  const openInstructionFileCmd = vscode.commands.registerCommand(
    "skillNinja.openInstructionFile",
    async () => {
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const config = vscode.workspace.getConfiguration("skillNinja");
      const instructionFile =
        config.get<string>("instructionFile") || "AGENTS.md";

      let filePath: string;
      if (instructionFile === "custom") {
        filePath = config.get<string>("customInstructionPath") || "AGENTS.md";
      } else {
        filePath = instructionFile;
      }

      const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);

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
          "キャンセル"
        );
        if (create === "作成") {
          // 空のファイルを作成
          await vscode.workspace.fs.writeFile(
            fileUri,
            Buffer.from("# Agent Skills\n\n")
          );
          const doc = await vscode.workspace.openTextDocument(fileUri);
          await vscode.window.showTextDocument(doc);
        }
      }
    }
  );

  // Command: Open settings
  const openSettingsCmd = vscode.commands.registerCommand(
    "skillNinja.openSettings",
    async () => {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:yamapan.agent-skill-ninja"
      );
    }
  );

  context.subscriptions.push(
    searchCmd,
    installCmd,
    uninstallCmd,
    showInstalledCmd,
    refreshCmd,
    refreshLocalCmd,
    openSkillFileCmd,
    updateIndexCmd,
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
    openInstructionFileCmd,
    openSettingsCmd,
    installedTreeView,
    browseTreeView
  );

  const refreshViews = () => {
    workspaceProvider.refresh();
  };

  context.subscriptions.push(
    vscode.workspace.onDidCreateFiles(() => refreshViews()),
    vscode.workspace.onDidDeleteFiles(() => refreshViews())
  );
}

export function deactivate() {}
