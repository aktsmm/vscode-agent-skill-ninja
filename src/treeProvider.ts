// サイドバー TreeView プロバイダー
// インストール済みスキルとブラウズ用のツリービューを提供

import * as vscode from "vscode";
import { SkillIndex, Skill, loadSkillIndex, Source } from "./skillIndex";
import { getInstalledSkills } from "./skillInstaller";

/**
 * インストール済みスキルのツリービュー
 */
export class InstalledSkillsProvider
  implements vscode.TreeDataProvider<SkillTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    SkillTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private workspaceUri: vscode.Uri | undefined) {}

  refresh(): void {
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
      // ルートレベル: インストール済みスキル一覧
      const installed = await getInstalledSkills(this.workspaceUri);
      return installed.map(
        (name) =>
          new SkillTreeItem(
            name,
            "",
            vscode.TreeItemCollapsibleState.None,
            "installedSkill",
            { name, source: "", path: "", categories: [], description: "" }
          )
      );
    }

    return [];
  }
}

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
      this.tooltip = `${skill.name}\n${
        skill.description
      }\nCategories: ${skill.categories.join(", ")}`;
    } else if (source) {
      this.tooltip = `${source.name}\n${source.description}\n${source.url}`;
    }
  }
}
