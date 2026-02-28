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
import messages, { isJapanese } from "./i18n";
import { getGitHubToken } from "./githubAuth";

let previewPanel: vscode.WebviewPanel | undefined;
let previewMessageListener: vscode.Disposable | undefined;
let previewRequestCounter = 0;

function getNonce(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return result;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeHref(href: string): string {
  const trimmed = href.trim();
  if (!trimmed) return "#";
  if (trimmed.startsWith("#")) return trimmed;
  if (trimmed.startsWith("//")) return "#";

  try {
    const url = new URL(trimmed);
    if (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "mailto:"
    ) {
      return url.toString();
    }
  } catch {
    // Relative URL: allow only safe-ish relative links
    if (
      (trimmed.startsWith("/") && !trimmed.startsWith("//")) ||
      trimmed.startsWith("./") ||
      trimmed.startsWith("../")
    ) {
      return trimmed;
    }
  }
  return "#";
}

function normalizeListMarkup(html: string): string {
  const lines = html.split("\n");
  const normalized: string[] = [];
  let listItems: string[] = [];
  let currentListType: "ul" | "ol" | undefined;

  const flushList = (): void => {
    if (listItems.length === 0) {
      return;
    }
    const listTag = currentListType || "ul";
    normalized.push(`<${listTag}>${listItems.join("")}</${listTag}>`);
    listItems = [];
    currentListType = undefined;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^<li(?:\s+data-list="(ul|ol)")?>.*<\/li>$/);
    if (match) {
      const listType = (match[1] as "ul" | "ol" | undefined) || "ul";

      if (currentListType && currentListType !== listType) {
        flushList();
      }

      currentListType = listType;
      listItems.push(trimmed.replace(/\s+data-list="(?:ul|ol)"/, ""));
      continue;
    }
    flushList();
    normalized.push(line);
  }

  flushList();
  return normalized.join("\n");
}

function formatHtmlBlocks(html: string): string {
  const blockPattern =
    /(<pre>[\s\S]*?<\/pre>|<ul>[\s\S]*?<\/ul>|<ol>[\s\S]*?<\/ol>|<h[1-3]>[\s\S]*?<\/h[1-3]>)/g;
  const segments = html
    .split(blockPattern)
    .filter((segment) => segment.length > 0);

  return segments
    .map((segment) => {
      const trimmed = segment.trim();
      if (!trimmed) {
        return "";
      }

      if (/^<(?:pre|ul|ol|h[1-3])/.test(trimmed)) {
        return trimmed;
      }

      return trimmed
        .split(/\n{2,}/)
        .filter((paragraph) => paragraph.trim().length > 0)
        .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
        .join("\n");
    })
    .filter((segment) => segment.length > 0)
    .join("\n");
}

function normalizeOwnerRepo(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.git$/, "");
}

function extractOwnerRepoFromSourceUrl(url: string): string | undefined {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)/i);
  if (!match) {
    return undefined;
  }
  return normalizeOwnerRepo(match[1]);
}

function resolveSourceIdFromSourceValue(
  sourceValue: string,
  sources: Source[],
): string | undefined {
  const directSource = sources.find((source) => source.id === sourceValue);
  if (directSource) {
    return directSource.id;
  }

  if (!sourceValue.includes("/")) {
    return undefined;
  }

  const ownerRepo = normalizeOwnerRepo(sourceValue);
  const matchedSource = sources.find((source) => {
    const sourceOwnerRepo = extractOwnerRepoFromSourceUrl(source.url);
    return sourceOwnerRepo === ownerRepo;
  });

  return matchedSource?.id;
}

function findIndexedSkill(
  skill: Skill,
  indexedSkills: Skill[],
  sources: Source[],
): Skill | undefined {
  const candidateSourceIds = new Set<string>([skill.source]);
  const resolvedSourceId = resolveSourceIdFromSourceValue(
    skill.source,
    sources,
  );
  if (resolvedSourceId) {
    candidateSourceIds.add(resolvedSourceId);
  }

  const sourceScopedSkills = indexedSkills.filter((indexedSkill) =>
    candidateSourceIds.has(indexedSkill.source),
  );

  const matchedByPath = sourceScopedSkills.find(
    (indexedSkill) =>
      indexedSkill.name === skill.name && indexedSkill.path === skill.path,
  );
  if (matchedByPath) {
    return matchedByPath;
  }

  const nameMatches = sourceScopedSkills.filter(
    (indexedSkill) => indexedSkill.name === skill.name,
  );
  if (nameMatches.length === 1) {
    return nameMatches[0];
  }

  return undefined;
}

/**
 * SKILL.md の内容を取得
 */
async function fetchSkillContent(
  skill: Skill,
  sources: Source[],
  token?: string,
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
export function markdownToHtml(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n");

  const placeholders = new Map<string, string>();
  let placeholderId = 0;
  const makePlaceholder = (html: string): string => {
    const key = `@@SKILL_NINJA_PH_${placeholderId++}@@`;
    placeholders.set(key, html);
    return key;
  };

  // Code fences first
  let text = normalized.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, lang: string, code: string) => {
      const safeLang = escapeHtml(lang);
      const safeCode = escapeHtml(code);
      return makePlaceholder(
        `<pre><code class="language-${safeLang}">${safeCode}</code></pre>`,
      );
    },
  );

  // Inline code
  text = text.replace(/`([^`]+)`/g, (_match, code: string) => {
    return makePlaceholder(`<code>${escapeHtml(code)}</code>`);
  });

  // Links
  text = text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, label: string, href: string) => {
      const safeLabel = escapeHtml(label);
      const safeHref = escapeHtml(sanitizeHref(href));
      return makePlaceholder(
        `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`,
      );
    },
  );

  // Escape everything else (prevents raw HTML injection)
  let html = escapeHtml(text);

  // Headings
  html = html
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Bold / italic
  html = html
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Lists
  html = html
    .replace(/^- (.+)$/gm, '<li data-list="ul">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li data-list="ol">$2</li>');

  html = normalizeListMarkup(html);

  // Restore placeholders
  for (const [key, value] of placeholders.entries()) {
    html = html.replaceAll(key, value);
  }

  return formatHtmlBlocks(html);
}

/**
 * Webview の HTML を生成
 */
function getWebviewContent(
  skill: Skill,
  content: string,
  isFavorite: boolean,
  nonce: string,
  isInIndex: boolean = true,
): string {
  const htmlContent = markdownToHtml(content);
  const htmlLang = isJapanese() ? "ja" : "en";
  const safeSkillName = escapeHtml(skill.name);
  const safeSource = escapeHtml(skill.source);
  const safeCategories = skill.categories
    .map((category) => escapeHtml(category))
    .join(", ");
  const safeRequires = skill.requires
    ?.map((requiredSkill) => escapeHtml(requiredSkill))
    .join(", ");
  const safeBundle = skill.bundle ? escapeHtml(skill.bundle) : "";
  const starIcon = isFavorite ? "★" : "☆";
  const starClass = isFavorite ? "favorite" : "";

  // インデックスにないスキル（検索結果から）の場合は Add Source ボタンを表示
  const addSourceButton = isInIndex
    ? ""
    : `<button class="btn-secondary" onclick="addSource()">${messages.addSourceButtonLabel()}</button>`;

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
          <strong>${messages.standaloneWarningTitle()}</strong> ${messages.standaloneWarningBody()}
          ${
            safeRequires
              ? `<br><strong>${messages.requiresLabel()}</strong> ${safeRequires}`
              : ""
          }
          ${
            safeBundle
              ? `<br><strong>${messages.bundleLabel()}</strong> ${safeBundle} ${messages.bundleInstallRecommended()}`
              : ""
          }
        </div>`
      : "";

  return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>${safeSkillName}</title>
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
    <h1 class="title">${safeSkillName}</h1>
    <div class="actions">
      ${favoriteButton}
      <button class="btn-primary" onclick="install()">
        ${messages.actionInstall()}
      </button>
      ${addSourceButton}
      <button class="btn-primary" onclick="openGitHub()">
        ${messages.githubButtonLabel()}
      </button>
    </div>
  </div>
  <div class="meta">
    <strong>${messages.sourceLabel()}:</strong> ${safeSource} | 
    <strong>${messages.categoriesLabel()}:</strong> ${safeCategories || messages.noneLabel()}${
      skill.stars
        ? ` | <strong>${messages.starsLabel()}:</strong> ⭐ ${skill.stars.toLocaleString()}`
        : ""
    }${skill.isOrg ? ` | 🏢 ${messages.organizationLabel()}` : ""}${
      safeBundle
        ? ` | <strong>${messages.bundleLabel()}:</strong> ${safeBundle}`
        : ""
    }
  </div>
  ${standaloneWarning}
  <div class="content">
    ${htmlContent}
  </div>
  <script nonce="${nonce}">
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
  context: vscode.ExtensionContext,
): Promise<void> {
  const token = await getGitHubToken();

  // スキルインデックスからソース情報を取得
  const skillIndex = await loadSkillIndex(context);
  const sources = skillIndex.sources;

  // スキルがインデックスに登録されているか確認
  const indexedSkill = findIndexedSkill(skill, skillIndex.skills, sources);
  const installTargetSkill = indexedSkill || skill;
  const isInIndex = !!indexedSkill;

  // お気に入り状態を取得
  const favorites = context.globalState.get<string[]>("favorites", []);
  const skillId = getSkillId(installTargetSkill);
  const isFavorite = favorites.includes(skillId);
  const requestId = ++previewRequestCounter;

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
        },
      );

      previewPanel.onDidDispose(() => {
        previewMessageListener?.dispose();
        previewMessageListener = undefined;
        previewPanel = undefined;
      });
    }

    const activePanel = previewPanel;
    if (!activePanel) {
      return;
    }

    // コンテンツを読み込み
    activePanel.title = `${messages.previewTitle()}: ${skill.name}`;
    activePanel.webview.html = `<p>${messages.loading()}</p>`;

    const content = await fetchSkillContent(skill, sources, token);
    if (
      !previewPanel ||
      activePanel !== previewPanel ||
      requestId !== previewRequestCounter
    ) {
      return;
    }

    const nonce = getNonce();
    activePanel.webview.html = getWebviewContent(
      skill,
      content,
      isFavorite,
      nonce,
      isInIndex,
    );

    // メッセージハンドラー
    previewMessageListener?.dispose();
    previewMessageListener = activePanel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "install": {
            // インデックスにない場合は先にソースを追加
            if (!isInIndex) {
              // skill.source が owner/repo 形式か source ID 形式かを判定
              let repoUrl: string;
              if (skill.source.includes("/")) {
                // owner/repo 形式（検索結果から）
                repoUrl = `https://github.com/${skill.source}`;
              } else {
                // source ID 形式（インデックスから）→ ソース情報からURLを取得
                const sourceInfo = sources.find((s) => s.id === skill.source);
                if (sourceInfo) {
                  repoUrl = sourceInfo.url;
                } else {
                  vscode.window.showErrorMessage(
                    messages.sourceNotFoundInPreview(skill.source),
                  );
                  return;
                }
              }
              await vscode.commands.executeCommand(
                "skillNinja.addSource",
                repoUrl,
              );
              // ソース追加後、インデックスを再読み込みしてスキルを検索
              const updatedIndex = await loadSkillIndex(context);
              const resolvedSourceId = resolveSourceIdFromSourceValue(
                skill.source,
                updatedIndex.sources,
              );

              if (skill.source.includes("/") && !resolvedSourceId) {
                vscode.window.showWarningMessage(
                  messages.sourceResolutionFailedInPreview(skill.source),
                );
                return;
              }

              const targetSourceId = resolvedSourceId || skill.source;
              const sourceScopedSkills = updatedIndex.skills.filter(
                (s: Skill) => s.source === targetSourceId,
              );

              const matchedByPath = sourceScopedSkills.find(
                (s: Skill) => s.name === skill.name && s.path === skill.path,
              );
              const nameMatches = sourceScopedSkills.filter(
                (s: Skill) => s.name === skill.name,
              );

              const installedSkill =
                matchedByPath ||
                (nameMatches.length === 1 ? nameMatches[0] : undefined);
              if (installedSkill) {
                await vscode.commands.executeCommand(
                  "skillNinja.install",
                  installedSkill,
                );
              } else {
                vscode.window.showWarningMessage(
                  messages.skillNotFoundAfterAddSource(skill.name),
                );
              }
            } else {
              await vscode.commands.executeCommand(
                "skillNinja.install",
                installTargetSkill,
              );
            }
            break;
          }
          case "addSource": {
            // ソースのみ追加
            // skill.source が owner/repo 形式か source ID 形式かを判定
            let repoUrl: string;
            if (skill.source.includes("/")) {
              // owner/repo 形式（検索結果から）
              repoUrl = `https://github.com/${skill.source}`;
            } else {
              // source ID 形式（インデックスから）→ ソース情報からURLを取得
              const sourceInfo = sources.find((s) => s.id === skill.source);
              if (sourceInfo) {
                repoUrl = sourceInfo.url;
              } else {
                vscode.window.showErrorMessage(
                  messages.sourceNotFoundInPreview(skill.source),
                );
                return;
              }
            }
            await vscode.commands.executeCommand(
              "skillNinja.addSource",
              repoUrl,
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
                // source が owner/repo 形式か source ID 形式かを判定
                // ソース情報からブランチを取得（なければ main にフォールバック）
                const sourceInfo = sources.find((s) => s.id === skill.source);
                const branch = sourceInfo?.branch || "main";
                if (skill.source.includes("/")) {
                  // owner/repo 形式（検索結果から）
                  url = `https://github.com/${skill.source}/tree/${branch}/${skill.path}`;
                } else {
                  // source ID 形式（インデックスから）→ ソース情報からURLを取得
                  if (sourceInfo) {
                    const match = sourceInfo.url.match(
                      /github\.com\/([^/]+\/[^/]+)/,
                    );
                    if (match) {
                      url = `https://github.com/${match[1]}/tree/${branch}/${skill.path}`;
                    }
                  }
                }
              }
            }
            if (url) {
              await vscode.env.openExternal(vscode.Uri.parse(url));
            } else {
              vscode.window.showWarningMessage(
                messages.githubUrlNotDetermined(skill.name),
              );
            }
            break;
          }
          case "toggleFavorite": {
            await vscode.commands.executeCommand(
              "skillNinja.toggleFavorite",
              installTargetSkill,
            );
            // パネルを更新
            const newFavorites = context.globalState.get<string[]>(
              "favorites",
              [],
            );
            const newIsFavorite = newFavorites.includes(
              getSkillId(installTargetSkill),
            );
            const newNonce = getNonce();
            if (!previewPanel) {
              return;
            }
            previewPanel.webview.html = getWebviewContent(
              skill,
              content,
              newIsFavorite,
              newNonce,
              isInIndex,
            );
            break;
          }
        }
      },
    );
  } catch (error) {
    if (requestId !== previewRequestCounter || !previewPanel) {
      return;
    }
    previewPanel.webview.html = `<p>${escapeHtml(messages.previewFailed(String(error)))}</p>`;
    vscode.window.showErrorMessage(messages.previewFailed(String(error)));
  }
}
