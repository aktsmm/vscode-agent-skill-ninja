// スキルプレビュー機能
// Webview で SKILL.md の内容を表示

import * as vscode from "vscode";
import {
  loadSkillIndex,
  getSkillGitHubUrl,
  getSourceBranch,
  Skill,
  Source,
} from "./skillIndex";
import messages from "./i18n";

let previewPanel: vscode.WebviewPanel | undefined;

/**
 * SKILL.md の内容を取得
 */
async function fetchSkillContent(
  skill: Skill,
  sources: Source[],
  token?: string
): Promise<string> {
  // GitHub raw URL を構築
  let rawUrl: string;

  if (skill.rawUrl) {
    rawUrl = skill.rawUrl;
  } else if (skill.url) {
    rawUrl = skill.url
      .replace("github.com", "raw.githubusercontent.com")
      .replace("/blob/", "/");
  } else {
    // source ID からソース情報を取得
    const sourceInfo = sources.find((s) => s.id === skill.source);
    if (sourceInfo) {
      // ソース URL から owner/repo を抽出
      const match = sourceInfo.url.match(/github\.com\/([^/]+\/[^/]+)/);
      if (match) {
        const ownerRepo = match[1];
        // HEAD リクエストまたは API でデフォルトブランチを動的取得
        const branch = await getSourceBranch(sourceInfo, token, skill.path);
        // パスが .md で終わる場合はそのまま使用、そうでなければ /SKILL.md を追加
        if (skill.path.endsWith(".md")) {
          rawUrl = `https://raw.githubusercontent.com/${ownerRepo}/${branch}/${skill.path}`;
        } else {
          rawUrl = `https://raw.githubusercontent.com/${ownerRepo}/${branch}/${skill.path}/SKILL.md`;
        }
      } else {
        throw new Error(`Invalid source URL: ${sourceInfo.url}`);
      }
    } else {
      throw new Error(`Source not found: ${skill.source}`);
    }
  }

  const headers: Record<string, string> = {
    Accept: "text/plain",
    "User-Agent": "VSCode-SkillNinja",
  };

  if (token) {
    headers["Authorization"] = `token ${token}`;
  }

  const response = await fetch(rawUrl, { headers });

  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status}`);
  }

  return await response.text();
}

/**
 * Markdown を HTML に変換（シンプルな実装）
 */
function markdownToHtml(markdown: string): string {
  let html = markdown
    // コードブロック
    .replace(
      /```(\w*)\n([\s\S]*?)```/g,
      '<pre><code class="language-$1">$2</code></pre>'
    )
    // インラインコード
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // 見出し
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // 太字
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // 斜体
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    // リンク
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // リスト
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/^(\d+)\. (.+)$/gm, "<li>$2</li>")
    // 段落
    .replace(/\n\n/g, "</p><p>")
    // 改行
    .replace(/\n/g, "<br>");

  return `<p>${html}</p>`;
}

/**
 * Webview の HTML を生成
 */
function getWebviewContent(
  skill: Skill,
  content: string,
  isFavorite: boolean,
  isInIndex: boolean = true
): string {
  const htmlContent = markdownToHtml(content);
  const starIcon = isFavorite ? "★" : "☆";
  const starClass = isFavorite ? "favorite" : "";

  // インデックスにないスキル（検索結果から）の場合は Add Source ボタンを表示
  const addSourceButton = isInIndex
    ? ""
    : `<button class="btn-secondary" onclick="addSource()">Add Source</button>`;

  // インデックスにないスキルはお気に入り機能が使えないので非表示
  const favoriteButton = isInIndex
    ? `<button class="btn-star ${starClass}" onclick="toggleFavorite()">
        ${starIcon}
      </button>`
    : "";

  // standalone: false の場合は警告を表示
  const standaloneWarning =
    skill.standalone === false
      ? `<div class="warning">
          <strong>⚠️ Warning:</strong> This skill requires other skills to work properly.
          ${
            skill.requires?.length
              ? `<br><strong>Requires:</strong> ${skill.requires.join(", ")}`
              : ""
          }
          ${
            skill.bundle
              ? `<br><strong>Bundle:</strong> ${skill.bundle} (Install full bundle recommended)`
              : ""
          }
        </div>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${skill.name}</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      line-height: 1.6;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .title {
      margin: 0;
      color: var(--vscode-textLink-foreground);
    }
    .actions {
      display: flex;
      gap: 10px;
    }
    button {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .btn-primary {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-primary:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
    .btn-secondary {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }
    .btn-star {
      background-color: transparent;
      border: 1px solid var(--vscode-button-border, #555);
      color: var(--vscode-foreground);
      font-size: 18px;
    }
    .btn-star.favorite {
      color: gold;
    }
    .meta {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 20px;
    }
    .content {
      max-width: 800px;
    }
    h1, h2, h3 {
      color: var(--vscode-textLink-foreground);
    }
    code {
      background-color: var(--vscode-textCodeBlock-background);
      padding: 2px 6px;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family);
    }
    pre {
      background-color: var(--vscode-textCodeBlock-background);
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
    }
    pre code {
      padding: 0;
      background: none;
    }
    a {
      color: var(--vscode-textLink-foreground);
    }
    li {
      margin: 5px 0;
    }
    .warning {
      background-color: var(--vscode-inputValidation-warningBackground);
      border: 1px solid var(--vscode-inputValidation-warningBorder);
      color: var(--vscode-inputValidation-warningForeground);
      padding: 12px 16px;
      border-radius: 6px;
      margin-bottom: 20px;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1 class="title">${skill.name}</h1>
    <div class="actions">
      ${favoriteButton}
      <button class="btn-primary" onclick="install()">
        Install
      </button>
      ${addSourceButton}
      <button class="btn-primary" onclick="openGitHub()">
        GitHub
      </button>
    </div>
  </div>
  <div class="meta">
    <strong>Source:</strong> ${skill.source} | 
    <strong>Categories:</strong> ${skill.categories.join(", ") || "None"}${
    skill.stars
      ? ` | <strong>Stars:</strong> ⭐ ${skill.stars.toLocaleString()}`
      : ""
  }${skill.isOrg ? " | 🏢 Organization" : ""}${
    skill.bundle ? ` | <strong>Bundle:</strong> ${skill.bundle}` : ""
  }
  </div>
  ${standaloneWarning}
  <div class="content">
    ${htmlContent}
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    
    function install() {
      vscode.postMessage({ command: 'install' });
    }
    
    function addSource() {
      vscode.postMessage({ command: 'addSource' });
    }
    
    function openGitHub() {
      vscode.postMessage({ command: 'openGitHub' });
    }
    
    function toggleFavorite() {
      vscode.postMessage({ command: 'toggleFavorite' });
    }
  </script>
</body>
</html>`;
}

/**
 * スキルの一意識別子を取得（お気に入り用）
 */
export function getSkillId(skill: Skill): string {
  return skill.url || `${skill.source}/${skill.path}`;
}

/**
 * スキルプレビューを表示
 */
export async function showSkillPreview(
  skill: Skill,
  context: vscode.ExtensionContext
): Promise<void> {
  const config = vscode.workspace.getConfiguration("skillNinja");
  const token = config.get<string>("githubToken");

  // スキルインデックスからソース情報を取得
  const skillIndex = await loadSkillIndex(context);
  const sources = skillIndex.sources;

  // スキルがインデックスに登録されているか確認
  const isInIndex =
    skillIndex.skills.some(
      (s: Skill) => s.name === skill.name && s.source === skill.source
    ) || sources.some((s: Source) => s.id === skill.source);

  // お気に入り状態を取得
  const favorites = context.globalState.get<string[]>("favorites", []);
  const skillId = getSkillId(skill);
  const isFavorite = favorites.includes(skillId);

  try {
    // 既存のパネルがあれば再利用
    if (previewPanel) {
      previewPanel.reveal();
    } else {
      previewPanel = vscode.window.createWebviewPanel(
        "skillPreview",
        `${messages.previewTitle()}: ${skill.name}`,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );

      previewPanel.onDidDispose(() => {
        previewPanel = undefined;
      });
    }

    // コンテンツを読み込み
    previewPanel.title = `${messages.previewTitle()}: ${skill.name}`;
    previewPanel.webview.html = `<p>Loading...</p>`;

    const content = await fetchSkillContent(skill, sources, token);
    previewPanel.webview.html = getWebviewContent(
      skill,
      content,
      isFavorite,
      isInIndex
    );

    // メッセージハンドラー
    previewPanel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "install": {
            // インデックスにない場合は先にソースを追加
            if (!isInIndex) {
              const repoUrl = `https://github.com/${skill.source}`;
              await vscode.commands.executeCommand(
                "skillNinja.addSource",
                repoUrl
              );
              // ソース追加後、インデックスを再読み込みしてスキルを検索
              const updatedIndex = await loadSkillIndex(context);
              const installedSkill = updatedIndex.skills.find(
                (s: Skill) => s.name === skill.name
              );
              if (installedSkill) {
                await vscode.commands.executeCommand(
                  "skillNinja.install",
                  installedSkill
                );
              } else {
                vscode.window.showWarningMessage(
                  `Skill "${skill.name}" not found after adding source. Please try installing manually.`
                );
              }
            } else {
              await vscode.commands.executeCommand("skillNinja.install", skill);
            }
            break;
          }
          case "addSource": {
            // ソースのみ追加
            const repoUrl = `https://github.com/${skill.source}`;
            await vscode.commands.executeCommand(
              "skillNinja.addSource",
              repoUrl
            );
            break;
          }
          case "openGitHub": {
            let url = getSkillGitHubUrl(skill, sources);
            // フォールバック: skill.url または source/path から直接構築
            if (!url) {
              if (skill.url) {
                // blob URL を tree URL に変換
                url = skill.url.replace("/blob/", "/tree/");
              } else if (skill.source && skill.path) {
                // source が owner/repo 形式の場合
                const branch = "main";
                url = `https://github.com/${skill.source}/tree/${branch}/${skill.path}`;
              }
            }
            if (url) {
              await vscode.env.openExternal(vscode.Uri.parse(url));
            } else {
              vscode.window.showWarningMessage(
                `GitHub URL could not be determined for ${skill.name}`
              );
            }
            break;
          }
          case "toggleFavorite": {
            await vscode.commands.executeCommand(
              "skillNinja.toggleFavorite",
              skill
            );
            // パネルを更新
            const newFavorites = context.globalState.get<string[]>(
              "favorites",
              []
            );
            const newIsFavorite = newFavorites.includes(getSkillId(skill));
            previewPanel!.webview.html = getWebviewContent(
              skill,
              content,
              newIsFavorite,
              isInIndex
            );
            break;
          }
        }
      },
      undefined,
      context.subscriptions
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Preview failed: ${error}`);
  }
}
