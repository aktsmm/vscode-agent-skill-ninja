// 多言語対応ヘルパー
// vscode.env.language を使用してローカライズ

import * as vscode from "vscode";

// 日本語メッセージ
const jaMessages: Record<string, string> = {
  noWorkspace: "ワークスペースを開いてください",
  installSuccess: "✅ {0} をインストールしました",
  installFailed: "インストール失敗: {0}",
  installing: "{0} をインストール中...",
  uninstallSuccess: "✅ {0} をアンインストールしました",
  uninstallFailed: "アンインストール失敗: {0}",
  selectSkillToUninstall: "アンインストールするスキルを選択",
  searchPlaceholder: "スキル名またはキーワードを入力...",
  installConfirm: '"{0}" をインストールしますか？',
  noInstalledSkills: "インストール済みスキルはありません",
  installedSkillsPlaceholder: "インストール済みスキル",
  skillNotFound: "SKILL.md が見つかりません: {0}",
  invalidSkillInfo: "スキル情報が不正です",
  updatingIndex: "スキルインデックスを更新中...",
  indexUpdated: "✅ インデックスを更新しました ({0} スキル)",
  updateFailed: "更新失敗: {0}",
  updating: "{0} を更新中...",
  enterRepoUrl: "GitHub リポジトリの URL を入力してください",
  repoUrlPlaceholder: "https://github.com/owner/repo",
  invalidRepoUrl: "有効な GitHub リポジトリ URL を入力してください",
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
  webSearchPlaceholder: "検索キーワード (例: kubernetes, terraform, azure)",
  searchingGitHub: "GitHub を検索中...",
  noSearchResults: '"{0}" に一致するスキルが見つかりませんでした',
  searchResultsCount: "{0} 件のスキルが見つかりました",
  searchFailed: "検索失敗: {0}",
  actionInstall: "インストール",
  actionCancel: "キャンセル",
  actionAddSourceRepo: "このリポジトリをソースに追加",
  actionOpenGitHub: "GitHub で開く",
  authRequired:
    "GitHub認証が必要です。API制限を回避するために認証を設定してください。",
  openSettings: "設定を開く",
  authWithGhCli: "gh CLIで認証",
  installedFolder: "インストール済み",
  rateLimitExceeded:
    "GitHub API の制限に達しました。GitHub トークンで認証してください。",
  repoNotFound: "リポジトリが見つかりません: {0}",
  githubApiError: "GitHub API エラー: {0}",
};

// 英語メッセージ（デフォルト）
const enMessages: Record<string, string> = {
  noWorkspace: "Please open a workspace",
  installSuccess: "✅ {0} installed successfully",
  installFailed: "Installation failed: {0}",
  installing: "Installing {0}...",
  uninstallSuccess: "✅ {0} uninstalled successfully",
  uninstallFailed: "Uninstall failed: {0}",
  selectSkillToUninstall: "Select skill to uninstall",
  searchPlaceholder: "Enter skill name or keyword...",
  installConfirm: 'Install "{0}"?',
  noInstalledSkills: "No skills installed",
  installedSkillsPlaceholder: "Installed Skills",
  skillNotFound: "SKILL.md not found: {0}",
  invalidSkillInfo: "Invalid skill information",
  updatingIndex: "Updating skill index...",
  indexUpdated: "✅ Index updated ({0} skills)",
  updateFailed: "Update failed: {0}",
  updating: "Updating {0}...",
  enterRepoUrl: "Enter GitHub repository URL",
  repoUrlPlaceholder: "https://github.com/owner/repo",
  invalidRepoUrl: "Please enter a valid GitHub repository URL",
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
  webSearchPlaceholder: "Search keyword (e.g., kubernetes, terraform, azure)",
  searchingGitHub: "Searching GitHub...",
  noSearchResults: 'No skills found for "{0}"',
  searchResultsCount: "{0} skills found",
  searchFailed: "Search failed: {0}",
  actionInstall: "Install",
  actionCancel: "Cancel",
  actionAddSourceRepo: "Add this repository as source",
  actionOpenGitHub: "Open on GitHub",
  authRequired:
    "GitHub authentication required. Please configure authentication to avoid API rate limits.",
  openSettings: "Open Settings",
  authWithGhCli: "Authenticate with gh CLI",
  installedFolder: "Installed",
  rateLimitExceeded:
    "GitHub API rate limit exceeded. Please authenticate with a GitHub token.",
  repoNotFound: "Repository not found: {0}",
  githubApiError: "GitHub API error: {0}",
};

// 現在の言語に応じたメッセージを取得
function getMessages(): Record<string, string> {
  const lang = vscode.env.language;
  if (lang.startsWith("ja")) {
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
function localize(key: string, ...args: (string | number)[]): string {
  const messages = getMessages();
  const template = messages[key] || enMessages[key] || key;
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
  installConfirm: (name: string) => localize("installConfirm", name),
  noInstalledSkills: () => localize("noInstalledSkills"),
  installedSkillsPlaceholder: () => localize("installedSkillsPlaceholder"),
  skillNotFound: (name: string) => localize("skillNotFound", name),
  invalidSkillInfo: () => localize("invalidSkillInfo"),

  // インデックス更新
  updatingIndex: () => localize("updatingIndex"),
  indexUpdated: (count: number) => localize("indexUpdated", count),
  updateFailed: (error: string) => localize("updateFailed", error),
  updating: (name: string) => localize("updating", name),

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

  // TreeView
  installedFolder: () => localize("installedFolder"),

  // GitHub API エラー
  rateLimitExceeded: () => localize("rateLimitExceeded"),
  repoNotFound: (repo: string) => localize("repoNotFound", repo),
  githubApiError: (status: number) => localize("githubApiError", status),
};

export default messages;
