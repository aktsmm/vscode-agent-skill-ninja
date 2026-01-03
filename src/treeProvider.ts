// サイドバー TreeView プロバイダー
// ワークスペーススキル（統合）とブラウズ用のツリービューを提供

import * as vscode from "vscode";
import { SkillIndex, Skill, loadSkillIndex, Source } from "./skillIndex";
import { getInstalledSkillsWithMeta } from "./skillInstaller";
import { LocalSkill, scanLocalSkills } from "./localSkillScanner";

/**
 * ワークスペーススキル情報（統合型）
 */
export interface WorkspaceSkill {
  name: string;
  description: string;
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

  constructor(private workspaceUri: vscode.Uri | undefined) {}

  refresh(): void {
    this.workspaceSkills = [];
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SkillTreeItem): vscode.TreeItem {
    return element;
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
            "No skills found",
            "Use 'Search Skills' to install skills",
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
          `${statusIcon} ${skill.name}`,
          skill.relativePath,
          vscode.TreeItemCollapsibleState.None,
          skill.isInstalled ? "installedSkill" : "localSkill",
          {
            name: skill.name,
            description: skill.description,
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
          ? "Installed"
          : skill.isRegistered
          ? "Local (Registered)"
          : "Local (Not registered)";
        item.tooltip = `${skill.name}\n${
          skill.description || "No description"
        }\nPath: ${skill.relativePath}\nStatus: ${statusText}`;

        // クリックで SKILL.md を開く
        item.command = {
          command: "vscode.open",
          title: "Open SKILL.md",
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
        source: isInstalled ? "installed" : "local",
        categories: local.categories,
      });
    }

    // インストール済みスキルのメタデータで補完
    for (const meta of installedMeta) {
      const existing = skillMap.get(meta.name);
      if (existing) {
        // メタデータがあれば補完
        existing.description = meta.description || existing.description;
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

  constructor(private context: vscode.ExtensionContext) {}

  refresh(): void {
    this.skillIndex = undefined;
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

    if (!element) {
      // ルートレベル: ソース一覧
      return this.skillIndex.sources.map(
        (source) =>
          new SkillTreeItem(
            source.name,
            `${this.getSkillCountForSource(source.id)} skills`,
            vscode.TreeItemCollapsibleState.Collapsed,
            "source",
            undefined,
            source
          )
      );
    }

    if (element.contextValue === "source" && element.source) {
      // ソース配下: そのソースのスキル一覧
      const skills = this.skillIndex.skills.filter(
        (s) => s.source === element.source!.id
      );
      return skills.map(
        (skill) =>
          new SkillTreeItem(
            skill.name,
            skill.description,
            vscode.TreeItemCollapsibleState.None,
            "skill",
            skill
          )
      );
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
      this.tooltip = `${skill.name}\n${skill.description}\nCategories: ${
        skill.categories?.join(", ") || ""
      }`;
    } else if (source) {
      this.tooltip = `${source.name}\n${source.description}\n${source.url}`;
    }
  }
}
