/**
 * GitHub Copilot Chat Participant - Agent Skills Ninja
 *
 * @skill コマンドでスキルの検索・インストール・推奨を提供
 */
import * as vscode from "vscode";
import { Skill, loadSkillIndex, SkillIndex } from "./skillIndex";
import { installSkill, getInstalledSkills } from "./skillInstaller";

/** スキルインデックスをキャッシュ */
let cachedIndex: SkillIndex | undefined;
let indexContext: vscode.ExtensionContext | undefined;

function requireIndexContext(): vscode.ExtensionContext {
  if (!indexContext) {
    throw new Error("Extension context is not initialized");
  }
  return indexContext;
}

/** スキルインデックスを取得 */
async function getSkillIndex(): Promise<SkillIndex> {
  const context = requireIndexContext();
  if (!cachedIndex) {
    cachedIndex = await loadSkillIndex(context);
  }
  return cachedIndex;
}

/** Chat Participant のリクエストハンドラー */
export function createChatParticipant(
  context: vscode.ExtensionContext,
): vscode.ChatParticipant {
  // コンテキストをキャッシュ
  indexContext = context;

  // Chat Participant を作成
  const participant = vscode.chat.createChatParticipant(
    "skill",
    handleChatRequest,
  );

  // アイコン設定
  participant.iconPath = new vscode.ThemeIcon("zap");

  // コマンドフォロワップ設定
  participant.followupProvider = {
    provideFollowups: () => {
      return [
        { prompt: "/search MCP server", label: "$(search) Search Skills" },
        { prompt: "/list", label: "$(list-tree) List Installed" },
        { prompt: "/recommend", label: "$(lightbulb) Recommend" },
      ];
    },
  };

  context.subscriptions.push(participant);
  return participant;
}

/** メインのリクエストハンドラー */
async function handleChatRequest(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  const command = request.command;
  const query = request.prompt.trim();

  try {
    switch (command) {
      case "search":
        return await handleSearch(query, stream, token);
      case "install":
        return await handleInstall(query, stream, token);
      case "list":
        return await handleList(stream);
      case "recommend":
        return await handleRecommend(stream, token);
      default:
        // コマンドなしの場合はスマート検索
        return await handleSmartQuery(query, stream, token);
    }
  } catch (error) {
    stream.markdown(
      `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { errorDetails: { message: String(error) } };
  }
}

/** /search コマンド - スキル検索 */
async function handleSearch(
  query: string,
  stream: vscode.ChatResponseStream,
  _token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  if (!query) {
    stream.markdown(
      "🔍 **Please provide a search query**\n\nExample: `/search MCP server` or `/search github tools`",
    );
    return {};
  }

  const index = await getSkillIndex();
  const skills = index.skills;
  const lowerQuery = query.toLowerCase();

  // スキルをフィルタリング
  const results = skills
    .filter(
      (skill: Skill) =>
        skill.name.toLowerCase().includes(lowerQuery) ||
        skill.description?.toLowerCase().includes(lowerQuery) ||
        skill.categories?.some((cat: string) =>
          cat.toLowerCase().includes(lowerQuery),
        ),
    )
    .slice(0, 10);

  if (results.length === 0) {
    stream.markdown(
      `🔍 No skills found for "${query}"\n\nTry a different search term.`,
    );
    return {};
  }

  stream.markdown(`## 🔍 Found ${results.length} skill(s) for "${query}"\n\n`);

  for (const skill of results) {
    const stars = skill.stars ? ` ⭐ ${skill.stars}` : "";
    const categories =
      skill.categories?.map((c: string) => `\`${c}\``).join(" ") || "";

    stream.markdown(`### $(package) ${skill.name}${stars}\n`);
    stream.markdown(`${skill.description || "No description"}\n`);
    stream.markdown(`📦 **Source:** ${skill.source} | ${categories}\n`);
    if (skill.url) {
      stream.markdown(`🔗 [GitHub](${skill.url})\n\n`);
    }

    // インストールボタン
    stream.button({
      command: "skillNinja.installSkill",
      arguments: [skill],
      title: `$(cloud-download) Install ${skill.name}`,
    });
    stream.markdown("\n\n---\n\n");
  }

  return { metadata: { command: "search", resultsCount: results.length } };
}

/** /install コマンド - スキルインストール */
async function handleInstall(
  query: string,
  stream: vscode.ChatResponseStream,
  _token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  if (!query) {
    stream.markdown(
      "📦 **Please provide a skill name to install**\n\nExample: `/install github-mcp`",
    );
    return {};
  }

  const index = await getSkillIndex();
  const skills = index.skills;
  const lowerQuery = query.toLowerCase();

  // 完全一致または部分一致
  const skill =
    skills.find((s: Skill) => s.name.toLowerCase() === lowerQuery) ||
    skills.find((s: Skill) => s.name.toLowerCase().includes(lowerQuery));

  if (!skill) {
    stream.markdown(
      `❓ Skill "${query}" not found.\n\nUse \`/search ${query}\` to find available skills.`,
    );
    return {};
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    stream.markdown("❌ No workspace folder open. Please open a folder first.");
    return {};
  }

  stream.markdown(`## 📦 Installing ${skill.name}\n\n`);
  stream.markdown(`- **Source:** ${skill.source}\n`);
  if (skill.url) {
    stream.markdown(`- **URL:** ${skill.url}\n\n`);
  }

  stream.progress("Installing...");

  // インストール実行
  await installSkill(skill, workspaceFolder.uri, requireIndexContext());

  stream.markdown(`✅ **${skill.name}** has been installed successfully!\n\n`);
  stream.markdown(
    `📂 Check your \`.github/skills/\` folder for the skill configuration.`,
  );

  return { metadata: { command: "install", skill: skill.name } };
}

/** /list コマンド - インストール済みスキル一覧 */
async function handleList(
  stream: vscode.ChatResponseStream,
): Promise<vscode.ChatResult> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    stream.markdown("❌ No workspace folder open. Please open a folder first.");
    return {};
  }

  const installed = await getInstalledSkills(workspaceFolder.uri);

  if (installed.length === 0) {
    stream.markdown(
      "📋 **No skills installed yet**\n\nUse `/search` to find skills or `/recommend` for suggestions.",
    );
    return {};
  }

  stream.markdown(`## 📋 Installed Skills (${installed.length})\n\n`);

  for (const skillName of installed) {
    stream.markdown(`- **${skillName}**\n`);
  }

  return { metadata: { command: "list", count: installed.length } };
}

/** /recommend コマンド - プロジェクトに基づくスキル推奨 */
async function handleRecommend(
  stream: vscode.ChatResponseStream,
  _token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  stream.markdown("## 💡 Recommended Skills\n\n");

  // ワークスペースのファイルを分析
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    stream.markdown("No workspace open. Here are some popular skills:\n\n");
    return await showPopularSkills(stream);
  }

  const recommendations: { skill: Skill; reason: string }[] = [];

  // ファイルパターンに基づく推奨
  const patterns: { glob: string; category: string; reason: string }[] = [
    {
      glob: "**/*.ts",
      category: "typescript",
      reason: "TypeScript files detected",
    },
    {
      glob: "**/package.json",
      category: "npm",
      reason: "Node.js project detected",
    },
    { glob: "**/*.py", category: "python", reason: "Python files detected" },
    {
      glob: "**/.github/**",
      category: "github",
      reason: "GitHub workflow detected",
    },
    {
      glob: "**/Dockerfile",
      category: "docker",
      reason: "Docker configuration detected",
    },
  ];

  const index = await getSkillIndex();
  const skills = index.skills;

  for (const pattern of patterns) {
    const files = await vscode.workspace.findFiles(
      pattern.glob,
      "**/node_modules/**",
      1,
    );
    if (files.length > 0) {
      // カテゴリに該当するスキルを探す
      const matchingSkills = skills.filter(
        (s: Skill) =>
          s.categories?.some((c: string) =>
            c.toLowerCase().includes(pattern.category),
          ) ||
          s.name.toLowerCase().includes(pattern.category) ||
          s.description?.toLowerCase().includes(pattern.category),
      );

      for (const skill of matchingSkills.slice(0, 2)) {
        if (!recommendations.find((r) => r.skill.name === skill.name)) {
          recommendations.push({ skill, reason: pattern.reason });
        }
      }
    }
  }

  if (recommendations.length === 0) {
    stream.markdown("No specific recommendations based on your project.\n\n");
    return await showPopularSkills(stream);
  }

  for (const rec of recommendations.slice(0, 5)) {
    stream.markdown(`### $(lightbulb) ${rec.skill.name}\n`);
    stream.markdown(`*${rec.reason}*\n\n`);
    stream.markdown(`${rec.skill.description || "No description"}\n\n`);

    stream.button({
      command: "skillNinja.installSkill",
      arguments: [rec.skill],
      title: `$(cloud-download) Install`,
    });
    stream.markdown("\n\n");
  }

  return { metadata: { command: "recommend", count: recommendations.length } };
}

/** 人気スキルを表示 */
async function showPopularSkills(
  stream: vscode.ChatResponseStream,
): Promise<vscode.ChatResult> {
  const index = await getSkillIndex();
  const skills = index.skills;
  // スター数でソート
  const popular = skills
    .filter((s: Skill) => s.stars && s.stars > 0)
    .sort((a: Skill, b: Skill) => (b.stars || 0) - (a.stars || 0))
    .slice(0, 5);

  stream.markdown("### ⭐ Popular Skills\n\n");

  for (const skill of popular) {
    stream.markdown(
      `- **${skill.name}** ⭐ ${skill.stars} - ${
        skill.description || "No description"
      }\n`,
    );
  }

  return {};
}

/** コマンドなしのスマートクエリ処理 */
async function handleSmartQuery(
  query: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  if (!query) {
    stream.markdown(`# 🥷 Agent Skills Ninja\n\n`);
    stream.markdown(
      `I can help you find and manage Agent Skills for GitHub Copilot.\n\n`,
    );
    stream.markdown(`## Commands\n\n`);
    stream.markdown(`- \`/search <query>\` - Search for skills\n`);
    stream.markdown(`- \`/install <name>\` - Install a skill\n`);
    stream.markdown(`- \`/list\` - List installed skills\n`);
    stream.markdown(`- \`/recommend\` - Get skill recommendations\n\n`);
    stream.markdown(
      `Or just describe what you need, and I'll find relevant skills!\n`,
    );
    return {};
  }

  // 自然言語でスキルを検索
  return await handleSearch(query, stream, token);
}
