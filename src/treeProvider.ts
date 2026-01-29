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
  getLocalizedCategoryNames,
} from "./skillIndex";
import { getInstalledSkillsWithMeta } from "./skillInstaller";
import { LocalSkill, scanLocalSkills } from "./localSkillScanner";
import { isJapanese } from "./i18n";
import { getSkillId } from "./skillPreview";

/**
 * ワークスペーススキル情報（統合型）
 */
export interface WorkspaceSkill {
  name: string;
  description: string;
  description_ja?: string;
  relativePath: string;
  fullPath: string;
  isInstalled: boolean; // .github/skills 配下か
  isRegistered: boolean; // AGENTS.md に登録済みか
  source?: string; // インストール元ソース
  categories?: string[];
  // 公式仕様に基づくメタデータ
  license?: string; // ライセンス（例: MIT, Apache-2.0）
  author?: string; // 作成者
  version?: string; // バージョン
}

/**
 * ワークスペーススキル統合ビュー
 * - インストール済みスキル (.github/skills 配下)
 * - ローカルスキル (それ以外の SKILL.md)
 * を統合表示
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
    // リフレッシュ時に「最近インストール」をクリア（🆕バッジを消す）
    this.recentlyInstalled?.clear();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SkillTreeItem): vscode.TreeItem {
    return element;
  }

  // reveal() を使うために必要
  getParent(): SkillTreeItem | undefined {
    // フラットなリストなので親はなし
    return undefined;
  }

  async getChildren(element?: SkillTreeItem): Promise<SkillTreeItem[]> {
    if (!this.workspaceUri) {
      return [];
    }

    if (!element) {
      // ワークスペーススキルを取得
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

      return this.workspaceSkills.map((skill) => {
        // アイコンと状態表示
        let statusIcon: string;
        let iconId: string;
        let iconColor: vscode.ThemeColor;

        // 🆕 バッジ（最近インストールされたスキル）
        const isRecent = this.recentlyInstalled?.has(skill.name) ?? false;
        const newBadge = isRecent ? "🆕 " : "";

        if (skill.isInstalled) {
          // インストール済み（.github/skills 配下）
          statusIcon = "✓";
          iconId = "package";
          iconColor = new vscode.ThemeColor("charts.green");
        } else if (skill.isRegistered) {
          // ローカル & 登録済み
          statusIcon = "✓";
          iconId = "file-code";
          iconColor = new vscode.ThemeColor("charts.green");
        } else {
          // ローカル & 未登録
          statusIcon = "○";
          iconId = "file-code";
          iconColor = new vscode.ThemeColor("charts.yellow");
        }

        const item = new SkillTreeItem(
          `${newBadge}${statusIcon} ${skill.name}`,
          skill.isInstalled
            ? `installed from ${skill.source || "unknown"}`
            : skill.relativePath,
          vscode.TreeItemCollapsibleState.None,
          skill.isInstalled ? "installedSkill" : "localSkill",
          {
            name: skill.name,
            description: isJapanese()
              ? skill.description_ja || skill.description
              : skill.description,
            source: skill.source || "local",
            path: skill.relativePath,
            categories: skill.categories || [],
            // LocalSkill 互換プロパティ
            isLocal: !skill.isInstalled,
            fullPath: skill.fullPath,
            relativePath: skill.relativePath,
            isRegistered: skill.isRegistered,
          } as Skill & Partial<LocalSkill>,
        );

        item.iconPath = new vscode.ThemeIcon(iconId, iconColor);

        // resourceUri を設定（パスコピー用）
        item.resourceUri = vscode.Uri.file(skill.fullPath);

        // ツールチップ
        const statusText = skill.isInstalled
          ? isJapanese()
            ? "インストール済み"
            : "Installed"
          : skill.isRegistered
            ? isJapanese()
              ? "ローカル（登録済み）"
              : "Local (Registered)"
            : isJapanese()
              ? "ローカル（未登録）"
              : "Local (Not registered)";
        const noDesc = isJapanese() ? "説明なし" : "No description";
        const pathLabel = isJapanese() ? "パス" : "Path";
        const statusLabel = isJapanese() ? "状態" : "Status";
        // 日本語設定ならdescription_jaを優先
        const descText = isJapanese()
          ? skill.description_ja || skill.description || noDesc
          : skill.description || noDesc;

        // メタデータ情報を構築
        let metaInfo = "";
        if (skill.author) {
          metaInfo += `\n${isJapanese() ? "作成者" : "Author"}: ${skill.author}`;
        }
        if (skill.license) {
          metaInfo += `\n${isJapanese() ? "ライセンス" : "License"}: ${skill.license}`;
        }
        if (skill.version) {
          metaInfo += `\nVersion: ${skill.version}`;
        }

        item.tooltip = `${skill.name}\n${descText}\n${pathLabel}: ${skill.relativePath}\n${statusLabel}: ${statusText}${metaInfo}`;

        // クリックで SKILL.md を開く
        item.command = {
          command: "vscode.open",
          title: isJapanese() ? "SKILL.md を開く" : "Open SKILL.md",
          arguments: [vscode.Uri.file(skill.fullPath)],
        };

        return item;
      });
    }

    return [];
  }

  /**
   * ワークスペース内の全スキルを読み込み
   */
  private async loadWorkspaceSkills(): Promise<void> {
    if (!this.workspaceUri) {
      return;
    }

    const config = vscode.workspace.getConfiguration("skillNinja");
    const skillsDir = config.get<string>("skillsDirectory") || ".github/skills";

    // 1. 全 SKILL.md をスキャン（.github/skills 含む）
    const allLocalSkills = await scanLocalSkills(this.workspaceUri, true); // includeInstalled=true

    // 2. インストール済みスキル（メタデータ付き）
    const installedMeta = await getInstalledSkillsWithMeta(this.workspaceUri);

    // 3. 統合
    const skillMap = new Map<string, WorkspaceSkill>();

    // まず全てのスキャン結果を追加
    for (const local of allLocalSkills) {
      const isInstalled = local.relativePath.startsWith(skillsDir);
      skillMap.set(local.name, {
        name: local.name,
        description: local.description || "",
        relativePath: local.relativePath,
        fullPath: local.fullPath, // スキャン結果の実際のパスを使用
        isInstalled,
        isRegistered: local.isRegistered,
        source: isInstalled ? undefined : "local", // メタデータで上書きされる
        categories: local.categories,
      });
    }

    // インストール済みスキルのメタデータで補完
    for (const meta of installedMeta) {
      const existing = skillMap.get(meta.name);
      if (existing) {
        // メタデータがあれば補完
        existing.description = meta.description || existing.description;
        existing.description_ja = meta.description_ja;
        existing.source = meta.source || existing.source;
        existing.categories = meta.categories?.length
          ? meta.categories
          : existing.categories;
        existing.isInstalled = true;
        existing.isRegistered = true; // インストール済みは常に登録済み扱い
        // メタデータ情報を追加
        existing.license = meta.license;
        existing.author = meta.author;
        existing.version = meta.version;
      }
    }

    // ソート: インストール済み → ローカル登録済み → ローカル未登録
    this.workspaceSkills = Array.from(skillMap.values()).sort((a, b) => {
      const orderA = a.isInstalled ? 0 : a.isRegistered ? 1 : 2;
      const orderB = b.isInstalled ? 0 : b.isRegistered ? 1 : 2;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });
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
        const installedMeta = await getInstalledSkillsWithMeta(wsFolder.uri);
        installedMeta.forEach((meta) =>
          this.installedSkillNames.add(meta.name.toLowerCase()),
        );
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

        // 依存関係をツールチップに表示
        if (skill.requires?.length) {
          item.tooltip = `${skill.name}\n${getLocalizedDescription(
            skill,
            isJa,
          )}\n\n${isJa ? "依存:" : "Requires:"} ${skill.requires.join(", ")}`;
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
      const categoriesLabel = isJa ? "カテゴリ" : "Categories";
      const localizedDesc = getLocalizedDescription(skill, isJa);
      // カテゴリー名をローカライズ
      const categoryNames =
        skill.categories && categories
          ? getLocalizedCategoryNames(skill.categories, categories, isJa)
          : skill.categories || [];
      this.tooltip = `${
        skill.name
      }\n${localizedDesc}\n${categoriesLabel}: ${categoryNames.join(", ")}`;
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
    }
  }
}
