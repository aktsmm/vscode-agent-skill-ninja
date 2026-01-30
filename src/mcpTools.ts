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
  getInstalledSkills,
  uninstallSkill,
} from "./skillInstaller";
import { updateInstructionFile } from "./instructionManager";
import { searchGitHub, addSource } from "./indexUpdater";
import { isJapanese } from "./i18n";
import { getGitHubToken } from "./githubAuth";

/** スキルインデックスをキャッシュ */
let cachedIndex: SkillIndex | undefined;
let extContext: vscode.ExtensionContext | undefined;

/** スキルインデックスを取得 */
async function getSkillIndex(): Promise<SkillIndex> {
  if (!cachedIndex && extContext) {
    cachedIndex = await loadSkillIndex(extContext);
  }
  return cachedIndex!;
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
    context.subscriptions.push(
      vscode.lm.registerTool("skillNinja_search", new SkillSearchTool()),
    );

    // スキルインストールツール
    context.subscriptions.push(
      vscode.lm.registerTool("skillNinja_install", new SkillInstallTool()),
    );

    // インストール済み一覧ツール
    context.subscriptions.push(
      vscode.lm.registerTool("skillNinja_list", new SkillListTool()),
    );

    // スキル推奨ツール
    context.subscriptions.push(
      vscode.lm.registerTool("skillNinja_recommend", new SkillRecommendTool()),
    );

    // スキルアンインストールツール
    context.subscriptions.push(
      vscode.lm.registerTool("skillNinja_uninstall", new SkillUninstallTool()),
    );

    // インデックス更新ツール
    context.subscriptions.push(
      vscode.lm.registerTool("skillNinja_updateIndex", new UpdateIndexTool()),
    );

    // GitHub 検索ツール
    context.subscriptions.push(
      vscode.lm.registerTool("skillNinja_webSearch", new WebSearchTool()),
    );

    // ソース追加ツール
    context.subscriptions.push(
      vscode.lm.registerTool("skillNinja_addSource", new AddSourceTool()),
    );

    // スキル説明ローカライズツール
    context.subscriptions.push(
      vscode.lm.registerTool("skillNinja_localize", new LocalizeSkillsTool()),
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
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`🔎 ${sourceStats}から検索しました（最終更新: ${
          updateInfo.lastUpdated
        }）
${updateInfo.warning}

"${query}" に一致するスキルが見つかりませんでした。

---
**💡 スキルを見つけるには？**

| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------|||| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------||
| 🔑 **キーワード変更** | 別のキーワードで再検索 |
| 🌐 **GitHub で検索** | インデックスにないスキルを GitHub から直接検索 |
| ➕ **ソースを追加** | 新しいリポジトリをインデックスに追加 |
| 🔄 **インデックス更新** | 登録済みソースから最新情報を取得${
          updateInfo.isOutdated ? " ⚠️ 推奨!" : ""
        } |

> 現在のインデックス: ${sourceStats}（最終更新: ${updateInfo.lastUpdated}）`),
      ]);
    }

    // 結果をフォーマット（信頼度バッジ付き）
    const isJa = isJapanese();
    const formatted = results
      .map((skill: Skill) => {
        const stars = skill.stars ? ` ⭐${skill.stars}` : "";
        const categories = skill.categories?.join(", ") || "";
        const trust = getTrustBadge(skill.source || "");
        const desc = getLocalizedDescription(skill, isJa);
        return `| ${skill.name} | ${
          desc || (isJa ? "説明なし" : "No description")
        } | ${categories} | ${trust} |${stars}`;
      })
      .join("\n");

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

| Skill | Description | Categories | Trust |
|| アクション | 説明 |
|-----------|------|-|| アクション | 説明 |
|-----------|------|| アクション | 説明 |
|-----------|------|-|| アクション | 説明 |
|-----------|------|| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------|-|
${formatted}
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

| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------|||| アクション | 説明 |
|-----------|------||
| 🌐 **GitHub で検索** | インデックスにないスキルを GitHub から直接検索できます |
| ➕ **ソースを追加** | 新しいリポジトリをインデックスに追加できます |
| 🔄 **インデックス更新** | 登録済みソースから最新情報を取得できます${
          updateInfo.isOutdated ? " ⚠️ 推奨!" : ""
        } |

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
          `❌ Skill "${skillName}" not found.

---
**📋 Next Actions:**
1. 🔍 Search first → use #searchSkills to find available skills
2. Check spelling and try again`,
        ),
      ]);
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ No workspace folder open. Please open a folder first.`,
        ),
      ]);
    }

    // インストール実行
    try {
      await installSkill(skill, workspaceFolder.uri, extContext!);

      // インストラクションファイル (AGENTS.md) を更新（設定で有効な場合のみ）
      const config = vscode.workspace.getConfiguration("skillNinja");
      if (config.get<boolean>("autoUpdateInstruction")) {
        await updateInstructionFile(workspaceFolder.uri, extContext!);
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
|| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------||
| スキル名 | ${skill.name} |
| 説明 | ${desc || (isJa ? "説明なし" : "No description")} |
| 信頼度 | ${trust} |
| インストール先 | .github/skills/${skill.name}/ |

---
**Agent Instructions:**
- Report success with the table above
- If Community skill, add: "⚠️ コミュニティ製スキルは自己責任でご使用ください"

**📋 Next Actions (show to user):**
1. 📄 View SKILL.md content?
2. � List all installed skills?

---
**💡 もっとスキルを探すには？**

| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------|||| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------||
| 🔍 **ローカル検索** | インデックスからスキルを検索 |
| 🌐 **GitHub で検索** | インデックスにないスキルを GitHub から直接検索 |
| ➕ **ソースを追加** | 新しいリポジトリをインデックスに追加 |`,
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ Failed to install "${skill.name}": ${error}`,
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
        new vscode.LanguageModelTextPart("❌ No workspace folder open."),
      ]);
    }

    const installed = await getInstalledSkills(workspaceFolder.uri);

    if (installed.length === 0) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `📭 まだスキルがインストールされていません。

---
**� スキルを見つけるには？**

| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------|||| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------||
| 🔍 **ローカル検索** | インデックスからスキルを検索 |
| 💡 **おすすめ** | プロジェクトに合ったスキルを推奨 |
| 🌐 **GitHub で検索** | インデックスにないスキルを GitHub から直接検索 |
| ➕ **ソースを追加** | 新しいリポジトリをインデックスに追加 |
| 🔄 **インデックス更新** | 登録済みソースから最新情報を取得 |`,
        ),
      ]);
    }

    const list = installed
      .map((name, i) => `| ${i + 1} | ${name} | .github/skills/${name}/ |`)
      .join("\n");

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        `📦 インストール済みスキル: ${installed.length} 件

| # | Skill Name | Location |
|---|| アクション | 説明 |
|-----------|------|| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------|----|
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
|-----------|------||| アクション | 説明 |
|-----------|------|||| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------||
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
        new vscode.LanguageModelTextPart(
          "❌ No workspace open. Cannot analyze project.",
        ),
      ]);
    }

    const index = await getSkillIndex();
    const skills = index.skills;
    const recommendations: { skill: Skill; reason: string }[] = [];

    // インデックス更新情報を取得
    const updateInfo = getIndexUpdateInfo(index);
    const sourceStats = getSourceStats(index);

    // ファイルパターンに基づく推奨
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
      if (files.length > 0) {
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
      // 人気スキルを返す
      const popular = skills
        .filter((s: Skill) => s.stars && s.stars > 0)
        .sort((a: Skill, b: Skill) => (b.stars || 0) - (a.stars || 0))
        .slice(0, 5);

      const list = popular
        .map(
          (s: Skill) =>
            `| ${s.name} | ${s.description || ""} | ${getTrustBadge(
              s.source || "",
            )} | ⭐${s.stars} |`,
        )
        .join("\n");

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `🔎 ${sourceStats}から分析しました（最終更新: ${
            updateInfo.lastUpdated
          }）
${updateInfo.warning}

🤔 プロジェクト固有の推奨が見つかりませんでした。人気スキルはこちら:

| Skill | Description | Trust | Stars |
|| アクション | 説明 |
|-----------|------|-|| アクション | 説明 |
|-----------|------|| アクション | 説明 |
|-----------|------|-|| アクション | 説明 |
|-----------|------|-|| アクション | 説明 |
|-----------|------|-|
${list}

---
**📋 Next Actions (show to user):**
1. 📦 Install? → Ask which skill

---
**💡 もっとスキルを探すには？**

| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------|||| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------||
| 🔍 **キーワード検索** | インデックスからスキルを検索 |
| 🌐 **GitHub で検索** | インデックスにないスキルを GitHub から直接検索 |
| ➕ **ソースを追加** | 新しいリポジトリをインデックスに追加 |
| 🔄 **インデックス更新** | 登録済みソースから最新情報を取得${
            updateInfo.isOutdated ? " ⚠️ 推奨!" : ""
          } |`,
        ),
      ]);
    }

    // 推奨をOfficial優先でソート
    recommendations.sort((a, b) => {
      const aOfficial = getTrustBadge(a.skill.source || "").includes("Official")
        ? 1
        : 0;
      const bOfficial = getTrustBadge(b.skill.source || "").includes("Official")
        ? 1
        : 0;
      return bOfficial - aOfficial;
    });

    const isJa = isJapanese();
    const list = recommendations
      .slice(0, 5)
      .map(
        (r) =>
          `| ${r.skill.name} | ${
            getLocalizedDescription(r.skill, isJa) || ""
          } | ${r.reason} | ${getTrustBadge(r.skill.source || "")} |`,
      )
      .join("\n");

    const topRecommend = recommendations[0];

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        `🔍 ${sourceStats}から分析しました（最終更新: ${
          updateInfo.lastUpdated
        }）
${updateInfo.warning}

💡 プロジェクト分析に基づく推奨スキル:

| Skill | Description | Reason | Trust |
|| アクション | 説明 |
|-----------|------|-|| アクション | 説明 |
|-----------|------|-| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------|-|
${list}

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
2. � List currently installed skills?

---
**💡 もっとスキルを探すには？**

| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------|||| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------||
| 🔍 **キーワード検索** | インデックスからスキルを検索 |
| 🌐 **GitHub で検索** | インデックスにないスキルを GitHub から直接検索 |
| ➕ **ソースを追加** | 新しいリポジトリをインデックスに追加 |
| 🔄 **インデックス更新** | 登録済みソースから最新情報を取得${
          updateInfo.isOutdated ? " ⚠️ 推奨!" : ""
        } |`,
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
        new vscode.LanguageModelTextPart(
          `❌ No workspace folder open. Please open a folder first.`,
        ),
      ]);
    }

    // インストール済みスキルを確認
    const installed = await getInstalledSkills(workspaceFolder.uri);
    const lowerName = skillName.toLowerCase();
    const matchedSkill = installed.find(
      (name) =>
        name.toLowerCase() === lowerName ||
        name.toLowerCase().includes(lowerName),
    );

    if (!matchedSkill) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ Skill "${skillName}" is not installed.

インストール済みスキル: ${installed.length > 0 ? installed.join(", ") : "なし"}

---
**📋 Next Actions:**
1. 📋 Check installed skills → use #listSkills

---
**💡 スキルを探すには？**

| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------|||| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------||
| 🔍 **ローカル検索** | インデックスからスキルを検索 |
| 🌐 **GitHub で検索** | GitHub から直接検索 |`,
        ),
      ]);
    }

    // アンインストール実行
    try {
      await uninstallSkill(matchedSkill, workspaceFolder.uri);

      // インストラクションファイルを更新（設定で有効な場合のみ）
      const config = vscode.workspace.getConfiguration("skillNinja");
      if (config.get<boolean>("autoUpdateInstruction")) {
        await updateInstructionFile(workspaceFolder.uri, extContext!);
      }

      // ツリービューをリフレッシュ
      await vscode.commands.executeCommand("skillNinja.refresh");

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `✅ **${matchedSkill}** をアンインストールしました！

| 項目 | 内容 |
|| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------||
| スキル名 | ${matchedSkill} |
| ステータス | 削除完了 |
| AGENTS.md | 更新済み |

---
**Agent Instructions:**
- Report success
- Remind user that the skill files have been removed

**📋 Next Actions:**
1. � List remaining skills? → use #listSkills

---
**💡 代替スキルを探すには？**

| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------|||| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------||
| 🔍 **ローカル検索** | インデックスからスキルを検索 |
| 🌐 **GitHub で検索** | インデックスにないスキルを GitHub から直接検索 |
| ➕ **ソースを追加** | 新しいリポジトリをインデックスに追加 |`,
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ Failed to uninstall "${matchedSkill}": ${error}`,
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
        new vscode.LanguageModelTextPart(`❌ Extension context not available.`),
      ]);
    }

    try {
      // 更新前の情報
      const oldIndex = await getSkillIndex();
      const oldCount = oldIndex.skills.length;
      const oldUpdated = oldIndex.lastUpdated || "unknown";

      // VS Code コマンドでインデックス更新を実行
      await vscode.commands.executeCommand("skillNinja.updateIndex");

      // キャッシュをクリアして新しいインデックスを読み込む
      cachedIndex = undefined;
      const newIndex = await loadSkillIndex(extContext);
      cachedIndex = newIndex;

      const newCount = newIndex.skills.length;
      const newUpdated =
        newIndex.lastUpdated || new Date().toISOString().split("T")[0];
      const diff = newCount - oldCount;
      const diffText = diff > 0 ? `+${diff}` : diff === 0 ? "±0" : `${diff}`;

      // ソース統計
      const sourceStats = getSourceStats(newIndex);

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `✅ スキルインデックスを更新しました！

| 項目 | Before | After |
|| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------|-|
| スキル数 | ${oldCount} | ${newCount} (${diffText}) |
| 最終更新 | ${oldUpdated} | ${newUpdated} |
| ソース | - | ${sourceStats} |

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

| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------|||| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------||
| 🌐 **GitHub で検索** | インデックスにないスキルを GitHub から直接検索 |
| ➕ **ソースを追加** | 新しいリポジトリをインデックスに追加 |`,
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ Failed to update index: ${error}

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
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `🔍 GitHub で "${query}" を検索しましたが、SKILL.md は見つかりませんでした。

---
**� スキルを見つけるには？**

| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------|||| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------||
| 🔑 **キーワード変更** | 別のキーワードで再検索 |
| 🔍 **ローカル検索** | インデックスからスキルを検索 |
| ➕ **ソースを追加** | 既知のリポジトリをインデックスに追加 |
| 🔄 **インデックス更新** | 登録済みソースから最新情報を取得 |`,
          ),
        ]);
      }

      // 結果をフォーマット
      const formatted = results
        .slice(0, 10)
        .map((r, i) => {
          return `| ${i + 1} | [${r.repo}](${r.repoUrl}) | ${r.path} | ⭐${
            r.stars || 0
          } |`;
        })
        .join("\n");

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `🌐 GitHub で "${query}" を検索しました（${results.length} 件）

| # | Repository | Path | Stars |
|---|| アクション | 説明 |
|-----------|------|| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------|-|
${formatted}

---
**Agent Instructions:**
- Show the search results to user
- If user wants to add a repository, use #addSource

**📋 Next Actions:**
1. ➕ Add repository as source? → use #addSource with repo URL

---
**💡 スキルをインストールするには？**

| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------|||| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------||
| ➕ **ソースを追加** | 上記リポジトリをインデックスに追加 |
| 🔄 **インデックス更新** | 追加後にインデックスを更新 |
| 🔍 **ローカル検索** | 追加後にスキルを検索してインストール |`,
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ GitHub search failed: ${error}

---
**📋 Troubleshooting:**
1. Check internet connection
2. GitHub API rate limit may be exceeded (60 req/hour without token)
3. Set GitHub token in settings for higher limits`,
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
        new vscode.LanguageModelTextPart(`❌ Extension context not available.`),
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

      // キャッシュを更新
      cachedIndex = result.index;

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `✅ リポジトリをソースに追加しました！

| 項目 | 内容 |
|| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------||
| リポジトリ | ${normalizedUrl} |
| 追加スキル数 | ${result.addedSkills} |
| ステータス | 追加完了 |

---
**Agent Instructions:**
- Report success
- The index has been updated with new skills

**📋 Next Actions:**
1. 🔍 Search for new skills? → use #searchSkills
2. � Install a skill? → use #install

---
**💡 次のステップ**

| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------|||| アクション | 説明 |
|-----------|------||| アクション | 説明 |
|-----------|------||
| 🔍 **スキル検索** | 追加されたスキルを検索 |
| 💡 **おすすめ** | プロジェクトに合ったスキルを推奨 |
| 🌐 **GitHub で検索** | さらにスキルを探す |
| ➕ **ソースを追加** | 他のリポジトリも追加 |`,
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ Failed to add source: ${error}

---
**📋 Troubleshooting:**
1. Check the repository URL format (https://github.com/owner/repo or owner/repo)
2. Repository must be public
3. Repository should contain SKILL.md files
4. GitHub API rate limit may be exceeded`,
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
          `❌ skillName is required.

Usage: Provide skillName and at least one of description_en or description_ja.`,
        ),
      ]);
    }

    if (!description_en && !description_ja) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ At least one of description_en or description_ja is required.`,
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
            `❌ Skill "${skillName}" not found in index.

Try searching for the skill first with skillNinja_search.`,
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
        await saveSkillIndex(extContext!, index);
        cachedIndex = index;
      }

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `✅ Skill "${skillName}" localized successfully!

| Field | Value |
|| アクション | 説明 |
|-----------|------|-|| アクション | 説明 |
|-----------|------|-|
| Skill | ${skillName} |
| English | ${skill.description || "(not set)"} |
| Japanese | ${skill.description_ja || "(not set)"} |

---
**Agent Instructions:**
- The skill description has been updated in the local index
- Changes will persist across sessions`,
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ Failed to localize skill: ${error}`,
        ),
      ]);
    }
  }
}
