// スキルインストール機能
// GitHub からスキルをダウンロードしてワークスペースに配置

import * as vscode from "vscode";
import { Skill, loadSkillIndex, getSkillRawUrl } from "./skillIndex";

/**
 * スキルをインストールする
 * GitHub からスキルファイルをダウンロードしてワークスペースに配置
 */
export async function installSkill(
  skill: Skill,
  workspaceUri: vscode.Uri,
  context: vscode.ExtensionContext
): Promise<void> {
  const config = vscode.workspace.getConfiguration("skillFinder");
  const skillsDir = config.get<string>("skillsDirectory") || ".github/skills";

  // スキルディレクトリを作成
  const skillPath = vscode.Uri.joinPath(workspaceUri, skillsDir, skill.name);
  await vscode.workspace.fs.createDirectory(skillPath);

  // インデックスからソース情報を取得
  const index = await loadSkillIndex(context);

  // SKILL.md をダウンロード
  const skillMdUrl = getSkillRawUrl(skill, index.sources, "SKILL.md");
  if (skillMdUrl) {
    try {
      const content = await fetchFileContent(skillMdUrl);
      const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
      await vscode.workspace.fs.writeFile(
        skillMdPath,
        Buffer.from(content, "utf-8")
      );
    } catch {
      // SKILL.md がない場合は簡易的なファイルを作成
      const fallbackContent = `# ${skill.name}\n\n${skill.description}\n\nSource: ${skill.source}\n`;
      const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
      await vscode.workspace.fs.writeFile(
        skillMdPath,
        Buffer.from(fallbackContent, "utf-8")
      );
    }
  } else {
    // URL が取得できない場合は簡易的なファイルを作成
    const fallbackContent = `# ${skill.name}\n\n${skill.description}\n\nSource: ${skill.source}\n`;
    const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
    await vscode.workspace.fs.writeFile(
      skillMdPath,
      Buffer.from(fallbackContent, "utf-8")
    );
  }

  // メタデータを保存（description などを後で取得できるように）
  const metaPath = vscode.Uri.joinPath(skillPath, ".skill-meta.json");
  const meta = {
    name: skill.name,
    source: skill.source,
    description: skill.description,
    categories: skill.categories,
    installedAt: new Date().toISOString(),
  };
  await vscode.workspace.fs.writeFile(
    metaPath,
    Buffer.from(JSON.stringify(meta, null, 2), "utf-8")
  );
}

/**
 * スキルをアンインストールする
 */
export async function uninstallSkill(
  skillName: string,
  workspaceUri: vscode.Uri
): Promise<void> {
  const config = vscode.workspace.getConfiguration("skillFinder");
  const skillsDir = config.get<string>("skillsDirectory") || ".github/skills";

  const skillPath = vscode.Uri.joinPath(workspaceUri, skillsDir, skillName);

  try {
    await vscode.workspace.fs.delete(skillPath, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to delete skill directory: ${error}`);
  }
}

/**
 * インストール済みスキルの一覧を取得
 */
export async function getInstalledSkills(
  workspaceUri: vscode.Uri
): Promise<string[]> {
  const config = vscode.workspace.getConfiguration("skillFinder");
  const skillsDir = config.get<string>("skillsDirectory") || ".github/skills";

  const skillsPath = vscode.Uri.joinPath(workspaceUri, skillsDir);

  try {
    const entries = await vscode.workspace.fs.readDirectory(skillsPath);
    // ディレクトリのみを返す
    return entries
      .filter(([, type]) => type === vscode.FileType.Directory)
      .map(([name]) => name);
  } catch {
    // ディレクトリが存在しない場合は空配列
    return [];
  }
}

/**
 * スキルのメタデータ
 */
export interface SkillMeta {
  name: string;
  source: string;
  description: string;
  categories: string[];
  installedAt: string;
}

/**
 * インストール済みスキルのメタデータを取得
 */
export async function getInstalledSkillsWithMeta(
  workspaceUri: vscode.Uri
): Promise<SkillMeta[]> {
  const config = vscode.workspace.getConfiguration("skillFinder");
  const skillsDir = config.get<string>("skillsDirectory") || ".github/skills";
  const skillsPath = vscode.Uri.joinPath(workspaceUri, skillsDir);

  try {
    const entries = await vscode.workspace.fs.readDirectory(skillsPath);
    const dirs = entries.filter(
      ([, type]) => type === vscode.FileType.Directory
    );

    const metas: SkillMeta[] = [];
    for (const [name] of dirs) {
      const metaPath = vscode.Uri.joinPath(
        skillsPath,
        name,
        ".skill-meta.json"
      );
      try {
        const content = await vscode.workspace.fs.readFile(metaPath);
        const meta = JSON.parse(Buffer.from(content).toString("utf-8"));
        metas.push(meta);
      } catch {
        // メタデータがない場合はデフォルト値
        metas.push({
          name,
          source: "unknown",
          description: "",
          categories: [],
          installedAt: "",
        });
      }
    }
    return metas;
  } catch {
    return [];
  }
}

/**
 * URL からファイル内容を取得
 */
async function fetchFileContent(url: string): Promise<string> {
  // VS Code の fetch API を使用（Node.js 18+ の fetch）
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return await response.text();
}
