/**
 * MCP Tools - Agent Skills Ninja
 *
 * VS Code Language Model API を使用した MCP ツール実装
 * ツール一覧に表示され、エージェントが自動的に使用可能
 */
import * as vscode from "vscode";
import {
  Skill,
  loadSkillIndex,
  SkillIndex,
  getLocalizedDescription,
  saveSkillIndex,
} from "./skillIndex";
import {
  installSkill,
  getManagedInstalledSkillsWithMeta,
  uninstallSkillByPath,
} from "./skillInstaller";
import { updateInstructionFileForRoot } from "./instructionManager";
import { searchGitHub, addSource, removeSource } from "./indexUpdater";
import { isJapanese, messages } from "./i18n";
import { getGitHubToken } from "./githubAuth";
import { getManagedSkillRoots, type SkillRoot } from "./skillLocations";

let extContext: vscode.ExtensionContext | undefined;

function requireExtContext(): vscode.ExtensionContext {
  if (!extContext) {
    throw new Error("Extension context is not initialized");
  }
  return extContext;
}

/** スキルインデックスを取得 */
async function getSkillIndex(): Promise<SkillIndex> {
  const context = requireExtContext();
  return loadSkillIndex(context);
}

/**
 * 信頼度バッジを取得
 */
function getTrustBadge(source: string): string {
  const lowerSource = source.toLowerCase();
  if (lowerSource.includes("anthropic") || lowerSource.includes("github")) {
    return "🏢 Official";
  } else if (
    lowerSource.includes("awesome") ||
    lowerSource.includes("curated")
  ) {
    return "📋 Curated";
  }
  return "👥 Community";
}

function localizeMcpText(en: string, ja: string): string {
  return isJapanese() ? ja : en;
}

function formatMcpError(en: string, ja: string, error: unknown): string {
  return `❌ ${localizeMcpText(en, ja)}: ${error}`;
}

function mcpContextUnavailableMessage(): string {
  return `❌ ${localizeMcpText(
    "Extension context is not available.",
    "拡張機能の context を利用できません。",
  )}`;
}

type SourceRemoveResolveError =
  | { kind: "missingInput" }
  | { kind: "multipleMatches"; sourceIds: string[] }
  | { kind: "notFound"; availableSources: string };

function formatSourceRemoveError(error: SourceRemoveResolveError): string {
  switch (error.kind) {
    case "missingInput":
      return `❌ ${localizeMcpText(
        "sourceId, repoUrl, or sourceName is required to remove a source.",
        "ソースを削除するには sourceId、repoUrl、sourceName のいずれかが必要です。",
      )}`;
    case "multipleMatches":
      return `❌ ${localizeMcpText(
        `Multiple sources matched. Use sourceId instead: ${error.sourceIds.join(", ")}`,
        `複数のソースが一致しました。sourceId を指定してください: ${error.sourceIds.join(", ")}`,
      )}`;
    default:
      return `❌ ${localizeMcpText(
        `Source not found. Available sources: ${error.availableSources || "none"}`,
        `ソースが見つかりません。利用可能なソース: ${error.availableSources || "なし"}`,
      )}`;
  }
}

/**
 * インデックス更新情報を取得
 */
function getIndexUpdateInfo(index: SkillIndex): {
  lastUpdated: string;
  daysOld: number;
  isOutdated: boolean;
  warning: string;
} {
  const lastUpdated = index.lastUpdated || "unknown";
  let daysOld = 0;
  let isOutdated = false;

  if (lastUpdated !== "unknown") {
    const lastDate = new Date(lastUpdated);
    const now = new Date();
    daysOld = Math.floor(
      (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    isOutdated = daysOld > 7;
  }

  const warning = isOutdated
    ? `⚠️ **インデックスが古くなっています！** (${daysOld}日前)`
    : "";

  return { lastUpdated, daysOld, isOutdated, warning };
}

/**
 * ソース統計を取得
 */
function getSourceStats(index: SkillIndex): string {
  const sourceCount = index.sources?.length || 0;
  const skillCount = index.skills?.length || 0;
  return `${sourceCount} リポジトリ、${skillCount} スキル`;
}

async function getDefaultManagedRoot(
  workspaceUri: vscode.Uri,
): Promise<SkillRoot | undefined> {
  const roots = await getManagedSkillRoots(workspaceUri);
  return roots.find((root) => root.scope === "workspace") || roots[0];
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function renderMarkdownTable(headers: string[], rows: string[][]): string {
  const normalizedRows = rows.map((row) =>
    headers.map((_, index) => escapeMarkdownCell(row[index] || "")),
  );

  return [
    `| ${headers.map(escapeMarkdownCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...normalizedRows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

/**
 * MCP ツールを別名で登録
 */
function registerToolAliases(
  context: vscode.ExtensionContext,
  names: string[],
  createTool: () => vscode.LanguageModelTool<any>,
): void {
  for (const name of names) {
    context.subscriptions.push(vscode.lm.registerTool(name, createTool()));
  }
}

/**
 * MCP ツールを登録
 */
export function registerMcpTools(context: vscode.ExtensionContext): void {
  extContext = context;

  // vscode.lm API が存在するか確認
  if (!vscode.lm || typeof vscode.lm.registerTool !== "function") {
    console.log(
      "Agent Skills Ninja: vscode.lm.registerTool is not available (requires VS Code 1.99+)",
    );
    return;
  }

  try {
    // スキル検索ツール
    registerToolAliases(context, ["skillNinja_search", "searchSkills"], () => {
      return new SkillSearchTool();
    });

    // スキルインストールツール
    registerToolAliases(context, ["skillNinja_install", "installSkill"], () => {
      return new SkillInstallTool();
    });

    // インストール済み一覧ツール
    registerToolAliases(context, ["skillNinja_list", "listSkills"], () => {
      return new SkillListTool();
    });

    // スキル推奨ツール
    registerToolAliases(
      context,
      ["skillNinja_recommend", "recommendSkills"],
      () => {
        return new SkillRecommendTool();
      },
    );

    // スキルアンインストールツール
    registerToolAliases(
      context,
      ["skillNinja_uninstall", "uninstallSkill"],
      () => {
        return new SkillUninstallTool();
      },
    );

    // インデックス更新ツール
    registerToolAliases(
      context,
      ["skillNinja_updateIndex", "updateSkillIndex"],
      () => {
        return new UpdateIndexTool();
      },
    );

    // GitHub 検索ツール
    registerToolAliases(
      context,
      ["skillNinja_webSearch", "webSearchSkills"],
      () => {
        return new WebSearchTool();
      },
    );

    // ソース追加ツール
    registerToolAliases(
      context,
      ["skillNinja_addSource", "addSkillSource"],
      () => {
        return new AddSourceTool();
      },
    );

    // ソース削除ツール
    registerToolAliases(
      context,
      ["skillNinja_removeSource", "removeSkillSource"],
      () => {
        return new RemoveSourceTool();
      },
    );

    // スキル説明ローカライズツール
    registerToolAliases(
      context,
      ["skillNinja_localize", "localizeSkill"],
      () => {
        return new LocalizeSkillsTool();
      },
    );

    console.log("Agent Skills Ninja: MCP tools registered successfully");
  } catch (error) {
    console.error("Agent Skills Ninja: Failed to register MCP tools:", error);
  }
}

/**
 * スキル検索ツール
 */
class SkillSearchTool implements vscode.LanguageModelTool<{ query: string }> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{ query: string }>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const query = options.input.query;
    const index = await getSkillIndex();
    const skills = index.skills;
    const lowerQuery = query.toLowerCase();

    // インデックス更新情報を取得
    const updateInfo = getIndexUpdateInfo(index);
    const sourceStats = getSourceStats(index);

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
      const guidanceTable = renderMarkdownTable(
        ["アクション", "説明"],
        [
          ["🔑 **キーワード変更**", "別のキーワードで再検索"],
          [
            "🌐 **GitHub で検索**",
            "インデックスにないスキルを GitHub から直接検索",
          ],
          ["➕ **ソースを追加**", "新しいリポジトリをインデックスに追加"],
          [
            "🔄 **インデックス更新**",
            `登録済みソースから最新情報を取得${updateInfo.isOutdated ? " ⚠️ 推奨!" : ""}`,
          ],
        ],
      );

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`🔎 ${sourceStats}から検索しました（最終更新: ${
          updateInfo.lastUpdated
        }）
${updateInfo.warning}

"${query}" に一致するスキルが見つかりませんでした。

---
**💡 スキルを見つけるには？**

${guidanceTable}

> 現在のインデックス: ${sourceStats}（最終更新: ${updateInfo.lastUpdated}）`),
      ]);
    }

    // 結果をフォーマット（信頼度バッジ付き）
    const isJa = isJapanese();
    const resultsTable = renderMarkdownTable(
      ["Skill", "Description", "Categories", "Trust"],
      results.map((skill: Skill) => {
        const stars = skill.stars ? ` ⭐${skill.stars}` : "";
        const categories = skill.categories?.join(", ") || "";
        const trust = getTrustBadge(skill.source || "");
        const desc = getLocalizedDescription(skill, isJa);
        return [
          skill.name,
          desc || (isJa ? "説明なし" : "No description"),
          categories,
          `${trust}${stars}`,
        ];
      }),
    );

    const discoveryTable = renderMarkdownTable(
      ["アクション", "説明"],
      [
        [
          "🌐 **GitHub で検索**",
          "インデックスにないスキルを GitHub から直接検索できます",
        ],
        ["➕ **ソースを追加**", "新しいリポジトリをインデックスに追加できます"],
        [
          "🔄 **インデックス更新**",
          `登録済みソースから最新情報を取得できます${updateInfo.isOutdated ? " ⚠️ 推奨!" : ""}`,
        ],
      ],
    );

    // 🌟 おすすめを選定（Official優先、stars順）
    const recommended = results.sort((a: Skill, b: Skill) => {
      const aOfficial = getTrustBadge(a.source || "").includes("Official")
        ? 1
        : 0;
      const bOfficial = getTrustBadge(b.source || "").includes("Official")
        ? 1
        : 0;
      if (aOfficial !== bOfficial) return bOfficial - aOfficial;
      return (b.stars || 0) - (a.stars || 0);
    })[0];

    const recommendSection = recommended
      ? `\n### 🌟 おすすめ: ${recommended.name}\n${
          getLocalizedDescription(recommended, isJa) || ""
        } (${getTrustBadge(recommended.source || "")})\n`
      : "";

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        `🔎 ${sourceStats}から検索しました（最終更新: ${
          updateInfo.lastUpdated
        }）
${updateInfo.warning}

"${query}" の検索結果: ${results.length} 件

${resultsTable}
${recommendSection}
---
**Agent Instructions (MUST FOLLOW):**
- Show the table above to user in a clean format
- Highlight the 🌟 recommended skill
- ⚠️ Community skills: warn users to use at their own risk
- NEVER show commands to user - execute directly when approved
- ❌ **DO NOT automatically call other tools** - just show the suggestions below and wait for user's choice
${
  updateInfo.isOutdated
    ? "- ⚠️ Index is outdated! Strongly suggest updating."
    : ""
}

**📋 Next Actions (show to user, DO NOT auto-execute):**
1. 📦 **Install** → Ask which skill

---
**💡 もっとスキルを探すには？（ユーザーに提案のみ）**

${discoveryTable}

> 現在のインデックス: ${sourceStats}（最終更新: ${updateInfo.lastUpdated}）`,
      ),
    ]);
  }
}

/**
 * スキルインストールツール
 */
class SkillInstallTool implements vscode.LanguageModelTool<{
  skillName: string;
}> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{ skillName: string }>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const skillName = options.input.skillName;
    const index = await getSkillIndex();
    const skills = index.skills;
    const lowerName = skillName.toLowerCase();

    // スキルを検索
    const skill =
      skills.find((s: Skill) => s.name.toLowerCase() === lowerName) ||
      skills.find((s: Skill) => s.name.toLowerCase().includes(lowerName));

    if (!skill) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ ${localizeMcpText(`Skill "${skillName}" not found.`, `スキル "${skillName}" が見つかりません。`)}

---
**📋 ${localizeMcpText("Next Actions", "次のアクション")}:**
1. 🔍 ${localizeMcpText("Search first", "先に検索")} → use #searchSkills
2. ${localizeMcpText("Check spelling and try again", "スペルを確認して再試行")}`,
        ),
      ]);
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(messages.chatNoWorkspaceFolderOpen()),
      ]);
    }

    const context = requireExtContext();
    const targetRoot = await getDefaultManagedRoot(workspaceFolder.uri);
    if (!targetRoot) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(messages.chatNoManagedSkillRoot()),
      ]);
    }

    // インストール実行
    try {
      await installSkill(skill, workspaceFolder.uri, context, targetRoot);

      // インストラクションファイル (AGENTS.md) を更新（設定で有効な場合のみ）
      const config = vscode.workspace.getConfiguration("skillNinja");
      if (config.get<boolean>("autoUpdateInstruction")) {
        await updateInstructionFileForRoot(targetRoot, context);
      }

      // ツリービューをリフレッシュ
      await vscode.commands.executeCommand("skillNinja.refresh");

      const trust = getTrustBadge(skill.source || "");
      const isJa = isJapanese();
      const desc = getLocalizedDescription(skill, isJa);

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `✅ **${skill.name}** をインストールしました！

| 項目 | 内容 |
|-----------|------|
| スキル名 | ${skill.name} |
| 説明 | ${desc || (isJa ? "説明なし" : "No description")} |
| 信頼度 | ${trust} |
| インストール先 | ${targetRoot.displayPath}/${skill.name}/ |

---
**Agent Instructions:**
- Report success with the table above
- If Community skill, add: "⚠️ コミュニティ製スキルは自己責任でご使用ください"

**📋 Next Actions (show to user):**
1. 📄 View SKILL.md content?
2. 📋 List all installed skills?

---
**💡 もっとスキルを探すには？**

| アクション | 説明 |
|-----------|------|
| 🔍 **ローカル検索** | インデックスからスキルを検索 |
| 🌐 **GitHub で検索** | インデックスにないスキルを GitHub から直接検索 |
| ➕ **ソースを追加** | 新しいリポジトリをインデックスに追加 |`,
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          formatMcpError(
            `Failed to install "${skill.name}"`,
            `"${skill.name}" のインストールに失敗しました`,
            error,
          ),
        ),
      ]);
    }
  }
}

/**
 * インストール済みスキル一覧ツール
 */
class SkillListTool implements vscode.LanguageModelTool<Record<string, never>> {
  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(messages.chatNoWorkspaceFolderOpen()),
      ]);
    }

    const installedEntries = await getManagedInstalledSkillsWithMeta(
      workspaceFolder.uri,
    );

    if (installedEntries.length === 0) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `📭 まだスキルがインストールされていません。

---
**💡 スキルを見つけるには？**

| アクション | 説明 |
|-----------|------|
| 🔍 **ローカル検索** | インデックスからスキルを検索 |
| 💡 **おすすめ** | プロジェクトに合ったスキルを推奨 |
| 🌐 **GitHub で検索** | インデックスにないスキルを GitHub から直接検索 |
| ➕ **ソースを追加** | 新しいリポジトリをインデックスに追加 |
| 🔄 **インデックス更新** | 登録済みソースから最新情報を取得 |`,
        ),
      ]);
    }

    const list = installedEntries
      .map(
        ({ root, meta }, index) =>
          `| ${index + 1} | ${meta.name} | ${root.displayPath}/${meta.relativePath || meta.name}/ |`,
      )
      .join("\n");

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        `📦 インストール済みスキル: ${installedEntries.length} 件

| # | Skill Name | Location |
|---|------------|----------|
${list}

---
**Agent Instructions:**
- Show the table in clean format
- Offer to show details of any skill

**📋 Next Actions (show to user):**
1. 📄 View details? → Ask which skill
2. 🗑️ Uninstall? → Confirm before deleting

---
**💡 もっとスキルを探すには？**

| アクション | 説明 |
|-----------|------|
| 🔍 **ローカル検索** | インデックスからスキルを検索 |
| 🌐 **GitHub で検索** | インデックスにないスキルを GitHub から直接検索 |
| ➕ **ソースを追加** | 新しいリポジトリをインデックスに追加 |
| 🔄 **インデックス更新** | 登録済みソースから最新情報を取得 |`,
      ),
    ]);
  }
}

/**
 * スキル推奨ツール
 */
class SkillRecommendTool implements vscode.LanguageModelTool<
  Record<string, never>
> {
  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(messages.chatNoWorkspaceFolderOpen()),
      ]);
    }

    const index = await getSkillIndex();
    const skills = index.skills;
    const recommendations: { skill: Skill; reason: string }[] = [];
    const updateInfo = getIndexUpdateInfo(index);
    const sourceStats = getSourceStats(index);

    const patterns: { glob: string; category: string; reason: string }[] = [
      { glob: "**/*.ts", category: "typescript", reason: "TypeScript project" },
      { glob: "**/package.json", category: "npm", reason: "Node.js project" },
      { glob: "**/*.py", category: "python", reason: "Python project" },
      { glob: "**/.github/**", category: "github", reason: "GitHub workflows" },
      { glob: "**/Dockerfile", category: "docker", reason: "Docker project" },
      { glob: "**/*.bicep", category: "azure", reason: "Azure Bicep files" },
      {
        glob: "**/azure-pipelines.yml",
        category: "azure",
        reason: "Azure DevOps",
      },
      { glob: "**/*.md", category: "markdown", reason: "Documentation files" },
    ];

    for (const pattern of patterns) {
      const files = await vscode.workspace.findFiles(
        pattern.glob,
        "**/node_modules/**",
        1,
      );
      if (files.length === 0) {
        continue;
      }

      const matchingSkills = skills.filter(
        (skill: Skill) =>
          skill.categories?.some((category: string) =>
            category.toLowerCase().includes(pattern.category),
          ) ||
          skill.name.toLowerCase().includes(pattern.category) ||
          skill.description?.toLowerCase().includes(pattern.category),
      );

      for (const skill of matchingSkills.slice(0, 2)) {
        if (!recommendations.find((entry) => entry.skill.name === skill.name)) {
          recommendations.push({ skill, reason: pattern.reason });
        }
      }
    }

    const discoveryTable = renderMarkdownTable(
      ["アクション", "説明"],
      [
        ["🔍 **キーワード検索**", "インデックスからスキルを検索"],
        [
          "🌐 **GitHub で検索**",
          "インデックスにないスキルを GitHub から直接検索",
        ],
        ["➕ **ソースを追加**", "新しいリポジトリをインデックスに追加"],
        [
          "🔄 **インデックス更新**",
          `登録済みソースから最新情報を取得${updateInfo.isOutdated ? " ⚠️ 推奨!" : ""}`,
        ],
      ],
    );

    if (recommendations.length === 0) {
      const popularTable = renderMarkdownTable(
        ["Skill", "Description", "Trust", "Stars"],
        skills
          .filter((skill: Skill) => skill.stars && skill.stars > 0)
          .sort(
            (left: Skill, right: Skill) =>
              (right.stars || 0) - (left.stars || 0),
          )
          .slice(0, 5)
          .map((skill: Skill) => [
            skill.name,
            skill.description || "",
            getTrustBadge(skill.source || ""),
            `⭐${skill.stars || 0}`,
          ]),
      );

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `🔎 ${sourceStats}から分析しました（最終更新: ${
            updateInfo.lastUpdated
          }）
${updateInfo.warning}

🤔 プロジェクト固有の推奨が見つかりませんでした。人気スキルはこちら:

${popularTable}

---
**📋 Next Actions (show to user):**
1. 📦 Install? → Ask which skill

---
**💡 もっとスキルを探すには？**

${discoveryTable}`,
        ),
      ]);
    }

    recommendations.sort((left, right) => {
      const leftOfficial = getTrustBadge(left.skill.source || "").includes(
        "Official",
      )
        ? 1
        : 0;
      const rightOfficial = getTrustBadge(right.skill.source || "").includes(
        "Official",
      )
        ? 1
        : 0;
      return rightOfficial - leftOfficial;
    });

    const isJa = isJapanese();
    const recommendationsTable = renderMarkdownTable(
      ["Skill", "Description", "Reason", "Trust"],
      recommendations
        .slice(0, 5)
        .map((recommendation) => [
          recommendation.skill.name,
          getLocalizedDescription(recommendation.skill, isJa) || "",
          recommendation.reason,
          getTrustBadge(recommendation.skill.source || ""),
        ]),
    );

    const topRecommend = recommendations[0];

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        `🔍 ${sourceStats}から分析しました（最終更新: ${
          updateInfo.lastUpdated
        }）
${updateInfo.warning}

💡 プロジェクト分析に基づく推奨スキル:

${recommendationsTable}

### 🌟 イチオシ: ${topRecommend.skill.name}
${getLocalizedDescription(topRecommend.skill, isJa) || ""}
理由: ${topRecommend.reason} | ${getTrustBadge(topRecommend.skill.source || "")}

---
**Agent Instructions:**
- Show the table and highlight the 🌟 recommendation
- Official skills (🏢) should be prioritized
- Ask user which to install
${updateInfo.isOutdated ? "- ⚠️ Index is outdated! Suggest updating." : ""}

**📋 Next Actions (show to user):**
1. 📦 Install? → Ask which skill, then use #installSkill
2. 📋 List currently installed skills?

---
**💡 もっとスキルを探すには？**

${discoveryTable}`,
      ),
    ]);
  }
}

/**
 * スキルアンインストールツール
 */
class SkillUninstallTool implements vscode.LanguageModelTool<{
  skillName: string;
}> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{ skillName: string }>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const skillName = options.input.skillName;

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(messages.chatNoWorkspaceFolderOpen()),
      ]);
    }

    // インストール済みスキルを確認
    const installedEntries = await getManagedInstalledSkillsWithMeta(
      workspaceFolder.uri,
    );
    const lowerName = skillName.toLowerCase();
    const matchedSkill = installedEntries.find(
      ({ meta }) =>
        meta.name.toLowerCase() === lowerName ||
        meta.name.toLowerCase().includes(lowerName),
    );

    if (!matchedSkill) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ ${localizeMcpText(`Skill "${skillName}" is not installed.`, `スキル "${skillName}" はインストールされていません。`)}

インストール済みスキル: ${
            installedEntries.length > 0
              ? installedEntries.map(({ meta }) => meta.name).join(", ")
              : "なし"
          }

---
**📋 ${localizeMcpText("Next Actions", "次のアクション")}:**
1. 📋 ${localizeMcpText("Check installed skills", "インストール済みスキルを確認")} → use #listSkills

---
**💡 スキルを探すには？**

| アクション | 説明 |
|-----------|------|
| 🔍 **ローカル検索** | インデックスからスキルを検索 |
| 🌐 **GitHub で検索** | GitHub から直接検索 |`,
        ),
      ]);
    }

    // アンインストール実行
    try {
      await uninstallSkillByPath(
        matchedSkill.meta.relativePath || matchedSkill.meta.name,
        workspaceFolder.uri,
        matchedSkill.root.rootUri,
      );

      // インストラクションファイルを更新（設定で有効な場合のみ）
      const config = vscode.workspace.getConfiguration("skillNinja");
      if (config.get<boolean>("autoUpdateInstruction")) {
        await updateInstructionFileForRoot(
          matchedSkill.root,
          requireExtContext(),
        );
      }

      // ツリービューをリフレッシュ
      await vscode.commands.executeCommand("skillNinja.refresh");

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `✅ **${matchedSkill.meta.name}** をアンインストールしました！

| 項目 | 内容 |
|-----------|------|
| スキル名 | ${matchedSkill.meta.name} |
| ステータス | 削除完了 |
| Instruction | 更新済み |

---
**Agent Instructions:**
- Report success
- Remind user that the skill files have been removed

**📋 Next Actions:**
1. 📋 List remaining skills? → use #listSkills

---
**💡 代替スキルを探すには？**

| アクション | 説明 |
|-----------|------|
| 🔍 **ローカル検索** | インデックスからスキルを検索 |
| 🌐 **GitHub で検索** | インデックスにないスキルを GitHub から直接検索 |
| ➕ **ソースを追加** | 新しいリポジトリをインデックスに追加 |`,
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          formatMcpError(
            `Failed to uninstall "${matchedSkill.meta.name}"`,
            `"${matchedSkill.meta.name}" のアンインストールに失敗しました`,
            error,
          ),
        ),
      ]);
    }
  }
}

/**
 * インデックス更新ツール
 */
class UpdateIndexTool implements vscode.LanguageModelTool<
  Record<string, never>
> {
  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    if (!extContext) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(mcpContextUnavailableMessage()),
      ]);
    }

    try {
      // 更新前の情報
      const oldIndex = await getSkillIndex();
      const oldCount = oldIndex.skills.length;
      const oldUpdated = oldIndex.lastUpdated || "unknown";

      // VS Code コマンドでインデックス更新を実行
      await vscode.commands.executeCommand("skillNinja.updateIndex");

      const newIndex = await loadSkillIndex(extContext);

      const newCount = newIndex.skills.length;
      const newUpdated =
        newIndex.lastUpdated || new Date().toISOString().split("T")[0];
      const diff = newCount - oldCount;
      const diffText = diff > 0 ? `+${diff}` : diff === 0 ? "±0" : `${diff}`;

      // ソース統計
      const sourceStats = getSourceStats(newIndex);
      const summaryTable = renderMarkdownTable(
        ["項目", "Before", "After"],
        [
          ["スキル数", String(oldCount), `${newCount} (${diffText})`],
          ["最終更新", oldUpdated, newUpdated],
          ["ソース", "-", sourceStats],
        ],
      );

      const discoveryTable = renderMarkdownTable(
        ["アクション", "説明"],
        [
          [
            "🌐 **GitHub で検索**",
            "インデックスにないスキルを GitHub から直接検索",
          ],
          ["➕ **ソースを追加**", "新しいリポジトリをインデックスに追加"],
        ],
      );

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `✅ スキルインデックスを更新しました！

${summaryTable}

---
**Agent Instructions:**
- Report the update summary
- If new skills were added, suggest searching for them

**📋 Next Actions:**
1. 🔍 Search for new skills? → use #searchSkills
2. 💡 Get recommendations? → use #recommendSkills
3. 📋 List installed skills? → use #listSkills

---
**💡 さらにスキルを増やすには？**

${discoveryTable}`,
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `${formatMcpError("Failed to update index", "インデックス更新に失敗しました", error)}

---
**📋 Troubleshooting:**
1. Check internet connection
2. GitHub API rate limit may be exceeded
3. Try setting a GitHub token in settings`,
        ),
      ]);
    }
  }
}

/**
 * GitHub 検索ツール
 */
class WebSearchTool implements vscode.LanguageModelTool<{ query: string }> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{ query: string }>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const query = options.input.query;

    try {
      // GitHub トークンを取得（設定 / env / gh CLI）
      const token = await getGitHubToken();

      // GitHub で SKILL.md を検索
      const results = await searchGitHub(query, token);

      if (results.length === 0) {
        const guidanceTable = renderMarkdownTable(
          ["アクション", "説明"],
          [
            ["🔑 **キーワード変更**", "別のキーワードで再検索"],
            ["🔍 **ローカル検索**", "インデックスからスキルを検索"],
            ["➕ **ソースを追加**", "既知のリポジトリをインデックスに追加"],
            ["🔄 **インデックス更新**", "登録済みソースから最新情報を取得"],
          ],
        );

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `🔍 GitHub で "${query}" を検索しましたが、SKILL.md は見つかりませんでした。

---
**💡 スキルを見つけるには？**

${guidanceTable}`,
          ),
        ]);
      }

      const resultsTable = renderMarkdownTable(
        ["#", "Repository", "Path", "Stars"],
        results
          .slice(0, 10)
          .map((r, i) => [
            String(i + 1),
            `[${r.repo}](${r.repoUrl})`,
            r.path,
            `⭐${r.stars || 0}`,
          ]),
      );

      const installFlowTable = renderMarkdownTable(
        ["アクション", "説明"],
        [
          ["➕ **ソースを追加**", "上記リポジトリをインデックスに追加"],
          ["🔄 **インデックス更新**", "追加後にインデックスを更新"],
          ["🔍 **ローカル検索**", "追加後にスキルを検索してインストール"],
        ],
      );

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `🌐 GitHub で "${query}" を検索しました（${results.length} 件）

${resultsTable}

---
**Agent Instructions:**
- Show the search results to user
- If user wants to add a repository, use #addSource

**📋 Next Actions:**
1. ➕ Add repository as source? → use #addSource with repo URL

---
**💡 スキルをインストールするには？**

${installFlowTable}`,
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `${formatMcpError("GitHub search failed", "GitHub 検索に失敗しました", error)}

---
**📋 ${localizeMcpText("Troubleshooting", "トラブルシュート")}:**
1. ${localizeMcpText("Check internet connection", "インターネット接続を確認")}
2. ${localizeMcpText("GitHub API rate limit may be exceeded", "GitHub API の rate limit に達している可能性があります")}
3. ${localizeMcpText("Set GitHub token in settings for higher limits", "より高い上限が必要な場合は設定で GitHub token を指定")}`,
        ),
      ]);
    }
  }
}

/**
 * ソース追加ツール
 */
class AddSourceTool implements vscode.LanguageModelTool<{ repoUrl: string }> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{ repoUrl: string }>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const repoUrl = options.input.repoUrl;

    if (!extContext) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(mcpContextUnavailableMessage()),
      ]);
    }

    try {
      // リポジトリ URL を正規化
      let normalizedUrl = repoUrl.trim();
      if (!normalizedUrl.startsWith("http")) {
        // owner/repo 形式の場合
        normalizedUrl = `https://github.com/${normalizedUrl}`;
      }

      // 現在のインデックスを取得
      const currentIndex = await getSkillIndex();

      // ソースを追加
      const result = await addSource(extContext, currentIndex, normalizedUrl);

      const summaryTable = renderMarkdownTable(
        ["項目", "内容"],
        [
          ["リポジトリ", normalizedUrl],
          ["追加スキル数", String(result.addedSkills)],
          ["ステータス", "追加完了"],
        ],
      );

      const nextStepTable = renderMarkdownTable(
        ["アクション", "説明"],
        [
          ["🔍 **スキル検索**", "追加されたスキルを検索"],
          ["💡 **おすすめ**", "プロジェクトに合ったスキルを推奨"],
          ["🌐 **GitHub で検索**", "さらにスキルを探す"],
          ["➕ **ソースを追加**", "他のリポジトリも追加"],
        ],
      );

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `✅ リポジトリをソースに追加しました！

${summaryTable}

---
**Agent Instructions:**
- Report success
- The index has been updated with new skills

**📋 Next Actions:**
1. 🔍 Search for new skills? → use #searchSkills
2. 📦 Install a skill? → use #install

---
**💡 次のステップ**

${nextStepTable}`,
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `${formatMcpError("Failed to add source", "ソース追加に失敗しました", error)}

---
**📋 Troubleshooting:**
1. Check the repository URL format (https://github.com/owner/repo or owner/repo)
2. Private repositories require a GitHub token with Contents: read access, or gh CLI authentication
3. Repository should contain SKILL.md files
4. GitHub API rate limit may be exceeded`,
        ),
      ]);
    }
  }
}

interface RemoveSourceInput {
  sourceId?: string;
  repoUrl?: string;
  sourceName?: string;
}

function normalizeSourceRepoUrl(value: string): string {
  const trimmed = value.trim();
  const url = trimmed.startsWith("http")
    ? trimmed
    : `https://github.com/${trimmed}`;
  return url
    .replace(/[?#].*$/, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function resolveSourceToRemove(
  index: SkillIndex,
  input: RemoveSourceInput,
): {
  source?: SkillIndex["sources"][number];
  error?: SourceRemoveResolveError;
} {
  const sourceId = input.sourceId?.trim();
  const repoUrl = input.repoUrl?.trim();
  const sourceName = input.sourceName?.trim();

  if (!sourceId && !repoUrl && !sourceName) {
    return {
      error: { kind: "missingInput" },
    };
  }

  const normalizedRepoUrl = repoUrl
    ? normalizeSourceRepoUrl(repoUrl)
    : undefined;
  const normalizedSourceName = sourceName?.toLowerCase();
  const matches = index.sources.filter((source) => {
    if (sourceId && source.id === sourceId) return true;
    if (
      normalizedRepoUrl &&
      normalizeSourceRepoUrl(source.url) === normalizedRepoUrl
    ) {
      return true;
    }
    return Boolean(
      normalizedSourceName &&
      source.name.toLowerCase() === normalizedSourceName,
    );
  });

  if (matches.length === 1) {
    return { source: matches[0] };
  }

  if (matches.length > 1) {
    return {
      error: {
        kind: "multipleMatches",
        sourceIds: matches.map((source) => source.id),
      },
    };
  }

  const availableSources = index.sources
    .slice(0, 10)
    .map((source) => `${source.id} (${source.name})`)
    .join(", ");
  return {
    error: { kind: "notFound", availableSources },
  };
}

/**
 * ソース削除ツール
 */
class RemoveSourceTool implements vscode.LanguageModelTool<RemoveSourceInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<RemoveSourceInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    if (!extContext) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(mcpContextUnavailableMessage()),
      ]);
    }

    try {
      const currentIndex = await getSkillIndex();
      const resolved = resolveSourceToRemove(currentIndex, options.input || {});
      if (!resolved.source) {
        const error = resolved.error || {
          kind: "notFound",
          availableSources: "",
        };
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(formatSourceRemoveError(error)),
        ]);
      }

      const removedSource = resolved.source;
      const result = await removeSource(
        extContext,
        currentIndex,
        removedSource.id,
      );
      const summaryTable = renderMarkdownTable(
        ["項目", "内容"],
        [
          ["ソース", `${removedSource.name} (${removedSource.id})`],
          ["リポジトリ", removedSource.url],
          ["削除スキル数", String(result.removedSkills)],
          ["ステータス", "削除完了"],
        ],
      );

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `✅ ソースリポジトリを削除しました。\n\n${summaryTable}`,
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          formatMcpError(
            "Failed to remove source",
            "ソース削除に失敗しました",
            error,
          ),
        ),
      ]);
    }
  }
}

/**
 * スキル説明ローカライズツール
 * AIエージェントがスキル説明を翻訳してインデックスに保存
 */
interface LocalizeInput {
  skillName: string;
  description_en?: string;
  description_ja?: string;
}

class LocalizeSkillsTool implements vscode.LanguageModelTool<LocalizeInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<LocalizeInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const { skillName, description_en, description_ja } = options.input;

    if (!skillName) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ ${localizeMcpText("skillName is required.", "skillName は必須です。")}

${localizeMcpText("Usage: Provide skillName and at least one of description_en or description_ja.", "使い方: skillName と description_en または description_ja の少なくとも一方を指定してください。")}`,
        ),
      ]);
    }

    if (!description_en && !description_ja) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ ${localizeMcpText("At least one of description_en or description_ja is required.", "description_en または description_ja の少なくとも一方が必要です。")}`,
        ),
      ]);
    }

    try {
      const index = await getSkillIndex();
      const skill = index.skills.find(
        (s) => s.name.toLowerCase() === skillName.toLowerCase(),
      );

      if (!skill) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `❌ ${localizeMcpText(`Skill "${skillName}" not found in index.`, `スキル "${skillName}" がインデックスに見つかりません。`)}

${localizeMcpText("Try searching for the skill first with skillNinja_search.", "先に skillNinja_search でスキルを検索してください。")}`,
          ),
        ]);
      }

      // 説明を更新
      let updated = false;
      if (description_en) {
        skill.description = description_en;
        updated = true;
      }
      if (description_ja) {
        skill.description_ja = description_ja;
        updated = true;
      }

      if (updated) {
        // インデックスを保存
        await saveSkillIndex(requireExtContext(), index);
      }

      const summaryTable = renderMarkdownTable(
        ["Field", "Value"],
        [
          ["Skill", skillName],
          ["English", skill.description || "(not set)"],
          ["Japanese", skill.description_ja || "(not set)"],
        ],
      );

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `✅ Skill "${skillName}" localized successfully!

${summaryTable}

---
**Agent Instructions:**
- The skill description has been updated in the local index
- Changes will persist across sessions`,
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          formatMcpError(
            "Failed to localize skill",
            "スキル説明のローカライズに失敗しました",
            error,
          ),
        ),
      ]);
    }
  }
}
