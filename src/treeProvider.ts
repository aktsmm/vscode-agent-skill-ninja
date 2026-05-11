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
import { getManagedSkillRoots, SkillRoot, SkillScope } from "./skillLocations";

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
      element.scope &&
      element.contextValue !== "skillScopeGroup" &&
      element.contextValue !== "placeholder"
    ) {
      const group = this.buildScopeGroupItems().find(
        (item) => item.scope === element.scope,
      );
      return group;
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

      return this.buildScopeGroupItems();
    }

    if (element.contextValue === "skillScopeGroup" && element.scope) {
      return this.workspaceSkills
        .filter((skill) => skill.scope === element.scope)
        .map((skill) => this.toSkillItem(skill));
    }

    return [];
  }

  private buildScopeGroupItems(): SkillTreeItem[] {
    const items: SkillTreeItem[] = [];
    const scopeOrder: SkillScope[] = ["workspace", "userGlobal", "builtIn"];

    for (const scope of scopeOrder) {
      const skillsInScope = this.workspaceSkills.filter(
        (skill) => skill.scope === scope,
      );
      if (skillsInScope.length === 0) {
        continue;
      }

      const item = new SkillTreeItem(
        this.getScopeLabel(scope),
        isJapanese()
          ? `${skillsInScope.length} 件のスキル`
          : `${skillsInScope.length} skills`,
        vscode.TreeItemCollapsibleState.Expanded,
        "skillScopeGroup",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        scope,
      );
      item.iconPath = new vscode.ThemeIcon(this.getScopeIcon(scope));
      items.push(item);
    }

    return items;
  }

  private getScopeLabel(scope: SkillScope): string {
    switch (scope) {
      case "workspace":
        return isJapanese() ? "ワークスペース スキル" : "Workspace Skills";
      case "userGlobal":
        return isJapanese()
          ? "ユーザー / グローバル スキル"
          : "User / Global Skills";
      case "builtIn":
        return isJapanese() ? "組み込みスキル" : "Built-in Skills";
      default:
        return "Skills";
    }
  }

  private getScopeIcon(scope: SkillScope): string {
    switch (scope) {
      case "workspace":
        return "repo";
      case "userGlobal":
        return "globe";
      case "builtIn":
        return "library";
      default:
        return "package";
    }
  }

  private toSkillItem(skill: WorkspaceSkill): SkillTreeItem {
    const isRecent = this.recentlyInstalled?.has(skill.name) ?? false;
    const newBadge = isRecent ? "🆕 " : "";
    const statusPrefix = skill.isReadOnly
      ? ""
      : skill.isRegistered
        ? "✓ "
        : "○ ";
    const contextValue = skill.isReadOnly
      ? "builtInSkill"
      : skill.isRegistered
        ? "managedSkill"
        : "managedUnregisteredSkill";

    const localizedDescription = isJapanese()
      ? skill.description_ja || skill.description
      : skill.description;

    const item = new SkillTreeItem(
      `${newBadge}${statusPrefix}${skill.name}`,
      skill.displayPath,
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
      metaLines.push(
        `${isJapanese() ? "License" : "License"}: ${skill.license}`,
      );
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
   * ワークスペース内の全スキルを読み込み
   */
  private async loadWorkspaceSkills(): Promise<void> {
    if (!this.workspaceUri) {
      return;
    }

    const visibleSkills = await scanVisibleSkills(this.workspaceUri);
    this.workspaceSkills = visibleSkills.map((skill) => ({
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
    }));
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
    } else if (contextValue === "skillScopeGroup" && scope) {
      this.tooltip = this.label;
    }
  }
}
