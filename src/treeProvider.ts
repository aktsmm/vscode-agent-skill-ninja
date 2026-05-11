// サイドバー TreeView プロバイダー
// ワークスペーススキル（統合）とブラウズ用のツリービューを提供

import * as vscode from "vscode";
import {
  SkillIndex,
  Skill,
  loadSkillIndex,
  Source,
  Bundle,
  Category,
  getLocalizedDescription,
} from "./skillIndex";
import { getInstalledSkillsWithMeta } from "./skillInstaller";
import { LocalSkill, scanVisibleSkills } from "./localSkillScanner";
import { isJapanese } from "./i18n";
import { getSkillId } from "./skillPreview";
import {
  getManagedSkillRoots,
  normalizeFileSystemPath,
  SkillRoot,
  SkillScope,
} from "./skillLocations";

/**
 * ワークスペーススキル情報（統合型）
 */
export interface WorkspaceSkill {
  name: string;
  description: string;
  description_ja?: string;
  relativePath: string;
  displayPath: string;
  fullPath: string;
  isInstalled: boolean;
  isRegistered: boolean;
  isManaged: boolean;
  isReadOnly: boolean;
  scope: SkillScope;
  root: SkillRoot;
  source?: string; // インストール元ソース
  categories?: string[];
  // 公式仕様に基づくメタデータ
  license?: string; // ライセンス（例: MIT, Apache-2.0）
  author?: string; // 作成者
  version?: string; // バージョン
}

interface WorkspaceSkillRootGroup {
  root: SkillRoot;
  skills: WorkspaceSkill[];
}

function localizeRootLabel(english: string, japanese: string): string {
  return isJapanese() ? japanese : english;
}

function humanizeRootSegment(segment: string): string {
  return segment
    .replace(/^\.+/, "")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getRootLabelFromPath(root: SkillRoot): string | undefined {
  const normalizedRootPath = normalizeFileSystemPath(root.rootPath);

  if (normalizedRootPath.endsWith("/.copilot/skills")) {
    return localizeRootLabel("GitHub Copilot Home", "GitHub Copilot ホーム");
  }
  if (normalizedRootPath.endsWith("/.claude/skills")) {
    return localizeRootLabel("Claude Home", "Claude ホーム");
  }
  if (normalizedRootPath.endsWith("/.agents/skills")) {
    return localizeRootLabel("Global Agent Home", "グローバル Agent ホーム");
  }
  if (normalizedRootPath.includes("/appdata/roaming/code/user/")) {
    return localizeRootLabel(
      "VS Code User Customizations",
      "VS Code ユーザーカスタマイズ",
    );
  }
  if (normalizedRootPath.includes("/extensions/github.copilot-chat")) {
    return localizeRootLabel("GitHub Copilot Chat", "GitHub Copilot Chat");
  }
  if (normalizedRootPath.includes("/extensions/github.copilot")) {
    return localizeRootLabel("GitHub Copilot", "GitHub Copilot");
  }
  if (normalizedRootPath.includes("/@github/copilot/builtin-skills")) {
    return localizeRootLabel(
      "GitHub Copilot Built-ins",
      "GitHub Copilot 組み込み",
    );
  }

  const segments = normalizedRootPath.split("/").filter(Boolean);
  const parentSegment =
    segments.length >= 2 ? segments[segments.length - 2] : "";
  if (!parentSegment) {
    return undefined;
  }

  const parentLabel = humanizeRootSegment(parentSegment);
  if (!parentLabel) {
    return undefined;
  }

  return root.scope === "builtIn"
    ? localizeRootLabel(`${parentLabel} Built-ins`, `${parentLabel} 組み込み`)
    : parentLabel;
}

export function getSkillRootGroupLabel(root: SkillRoot): string {
  if (root.scope === "workspace") {
    return localizeRootLabel("Workspace Skills", "ワークスペース スキル");
  }

  return getRootLabelFromPath(root) || root.label || root.displayPath;
}

export function getSkillRootGroupDescription(
  root: SkillRoot,
  skillCount: number,
): string {
  const countText = isJapanese()
    ? `${skillCount} 件のスキル`
    : `${skillCount} skills`;
  return `${countText} • ${root.displayPath}`;
}

function getSkillRootGroupCollapsibleState(
  root: SkillRoot,
): vscode.TreeItemCollapsibleState {
  return root.scope === "workspace"
    ? vscode.TreeItemCollapsibleState.Expanded
    : vscode.TreeItemCollapsibleState.Collapsed;
}

export function getManagedSkillTreeItemLabel(
  skill: WorkspaceSkill,
  recentlyInstalled?: Set<string>,
): string {
  const isRecent = recentlyInstalled?.has(skill.name) ?? false;
  return `${isRecent ? "🆕 " : ""}${skill.name}`;
}

export function getManagedSkillTreeItemDescription(
  skill: WorkspaceSkill,
): string {
  if (skill.isReadOnly || skill.isRegistered) {
    return skill.relativePath;
  }

  return isJapanese()
    ? `${skill.relativePath} • 未登録`
    : `${skill.relativePath} • Not registered`;
}

function compareWorkspaceSkills(
  left: WorkspaceSkill,
  right: WorkspaceSkill,
): number {
  const leftRoot = normalizeFileSystemPath(left.root.rootPath);
  const rightRoot = normalizeFileSystemPath(right.root.rootPath);
  const rootCompare = leftRoot.localeCompare(rightRoot);
  if (rootCompare !== 0) {
    return rootCompare;
  }

  return left.relativePath.localeCompare(right.relativePath);
}

function toWorkspaceSkill(skill: LocalSkill): WorkspaceSkill {
  return {
    name: skill.name,
    description: skill.description || "",
    description_ja: skill.description_ja,
    relativePath: skill.relativePath,
    displayPath: skill.displayPath,
    fullPath: skill.fullPath,
    isInstalled: skill.isManaged,
    isRegistered: skill.isReadOnly ? false : skill.isRegistered,
    isManaged: skill.isManaged,
    isReadOnly: skill.isReadOnly,
    scope: skill.scope,
    root: skill.root,
    source: skill.source,
    categories: skill.categories,
    license: skill.license,
    author: skill.author,
    version: skill.version,
  };
}

export function buildSkillRootGroups(
  workspaceSkills: WorkspaceSkill[],
): WorkspaceSkillRootGroup[] {
  const rootGroups = new Map<string, WorkspaceSkillRootGroup>();
  const sortedSkills = [...workspaceSkills].sort(compareWorkspaceSkills);

  for (const skill of sortedSkills) {
    const key = normalizeFileSystemPath(skill.root.rootPath);
    const existingGroup = rootGroups.get(key);
    if (existingGroup) {
      existingGroup.skills.push(skill);
      continue;
    }

    rootGroups.set(key, {
      root: skill.root,
      skills: [skill],
    });
  }

  return Array.from(rootGroups.values()).sort((left, right) =>
    normalizeFileSystemPath(left.root.rootPath).localeCompare(
      normalizeFileSystemPath(right.root.rootPath),
    ),
  );
}

function createSkillRootGroupItem(
  root: SkillRoot,
  skillCount: number,
  contextValue: string = "skillRootGroup",
): SkillTreeItem {
  const item = new SkillTreeItem(
    getSkillRootGroupLabel(root),
    getSkillRootGroupDescription(root, skillCount),
    getSkillRootGroupCollapsibleState(root),
    contextValue,
    undefined,
    undefined,
    undefined,
    undefined,
    root,
    root.scope,
  );

  item.iconPath = new vscode.ThemeIcon(
    root.isReadOnly ? "folder-library" : "folder-opened",
  );

  const tooltipLines = [getSkillRootGroupLabel(root), root.displayPath];
  if (root.instructionPath) {
    tooltipLines.push(`Instruction: ${root.instructionPath}`);
  }
  tooltipLines.push(getSkillRootGroupDescription(root, skillCount));
  item.tooltip = tooltipLines.join("\n");

  return item;
}

function createManagedSkillTreeItem(
  skill: WorkspaceSkill,
  recentlyInstalled?: Set<string>,
): SkillTreeItem {
  const contextValue = skill.isReadOnly
    ? "builtInSkill"
    : skill.isRegistered
      ? "managedSkill"
      : "managedUnregisteredSkill";

  const localizedDescription = isJapanese()
    ? skill.description_ja || skill.description
    : skill.description;

  const item = new SkillTreeItem(
    getManagedSkillTreeItemLabel(skill, recentlyInstalled),
    getManagedSkillTreeItemDescription(skill),
    vscode.TreeItemCollapsibleState.None,
    contextValue,
    {
      name: skill.name,
      description: localizedDescription,
      description_ja: skill.description_ja,
      source: skill.source || "local",
      path: skill.relativePath,
      categories: skill.categories || [],
      isLocal: true,
      fullPath: skill.fullPath,
      relativePath: skill.relativePath,
      displayPath: skill.displayPath,
      isRegistered: skill.isRegistered,
      scope: skill.scope,
      root: skill.root,
      skillDirUri: vscode.Uri.file(
        skill.fullPath.replace(/[/\\]SKILL\.md$/i, ""),
      ),
      isManaged: skill.isManaged,
      isReadOnly: skill.isReadOnly,
    } as Skill & Partial<LocalSkill>,
    undefined,
    undefined,
    undefined,
    skill.root,
    skill.scope,
  );

  item.iconPath = new vscode.ThemeIcon(
    skill.isReadOnly ? "library" : "package",
    skill.isReadOnly
      ? new vscode.ThemeColor("disabledForeground")
      : skill.isRegistered
        ? new vscode.ThemeColor("charts.green")
        : new vscode.ThemeColor("charts.yellow"),
  );
  item.resourceUri = vscode.Uri.file(skill.fullPath);

  const noDescription = isJapanese() ? "説明なし" : "No description";
  const statusText = skill.isReadOnly
    ? isJapanese()
      ? "Built-in（読み取り専用）"
      : "Built-in (read-only)"
    : skill.isRegistered
      ? isJapanese()
        ? "Managed（登録済み）"
        : "Managed (registered)"
      : isJapanese()
        ? "Managed（未登録）"
        : "Managed (not registered)";
  const metaLines = [
    `${isJapanese() ? "パス" : "Path"}: ${skill.displayPath}`,
    `${isJapanese() ? "状態" : "Status"}: ${statusText}`,
  ];

  if (skill.author) {
    metaLines.push(`${isJapanese() ? "Author" : "Author"}: ${skill.author}`);
  }
  if (skill.license) {
    metaLines.push(`${isJapanese() ? "License" : "License"}: ${skill.license}`);
  }
  if (skill.version) {
    metaLines.push(`Version: ${skill.version}`);
  }

  item.tooltip = `${skill.name}\n${localizedDescription || noDescription}\n${metaLines.join("\n")}`;
  item.command = {
    command: "vscode.open",
    title: isJapanese() ? "SKILL.md を開く" : "Open SKILL.md",
    arguments: [vscode.Uri.file(skill.fullPath)],
  };

  return item;
}

/**
 * ワークスペーススキルビュー
 * - configured skills directory 配下のスキルを表示
 */
export class WorkspaceSkillsProvider implements vscode.TreeDataProvider<SkillTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    SkillTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private workspaceSkills: WorkspaceSkill[] = [];

  constructor(
    private workspaceUri: vscode.Uri | undefined,
    private recentlyInstalled?: Set<string>,
  ) {}

  refresh(): void {
    this.workspaceSkills = [];
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SkillTreeItem): vscode.TreeItem {
    return element;
  }

  // reveal() を使うために必要
  getParent(element: SkillTreeItem): SkillTreeItem | undefined {
    if (
      element.skillRoot &&
      element.contextValue !== "skillRootGroup" &&
      element.contextValue !== "placeholder"
    ) {
      return this.buildRootGroupItems().find(
        (item) =>
          item.skillRoot &&
          normalizeFileSystemPath(item.skillRoot.rootPath) ===
            normalizeFileSystemPath(element.skillRoot!.rootPath),
      );
    }

    return undefined;
  }

  async getChildren(element?: SkillTreeItem): Promise<SkillTreeItem[]> {
    if (!this.workspaceUri) {
      return [];
    }

    if (!element) {
      if (this.workspaceSkills.length === 0) {
        await this.loadWorkspaceSkills();
      }

      if (this.workspaceSkills.length === 0) {
        return [
          new SkillTreeItem(
            isJapanese() ? "スキルが見つかりません" : "No skills found",
            isJapanese()
              ? "「スキルを検索」でインストールしてください"
              : "Use 'Search Skills' to install skills",
            vscode.TreeItemCollapsibleState.None,
            "placeholder",
          ),
        ];
      }

      return this.buildRootGroupItems();
    }

    if (element.contextValue === "skillRootGroup" && element.skillRoot) {
      return this.workspaceSkills
        .filter(
          (skill) =>
            normalizeFileSystemPath(skill.root.rootPath) ===
            normalizeFileSystemPath(element.skillRoot!.rootPath),
        )
        .map((skill) => this.toSkillItem(skill));
    }

    return [];
  }

  private buildRootGroupItems(): SkillTreeItem[] {
    return buildSkillRootGroups(this.workspaceSkills).map((group) =>
      createSkillRootGroupItem(group.root, group.skills.length),
    );
  }

  private toSkillItem(skill: WorkspaceSkill): SkillTreeItem {
    return createManagedSkillTreeItem(skill, this.recentlyInstalled);
  }

  /**
   * ワークスペース内の全スキルを読み込み
   */
  private async loadWorkspaceSkills(): Promise<void> {
    if (!this.workspaceUri) {
      return;
    }

    const visibleSkills = await scanVisibleSkills(this.workspaceUri);
    this.workspaceSkills = visibleSkills
      .filter((skill) => skill.scope === "workspace")
      .map(toWorkspaceSkill);
  }

  /**
   * ワークスペーススキル一覧を取得
   */
  getWorkspaceSkills(): WorkspaceSkill[] {
    return this.workspaceSkills;
  }
}

// 後方互換性のためのエイリアス
export const InstalledSkillsProvider = WorkspaceSkillsProvider;
export const LocalSkillsProvider = WorkspaceSkillsProvider;

export class UserGlobalSkillsProvider implements vscode.TreeDataProvider<SkillTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    SkillTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private userGlobalSkills: WorkspaceSkill[] = [];

  constructor(
    private workspaceUri: vscode.Uri | undefined,
    private recentlyInstalled?: Set<string>,
  ) {}

  refresh(): void {
    this.userGlobalSkills = [];
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SkillTreeItem): vscode.TreeItem {
    return element;
  }

  getParent(element: SkillTreeItem): SkillTreeItem | undefined {
    if (element.contextValue === "builtInScopeGroup") {
      return undefined;
    }

    if (element.contextValue === "builtInSkillRootGroup") {
      return this.buildBuiltInSectionItem();
    }

    if (
      element.skillRoot &&
      element.contextValue !== "skillRootGroup" &&
      element.contextValue !== "builtInSkillRootGroup" &&
      element.contextValue !== "placeholder"
    ) {
      const rootPath = normalizeFileSystemPath(element.skillRoot.rootPath);
      const builtInParent = this.buildBuiltInRootItems().find(
        (item) =>
          item.skillRoot &&
          normalizeFileSystemPath(item.skillRoot.rootPath) === rootPath,
      );
      if (builtInParent) {
        return builtInParent;
      }

      return this.buildUserRootItems().find(
        (item) =>
          item.skillRoot &&
          normalizeFileSystemPath(item.skillRoot.rootPath) === rootPath,
      );
    }

    return undefined;
  }

  async getChildren(element?: SkillTreeItem): Promise<SkillTreeItem[]> {
    if (!this.workspaceUri) {
      return [];
    }

    if (!element) {
      if (this.userGlobalSkills.length === 0) {
        await this.loadUserGlobalSkills();
      }

      if (this.userGlobalSkills.length === 0) {
        return [
          new SkillTreeItem(
            isJapanese()
              ? "ユーザー / グローバル スキルが見つかりません"
              : "No user/global skills found",
            isJapanese()
              ? "Settings の Agent Skill Locations または個人 skill root を確認してください"
              : "Check Agent Skill Locations or your personal skill roots in Settings",
            vscode.TreeItemCollapsibleState.None,
            "placeholder",
          ),
        ];
      }

      const items = this.buildUserRootItems();
      const builtInSection = this.buildBuiltInSectionItem();
      if (builtInSection) {
        items.push(builtInSection);
      }
      return items;
    }

    if (element.contextValue === "skillRootGroup" && element.skillRoot) {
      return this.getSkillsForRoot(element.skillRoot.rootPath).map((skill) =>
        this.toSkillItem(skill),
      );
    }

    if (element.contextValue === "builtInScopeGroup") {
      return this.buildBuiltInRootItems();
    }

    if (element.contextValue === "builtInSkillRootGroup" && element.skillRoot) {
      return this.getSkillsForRoot(element.skillRoot.rootPath).map((skill) =>
        this.toSkillItem(skill),
      );
    }

    return [];
  }

  private buildUserRootItems(): SkillTreeItem[] {
    return buildSkillRootGroups(
      this.userGlobalSkills.filter((skill) => skill.scope === "userGlobal"),
    ).map((group) => createSkillRootGroupItem(group.root, group.skills.length));
  }

  private buildBuiltInSectionItem(): SkillTreeItem | undefined {
    const builtInGroups = buildSkillRootGroups(
      this.userGlobalSkills.filter((skill) => skill.scope === "builtIn"),
    );
    if (builtInGroups.length === 0) {
      return undefined;
    }

    const totalSkills = builtInGroups.reduce(
      (count, group) => count + group.skills.length,
      0,
    );
    const item = new SkillTreeItem(
      isJapanese() ? "組み込みスキル" : "Built-in Skills",
      isJapanese()
        ? `${builtInGroups.length} 個のルート • ${totalSkills} 件のスキル`
        : `${builtInGroups.length} roots • ${totalSkills} skills`,
      vscode.TreeItemCollapsibleState.Collapsed,
      "builtInScopeGroup",
    );
    item.iconPath = new vscode.ThemeIcon("library");
    item.tooltip = item.description;
    return item;
  }

  private buildBuiltInRootItems(): SkillTreeItem[] {
    return buildSkillRootGroups(
      this.userGlobalSkills.filter((skill) => skill.scope === "builtIn"),
    ).map((group) =>
      createSkillRootGroupItem(
        group.root,
        group.skills.length,
        "builtInSkillRootGroup",
      ),
    );
  }

  private getSkillsForRoot(rootPath: string): WorkspaceSkill[] {
    const normalizedRootPath = normalizeFileSystemPath(rootPath);
    return this.userGlobalSkills
      .filter(
        (skill) =>
          normalizeFileSystemPath(skill.root.rootPath) === normalizedRootPath,
      )
      .sort(compareWorkspaceSkills);
  }

  private toSkillItem(skill: WorkspaceSkill): SkillTreeItem {
    return createManagedSkillTreeItem(skill, this.recentlyInstalled);
  }

  private async loadUserGlobalSkills(): Promise<void> {
    if (!this.workspaceUri) {
      return;
    }

    const visibleSkills = await scanVisibleSkills(this.workspaceUri);
    this.userGlobalSkills = visibleSkills
      .filter(
        (skill) => skill.scope === "userGlobal" || skill.scope === "builtIn",
      )
      .map(toWorkspaceSkill);
  }
}

/**
 * ブラウズ用ツリービュー（ソース別）
 */
export class BrowseSkillsProvider implements vscode.TreeDataProvider<SkillTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    SkillTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private skillIndex: SkillIndex | undefined;
  private installedSkillNames: Set<string> = new Set();

  constructor(private context: vscode.ExtensionContext) {}

  refresh(): void {
    this.skillIndex = undefined;
    this.installedSkillNames.clear();
    this._onDidChangeTreeData.fire();
  }

  /**
   * インデックスを直接設定してリフレッシュ
   */
  setIndex(index: SkillIndex): void {
    this.skillIndex = index;
    this.installedSkillNames.clear();
    this._onDidChangeTreeData.fire();
  }

  /**
   * スキルがインストール済みかどうかを確認
   */
  isSkillInstalled(skillName: string): boolean {
    return this.installedSkillNames.has(skillName.toLowerCase());
  }

  getTreeItem(element: SkillTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SkillTreeItem): Promise<SkillTreeItem[]> {
    // インデックスを読み込む
    if (!this.skillIndex) {
      this.skillIndex = await loadSkillIndex(this.context);
    }

    // インストール済みスキルを取得（メタデータの name を使用）
    if (this.installedSkillNames.size === 0) {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (wsFolder) {
        const managedRoots = await getManagedSkillRoots(wsFolder.uri);
        for (const root of managedRoots) {
          const installedMeta = await getInstalledSkillsWithMeta(
            wsFolder.uri,
            root.rootUri,
          );
          installedMeta.forEach((meta) =>
            this.installedSkillNames.add(meta.name.toLowerCase()),
          );
        }
      }
    }

    if (!element) {
      // ルートレベル: Favorites + ソース一覧
      const items: SkillTreeItem[] = [];

      // お気に入りセクション
      const favorites = this.context.globalState.get<string[]>("favorites", []);
      if (favorites.length > 0) {
        // 実際にインデックスに存在するお気に入りスキルの数をカウント
        const favoriteSkillCount = this.skillIndex.skills.filter((skill) =>
          favorites.includes(getSkillId(skill)),
        ).length;

        if (favoriteSkillCount > 0) {
          const favItem = new SkillTreeItem(
            isJapanese() ? "お気に入り" : "Favorites",
            `${favoriteSkillCount} skills`,
            vscode.TreeItemCollapsibleState.Collapsed,
            "favorites",
          );
          favItem.iconPath = new vscode.ThemeIcon(
            "star-full",
            new vscode.ThemeColor("charts.yellow"),
          );
          items.push(favItem);
        }
      }

      // ソースをタイプ別に分類
      const officialSources = this.skillIndex.sources.filter(
        (s) => s.type === "official",
      );
      const awesomeSources = this.skillIndex.sources.filter(
        (s) => s.type === "awesome-list",
      );
      const communitySources = this.skillIndex.sources.filter(
        (s) => s.type === "community" || s.type === "user-added" || !s.type,
      );

      // ヘルパー関数: ソースをツリーアイテムに変換
      const createSourceItem = (source: Source) => {
        const item = new SkillTreeItem(
          source.name,
          `${this.getSkillCountForSource(source.id)} skills`,
          vscode.TreeItemCollapsibleState.Collapsed,
          "source",
          undefined,
          source,
        );
        if (source.type === "official") {
          item.iconPath = new vscode.ThemeIcon(
            "verified",
            new vscode.ThemeColor("charts.blue"),
          );
        } else if (source.type === "awesome-list") {
          item.iconPath = new vscode.ThemeIcon(
            "star",
            new vscode.ThemeColor("charts.yellow"),
          );
        } else if (source.type === "user-added") {
          item.iconPath = new vscode.ThemeIcon(
            "repo-forked",
            new vscode.ThemeColor("charts.green"),
          );
        } else {
          item.iconPath = new vscode.ThemeIcon("repo");
        }
        return item;
      };

      // 1. 公式ソース (official)
      for (const source of officialSources) {
        items.push(createSourceItem(source));
      }

      // 2. スターソース (awesome-list)
      for (const source of awesomeSources) {
        items.push(createSourceItem(source));
      }

      // 3. バンドル（スターとその他の間）
      if (this.skillIndex.bundles && this.skillIndex.bundles.length > 0) {
        const bundleItem = new SkillTreeItem(
          isJapanese() ? "バンドル" : "Bundles",
          `${this.skillIndex.bundles.length} bundles`,
          vscode.TreeItemCollapsibleState.Collapsed,
          "bundleSection",
        );
        bundleItem.iconPath = new vscode.ThemeIcon(
          "package",
          new vscode.ThemeColor("charts.purple"),
        );
        items.push(bundleItem);
      }

      // 4. その他のソース (community)
      for (const source of communitySources) {
        items.push(createSourceItem(source));
      }

      return items;
    }

    // Bundleセクション配下: Bundle一覧
    if (element.contextValue === "bundleSection") {
      const isJa = isJapanese();
      return (this.skillIndex.bundles || []).map((bundle) => {
        const item = new SkillTreeItem(
          bundle.name,
          isJa && bundle.description_ja
            ? bundle.description_ja
            : bundle.description,
          vscode.TreeItemCollapsibleState.Collapsed,
          "bundle",
          undefined,
          undefined,
          bundle,
        );
        item.iconPath = new vscode.ThemeIcon(
          "package",
          new vscode.ThemeColor("charts.purple"),
        );
        return item;
      });
    }

    // Bundle配下: そのBundleのスキル一覧
    if (element.contextValue === "bundle" && element.bundle) {
      const isJa = isJapanese();
      // bundle.skills 配列にあるスキル名でマッチング
      const bundleSkillNames = element.bundle.skills || [];
      let bundleSkills = this.skillIndex.skills.filter(
        (skill) =>
          bundleSkillNames.includes(skill.name) ||
          bundleSkillNames.includes(skill.path) ||
          bundleSkillNames.some(
            (bName: string) =>
              skill.name.toLowerCase() === bName.toLowerCase() ||
              skill.path.toLowerCase().includes(bName.toLowerCase()),
          ),
      );

      // マッチするスキルがない場合、同じソースのスキルを表示
      if (bundleSkills.length === 0 && element.bundle.source) {
        bundleSkills = this.skillIndex.skills.filter(
          (skill) => skill.source === element.bundle!.source,
        );
      }

      // それでもない場合はメッセージを表示
      if (bundleSkills.length === 0) {
        return [
          new SkillTreeItem(
            isJa ? "スキルが見つかりません" : "No skills found",
            isJa
              ? "このバンドルのスキルはインデックスに登録されていません"
              : "Skills for this bundle are not indexed",
            vscode.TreeItemCollapsibleState.None,
            "placeholder",
          ),
        ];
      }

      return bundleSkills.map((skill) => {
        const isInstalled = this.installedSkillNames.has(
          skill.name.toLowerCase(),
        );
        const isCore = skill.name === element.bundle!.coreSkill;
        const prefix = isCore ? "⭐ " : skill.standalone === false ? "🔗 " : "";

        const item = new SkillTreeItem(
          isInstalled ? `✓ ${prefix}${skill.name}` : `${prefix}${skill.name}`,
          getLocalizedDescription(skill, isJa),
          vscode.TreeItemCollapsibleState.None,
          "skill",
          skill,
          undefined,
          undefined,
          this.skillIndex?.categories,
        );

        if (isInstalled) {
          item.iconPath = new vscode.ThemeIcon(
            "package",
            new vscode.ThemeColor("charts.green"),
          );
        } else {
          item.iconPath = new vscode.ThemeIcon("package");
          const singleClickInstall = vscode.workspace
            .getConfiguration("skillNinja")
            .get<boolean>("singleClickInstall", false);
          item.command = {
            command: singleClickInstall
              ? "skillNinja.install"
              : "skillNinja.onSkillClick",
            title: "Install Skill",
            arguments: [skill],
          };
        }

        // 依存関係をツールチップに追加（既存のツールチップに追記）
        if (skill.requires?.length) {
          const requiresLabel = isJa ? "依存" : "Requires";
          item.tooltip = `${item.tooltip}\n\n${requiresLabel}: ${skill.requires.join(", ")}`;
        }

        return item;
      });
    }

    // Favorites 配下
    if (element.contextValue === "favorites") {
      const favorites = this.context.globalState.get<string[]>("favorites", []);
      const isJa = isJapanese();
      const favoriteSkills = this.skillIndex.skills.filter((skill) =>
        favorites.includes(getSkillId(skill)),
      );

      return favoriteSkills.map((skill) => {
        const isInstalled = this.installedSkillNames.has(
          skill.name.toLowerCase(),
        );
        const item = new SkillTreeItem(
          isInstalled ? `✓ ${skill.name}` : skill.name,
          getLocalizedDescription(skill, isJa),
          vscode.TreeItemCollapsibleState.None,
          "skill",
          skill,
          undefined,
          undefined,
          this.skillIndex?.categories,
        );
        if (isInstalled) {
          item.iconPath = new vscode.ThemeIcon(
            "package",
            new vscode.ThemeColor("charts.green"),
          );
        } else {
          item.iconPath = new vscode.ThemeIcon("package");
          // シングルクリックインストールが有効な場合は直接インストール、そうでなければダブルクリック検出
          const singleClickInstall = vscode.workspace
            .getConfiguration("skillNinja")
            .get<boolean>("singleClickInstall", false);
          item.command = {
            command: singleClickInstall
              ? "skillNinja.install"
              : "skillNinja.onSkillClick",
            title: "Install Skill",
            arguments: [skill],
          };
        }
        return item;
      });
    }

    if (element.contextValue === "source" && element.source) {
      // ソース配下: そのソースのスキル一覧
      const skills = this.skillIndex.skills.filter(
        (s) => s.source === element.source!.id,
      );
      const isJa = isJapanese();
      return skills.map((skill) => {
        const isInstalled = this.installedSkillNames.has(
          skill.name.toLowerCase(),
        );
        const item = new SkillTreeItem(
          isInstalled ? `✓ ${skill.name}` : skill.name,
          getLocalizedDescription(skill, isJa),
          vscode.TreeItemCollapsibleState.None,
          "skill",
          skill,
          undefined,
          undefined,
          this.skillIndex?.categories,
        );
        // インストール済みは緑色アイコン
        if (isInstalled) {
          item.iconPath = new vscode.ThemeIcon(
            "package",
            new vscode.ThemeColor("charts.green"),
          );
        } else {
          item.iconPath = new vscode.ThemeIcon("package");
          // シングルクリックインストールが有効な場合は直接インストール、そうでなければダブルクリック検出
          const singleClickInstall = vscode.workspace
            .getConfiguration("skillNinja")
            .get<boolean>("singleClickInstall", false);
          item.command = {
            command: singleClickInstall
              ? "skillNinja.install"
              : "skillNinja.onSkillClick",
            title: "Install Skill",
            arguments: [skill],
          };
        }
        return item;
      });
    }

    return [];
  }

  private getSkillCountForSource(sourceId: string): number {
    if (!this.skillIndex) {
      return 0;
    }
    return this.skillIndex.skills.filter((s) => s.source === sourceId).length;
  }
}

/**
 * ツリーアイテム
 */
export class SkillTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly description: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    public readonly skill?: Skill,
    public readonly source?: Source,
    public readonly bundle?: Bundle,
    public readonly categories?: Category[],
    public readonly skillRoot?: SkillRoot,
    public readonly scope?: SkillScope,
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.contextValue = contextValue;

    // アイコン設定
    if (contextValue === "source") {
      this.iconPath = new vscode.ThemeIcon("repo");
    } else if (contextValue === "skill") {
      this.iconPath = new vscode.ThemeIcon("package");
    } else if (contextValue === "installedSkill") {
      this.iconPath = new vscode.ThemeIcon("check");
    } else if (contextValue === "bundle") {
      this.iconPath = new vscode.ThemeIcon("package");
    }

    // ツールチップ
    if (skill) {
      const isJa = isJapanese();
      const localizedDesc = getLocalizedDescription(skill, isJa);

      // メタデータ情報を構築
      let metaInfo = "";
      if (skill.author) {
        metaInfo += `\n${isJa ? "作成者" : "Author"}: ${skill.author}`;
      }
      if (skill.license) {
        metaInfo += `\n${isJa ? "ライセンス" : "License"}: ${skill.license}`;
      }
      if (skill.version) {
        metaInfo += `\nVersion: ${skill.version}`;
      }

      this.tooltip = `${skill.name}\n${localizedDesc}${metaInfo}`;
    } else if (source) {
      const isJa = isJapanese();
      const localizedDesc =
        isJa && source.description_ja
          ? source.description_ja
          : source.description;
      this.tooltip = `${source.name}\n${localizedDesc}\n${source.url}`;
    } else if (bundle) {
      const isJa = isJapanese();
      const skillsLabel = isJa ? "スキル" : "Skills";
      this.tooltip = `${bundle.name}\n${
        isJa && bundle.description_ja
          ? bundle.description_ja
          : bundle.description
      }\n${skillsLabel}: ${bundle.skills.join(", ")}`;
    } else if (contextValue === "skillRootGroup" && skillRoot) {
      this.tooltip = skillRoot.displayPath;
    }
  }
}
