// スキルインデックスの管理
// プリインストールされたインデックスと更新可能なローカルインデックスを管理

import * as vscode from "vscode";

// スキル情報の型定義
export interface Skill {
  name: string;
  source: string;
  path: string;
  categories: string[];
  description: string; // 英語説明（デフォルト）
  description_ja?: string; // 日本語説明（オプション）
  url?: string; // GitHub URL (for preview/favorites)
  rawUrl?: string; // Raw content URL
  stars?: number; // GitHub stars count
  owner?: string; // Repository owner (user or org)
  isOrg?: boolean; // Whether owner is an organization
}

/**
 * 言語に応じたスキルの説明を取得
 */
export function getLocalizedDescription(skill: Skill, isJa: boolean): string {
  if (isJa && skill.description_ja) {
    return skill.description_ja;
  }
  return skill.description;
}

// ソース情報の型定義
export interface Source {
  id: string;
  name: string;
  url: string;
  type: string;
  branch?: string; // デフォルトブランチ（省略時は"main"）
  description: string;
  description_ja?: string; // 日本語説明（オプション）
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
 * 3. バンドル版のバージョンが新しければソースをマージ
 */
export async function loadSkillIndex(
  context: vscode.ExtensionContext
): Promise<SkillIndex> {
  const localIndexPath = vscode.Uri.joinPath(
    context.globalStorageUri,
    "skill-index.json"
  );

  // バンドルされたインデックスを読み込む
  const bundledIndexPath = vscode.Uri.joinPath(
    context.extensionUri,
    "resources",
    "skill-index.json"
  );

  let bundledIndex: SkillIndex | null = null;
  try {
    const bundledContent = await vscode.workspace.fs.readFile(bundledIndexPath);
    bundledIndex = JSON.parse(Buffer.from(bundledContent).toString("utf-8"));
  } catch {
    // バンドルがなければ null のまま
  }

  try {
    // ローカルインデックスを読み込む
    const content = await vscode.workspace.fs.readFile(localIndexPath);
    const localIndex: SkillIndex = JSON.parse(
      Buffer.from(content).toString("utf-8")
    );

    // バンドル版がある場合は常にマージ（description_ja の補完のため）
    if (bundledIndex) {
      const mergedIndex = mergeSkillIndexes(localIndex, bundledIndex);
      // バージョンが新しい場合、または description_ja が追加された場合に保存
      if (bundledIndex.version > localIndex.version) {
        await saveSkillIndex(context, mergedIndex);
      }
      return mergedIndex;
    }

    return localIndex;
  } catch {
    // ローカルにない場合はバンドルされたインデックスを使用
    if (bundledIndex) {
      // ローカルにコピー
      await vscode.workspace.fs.createDirectory(context.globalStorageUri);
      await vscode.workspace.fs.writeFile(
        localIndexPath,
        Buffer.from(JSON.stringify(bundledIndex, null, 2), "utf-8")
      );
      return bundledIndex;
    }

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

/**
 * 2つのスキルインデックスをマージ
 * バンドル版の新しいソースをローカル版に追加
 * 既存スキルの多言語説明も更新
 */
function mergeSkillIndexes(
  localIndex: SkillIndex,
  bundledIndex: SkillIndex
): SkillIndex {
  // ローカルのソース ID セット
  const localSourceIds = new Set(localIndex.sources.map((s) => s.id));

  // バンドル版の新しいソースを追加
  const newSources = bundledIndex.sources.filter(
    (s) => !localSourceIds.has(s.id)
  );

  // 既存ソースの説明を更新（description_ja を追加）
  const updatedSources = localIndex.sources.map((localSource) => {
    const bundledSource = bundledIndex.sources.find(
      (s) => s.id === localSource.id
    );
    if (bundledSource) {
      return {
        ...localSource,
        description: bundledSource.description,
        description_ja:
          bundledSource.description_ja || localSource.description_ja,
      };
    }
    return localSource;
  });

  // バンドル版の新しいスキルを追加（新ソースからのもの）
  const newSourceIds = new Set(newSources.map((s) => s.id));
  const newSkills = bundledIndex.skills.filter((s) =>
    newSourceIds.has(s.source)
  );

  // 既存スキルの説明を更新（description と description_ja をマージ）
  const updatedSkills = localIndex.skills.map((localSkill) => {
    const bundledSkill = bundledIndex.skills.find(
      (s) => s.name === localSkill.name
    );
    if (bundledSkill) {
      return {
        ...localSkill,
        description: bundledSkill.description,
        description_ja:
          bundledSkill.description_ja || localSkill.description_ja,
      };
    }
    return localSkill;
  });

  return {
    ...localIndex,
    version: bundledIndex.version,
    sources: [...updatedSources, ...newSources],
    skills: [...updatedSkills, ...newSkills],
  };
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
