// スキルプレビュー機能
// Webview で SKILL.md の内容を表示

import * as vscode from "vscode";
import { Skill } from "./skillIndex";
import messages from "./i18n";

let previewPanel: vscode.WebviewPanel | undefined;

/**
 * SKILL.md の内容を取得
 */
async function fetchSkillContent(
  skill: Skill,
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
    // source と path から URL を構築
    rawUrl = `https://raw.githubusercontent.com/${skill.source}/HEAD/${skill.path}/SKILL.md`;
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
  isFavorite: boolean
): string {
  const htmlContent = markdownToHtml(content);
  const starIcon = isFavorite ? "★" : "☆";
  const starClass = isFavorite ? "favorite" : "";

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
  </style>
</head>
<body>
  <div class="header">
    <h1 class="title">${skill.name}</h1>
    <div class="actions">
      <button class="btn-star ${starClass}" onclick="toggleFavorite()">
        ${starIcon}
      </button>
      <button class="btn-primary" onclick="install()">
        Install
      </button>
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
  }${skill.isOrg ? " | 🏢 Organization" : ""}
  </div>
  <div class="content">
    ${htmlContent}
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    
    function install() {
      vscode.postMessage({ command: 'install' });
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
 * スキルの GitHub URL を取得
 */
export function getSkillGitHubUrl(skill: Skill): string {
  if (skill.url) {
    return skill.url;
  }
  return `https://github.com/${skill.source}/tree/HEAD/${skill.path}`;
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

    const content = await fetchSkillContent(skill, token);
    previewPanel.webview.html = getWebviewContent(skill, content, isFavorite);

    // メッセージハンドラー
    previewPanel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "install":
            await vscode.commands.executeCommand("skillNinja.install", skill);
            break;
          case "openGitHub":
            await vscode.env.openExternal(
              vscode.Uri.parse(getSkillGitHubUrl(skill))
            );
            break;
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
              newIsFavorite
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
