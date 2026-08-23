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
  staleSourceIndexAgeDays: "{0}日",
  staleSourceIndexUpdating: "古い source index を更新中...",
  staleSourceIndexUpdated:
    "✅ 古い source index を更新しました ({0}/{1} source)",
  staleSourceIndexPartialFailed:
    "source index の更新結果: 更新 {0}/{2}、失敗 {1}、未試行 {5}。失敗: {3}。理由: {4}",
  sourceIndexSkillsUpdatedProgress: "{0} スキルを更新しました",
  sourceIndexNotIndexed: "未インデックス",
  sourceIndexRateLimitDeferred:
    "レート制限のため {0} 件の source 更新を中断しました。{1} 以降に再開できます",
  sourceIndexRateLimitResumeStarted:
    "中断していた {0} 件の source 更新を再開します",
  sourceIndexRateLimitResumeNothing: "再開待ちの source 更新はありません",
  sourceIndexRateLimitResumeNotReady:
    "まだレート制限の解除時刻前です。{0} 以降に再開してください",
  actionResumeNow: "今すぐ再開",
  sourceIndexEmptyScanKept:
    "取得結果が 0 件だったため更新を中止し、既存の {0} スキルを保持しました",
  sourceIndexForeignScannerKept:
    "このソースはこの拡張が実行できない scanner（{0}）を宣言しています。別の基準で上書きしないよう、走査を見送り既存のインデックスを保持しました",
  sourceIndexForeignScannerSkipped:
    "実行できない scanner を宣言している {0} 個のソースは走査を見送りました（{1}）",
  sourceIndexRepositoryIdentityChanged:
    "URL の参照先が別のリポジトリに変わっています（repository ID {0} → {1}）。意図した変更なら、このソースを削除してから追加し直してください",
  sourceIndexRepositoryIdentitySkipped:
    "⚠️ 参照先が別のリポジトリに変わったため更新をスキップしました: {0}",
  sourceIndexRateLimitStopped:
    "⚠️ {0} でレート制限に達したため、残り {1} 件の source を走査せずに中断しました。既存のスキルはそのまま保持しています",
  sourceIndexUpdated: "✅ {0} を更新しました: {1} → {2} スキル ({3})",
  githubRateLimitReason: "GitHub API のレート制限に達しました",
  githubRateLimitResetAt: "再試行可能時刻: {0}",
  githubSsoRequiredReason: "GitHub organization の SSO 認可が必要です",
  githubClassicPatForbiddenReason:
    "GitHub organization のポリシーで classic PAT が拒否されました",
  githubAuthRequiredReason: "GitHub の認証またはリポジトリ権限が必要です",
  actionShowDetails: "詳細を表示",
  actionConfigureGitHubAuth: "GitHub 認証を設定",
  actionOpenGitHubSso: "SSO セッションを開く",
  actionClearStoredGitHubToken:
    "保存済み GitHub トークンをクリア（SecretStorage のみ）",
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
  copyUrlUnavailable:
    "この項目にはコピーできる URL がありません。インデックスを更新して再試行してください。",
  commandNeedsSkillSelection:
    "Agent Skills Ninja のビューでスキルを選んでから実行してください。",
  copyPathUnavailable: "この項目にはコピーできるローカルパスがありません。",
  openInTerminalUnavailable:
    "この項目にはターミナルで開けるフォルダーがありません。",
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
  actionDontAskAgain: "今後表示しない",
  actionAddSourceRepo: "このリポジトリをソースに追加",
  actionOpenGitHub: "GitHub で開く",
  authRequired:
    "GitHub認証が必要です。未認証の API 制限に達したか、対象リポジトリや検索に認証が必要な可能性があります。GitHub トークンまたは gh CLI 認証を設定してください。",
  skillDownloadNotFoundNoAuth:
    'スキル "{0}" が見つかりません。プライベート リポジトリの場合は GitHub 認証が必要です。認証を設定するか、インデックスを更新してください。',
  skillDownloadNotFoundWithAuth:
    'スキル "{0}" が見つかりません。インデックスのパスが古いか、GitHub 認証に対象リポジトリの Contents: read 権限がない可能性があります。',
  actionUpdateIndex: "インデックス更新",
  actionReportBug: "バグ報告",
  actionRetryInstall: "再インストール",
  actionRemoveSkill: "削除",
  installIncomplete:
    'スキル "{0}" のインストールが完了していません。SKILL.md の内容を取得できなかったため、仮の内容だけが保存されています。',
  installPartial:
    'スキル "{0}" の一部のファイルを取得できませんでした。SKILL.md は正常にインストールされています。',
  installTargetConflictPrompt:
    'インストール先フォルダ "{0}" は別のソース ({1}) のスキルが使用中です。上書きすると既存フォルダとローカルの変更は削除され、ソース {2} の内容で入れ直します。続行しますか？',
  installTargetUnknownOwner: "不明",
  retryFailedInstallsAction: "失敗した {0} 件を再試行",
  retryingFailedInstallsTitle: "失敗したスキルを再試行中...",
  retryingFailedInstalls: "{0} を再試行中...",
  retryFailedInstallsSummary: "再試行: {0}/{1} 件をインストールしました",
  repairIncompleteNoTargets: "修復が必要なスキルはありません",
  repairIncompleteSummary: "修復: {0}/{1} 件のスキルを入れ直しました",
  repairIncompleteTitle: "不完全なスキルを修復中...",
  installTargetConflictOverwrite: "上書きする",
  installTargetConflictBlocked:
    'インストール先フォルダ "{0}" は別のソース ({1}) が所有しているため、ソース {2} のインストールを中止しました。',
  incompleteSkillsDetected:
    "内容が不完全なスキルが {0} 件あります: {1}。再インストールしてください。",
  installSkippedUnsafeEntries:
    'スキル "{0}" の配布元に安全でないファイル名が {1} 件含まれていたため、それらを除外してインストールしました: {2}',
  rootLevelSkillArtifactsDetected:
    "スキルルート直下に SKILL.md / .skill-meta.json が直接置かれています ({0})。旧バージョンの不具合による残骸の可能性があります。内容を確認して手動で整理してください（自動削除は行いません）。",
  bulkUninstallSummary: "{0} 個のスキルを削除しました",
  bulkUninstallSummaryWithFailures:
    "{0} 個のスキルを削除しました。{1} 個は削除できませんでした。",
  openSettings: "設定を開く",
  resetSettingsTitle: "設定の初期化",
  resetSettingsPrompt: "初期化する項目を選択してください",
  resetCache: "キャッシュをクリア",
  resetAllSettings: "すべての設定をリセット",
  resetAllIncludingToken: "すべての設定をリセット（トークン含む）",
  resetComplete: "✅ 初期化が完了しました。VS Codeを再起動してください。",
  githubTokenCleared: "SecretStorage の GitHub トークンを削除しました。",
  githubTokenNotStored:
    "SecretStorage に保存された GitHub トークンはありません。",
  githubTokenLegacyPlaintextFound:
    "GitHub トークンを SecretStorage へ移行しました。settings.json に平文のコピーが残っています。",
  githubTokenLegacyPlaintextOnly:
    "settings.json に平文の GitHub トークンがあります。SecretStorage へは移行していないので、削除する前に値を控えてください。",
  githubTokenRemoveLegacyPlaintext: "平文のコピーを削除",
  githubTokenLegacyPlaintextRemoved:
    "settings.json から GitHub トークンの平文コピーを削除しました。",
  githubTokenLegacyPlaintextRemoveFailed:
    "settings.json の平文コピーを削除できませんでした。skillNinja.githubToken を手動で削除してください。",
  githubTokenClearFailed:
    "SecretStorage の GitHub トークンを削除できませんでした。VS Code を再読み込みして再試行してください。",
  authWithGhCli: "gh CLIで認証",
  ghAccountInvalid:
    "gh CLI のアクティブアカウント「{0}」の資格情報が使えません。他のアカウントにログイン済みでも、拡張機能はアクティブなアカウントだけを使います。",
  ghAccountRateLimited:
    "gh CLI のアクティブアカウント「{0}」が GitHub API の制限に達しています。トークン自体は有効なので、削除しないでください。",
  ghSwitchAccountAction: "「{0}」に切り替えて再試行",
  ghSwitchAccountConfirm:
    "gh CLI のアクティブアカウントを「{0}」へ切り替えます。この変更は VS Code 内だけでなく、保存済みの github.com 資格情報を使う gh コマンド全体に適用されます。続行しますか？",
  ghSwitchAccountConfirmAction: "切り替える",
  ghSwitchAccountSucceeded:
    "gh CLI のアクティブアカウントを「{0}」へ切り替えました。",
  ghSwitchAccountFailed:
    "gh CLI のアカウント切替に失敗しました。ターミナルで gh auth switch を実行してください。",
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
  localSkillActionUnavailable:
    "この項目はローカルスキルではないため、instruction file への登録状態を変更できません。",
  localSkillRegistrationFailed:
    "{0} の登録状態を更新できませんでした。読み取り専用のスキルか、書き込みに失敗した可能性があります。",
  skillStateUnavailable:
    "この項目にはスキル情報がないため、状態を説明できません。",
  createSkillPrompt: "スキル名を入力してください",
  createSkillPlaceholder: "my-awesome-skill",
  skillCreated: "✅ {0} を作成しました",
  noLocalSkills: "ローカルスキルが見つかりません",
  instructionFileUpdatedOnSettingChange:
    "✅ 設定変更により AGENTS.md を更新しました",
  outputTargetsPickPlaceholder:
    "スキル一覧を出力する先を選んでください（チェックを外すと管理ブロックと生成カタログを削除）",
  outputTargetsNone: "管理できる出力先が見つかりません",
  outputTargetsFormatPlaceholder:
    "形式を変える出力先を選んでください（Esc で終了）",
  outputTargetsFormatFor: "{0} の出力形式",
  outputTargetsUseDefault: "全体の既定に従う ({0})",
  outputTargetsAutoLoaded: "VS Code が常時読み込むファイル",
  outputTargetsShared: "{0} 件の出力先がこのファイルを共有",
  outputTargetsDisabledWarning:
    "{0} 件の出力先を無効にします。管理ブロックと生成済みカタログを削除しますか？自分で書いた本文は残ります。",
  outputTargetsDisableConfirm: "削除して続行",
  outputTargetsApplied: "✅ 出力ターゲットを更新しました（有効 {0} 件）",
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
  staleSourceIndexAgeDays: "{0}d",
  staleSourceIndexUpdating: "Updating stale source indexes...",
  staleSourceIndexUpdated:
    "✅ Updated stale source indexes ({0}/{1} source(s))",
  staleSourceIndexPartialFailed:
    "Source index update result: {0}/{2} updated, {1} failed, {5} not attempted. Failed: {3}. Reason: {4}",
  sourceIndexSkillsUpdatedProgress: "Updated {0} skill(s)",
  sourceIndexNotIndexed: "not indexed",
  sourceIndexRateLimitDeferred:
    "Rate limit stopped {0} source update(s). They can resume after {1}",
  sourceIndexRateLimitResumeStarted: "Resuming {0} deferred source update(s)",
  sourceIndexRateLimitResumeNothing: "No deferred source updates to resume",
  sourceIndexRateLimitResumeNotReady:
    "The rate limit has not reset yet. Resume after {0}",
  actionResumeNow: "Resume now",
  sourceIndexEmptyScanKept:
    "The scan returned 0 skills, so the update was cancelled and the existing {0} skill(s) were kept",
  sourceIndexForeignScannerKept:
    "This source declares a scanner this extension cannot run ({0}). The scan was skipped and the existing index was kept so it is not overwritten under different semantics",
  sourceIndexForeignScannerSkipped:
    "Skipped {0} source(s) that declare a scanner this extension cannot run ({1})",
  sourceIndexRepositoryIdentityChanged:
    "This URL now resolves to a different repository (repository ID {0} -> {1}). If the change is intentional, remove this source and add it again",
  sourceIndexRepositoryIdentitySkipped:
    "⚠️ Skipped updating source(s) whose URL now resolves to a different repository: {0}",
  sourceIndexRateLimitStopped:
    "⚠️ Hit the rate limit on {0} and stopped before scanning {1} more source(s). Existing skills are kept",
  sourceIndexUpdated: "✅ Updated {0}: {1} → {2} skill(s) ({3})",
  githubRateLimitReason: "GitHub API rate limit exceeded",
  githubRateLimitResetAt: "retry after {0}",
  githubSsoRequiredReason: "GitHub organization SSO authorization is required",
  githubClassicPatForbiddenReason:
    "GitHub organization policy rejected the classic PAT",
  githubAuthRequiredReason:
    "GitHub authentication or repository permission is required",
  actionShowDetails: "Show Details",
  actionConfigureGitHubAuth: "Configure GitHub Authentication",
  actionOpenGitHubSso: "Open SSO Session",
  actionClearStoredGitHubToken:
    "Clear Stored GitHub Token (SecretStorage only)",
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
  copyUrlUnavailable:
    "This item has no URL to copy. Update the index and try again.",
  commandNeedsSkillSelection:
    "Select a skill in the Agent Skills Ninja view first.",
  copyPathUnavailable: "This item has no local path to copy.",
  openInTerminalUnavailable: "This item has no folder to open in a terminal.",
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
  actionDontAskAgain: "Don't ask again",
  actionAddSourceRepo: "Add this repository as source",
  actionOpenGitHub: "Open on GitHub",
  authRequired:
    "GitHub authentication required. You may have hit the unauthenticated API limit, or this repository/search requires authentication. Configure a GitHub token or authenticate with gh CLI.",
  skillDownloadNotFoundNoAuth:
    'Skill "{0}" was not found. Private repositories require GitHub authentication. Configure authentication or update the skill index.',
  skillDownloadNotFoundWithAuth:
    'Skill "{0}" was not found. The index path may be outdated, or GitHub authentication may not have Contents: read access to the repository.',
  actionUpdateIndex: "Update Index",
  actionReportBug: "Report Bug",
  actionRetryInstall: "Retry Install",
  actionRemoveSkill: "Remove",
  installIncomplete:
    'Skill "{0}" was not installed completely. SKILL.md content could not be downloaded, so only placeholder text was saved.',
  installPartial:
    'Some files for skill "{0}" could not be downloaded. SKILL.md was installed successfully.',
  installTargetConflictPrompt:
    'The install folder "{0}" is already used by a skill from another source ({1}). Overwriting deletes the existing folder and any local changes, then reinstalls it from source {2}. Continue?',
  installTargetUnknownOwner: "unknown",
  retryFailedInstallsAction: "Retry {0} failed",
  retryingFailedInstallsTitle: "Retrying failed skills...",
  retryingFailedInstalls: "Retrying {0}...",
  retryFailedInstallsSummary: "Retry: installed {0}/{1}",
  repairIncompleteNoTargets: "No skills need repair",
  repairIncompleteSummary: "Repair: reinstalled {0}/{1} skill(s)",
  repairIncompleteTitle: "Repairing incomplete skills...",
  installTargetConflictOverwrite: "Overwrite",
  installTargetConflictBlocked:
    'The install folder "{0}" is owned by another source ({1}), so the install from source {2} was cancelled.',
  incompleteSkillsDetected:
    "{0} installed skill(s) have incomplete content: {1}. Reinstall them to restore the full content.",
  installSkippedUnsafeEntries:
    'The source of skill "{0}" contained {1} unsafe file name(s), which were excluded from the install: {2}',
  rootLevelSkillArtifactsDetected:
    "SKILL.md / .skill-meta.json were found directly in a skill root ({0}). These may be leftovers from a bug in an earlier version. Review and clean them up manually (nothing was deleted automatically).",
  bulkUninstallSummary: "Deleted {0} skills",
  bulkUninstallSummaryWithFailures:
    "Deleted {0} skills. {1} could not be deleted.",
  openSettings: "Open Settings",
  resetSettingsTitle: "Reset Settings",
  resetSettingsPrompt: "Select items to reset",
  resetCache: "Clear Cache",
  resetAllSettings: "Reset All Settings",
  resetAllIncludingToken: "Reset All Settings (including token)",
  resetComplete: "✅ Reset complete. Please restart VS Code.",
  githubTokenCleared: "Removed the GitHub token from SecretStorage.",
  githubTokenNotStored: "No GitHub token is stored in SecretStorage.",
  githubTokenLegacyPlaintextFound:
    "The GitHub token was migrated to SecretStorage. A plaintext copy is still in settings.json.",
  githubTokenLegacyPlaintextOnly:
    "A plaintext GitHub token is stored in settings.json. It was not migrated to SecretStorage, so copy the value before removing it.",
  githubTokenRemoveLegacyPlaintext: "Remove plaintext copy",
  githubTokenLegacyPlaintextRemoved:
    "Removed the plaintext GitHub token from settings.json.",
  githubTokenLegacyPlaintextRemoveFailed:
    "Could not remove the plaintext copy. Please delete skillNinja.githubToken from settings.json manually.",
  githubTokenClearFailed:
    "Could not remove the GitHub token from SecretStorage. Reload VS Code and try again.",
  authWithGhCli: "Authenticate with gh CLI",
  ghAccountInvalid:
    'The credential for the active gh CLI account "{0}" cannot be used. Even if other accounts are signed in, this extension only uses the active one.',
  ghAccountRateLimited:
    'The active gh CLI account "{0}" hit the GitHub API rate limit. The token itself is still valid, so do not delete it.',
  ghSwitchAccountAction: 'Switch to "{0}" and retry',
  ghSwitchAccountConfirm:
    'This switches the active gh CLI account to "{0}". The change applies to every gh command that uses the stored github.com credential, not just VS Code. Continue?',
  ghSwitchAccountConfirmAction: "Switch",
  ghSwitchAccountSucceeded: 'Switched the active gh CLI account to "{0}".',
  ghSwitchAccountFailed:
    "Could not switch the gh CLI account. Run gh auth switch in a terminal.",
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
  localSkillActionUnavailable:
    "This item is not a local skill, so its instruction-file registration cannot be changed.",
  localSkillRegistrationFailed:
    "Could not update the registration state for {0}. The skill may be read-only, or the write failed.",
  skillStateUnavailable:
    "This item has no skill metadata, so its state cannot be explained.",
  createSkillPrompt: "Enter skill name",
  createSkillPlaceholder: "my-awesome-skill",
  skillCreated: "✅ {0} created",
  noLocalSkills: "No local skills found",
  instructionFileUpdatedOnSettingChange:
    "✅ AGENTS.md updated due to setting change",
  outputTargetsPickPlaceholder:
    "Choose where the skill list is written (unchecking removes the managed block and generated catalog)",
  outputTargetsNone: "No manageable output targets were found",
  outputTargetsFormatPlaceholder:
    "Pick a target to change its format (Esc to finish)",
  outputTargetsFormatFor: "Output format for {0}",
  outputTargetsUseDefault: "Follow the global default ({0})",
  outputTargetsAutoLoaded: "Always loaded by VS Code",
  outputTargetsShared: "{0} targets share this file",
  outputTargetsDisabledWarning:
    "Disable {0} target(s)? Their managed block and generated catalog will be removed. Your own text is kept.",
  outputTargetsDisableConfirm: "Remove and continue",
  outputTargetsApplied: "✅ Output targets updated ({0} enabled)",
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
  staleSourceIndexAgeDays: (days: number) =>
    localize("staleSourceIndexAgeDays", days),
  staleSourceIndexUpdating: () => localize("staleSourceIndexUpdating"),
  staleSourceIndexUpdated: (updated: number, total: number) =>
    localize("staleSourceIndexUpdated", updated, total),
  staleSourceIndexPartialFailed: (
    updated: number,
    failed: number,
    total: number,
    sources: string,
    reason: string,
    skipped: number,
  ) =>
    localize(
      "staleSourceIndexPartialFailed",
      updated,
      failed,
      total,
      sources,
      reason,
      skipped,
    ),
  sourceIndexSkillsUpdatedProgress: (count: number) =>
    localize("sourceIndexSkillsUpdatedProgress", count),
  sourceIndexNotIndexed: () => localize("sourceIndexNotIndexed"),
  sourceIndexRateLimitDeferred: (count: number, resetAt: string) =>
    localize("sourceIndexRateLimitDeferred", count, resetAt),
  sourceIndexRateLimitResumeStarted: (count: number) =>
    localize("sourceIndexRateLimitResumeStarted", count),
  sourceIndexRateLimitResumeNothing: () =>
    localize("sourceIndexRateLimitResumeNothing"),
  sourceIndexRateLimitResumeNotReady: (resetAt: string) =>
    localize("sourceIndexRateLimitResumeNotReady", resetAt),
  actionResumeNow: () => localize("actionResumeNow"),
  sourceIndexEmptyScanKept: (count: number) =>
    localize("sourceIndexEmptyScanKept", count),
  sourceIndexForeignScannerKept: (scanner: string) =>
    localize("sourceIndexForeignScannerKept", scanner),
  sourceIndexForeignScannerSkipped: (count: number, sources: string) =>
    localize("sourceIndexForeignScannerSkipped", String(count), sources),
  sourceIndexRepositoryIdentityChanged: (stored: number, scanned: number) =>
    localize("sourceIndexRepositoryIdentityChanged", stored, scanned),
  sourceIndexRepositoryIdentitySkipped: (sourceNames: string) =>
    localize("sourceIndexRepositoryIdentitySkipped", sourceNames),
  sourceIndexRateLimitStopped: (sourceId: string, remaining: number) =>
    localize("sourceIndexRateLimitStopped", sourceId, remaining),
  sourceIndexUpdated: (
    source: string,
    oldCount: number,
    newCount: number,
    diff: string,
  ) => localize("sourceIndexUpdated", source, oldCount, newCount, diff),
  githubRateLimitReason: () => localize("githubRateLimitReason"),
  githubRateLimitResetAt: (resetAt: string) =>
    localize("githubRateLimitResetAt", resetAt),
  githubSsoRequiredReason: () => localize("githubSsoRequiredReason"),
  githubClassicPatForbiddenReason: () =>
    localize("githubClassicPatForbiddenReason"),
  githubAuthRequiredReason: () => localize("githubAuthRequiredReason"),
  actionShowDetails: () => localize("actionShowDetails"),
  actionConfigureGitHubAuth: () => localize("actionConfigureGitHubAuth"),
  actionOpenGitHubSso: () => localize("actionOpenGitHubSso"),
  actionClearStoredGitHubToken: () => localize("actionClearStoredGitHubToken"),
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
  copyUrlUnavailable: () => localize("copyUrlUnavailable"),
  commandNeedsSkillSelection: () => localize("commandNeedsSkillSelection"),
  copyPathUnavailable: () => localize("copyPathUnavailable"),
  openInTerminalUnavailable: () => localize("openInTerminalUnavailable"),

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
  actionDontAskAgain: () => localize("actionDontAskAgain"),
  actionAddSourceRepo: () => localize("actionAddSourceRepo"),
  actionOpenGitHub: () => localize("actionOpenGitHub"),

  // 認証
  authRequired: () => localize("authRequired"),
  skillDownloadNotFoundNoAuth: (name: string) =>
    localize("skillDownloadNotFoundNoAuth", name),
  skillDownloadNotFoundWithAuth: (name: string) =>
    localize("skillDownloadNotFoundWithAuth", name),
  actionUpdateIndex: () => localize("actionUpdateIndex"),
  actionReportBug: () => localize("actionReportBug"),
  actionRetryInstall: () => localize("actionRetryInstall"),
  actionRemoveSkill: () => localize("actionRemoveSkill"),
  installIncomplete: (name: string) => localize("installIncomplete", name),
  installPartial: (name: string) => localize("installPartial", name),
  installTargetConflictPrompt: (
    folderName: string,
    existingSource: string,
    newSource: string,
  ) =>
    localize(
      "installTargetConflictPrompt",
      folderName,
      existingSource,
      newSource,
    ),
  installTargetConflictOverwrite: () =>
    localize("installTargetConflictOverwrite"),
  installTargetUnknownOwner: () => localize("installTargetUnknownOwner"),
  retryFailedInstallsAction: (count: number) =>
    localize("retryFailedInstallsAction", String(count)),
  retryingFailedInstallsTitle: () => localize("retryingFailedInstallsTitle"),
  retryingFailedInstalls: (name: string) =>
    localize("retryingFailedInstalls", name),
  retryFailedInstallsSummary: (succeeded: number, total: number) =>
    localize("retryFailedInstallsSummary", String(succeeded), String(total)),
  repairIncompleteNoTargets: () => localize("repairIncompleteNoTargets"),
  repairIncompleteSummary: (succeeded: number, total: number) =>
    localize("repairIncompleteSummary", String(succeeded), String(total)),
  repairIncompleteTitle: () => localize("repairIncompleteTitle"),
  installTargetConflictBlocked: (
    folderName: string,
    existingSource: string,
    newSource: string,
  ) =>
    localize(
      "installTargetConflictBlocked",
      folderName,
      existingSource,
      newSource,
    ),
  incompleteSkillsDetected: (count: number, names: string) =>
    localize("incompleteSkillsDetected", String(count), names),
  installSkippedUnsafeEntries: (name: string, count: number, names: string) =>
    localize("installSkippedUnsafeEntries", name, String(count), names),
  rootLevelSkillArtifactsDetected: (roots: string) =>
    localize("rootLevelSkillArtifactsDetected", roots),
  bulkUninstallSummary: (deleted: number, failed: number) =>
    failed > 0
      ? localize(
          "bulkUninstallSummaryWithFailures",
          String(deleted),
          String(failed),
        )
      : localize("bulkUninstallSummary", String(deleted)),
  openSettings: () => localize("openSettings"),
  authWithGhCli: () => localize("authWithGhCli"),
  ghAccountInvalid: (login: string) => localize("ghAccountInvalid", login),
  ghAccountRateLimited: (login: string) =>
    localize("ghAccountRateLimited", login),
  ghSwitchAccountAction: (login: string) =>
    localize("ghSwitchAccountAction", login),
  ghSwitchAccountConfirm: (login: string) =>
    localize("ghSwitchAccountConfirm", login),
  ghSwitchAccountConfirmAction: () => localize("ghSwitchAccountConfirmAction"),
  ghSwitchAccountSucceeded: (login: string) =>
    localize("ghSwitchAccountSucceeded", login),
  ghSwitchAccountFailed: () => localize("ghSwitchAccountFailed"),

  // 初期化
  resetSettingsTitle: () => localize("resetSettingsTitle"),
  resetSettingsPrompt: () => localize("resetSettingsPrompt"),
  resetCache: () => localize("resetCache"),
  resetAllSettings: () => localize("resetAllSettings"),
  resetAllIncludingToken: () => localize("resetAllIncludingToken"),
  resetComplete: () => localize("resetComplete"),
  githubTokenCleared: () => localize("githubTokenCleared"),
  githubTokenNotStored: () => localize("githubTokenNotStored"),
  githubTokenLegacyPlaintextFound: () =>
    localize("githubTokenLegacyPlaintextFound"),
  githubTokenLegacyPlaintextOnly: () =>
    localize("githubTokenLegacyPlaintextOnly"),
  githubTokenRemoveLegacyPlaintext: () =>
    localize("githubTokenRemoveLegacyPlaintext"),
  githubTokenLegacyPlaintextRemoved: () =>
    localize("githubTokenLegacyPlaintextRemoved"),
  githubTokenLegacyPlaintextRemoveFailed: () =>
    localize("githubTokenLegacyPlaintextRemoveFailed"),
  githubTokenClearFailed: () => localize("githubTokenClearFailed"),

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
  localSkillActionUnavailable: () => localize("localSkillActionUnavailable"),
  localSkillRegistrationFailed: (name: string) =>
    localize("localSkillRegistrationFailed", name),
  skillStateUnavailable: () => localize("skillStateUnavailable"),
  createSkillPrompt: () => localize("createSkillPrompt"),
  createSkillPlaceholder: () => localize("createSkillPlaceholder"),
  skillCreated: (name: string) => localize("skillCreated", name),
  noLocalSkills: () => localize("noLocalSkills"),

  // 設定変更時の自動更新
  instructionFileUpdatedOnSettingChange: () =>
    localize("instructionFileUpdatedOnSettingChange"),

  // 出力ターゲット設定 UI
  outputTargetsPickPlaceholder: () => localize("outputTargetsPickPlaceholder"),
  outputTargetsNone: () => localize("outputTargetsNone"),
  outputTargetsFormatPlaceholder: () =>
    localize("outputTargetsFormatPlaceholder"),
  outputTargetsFormatFor: (target: string) =>
    localize("outputTargetsFormatFor", target),
  outputTargetsUseDefault: (format: string) =>
    localize("outputTargetsUseDefault", format),
  outputTargetsAutoLoaded: () => localize("outputTargetsAutoLoaded"),
  outputTargetsShared: (count: string) =>
    localize("outputTargetsShared", count),
  outputTargetsDisabledWarning: (count: string) =>
    localize("outputTargetsDisabledWarning", count),
  outputTargetsDisableConfirm: () => localize("outputTargetsDisableConfirm"),
  outputTargetsApplied: (count: string) =>
    localize("outputTargetsApplied", count),
};

export default messages;
