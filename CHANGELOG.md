# Changelog

All notable changes to the "Agent Skills Ninja" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.24] - 2026-06-14

### Fixed

- 🧭 **No-workspace User/Global Skills View** - User/global, installed-extension, and built-in skills now remain visible and expandable even when no workspace folder is open / ワークスペースフォルダーを開いていない状態でも、user/global、インストール済み拡張機能、Built-in Skills のスキルを表示・展開できるよう修正
- 📂 **No-workspace Skill Open Actions** - Read-only and user/global skills with known `SKILL.md` paths can now open their file or folder without requiring a workspace / 既知の `SKILL.md` パスを持つ read-only / user-global スキルは、ワークスペースなしでもファイルやフォルダーを開けるよう修正
- 🔄 **Workspace Retargeting Refresh** - Skill views now retarget their workspace context when folders are opened or closed after activation, preventing stale empty views / 起動後にフォルダーを開閉した場合も skill view が現在の workspace context に追随し、古い空表示に固定されないよう修正
- ⚙️ **Installability Audit Throughput** - The release installability audit now checks skills concurrently, keeping the raw-path release gate practical for the bundled preset index / release 用 installability audit が skill path を並列確認するようになり、bundled preset index の raw-path gate を現実的な時間で実行できるよう改善
- 🧹 **Preset Skill Index Cleanup** - Pruned one stale Compound Engineering entry and refreshed the bundled skill index to `v1.21.0` with 1379 installable skills / Compound Engineering の stale entry を 1 件整理し、bundled skill index を `v1.21.0`・1379 件の installable な状態へ更新

### Added

- 🧪 **No-workspace Tree Regression Tests** - Added regression coverage for user/global, installed-extension, and built-in skill tree expansion without an open workspace / ワークスペース未オープン時の user/global、インストール済み拡張機能、Built-in Skills の tree 展開を守る回帰テストを追加

## [0.9.23] - 2026-06-11

### Fixed

- 🧭 **Batch Reinstall Missing-Index Recovery** - Startup and batch reinstall recovery now update only the affected source when it can be resolved, skip still-missing skills instead of failing the whole batch, and allow upstream-removed skills to be disabled for future reinstall checks / 起動時と一括再インストールの missing-index 回復で、解決可能な場合は対象 source だけを更新し、更新後も見つからない skill は全体失敗ではなくスキップし、上流削除済み skill は今後の再インストール確認から除外できるよう改善
- 🧩 **Legacy Unknown Metadata Handling** - Legacy `source: unknown` skills without `remotePath` no longer make batch reinstall roots look reinstallable by themselves while keeping individual name fallback lookup available / `remotePath` のない legacy `source: unknown` skill は、個別の名前 fallback lookup は維持しつつ、一括再インストール root を単独で reinstallable に見せないよう修正

### Added

- 🧪 **Reinstall Suppression Regression Tests** - Added regression coverage for `reinstallDisabled`, unknown legacy metadata, and root action visibility with disabled reinstall checks / `reinstallDisabled`、unknown legacy metadata、再インストール確認無効時の root action 表示を守る回帰テストを追加

## [0.9.22] - 2026-06-11

### Fixed

- 🧭 **Root Reinstall Action Resolution** - Fixed root-scoped remote reinstall actions so writable skill-root rows pass their `skillRoot` even when the tree item has no skill payload / root 単位のリモート再インストールで、skill payload を持たない skill-root 行でも `skillRoot` を正しく渡すよう修正
- 🧹 **Preset Skill Index Cleanup** - Pruned one stale MicrosoftDocs entry and refreshed the bundled skill index to `v1.20.0` with 1380 installable skills / MicrosoftDocs の stale entry を 1 件整理し、bundled skill index を `v1.20.0`・1380 件の installable な状態へ更新
- 🔒 **Dependency Audit Fix** - Updated the lockfile to resolve the `shell-quote` npm audit finding through `npm audit fix` / `npm audit fix` により `shell-quote` の npm audit 指摘を解消するよう lockfile を更新

### Added

- 🧪 **Root Tree Item Resolution Tests** - Added regression coverage for resolving skill roots from root group tree items and skill item payloads / root group TreeItem と skill item payload からの skill root 解決を守る回帰テストを追加

## [0.9.21] - 2026-05-28

### Fixed

- 🧭 **Source-aware Reinstall Recovery** - Reinstall flows now normalize installed skill metadata at install time and prefer updating only the affected source when missing index entries can be tied to a single source, instead of always refreshing every source / install 時点で installed skill metadata を正規化するようにし、reinstall 中の missing index が単一 source に結びつく場合は全 source ではなくその source だけを更新するよう改善
- ⚠️ **Partial Failure Reinstall Reporting** - Batch reinstall flows now surface succeeded/failed counts in warnings instead of ending with a full-success message after mixed outcomes / 一括再インストール系で mixed outcome の後に成功前提メッセージだけが残らないよう、成功件数 / 失敗件数を warning で表示するよう改善
- 🧾 **Reinstall Docs Sync** - Updated README and README_ja to describe source-aware missing-index recovery, root-level regenerate/reinstall actions, and partial failure warnings consistently with the extension UI / source-aware な missing index 回復、ルート単位の再生成 / 再インストール導線、partial failure warning を README / README_ja へ反映し、実際の UI と説明を一致させるよう修正

### Added

- 🧪 **Installed Metadata Normalization Tests** - Added regression coverage for install-time source normalization, affected-source resolution, and batch outcome summaries used by reinstall flows / reinstall 系で使う install-time source 正規化、affected-source 判定、batch outcome 集計の回帰テストを追加

## [0.9.20] - 2026-05-27

### Changed

- 🎛️ **Root Inline Maintenance Actions** - Writable skill-root rows now expose inline skill-output regeneration and root-scoped remote reinstall actions, and the related UI labels were clarified from generic "Refresh" / "Update Instruction" wording to explicit "Refresh View" / "Update Skill Output" text / 書き込み可能な skill root 行の右端にスキル出力再生成とルート単位のリモート再インストール導線を追加し、関連 UI ラベルも曖昧な「更新」「インストラクション更新」から「ビューを更新」「スキル出力を更新」へ明確化

### Fixed

- 🧭 **Root Picker Label Clarity** - Managed-root QuickPick and maintenance notifications now use the same concise root labels shown in the tree (for example GitHub Copilot Home / Claude Home / Global Agent Home) instead of repeating generic scope names / managed root を選ぶ QuickPick と各メンテナンス通知で、汎用的な scope 名の繰り返しではなく、ツリー表示と同じ短い root 名（例: GitHub Copilot Home / Claude Home / Global Agent Home）を使うよう改善
- 🌐 **Localized README Command Names** - Updated README_ja command-palette and quick-start examples to use the actual localized command/action labels, preventing Japanese guidance from drifting away from the extension UI / README_ja のコマンドパレット表とクイックスタート例を実際のローカライズ済み command/action 名に合わせ、日本語ガイダンスが拡張 UI からずれないよう修正

### Added

- 🧪 **Root Wording Contract Coverage** - Added README contract coverage for root-level maintenance wording and localized README command labels so future UI/docs drift is caught before release / ルート単位メンテナンスの wording とローカライズ済み README command 表記を守る契約テストを追加し、将来の UI/docs ずれを release 前に検知できるよう追加

## [0.9.19] - 2026-05-26

### Added

- 🧪 **Compressed Catalog Coexistence Coverage** - Expanded the coexistence regression fixture so catalog cleanup on defer is verified against the real compressed `ref` catalog shape, preventing stale `agent-ninja` blocks from lingering beside Resource NINJA catalog sections in `.github/skills/README.md` / coexistence 回帰 fixture を実際の compressed `ref` catalog 形式に広げ、defer 時の catalog cleanup を `.github/skills/README.md` の実形に近い形で検証するよう改善し、Resource NINJA の catalog セクション横に古い `agent-ninja` ブロックが残る再発を防ぐよう追加

## [0.9.18] - 2026-05-26

### Fixed

- 🧩 **Remote Skill Installability Recovery** - Remote installs now recover owner/repo/branch/path from `rawUrl` or GitHub folder/file URLs even when the source is not yet in the local index, so ad-hoc installs such as `local-media-transcription` no longer fall back to a placeholder `SKILL.md` / local index に source が未登録でも `rawUrl` や GitHub のフォルダ / ファイル URL から owner/repo/branch/path を復元して実体を取得するよう改善し、`local-media-transcription` のような ad-hoc install がプレースホルダー `SKILL.md` に落ちないよう修正
- 🧹 **Preset Skill Index Cleanup** - Pruned 45 stale preset entries whose upstream `SKILL.md` paths no longer exist and refreshed the bundled skill index to `v1.19.0` with 1381 installable skills / upstream の `SKILL.md` パスが消えていた stale なプリセット entry を 45 件整理し、bundled skill index を `v1.19.0`・1381 件の installable な状態へ更新

### Added

- 🧪 **Installability Audit Guardrails** - Added an installability audit script plus local regression coverage, wired the audit regression into `npm test`, and documented `node scripts/audit-skill-installability.js --raw-only` as a release gate to prevent shipping stale preset entries again / installability 監査スクリプトとローカル回帰テストを追加し、その回帰を `npm test` に組み込み、さらに `node scripts/audit-skill-installability.js --raw-only` を release gate として手順化して stale なプリセット entry の再出荷を防ぐよう追加

## [0.9.17] - 2026-05-23

### Changed

- 👀 **Built-in Skills Default Visibility** - Built-in read-only skills are now shown by default in the user/global view, and the empty-state guidance now points users to Settings instead of a one-off reveal action / user/global view で Built-in の読み取り専用スキルを既定表示に変更し、empty-state の案内も一回限りの表示アクションではなく Settings 導線へ更新

### Fixed

- 🧹 **Deferred Ref Catalog Cleanup** - When Agent Resources Ninja owns coexistence, Skill NINJA now removes its stale `agent-ninja` catalog block from the ref catalog instead of leaving duplicate sections in `.github/skills/README.md` / Agent Resources Ninja が coexistence owner のとき、Skill NINJA が ref catalog に残していた古い `agent-ninja` ブロックを除去するようにし、`.github/skills/README.md` に重複セクションが残らないよう修正
- 🏷️ **Metadata-less Skill Source Handling** - Workspace and user/global skills without `.skill-meta.json` are now treated as local skills instead of `unknown`, preventing repeated startup warnings and incorrect remote-index expectations for personal skills like `~/.copilot/skills/*` / `.skill-meta.json` を持たない workspace / user/global スキルを `unknown` ではなく local skill として扱うよう改善し、`~/.copilot/skills/*` のような personal skill で起動時 warning が繰り返し出たり remote index 前提で誤解される問題を防止
- 🚫 **Read-only Index Warning Noise** - Startup index-mismatch warnings and upgrade auto-update prompts now ignore read-only managed roots such as installed-extension and built-in skills, reducing false "not found in index" notifications in coexistence-heavy environments / 起動時の index 不整合 warning とアップグレード時の自動更新判定で、installed-extension / built-in などの読み取り専用 root を除外するよう改善し、共存環境での誤った「インデックスに見つかりません」通知を抑制

### Added

- 🧪 **Catalog and Metadata Fallback Regression Tests** - Added regression coverage for ref catalog cleanup on defer, read-only / unknown-source index-check filtering, and metadata-less skill fallback behavior, and wired the new coverage into `npm test` / defer 時の ref catalog cleanup、read-only / unknown-source の index-check 除外、metadata-less skill fallback の回帰テストを追加し、新しい検証を `npm test` に組み込み

## [0.9.16] - 2026-05-20

### Fixed

- ⏱️ **Initial Sync Registration Stability** - Deferred instruction-file rewrites until the initial coexistence and metadata sync settles, so startup no longer flips between pending / unregistered states or rewrites the wrong owner block during activation races / 初回の coexistence と metadata 同期が落ち着くまで instruction file の再書き込みを保留するよう改善し、起動時の pending / 未登録の揺れや activation race 中の誤 owner block 書き換えを防止
- 🛑 **Shutdown-Safe Instruction Updates** - Guarded ownership watchers, metadata refresh flows, and SKILL.md save handlers against stale extension context during deactivate, preventing late instruction writes after the extension starts shutting down / ownership watcher、metadata refresh、SKILL.md 保存ハンドラが deactivate 中の古い extension context で動かないよう保護し、終了開始後に instruction file へ遅延書き込みしないよう修正
- 🔍 **Skill State Diagnostics** - Added richer managed-skill diagnostics including registration source, metadata path, remote path, package provenance, and coexistence owner details so registration-state issues can be explained directly from the tree view / registration source、metadata path、remote path、package provenance、coexistence owner を含む managed skill 診断情報を追加し、登録状態の問題を tree view から直接説明できるよう改善

### Added

- 🧪 **Pending-State Regression Coverage** - Added regression coverage for the temporary pending registration state shown during initial sync and kept the diagnostic command documented in both READMEs / 初期同期中に一時表示される pending 登録状態の回帰テストを追加し、新しい診断コマンドも英日 README に反映

## [0.9.15] - 2026-05-19

### Fixed

- 🤝 **Cross-Extension Registration State** - Skill NINJA now treats shared `.skill-meta.json` files as part of the registration-state source of truth in coexistence mode, so remote skills installed via Agent Resources Ninja continue to appear as managed skills and keep reinstall / unregister actions / 共存モードで shared `.skill-meta.json` を登録状態の SSOT の一部として扱うよう改善し、Agent Resources Ninja 経由で入れた remote skill でも Skill NINJA 側で managed skill として表示され、再インストールや登録解除の導線を維持するよう修正
- 🔗 **Remote Path Index Matching** - Installed-skill index checks now fall back to remote repository path matching in addition to name/source matching, preventing false "not found in index" warnings for cross-extension installs that share the same remote skill but different metadata names or sources / インストール済み skill の index 照合で name/source 一致に加えて remote repository path 一致へフォールバックするよう改善し、同じ remote skill を共有していても metadata の名前や source が異なる cross-extension install で「インデックスに見つかりません」warning が出る誤検知を抑制

### Added

- 🧪 **Cross-Extension Metadata Regression Tests** - Added regression coverage for metadata-based registration recovery and remotePath-based installed-skill index matching, and kept those checks in the standard `npm test` flow / metadata ベースの登録状態復元と remotePath ベースの installed-skill index 照合を守る回帰テストを追加し、標準の `npm test` フローで継続検証するよう追加

## [0.9.14] - 2026-05-18

### Fixed

- 🔄 **Fresh Index Reads for Chat and MCP** - Chat participant and MCP tools now reload the latest skill index on each request instead of holding a long-lived in-memory copy, so newly updated skills appear immediately after index refreshes / Chat participant と MCP tools が長寿命のメモリキャッシュを持たず、各リクエスト時に最新の skill index を再読込するよう改善し、index 更新直後の新しいスキルがすぐ反映されるよう修正
- 🧭 **Managed Output Failure Transparency** - Opening managed skill output now distinguishes missing files from open failures, logs the underlying error, and shows a warning instead of silently falling through ambiguous create/fallback paths / managed skill output を開く導線で、ファイル未生成と open failure を区別し、原因ログと warning を出すよう改善して、曖昧な create / fallback 導線へ silent に落ちないよう修正
- 🔐 **GitHub 403 Auth Guidance** - GitHub directory fetch failures no longer describe every 403 as just a rate limit; the message now explains unauthenticated limits, token issues, and auth-required repositories/searches more clearly / GitHub directory fetch の 403 を単純な rate limit 固定で扱わず、未認証上限、トークン不備、認証必須の repo / search の可能性を分かりやすく案内するよう修正
- 🔎 **Search Result Limit Guidance** - Skill search now exposes when results are capped at 100 items and surfaces that state in search / preview quick-picks, so users know to refine broad queries instead of assuming matches are missing / スキル検索が 100 件で打ち切られた状態を返すようにし、search / preview の QuickPick でもその状態を案内して、広すぎるクエリ時に「候補が消えた」と誤解しにくいよう修正

### Added

- 🧪 **Search/Auth UX Regression Tests** - Added regression coverage for truncated search-result guidance and GitHub 403 authentication messaging, and wired the new test into `npm test` / 検索結果打ち切りガイダンスと GitHub 403 認証メッセージの回帰テストを追加し、`npm test` に組み込み

## [0.9.13] - 2026-05-18

### Changed

- 🎯 **Deterministic User/Global Output Default** - The user/global view now prefers VS Code user customizations first, then Copilot home, Claude home, and finally the global agent home when choosing the default writable output root / user/global view の既定出力 root は、VS Code ユーザーカスタマイズを最優先にし、次に Copilot home、Claude home、最後に global agent home の順で選ぶよう明示化しました

### Fixed

- 🎯 **View-Scoped Skill Output Opening** - The workspace view now opens the workspace output directly, and the user/global view opens the default writable user/global output directly, so users are no longer forced through the all-roots picker from view toolbar and empty-state flows / workspace view は workspace output を直接開き、user/global view は既定の書き込み可能な user/global output を直接開くよう改善し、view のツールバーと empty-state から毎回 all-roots picker を通らなくてよくなりました

## [0.9.12] - 2026-05-18

### Fixed

- 🧭 **Ref Output Open Flow** - The toolbar / welcome action now opens the linked catalog in `ref` mode instead of always pushing users through AGENTS.md first, and falls back to the instruction file only when the catalog is not available / ツールバーと empty-state の導線が `ref` モードでは AGENTS.md 固定ではなくリンク先 catalog を直接開くよう改善し、catalog 未生成時だけ instruction file にフォールバックするよう修正しました
- 🏷️ **Skill Output Wording** - Renamed the action label from "Open Instruction File" to "Open Skill Output" so the UI matches what users actually get in `ref` mode / `ref` モード時の実挙動に合わせてアクション名を "Open Instruction File" から "Open Skill Output" / 「スキル出力を開く」へ変更しました
- 🧭 **Skill Output Scope Picker Copy** - Updated the scope picker prompt to say "skill output" instead of "instruction file" so the last remaining quick-pick guidance matches the ref-first UI / スコープ選択の QuickPick 文言も "instruction file" ではなく "skill output" 基準へ更新し、ref-first UI に合わせて最後に残っていた案内文のズレを解消しました
- 🎯 **View-Specific Default Output Roots** - The workspace view now opens the workspace output directly, and the user/global view now opens the default writable user/global output directly; only the generic command keeps the all-roots picker / workspace view は workspace output を直接開き、user/global view は既定の書き込み可能な user/global output を直接開くよう改善し、全 root から選ぶ QuickPick は汎用コマンド側だけに残しました

## [0.9.11] - 2026-05-18

### Added

- 🔗 **Ref Catalog Format Setting** - Added `skillNinja.refCatalogFormat` so `ref` can keep AGENTS.md lightweight while choosing `full`, `compact`, or `legacy` inside the linked catalog / `ref` で AGENTS.md を軽量に保ちながら、リンク先 catalog 内の形式を `full` / `compact` / `legacy` から選べる `skillNinja.refCatalogFormat` を追加

### Fixed

- 🧭 **Ref Settings Auto-Update Watchers** - Instruction files now regenerate when `skillNinja.refCatalogPath` or `skillNinja.refCatalogFormat` changes, so ref catalog path/detail updates no longer require a manual refresh / `skillNinja.refCatalogPath` と `skillNinja.refCatalogFormat` の変更時にも instruction file が自動再生成されるよう改善し、ref catalog の出力先や詳細形式を変えた後に手動更新が不要になりました
- ♻️ **Output Format Migration Across Scopes** - Legacy `outputFormat` values are now migrated in global, workspace, and workspace-folder scopes, so older settings like `compressed-index` no longer survive in workspace settings after upgrade / 旧 `outputFormat` 値の移行処理を global / workspace / workspace-folder の各スコープに拡張し、`compressed-index` などの旧設定がアップグレード後も workspace 設定に残り続けないよう修正しました
- 📘 **Output Format Docs Alignment** - README and Japanese README now include `ref` in the Output Format Details table and correctly describe it as the default instead of `full` / README と日本語 README の Output Format Details 表に `ref` を追加し、既定値が `full` ではなく `ref` であることを正しく反映しました

## [0.9.10] - 2026-05-18

### Changed

- 🔗 **Ref Entry IMPORTANT Prompt** - Added the lightweight IMPORTANT routing prompt to the `ref` instruction-file block while keeping the detailed skill catalog split into a separate file / `ref` の instruction-file block に軽量な IMPORTANT routing prompt を追加しつつ、詳細な skill catalog は別ファイル分離のまま維持

## [0.9.9] - 2026-05-18

### Changed

- 🔗 **Ref Output Format Default** - Switched the default output format to `ref`, which keeps AGENTS.md / instruction files as lightweight references and writes the detailed skill catalog to a separate Markdown file for better always-loaded context hygiene / 既定の出力フォーマットを `ref` に変更し、AGENTS.md / instruction file は軽量な参照に保ちつつ、詳細な skill catalog は別 Markdown ファイルへ出力するよう改善

### Fixed

- 🧭 **Ref Catalog Relative Links** - The separate `ref` catalog now computes skill links relative to the catalog file itself instead of the instruction file, so linked `SKILL.md` paths stay correct after splitting the detailed table / 分離された `ref` catalog 内の `SKILL.md` リンクを instruction file 基準ではなく catalog ファイル基準で計算するよう修正し、詳細テーブル分離後もリンクが正しく維持されるよう改善

### Added

- 🧪 **Ref Format Regression Coverage** - Added regression tests for lightweight instruction output, catalog generation, and relative path handling in `ref` mode / `ref` モードの軽量 instruction 出力、catalog 生成、相対パス解決を守る回帰テストを追加

## [0.9.8] - 2026-05-17

### Fixed

- 🪟 **Windows Absolute-Path Skill Install** - Resolved skill install failures when `skillNinja.skillsDirectory` (or the sibling `resourceNinja.resourcesDirectory` fallback) was set to a Windows absolute path; resolution now goes through a shared helper that uses `Uri.file(...)` instead of joining to `workspaceUri` / `skillNinja.skillsDirectory`（または共存時に参照される `resourceNinja.resourcesDirectory`）に Windows の絶対パスが設定されていてもインストールが失敗しないよう、`Uri.file(...)` ベースの共有ヘルパー経由で解決するよう修正
- 🤝 **Coexistence Registration Detection** - Managed registration status now recognizes both shared `agent-ninja` coexistence markers and legacy `skill-ninja` markers, so installed skills no longer appear as "未登録 / Not registered" while Resource NINJA owns the shared block / 登録状態の判定で shared `agent-ninja` マーカーと legacy `skill-ninja` マーカーの両方を見るようにし、Resource NINJA が shared block を所有している共存状態でもインストール済みスキルが「未登録 / Not registered」と表示されないよう修正
- 🧹 **Instruction Cleanup Ownership Guard** - Setting changes now preserve the shared `agent-ninja` block while the sibling extension owns coexistence, instead of deleting the shared block during old-file cleanup; custom absolute instruction paths are resolved via configured-path helpers, and previously managed instruction paths are remembered for stale cleanup across sessions / 設定変更時の旧ファイル cleanup で sibling 拡張が所有する shared `agent-ninja` block を消さないようにし、`customInstructionPath` の絶対パスも configured-path helper 経由で正しく解決、さらに以前管理していた instruction path を記憶してセッション跨ぎの stale cleanup にも対応

### Added

- 🧪 **Managed Registration Regression Tests** - Added shared/legacy marker extraction tests and round-trip helper tests covering trailing slashes, back slashes, `./` prefixes, and out-of-block matches in `scripts/test-local-skill-scanner.js` / shared / legacy marker 抽出と、末尾スラッシュ / バックスラッシュ / `./` 接頭辞 / マーカー外一致を含む round-trip helper を `scripts/test-local-skill-scanner.js` に追加し、回帰テストで固定

## [0.9.7] - 2026-05-17

### Added

- 🧪 **Shared Source Regression Guards** - Added regression coverage for shared `sources.json` bootstrap, stale-source pruning, source sync, and runtime command wiring / 共有 `sources.json` の bootstrap、不要 source の prune、source 同期、runtime command 導線を守る回帰テストを追加

### Changed

- 🔄 **Shared Source Command Refresh** - Remote source commands now reload the latest shared-source-aware index before add/remove/update flows so coexistence stays in sync with the sibling extension / Remote source command が add / remove / update 前に shared source 対応の最新 index を再読込するようになり、姉妹拡張との共存時も source 一覧がずれにくくなりました
- 📝 **Shared Source SSOT Guidance** - Updated localized settings copy and README guidance to describe `~/.agent-ninja/sources.json` as a source-list-only SSOT / ローカライズ済み設定文言と README を更新し、`~/.agent-ninja/sources.json` が source list 専用の SSOT であることを明確化

### Fixed

- 🧭 **skill.md Path Normalization** - Normalized lower-case `skill.md` and repository-root skill paths so remote scan metadata and license extraction resolve the correct skill root / lower-case `skill.md` とリポジトリ直下の skill path を正規化し、remote scan のメタデータと license 抽出が正しい skill root を解決するよう修正
- 🤝 **Shared Source Coexistence Sync** - Synced Skill NINJA source persistence with the shared manifest store, including lock-protected writes for coexistence with Agent Resources Ninja / Agent Resources Ninja との共存向けに、lock 付き書き込みで shared manifest store へ source 永続化を同期するよう改善

## [0.9.6] - 2026-05-17

### Added

- 🧩 **Installed Extension Skill Discovery** - Added a read-only `Installed Extensions` scope that discovers bundled `SKILL.md` folders from installed VS Code extensions and groups them by extension before variant/root labels / インストール済み VS Code 拡張に同梱された `SKILL.md` フォルダを検出し、拡張ごと → variant/root ごとに整理して表示する読み取り専用 `Installed Extensions` スコープを追加
- 🧪 **Extension Scope Regression Guards** - Added regression tests for extension skill root discovery, provider grouping, read-only menu boundaries, welcome copy, and bundled/self-extension exclusion / extension skill root の検出、provider grouping、読み取り専用メニュー境界、welcome 文言、bundled / 自拡張の除外を守る回帰テストを追加

### Changed

- 📝 **User / Global View Guidance** - Updated README, localized setting help, and empty-state messaging to explain the difference between writable user/global roots, installed extension skills, and optional Built-in Skills / README、ローカライズ済み設定説明、empty-state 文言を更新し、書き込み可能な user/global root、インストール済み拡張スキル、任意表示の Built-in Skills の違いを明確化

### Fixed

- 🧭 **Azure Extension Skill Visibility** - Added `resources/skills` and `resources/prompts/skills` discovery so Azure-style packaged skill layouts appear in the new extension scope / `resources/skills` と `resources/prompts/skills` を探索対象に追加し、Azure 系の同梱 skill 配置が新しい extension scope に表示されるよう修正
- 🛡️ **Read-Only Action Boundaries** - Kept installed extension skills out of uninstall/reinstall/register flows while still allowing open, copy path, and terminal navigation actions / インストール済み拡張スキルを uninstall / reinstall / register の対象外に保ちつつ、open、copy path、terminal 導線は利用できるよう調整

## [0.9.5] - 2026-05-15

### Added

- 🧪 **Installed Skill Source Guards** - Added regression coverage for local, legacy unknown, and known remote installed-skill source handling / local、legacy unknown、known remote のインストール済みスキル source 判定を守る回帰テストを追加

### Fixed

- 🛡️ **Local Skill Index Warnings** - Excluded Resource Ninja managed local skills from remote skill-index missing warnings and remote reinstall flows / Resource Ninja が管理するローカルスキルを remote skill-index の欠落警告と remote 再インストール flow から除外
- 🔄 **Upgrade Auto-Update Scope** - Kept extension-upgrade auto-update limited to skills with known remote sources while preserving legacy `unknown` metadata name fallback for manual reinstall / 拡張機能アップグレード時の自動更新対象を known remote source のスキルに限定しつつ、manual reinstall では legacy `unknown` metadata の name fallback を維持

### Changed

- 📝 **Coexistence Documentation** - Documented how local workspace skills managed by Resource Ninja are displayed without being treated as missing remote index entries / Resource Ninja 管理のローカル workspace skill が表示対象のまま remote index 欠落扱いにならないことを README に明記

## [0.9.4] - 2026-05-13

### Added

- 🧪 **Browse Install Regression Guards** - Added manifest/README/source contract checks to keep Remote Skills double-click install behavior, workspace-default targeting, and localized bundle command titles stable / Remote Skills のダブルクリックインストール挙動、workspace 既定ターゲット、bundle コマンドのローカライズを守る manifest / README / source 契約テストを追加

### Changed

- 📝 **Browse Install UX Guidance** - Updated README and settings copy to explain that Remote Skills install to the workspace skill root by default on double-click, while inline Install keeps the scope picker flow / Remote Skills はダブルクリックで既定の workspace skill root に入り、inline Install はスコープ選択用であることが分かるよう README と設定文言を更新

### Fixed

- 🌐 **Install Bundle Localization** - Localized the Install Bundle command so Japanese UI no longer shows a hardcoded English label / Install Bundle コマンドをローカライズし、日本語 UI で英語直書きラベルが出ないよう修正
- 🧹 **Local Artifact Hygiene** - Ignored local compile/test capture logs and backup files from both Git tracking and VSIX packaging to keep release artifacts clean / ローカルの compile/test ログとバックアップファイルを Git と VSIX の両方から除外し、リリース成果物に混入しないよう整理

## [0.9.3] - 2026-05-12

### Fixed

- ✨ **Built-in Label Consistency** - Normalized the remaining built-in fallback/status wording to the `Built-in Skills` naming so UI labels no longer mix `Built-ins` and `Built-in Skills` / 残っていた built-in fallback・status 文言を `Built-in Skills` 表記に統一し、UI 上で `Built-ins` と `Built-in Skills` が混在しないよう調整

## [0.9.2] - 2026-05-12

### Changed

- 🌐 **Built-in Wording in Japanese UI** - Switched Japanese UI labels from 「組み込み」 wording to the English-style "Built-in" / "Built-in Skills" naming for a cleaner product feel / 日本語 UI の「組み込み」表記を、よりプロダクト寄りの "Built-in" / "Built-in Skills" 表記へ変更

### Fixed

- 🧭 **Session Skills Grouping** - Grouped Session Skills under the VS Code built-in provider instead of showing Sessions as a separate top-level provider / Session Skills を独立した Sessions provider ではなく、VS Code built-in provider 配下としてグルーピングするよう修正

## [0.9.1] - 2026-05-12

### Changed

- 🧹 **Built-in Skills Display** - Consolidated versioned Copilot Package directories to show only the latest per channel, grouped built-in skills by provider/origin before variant/root labels, replaced ugly version-number labels with clean source-based names, and removed redundant "Built-ins" suffix from child group labels / バージョン違いの Copilot Package ディレクトリをチャネルごとに最新のみ表示に統合し、組み込みスキルを provider/origin → variant/root の順に整理、バージョン番号ラベルをソースベースの名前に置換し、子グループの冗長な「組み込み」接尾辞を除去

## [0.9.0] - 2026-05-12

### Added

- 🤝 **Agent Ninja Coexistence v3.1** - Added exports API based ownership handoff with Agent Resources Ninja so both extensions maintain a single shared `agent-ninja` block / Agent Resources Ninja との exports API ベースの owner handoff を追加し、両拡張が単一の `agent-ninja` ブロックを維持するようにしました
- 🧪 **Coexistence Regression Guards** - Added unit and integration coverage for ownership decisions, legacy marker migration, mixed-version safety, and filesystem-backed AGENTS.md updates / owner 判定、legacy marker migration、mixed-version safety、実ファイル AGENTS.md 更新を守る unit / integration テストを追加

### Changed

- 📦 **VSIX Package Slimming** - Excluded README demo media from the VSIX and rely on Marketplace repository URL resolution, reducing local package size from ~15 MB to ~176 KB / README の demo media を VSIX から除外し Marketplace の repository URL 解決に任せることで、ローカルパッケージサイズを約 15 MB から約 176 KB に削減
- 🔗 **GitHub URL Resolution** - Centralized GitHub content/raw URL generation and branch resolution for preview and command flows / preview と command flow の GitHub content/raw URL 生成と branch 解決を共通化しました
- 📝 **Coexistence Documentation** - Documented standalone `resourceNinja.kindsExcluded` behavior after uninstalling Skill Ninja in both README variants and instructions / Skill Ninja アンインストール後の standalone `resourceNinja.kindsExcluded` 挙動を英日 README と instructions に明記

### Fixed

- 🛡️ **Mixed-Version Safety** - Kept Skill Ninja safely deferred when the sibling extension is installed but does not expose the v3.1 exports API or fails activation / sibling extension が v3.1 exports API を公開しない、または activation に失敗する場合でも Skill Ninja が安全に defer するよう保護
- 🧹 **Coexistence Cleanup** - Removed dead compatibility helpers and pinned protocol constants in regression tests to prevent contract drift / 未使用の互換 helper を削除し、protocol constants を回帰テストで固定して contract drift を防止

## [0.8.28] - 2026-05-11

### Added

- 🧪 **Welcome UX Regression Guards** - Added regression coverage for empty-state welcome content, title-bar actions, and Japanese root label localization / 空状態 welcome 文言、title bar 導線、日本語 root label のローカライズを守る回帰テストを追加

### Changed

- 🧭 **Guided Skill Views** - Added welcome actions and consistent create/settings shortcuts across Installed, User / Global, and Remote skill views / Installed・User / Global・Remote の各 skill view に welcome actions と create/settings の共通導線を追加
- 🌐 **Localized Root Labels** - Localized workspace and user/global root labels for Japanese UI and aligned related Japanese help text / 日本語 UI 向けに workspace / user-global root label をローカライズし、関連する日本語ヘルプ表記も整備

### Fixed

- 👁️ **Built-in Toggle Visibility** - Show Built-in Skills in the title bar now appears only while built-in skills are hidden / title bar の組み込みスキル表示コマンドが、built-in skills 未表示時だけ出るよう修正

## [0.8.27] - 2026-05-11

### Added

- 🧪 **Three-View Regression Guards** - Added manifest and tree grouping checks for the Installed / User Global / Remote view split / Installed・User Global・Remote の 3 view 分割を守る manifest と tree grouping の回帰テストを追加

### Changed

- 🧭 **Three-View Skill Management** - Split the sidebar into workspace Installed Skills, User / Global Skills, and Remote Skills so personal roots no longer appear under the workspace-installed view / サイドバーを workspace の Installed Skills、User / Global Skills、Remote Skills に分割し、personal root が workspace-installed view 配下に見える混乱を解消
- 🧩 **Root-Aware Navigation** - Updated install reveal and refresh flows so workspace and user/global skill roots refresh and focus in the correct tree view / install 後の reveal と refresh flow を root-aware にし、workspace と user/global の skill root が正しい TreeView で更新・フォーカスされるよう改善
- 📝 **View Documentation Alignment** - Updated README and localized setting labels to describe the new three-view layout and built-in skill placement / README とローカライズ済み設定ラベルを更新し、新しい 3 view レイアウトと built-in skill の表示位置を明確化

## [0.8.26] - 2026-05-11

### Added

- 🧪 **Multi-Scope Regression Guards** - Added package-manifest regression checks for managed skill roots, MCP response markdown hygiene, and stale workspace-only tool descriptions / managed skill root、MCP 応答 markdown hygiene、workspace 固定の古い tool 説明を検出する package-manifest 回帰テストを追加

### Changed

- 🧭 **Managed Skill Root Support** - Updated installed-skill commands, tree views, chat commands, MCP tools, metadata refresh, and instruction-file sync to work across workspace and user/global managed skill roots / インストール済みスキルのコマンド、TreeView、Chat コマンド、MCP ツール、メタデータ更新、instruction file 同期を workspace と user/global の managed skill root 横断で動作するよう更新
- 📝 **Multi-Scope Documentation** - Aligned README and tool descriptions with the managed-root model and clarified built-in/user-global skill scope behavior / README と tool 説明を managed-root モデルに合わせ、built-in / user-global skill scope の動作を明確化

### Fixed

- 🧩 **Nested Skill Batch Operations** - Fixed reinstall, uninstall, and listing flows to preserve root-relative nested skill paths instead of falling back to top-level skill names / 再インストール、アンインストール、一覧表示でトップレベル名に戻らず root 相対のネストスキルパスを保持するよう修正
- 💬 **MCP Markdown Cleanup** - Replaced corrupted hand-written MCP response tables with a shared markdown table renderer / 壊れた手書き MCP 応答テーブルを共有 markdown table renderer に置き換え

## [0.8.25] - 2026-05-11

### Fixed

- 🧪 **Regression Script Tracking Guard** - Removed the stale `.gitignore` rule that could exclude committed regression scripts and added a package-manifest test to keep `npm test` inputs tracked / コミット済み回帰テストを誤って除外しうる古い `.gitignore` ルールを削除し、`npm test` の入力が追跡されたまま保たれるよう package-manifest テストを追加

### Added

- 🧩 **Companion Extension Links** - Added lightweight Agent Resources Ninja links and description to Settings and both README variants so users can discover the broader resource-management companion extension / Agent Resources Ninja を見つけやすいよう、設定画面と README 英日版の両方に簡単な説明とリンクを追加

## [0.8.24] - 2026-05-11

### Fixed

- 🧭 **Activity Bar Icon Packaging Fix** - Restored `resources/icon.svg` to the VSIX package and added a manifest asset guard test so Activity Bar icons are shipped with the extension / `resources/icon.svg` を VSIX に再同梱し、manifest 参照 asset の回帰テストを追加して Activity Bar アイコン欠落を防止

## [0.8.23] - 2026-05-10

### Changed

- 📦 **VSIX Package Cleanup** - Excluded development-only files, test scripts, session logs, backups, and local automation artifacts from the VSIX package / VSIX パッケージから開発専用ファイル、テストスクリプト、セッションログ、バックアップ、ローカル自動化成果物を除外

## [0.8.22] - 2026-05-10

### Changed

- 🧭 **Workspace Skills Scope** - Scoped Workspace Skills and instruction-file sync to the configured `skillNinja.skillsDirectory`, preventing generated VS Code test resources and arbitrary workspace `SKILL.md` files from appearing as managed skills / Workspace Skills と instruction file 同期の対象を `skillNinja.skillsDirectory` 配下に限定し、VS Code テスト生成物や任意場所の `SKILL.md` が管理対象スキルとして表示される問題を防止
- 🧩 **Settings and Docs Flow** - Aligned Settings order, README guidance, and release test instructions with the directory-scoped workspace skill model / 設定表示順、README の説明、リリース時テスト手順をディレクトリ単位のワークスペーススキル管理モデルに合わせて整理
- ✅ **NPM Test Script Fix** - Updated `npm test` to run the maintained regression scripts instead of an unconfigured VS Code test runner / 未設定の VS Code test runner ではなく、保守されている回帰テスト一式を実行するよう `npm test` を修正

### Added

- 🧪 **Release Readiness Regression Tests** - Added regression coverage for scan boundaries, Settings order, hidden legacy commands, and README guidance / スキャン範囲、設定表示順、旧コマンドの非表示、README 導線を検証する回帰テストを追加

## [0.8.21] - 2026-04-24

### Added

- 🧪 **Auth Fallback Regression Coverage** - Added regression checks for installer API fallback, raw preview fetch handling, and default-branch resolution retry paths / installer API フォールバック、raw preview fetch、デフォルトブランチ解決の retry 経路を検証する回帰テストを追加

### Fixed

- 🔐 **Unified GitHub Auth Retry Handling** - Consolidated GitHub fetch header and retry behavior so API requests retry unauthenticated after 401/403 while public raw content stays unauthenticated / GitHub fetch のヘッダ生成と retry 挙動を共通化し、API リクエストは 401/403 時に無認証で再試行し、公開 raw コンテンツは無認証のまま扱うよう統一
- 👀 **Preview Retry Consistency** - Fixed preview content loading to use the same auth policy as installer and branch detection, avoiding dead retry branches / preview 読み込みが installer・ブランチ判定と同じ認証ポリシーを使うよう修正し、実行されない retry 分岐を解消

## [0.8.20] - 2026-03-10

### Added

- 🌐 **Microsoft Official Skill Source** - Added `MicrosoftDocs/Agent-Skills` to the bundled preset index and refreshed bundled source metadata / プリセットインデックスに `MicrosoftDocs/Agent-Skills` を追加し、同梱ソースのメタデータを更新
- 🧪 **Symlink Installer Regression Test** - Added a regression test covering directory symlink traversal based on actual GitHub Contents API behavior / GitHub Contents API の実挙動に基づくディレクトリ symlink 走査の回帰テストを追加

### Changed

- 📦 **Preset Skill Index Refresh** - Updated bundled skill index to `v1.18.0` with 1,426 skills from 11 sources / 同梱スキルインデックスを `v1.18.0` に更新し、11ソース・1,426スキルへ刷新
- 📝 **Marketplace / README Metadata Refresh** - Updated source descriptions, official source labels, and version info shown in extension settings / README と拡張設定内のソース説明・公式ラベル・バージョン情報を更新

### Fixed

- 🔗 **Directory Symlink Install Fix** - Fixed GitHub skill installation so directory symlinks are traversed correctly instead of being treated as downloadable files / GitHub スキルのインストール時にディレクトリ symlink をダウンロード対象ファイルと誤認せず正しく再帰走査するよう修正
- 🧩 **Skill Index Merge Resilience** - Normalized legacy local indexes and preserved bundled categories, bundles, metadata, and newly added skills when merging cached indexes / 旧形式のローカルインデックスを正規化し、キャッシュ済みインデックスとのマージ時にカテゴリ・バンドル・各種メタデータ・新規スキルを保持するよう改善
- 🏷️ **Frontmatter Metadata Parsing** - Improved frontmatter parsing to support inline comments, block scalars, and fallback metadata extraction for bundled/local skill scans / frontmatter 解析を改善し、インラインコメント・ブロックスカラー・フォールバックのメタデータ抽出に対応
- 🆕 **Recently Installed Badge Lifetime** - Fixed the temporary recently-installed badge so it survives refreshes and clears by timeout instead of disappearing immediately / 最近インストールしたスキルの一時バッジが refresh で即消えず、タイムアウトで自然に消えるよう修正
- 🔐 **Classic PAT Fallback Handling** - Added retry logic for repositories that reject classic GitHub personal access tokens during index update and install flows / classic GitHub Personal Access Token を拒否するリポジトリに対して、インデックス更新・インストール時の再試行処理を追加

## [0.8.19] - 2026-02-28

### Fixed

- 🧯 **Installer 404 Fail-Fast** - When skill path returns 404, installer now cancels cleanly without generating fallback/template `SKILL.md` / スキルパスが404の場合、フォールバック `SKILL.md` を生成せずインストールを安全に中断
- 🔁 **Update Action Command Fix** - Unified update guidance action to existing command `skillNinja.updateIndex` / 更新導線の実行コマンドを実在する `skillNinja.updateIndex` に統一
- 🧪 **Issue #4/#5 Root Cause Mitigation** - Mitigates incomplete install symptom for outdated `pai-packs` paths by avoiding false-success fallback output / `pai-packs` の古いパスによる不完全インストール症状（Issue #4/#5）で誤成功に見えるフォールバック出力を抑止

## [0.8.18] - 2026-02-28

### Fixed

- 🛡️ **Preview Link Sanitization Hardening** - Blocked protocol-relative URLs (`//...`) and strengthened safe relative URL handling in preview markdown links / プレビューのMarkdownリンクでプロトコル相対URL（`//...`）を遮断し、安全な相対URL判定を強化
- 🎯 **Preview Install Target Resolution** - Improved source resolution (`owner/repo` ↔ source ID) and made install selection fail-safe when duplicate names are ambiguous / source解決（`owner/repo` と source ID）を改善し、同名スキルが曖昧な場合は誤インストールしない fail-safe 動作に修正
- 🌐 **Preview Error Message Clarity** - Added dedicated localized message for source-resolution failure after add-source flow / ソース追加後の source 解決失敗に対する専用ローカライズ文言を追加

## [0.8.17] - 2026-02-22

### Changed

- 🔧 **Code Style Cleanup** - Fixed trailing commas, indentation consistency across chatParticipant, indexUpdater, instructionManager, mcpTools, skillInstaller / chatParticipant・indexUpdater・instructionManager・mcpTools・skillInstaller のコードスタイルを統一（末尾カンマ、インデント修正）

## [0.8.16] - 2026-02-18

### Fixed

- 🐛 **Empty File Download Fix** - Fixed empty files (e.g. Python `__init__.py`) being treated as download errors, which caused partial install warnings for pptx/docx/xlsx skills / 空ファイル（Pythonの `__init__.py` 等）がダウンロードエラーとして扱われ、pptx/docx/xlsxスキルで一部ファイルのダウンロード失敗警告が出る問題を修正

## [0.8.15] - 2026-02-08

### Changed

- 🔧 **Index Format Cleanup** - Cleaned up skill-index.json formatting / skill-index.json のフォーマットを整理

## [0.8.14] - 2026-02-08

### Added

- 📦 **CLI Index Updater** - Added `scripts/update-preset-index.js` for refreshing skill index from preset sources / プリセットソースからインデックスを更新するCLIスクリプトを追加

### Changed

- 📊 **Skill Index Update** - Updated to v1.14.0: 230 → 266 skills (+36) from 10 preset sources / スキルインデックスをv1.14.0に更新（230 → 266スキル）

## [0.8.13] - 2026-02-08

### Fixed

- 🔙 **Rollback Nested Skill Fix** - Reverted nested skill exclusion logic as it broke hierarchical skill structures like `documents/Docx` / 階層構造のスキル（documents/Docx等）が壊れるため、ネストスキル除外ロジックをロールバック

## [0.8.12] - 2026-02-08

### Fixed

- 🐛 **GitHub URL 404 Fix** - Fixed "View on GitHub" returning 404 for skills from custom sources by properly saving and using branch info / カスタムソースのスキルで「GitHubで開く」が404になる問題を修正（ブランチ情報を正しく保存・使用）
- 🐛 **Nested Skill Fix** - Skills inside other skill folders are no longer registered as separate skills (fixes duplicate entries in AGENTS.md) / スキルフォルダ内のサブスキルが別スキルとして登録される問題を修正

### Changed

- ⚡ **Subdirectory Limit Increased** - Raised limit from 50 to 300 subdirectories for large skill downloads (e.g., Fabric with 240+ patterns) / 大規模スキルのサブディレクトリ制限を50から300に拡大
- 🔐 **Auth Help on Rate Limit** - Now shows authentication help dialog when GitHub API rate limit (403) is hit during install / インストール時にGitHub APIレート制限(403)に当たった場合に認証ヘルプを表示

## [0.8.11] - 2026-02-06

### Fixed

- 🐛 **Skill Install Fix for large repos** - Fixed directory download crashing when skill has many subdirectories (e.g., Fabric with 240+ patterns). Files are now downloaded before subdirectories, errors are caught per-subdirectory, and a limit prevents API rate limiting. Fixes [#2](https://github.com/aktsmm/vscode-agent-skill-ninja/issues/2) / 大量のサブディレクトリを持つスキル（例: Fabric の240以上のパターン）でインストールがクラッシュする問題を修正。ファイルをディレクトリより先にダウンロードし、サブディレクトリのエラーを個別にキャッチ、API制限防止のため制限数を導入

## [0.8.10] - 2026-02-04

### Fixed

- 🐛 **スキル重複表示修正** - 同一リポジトリ内の異なるパスに同名スキルがある場合の重複を除去（パスが短い方を優先） / Fixed duplicate skill display when same skill exists at multiple paths (prefers shorter path)

## [0.8.9] - 2026-02-03

### Added

- 🌐 **Skill Registry 対応** - `majiayu000/claude-skill-registry` など大規模レジストリリポジトリからスキルを取り込み可能に / Added support for large skill registry repositories
- ⚡ **フェッチ性能改善** - リクエストタイムアウト（15秒）と並列取得（8並列）で高速化 / Improved fetch performance with timeout (15s) and concurrency (8 parallel)
- 📝 **Add Source 入力改善** - `owner/repo` 形式での入力に対応（URL自動補完） / Add Source now accepts `owner/repo` format

### Fixed

- 🐛 **ENOENT エラー抑制** - スキルディレクトリ未作成時のログエラーを解消 / Fixed noisy ENOENT errors when skills directory doesn't exist

## [0.8.8] - 2026-02-01

### Changed

- 🎨 **インデックスフォーマット統一** - categories 配列を1行表記に統一（コード可読性向上） / Unified categories array formatting to single line

## [0.8.7] - 2026-02-01

### Changed

- 🧹 **プリセットインデックスのクリーンアップ** - 個人リポジトリ `aktsmm/Agent-Skills` をプリセットから削除 / Removed personal repository from preset index
- 📋 **インデックス管理ルール追加** - プリセットソースの基準を明文化（skill-index.instructions.md） / Added preset source criteria documentation
- 📊 **スキルインデックス更新** - v1.12.0 → v1.13.0（スキル: 241 → 230、ソース: 11 → 10） / Updated skill index (skills: 241 → 230, sources: 11 → 10)

## [0.8.6] - 2026-01-31

### Changed

- 📝 **README 更新** - Full フォーマットの説明を最適化（詳細テーブルのみに変更）、圧縮インデックスの記述を削除 / Updated README - Clarified Full format shows detailed table only (removed compressed index)

## [0.8.5] - 2026-01-31

### Changed

- 📦 **Full フォーマットの最適化** - 詳細テーブルのみ表示（圧縮インデックスを削除して冗長性を解消） / Optimized Full format - Shows detailed table only (removed redundant compressed index)

## [0.8.4] - 2026-01-30

### Changed

- 🥷 **拡張機能名の変更** - "Agent Skill Ninja" → "Agent Skills Ninja" にリネーム / Renamed extension from "Agent Skill Ninja" to "Agent Skills Ninja"

## [0.8.3] - 2026-01-30

### Changed

- 🌟 **出力フォーマットの命名変更** - `full` / `compact` / `legacy` にリネーム、既定は `full` / Renamed output formats to `full` / `compact` / `legacy`, default is now `full`
  - `full`: IMPORTANT + 詳細テーブル + 圧縮インデックス（既定・推奨）
  - `compact`: IMPORTANT + 圧縮インデックスのみ
  - `legacy`: シンプルテーブルのみ（OLD）
- 📦 **旧フォーマットからの自動マイグレーション** - 拡張機能アップデート時に旧設定値を自動変換 / Auto-migrate old format settings on extension upgrade
  - `markdown` → `legacy`
  - `compressed-index` → `compact`
  - `markdown-with-index` → `full`
- 🔄 **インストラクションファイル自動更新** - フォーマットマイグレーション時に AGENTS.md を新フォーマットで再生成 / Auto-regenerate AGENTS.md with new format on migration

## [0.8.2] - 2026-01-30

### Changed

- 📝 **出力フォーマットを固定** - Output Format のデフォルトを Markdown に統一し、Auto 検出を廃止 / Default output format is now Markdown; auto-detection removed
- 🔧 **定数の共通化** - マジックナンバー（文字数制限など）を constants.ts に集約 / Centralized magic numbers (character limits) into constants.ts

### Added

- 🔐 **GitHub 認証ヘルパー** - トークン取得ロジックを共通化（設定 → 環境変数 → gh CLI） / Unified GitHub token resolution (config → env → gh CLI)

## [0.8.1] - 2026-01-30

### Added

- 📜 **LICENSE.txt からライセンス名抽出** - "Complete terms in LICENSE.txt" のような曖昧な記述の場合、LICENSE.txt の内容から実際のライセンス名を抽出 / Auto-extract license name from LICENSE.txt when SKILL.md has ambiguous license field
- ✅ **対応ライセンス** - MIT, Apache-2.0, GPL, BSD, CC BY-NC-SA 4.0, Anthropic Proprietary など / Supports common licenses

## [0.8.0] - 2026-01-30

### Added

- 🔄 **スキル自動更新機能** - 拡張機能アップデート時にインストール済みスキルを自動更新 / Auto-update installed skills when extension is upgraded
- ⚙️ **設定追加** - `autoUpdateSkillsOnUpgrade`: `always` / `prompt` / `never` から選択 / New setting to control skill auto-update behavior

## [0.7.3] - 2026-01-30

### Changed

- 📜 **プリセットインデックス更新** - 35件 license、12件 author、最新 description を取得 / Updated preset index with latest metadata (35 licenses, 12 authors)

## [0.7.2] - 2026-01-30

### Changed

- 📝 **フォーマット簡略化** - Markdown / Compressed Index の出力を統一、Vercel 宣伝文を削除 / Simplified output formats, removed Vercel promotional text
- 🆕 **Compressed Index** - Description のみ100文字の超圧縮版に変更 / Now uses description only (100 chars max)
- 🆕 **Markdown** - Description + WhenToUse 200文字版に変更 / Now uses description + whenToUse (200 chars max)

## [0.7.1] - 2026-01-30

### Changed

- 📜 **プリセットインデックス更新** - license/author 情報をプリセットにマージ（9件 license, 10件 author） / Merged license/author metadata into preset index

## [0.7.0] - 2026-01-30

### Added

- 📝 **Description 200文字対応** - 合計最大200文字に拡張（片方が短ければもう片方に回す） / Extended to max 200 chars total (dynamic allocation)
- 📜 **author/license/version 取得** - インデックス更新時に frontmatter から取得、ツールチップに表示 / Fetch author/license/version from frontmatter during index update

## [0.6.9] - 2026-01-30

### Added

- 🔄 **Description フォールバック** - frontmatter に description がない場合、When to Use セクションから自動抽出 / Fallback to When to Use section when frontmatter description is missing

## [0.6.8] - 2026-01-30

### Fixed

- 🛠️ **メタデータ自動更新** - SKILL.md の保存時に `.skill-meta.json` の description/whenToUse を自動更新 / Auto-refresh description and whenToUse in `.skill-meta.json` when SKILL.md changes
- 🧩 **依存表示の維持** - リモートスキルで依存がある場合もツールチップの説明・ライセンス・著者が消えないように修正 / Preserve tooltip metadata when skills have dependencies

## [0.6.7] - 2026-01-30

### Fixed

- 🐛 **Description 文字数修正** - 全形式で Description + When to Use を連結（各最大80文字、合計160文字）が正しく動作するように修正 / Fixed description truncation to work correctly across all formats (80+80=160 chars max)

## [0.6.6] - 2026-01-30

### Changed

- 📝 **ツールチップ改善** - リモートスキルのマウスオーバー時にカテゴリではなくライセンス・作成者・バージョンを表示 / Show license, author, version instead of categories in tooltip

## [0.6.5] - 2026-01-30

### Changed

- 📝 **Description 列** - Compressed Index のテーブル列を `When to Use` から `Description` に変更。Description + When to Use を連結表示（各最大80文字、合計160文字） / Changed table column from "When to Use" to "Description", combining description and when-to-use text

## [0.6.4] - 2026-01-30

### Changed

- 🌐 **英日併記** - 日本語版設定のラベルに英語を併記 / Added English labels to Japanese settings for clarity

## [0.6.3] - 2026-01-30

### Fixed

- 🔄 **リポジトリ単位の更新** - `skillNinja.updateSourceIndex` コマンドが登録されていなかったバグを修正 / Fixed updateSourceIndex command not being registered

## [0.6.2] - 2026-01-30

### Fixed

- 📁 **設定変更時のクリーンアップ** - Cursor/Windsurf/Cline のファイルも候補に追加 / Added Cursor/Windsurf/Cline files to cleanup candidates

## [0.6.1] - 2026-01-30

### Added

- 🧠 **IMPORTANT プロンプト追加** - Vercel 調査に基づき、全形式に "Prefer skill-led reasoning over pre-training-led reasoning" を追加 / Added IMPORTANT prompt to all formats

## [0.6.0] - 2026-01-30

### ⚠️ Breaking Changes

- **設定の簡素化** - `outputFormat` と `instructionFile` を明確に分離
  - `outputFormat`: スキルリストの表示形式のみ（markdown, compressed-index, markdown-with-index）
  - `instructionFile`: 出力先ファイル（AGENTS.md, CLAUDE.md, .cursor/rules/, .windsurfrules, .clinerules など）
  - `cursor-rules`, `windsurf-rules`, `cline-rules` は `outputFormat` から削除され `instructionFile` に移動

### Added

- 🎯 **ツール別出力先** - Cursor (.cursor/rules/skills.mdc), Windsurf (.windsurfrules), Cline (.clinerules) を `instructionFile` に追加

### Changed

- 📝 **設定 UI 改善** - 各設定の説明をわかりやすく改善、テーブルでツールとファイルの対応を表示

## [0.5.3] - 2026-01-29

### Fixed

- 🧹 **古いファイルのクリーンアップ** - インストラクションファイル変更時、古いファイルからスキルセクションを削除 / Clean up old files when changing instruction file
- 📝 **説明文改善** - 設定の説明をよりわかりやすく改善 / Improved settings description

## [0.5.2] - 2026-01-29

### Added

- 📄 **メタデータ表示** - ツールチップに License, Author, Version を表示 / Show license, author, version in tooltip
- 📝 **SKILL.md テンプレート更新** - 公式仕様に従ったライセンス、メタデータ欄を追加 / Updated template with license and metadata fields

### Fixed

- 🏷️ **README バッジ修正** - 静的バッジに変更して Rate Limit エラーを回避 / Fixed badges to avoid rate limit errors

## [0.5.1] - 2026-01-29

### Added

- 🔄 **設定変更時の自動更新** - `instructionFile` や `outputFormat` の変更時に AGENTS.md を自動更新 / Auto-update AGENTS.md when settings change

### Changed

- 🏷️ **カテゴリー変更** - Marketplace のカテゴリーを AI, Chat, Other に変更 / Updated categories to AI, Chat, Other

## [0.5.0] - 2026-01-29

### Added

- 🚀 **Compressed Index Format (PREVIEW)** - Vercel-style output format achieving 100% pass rate in agent evals / Vercel方式の圧縮インデックス形式でエージェント評価100%パス
  - [📖 Research](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)
- 🌟 **Markdown + Index (Both)** - Combine traditional table with compressed index / 従来テーブルと圧縮インデックスの併用
- 📋 **Output Format setting moved to top** - Most important setting now first / 出力フォーマット設定を最上部に移動

### Changed

- ⚠️ Settings description now includes usage notes and research link / 設定の説明に使用注意と調査リンクを追加

## [0.4.14] - 2026-01-29

### Changed

- 🏷️ **README Badges** - Added version, installs, license badges and quick install button / README にバージョン・インストール数・ライセンスバッジとクイックインストールボタンを追加

## [0.4.13] - 2026-01-29

### Added

- 📁 **Nested Skill Support** - Recursively scan subfolders to detect nested skills (e.g., `document-skills/docx/SKILL.md`) / サブフォルダを再帰的にスキャンしてネストされたスキルを検出
- 📍 **Relative Path in AGENTS.md** - Links now use correct relative path for nested skills / AGENTS.md のリンクがネストされたスキルの正しい相対パスを使用

## [0.4.12] - 2026-01-29

### Improved

- ✨ **Table Format Full Extraction** - When to Use now extracts ALL columns from tables in "key: value" format, not just first column / テーブル形式の When to Use から全列を「キー: 値」形式で抽出（最初の列のみではなく）
- 📏 **More Informative Output** - AGENTS.md now shows up to 200 chars of detailed context instead of just keywords / AGENTS.md にキーワードだけでなく詳細なコンテキストを200文字まで表示

## [0.4.11] - 2026-01-29

### Fixed

- 🐛 **Fallback Template Detection** - When "When to Use" is fallback pattern like "{name} skill" or too short (<15 chars), use description instead / 「When to Use」がフォールバックパターン（「{name} skill」）または短すぎる場合は description を使用

## [0.4.10] - 2026-01-29

### Changed

- 📝 **Docs** - Clarify installation path is configurable in settings / インストールパスが設定で変更可能であることを明記

## [0.4.9] - 2026-01-29

### Added

- 🔄 **Auto Metadata Refresh** - Automatically refreshes skill metadata (whenToUse) when extension is updated / 拡張機能のアップデート時にスキルのメタデータ（whenToUse）を自動で再抽出

## [0.4.8] - 2026-01-29

### Fixed

- 🐛 **When to Use Extraction Fix** - Fixed incorrect extraction of "When to Use" section from SKILL.md. Now correctly handles bullet lists, tables, and numbered lists / SKILL.md からの "When to Use" セクション抽出のバグを修正。箇条書き・テーブル・番号リストに正しく対応

### Improved

- ✨ **Better Table Support** - "When to Use" section with table format now extracts first column values correctly / テーブル形式の When to Use セクションから最初の列を正しく抽出
- 📏 **200 Character Optimization** - Includes as many items as possible within 200 character limit instead of fixed 3 items / 固定3項目ではなく200文字以内で可能な限り多くの項目を結合

## [0.4.7] - 2026-01-28

### Changed

- 📦 **Build** - Exclude `.github/` folder from VSIX package to prevent prompt duplication / パッケージから `.github/` フォルダを除外し、プロンプト二重表示を防止

## [0.4.6] - 2026-01-28

### Fixed

- 🐛 **Skill Install Fix** - Fixed SKILL.md being overwritten with fallback content when subdirectory download fails ([#1](https://github.com/aktsmm/vscode-agent-skill-ninja/issues/1)) / サブディレクトリのダウンロード失敗時に SKILL.md がフォールバック版で上書きされる問題を修正

### Added

- 📦 **Skill Index v1.12.0** - Updated with 63 new skills from multiple sources (178 → 241 total) / 63 個の新スキルを追加

### Recommended

- 💡 **GitHub Token** - Setting `skillNinja.githubToken` is recommended to avoid API rate limits (60 → 5000 requests/hour) / API レート制限回避のため GitHub Token の設定を推奨

## [0.4.4] - 2026-01-22

### Fixed

- 🐛 **Copy Path Fix** - Fixed right-click "Copy Path" not working for installed skills / インストール済みスキルの「パスをコピー」が機能しない問題を修正
- 🔗 **Changelog Link Fix** - Fixed 404 error when opening changelog from settings (main → master branch) / 設定からの変更履歴リンクが404になる問題を修正

## [0.4.3] - 2026-01-21

### Added

- 📦 **Skill Index v1.11.0** - Added 8 new skills from GitHub awesome-copilot and OpenAI (170 → 178 total)

### New Skills Added

**GitHub Awesome Copilot (5 new):**

- `azure-static-web-apps` - Create, configure, deploy Azure Static Web Apps / SWA CLI でデプロイ
- `make-skill-template` - Create new Agent Skills from prompts/templates / スキル作成テンプレート
- `microsoft-code-reference` - Look up Microsoft API references with MS Learn MCP / API参照・SDK検証
- `microsoft-docs` - Query official Microsoft documentation / Microsoft公式ドキュメント検索

**OpenAI Skills (4 new):**

- `gh-address-comments` - Address PR review comments using gh CLI / PRレビューコメント対応
- `gh-fix-ci` - Inspect and fix failing GitHub Actions checks / CI失敗の調査と修正
- `notion-meeting-intelligence` - Prepare meeting materials with Notion context / 会議資料準備
- `notion-research-documentation` - Research Notion content and produce reports / リサーチドキュメント作成

## [0.4.2] - 2026-01-19

### Fixed

- 📝 **README Update** - Added OpenAI Skills to Included Skill Sources table / スキルソース一覧にOpenAI Skillsを追加

## [0.4.1] - 2026-01-19

### Changed

- 📝 **Bilingual Changelog** - Updated changelog to English/Japanese bilingual format / チェンジログを日英併記に変更

## [0.4.0] - 2026-01-19

### Added

- 🆕 **OpenAI Skills (Official)** - Added official OpenAI Codex Skills repository as a new source (1.7k+ Stars)
- 📦 **Skill Index v1.10.0** - Added 6 new skills from OpenAI (164 → 170 total)

### New Skills Added

**OpenAI Skills (6 new):**

- `skill-creator` - Guide for creating Codex skills / Codex スキル作成ガイド
- `skill-installer` - Install skills from curated list or GitHub / スキルのインストール
- `linear` - Manage issues, projects & workflows in Linear / Linear 連携
- `create-plan` - Create concise plans for coding tasks / プラン作成
- `notion-knowledge-capture` - Capture and organize knowledge in Notion / Notion ナレッジ保存
- `notion-spec-to-implementation` - Convert Notion specs to implementation / 仕様→実装変換

## [0.3.9] - 2026-01-15

### Fixed

- 🐛 **Add Source Command** - Fixed `m.match is not a function` error when adding source from TreeView / TreeView からソース追加時のエラーを修正

## [0.3.8] - 2026-01-15

### Added

- ℹ️ **Version Info in Settings** - View extension version, skill index version, and stats directly in VS Code settings / 設定画面でバージョン情報を表示
- 📦 **Skill Index v1.9.0** - Updated with 23 new skills (141 → 164 total) / 23個の新スキル追加

### New Skills Added

**GitHub Awesome Copilot (9 new):**

- `appinsights-instrumentation` - Application Insights instrumentation / 計装
- `azure-resource-visualizer` - Azure resource visualization / リソース可視化
- `azure-role-selector` - Azure RBAC role selection / ロール選択
- `github-issues` - GitHub Issue management / Issue 管理
- `nuget-manager` - NuGet package management / パッケージ管理
- `snowflake-semanticview` - Snowflake semantic view / セマンティックビュー
- `vscode-ext-commands` - VS Code extension commands / 拡張コマンド作成
- `vscode-ext-localization` - VS Code extension localization / 拡張ローカライズ
- `web-design-reviewer` - Web design review / デザインレビュー

**PAI Packs (5 new):**

- `pai-algorithm-skill` - Structured task execution / 構造化タスク実行
- `pai-hook-system` - Event-driven automation / イベント駆動自動化
- `pai-observability-server` - Agent monitoring / エージェント監視
- `pai-upgrades-skill` - System updates / システムアップデート
- `pai-voice-system` - Voice interaction / 音声インタラクション

**Context Engineering (6 new):**

- `bdi-mental-states` - BDI mental states / メンタルステート
- `filesystem-context` - Filesystem context / ファイルシステムコンテキスト
- `hosted-agents` - Hosted agents / ホステッドエージェント
- `memory-systems` - Memory systems / メモリシステム
- `multi-agent-patterns` - Multi-agent patterns / マルチエージェントパターン
- `project-development` - Project development workflow / プロジェクト開発

**ComposioHQ (3 new):**

- `connect-apps` - App connection & integration / アプリ接続・統合
- `langsmith-fetch` - LangSmith data fetching / データ取得
- `tailored-resume-generator` - Customized resume generation / 履歴書生成

## [0.3.6] - 2026-01-05

### Improved

- 💡 **MCP Tool Suggestions** - All MCP tools now show "Next Actions" suggestions after execution
- 🛡️ **No Auto-Execution** - Agent will NOT automatically execute suggested actions, waits for user choice

## [0.3.5] - 2026-01-05

### Changed

- 🎬 Updated demo GIF (table format showcase)

## [0.3.4] - 2026-01-05

### Changed

- 🎬 Updated demo GIF
- 📖 Added GitHub Token requirement warning to README

## [0.3.3] - 2026-01-05

### Added

- 📊 **Table Format for AGENTS.md** - Skills now displayed in table with "Skill" and "When to Use" columns
- 🔍 **Auto-extract "When to Use"** - Automatically extracts from `## When to Use` section in SKILL.md
- ✏️ **Edit Description** - Right-click installed skill → "Edit When to Use" to customize description
- 🔄 **Auto Index Update on Reinstall** - Prompts to update index when skills not found
- 🚀 **Startup Index Check** - Detects missing skills at startup and offers index update

### Improved

- 📝 **Fallback Description** - If no `## When to Use` section, extracts first paragraph after title
- 💾 **Preserve Custom Descriptions** - `customWhenToUse` preserved on skill reinstall
- 📏 **Longer Descriptions** - Increased max length from 80/120 to 200 characters
- 🔧 **Auto-generate Metadata** - Creates `.skill-meta.json` for legacy skills when editing
- 🎯 **Cursor/Windsurf/Cline Support** - All output formats now use whenToUse priority

### Fixed

- 🐛 Fixed metadata not found error when editing old skills without `.skill-meta.json`
- 🐛 Fixed index update function signature errors

## [0.1.0] - 2026-01-03

### Added

- 🔍 **Skill Search** - Search 220+ skills from local index
- 📦 **One-click Install** - Install skills to `.github/skills/`
- 📝 **AGENTS.md Auto-update** - Automatically register skills in instruction file
- 🌐 **GitHub Search** - Search and discover skills from GitHub
- 🔄 **Update Index** - Fetch latest skills from all sources
- ➕ **Add Source** - Add custom GitHub repositories as skill sources
- ➖ **Remove Source** - Remove skill sources from index
- 🌍 **i18n Support** - Japanese and English UI based on VS Code locale
- 🗂️ **Sidebar Views** - Browse installed skills and sources in sidebar
- 🔑 **GitHub Token Support** - Configure token for higher API rate limits
- 🤝 **gh CLI Integration** - Auto-detect token from GitHub CLI

### Skill Sources

- [anthropics/skills](https://github.com/anthropics/skills) - Official Claude Skills
- [github/awesome-copilot](https://github.com/github/awesome-copilot) - Official Copilot Resources
- [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) - Curated Skills
- [obra/superpowers](https://github.com/obra/superpowers) - Community Skills

### Supported Instruction Files

- `AGENTS.md` (recommended)
- `.github/copilot-instructions.md` (GitHub Copilot)
- `CLAUDE.md` (Claude Code)
- Custom path

---

## [0.0.1] - 2026-01-01

### Added

- Initial development version
- Basic skill search functionality
- QuickPick-based UI

[Unreleased]: https://github.com/aktsmm/vscode-agent-skill-ninja/compare/v0.9.24...HEAD
[0.9.24]: https://github.com/aktsmm/vscode-agent-skill-ninja/releases/tag/v0.9.24
[0.9.23]: https://github.com/aktsmm/vscode-agent-skill-ninja/releases/tag/v0.9.23
[0.9.22]: https://github.com/aktsmm/vscode-agent-skill-ninja/releases/tag/v0.9.22
[0.9.8]: https://github.com/aktsmm/vscode-agent-skill-ninja/releases/tag/v0.9.8
[0.9.7]: https://github.com/aktsmm/vscode-agent-skill-ninja/releases/tag/v0.9.7
[0.1.0]: https://github.com/aktsmm/vscode-agent-skill-ninja/releases/tag/v0.1.0
[0.0.1]: https://github.com/aktsmm/vscode-agent-skill-ninja/releases/tag/v0.0.1
