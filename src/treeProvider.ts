// サイドバー TreeView プロバイダー
// ワークスペーススキル（統合）とブラウズ用のツリービューを提供

import * as vscode from "vscode";
import {
  SkillIndex,
  Skill,
  loadSkillIndex,
  Source,
  getLocalizedDescription,
} from "./skillIndex";
import {
  getInstalledSkillsWithMeta,
  getInstalledSkills,
} from "./skillInstaller";
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
}

/**
 * ワークスペーススキル統合ビュー
 * - インストール済みスキル (.github/skills 配下)
 * - ローカルスキル (それ以外の SKILL.md)
 * を統合表示
 */
export class WorkspaceSkillsProvider
  implements vscode.TreeDataProvider<SkillTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    SkillTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private workspaceSkills: WorkspaceSkill[] = [];

  constructor(
    private workspaceUri: vscode.Uri | undefined,
    private recentlyInstalled?: Set<string>
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
            "placeholder"
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
          } as Skill & Partial<LocalSkill>
        );

        item.iconPath = new vscode.ThemeIcon(iconId, iconColor);

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
        item.tooltip = `${skill.name}\n${descText}\n${pathLabel}: ${skill.relativePath}\n${statusLabel}: ${statusText}`;

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
export class BrowseSkillsProvider
  implements vscode.TreeDataProvider<SkillTreeItem>
{
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

  getTreeItem(element: SkillTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SkillTreeItem): Promise<SkillTreeItem[]> {
    // インデックスを読み込む
    if (!this.skillIndex) {
      this.skillIndex = await loadSkillIndex(this.context);
    }

    // インストール済みスキルを取得
    if (this.installedSkillNames.size === 0) {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (wsFolder) {
        const installed = await getInstalledSkills(wsFolder.uri);
        installed.forEach((name: string) =>
          this.installedSkillNames.add(name.toLowerCase())
        );
      }
    }

    if (!element) {
      // ルートレベル: Favorites + ソース一覧
      const items: SkillTreeItem[] = [];

      // お気に入りセクション
      const favorites = this.context.globalState.get<string[]>("favorites", []);
      if (favorites.length > 0) {
        const favItem = new SkillTreeItem(
          isJapanese() ? "お気に入り" : "Favorites",
          `${favorites.length} skills`,
          vscode.TreeItemCollapsibleState.Collapsed,
          "favorites"
        );
        favItem.iconPath = new vscode.ThemeIcon(
          "star-full",
          new vscode.ThemeColor("charts.yellow")
        );
        items.push(favItem);
      }

      // ソース一覧（タイプ順: official → awesome-list → community）
      const sortedSources = [...this.skillIndex.sources].sort((a, b) => {
        const priority: Record<string, number> = {
          official: 0,
          "awesome-list": 1,
          community: 2,
        };
        return (priority[a.type] ?? 99) - (priority[b.type] ?? 99);
      });

      for (const source of sortedSources) {
        const item = new SkillTreeItem(
          source.name,
          `${this.getSkillCountForSource(source.id)} skills`,
          vscode.TreeItemCollapsibleState.Collapsed,
          "source",
          undefined,
          source
        );
        // ソースタイプによってアイコンを変更
        if (source.type === "official") {
          item.iconPath = new vscode.ThemeIcon(
            "verified",
            new vscode.ThemeColor("charts.blue")
          );
        } else if (source.type === "awesome-list") {
          item.iconPath = new vscode.ThemeIcon(
            "star",
            new vscode.ThemeColor("charts.yellow")
          );
        } else {
          item.iconPath = new vscode.ThemeIcon("repo");
        }
        items.push(item);
      }

      return items;
    }

    // Favorites 配下
    if (element.contextValue === "favorites") {
      const favorites = this.context.globalState.get<string[]>("favorites", []);
      const isJa = isJapanese();
      const favoriteSkills = this.skillIndex.skills.filter((skill) =>
        favorites.includes(getSkillId(skill))
      );

      return favoriteSkills.map((skill) => {
        const isInstalled = this.installedSkillNames.has(
          skill.name.toLowerCase()
        );
        const item = new SkillTreeItem(
          isInstalled ? `✓ ${skill.name}` : skill.name,
          getLocalizedDescription(skill, isJa),
          vscode.TreeItemCollapsibleState.None,
          "skill",
          skill
        );
        if (isInstalled) {
          item.iconPath = new vscode.ThemeIcon(
            "package",
            new vscode.ThemeColor("charts.green")
          );
        } else {
          item.iconPath = new vscode.ThemeIcon("package");
        }
        return item;
      });
    }

    if (element.contextValue === "source" && element.source) {
      // ソース配下: そのソースのスキル一覧
      const skills = this.skillIndex.skills.filter(
        (s) => s.source === element.source!.id
      );
      const isJa = isJapanese();
      return skills.map((skill) => {
        const isInstalled = this.installedSkillNames.has(
          skill.name.toLowerCase()
        );
        const item = new SkillTreeItem(
          isInstalled ? `✓ ${skill.name}` : skill.name,
          getLocalizedDescription(skill, isJa),
          vscode.TreeItemCollapsibleState.None,
          "skill",
          skill
        );
        // インストール済みは緑色アイコン
        if (isInstalled) {
          item.iconPath = new vscode.ThemeIcon(
            "package",
            new vscode.ThemeColor("charts.green")
          );
        } else {
          item.iconPath = new vscode.ThemeIcon("package");
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
    public readonly source?: Source
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
    }

    // ツールチップ
    if (skill) {
      const isJa = isJapanese();
      const categoriesLabel = isJa ? "カテゴリ" : "Categories";
      const localizedDesc = getLocalizedDescription(skill, isJa);
      this.tooltip = `${skill.name}\n${localizedDesc}\n${categoriesLabel}: ${
        skill.categories?.join(", ") || ""
      }`;
    } else if (source) {
      this.tooltip = `${source.name}\n${source.description}\n${source.url}`;
    }
  }
}
