// 多言語対応ヘルパー
// vscode.env.language を使用してローカライズ

import * as vscode from "vscode";

// 日本語メッセージ
const jaMessages = {
  noWorkspace: "ワークスペースを開いてください",
  installSuccess: "✅ {0} をインストールしました",
  installFailed: "インストール失敗: {0}",
  installing: "{0} をインストール中...",
  uninstallSuccess: "✅ {0} をアンインストールしました",
  uninstallFailed: "アンインストール失敗: {0}",
  selectSkillToUninstall: "アンインストールするスキルを選択",
  searchPlaceholder: "スキル名またはキーワードを入力...",
  searchResultsLimited:
    "上位 {0} / {1} 件を表示中です。絞り込むと探しやすくなります。",
  browseResultsLimited:
    "先頭 {0} 件のみ表示中です。入力して絞り込んでください。",
  installConfirm: '"{0}" をインストールしますか？',
  noInstalledSkills: "インストール済みスキルはありません",
  installedSkillsPlaceholder: "インストール済みスキル",
  skillNotFound: "SKILL.md が見つかりません: {0}",
  invalidSkillInfo: "スキル情報が不正です",
  updatingIndex: "スキルインデックスを更新中...",
  updatingSource: "{0} を更新中...",
  indexUpdated: "✅ インデックスを更新しました ({0} → {1} スキル, {2})",
  updateFailed: "更新失敗: {0}",
  staleSourceIndexPrompt:
    "30日以上更新されていない source index が {0} 件あります（{1}）。更新しますか？",
  staleSourceIndexUpdating: "古い source index を更新中...",
  staleSourceIndexUpdated:
    "✅ 古い source index を更新しました ({0}/{1} source)",
  staleSourceIndexPartialFailed:
    "一部の source index を更新できませんでした ({0}/{1} source 失敗): {2}",
  actionUpdateNow: "今すぐ更新",
  actionLater: "後で",
  chatFollowupSearchSkills: "スキルを検索",
  chatFollowupListInstalled: "インストール済み一覧",
  chatFollowupRecommend: "おすすめ",
  chatError: "❌ エラー: {0}",
  chatSearchMissingQuery:
    "🔍 **検索キーワードを入力してください**\n\n例: `/search MCP server` または `/search github tools`",
  chatSearchNoResults:
    '🔍 "{0}" に一致するスキルが見つかりませんでした\n\n別のキーワードで検索してください。',
  chatSearchResults: '## 🔍 "{1}" の検索結果: {0} 件\n\n',
  chatNoDescription: "説明はありません",
  chatInstallMissingSkillName:
    "📦 **インストールするスキル名を入力してください**\n\n例: `/install github-mcp`",
  chatInstallSkillNotFound:
    '❓ スキル "{0}" が見つかりませんでした。\n\n`/search {0}` で利用可能なスキルを検索してください。',
  chatNoWorkspaceFolderOpen:
    "❌ ワークスペースフォルダーが開かれていません。先にフォルダーを開いてください。",
  chatNoManagedSkillRoot:
    "❌ このワークスペースで利用できる managed skill root がありません。",
  chatInstallingSkill: "## 📦 {0} をインストール中\n\n",
  chatInstallSuccess: "✅ **{0}** をインストールしました。\n\n",
  chatInstallCheckFolder: "📂 スキル設定は {0} を確認してください。",
  chatNoInstalledSkillsUsage:
    "📋 **インストール済みスキルはまだありません**\n\n`/search` でスキルを探すか、`/recommend` でおすすめを確認してください。",
  chatInstalledSkillsHeader: "## 📋 インストール済みスキル ({0})\n\n",
  chatRecommendedSkillsHeader: "## 💡 おすすめスキル\n\n",
  chatNoWorkspacePopular:
    "ワークスペースが開かれていません。人気スキルを表示します。\n\n",
  chatReasonTypeScript: "TypeScript ファイルを検出しました",
  chatReasonNode: "Node.js プロジェクトを検出しました",
  chatReasonPython: "Python ファイルを検出しました",
  chatReasonGithub: "GitHub workflow を検出しました",
  chatReasonDocker: "Docker 設定を検出しました",
  chatNoSpecificRecommendations:
    "このプロジェクトに固有のおすすめは見つかりませんでした。\n\n",
  chatPopularSkillsHeader: "### ⭐ 人気スキル\n\n",
  chatIntroBody:
    "GitHub Copilot 用の Agent Skills を探したり管理したりできます。\n\n## コマンド\n\n- `/search <query>` - スキルを検索\n- `/install <name>` - スキルをインストール\n- `/list` - インストール済みスキルを一覧\n- `/recommend` - おすすめスキルを表示\n\n必要なことをそのまま書いても、関連するスキルを探します。\n",
  updating: "{0} を更新中...",
  updateSourceSelectRequired:
    "Remote Skills ビューから更新するソースを選択してください。",
  sourceIdNotFound: "ソース ID が見つかりません。",
  copiedToClipboard: "コピーしました",
  copiedToClipboardWithValue: "コピーしました: {0}",
  enterRepoUrl:
    "GitHub リポジトリ URL、またはリポジトリ内のフォルダ/ファイル URL を入力してください",
  repoUrlPlaceholder: "https://github.com/owner/repo",
  invalidRepoUrl:
    "有効な GitHub リポジトリ URL、または GitHub 上のフォルダ/ファイル URL を入力してください",
  scanningRepo: "リポジトリをスキャン中...",
  sourceAdded: "✅ ソースを追加しました ({0} スキル発見)",
  addSourceFailed: "ソース追加失敗: {0}",
  noSkillsInRepo: "このリポジトリにはスキルが見つかりませんでした",
  selectSourceToRemove: "削除するソースを選択",
  confirmRemoveSource:
    '"{0}" を削除しますか？このソースのすべてのスキルがインデックスから削除されます。',
  actionRemove: "削除",
  sourceRemoved: "✅ ソースを削除しました ({0} スキル)",
  removeSourceFailed: "ソース削除失敗: {0}",
  webSearchPrompt: "GitHub でスキルを検索",
  webSearchPlaceholder: "keyword... or username keyword...",
  searchingGitHub: "GitHub を検索中...",
  noSearchResults: '"{0}" に一致するスキルが見つかりませんでした',
  searchResultsCount: "{0} 件のスキルが見つかりました",
  searchFailed: "検索失敗: {0}",
  actionInstall: "インストール",
  actionCancel: "キャンセル",
  actionAddSourceRepo: "このリポジトリをソースに追加",
  actionOpenGitHub: "GitHub で開く",
  authRequired:
    "GitHub認証が必要です。未認証の API 制限に達したか、対象リポジトリや検索に認証が必要な可能性があります。GitHub トークンまたは gh CLI 認証を設定してください。",
  openSettings: "設定を開く",
  resetSettingsTitle: "設定の初期化",
  resetSettingsPrompt: "初期化する項目を選択してください",
  resetCache: "キャッシュをクリア",
  resetAllSettings: "すべての設定をリセット",
  resetAllIncludingToken: "すべての設定をリセット（トークン含む）",
  resetComplete: "✅ 初期化が完了しました。VS Codeを再起動してください。",
  authWithGhCli: "gh CLIで認証",
  installedFolder: "インストール済み",
  rateLimitExceeded:
    "GitHub API の制限に達しました。GitHub トークンで認証してください。",
  repoNotFound: "リポジトリが見つかりません: {0}",
  githubApiError: "GitHub API エラー: {0}",
  actionPreview: "プレビュー",
  actionNewSearch: "新しい検索",
  actionBack: "戻る",
  previewTitle: "スキル プレビュー",
  loading: "読み込み中...",
  addSourceButtonLabel: "ソース追加",
  githubButtonLabel: "GitHub",
  sourceLabel: "ソース",
  categoriesLabel: "カテゴリ",
  noneLabel: "なし",
  starsLabel: "スター",
  organizationLabel: "組織",
  standaloneWarningTitle: "⚠️ 警告:",
  standaloneWarningBody: "このスキルは他のスキルと組み合わせて動作します。",
  requiresLabel: "必要スキル:",
  bundleLabel: "バンドル:",
  bundleInstallRecommended: "（バンドル全体のインストール推奨）",
  previewFailed: "プレビューに失敗しました: {0}",
  sourceNotFoundInPreview:
    "ソースが見つかりません: {0}。手動でソースを追加してください。",
  sourceResolutionFailedInPreview:
    "ソースIDを特定できませんでした: {0}。ソース追加後の解決に失敗しました。",
  skillNotFoundAfterAddSource:
    'ソース追加後にスキル "{0}" が見つかりませんでした。手動でインストールしてください。',
  githubUrlNotDetermined: "{0} の GitHub URL を特定できませんでした",
  addToFavorites: "お気に入りに追加",
  removeFromFavorites: "お気に入りから削除",
  favorites: "お気に入り",
  noFavorites: "お気に入りはありません",
  openOnGitHub: "GitHub で開く",
  popularSkill: "⭐ 人気スキル",
  orgManagedSkill: "☑ 組織管理",
  starsCount: "{0} スター",
  addSourceFromSearch: "このリポジトリをソースに追加",
  selectCategory: "カテゴリを選択",
  allCategories: "すべてのカテゴリ",
  recentlyInstalled: "最近インストールしたスキル",
  noRecentSkills: "最近インストールしたスキルはありません",
  skillsInCategory: "{0} のスキル ({1}件)",
  localSkillRegistered: "✅ {0} を instruction file に登録しました",
  localSkillUnregistered: "✅ {0} を instruction file から削除しました",
  localSkillAlreadyRegistered: "{0} は既に登録されています",
  createSkillPrompt: "スキル名を入力してください",
  createSkillPlaceholder: "my-awesome-skill",
  skillCreated: "✅ {0} を作成しました",
  noLocalSkills: "ローカルスキルが見つかりません",
  instructionFileUpdatedOnSettingChange:
    "✅ 設定変更により AGENTS.md を更新しました",
} as const;

type MessageKey = keyof typeof jaMessages;
type MessageDictionary = Readonly<Record<MessageKey, string>>;

// 英語メッセージ（デフォルト）
const enMessages: MessageDictionary = {
  noWorkspace: "Please open a workspace",
  installSuccess: "✅ {0} installed successfully",
  installFailed: "Installation failed: {0}",
  installing: "Installing {0}...",
  uninstallSuccess: "✅ {0} uninstalled successfully",
  uninstallFailed: "Uninstall failed: {0}",
  selectSkillToUninstall: "Select skill to uninstall",
  searchPlaceholder: "Enter skill name or keyword...",
  searchResultsLimited:
    "Showing top {0} of {1} matches. Refine your query to narrow the list.",
  browseResultsLimited:
    "Showing the first {0} skills only. Type to narrow the list.",
  installConfirm: 'Install "{0}"?',
  noInstalledSkills: "No skills installed",
  installedSkillsPlaceholder: "Installed Skills",
  skillNotFound: "SKILL.md not found: {0}",
  invalidSkillInfo: "Invalid skill information",
  updatingIndex: "Updating skill index...",
  updatingSource: "Updating {0}...",
  indexUpdated: "✅ Index updated ({0} → {1} skills, {2})",
  updateFailed: "Update failed: {0}",
  staleSourceIndexPrompt:
    "{0} source index(es) have not been updated for more than 30 days ({1}). Update now?",
  staleSourceIndexUpdating: "Updating stale source indexes...",
  staleSourceIndexUpdated:
    "✅ Updated stale source indexes ({0}/{1} source(s))",
  staleSourceIndexPartialFailed:
    "Some source indexes could not be updated ({0}/{1} source(s) failed): {2}",
  actionUpdateNow: "Update Now",
  actionLater: "Later",
  chatFollowupSearchSkills: "Search Skills",
  chatFollowupListInstalled: "List Installed",
  chatFollowupRecommend: "Recommend",
  chatError: "❌ Error: {0}",
  chatSearchMissingQuery:
    "🔍 **Please provide a search query**\n\nExample: `/search MCP server` or `/search github tools`",
  chatSearchNoResults:
    '🔍 No skills found for "{0}"\n\nTry a different search term.',
  chatSearchResults: '## 🔍 Found {0} skill(s) for "{1}"\n\n',
  chatNoDescription: "No description",
  chatInstallMissingSkillName:
    "📦 **Please provide a skill name to install**\n\nExample: `/install github-mcp`",
  chatInstallSkillNotFound:
    '❓ Skill "{0}" not found.\n\nUse `/search {0}` to find available skills.',
  chatNoWorkspaceFolderOpen:
    "❌ No workspace folder open. Please open a folder first.",
  chatNoManagedSkillRoot:
    "❌ No managed skill root is available for this workspace.",
  chatInstallingSkill: "## 📦 Installing {0}\n\n",
  chatInstallSuccess: "✅ **{0}** has been installed successfully!\n\n",
  chatInstallCheckFolder: "📂 Check {0} for the skill configuration.",
  chatNoInstalledSkillsUsage:
    "📋 **No skills installed yet**\n\nUse `/search` to find skills or `/recommend` for suggestions.",
  chatInstalledSkillsHeader: "## 📋 Installed Skills ({0})\n\n",
  chatRecommendedSkillsHeader: "## 💡 Recommended Skills\n\n",
  chatNoWorkspacePopular:
    "No workspace open. Here are some popular skills:\n\n",
  chatReasonTypeScript: "TypeScript files detected",
  chatReasonNode: "Node.js project detected",
  chatReasonPython: "Python files detected",
  chatReasonGithub: "GitHub workflow detected",
  chatReasonDocker: "Docker configuration detected",
  chatNoSpecificRecommendations:
    "No specific recommendations based on your project.\n\n",
  chatPopularSkillsHeader: "### ⭐ Popular Skills\n\n",
  chatIntroBody:
    "I can help you find and manage Agent Skills for GitHub Copilot.\n\n## Commands\n\n- `/search <query>` - Search for skills\n- `/install <name>` - Install a skill\n- `/list` - List installed skills\n- `/recommend` - Get skill recommendations\n\nOr just describe what you need, and I'll find relevant skills!\n",
  updating: "Updating {0}...",
  updateSourceSelectRequired:
    "Please select a source to update from the Remote Skills view.",
  sourceIdNotFound: "Source ID not found.",
  copiedToClipboard: "Copied to clipboard",
  copiedToClipboardWithValue: "Copied: {0}",
  enterRepoUrl:
    "Enter a GitHub repository URL, or a folder/file URL inside the repository",
  repoUrlPlaceholder: "https://github.com/owner/repo",
  invalidRepoUrl:
    "Please enter a valid GitHub repository URL, or a GitHub folder/file URL inside that repository",
  scanningRepo: "Scanning repository for skills...",
  sourceAdded: "✅ Source added ({0} skills found)",
  addSourceFailed: "Failed to add source: {0}",
  noSkillsInRepo: "No skills found in this repository",
  selectSourceToRemove: "Select source to remove",
  confirmRemoveSource:
    'Remove "{0}"? All skills from this source will be removed from the index.',
  actionRemove: "Remove",
  sourceRemoved: "✅ Source removed ({0} skills)",
  removeSourceFailed: "Failed to remove source: {0}",
  webSearchPrompt: "Search skills on GitHub",
  webSearchPlaceholder: "keyword... or username keyword...",
  searchingGitHub: "Searching GitHub...",
  noSearchResults: 'No skills found for "{0}"',
  searchResultsCount: "{0} skills found",
  searchFailed: "Search failed: {0}",
  actionInstall: "Install",
  actionCancel: "Cancel",
  actionAddSourceRepo: "Add this repository as source",
  actionOpenGitHub: "Open on GitHub",
  authRequired:
    "GitHub authentication required. You may have hit the unauthenticated API limit, or this repository/search requires authentication. Configure a GitHub token or authenticate with gh CLI.",
  openSettings: "Open Settings",
  resetSettingsTitle: "Reset Settings",
  resetSettingsPrompt: "Select items to reset",
  resetCache: "Clear Cache",
  resetAllSettings: "Reset All Settings",
  resetAllIncludingToken: "Reset All Settings (including token)",
  resetComplete: "✅ Reset complete. Please restart VS Code.",
  authWithGhCli: "Authenticate with gh CLI",
  installedFolder: "Installed",
  rateLimitExceeded:
    "GitHub API rate limit exceeded. Please authenticate with a GitHub token.",
  repoNotFound: "Repository not found: {0}",
  githubApiError: "GitHub API error: {0}",
  actionPreview: "Preview",
  actionNewSearch: "New Search",
  actionBack: "Back",
  previewTitle: "Skill Preview",
  loading: "Loading...",
  addSourceButtonLabel: "Add Source",
  githubButtonLabel: "GitHub",
  sourceLabel: "Source",
  categoriesLabel: "Categories",
  noneLabel: "None",
  starsLabel: "Stars",
  organizationLabel: "Organization",
  standaloneWarningTitle: "⚠️ Warning:",
  standaloneWarningBody: "This skill requires other skills to work properly.",
  requiresLabel: "Requires:",
  bundleLabel: "Bundle:",
  bundleInstallRecommended: "(Install full bundle recommended)",
  previewFailed: "Preview failed: {0}",
  sourceNotFoundInPreview:
    "Source not found: {0}. Please add the source manually.",
  sourceResolutionFailedInPreview:
    "Unable to resolve source ID after adding source: {0}",
  skillNotFoundAfterAddSource:
    'Skill "{0}" not found after adding source. Please try installing manually.',
  githubUrlNotDetermined: "GitHub URL could not be determined for {0}",
  addToFavorites: "Add to Favorites",
  removeFromFavorites: "Remove from Favorites",
  favorites: "Favorites",
  noFavorites: "No favorites yet",
  openOnGitHub: "Open on GitHub",
  popularSkill: "⭐ Popular",
  orgManagedSkill: "☑ Organization",
  starsCount: "{0} stars",
  addSourceFromSearch: "Add this repository to sources",
  selectCategory: "Select Category",
  allCategories: "All Categories",
  recentlyInstalled: "Recently Installed Skills",
  noRecentSkills: "No recently installed skills",
  skillsInCategory: "{0} skills ({1})",
  localSkillRegistered: "✅ {0} registered in the instruction file",
  localSkillUnregistered: "✅ {0} removed from the instruction file",
  localSkillAlreadyRegistered: "{0} is already registered",
  createSkillPrompt: "Enter skill name",
  createSkillPlaceholder: "my-awesome-skill",
  skillCreated: "✅ {0} created",
  noLocalSkills: "No local skills found",
  instructionFileUpdatedOnSettingChange:
    "✅ AGENTS.md updated due to setting change",
};

/**
 * 現在の言語設定を取得
 */
function getCurrentLanguage(): string {
  const config = vscode.workspace.getConfiguration("skillNinja");
  const langSetting = config.get<string>("language", "auto");

  if (langSetting === "auto") {
    return vscode.env.language;
  }
  return langSetting;
}

/**
 * 現在の言語が日本語かどうかを判定
 */
export function isJapanese(): boolean {
  return getCurrentLanguage().startsWith("ja");
}

// 現在の言語に応じたメッセージを取得
function getMessages(): MessageDictionary {
  if (isJapanese()) {
    return jaMessages;
  }
  return enMessages;
}

// フォーマット関数
function format(template: string, ...args: (string | number)[]): string {
  return template.replace(/\{(\d+)\}/g, (_, index) => {
    const i = parseInt(index, 10);
    return args[i] !== undefined ? String(args[i]) : `{${index}}`;
  });
}

// ローカライズ関数
function localize(key: MessageKey, ...args: (string | number)[]): string {
  const messages = getMessages();
  const template = messages[key];
  return format(template, ...args);
}

// メッセージキー定義
export const messages = {
  // 一般
  noWorkspace: () => localize("noWorkspace"),

  // インストール関連
  installSuccess: (name: string) => localize("installSuccess", name),
  installFailed: (error: string) => localize("installFailed", error),
  installing: (name: string) => localize("installing", name),

  // アンインストール関連
  uninstallSuccess: (name: string) => localize("uninstallSuccess", name),
  uninstallFailed: (error: string) => localize("uninstallFailed", error),
  selectSkillToUninstall: () => localize("selectSkillToUninstall"),

  // 検索関連
  searchPlaceholder: () => localize("searchPlaceholder"),
  searchResultsLimited: (shown: number, total: number) =>
    localize("searchResultsLimited", shown, total),
  browseResultsLimited: (shown: number) =>
    localize("browseResultsLimited", shown),
  installConfirm: (name: string) => localize("installConfirm", name),
  noInstalledSkills: () => localize("noInstalledSkills"),
  installedSkillsPlaceholder: () => localize("installedSkillsPlaceholder"),
  skillNotFound: (name: string) => localize("skillNotFound", name),
  invalidSkillInfo: () => localize("invalidSkillInfo"),

  // インデックス更新
  updatingIndex: () => localize("updatingIndex"),
  updatingSource: (name: string) => localize("updatingSource", name),
  indexUpdated: (oldCount: number, newCount: number, diff: string) =>
    localize("indexUpdated", oldCount, newCount, diff),
  updateFailed: (error: string) => localize("updateFailed", error),
  staleSourceIndexPrompt: (count: number, sources: string) =>
    localize("staleSourceIndexPrompt", count, sources),
  staleSourceIndexUpdating: () => localize("staleSourceIndexUpdating"),
  staleSourceIndexUpdated: (updated: number, total: number) =>
    localize("staleSourceIndexUpdated", updated, total),
  staleSourceIndexPartialFailed: (
    failed: number,
    total: number,
    sources: string,
  ) => localize("staleSourceIndexPartialFailed", failed, total, sources),
  actionUpdateNow: () => localize("actionUpdateNow"),
  actionLater: () => localize("actionLater"),
  chatFollowupSearchSkills: () => localize("chatFollowupSearchSkills"),
  chatFollowupListInstalled: () => localize("chatFollowupListInstalled"),
  chatFollowupRecommend: () => localize("chatFollowupRecommend"),
  chatError: (error: string) => localize("chatError", error),
  chatSearchMissingQuery: () => localize("chatSearchMissingQuery"),
  chatSearchNoResults: (query: string) =>
    localize("chatSearchNoResults", query),
  chatSearchResults: (count: number, query: string) =>
    localize("chatSearchResults", count, query),
  chatNoDescription: () => localize("chatNoDescription"),
  chatInstallMissingSkillName: () => localize("chatInstallMissingSkillName"),
  chatInstallSkillNotFound: (name: string) =>
    localize("chatInstallSkillNotFound", name),
  chatNoWorkspaceFolderOpen: () => localize("chatNoWorkspaceFolderOpen"),
  chatNoManagedSkillRoot: () => localize("chatNoManagedSkillRoot"),
  chatInstallingSkill: (name: string) => localize("chatInstallingSkill", name),
  chatInstallSuccess: (name: string) => localize("chatInstallSuccess", name),
  chatInstallCheckFolder: (folder: string) =>
    localize("chatInstallCheckFolder", folder),
  chatNoInstalledSkillsUsage: () => localize("chatNoInstalledSkillsUsage"),
  chatInstalledSkillsHeader: (count: number) =>
    localize("chatInstalledSkillsHeader", count),
  chatRecommendedSkillsHeader: () => localize("chatRecommendedSkillsHeader"),
  chatNoWorkspacePopular: () => localize("chatNoWorkspacePopular"),
  chatReasonTypeScript: () => localize("chatReasonTypeScript"),
  chatReasonNode: () => localize("chatReasonNode"),
  chatReasonPython: () => localize("chatReasonPython"),
  chatReasonGithub: () => localize("chatReasonGithub"),
  chatReasonDocker: () => localize("chatReasonDocker"),
  chatNoSpecificRecommendations: () =>
    localize("chatNoSpecificRecommendations"),
  chatPopularSkillsHeader: () => localize("chatPopularSkillsHeader"),
  chatIntroBody: () => localize("chatIntroBody"),
  updating: (name: string) => localize("updating", name),
  updateSourceSelectRequired: () => localize("updateSourceSelectRequired"),
  sourceIdNotFound: () => localize("sourceIdNotFound"),
  copiedToClipboard: () => localize("copiedToClipboard"),
  copiedToClipboardWithValue: (value: string) =>
    localize("copiedToClipboardWithValue", value),

  // ソース追加
  enterRepoUrl: () => localize("enterRepoUrl"),
  repoUrlPlaceholder: () => localize("repoUrlPlaceholder"),
  invalidRepoUrl: () => localize("invalidRepoUrl"),
  scanningRepo: () => localize("scanningRepo"),
  sourceAdded: (count: number) => localize("sourceAdded", count),
  addSourceFailed: (error: string) => localize("addSourceFailed", error),
  noSkillsInRepo: () => localize("noSkillsInRepo"),

  // ソース削除
  selectSourceToRemove: () => localize("selectSourceToRemove"),
  confirmRemoveSource: (name: string) => localize("confirmRemoveSource", name),
  actionRemove: () => localize("actionRemove"),
  sourceRemoved: (count: number) => localize("sourceRemoved", count),
  removeSourceFailed: (error: string) => localize("removeSourceFailed", error),

  // Web検索
  webSearchPrompt: () => localize("webSearchPrompt"),
  webSearchPlaceholder: () => localize("webSearchPlaceholder"),
  searchingGitHub: () => localize("searchingGitHub"),
  noSearchResults: (query: string) => localize("noSearchResults", query),
  searchResultsCount: (count: number) => localize("searchResultsCount", count),
  searchFailed: (error: string) => localize("searchFailed", error),

  // アクション
  actionInstall: () => localize("actionInstall"),
  actionCancel: () => localize("actionCancel"),
  actionAddSourceRepo: () => localize("actionAddSourceRepo"),
  actionOpenGitHub: () => localize("actionOpenGitHub"),

  // 認証
  authRequired: () => localize("authRequired"),
  openSettings: () => localize("openSettings"),
  authWithGhCli: () => localize("authWithGhCli"),

  // 初期化
  resetSettingsTitle: () => localize("resetSettingsTitle"),
  resetSettingsPrompt: () => localize("resetSettingsPrompt"),
  resetCache: () => localize("resetCache"),
  resetAllSettings: () => localize("resetAllSettings"),
  resetAllIncludingToken: () => localize("resetAllIncludingToken"),
  resetComplete: () => localize("resetComplete"),

  // TreeView
  installedFolder: () => localize("installedFolder"),

  // GitHub API エラー
  rateLimitExceeded: () => localize("rateLimitExceeded"),
  repoNotFound: (repo: string) => localize("repoNotFound", repo),
  githubApiError: (status: number) => localize("githubApiError", status),

  // 新機能: プレビュー、お気に入り、検索継続
  actionPreview: () => localize("actionPreview"),
  actionNewSearch: () => localize("actionNewSearch"),
  actionBack: () => localize("actionBack"),
  previewTitle: () => localize("previewTitle"),
  loading: () => localize("loading"),
  addSourceButtonLabel: () => localize("addSourceButtonLabel"),
  githubButtonLabel: () => localize("githubButtonLabel"),
  sourceLabel: () => localize("sourceLabel"),
  categoriesLabel: () => localize("categoriesLabel"),
  noneLabel: () => localize("noneLabel"),
  starsLabel: () => localize("starsLabel"),
  organizationLabel: () => localize("organizationLabel"),
  standaloneWarningTitle: () => localize("standaloneWarningTitle"),
  standaloneWarningBody: () => localize("standaloneWarningBody"),
  requiresLabel: () => localize("requiresLabel"),
  bundleLabel: () => localize("bundleLabel"),
  bundleInstallRecommended: () => localize("bundleInstallRecommended"),
  previewFailed: (error: string) => localize("previewFailed", error),
  sourceNotFoundInPreview: (source: string) =>
    localize("sourceNotFoundInPreview", source),
  sourceResolutionFailedInPreview: (source: string) =>
    localize("sourceResolutionFailedInPreview", source),
  skillNotFoundAfterAddSource: (name: string) =>
    localize("skillNotFoundAfterAddSource", name),
  githubUrlNotDetermined: (name: string) =>
    localize("githubUrlNotDetermined", name),
  addToFavorites: () => localize("addToFavorites"),
  removeFromFavorites: () => localize("removeFromFavorites"),
  favorites: () => localize("favorites"),
  noFavorites: () => localize("noFavorites"),

  // GitHubで開く・ハイライト
  openOnGitHub: () => localize("openOnGitHub"),
  popularSkill: () => localize("popularSkill"),
  orgManagedSkill: () => localize("orgManagedSkill"),
  starsCount: (count: number) => localize("starsCount", count),
  addSourceFromSearch: () => localize("addSourceFromSearch"),

  // カテゴリフィルタ・履歴
  selectCategory: () => localize("selectCategory"),
  allCategories: () => localize("allCategories"),
  recentlyInstalled: () => localize("recentlyInstalled"),
  noRecentSkills: () => localize("noRecentSkills"),
  skillsInCategory: (category: string, count: number) =>
    localize("skillsInCategory", category, count),

  // ローカルスキル
  localSkillRegistered: (name: string) =>
    localize("localSkillRegistered", name),
  localSkillUnregistered: (name: string) =>
    localize("localSkillUnregistered", name),
  localSkillAlreadyRegistered: (name: string) =>
    localize("localSkillAlreadyRegistered", name),
  createSkillPrompt: () => localize("createSkillPrompt"),
  createSkillPlaceholder: () => localize("createSkillPlaceholder"),
  skillCreated: (name: string) => localize("skillCreated", name),
  noLocalSkills: () => localize("noLocalSkills"),

  // 設定変更時の自動更新
  instructionFileUpdatedOnSettingChange: () =>
    localize("instructionFileUpdatedOnSettingChange"),
};

export default messages;
