// インデックス更新とGitHub検索機能
// GitHub API を使用してスキルを検索・更新

import * as vscode from "vscode";
import { SkillIndex, Skill, Source, saveSkillIndex } from "./skillIndex";
import { messages } from "./i18n";

/**
 * gh CLI からトークンを取得
 */
async function getGhCliToken(): Promise<string | null> {
  try {
    const { exec } = await import("child_process");
    const token = await new Promise<string>((resolve, reject) => {
      exec("gh auth token", (error: Error | null, stdout: string) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout.trim());
        }
      });
    });
    if (token && token.length > 0) {
      return token;
    }
  } catch {
    // gh CLI が使えない
  }
  return null;
}

/**
 * 有効な GitHub トークンを取得（設定 → gh CLI の順で試行）
 */
async function getGitHubToken(): Promise<string | undefined> {
  // 1. 設定からトークンをチェック
  const config = vscode.workspace.getConfiguration("skillFinder");
  const configToken = config.get<string>("githubToken");
  if (configToken && configToken.length > 0) {
    return configToken;
  }

  // 2. gh CLI からトークンを取得
  const ghToken = await getGhCliToken();
  if (ghToken) {
    return ghToken;
  }

  return undefined;
}

/**
 * GitHub認証状態をチェック
 */
export async function checkGitHubAuth(): Promise<{
  authenticated: boolean;
  method: "token" | "gh-cli" | "none";
  message: string;
}> {
  // 1. 設定からトークンをチェック
  const config = vscode.workspace.getConfiguration("skillFinder");
  const token = config.get<string>("githubToken");
  if (token) {
    // トークンの有効性を確認
    try {
      const response = await fetch("https://api.github.com/user", {
        headers: { Authorization: `token ${token}` },
      });
      if (response.ok) {
        return {
          authenticated: true,
          method: "token",
          message: "GitHub token authenticated",
        };
      }
    } catch {
      // トークンが無効
    }
  }

  // 2. gh CLI をチェック
  const ghToken = await getGhCliToken();
  if (ghToken) {
    return {
      authenticated: true,
      method: "gh-cli",
      message: "GitHub CLI authenticated",
    };
  }

  return {
    authenticated: false,
    method: "none",
    message: messages.authRequired(),
  };
}

/**
 * GitHub API リクエストを実行（認証付き）
 */
async function githubFetch(url: string, token?: string): Promise<Response> {
  // トークンが渡されなかった場合は自動取得を試みる
  const effectiveToken = token || (await getGitHubToken());

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "VSCode-SkillFinder",
  };

  if (effectiveToken) {
    headers["Authorization"] = `token ${effectiveToken}`;
  }

  return fetch(url, { headers });
}

/**
 * リポジトリ内のSKILL.mdファイルを検索
 */
export async function scanRepositoryForSkills(
  repoUrl: string,
  token?: string
): Promise<{ skills: Skill[]; source: Source } | null> {
  // URLからowner/repoを抽出
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    throw new Error("Invalid GitHub repository URL");
  }

  const [, owner, repo] = match;
  const repoName = repo.replace(/\.git$/, "");

  // リポジトリのツリーを取得
  const treeUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/main?recursive=1`;
  const response = await githubFetch(treeUrl, token);

  if (!response.ok) {
    if (response.status === 404) {
      // mainブランチがない場合はmasterを試す
      const masterUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/master?recursive=1`;
      const masterResponse = await githubFetch(masterUrl, token);
      if (!masterResponse.ok) {
        throw new Error(`Repository not found: ${owner}/${repoName}`);
      }
      const masterData = (await masterResponse.json()) as {
        tree: Array<{ path: string; type: string }>;
      };
      return processTreeResponse(
        masterData,
        owner,
        repoName,
        repoUrl,
        "master",
        token
      );
    }
    if (response.status === 403) {
      throw new Error(
        "GitHub API rate limit exceeded. Please authenticate with a GitHub token."
      );
    }
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const responseData = (await response.json()) as {
    tree: Array<{ path: string; type: string }>;
  };
  return processTreeResponse(
    responseData,
    owner,
    repoName,
    repoUrl,
    "main",
    token
  );
}

/**
 * ツリーレスポンスを処理してスキルを抽出
 */
async function processTreeResponse(
  data: { tree: Array<{ path: string; type: string }> },
  owner: string,
  repoName: string,
  repoUrl: string,
  branch: string,
  _token?: string
): Promise<{ skills: Skill[]; source: Source }> {
  // SKILL.md ファイルを探す（どのディレクトリでも可）
  const skillFiles = data.tree.filter(
    (item) =>
      item.type === "blob" &&
      (item.path.endsWith("/SKILL.md") || item.path === "SKILL.md")
  );

  const skills: Skill[] = [];

  for (const file of skillFiles) {
    try {
      // SKILL.md の内容を取得して frontmatter を解析
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/${file.path}`;
      const contentResponse = await fetch(rawUrl);
      if (contentResponse.ok) {
        const content = await contentResponse.text();
        const skillInfo = parseSkillFrontmatter(content, file.path);
        if (skillInfo) {
          skills.push({
            name: skillInfo.name,
            source: `${owner}-${repoName}`,
            path: file.path.replace("/SKILL.md", ""),
            categories: skillInfo.categories || [],
            description: skillInfo.description || "",
          });
        }
      }
    } catch {
      // 個別のスキル取得エラーは無視して続行
      console.warn(`Failed to fetch skill: ${file.path}`);
    }
  }

  const source: Source = {
    id: `${owner}-${repoName}`,
    name: repoName,
    url: repoUrl.replace(/\.git$/, ""),
    type: "user-added",
    description: `User added repository: ${owner}/${repoName}`,
  };

  return { skills, source };
}

/**
 * SKILL.md の frontmatter を解析
 */
function parseSkillFrontmatter(
  content: string,
  filePath: string
): { name: string; description: string; categories: string[] } | null {
  // frontmatter を抽出
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    const nameMatch = frontmatter.match(/^name:\s*["']?([^"'\n]+)["']?/m);
    const descMatch = frontmatter.match(
      /^description:\s*["']?([^"'\n]+)["']?/m
    );
    const categoriesMatch = frontmatter.match(/^categories:\s*\[([^\]]+)\]/m);

    const name = nameMatch?.[1]?.trim();
    if (!name) {
      // frontmatter に name がない場合はディレクトリ名を使用
      const pathParts = filePath.split("/");
      const dirName = pathParts[pathParts.length - 2];
      return {
        name: dirName,
        description: descMatch?.[1]?.trim() || "",
        categories: [],
      };
    }

    let categories: string[] = [];
    if (categoriesMatch) {
      categories = categoriesMatch[1]
        .split(",")
        .map((c) => c.trim().replace(/["']/g, ""));
    }

    return {
      name,
      description: descMatch?.[1]?.trim() || "",
      categories,
    };
  }

  // frontmatter がない場合はディレクトリ名を使用
  const pathParts = filePath.split("/");
  const dirName = pathParts[pathParts.length - 2];
  return {
    name: dirName,
    description: "",
    categories: [],
  };
}

/**
 * 既存ソースからインデックスを更新
 * 既存のローカライズされた説明は保持し、新規スキルのみGitHubから説明を取得
 */
export async function updateIndexFromSources(
  context: vscode.ExtensionContext,
  currentIndex: SkillIndex,
  progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<SkillIndex> {
  const config = vscode.workspace.getConfiguration("skillFinder");
  const token = config.get<string>("githubToken");

  // 既存スキルの説明をマップとして保持（ローカライズされた説明を保持するため）
  const existingDescriptions = new Map<string, string>();
  for (const skill of currentIndex.skills) {
    const key = `${skill.source}:${skill.name}`;
    if (skill.description) {
      existingDescriptions.set(key, skill.description);
    }
  }

  const updatedSkills: Skill[] = [];
  const totalSources = currentIndex.sources.length;

  for (const source of currentIndex.sources) {
    try {
      progress?.report({
        message: `Updating ${source.name}...`,
        increment: (1 / totalSources) * 100,
      });

      const result = await scanRepositoryForSkills(source.url, token);
      if (result) {
        // 既存の説明があれば保持、なければGitHubから取得した説明を使用
        // source ID は既存の source.id を使用（GitHub から生成された ID ではなく）
        for (const skill of result.skills) {
          const skillWithCorrectSource = {
            ...skill,
            source: source.id, // 既存の source ID を使用
          };
          const key = `${source.id}:${skill.name}`;
          const existingDesc = existingDescriptions.get(key);
          updatedSkills.push({
            ...skillWithCorrectSource,
            description: existingDesc || skill.description,
          });
        }
      }
    } catch (error) {
      console.warn(`Failed to update source ${source.id}:`, error);
      // 更新に失敗したソースの既存スキルは保持
      const existingSkills = currentIndex.skills.filter(
        (s) => s.source === source.id
      );
      updatedSkills.push(...existingSkills);
    }
  }

  const updatedIndex: SkillIndex = {
    ...currentIndex,
    lastUpdated: new Date().toISOString().split("T")[0],
    skills: updatedSkills,
  };

  // 保存
  await saveSkillIndex(context, updatedIndex);

  return updatedIndex;
}

/**
 * ソースを追加
 */
export async function addSource(
  context: vscode.ExtensionContext,
  currentIndex: SkillIndex,
  repoUrl: string
): Promise<{ index: SkillIndex; addedSkills: number }> {
  const config = vscode.workspace.getConfiguration("skillFinder");
  const token = config.get<string>("githubToken");

  const result = await scanRepositoryForSkills(repoUrl, token);
  if (!result) {
    throw new Error("No skills found in repository");
  }

  // 既存のソースをチェック
  const existingSourceIndex = currentIndex.sources.findIndex(
    (s) => s.id === result.source.id
  );

  let updatedSources: Source[];
  if (existingSourceIndex >= 0) {
    // 既存ソースを更新
    updatedSources = [...currentIndex.sources];
    updatedSources[existingSourceIndex] = result.source;
  } else {
    // 新規ソースを追加
    updatedSources = [...currentIndex.sources, result.source];
  }

  // 既存のスキルを除外して新しいスキルを追加
  const existingSkills = currentIndex.skills.filter(
    (s) => s.source !== result.source.id
  );
  const updatedSkills = [...existingSkills, ...result.skills];

  const updatedIndex: SkillIndex = {
    ...currentIndex,
    lastUpdated: new Date().toISOString().split("T")[0],
    sources: updatedSources,
    skills: updatedSkills,
  };

  // 保存
  await saveSkillIndex(context, updatedIndex);

  return { index: updatedIndex, addedSkills: result.skills.length };
}

/**
 * ソースを削除
 */
export async function removeSource(
  context: vscode.ExtensionContext,
  currentIndex: SkillIndex,
  sourceId: string
): Promise<{ index: SkillIndex; removedSkills: number }> {
  // ソースを検索
  const sourceToRemove = currentIndex.sources.find((s) => s.id === sourceId);
  if (!sourceToRemove) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  // そのソースに属するスキル数をカウント
  const skillsToRemove = currentIndex.skills.filter(
    (s) => s.source === sourceId
  );
  const removedSkills = skillsToRemove.length;

  // ソースとスキルを除外
  const updatedSources = currentIndex.sources.filter((s) => s.id !== sourceId);
  const updatedSkills = currentIndex.skills.filter(
    (s) => s.source !== sourceId
  );

  const updatedIndex: SkillIndex = {
    ...currentIndex,
    lastUpdated: new Date().toISOString().split("T")[0],
    sources: updatedSources,
    skills: updatedSkills,
  };

  // 保存
  await saveSkillIndex(context, updatedIndex);

  return { index: updatedIndex, removedSkills };
}

/**
 * GitHub でスキルを検索
 * クエリがユーザー名/リポジトリ名に見える場合は user: や repo: で検索
 */
export async function searchGitHub(
  query: string,
  token?: string
): Promise<
  Array<{
    name: string;
    repo: string;
    repoUrl: string;
    path: string;
    description: string;
  }>
> {
  // クエリ形式: "{query} filename:SKILL.md" (gh search code と同じ)
  // - キーワード検索が最も汎用的
  // - user:xxx や repo:xxx/yyy はそのまま渡す
  let searchQuery: string;

  if (query.startsWith("user:") || query.startsWith("repo:")) {
    // 明示的なフィルター: filename:SKILL.md user:xxx
    searchQuery = `filename:SKILL.md ${query}`;
  } else if (query.includes("/")) {
    // owner/repo 形式: filename:SKILL.md repo:xxx/yyy
    searchQuery = `filename:SKILL.md repo:${query}`;
  } else {
    // 一般検索: {query} filename:SKILL.md (キーワード検索)
    searchQuery = `${query} filename:SKILL.md`;
  }

  // GitHub Code Search API
  const searchUrl = `https://api.github.com/search/code?q=${encodeURIComponent(
    searchQuery
  )}&per_page=30`;

  const response = await githubFetch(searchUrl, token);

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        "GitHub API rate limit exceeded. Please authenticate with a GitHub token."
      );
    }
    if (response.status === 401) {
      throw new Error("GitHub authentication required for code search.");
    }
    throw new Error(`GitHub API error: ${response.status}`);
  }

  interface GitHubSearchItem {
    path: string;
    repository: {
      full_name: string;
      html_url: string;
    };
  }

  const data = (await response.json()) as {
    items: GitHubSearchItem[];
    total_count: number;
  };
  const results: Array<{
    name: string;
    repo: string;
    repoUrl: string;
    path: string;
    description: string;
  }> = [];

  for (const item of data.items || []) {
    const pathParts = item.path.split("/");
    // SKILL.md がルートにある場合はリポジトリ名を使用
    const skillName =
      pathParts.length > 1
        ? pathParts[pathParts.length - 2]
        : item.repository.full_name.split("/")[1];

    results.push({
      name: skillName,
      repo: item.repository.full_name,
      repoUrl: item.repository.html_url,
      path: item.path.replace("/SKILL.md", "").replace("SKILL.md", ""),
      description: `From ${item.repository.full_name}`,
    });
  }

  return results;
}

/**
 * 認証エラー時のヘルプメッセージを表示
 */
export async function showAuthHelp(): Promise<void> {
  const openSettingsLabel = messages.openSettings();
  const authWithGhCliLabel = messages.authWithGhCli();
  const cancelLabel = messages.actionCancel();

  const action = await vscode.window.showErrorMessage(
    messages.authRequired(),
    openSettingsLabel,
    authWithGhCliLabel,
    cancelLabel
  );

  if (action === openSettingsLabel) {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "skillFinder.githubToken"
    );
  } else if (action === authWithGhCliLabel) {
    const terminal = vscode.window.createTerminal("GitHub Auth");
    terminal.show();
    terminal.sendText("gh auth login");
  }
}
