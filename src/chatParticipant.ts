/**
 * GitHub Copilot Chat Participant - Agent Skills Ninja
 *
 * @skill コマンドでスキルの検索・インストール・推奨を提供
 */
import * as vscode from "vscode";
import { Skill, loadSkillIndex, SkillIndex } from "./skillIndex";
import {
  getManagedInstalledSkillsWithMeta,
  installSkill,
} from "./skillInstaller";
import { updateInstructionFileForRoot } from "./instructionManager";
import { getManagedSkillRoots, type SkillRoot } from "./skillLocations";
import { messages } from "./i18n";

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
  return loadSkillIndex(context);
}

function getIndexSkills(index: SkillIndex): Skill[] {
  return Array.isArray(index.skills) ? index.skills : [];
}

async function getDefaultManagedRoot(
  workspaceUri: vscode.Uri,
): Promise<SkillRoot | undefined> {
  const roots = await getManagedSkillRoots(workspaceUri);
  return roots.find((root) => root.scope === "workspace") || roots[0];
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
        {
          prompt: "/search MCP server",
          label: `$(search) ${messages.chatFollowupSearchSkills()}`,
        },
        {
          prompt: "/list",
          label: `$(list-tree) ${messages.chatFollowupListInstalled()}`,
        },
        {
          prompt: "/recommend",
          label: `$(lightbulb) ${messages.chatFollowupRecommend()}`,
        },
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
    const message = error instanceof Error ? error.message : String(error);
    stream.markdown(messages.chatError(message));
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
    stream.markdown(messages.chatSearchMissingQuery());
    return {};
  }

  const index = await getSkillIndex();
  const skills = getIndexSkills(index);
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
    stream.markdown(messages.chatSearchNoResults(query));
    return {};
  }

  stream.markdown(messages.chatSearchResults(results.length, query));

  for (const skill of results) {
    const stars = skill.stars ? ` ⭐ ${skill.stars}` : "";
    const categories =
      skill.categories?.map((c: string) => `\`${c}\``).join(" ") || "";

    stream.markdown(`### $(package) ${skill.name}${stars}\n`);
    stream.markdown(`${skill.description || messages.chatNoDescription()}\n`);
    stream.markdown(
      `📦 **${messages.sourceLabel()}:** ${skill.source} | ${categories}\n`,
    );
    if (skill.url) {
      stream.markdown(`🔗 [GitHub](${skill.url})\n\n`);
    }

    // インストールボタン
    stream.button({
      command: "skillNinja.installSkill",
      arguments: [skill],
      title: `$(cloud-download) ${messages.actionInstall()} ${skill.name}`,
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
    stream.markdown(messages.chatInstallMissingSkillName());
    return {};
  }

  const index = await getSkillIndex();
  const skills = getIndexSkills(index);
  const lowerQuery = query.toLowerCase();

  // 完全一致または部分一致
  const skill =
    skills.find((s: Skill) => s.name.toLowerCase() === lowerQuery) ||
    skills.find((s: Skill) => s.name.toLowerCase().includes(lowerQuery));

  if (!skill) {
    stream.markdown(messages.chatInstallSkillNotFound(query));
    return {};
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    stream.markdown(messages.chatNoWorkspaceFolderOpen());
    return {};
  }

  const targetRoot = await getDefaultManagedRoot(workspaceFolder.uri);
  if (!targetRoot) {
    stream.markdown(messages.chatNoManagedSkillRoot());
    return {};
  }

  stream.markdown(messages.chatInstallingSkill(skill.name));
  stream.markdown(`- **${messages.sourceLabel()}:** ${skill.source}\n`);
  if (skill.url) {
    stream.markdown(`- **URL:** ${skill.url}\n\n`);
  }

  stream.progress(messages.installing(skill.name));

  // インストール実行
  await installSkill(
    skill,
    workspaceFolder.uri,
    requireIndexContext(),
    targetRoot,
  );

  if (
    vscode.workspace
      .getConfiguration("skillNinja")
      .get<boolean>("autoUpdateInstruction", true)
  ) {
    await updateInstructionFileForRoot(targetRoot, requireIndexContext());
  }

  stream.markdown(messages.chatInstallSuccess(skill.name));
  stream.markdown(messages.chatInstallCheckFolder(targetRoot.displayPath));

  return { metadata: { command: "install", skill: skill.name } };
}

/** /list コマンド - インストール済みスキル一覧 */
async function handleList(
  stream: vscode.ChatResponseStream,
): Promise<vscode.ChatResult> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    stream.markdown(messages.chatNoWorkspaceFolderOpen());
    return {};
  }

  const installedEntries = await getManagedInstalledSkillsWithMeta(
    workspaceFolder.uri,
  );

  if (installedEntries.length === 0) {
    stream.markdown(messages.chatNoInstalledSkillsUsage());
    return {};
  }

  stream.markdown(messages.chatInstalledSkillsHeader(installedEntries.length));

  for (const { root, meta } of installedEntries) {
    stream.markdown(`- **${meta.name}** (${root.displayPath})\n`);
  }

  return { metadata: { command: "list", count: installedEntries.length } };
}

/** /recommend コマンド - プロジェクトに基づくスキル推奨 */
async function handleRecommend(
  stream: vscode.ChatResponseStream,
  _token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  stream.markdown(messages.chatRecommendedSkillsHeader());

  // ワークスペースのファイルを分析
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    stream.markdown(messages.chatNoWorkspacePopular());
    return await showPopularSkills(stream);
  }

  const recommendations: { skill: Skill; reason: string }[] = [];

  // ファイルパターンに基づく推奨
  const patterns: { glob: string; category: string; reason: string }[] = [
    {
      glob: "**/*.ts",
      category: "typescript",
      reason: messages.chatReasonTypeScript(),
    },
    {
      glob: "**/package.json",
      category: "npm",
      reason: messages.chatReasonNode(),
    },
    {
      glob: "**/*.py",
      category: "python",
      reason: messages.chatReasonPython(),
    },
    {
      glob: "**/.github/**",
      category: "github",
      reason: messages.chatReasonGithub(),
    },
    {
      glob: "**/Dockerfile",
      category: "docker",
      reason: messages.chatReasonDocker(),
    },
  ];

  const index = await getSkillIndex();
  const skills = getIndexSkills(index);

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
    stream.markdown(messages.chatNoSpecificRecommendations());
    return await showPopularSkills(stream);
  }

  for (const rec of recommendations.slice(0, 5)) {
    stream.markdown(`### $(lightbulb) ${rec.skill.name}\n`);
    stream.markdown(`*${rec.reason}*\n\n`);
    stream.markdown(
      `${rec.skill.description || messages.chatNoDescription()}\n\n`,
    );

    stream.button({
      command: "skillNinja.installSkill",
      arguments: [rec.skill],
      title: `$(cloud-download) ${messages.actionInstall()}`,
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
  const skills = getIndexSkills(index);
  // スター数でソート
  const popular = skills
    .filter((s: Skill) => s.stars && s.stars > 0)
    .sort((a: Skill, b: Skill) => (b.stars || 0) - (a.stars || 0))
    .slice(0, 5);

  stream.markdown(messages.chatPopularSkillsHeader());

  for (const skill of popular) {
    stream.markdown(
      `- **${skill.name}** ⭐ ${skill.stars} - ${
        skill.description || messages.chatNoDescription()
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
    stream.markdown(messages.chatIntroBody());
    return {};
  }

  // 自然言語でスキルを検索
  return await handleSearch(query, stream, token);
}
