// インデックス更新とGitHub検索機能
// GitHub API を使用してスキルを検索・更新

import * as vscode from "vscode";
import {
  SkillIndex,
  Skill,
  Source,
  Bundle,
  saveSkillIndex,
} from "./skillIndex";
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
  const config = vscode.workspace.getConfiguration("skillNinja");
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
  const config = vscode.workspace.getConfiguration("skillNinja");
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
    "User-Agent": "VSCode-SkillNinja",
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
  token?: string,
  preferredBranch?: string // skill-index.json で指定されたブランチ
): Promise<{ skills: Skill[]; source: Source; bundles?: Bundle[] } | null> {
  // URLからowner/repoを抽出
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    throw new Error("Invalid GitHub repository URL");
  }

  const [, owner, repo] = match;
  const repoName = repo.replace(/\.git$/, "");

  // ブランチを決定: 指定されたブランチ → デフォルトブランチを取得
  let branch = preferredBranch;
  if (!branch) {
    // GitHub API でデフォルトブランチを取得
    const repoInfoUrl = `https://api.github.com/repos/${owner}/${repoName}`;
    const repoInfoResponse = await githubFetch(repoInfoUrl, token);
    if (repoInfoResponse.ok) {
      const repoInfo = (await repoInfoResponse.json()) as {
        default_branch: string;
      };
      branch = repoInfo.default_branch;
    } else {
      branch = "main"; // フォールバック
    }
  }

  // リポジトリのツリーを取得
  const treeUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/${branch}?recursive=1`;
  const response = await githubFetch(treeUrl, token);

  if (!response.ok) {
    if (response.status === 404 && !preferredBranch) {
      // 指定ブランチがない場合のみ別のブランチを試す
      const fallbackBranch = branch === "main" ? "master" : "main";
      const fallbackUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/${fallbackBranch}?recursive=1`;
      const fallbackResponse = await githubFetch(fallbackUrl, token);
      if (fallbackResponse.ok) {
        const fallbackData = (await fallbackResponse.json()) as {
          tree: Array<{ path: string; type: string }>;
        };
        return processTreeResponse(
          fallbackData,
          owner,
          repoName,
          repoUrl,
          fallbackBranch,
          token
        );
      }
      throw new Error(
        `Repository or branch not found: ${owner}/${repoName} (branch: ${branch})`
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
    branch,
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
): Promise<{ skills: Skill[]; source: Source; bundles?: Bundle[] }> {
  // SKILL.md / skill.md ファイルを探す（どのディレクトリでも可、大文字小文字両対応）
  const skillFiles = data.tree.filter((item) => {
    if (item.type !== "blob") return false;
    const lowerPath = item.path.toLowerCase();
    // 正確に skill.md で終わるもののみ（blockskill.md 等を除外）
    return lowerPath === "skill.md" || lowerPath.endsWith("/skill.md");
  });

  // PRPs-agentic-eng リポジトリの特別処理: .claude/commands/**/*.md をスキャン
  const isPRPsRepo = repoName.toLowerCase().includes("prps-agentic");
  if (isPRPsRepo) {
    const claudeCommandSkills = await scanClaudeCommands(
      data,
      owner,
      repoName,
      branch
    );
    const source: Source = {
      id: `${owner}-${repoName}`,
      name: repoName,
      url: repoUrl.replace(/\.git$/, ""),
      type: "user-added",
      description: `User added repository: ${owner}/${repoName}`,
    };
    return { skills: claudeCommandSkills, source };
  }

  // ComposioHQ/awesome-claude-skills リポジトリの特別処理: トップレベルディレクトリをスキル扱い
  const isComposioRepo = repoName
    .toLowerCase()
    .includes("awesome-claude-skills");
  if (isComposioRepo) {
    const composioSkills = scanComposioSkills(data, owner, repoName);
    const source: Source = {
      id: `${owner}-${repoName}`,
      name: repoName,
      url: repoUrl.replace(/\.git$/, ""),
      type: "user-added",
      description: `User added repository: ${owner}/${repoName}`,
    };
    return { skills: composioSkills, source };
  }

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
          const skill: Skill = {
            name: skillInfo.name,
            source: `${owner}-${repoName}`,
            path: file.path.replace("/SKILL.md", ""),
            categories: skillInfo.categories || [],
            description: skillInfo.description || "",
          };
          // Bundle/Framework対応フィールドを追加（存在する場合のみ）
          if (skillInfo.standalone !== undefined) {
            skill.standalone = skillInfo.standalone;
          }
          if (skillInfo.requires?.length) {
            skill.requires = skillInfo.requires;
          }
          if (skillInfo.bundle) {
            skill.bundle = skillInfo.bundle;
          }
          skills.push(skill);
        }
      }
    } catch {
      // 個別のスキル取得エラーは無視して続行
      console.warn(`Failed to fetch skill: ${file.path}`);
    }
  }

  // bundle.json を検出してBundle定義を取得
  const bundles = await scanBundleJson(data, owner, repoName, branch);

  const source: Source = {
    id: `${owner}-${repoName}`,
    name: repoName,
    url: repoUrl.replace(/\.git$/, ""),
    type: "user-added",
    description: `User added repository: ${owner}/${repoName}`,
  };

  return { skills, source, bundles };
}

/**
 * bundle.json を検出してBundle定義を取得
 * リポジトリルートまたは特定のパスにあるbundle.jsonを読み込む
 */
async function scanBundleJson(
  data: { tree: Array<{ path: string; type: string }> },
  owner: string,
  repoName: string,
  branch: string
): Promise<Bundle[]> {
  // bundle.json ファイルを探す（ルートまたはどこでも）
  const bundleFiles = data.tree.filter(
    (item) =>
      item.type === "blob" &&
      (item.path === "bundle.json" || item.path.endsWith("/bundle.json"))
  );

  const bundles: Bundle[] = [];
  const sourceId = `${owner}-${repoName}`;

  for (const file of bundleFiles) {
    try {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/${file.path}`;
      const contentResponse = await fetch(rawUrl);
      if (contentResponse.ok) {
        const content = await contentResponse.text();
        const bundleData = JSON.parse(content);

        // 単一のBundle定義の場合
        if (bundleData.id && bundleData.name && bundleData.skills) {
          bundles.push({
            id: bundleData.id,
            name: bundleData.name,
            source: sourceId,
            description: bundleData.description || "",
            description_ja: bundleData.description_ja,
            skills: bundleData.skills,
            installOrder: bundleData.installOrder,
            coreSkill: bundleData.coreSkill,
          });
        }

        // 複数のBundle定義（bundles配列）の場合
        if (Array.isArray(bundleData.bundles)) {
          for (const b of bundleData.bundles) {
            if (b.id && b.name && b.skills) {
              bundles.push({
                id: b.id,
                name: b.name,
                source: sourceId,
                description: b.description || "",
                description_ja: b.description_ja,
                skills: b.skills,
                installOrder: b.installOrder,
                coreSkill: b.coreSkill,
              });
            }
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to parse bundle.json: ${file.path}`, error);
    }
  }

  return bundles;
}

/**
 * PRPs-agentic-eng リポジトリ専用: .claude/commands/ 内の .md ファイルをスキャン
 * このリポジトリは SKILL.md ではなく Claude Code コマンド形式を使用
 */
async function scanClaudeCommands(
  data: { tree: Array<{ path: string; type: string }> },
  owner: string,
  repoName: string,
  branch: string
): Promise<Skill[]> {
  console.log(
    `[Skill Ninja] scanClaudeCommands: ${owner}/${repoName} branch=${branch}`
  );
  console.log(`[Skill Ninja] Total tree items: ${data.tree.length}`);

  // .claude/commands/ 配下の .md ファイルを取得
  const commandFiles = data.tree.filter(
    (item) =>
      item.type === "blob" &&
      item.path.startsWith(".claude/commands/") &&
      item.path.endsWith(".md")
  );

  console.log(`[Skill Ninja] Found ${commandFiles.length} command files`);

  const skills: Skill[] = [];

  for (const file of commandFiles) {
    try {
      // コマンドの内容を取得
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/${file.path}`;
      const contentResponse = await fetch(rawUrl);
      if (contentResponse.ok) {
        const content = await contentResponse.text();

        // パスからスキル名を抽出: .claude/commands/category/command-name.md -> category/command-name
        const pathWithoutPrefix = file.path.replace(".claude/commands/", "");
        const skillName = pathWithoutPrefix.replace(".md", "");

        // ファイルの最初の行から説明を抽出（# Title 形式）
        const lines = content.split("\n");
        let description = "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("# ")) {
            description = trimmed.replace(/^#+\s*/, "").substring(0, 80);
            break;
          }
          // frontmatter 内の description も確認
          if (trimmed.startsWith("description:")) {
            description = trimmed
              .replace(/^description:\s*["']?/, "")
              .replace(/["']$/, "")
              .substring(0, 80);
            break;
          }
        }

        // カテゴリはパスのディレクトリ名から推測
        const pathParts = skillName.split("/");
        const category = pathParts.length > 1 ? pathParts[0] : "command";

        skills.push({
          name: skillName,
          source: `${owner}-${repoName}`,
          path: file.path,
          categories: [category, "claude-code", "prp"],
          description: description || `Claude Code command: ${skillName}`,
        });
      }
    } catch {
      console.warn(`Failed to fetch command: ${file.path}`);
    }
  }

  return skills;
}

/**
 * ComposioHQ/awesome-claude-skills リポジトリ専用: トップレベルディレクトリをスキルとして扱う
 * このリポジトリは SKILL.md を持たないディレクトリベースの構造
 */
function scanComposioSkills(
  data: { tree: Array<{ path: string; type: string }> },
  owner: string,
  repoName: string
): Skill[] {
  // 除外するディレクトリ（設定ファイルや非スキル）
  const excludeDirs = new Set([
    ".claude-plugin",
    ".github",
    ".git",
    "scripts",
    "templates",
    "resources",
  ]);

  // トップレベルのディレクトリを取得（スキルディレクトリ）
  const topLevelDirs = data.tree.filter(
    (item) =>
      item.type === "tree" &&
      !item.path.includes("/") &&
      !item.path.startsWith(".") &&
      !excludeDirs.has(item.path)
  );

  const skills: Skill[] = topLevelDirs.map((dir) => ({
    name: dir.path,
    source: `${owner}-${repoName}`,
    path: dir.path,
    categories: ["community"],
    description: `${dir.path} skill`,
  }));

  return skills;
}

/**
 * SKILL.md の frontmatter を解析
 */
function parseSkillFrontmatter(
  content: string,
  filePath: string
): {
  name: string;
  description: string;
  categories: string[];
  standalone?: boolean;
  requires?: string[];
  bundle?: string;
} | null {
  // frontmatter を抽出
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    const nameMatch = frontmatter.match(/^name:\s*["']?([^"'\n]+)["']?/m);
    const descMatch = frontmatter.match(
      /^description:\s*["']?([^"'\n]+)["']?/m
    );
    const categoriesMatch = frontmatter.match(/^categories:\s*\[([^\]]+)\]/m);

    // Bundle/Framework 対応: standalone, requires, bundle
    const standaloneMatch = frontmatter.match(/^standalone:\s*(true|false)/m);
    const requiresMatch = frontmatter.match(/^requires:\s*\[([^\]]+)\]/m);
    const bundleMatch = frontmatter.match(/^bundle:\s*["']?([^"'\n]+)["']?/m);

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

    let requires: string[] | undefined;
    if (requiresMatch) {
      requires = requiresMatch[1]
        .split(",")
        .map((r) => r.trim().replace(/["']/g, ""));
    }

    return {
      name,
      description: descMatch?.[1]?.trim() || "",
      categories,
      standalone: standaloneMatch ? standaloneMatch[1] === "true" : undefined,
      requires,
      bundle: bundleMatch?.[1]?.trim(),
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
  const config = vscode.workspace.getConfiguration("skillNinja");
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
  const updatedBundles: Bundle[] = [];
  const totalSources = currentIndex.sources.length;

  for (const source of currentIndex.sources) {
    try {
      progress?.report({
        message: `Updating ${source.name}...`,
        increment: (1 / totalSources) * 100,
      });

      // ソースに設定されたブランチを使用
      const result = await scanRepositoryForSkills(
        source.url,
        token,
        source.branch
      );
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

        // Bundlesもマージ（source ID を修正）
        if (result.bundles?.length) {
          for (const bundle of result.bundles) {
            updatedBundles.push({
              ...bundle,
              source: source.id,
            });
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to update source ${source.id}:`, error);
      // 更新に失敗したソースの既存スキルは保持
      const existingSkills = currentIndex.skills.filter(
        (s) => s.source === source.id
      );
      updatedSkills.push(...existingSkills);
      // 既存のBundlesも保持
      const existingBundles = (currentIndex.bundles || []).filter(
        (b) => b.source === source.id
      );
      updatedBundles.push(...existingBundles);
    }
  }

  // 既存のBundles（バンドル版から来たもの）を保持しつつ、新規を追加
  const existingBundleIds = new Set(updatedBundles.map((b) => b.id));
  const preservedBundles = (currentIndex.bundles || []).filter(
    (b) => !existingBundleIds.has(b.id)
  );

  const updatedIndex: SkillIndex = {
    ...currentIndex,
    lastUpdated: new Date().toISOString().split("T")[0],
    skills: updatedSkills,
    bundles: [...preservedBundles, ...updatedBundles],
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
  // repoUrlが文字列かどうか検証
  if (!repoUrl || typeof repoUrl !== "string") {
    throw new Error("repoUrl must be a valid string");
  }

  const config = vscode.workspace.getConfiguration("skillNinja");
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

  // Bundlesもマージ
  const existingBundles = (currentIndex.bundles || []).filter(
    (b) => b.source !== result.source.id
  );
  const updatedBundles = [...existingBundles, ...(result.bundles || [])];

  const updatedIndex: SkillIndex = {
    ...currentIndex,
    lastUpdated: new Date().toISOString().split("T")[0],
    sources: updatedSources,
    skills: updatedSkills,
    bundles: updatedBundles.length > 0 ? updatedBundles : currentIndex.bundles,
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

  // Bundlesも除外
  const updatedBundles = (currentIndex.bundles || []).filter(
    (b) => b.source !== sourceId
  );

  const updatedIndex: SkillIndex = {
    ...currentIndex,
    lastUpdated: new Date().toISOString().split("T")[0],
    sources: updatedSources,
    skills: updatedSkills,
    bundles: updatedBundles.length > 0 ? updatedBundles : undefined,
  };

  // 保存
  await saveSkillIndex(context, updatedIndex);

  return { index: updatedIndex, removedSkills };
}

/**
 * GitHub でスキルを検索
 * 複数の検索戦略を組み合わせて精度を向上
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
    stars?: number;
    isOrg?: boolean;
    defaultBranch?: string;
  }>
> {
  // クエリをキーワードに分割（3文字以上のみ、ノイズ削減）
  const rawKeywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((k) => k.length > 0);
  const keywords = rawKeywords.filter(
    (k) => k.length >= 3 || /^[a-z0-9]+$/i.test(k)
  );

  // 検索クエリを生成する関数
  const buildSearchQueries = (kws: string[]): string[] => {
    const queries: string[] = [];
    if (query.startsWith("user:") || query.startsWith("repo:")) {
      queries.push(`filename:SKILL.md ${query}`);
    } else if (query.includes("/")) {
      queries.push(`filename:SKILL.md repo:${query}`);
    } else if (kws.length > 1) {
      const orQuery = kws.join(" OR ");
      queries.push(`filename:SKILL.md ${orQuery}`);
      queries.push(`filename:SKILL.md ${orQuery} in:path`);
    } else if (kws.length === 1) {
      queries.push(`filename:SKILL.md ${kws[0]}`);
      queries.push(`filename:SKILL.md ${kws[0]} in:path`);
    }
    return queries;
  };

  // 検索実行関数（フォールバック対応）
  const executeSearch = async (
    searchQueries: string[]
  ): Promise<GitHubSearchItem[]> => {
    const items: GitHubSearchItem[] = [];
    const seen = new Set<string>();

    for (const searchQuery of searchQueries) {
      try {
        const searchUrl = `https://api.github.com/search/code?q=${encodeURIComponent(
          searchQuery
        )}&per_page=100`;
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
          continue;
        }

        const data = (await response.json()) as {
          items: GitHubSearchItem[];
          total_count: number;
        };
        for (const item of data.items || []) {
          const key = `${item.repository.full_name}:${item.path}`;
          if (!seen.has(key)) {
            seen.add(key);
            items.push(item);
          }
        }
      } catch (error) {
        if (searchQueries.indexOf(searchQuery) === 0) {
          throw error;
        }
      }
    }
    return items;
  };

  interface GitHubSearchItem {
    path: string;
    repository: {
      full_name: string;
      html_url: string;
    };
  }

  // Phase 1: 検索実行（0件ならフォールバック）
  let searchQueries = buildSearchQueries(keywords);
  let searchItems = await executeSearch(searchQueries);

  // フォールバック: 0件なら1単語ずつ減らして再検索
  let fallbackKeywords = [...keywords];
  while (searchItems.length === 0 && fallbackKeywords.length > 1) {
    fallbackKeywords.pop(); // 最後のキーワードを削除
    searchQueries = buildSearchQueries(fallbackKeywords);
    searchItems = await executeSearch(searchQueries);
  }

  // リポジトリ情報のキャッシュ（同じリポジトリからの複数スキルで重複APIコールを防ぐ）
  const repoInfoCache = new Map<
    string,
    { stars: number; isOrg: boolean; defaultBranch: string }
  >();

  // Phase 2: 検索結果の基本情報を収集（既に取得済みのsearchItemsを使用）
  interface BasicResult {
    name: string;
    repo: string;
    repoUrl: string;
    path: string;
    itemPath: string;
    stars?: number;
    isOrg?: boolean;
    defaultBranch: string;
  }

  // SKILL.mdフィルタリング
  const validItems = searchItems.filter((item) => {
    const lowerPath = item.path.toLowerCase();
    return lowerPath === "skill.md" || lowerPath.endsWith("/skill.md");
  });

  // 重複排除してユニークなリポジトリリストを作成
  const uniqueRepos = [
    ...new Set(validItems.map((item) => item.repository.full_name)),
  ];

  // リポジトリ情報を並列取得（最大10並列）
  const REPO_BATCH_SIZE = 10;
  for (let i = 0; i < uniqueRepos.length; i += REPO_BATCH_SIZE) {
    const batch = uniqueRepos.slice(i, i + REPO_BATCH_SIZE);
    await Promise.all(
      batch.map(async (repoName) => {
        if (repoInfoCache.has(repoName)) return;
        try {
          const repoApiUrl = `https://api.github.com/repos/${repoName}`;
          const repoResponse = await githubFetch(repoApiUrl, token);
          if (repoResponse.ok) {
            const repoData = (await repoResponse.json()) as {
              stargazers_count: number;
              owner: { type: string };
              default_branch: string;
            };
            repoInfoCache.set(repoName, {
              stars: repoData.stargazers_count,
              isOrg: repoData.owner.type === "Organization",
              defaultBranch: repoData.default_branch || "main",
            });
          }
        } catch {
          // 失敗しても続行
        }
      })
    );
  }

  // BasicResultsを構築
  const basicResults: BasicResult[] = [];
  const seenKeys = new Set<string>();

  for (const item of validItems) {
    const key = `${item.repository.full_name}:${item.path}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const pathParts = item.path.split("/");
    const skillName =
      pathParts.length > 1
        ? pathParts[pathParts.length - 2]
        : item.repository.full_name.split("/")[1];

    const repoInfo = repoInfoCache.get(item.repository.full_name);

    basicResults.push({
      name: skillName,
      repo: item.repository.full_name,
      repoUrl: item.repository.html_url,
      path: item.path.replace(/\/SKILL\.md$/i, "").replace(/^SKILL\.md$/i, ""),
      itemPath: item.path,
      stars: repoInfo?.stars,
      isOrg: repoInfo?.isOrg,
      defaultBranch: repoInfo?.defaultBranch || "main",
    });
  }

  // Phase 3: スコアリング（SKILL.md取得前に仮ランキング）
  let rankedResults = basicResults;
  if (keywords.length > 1) {
    rankedResults = basicResults
      .map((result) => {
        const searchText =
          `${result.name} ${result.path} ${result.repo}`.toLowerCase();
        let score = 0;
        for (const keyword of keywords) {
          if (searchText.includes(keyword)) {
            score++;
            if (result.name.toLowerCase().includes(keyword)) {
              score += 2;
            }
          }
        }
        if (result.stars && result.stars > 100) {
          score += 1;
        }
        return { ...result, score };
      })
      .sort((a, b) => {
        const aScore = (a as { score?: number }).score || 0;
        const bScore = (b as { score?: number }).score || 0;
        if (bScore !== aScore) return bScore - aScore;
        return (b.stars || 0) - (a.stars || 0);
      });
  }

  // Phase 4: 上位50件のみSKILL.md取得して再スコアリング（並列処理で高速化）
  const MAX_FETCH = 50;
  const topResults = rankedResults.slice(0, MAX_FETCH);

  const fetchSkillContent = async (
    result: BasicResult & { score?: number }
  ): Promise<{
    name: string;
    repo: string;
    repoUrl: string;
    path: string;
    description: string;
    stars?: number;
    isOrg?: boolean;
    defaultBranch?: string;
    score?: number;
  }> => {
    let skillDescription = `From ${result.repo}`;
    let skillNameFromMeta = result.name;

    try {
      const rawUrl = `https://raw.githubusercontent.com/${result.repo}/${result.defaultBranch}/${result.itemPath}`;
      const contentResponse = await githubFetch(rawUrl, token);
      if (contentResponse.ok) {
        const content = await contentResponse.text();
        const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
          const frontmatter = frontmatterMatch[1];
          const descMatch = frontmatter.match(
            /^description:\s*(?:\|\s*\n([\s\S]*?)(?=\n\w|\n---)|(.+))/m
          );
          if (descMatch) {
            const desc = (descMatch[1] || descMatch[2] || "").trim();
            if (desc) {
              const firstLine = desc.split("\n")[0].trim();
              skillDescription =
                firstLine.length > 100
                  ? firstLine.substring(0, 100) + "..."
                  : firstLine;
            }
          }
          const nameMatch = frontmatter.match(/^name:\s*(.+)/m);
          if (nameMatch) {
            skillNameFromMeta = nameMatch[1].trim();
          }
        }
      }
    } catch {
      // 失敗してもデフォルト description を使用
    }

    // Description を含めて再スコアリング（複数キーワードの場合）
    let finalScore = result.score || 0;
    if (keywords.length > 1) {
      const descLower = skillDescription.toLowerCase();
      for (const keyword of keywords) {
        if (descLower.includes(keyword)) {
          finalScore += 1; // description にキーワードがあれば +1
        }
      }
    }

    return {
      name: skillNameFromMeta,
      repo: result.repo,
      repoUrl: result.repoUrl,
      path: result.path,
      description: skillDescription,
      stars: result.stars,
      isOrg: result.isOrg,
      defaultBranch: result.defaultBranch,
      score: finalScore,
    };
  };

  // 並列実行（最大10同時）
  const BATCH_SIZE = 10;
  const fetchedResults: Array<{
    name: string;
    repo: string;
    repoUrl: string;
    path: string;
    description: string;
    stars?: number;
    isOrg?: boolean;
    defaultBranch?: string;
    score?: number;
  }> = [];

  for (let i = 0; i < topResults.length; i += BATCH_SIZE) {
    const batch = topResults.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(fetchSkillContent));
    fetchedResults.push(...batchResults);
  }

  // 最終スコアでソート（複数キーワードの場合）
  if (keywords.length > 1) {
    fetchedResults.sort((a, b) => {
      const aScore = a.score || 0;
      const bScore = b.score || 0;
      if (bScore !== aScore) return bScore - aScore;
      return (b.stars || 0) - (a.stars || 0);
    });
  }

  return fetchedResults;
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
      "skillNinja.githubToken"
    );
  } else if (action === authWithGhCliLabel) {
    const terminal = vscode.window.createTerminal("GitHub Auth");
    terminal.show();
    terminal.sendText("gh auth login");
  }
}
