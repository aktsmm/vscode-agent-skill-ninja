// Skill Finder - VS Code Extension

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
  InstalledSkillsProvider,
  BrowseSkillsProvider,
  SkillTreeItem,
} from "./treeProvider";
import {
  updateIndexFromSources,
  addSource,
  removeSource,
  searchGitHub,
  showAuthHelp,
} from "./indexUpdater";
import { messages } from "./i18n";

export function activate(context: vscode.ExtensionContext) {
  console.log("Skill Finder is now active!");

  let skillIndex: SkillIndex | undefined;

  loadSkillIndex(context).then((index: SkillIndex) => {
    skillIndex = index;
    console.log(`Loaded ${index.skills.length} skills from index`);
  });

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  const installedProvider = new InstalledSkillsProvider(workspaceFolder?.uri);
  const browseProvider = new BrowseSkillsProvider(context);

  const installedTreeView = vscode.window.createTreeView(
    "skillFinder.installedView",
    {
      treeDataProvider: installedProvider,
      showCollapseAll: true,
    }
  );

  const browseTreeView = vscode.window.createTreeView(
    "skillFinder.browseView",
    {
      treeDataProvider: browseProvider,
      showCollapseAll: true,
    }
  );

  // Command: Refresh
  const refreshCmd = vscode.commands.registerCommand(
    "skillFinder.refresh",
    () => {
      installedProvider.refresh();
      browseProvider.refresh();
    }
  );

  // Command: Open SKILL.md
  const openSkillFileCmd = vscode.commands.registerCommand(
    "skillFinder.openSkillFile",
    async (item: SkillTreeItem) => {
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }
      const config = vscode.workspace.getConfiguration("skillFinder");
      const skillsDir =
        config.get<string>("skillsDirectory") || ".github/skills";
      const skillPath = vscode.Uri.joinPath(
        workspaceFolder.uri,
        skillsDir,
        item.label as string,
        "SKILL.md"
      );
      try {
        await vscode.window.showTextDocument(skillPath);
      } catch {
        vscode.window.showWarningMessage(
          messages.skillNotFound(item.label as string)
        );
      }
    }
  );

  // Command: Search skills
  const searchCmd = vscode.commands.registerCommand(
    "skillFinder.search",
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

          const action = await vscode.window.showQuickPick(
            [messages.actionInstall(), messages.actionCancel()],
            { placeHolder: messages.installConfirm(selected.skill.name) }
          );

          if (action === messages.actionInstall()) {
            await vscode.commands.executeCommand(
              "skillFinder.install",
              selected.skill
            );
          }
        }
      });

      quickPick.onDidHide(() => quickPick.dispose());
      quickPick.show();
    }
  );

  // Command: Install skill
  const installCmd = vscode.commands.registerCommand(
    "skillFinder.install",
    async (skillOrItem?: any) => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const skill = skillOrItem?.skill || skillOrItem;

      if (!skill && skillIndex) {
        await vscode.commands.executeCommand("skillFinder.search");
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

            const config = vscode.workspace.getConfiguration("skillFinder");
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
    "skillFinder.uninstall",
    async (item?: SkillTreeItem) => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      let skillName: string | undefined;

      if (item && item.label) {
        skillName = item.label as string;
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

          const config = vscode.workspace.getConfiguration("skillFinder");
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
    "skillFinder.showInstalled",
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
        const config = vscode.workspace.getConfiguration("skillFinder");
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
    "skillFinder.updateIndex",
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
    "skillFinder.addSource",
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

  // Command: Web search
  const webSearchCmd = vscode.commands.registerCommand(
    "skillFinder.webSearch",
    async () => {
      const query = await vscode.window.showInputBox({
        prompt: messages.webSearchPrompt(),
        placeHolder: messages.webSearchPlaceholder(),
      });

      if (!query) {
        return;
      }

      const config = vscode.workspace.getConfiguration("skillFinder");
      const token = config.get<string>("githubToken");

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
          vscode.window.showInformationMessage(messages.noSearchResults(query));
          return;
        }

        interface WebSearchQuickPickItem extends vscode.QuickPickItem {
          result: (typeof results)[0];
        }

        const items: WebSearchQuickPickItem[] = results.map((r) => ({
          label: `$(package) ${r.name}`,
          description: r.repo,
          detail: r.description,
          result: r,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: messages.searchResultsCount(results.length),
          matchOnDescription: true,
          matchOnDetail: true,
        });

        if (selected) {
          const action = await vscode.window.showQuickPick(
            [
              {
                label: `$(add) ${messages.actionAddSourceRepo()}`,
                value: "add-source",
              },
              {
                label: `$(link-external) ${messages.actionOpenGitHub()}`,
                value: "open",
              },
              { label: `$(x) ${messages.actionCancel()}`, value: "cancel" },
            ],
            {
              placeHolder: `${selected.result.name} (${selected.result.repo})`,
            }
          );

          if (action?.value === "add-source") {
            await vscode.commands.executeCommand(
              "skillFinder.addSource",
              selected.result.repoUrl
            );
          } else if (action?.value === "open") {
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
      }
    }
  );

  // Command: Remove source
  const removeSourceCmd = vscode.commands.registerCommand(
    "skillFinder.removeSource",
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

  context.subscriptions.push(
    searchCmd,
    installCmd,
    uninstallCmd,
    showInstalledCmd,
    refreshCmd,
    openSkillFileCmd,
    updateIndexCmd,
    addSourceCmd,
    webSearchCmd,
    removeSourceCmd,
    installedTreeView,
    browseTreeView
  );

  const refreshViews = () => {
    installedProvider.refresh();
  };

  context.subscriptions.push(
    vscode.workspace.onDidCreateFiles(() => refreshViews()),
    vscode.workspace.onDidDeleteFiles(() => refreshViews())
  );
}

export function deactivate() {}
