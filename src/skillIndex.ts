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
  // Bundle/Framework 対応
  standalone?: boolean; // false = 単体では動作しない（デフォルト true）
  requires?: string[]; // 依存スキル名のリスト
  bundle?: string; // 所属 Bundle ID
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

// Bundle情報の型定義
export interface Bundle {
  id: string;
  name: string;
  source: string; // ソースID
  description: string;
  description_ja?: string;
  skills: string[]; // 含まれるスキル名のリスト
  installOrder?: string[]; // インストール順序（依存解決済み）
  coreSkill?: string; // コアスキル（最初にインストール必須）
}

// インデックス全体の型定義
export interface SkillIndex {
  version: string;
  lastUpdated: string;
  sources: Source[];
  skills: Skill[];
  categories: Category[];
  bundles?: Bundle[]; // Bundle一覧
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

// デフォルトブランチのキャッシュ（リポジトリURL → ブランチ名）
const branchCache = new Map<string, string>();

/**
 * URL が存在するか HEAD リクエストで確認
 */
async function checkUrlExists(url: string, token?: string): Promise<boolean> {
  const headers: Record<string, string> = {
    "User-Agent": "VSCode-SkillNinja",
  };
  if (token) {
    headers["Authorization"] = `token ${token}`;
  }

  try {
    const response = await fetch(url, { method: "HEAD", headers });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * GitHub リポジトリのデフォルトブランチを取得する
 * 1. キャッシュがあればそれを返す
 * 2. skill-index.json に設定があればそれを使用
 * 3. main/master を HEAD リクエストで確認
 * 4. どちらもダメなら GitHub API で取得
 */
export async function getDefaultBranch(
  repoUrl: string,
  token?: string,
  testPath?: string // 存在確認用のパス（例: "skills/xxx/SKILL.md"）
): Promise<string> {
  // キャッシュチェック
  if (branchCache.has(repoUrl)) {
    return branchCache.get(repoUrl)!;
  }

  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    return "main"; // フォールバック
  }

  const [, owner, repo] = match;

  // HEAD リクエストで main/master を確認
  const branches = ["main", "master"];
  for (const branch of branches) {
    // testPath があればそれを使用、なければ README を確認
    const testFile = testPath || "README.md";
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${testFile}`;

    if (await checkUrlExists(rawUrl, token)) {
      branchCache.set(repoUrl, branch);
      return branch;
    }
  }

  // HEAD リクエストで判定できない場合は GitHub API で取得
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "VSCode-SkillNinja",
  };

  if (token) {
    headers["Authorization"] = `token ${token}`;
  }

  try {
    const response = await fetch(apiUrl, { headers });
    if (response.ok) {
      const data = (await response.json()) as { default_branch?: string };
      const branch = data.default_branch || "main";
      branchCache.set(repoUrl, branch);
      return branch;
    }
  } catch {
    // API エラー時はフォールバック
  }

  // フォールバック
  branchCache.set(repoUrl, "main");
  return "main";
}

/**
 * ソースのブランチを取得（キャッシュ or HEAD確認 or API）
 */
export async function getSourceBranch(
  source: Source,
  token?: string,
  skillPath?: string // 存在確認用のスキルパス
): Promise<string> {
  // skill-index.json に明示的に設定されていればそれを使用
  if (source.branch) {
    return source.branch;
  }
  // HEAD リクエストまたは API で動的取得
  // パスが .md で終わる場合はそのまま使用、そうでなければ /SKILL.md を追加
  let testPath: string | undefined;
  if (skillPath) {
    testPath = skillPath.endsWith(".md") ? skillPath : `${skillPath}/SKILL.md`;
  }
  return await getDefaultBranch(source.url, token, testPath);
}

/**
 * ソース情報からスキルの GitHub URL を取得する（非同期版）
 */
export async function getSkillGitHubUrlAsync(
  skill: Skill,
  sources: Source[],
  token?: string
): Promise<string | undefined> {
  const source = sources.find((s) => s.id === skill.source);
  if (!source) {
    return undefined;
  }

  const branch = await getSourceBranch(source, token);
  const baseUrl = source.url.replace(/\/$/, "");
  return `${baseUrl}/tree/${branch}/${skill.path}`;
}

/**
 * ソース情報からスキルの GitHub URL を取得する（同期版 - フォールバック用）
 */
export function getSkillGitHubUrl(
  skill: Skill,
  sources: Source[]
): string | undefined {
  const source = sources.find((s) => s.id === skill.source);
  if (!source) {
    return undefined;
  }

  // キャッシュがあればそれを使用、なければ設定値か main
  const cachedBranch = branchCache.get(source.url);
  const branch = cachedBranch || source.branch || "main";
  const baseUrl = source.url.replace(/\/$/, "");
  return `${baseUrl}/tree/${branch}/${skill.path}`;
}

/**
 * スキルの raw ファイル URL を取得する（非同期版）
 */
export async function getSkillRawUrlAsync(
  skill: Skill,
  sources: Source[],
  fileName: string = "SKILL.md",
  token?: string
): Promise<string | undefined> {
  const source = sources.find((s) => s.id === skill.source);
  if (!source) {
    return undefined;
  }

  const match = source.url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    return undefined;
  }

  const [, owner, repo] = match;
  const branch = await getSourceBranch(source, token);
  // パスが .md で終わる場合はそのまま使用
  if (skill.path.endsWith(".md")) {
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${skill.path}`;
  }
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${skill.path}/${fileName}`;
}

/**
 * スキルの raw ファイル URL を取得する（同期版 - フォールバック用）
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
  const cachedBranch = branchCache.get(source.url);
  const branch = cachedBranch || source.branch || "main";
  // パスが .md で終わる場合はそのまま使用
  if (skill.path.endsWith(".md")) {
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${skill.path}`;
  }
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${skill.path}/${fileName}`;
}
