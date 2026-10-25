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
  uninstallSkillByPath,
} from "./skillInstaller";
import { updateInstructionFileForRoot } from "./instructionManager";
import { getSourceLastIndexedAt } from "./sourceIndexFreshness";
import { searchGitHub, addSource, removeSource } from "./indexUpdater";
import { isJapanese, messages } from "./i18n";
import { getGitHubToken } from "./githubAuth";
import { getManagedSkillRoots, type SkillRoot } from "./skillLocations";
import {
  applyReinstallPlan,
  collectInstalledEntries,
  createReinstallPlan,
  listManagedRoots,
  findExistingSkillFolder,
  type ApplyResult,
  type InstalledEntry,
  type PlanContext,
  type ReinstallInput,
} from "./skillReinstall";
import {
  buildCandidateId,
  describeContentDiffDetails,
  describeProvenance,
  findNameCandidates,
  selectSkillForInstall,
  type ContentDiff,
  type PlanItem,
  type ReinstallReason,
} from "./skillReinstallPlan";

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

function getIndexSkills(index: SkillIndex): Skill[] {
  return Array.isArray(index.skills) ? index.skills : [];
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
 * source ごとに更新できるので、鮮度は最も古い source を基準にする
 */
function getIndexUpdateInfo(index: SkillIndex): {
  lastUpdated: string;
  daysOld: number;
  isOutdated: boolean;
  warning: string;
} {
  const perSourceStamps = index.sources
    .map((source) => getSourceLastIndexedAt(source))
    .filter((stamp): stamp is string => Boolean(stamp))
    .sort();
  const lastUpdated =
    perSourceStamps.length === index.sources.length &&
    perSourceStamps.length > 0
      ? perSourceStamps[0]
      : index.lastScannedAt || "unknown";
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

  return {
    lastUpdated: lastUpdated.split("T")[0],
    daysOld,
    isOutdated,
    warning,
  };
}

/**
 * ソース統計を取得
 */
function getSourceStats(index: SkillIndex): string {
  const sourceCount = index.sources?.length || 0;
  const skillCount = getIndexSkills(index).length;
  return `${sourceCount} リポジトリ、${skillCount} スキル`;
}

async function getDefaultManagedRoot(
  workspaceUri: vscode.Uri,
): Promise<SkillRoot | undefined> {
  const roots = await getManagedSkillRoots(workspaceUri);
  return roots.find((root) => root.scope === "workspace") || roots[0];
}

function escapeMarkdownCell(value: string): string {
  // バックスラッシュを先に逃がさないと、`\|` 入力が `\\|` になって区切りとして再解釈される
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
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
 * 破壊的な tool の確認ダイアログを組み立てる。
 * 値は tool 入力なので Markdown として解釈させない。
 */
function buildConfirmation(
  title: string,
  lead: string,
  value: string,
): { title: string; message: vscode.MarkdownString } {
  const message = new vscode.MarkdownString();
  message.appendMarkdown(`${lead}\n\n`);
  message.appendText(value);
  return { title, message };
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

    // スキル再インストールツール
    registerToolAliases(
      context,
      ["skillNinja_reinstall", "reinstallSkills"],
      () => {
        return new SkillReinstallTool();
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
    const skills = getIndexSkills(index);
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
      ["Skill", "Description", "Categories", "Trust", "Candidate ID"],
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
          skill.path ? buildCandidateId(skill.source, skill.path) : "",
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
interface SkillInstallInput {
  skillName: string;
  /** searchSkills が返す Candidate ID（`source::path`）。同名の候補が複数あるときに指定する */
  candidateId?: string;
  source?: string;
  /** listSkills / reinstallSkills が返す rootId。省略時は従来どおりワークスペースのルート */
  rootId?: string;
}

class SkillInstallTool implements vscode.LanguageModelTool<SkillInstallInput> {
  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<SkillInstallInput>,
  ): vscode.PreparedToolInvocation {
    const { skillName, rootId, candidateId } = options.input;
    return {
      invocationMessage: localizeMcpText(
        "Installing skill",
        "スキルをインストール中",
      ),
      confirmationMessages: buildConfirmation(
        localizeMcpText("Install skill", "スキルをインストール"),
        rootId
          ? localizeMcpText(
              `This writes skill files into the skill root "${rootId}".`,
              `スキルルート "${rootId}" にスキルファイルを書き込みます。`,
            )
          : localizeMcpText(
              "This writes skill files into the workspace skill root.",
              "ワークスペースのスキルルートにスキルファイルを書き込みます。",
            ),
        candidateId ? `${skillName} (${candidateId})` : skillName,
      ),
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<SkillInstallInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const { skillName, candidateId, source, rootId } = options.input;
    const index = await getSkillIndex();
    const skills = getIndexSkills(index);

    // 同名の候補が複数あるときは、先頭を選ばずに候補を返して止まる
    const selection = selectSkillForInstall(skills, {
      skillName,
      candidateId,
      source,
    });

    if (selection.kind === "ambiguous") {
      const candidatesTable = renderMarkdownTable(
        ["Candidate ID", "Source", "Path", "Trust"],
        selection.skills.map((candidate: Skill) => [
          buildCandidateId(candidate.source, candidate.path),
          candidate.source,
          candidate.path,
          getTrustBadge(candidate.source || ""),
        ]),
      );
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ ${localizeMcpText(
            `"${skillName}" matches several skills, so nothing was installed.`,
            `"${skillName}" は複数のスキルに一致するため、何もインストールしていません。`,
          )}

${candidatesTable}

---
**Agent Instructions:**
- Ask the user which candidate to install, then call this tool again with that exact \`candidateId\` (and the same \`skillName\`)
- Never pick one by order or by your own guess`,
        ),
      ]);
    }

    if (selection.kind === "none") {
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

    const skill = selection.skill;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const context = requireExtContext();

    let targetRoot: SkillRoot | undefined;
    let installWorkspaceUri = workspaceFolder?.uri;
    if (rootId) {
      const managedRoots = await listManagedRoots(
        workspaceFolder?.uri,
        isJapanese(),
      );
      const matched = managedRoots.find((entry) => entry.rootId === rootId);
      if (!matched) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `❌ ${localizeMcpText(
              `Skill root "${rootId}" is not a writable managed root, so nothing was installed.`,
              `スキルルート "${rootId}" は書き込み可能な管理対象ではないため、何もインストールしていません。`,
            )}

${localizeMcpText("Available roots", "指定できるルート")}:
${managedRoots.map((entry) => `- ${entry.label}`).join("\n")}`,
          ),
        ]);
      }
      targetRoot = matched.root;
      installWorkspaceUri ??= matched.root.rootUri;

      // 既存のフォルダへ重ね書きしない。独自編集の確認と出所の記録は reinstallSkills が行う。
      const existingFolder = findExistingSkillFolder(targetRoot, skill);
      if (existingFolder) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `❌ ${localizeMcpText(
              `A skill folder already exists at ${existingFolder}, so nothing was installed. To replace an installed skill from its source use #reinstallSkills (preview first).`,
              `${existingFolder} に既にスキルフォルダがあるため、何もインストールしていません。インストール済みのスキルを取得元で置き換えるには #reinstallSkills（先にプレビュー）を使ってください。`,
            )}`,
          ),
        ]);
      }
    } else {
      if (!workspaceFolder) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            messages.chatNoWorkspaceFolderOpen(),
          ),
        ]);
      }
      targetRoot = await getDefaultManagedRoot(workspaceFolder.uri);
    }

    if (!targetRoot || !installWorkspaceUri) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(messages.chatNoManagedSkillRoot()),
      ]);
    }

    // インストール実行
    try {
      const installResult = await installSkill(
        skill,
        installWorkspaceUri,
        context,
        targetRoot,
      );

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
      const installedRootLabel = (
        await listManagedRoots(workspaceFolder?.uri, isJa)
      ).find((entry) => entry.root.rootPath === targetRoot.rootPath)?.label;
      const summaryTable = renderMarkdownTable(
        ["項目", "内容"],
        [
          ["スキル名", skill.name],
          ["説明", desc || (isJa ? "説明なし" : "No description")],
          ["信頼度", trust],
          [
            "Candidate ID",
            skill.path ? buildCandidateId(skill.source, skill.path) : "",
          ],
          ["配置先ルート", installedRootLabel ?? targetRoot.displayPath],
          [
            "インストール先",
            `${targetRoot.displayPath}/${installResult.installedPath}/`,
          ],
        ],
      );

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `${
            installResult.status === "partial"
              ? isJa
                ? `⚠️ **${skill.name}** をインストールしましたが、一部のファイルを取得できませんでした。`
                : `⚠️ **${skill.name}** was installed, but some files could not be downloaded.`
              : isJa
                ? `✅ **${skill.name}** をインストールしました！`
                : `✅ **${skill.name}** installed successfully!`
          }

${summaryTable}

---
**Agent Instructions:**
- ${
            installResult.status === "partial"
              ? "Report the partial install with the table above and tell the user to reinstall the skill"
              : "Report success with the table above"
          }
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
interface SkillListInput {
  /** 指定したルートだけを表示する（例: home-codex） */
  rootId?: string;
  /** 指定した source だけを表示する */
  source?: string;
  name?: string;
}

class SkillListTool implements vscode.LanguageModelTool<SkillListInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<SkillListInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const isJa = isJapanese();
    const filter = options.input ?? {};

    // ワークスペースが無くても、Home などの user root は一覧できる
    const { entries: collected } = await collectInstalledEntries(
      workspaceFolder?.uri,
      isJa,
    );
    const installedEntries = collected.filter(
      ({ plan }) =>
        (!filter.rootId || plan.rootId === filter.rootId) &&
        (!filter.source ||
          plan.source.toLowerCase() === filter.source.toLowerCase()) &&
        (!filter.name || plan.name.toLowerCase() === filter.name.toLowerCase()),
    );

    if (!workspaceFolder && collected.length === 0) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(messages.chatNoWorkspaceFolderOpen()),
      ]);
    }

    if (installedEntries.length === 0 && collected.length > 0) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `📭 ${localizeMcpText(
            "No installed skill matches the filter.",
            "フィルタに一致するインストール済みスキルはありません。",
          )}`,
        ),
      ]);
    }

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

    const indexSkills = getIndexSkills(await getSkillIndex());
    const provenanceText = (entry: (typeof installedEntries)[number]) =>
      describeProvenance(
        entry.plan,
        findNameCandidates(indexSkills, entry.plan).length,
      );
    const list = renderMarkdownTable(
      [
        "#",
        "Skill Name",
        "Location",
        "Entry ID",
        "Root",
        "Source",
        "Remote path",
        "Revision",
        "Provenance",
      ],
      installedEntries.map((entry, position) => [
        String(position + 1),
        entry.meta.name,
        `${entry.root.displayPath}/${entry.meta.relativePath || entry.meta.name}/`,
        entry.plan.entryId,
        entry.plan.rootLabel,
        entry.plan.source === "local" || entry.plan.source === "unknown"
          ? "-"
          : entry.plan.source,
        entry.plan.remotePath ?? "-",
        entry.plan.sourceRevision?.commitSha.slice(0, 7) ?? "-",
        provenanceText(entry),
      ]),
    );

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        `📦 インストール済みスキル: ${installedEntries.length} 件

${list}

---
**Agent Instructions:**
- Show the table in clean format
- Use Entry ID / Root IDs from this table when calling #uninstallSkill, #installSkill, or #reinstallSkills — never guess a target from the skill name alone
- Provenance "no metadata (...)" means the source is unknown; never assume it from the name. "local only" means no skill with that name exists in the index, so there is nothing to reinstall it from; leave it alone

**📋 Next Actions (show to user):**
1. 📄 View details? → Ask which skill
2. 🗑️ Uninstall? → Confirm before deleting
3. 🔄 Reinstall from its source? → Preview with #reinstallSkills first

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
    const skills = getIndexSkills(index);
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
 * アンインストール対象を解決する。入力は部分一致でも受けるので、
 * 確認ダイアログと実際の削除対象がずれないよう同じ関数を両方で使う。
 *
 * 候補が複数のときは解決しない。同名スキルは別のスキルルートにも存在しうるので、
 * 先に見つかった 1 件を消すと確認した対象と別の実体を削除しうる。
 */
async function resolveInstalledSkillToUninstall(input: SkillUninstallInput) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const { entries } = await collectInstalledEntries(
    workspaceFolder?.uri,
    isJapanese(),
  );
  if (!workspaceFolder && entries.length === 0) {
    return undefined;
  }

  const installedEntries = entries;
  let candidates: InstalledEntry[];
  if (input.entryId) {
    // entryId は 1 件に確定する。名前や rootId では絞り込まない
    candidates = installedEntries.filter(
      ({ plan }) => plan.entryId === input.entryId,
    );
  } else {
    const lowerName = (input.skillName ?? "").toLowerCase();
    const inScope = installedEntries.filter(
      ({ plan }) => !input.rootId || plan.rootId === input.rootId,
    );
    const exactMatches = inScope.filter(
      ({ meta }) => meta.name.toLowerCase() === lowerName,
    );
    candidates = !lowerName
      ? []
      : exactMatches.length > 0
        ? exactMatches
        : inScope.filter(({ meta }) =>
            meta.name.toLowerCase().includes(lowerName),
          );
  }

  return {
    installedEntries,
    matched: candidates.length === 1 ? candidates[0] : undefined,
    ambiguousMatches: candidates.length > 1 ? candidates : [],
  };
}

/** 同名スキルが別ルートにもありうるので、対象はルートと entryId 付きで示す。 */
function describeInstalledSkill(entry: InstalledEntry): string {
  return `${entry.meta.name} (${entry.plan.rootLabel}) entryId=${entry.plan.entryId}`;
}

interface SkillUninstallInput {
  skillName?: string;
  /** listSkills が返す Entry ID。指定すると対象を 1 件に確定する */
  entryId?: string;
  rootId?: string;
}

/**
 * スキルアンインストールツール
 */
class SkillUninstallTool implements vscode.LanguageModelTool<SkillUninstallInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<SkillUninstallInput>,
  ): Promise<vscode.PreparedToolInvocation> {
    const resolved = await resolveInstalledSkillToUninstall(options.input);
    return {
      invocationMessage: localizeMcpText(
        "Uninstalling skill",
        "スキルをアンインストール中",
      ),
      confirmationMessages: buildConfirmation(
        localizeMcpText("Uninstall skill", "スキルをアンインストール"),
        localizeMcpText(
          "This moves the installed skill folder to the trash.",
          "インストール済みのスキルフォルダをごみ箱へ移動します。",
        ),
        resolved?.matched
          ? describeInstalledSkill(resolved.matched)
          : (options.input.entryId ?? options.input.skillName ?? ""),
      ),
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<SkillUninstallInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const skillName = options.input.skillName ?? options.input.entryId ?? "";

    if (!options.input.skillName && !options.input.entryId) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ ${localizeMcpText(
            "Specify skillName or entryId (see #listSkills). Nothing was uninstalled.",
            "skillName または entryId（#listSkills 参照）を指定してください。何もアンインストールしていません。",
          )}`,
        ),
      ]);
    }

    const resolved = await resolveInstalledSkillToUninstall(options.input);
    if (!resolved) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(messages.chatNoWorkspaceFolderOpen()),
      ]);
    }

    const {
      installedEntries,
      matched: matchedSkill,
      ambiguousMatches,
    } = resolved;

    if (ambiguousMatches.length > 0) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ ${localizeMcpText(
            `"${skillName}" matches several installed skills, so nothing was uninstalled.`,
            `"${skillName}" は複数のインストール済みスキルに一致するため、何もアンインストールしていません。`,
          )}

${localizeMcpText("Candidates", "候補")}:
${ambiguousMatches.map((entry) => `- ${describeInstalledSkill(entry)}`).join("\n")}

---
**Agent Instructions:**
- Ask the user which skill to uninstall, then call this tool again with that exact \`entryId\` (a name alone cannot tell the same skill in different roots apart)`,
        ),
      ]);
    }

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
        matchedSkill.workspaceUri,
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

      const uninstallTable = renderMarkdownTable(
        ["項目", "内容"],
        [
          ["スキル名", matchedSkill.meta.name],
          ["削除元ルート", matchedSkill.plan.rootLabel],
          ["Entry ID", matchedSkill.plan.entryId],
          ["ステータス", "ごみ箱へ移動"],
          [
            "Instruction",
            matchedSkill.root.instructionPath ? "更新済み" : "対象外（このルートは instruction を更新しません）",
          ],
        ],
      );

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `✅ **${matchedSkill.meta.name}** をアンインストールしました！

${uninstallTable}

---
**Agent Instructions:**
- Report success
- Remind user that the skill folder was moved to the trash and can be restored

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

function reasonText(reason: ReinstallReason | undefined): string {
  switch (reason) {
    case "read-only-root":
      return localizeMcpText("read-only root", "読み取り専用ルート");
    case "reinstall-disabled":
      return localizeMcpText(
        "reinstall disabled in its metadata",
        "メタデータで再インストールが無効",
      );
    case "no-provenance":
      return localizeMcpText(
        "source unknown (no metadata): choose a candidate",
        "出所不明（メタデータなし）: 候補を選択してください",
      );
    case "no-candidate":
      return localizeMcpText("no matching candidate", "一致する候補なし");
    case "candidate-not-found":
      return localizeMcpText(
        "requested candidate is not eligible",
        "指定した候補は対象外です",
      );
    case "source-missing":
      return localizeMcpText(
        "recorded source/path is not in the source index",
        "記録済みの source / パスがインデックスにありません",
      );
    case "source-removed":
      return localizeMcpText(
        "the source path no longer exists (removed or renamed)",
        "配布元のパスが存在しません（削除または名前変更）",
      );
    case "source-switch":
      return localizeMcpText(
        "would switch to a different source: needs approval",
        "別の source への切り替え: 承認が必要",
      );
    case "local-edits":
      return localizeMcpText(
        "local content differs from the source: needs approval",
        "ローカルの内容が取得元と異なります: 承認が必要",
      );
    case "fetch-failed":
      return localizeMcpText("could not verify", "確認に失敗");
    case "not-found":
      return localizeMcpText("target not found", "対象が見つかりません");
    case "app-managed":
      return localizeMcpText(
        "synced by an app (Claude / ChatGPT); it would be regenerated, so it is not reinstalled",
        "アプリ（Claude / ChatGPT）の同期フォルダのため、再生成されるので再インストールしません",
      );
    case "up-to-date":
      return localizeMcpText(
        "already at the recorded revision with identical content: nothing to do (pass force: true to rewrite anyway)",
        "記録済みの revision と同じ内容です: 変更不要（書き換える場合は force: true）",
      );
    default:
      return "";
  }
}

function diffText(diff: ContentDiff | undefined): string {
  if (!diff) {
    return "-";
  }
  if (diff.identical) {
    return localizeMcpText("identical to the source", "取得元と一致");
  }
  const names = [...diff.changed, ...diff.added, ...diff.removed].slice(0, 5);
  const summary = `${diff.changed.length} changed / ${diff.added.length} local-only / ${diff.removed.length} missing`;
  // ファイル単位の根拠（サイズ・ハッシュ・バイナリ）があれば、ファイル名だけではなくそれを示す
  if (diff.details && diff.details.length > 0) {
    return `${summary} [${describeContentDiffDetails(diff)}]`;
  }
  return `${summary} (${names.join(", ")}${
    diff.changed.length + diff.added.length + diff.removed.length > 5
      ? ", ..."
      : ""
  })`;
}

function shortSha(value: string | undefined): string {
  return value ? value.slice(0, 7) : "-";
}

/** 保留の解消に必要な引数をそのまま示す。 */
function nextStepText(item: PlanItem): string {
  switch (item.reason) {
    case "local-edits":
      return `allowLocalEdits: ["${item.entryId}"]`;
    case "source-switch":
      return `adopt: {entryId: "${item.entryId}", candidateId: "${item.candidate?.candidateId}"} + allowSourceSwitch: ["${item.entryId}"]`;
    case "no-provenance":
      return `adopt: {entryId: "${item.entryId}", candidateId: <one of the candidates below>}`;
    default:
      return "";
  }
}

function renderReinstallPlan(
  context: PlanContext,
  input: ReinstallInput,
): string {
  const items = context.plan.items;
  const quiet = (item: PlanItem) =>
    item.reason === "no-candidate" ||
    item.reason === "reinstall-disabled" ||
    item.reason === "app-managed";
  const shown = items.filter((item) => !quiet(item));
  const quietNames = items.filter(quiet).map((item) => item.name);

  const count = (status: PlanItem["status"]) =>
    items.filter((item) => item.status === status).length;

  const table = renderMarkdownTable(
    [
      "#",
      "Skill",
      "Root",
      "Provenance",
      "Status",
      "Action",
      "Source (recorded → target)",
      "Revision (recorded → target)",
      "Detail",
    ],
    shown.map((item, position) => [
      String(position + 1),
      item.name,
      item.rootLabel,
      item.provenance,
      item.status,
      item.action ?? "-",
      `${item.recordedSource ?? "-"} → ${item.candidate?.source ?? "-"}`,
      `${shortSha(item.recordedCommitSha)} → ${shortSha(item.target?.commitSha)}`,
      [reasonText(item.reason), item.detail, item.diff && !item.diff.identical ? diffText(item.diff) : ""]
        .filter(Boolean)
        .join(" / "),
    ]),
  );

  const holdSteps = shown
    .map((item) => ({ item, step: nextStepText(item) }))
    .filter(({ step }) => step);
  const candidateSections = shown
    .filter((item) => item.candidates && item.candidates.length > 0)
    .map(
      (item) =>
        `**${item.name}** (${item.entryId})\n\n${renderMarkdownTable(
          ["Candidate ID", "Source", "Evidence"],
          (item.candidates ?? []).map((evidence) => [
            evidence.candidate.candidateId,
            evidence.candidate.source,
            evidence.error
              ? `${localizeMcpText("could not compare", "比較できません")}: ${evidence.error}`
              : `${shortSha(evidence.commitSha)}: ${diffText(evidence.diff)}`,
          ]),
        )}`,
    );

  const instructionRoots = new Map<string, string>();
  for (const item of items) {
    if (item.status !== "ready") {
      continue;
    }
    const installed = context.entries.get(item.entryId);
    instructionRoots.set(
      item.rootLabel,
      installed?.root.instructionPath ?? "none",
    );
  }
  const instructionAuto = vscode.workspace
    .getConfiguration("skillNinja")
    .get<boolean>("autoUpdateInstruction");
  const instructionText =
    instructionRoots.size === 0
      ? "-"
      : [...instructionRoots]
          .map(
            ([root, file]) =>
              `${root}: ${
                file === "none"
                  ? localizeMcpText("no instruction update", "instruction 更新なし")
                  : instructionAuto
                    ? `${localizeMcpText("updates", "更新")} ${file}`
                    : `${localizeMcpText("not updated (autoUpdateInstruction is off)", "更新しない（autoUpdateInstruction が無効）")}`
              }`,
          )
          .join("; ");

  const applyCall = JSON.stringify(
    {
      mode: "apply",
      planId: context.plan.planId,
      targets: input.targets,
      ...(input.adopt?.length ? { adopt: input.adopt } : {}),
      ...(input.allowLocalEdits?.length
        ? { allowLocalEdits: input.allowLocalEdits }
        : {}),
      ...(input.allowSourceSwitch?.length
        ? { allowSourceSwitch: input.allowSourceSwitch }
        : {}),
      ...(input.force ? { force: true } : {}),
    },
    null,
    2,
  );

  return `🔄 Reinstall plan \`${context.plan.planId}\`: ${count("ready")} ready / ${count("hold")} on hold / ${count("skipped")} skipped

${table}
${quietNames.length > 0 ? `\n${localizeMcpText("Not eligible / no candidate", "対象外 / 候補なし")} (${quietNames.length}): ${quietNames.join(", ")}\n` : ""}${
    holdSteps.length > 0
      ? `\n**${localizeMcpText("To release a hold, pass", "保留を解除するには次を指定")}:**\n${holdSteps
          .map(({ item, step }) => `- ${item.name} (${item.entryId}): ${step}`)
          .join("\n")}\n`
      : ""
  }${candidateSections.length > 0 ? `\n${candidateSections.join("\n\n")}\n` : ""}
**Instruction / catalog updates:** ${instructionText}

---
**Agent Instructions:**
- This was a preview. Nothing was changed.
- Show the table, the holds and their evidence to the user. Never choose a candidate, \`allowLocalEdits\`, or \`allowSourceSwitch\` on the user's behalf.
- To run only the ready items, call this tool again with the same targets/flags and this exact planId:

\`\`\`json
${applyCall}
\`\`\``;
}

function renderApplyResults(
  results: ApplyResult[],
  planId: string,
  instructionNotes: string[],
): string {
  const count = (status: ApplyResult["status"]) =>
    results.filter((result) => result.status === status).length;
  const table = renderMarkdownTable(
    [
      "#",
      "Skill",
      "Result",
      "Installed at",
      "Source",
      "Recorded revision",
      "Verification",
      "Detail",
    ],
    results.map((result, position) => [
      String(position + 1),
      result.name,
      result.status,
      result.installedPath ?? result.rootLabel,
      result.source ?? "-",
      result.recorded
        ? `${shortSha(result.recorded.commitSha)} (${result.recorded.ref}) tree ${shortSha(result.recorded.contentSha)}`
        : "-",
      result.verification
        ? Object.entries(result.verification)
            .map(([key, ok]) => `${key}=${ok ? "ok" : "FAILED"}`)
            .join(", ")
        : "-",
      [reasonText(result.reason), result.message].filter(Boolean).join(" / "),
    ]),
  );

  return `🔄 Reinstall result for plan \`${planId}\`: ${count("updated")} updated / ${count("failed")} failed / ${count("held")} on hold / ${count("skipped")} skipped

${table}

**Instruction / catalog updates:** ${instructionNotes.length > 0 ? instructionNotes.join("; ") : "-"}

---
**Agent Instructions:**
- Report each row's result, installed path and recorded revision from the table. Do not summarize "all succeeded" unless every row says updated.
- A "failed" row with a verification FAILED check must not be described as up to date.
- Held rows were not changed; explain what the user must approve for them.`;
}

/**
 * 既存スキルの再インストールツール。
 * プレビュー（読み取りのみ）と実行を分け、実行は planId で固定した計画だけを行う。
 */
class SkillReinstallTool implements vscode.LanguageModelTool<ReinstallInput> {
  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ReinstallInput>,
  ): vscode.PreparedToolInvocation {
    if (options.input.mode !== "apply") {
      return {
        invocationMessage: localizeMcpText(
          "Previewing skill reinstall",
          "スキルの再インストールをプレビュー中",
        ),
      };
    }

    return {
      invocationMessage: localizeMcpText(
        "Reinstalling skills",
        "スキルを再インストール中",
      ),
      confirmationMessages: buildConfirmation(
        localizeMcpText("Reinstall skills", "スキルを再インストール"),
        localizeMcpText(
          "This replaces the listed installed skill folders with the source content and rewrites their .skill-meta.json. Only the items that were ready in the previewed plan are changed.",
          "プレビューした計画の ready 項目だけについて、インストール済みスキルフォルダを取得元の内容で置き換え、.skill-meta.json を更新します。",
        ),
        JSON.stringify({
          planId: options.input.planId,
          targets: options.input.targets,
          adopt: options.input.adopt,
          allowLocalEdits: options.input.allowLocalEdits,
          allowSourceSwitch: options.input.allowSourceSwitch,
          force: options.input.force,
        }),
      ),
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ReinstallInput>,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const input = options.input;
    const text = (value: string) =>
      new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(value),
      ]);

    if (input.mode !== "preview" && input.mode !== "apply") {
      return text(
        `❌ ${localizeMcpText(
          'mode must be "preview" or "apply". Nothing was changed.',
          'mode は "preview" か "apply" を指定してください。何も変更していません。',
        )}`,
      );
    }

    const abort = new AbortController();
    const subscription = token.onCancellationRequested(() => abort.abort());

    try {
      const created = await createReinstallPlan(input, {
        workspaceUri: vscode.workspace.workspaceFolders?.[0]?.uri,
        index: await getSkillIndex(),
        japanese: isJapanese(),
        signal: abort.signal,
      });

      if ("error" in created) {
        return text(
          `❌ ${created.error}\n\n${localizeMcpText(
            "Nothing was changed. Use #listSkills to get entryId / rootId values.",
            "何も変更していません。#listSkills で entryId / rootId を確認してください。",
          )}`,
        );
      }

      if (input.mode === "preview") {
        return text(renderReinstallPlan(created, input));
      }

      if (!input.planId) {
        return text(
          `❌ ${localizeMcpText(
            'apply requires the planId returned by a preview ("mode": "preview"). Nothing was changed.',
            "apply にはプレビューが返した planId が必要です。何も変更していません。",
          )}`,
        );
      }

      if (input.planId !== created.plan.planId) {
        return text(
          `❌ ${localizeMcpText(
            `The state changed since the preview (planId ${input.planId} ≠ ${created.plan.planId}). Nothing was changed. Review the new plan and run apply again with its planId.`,
            `プレビュー後に状態が変わりました（planId ${input.planId} ≠ ${created.plan.planId}）。何も変更していません。新しい計画を確認し、その planId で再実行してください。`,
          )}\n\n${renderReinstallPlan(created, { ...input, mode: "preview" })}`,
        );
      }

      if (!created.plan.items.some((item) => item.status === "ready")) {
        return text(
          `ℹ️ ${localizeMcpText(
            "No item is ready, so nothing was changed.",
            "実行できる項目がないため、何も変更していません。",
          )}\n\n${renderReinstallPlan(created, { ...input, mode: "preview" })}`,
        );
      }

      const results = await applyReinstallPlan(
        created,
        requireExtContext(),
        abort.signal,
      );

      const instructionNotes: string[] = [];
      const touched = new Map<string, InstalledEntry>();
      for (const result of results) {
        const installed = created.entries.get(result.entryId);
        if (result.status === "updated" && installed) {
          touched.set(installed.root.rootPath, installed);
        }
      }
      const autoUpdate = vscode.workspace
        .getConfiguration("skillNinja")
        .get<boolean>("autoUpdateInstruction");
      for (const { root, plan } of touched.values()) {
        if (!root.instructionPath) {
          instructionNotes.push(
            `${plan.rootLabel}: ${localizeMcpText("no instruction update", "instruction 更新なし")}`,
          );
        } else if (autoUpdate) {
          await updateInstructionFileForRoot(root, requireExtContext());
          instructionNotes.push(
            `${plan.rootLabel}: ${localizeMcpText("updated", "更新済み")} ${root.instructionPath}`,
          );
        } else {
          instructionNotes.push(
            `${plan.rootLabel}: ${localizeMcpText("not updated (autoUpdateInstruction is off)", "更新しない（autoUpdateInstruction が無効）")}`,
          );
        }
      }
      await vscode.commands.executeCommand("skillNinja.refresh");

      return text(
        renderApplyResults(results, created.plan.planId, instructionNotes),
      );
    } catch (error) {
      return text(
        formatMcpError(
          "Failed to reinstall skills",
          "スキルの再インストールに失敗しました",
          error,
        ),
      );
    } finally {
      subscription.dispose();
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
      const oldCount = getIndexSkills(oldIndex).length;
      const oldUpdated = oldIndex.lastUpdated || "unknown";

      // VS Code コマンドでインデックス更新を実行
      await vscode.commands.executeCommand("skillNinja.updateIndex");

      const newIndex = await loadSkillIndex(extContext);

      const newCount = getIndexSkills(newIndex).length;
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
  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<{
      repoUrl: string;
    }>,
  ): vscode.PreparedToolInvocation {
    return {
      invocationMessage: localizeMcpText(
        "Adding skill source",
        "スキルソースを追加中",
      ),
      confirmationMessages: buildConfirmation(
        localizeMcpText("Add skill source", "スキルソースを追加"),
        localizeMcpText(
          "This adds a repository to the skill index and fetches its skills.",
          "リポジトリをスキルインデックスへ追加し、スキルを取得します。",
        ),
        options.input.repoUrl,
      ),
    };
  }

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
  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<RemoveSourceInput>,
  ): vscode.PreparedToolInvocation {
    const input = options.input || {};
    return {
      invocationMessage: localizeMcpText(
        "Removing skill source",
        "スキルソースを削除中",
      ),
      confirmationMessages: buildConfirmation(
        localizeMcpText("Remove skill source", "スキルソースを削除"),
        localizeMcpText(
          "This removes the repository and all of its skills from the index.",
          "リポジトリとそのスキルをすべてインデックスから削除します。",
        ),
        input.sourceId || input.sourceName || input.repoUrl || "",
      ),
    };
  }

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
  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<LocalizeInput>,
  ): vscode.PreparedToolInvocation {
    return {
      invocationMessage: localizeMcpText(
        "Updating skill descriptions",
        "スキル説明を更新中",
      ),
      confirmationMessages: buildConfirmation(
        localizeMcpText("Update skill description", "スキル説明を更新"),
        localizeMcpText(
          "This overwrites the stored description for the skill in the index.",
          "インデックスに保存されているスキルの説明を上書きします。",
        ),
        options.input.skillName || "",
      ),
    };
  }

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
      const skill = getIndexSkills(index).find(
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
