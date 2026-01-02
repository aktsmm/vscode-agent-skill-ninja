// スキルインデックスの管理
// プリインストールされたインデックスと更新可能なローカルインデックスを管理

import * as vscode from "vscode";

// スキル情報の型定義
export interface Skill {
  name: string;
  source: string;
  path: string;
  categories: string[];
  description: string;
}

// ソース情報の型定義
export interface Source {
  id: string;
  name: string;
  url: string;
  type: string;
  description: string;
}

// カテゴリ情報の型定義
export interface Category {
  id: string;
  name: string;
  description: string;
}

// インデックス全体の型定義
export interface SkillIndex {
  version: string;
  lastUpdated: string;
  sources: Source[];
  skills: Skill[];
  categories: Category[];
}

/**
 * スキルインデックスを読み込む
 * 1. globalStorageUri にローカルインデックスがあればそれを使用
 * 2. なければバンドルされたインデックスをコピーして使用
 */
export async function loadSkillIndex(
  context: vscode.ExtensionContext
): Promise<SkillIndex> {
  const localIndexPath = vscode.Uri.joinPath(
    context.globalStorageUri,
    "skill-index.json"
  );

  try {
    // ローカルインデックスを読み込む
    const content = await vscode.workspace.fs.readFile(localIndexPath);
    return JSON.parse(Buffer.from(content).toString("utf-8"));
  } catch {
    // ローカルにない場合はバンドルされたインデックスを使用
    const bundledIndexPath = vscode.Uri.joinPath(
      context.extensionUri,
      "resources",
      "skill-index.json"
    );

    try {
      const content = await vscode.workspace.fs.readFile(bundledIndexPath);
      const index = JSON.parse(Buffer.from(content).toString("utf-8"));

      // ローカルにコピー
      await vscode.workspace.fs.createDirectory(context.globalStorageUri);
      await vscode.workspace.fs.writeFile(localIndexPath, content);

      return index;
    } catch {
      // バンドルされたインデックスもない場合は空のインデックスを返す
      console.warn("No skill index found, using empty index");
      return {
        version: "1.0.0",
        lastUpdated: new Date().toISOString().split("T")[0],
        sources: [],
        skills: [],
        categories: [],
      };
    }
  }
}

/**
 * スキルインデックスを保存する
 */
export async function saveSkillIndex(
  context: vscode.ExtensionContext,
  index: SkillIndex
): Promise<void> {
  const localIndexPath = vscode.Uri.joinPath(
    context.globalStorageUri,
    "skill-index.json"
  );
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);
  await vscode.workspace.fs.writeFile(
    localIndexPath,
    Buffer.from(JSON.stringify(index, null, 2), "utf-8")
  );
}

/**
 * ソース情報からスキルの GitHub URL を取得する
 */
export function getSkillGitHubUrl(
  skill: Skill,
  sources: Source[]
): string | undefined {
  const source = sources.find((s) => s.id === skill.source);
  if (!source) {
    return undefined;
  }

  // GitHub URL からスキルへの直接リンクを構築
  const baseUrl = source.url.replace(/\/$/, "");
  return `${baseUrl}/tree/main/${skill.path}`;
}

/**
 * スキルの raw ファイル URL を取得する
 */
export function getSkillRawUrl(
  skill: Skill,
  sources: Source[],
  fileName: string = "SKILL.md"
): string | undefined {
  const source = sources.find((s) => s.id === skill.source);
  if (!source) {
    return undefined;
  }

  // GitHub raw URL を構築
  // https://github.com/owner/repo → https://raw.githubusercontent.com/owner/repo/main/path/file
  const match = source.url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    return undefined;
  }

  const [, owner, repo] = match;
  return `https://raw.githubusercontent.com/${owner}/${repo}/main/${skill.path}/${fileName}`;
}
