# Changelog

All notable changes to the "Agent Skills Ninja" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.50] - 2026-09-07

### Added

- **Update Only Changed Skills** - Root-row and all-managed-root update commands compare complete upstream skill contents, including scripts and references. Unchanged skills are not rewritten. Legacy installs without comparison metadata require explicit first-sync confirmation, and changed skills overwrite local edits only after confirmation / ルート行と全管理ルートの更新操作で、スクリプトや参照資料を含む配布内容全体を比較します。変更なしのスキルは書き直さず、比較情報のない既存スキルは初回同期を確認します。更新対象のローカル編集は確認後に上書きします。
- **Pinned, Staged Updates** - Revision checks are shared per repository/ref, downloads use the checked commit, and only complete staged updates replace the installed copy. Failed or cancelled updates preserve the old copy and revision. Ordinary successful installs also capture a comparison baseline when available / 配布元とrefごとに確認結果を共有し、確認したcommitから取得します。一時領域で完全取得できたものだけを置き換え、失敗・中断時は既存コピーと比較情報を保持します。通常インストールも可能な場合は比較基準を保存します。
- **Failure Reports From Bulk Notifications** - Report Bug previews sanitized failure categories before opening a GitHub issue draft after confirmation. Nothing is posted automatically / 一括処理の失敗通知にバグ報告を追加しました。機密値を除いた失敗分類を確認後、GitHubのIssue下書きを開きます。自動投稿は行いません。

### Fixed

- **Bounded, Non-destructive Retries** - Transient failures receive at most one automatic and one manual retry, neither of which uninstalls the existing copy. Permanent failures no longer offer the same retry repeatedly. Failures outside the retry subset and prior failure categories remain visible / 一時的な失敗は自動1回と手動1回まで再試行し、どちらも既存コピーを削除しません。恒久的な失敗の再試行案内を繰り返さず、対象外の失敗と直前の失敗分類も保持します。
- **Current Root Resolution** - Root update/reinstall and output regeneration resolve the current managed root instead of trusting stale tree-item flags. Invalid or read-only selections do not fall back to another root / ルート更新・再インストール・出力再生成で、古いツリー項目の状態ではなく現在の管理対象を照合します。不正または読み取り専用の選択から別ルートへ切り替えません。
- **Preserve Unreadable Or Malformed Metadata** - Combined read/stat failures no longer imply a missing file. Local registration and unregistration preserve malformed metadata, and a reinstall that cannot reread existing metadata fails without replacing it with defaults / 読取と存在確認の失敗を不在と誤認しなくなりました。登録・解除で壊れたメタデータを保持し、再インストール中に再読込できない場合も既定値で上書きせず失敗とします。
- **Output Failures Are Not Success** - Regeneration distinguishes updated, unchanged, disabled, delegated and blocked output. Read/write or lock failures show a deduplicated warning with a Skill State details action; recovery permits later failures to be reported again / 再生成の更新・変更なし・無効・委譲・失敗を区別します。読取・書込・ロック失敗は重複抑止付き警告とSkill Stateの詳細導線で通知し、復旧後の再失敗も通知できます。

### Changed

Paste the NEW Marketplace PAT here (input is hidden):- **Refreshed Two Preset Sources** - The release audit found 58 stale paths in Google Skills and GitHub Awesome Copilot. Re-scanning those sources produces catalog v1.29.0 with 1863 skills across 13 sources; untouched sources retain their own scan history / リリース監査でGoogle SkillsとGitHub Awesome Copilotの58パスが無効と判明したため、該当ソースを再走査しました。同梱カタログv1.29.0は13ソース1863件で、未更新ソースの走査履歴は保持します。

- **Visible Progress And Repeatable Host Tests** - Update checks show scanning/checking/applying phases and skip credential lookup when no remote candidate is eligible. Isolated English/Japanese Extension Host tests cover activation, command wiring, no-op updates and output failure/recovery / 走査・更新確認・適用の進捗を表示し、リモート更新対象がなければ認証情報を確認しません。分離した英日Extension Hostテストで起動、コマンド接続、変更なし更新、出力失敗と復旧を確認します。
- **Known Boundaries** - Forced reinstall remains available for repair. Overlapping package layouts and changed source identities are not automatically migrated. Do not update the same physical skill directory concurrently from multiple windows or tools / 修復用の強制再インストールは維持します。重複する親子配置や配布元identityの変更は自動移行しません。同じ実体のスキルフォルダーを複数ウィンドウやツールから同時更新しないでください。

## [0.9.49] - 2026-08-24

### Fixed

- 🛡️ **A File That Could Not Be Read Was Treated As An Empty One** - Every read failure on an instruction file or a `ref` catalog was handled as "this file is new", so a lock, a permission problem or a transient I/O error replaced your whole document with just the generated skill block. A file that is genuinely absent is still created; a file that exists but cannot be read is now left untouched and retried on the next sync. The same fix applies to `.skill-meta.json`: registering or unregistering a local skill no longer writes default metadata over a file it failed to read, which used to drop `source` and `remotePath` and turn a remote skill into a local one / instruction ファイルや `ref` catalog の読み取り失敗をすべて「新規ファイル」として扱っていたため、ロック・権限・一時的な I/O エラーで文書全体が生成ブロックだけに置き換わることがありました。本当に存在しないファイルは従来どおり作成し、存在するのに読めないファイルには触らず次回同期で再試行します。`.skill-meta.json` も同様で、ローカルスキルの登録 / 登録解除で読み取りに失敗したファイルへ既定メタデータを書き戻さなくなりました。従来は `source` と `remotePath` が失われ、remote skill が local 扱いになっていました

- ⏸️ **A Batch Reinstall Could Stop On A Notification Nobody Answered** - Reinstall All, Reinstall Remote Skills in This Root and Reinstall Multiple Skills each asked, before the progress bar appeared, whether to update the index and whether to exclude skills missing from it. Those are ordinary notifications, so leaving one sitting in the notification centre held the whole batch. The batch paths no longer ask; missing skills are reported in the summary instead, and the per-skill exclusion offer stays on the single-skill and startup paths. The retry offer shown after a batch also stopped blocking, so an upgrade that reinstalls skills now reaches its completion notice without waiting for a click / 全スキルを再インストール / この root のリモートスキルを再インストール / 複数スキルを再インストール は、進捗バーが出る前に「インデックスを更新するか」「見つからないスキルを今後除外するか」を尋ねていました。どちらも通常の通知なので、通知センターに放置されると一括処理全体が止まりました。一括経路では尋ねず、見つからないスキルはサマリーに出すようにし、個別の除外提案は単体再インストールと起動時の経路に残しました。一括処理後の再試行提案も待たなくなったため、アップグレード時の再インストールがクリックを待たずに完了通知まで到達します

- ↩️ **CRLF Instruction Files Stopped Getting Mixed Line Endings** - The generated skill block was always written with LF, so on a `AGENTS.md`, `copilot-instructions.md` or `CLAUDE.md` saved with CRLF every sync produced a mixed-ending file and a whole-file diff. A file whose line endings are all CRLF now gets a CRLF block, a file with mixed endings is left exactly as it is, and the original trailing newline survives cleanup / 生成するスキルブロックを常に LF で書いていたため、CRLF で保存された `AGENTS.md` / `copilot-instructions.md` / `CLAUDE.md` では同期のたびに改行が混在し、ファイル全体が差分になっていました。改行がすべて CRLF のファイルには CRLF で書き、混在しているファイルはそのまま残し、cleanup 後も元の末尾改行を保つようにしました

- 🧹 **Orphan Block Cleanup No Longer Touches Files That Hold Nothing Of Ours** - Clean Up Orphan Instruction Block also collapsed runs of blank lines, so it rewrote instruction files that contained no managed block at all, and files whose block had lost its end marker. Both cleanup paths now check that a removable block is actually present first / 孤児マーカーブロックの掃除は空行の詰めも行っていたため、管理ブロックが 1 つも無い instruction ファイルや、終了マーカーを失ったブロックしか無いファイルまで書き換えていました。両方の cleanup 経路で、実際に除去できるブロックがあるかを先に確認するようにしました

- 📖 **The Japanese Command Table Rendered Broken** - A malformed separator row in `README_ja.md` squashed three commands into a single cell, hiding Resume Deferred Source Index Update and Clear GitHub Token. The table is repaired, and every command that can only be reached from the Command Palette is now listed in both READMEs, with the right-click actions in their own section / `README_ja.md` の区切り行が壊れていて 3 つのコマンドが 1 セルに潰れ、「中断したソース更新を再開」と「GitHub トークンをクリア」が読めなくなっていました。表を修復し、コマンドパレットからしか実行できないコマンドを両 README に記載し、右クリック操作は別セクションにまとめました

### Changed

- 📇 **Two Preset Sources Were Re-indexed** - 20 skills in `google-skills` and `oh-my-codex` pointed at paths that no longer exist upstream, so installing them could only fail. Both sources were re-scanned; the bundled catalog now lists 1837 skills across 13 sources / `google-skills` と `oh-my-codex` の 20 スキルが上流に存在しないパスを指しており、インストールしても必ず失敗する状態でした。両ソースを再走査し、同梱カタログは 13 ソース 1837 スキルになりました

- ⚡ **The Bundled Skill Index Is Parsed Once Per Window** - The 800 KB catalog shipped with the extension was re-read and re-parsed on every tree refresh and every command that needs the index. It is now parsed once and re-validated by file timestamp and size; your local index, the shared sources manifest and every save still happen exactly as before / 拡張に同梱している 800KB のカタログを、ツリー更新やインデックスを使うコマンドのたびに読み直してパースしていました。1 回だけパースし、以降はファイルの更新時刻とサイズで再検証します。ローカル index、共有 sources manifest、保存処理は従来どおりです

## [0.9.48] - 2026-08-24

### Added

- 🎯 **Per-location Control Over Where The Skill List Goes** - `skillNinja.outputTargets` turns the workspace and each user/global location (`~/.copilot`, `~/.claude`, `~/.agents`, plus any extra root) into a list you can switch on and off individually, with an optional per-location format override. Leaving it empty keeps today's behaviour exactly, and the scalar `outputFormat` / `refCatalogPath` / `refCatalogFormat` settings stay live as the defaults every target inherits, so a target only overrides what you actually set on it. `Agent Skills Ninja: Configure Output Targets` edits the same list from a checklist that shows each resolved file path, whether VS Code always loads that file, and when several targets share one file / `skillNinja.outputTargets` により、ワークスペースと各ユーザー/グローバル出力先（`~/.copilot`、`~/.claude`、`~/.agents`、追加 root）を一覧として個別に ON/OFF でき、出力先ごとに形式も上書きできるようになりました。空のままなら挙動は従来と完全に同じで、`outputFormat` / `refCatalogPath` / `refCatalogFormat` は各ターゲットが継承する既定値として生き続けるため、明示した項目だけが上書きされます。`Agent Skills Ninja: 出力ターゲットを設定` から、解決後のファイルパス・VS Code が常時読み込むファイルか・複数ターゲットが 1 ファイルを共有しているかを表示するチェックリストで同じ一覧を編集できます

### Changed

- 🚫 **"Write Nothing" Is Now A Format You Can Pick** - Output Format gained a `none` value, so a location can stay managed without a skill list being written into it. Picking it removes the managed block and any generated catalog and leaves your own text alone. Turning off `skillNinja.autoUpdateInstruction` used to freeze the list instead, which only ever left it stale, so that setting is deprecated and now behaves the same as `none`, with a one-time notice for anyone who had it switched off / 出力フォーマットに `none` を追加しました。管理対象のままスキル一覧を書かない状態を選べます。選ぶと管理ブロックと生成済み catalog は削除され、自分で書いた本文はそのまま残ります。`skillNinja.autoUpdateInstruction` を無効にすると従来は一覧が凍結され、古いまま残るだけだったため、この設定は非推奨として `none` と同じ動作に揃え、無効にしていた人には 1 回だけ通知します

### Fixed

- 🎯 **A New Output Location Was Silently Skipped** - Once output targets are configured, only the listed locations are written, so a location that showed up afterwards, such as `~/.claude` right after installing Claude Code, got no skill list and no explanation. Unchecking a location in the checklist is now recorded as an explicit off, which makes "never seen" distinguishable from "declined", and a location seen for the first time is announced once with a shortcut to the checklist / 出力ターゲットを設定したあとは列挙した出力先だけに書き込むため、あとから現れた出力先（Claude Code を入れた直後の `~/.claude` など）にはスキル一覧が書かれず、理由も出ませんでした。チェックリストでチェックを外した操作を明示的な OFF として記録し、「まだ見ていない」と「外した」を区別できるようにしたうえで、初めて見つけた出力先は 1 度だけ通知してチェックリストへ誘導します

- 🔄 **A Renamed Source Repository Kept Its Old Name Forever** - Updating a source already resolved the repository's current name, but only the URL was saved, so the list kept showing the name the repository had when you added it. The display name and description now follow the rename and a notification names both sides. A name you set yourself is never overwritten, and the source ID stays put so installed skills keep their link / source を更新したとき、リポジトリの現在名はすでに解決できていたのに URL しか保存しておらず、一覧には追加当時の名前が残り続けていました。表示名と説明がリネームに追従し、通知で新旧の名前を出すようにしました。自分で付けた表示名は上書きせず、インストール済みスキルの紐付けが切れないよう source ID は据え置きます

- 📄 **The Global Copilot Skill List Was Written Where Nothing Reads It** - The user/global Copilot output went to `~/.copilot/instructions.md`, but VS Code injects `~/.copilot/copilot-instructions.md` into chat requests, so that list was never actually seen. The default output moved to `copilot-instructions.md` and the managed block left behind in the old file is cleaned up on the next sync; anything you wrote there yourself is kept / user/global の Copilot 出力先が `~/.copilot/instructions.md` でしたが、VS Code がチャットへ注入するのは `~/.copilot/copilot-instructions.md` のため、その一覧は実際には読まれていませんでした。既定の出力先を `copilot-instructions.md` に変更し、旧ファイルに残った管理ブロックは次回同期時に掃除します。自分で書いた本文は残ります

- 🧹 **Changing The Output File No Longer Blind-scans Seven Candidates** - Switching `instructionFile` used to strip managed blocks from a hardcoded list of seven candidate files in the first workspace folder, which also removed the sibling extension's legacy block and ignored every other folder in a multi-root workspace. Cleanup is now driven by an inventory of the files actually written last time, kept per workspace folder plus one bucket for user/global output, and it leaves the sibling extension's markers alone / `instructionFile` を変更したとき、最初のワークスペースフォルダーにある 7 つの候補ファイルから管理ブロックを総当たりで削除していたため、姉妹拡張の旧ブロックまで消え、multi-root の 2 つ目以降のフォルダーは掃除されませんでした。掃除は前回実際に書いたファイルの在庫から決めるようになり、在庫はワークスペースフォルダーごと + user/global 用の 1 束で保持し、姉妹拡張のマーカーには触れません

- 🔒 **Two Windows No Longer Overwrite Each Other's Global Skill List** - Reading, rewriting and saving a user/global instruction file and its catalog now happen inside a single shared-store lease, so a second VS Code window cannot land a lost update between the read and the write. If the lease cannot be taken the write is skipped for that cycle and retried on the next sync instead of being forced through / user/global の instruction ファイルと catalog の読み込み・書き換え・保存を 1 つの共有ストアリースの中で行うようにしたため、2 つ目の VS Code ウィンドウが読み書きの間に割り込んで更新を失わせることがなくなりました。リースを取得できない場合はその回の書き込みをスキップし、次の同期で再試行します

- 📁 **Empty Locations No Longer Get An Empty Skill List File** - A user/global location with no skills installed had an instruction file created for it containing only a "No skills installed yet" block. Files are no longer created for empty locations; once a skill lands there the list appears as usual, and existing files keep being updated / スキルが 1 つも入っていない user/global 出力先にも「No skills installed yet」だけの instruction ファイルが作られていました。空の出力先にはファイルを作らないようにし、スキルが入った時点で通常どおり一覧が出ます。既存ファイルはこれまでどおり更新されます

### Removed

- 🧹 **The Unused Tool-detection Cluster** - `toolDetector.ts` still carried an AI-tool detector and its picker, but nothing in the extension called them; the module only ever resolved the configured output format. The cluster and the source-pattern test that kept it looking alive were removed, and the module joined the reachability audit so it cannot grow another one / `toolDetector.ts` に AI ツール検出とその選択 UI が残っていましたが、拡張のどこからも呼ばれておらず、実際に使われていたのは出力フォーマットの解決だけでした。クラスタと、それを生きているように見せていたソース検査テストを削除し、到達性監査の対象に加えて再発しないようにしました

## [0.9.47] - 2026-08-18

### Changed

- 🌐 **The Chat Participant Now Speaks Japanese Too** - `@skill` and its `/search`, `/install`, `/list` and `/recommend` entries showed English descriptions in the chat picker even on a Japanese UI, because those manifest strings were the only user-facing contribution left without a localization placeholder. The invocation names stay untranslated so existing commands keep working / 日本語 UI でもチャットの候補一覧に `@skill` とその `/search`、`/install`、`/list`、`/recommend` の説明が英語のまま出ていた問題を修正しました。ローカライズ用のプレースホルダーが入っていない唯一のユーザー向け manifest 文言だったためです。呼び出し名は従来どおり英語のままなので、既存のコマンド入力はそのまま使えます

- 🧪 **Authentication Recovery Is Verified By Running It** - The auth-failure classification and the post-recovery retry moved out of `extension.ts` into a VS Code-free module with injected seams, so the retry path is now exercised by an executable test instead of being asserted with source patterns only. Behavior is unchanged; the composition root is built once and still hands the same closures to every command / 認証失敗の分類と復旧後の再試行を `extension.ts` から VS Code 非依存のモジュールへ移し、seam を注入して実挙動テストで検証するようにしました。挙動は変わらず、合成は 1 か所で 1 回だけ行い、各コマンドへ渡す closure も従来どおりです

### Removed

- 🧹 **Unreachable Exports And Stale Localization Keys** - Thirteen exported helpers that no production path and no test referenced were removed, together with the types, private helpers and imports that only they used. Four `config.*.description` keys left behind by the move to `markdownDescription` were dropped from both NLS tables. Two new guards keep this from returning: export reachability is computed from the extension entry graph with transitive liveness and now audits the authentication, shared-lock and newly cleaned modules, and every `%key%` in `package.json` must exist in both NLS tables with no unused keys left over / 本番からもテストからも参照されていない export 13 件と、それらだけが使っていた型・private helper・import を削除しました。`markdownDescription` への移行で置き去りになっていた `config.*.description` 4 件も両方の NLS テーブルから削除しています。再発防止として、拡張のエントリグラフから推移的に到達性を判定するガード（認証・共有ロック・今回掃除した module を監査対象にしています）と、`package.json` の `%key%` が両 NLS テーブルに存在し未使用 key が残らないことを検査するガードを追加しました

## [0.9.46] - 2026-08-18

### Added

- 🔁 **Failed Work Is Retried After You Fix Authentication** - Switching the active `gh` CLI account from the error notification now re-runs the operation that failed, instead of leaving you to repeat it. Install, Update Index, Update Source, and Add Source each hand back the arguments you already supplied, so nothing is asked twice, and a failure raised by the retry never offers another retry / エラー通知から `gh` CLI のアクティブアカウントを切り替えたとき、失敗した操作を自動でやり直すよう追加。インストール、インデックス更新、ソース更新、ソース追加は入力済みの引数をそのまま再利用するため同じ入力を求めず、再試行で発生した失敗からさらに再試行を提案することもない

### Changed

- 🔒 **Shared Store Lock Diagnostics And Test Seams** - The reclaim file prefix is now a named cross-extension contract constant, losing or failing to take the lock is classified as lease-lost or lock-unavailable and handled as an expected outcome by the shared manifest update instead of propagating as a crash, and the clock, process-liveness and generation sources can be injected so the stale and hard-stale windows are verified without waiting in real time. These designs are aligned with the sibling Agent Resources Ninja implementation / 回収時のファイル接頭辞を拡張機能間の契約定数として明示し、lock の喪失・取得失敗を lease 喪失／取得失敗として分類したうえで共有マニフェスト更新側が想定内の結果として扱うようにし（従来は例外がそのまま伝播）、時刻・プロセス生存・世代の生成元を差し替え可能にして stale と hard stale の窓を実時間待ちなしで検証できるようにしました。いずれも姉妹拡張 Agent Resources Ninja の実装に合わせています

### Removed

- 🧹 **Anonymous-Retry Helper That Nothing Called** - `retryGitHubRequestAnonymously` and the five tests that exercised only it were removed. The anonymous retry that actually runs lives in the shared GitHub fetch layer and keeps its own coverage, so the duplicate gave false confidence in a path the extension never took. A new guard fails the build when an exported helper in the authentication modules has no production caller / 本番から呼ばれていなかった `retryGitHubRequestAnonymously` と、それだけを検証していた 5 件のテストを削除。実際に動く匿名リトライは共通の GitHub fetch 層にあり別途テストされているため、重複は「通らない経路」への誤った安心感になっていました。認証系モジュールの export に本番呼び出し元が無い場合はビルドを落とすガードを追加しています

## [0.9.45] - 2026-08-18

### Fixed

- 🤝 **Sibling Extension Source Settings Are No Longer Erased** - A `scanner` value written by another Agent Ninja extension is now preserved verbatim on write-back instead of being dropped, and a source that declares a scanner this extension cannot run is skipped instead of being rescanned under substituted semantics, so its indexed skills are never replaced by results collected under different rules / 別の Agent Ninja 拡張が書いた `scanner` 値を書き戻しで捨てず原文のまま保持し、この拡張が実行できない scanner を宣言したソースは代替の走査規則で再走査せず見送るよう修正。別基準で収集した結果によるスキル上書きが起きなくなる
- 🔒 **Shared Store Lock Contention No Longer Escapes As An Error** - On filesystems without hard-link support, a lock collision now returns an acquisition failure that re-enters the retry loop instead of throwing out of it. Lock bodies are also read through a single file handle with a 4 KB cap, and retries back off exponentially / hard link 非対応のファイルシステムでロックが衝突した場合、例外で retry ループを抜けず取得失敗として再試行するよう修正。ロック本体は単一ファイルハンドル経由で 4 KB 上限付きで読み、再試行は指数バックオフする
- 🔑 **GitHub Authentication Errors Reach The Auth Help In Japanese** - Authentication failures were classified with English-only substrings, so Japanese messages fell through to a raw error instead of the auth help. Classification is now centralized and locale-aware, and HTTP status codes are matched with word boundaries so skill names or byte counts containing `401` / `403` / `429` are no longer treated as auth failures / 認証失敗を英語文字列のみで判定していたため、日本語メッセージが認証ヘルプではなく素のエラーになっていた問題を修正。判定を 1 か所へ集約して両言語対応にし、HTTP ステータスは語境界付きで照合するため `401` / `403` / `429` を含むスキル名やバイト数を認証エラーと誤判定しない
- 🌿 **Branch Names With Slashes Survive URL Building** - Git refs are now escaped per path segment everywhere, so a branch such as `feature/x` is no longer broken by whole-string encoding or left unescaped / Git ref を全箇所でパスセグメント単位にエスケープするよう統一。`feature/x` のようなブランチが一括エンコードで壊れたり未エスケープのまま残ったりしない

### Added

- 🔁 **Switch The Active gh CLI Account And Retry** - When the active `gh` account's credential cannot be used, the notification now names that account, distinguishes a rate limit from an invalid token, and offers to switch to another signed-in account after a confirmation that states the change applies to every `gh` command using the stored `github.com` credential, not just VS Code. `GH_TOKEN` and `GITHUB_TOKEN` still take precedence where they are set. The switch is verified before the failed source update is retried / アクティブな `gh` アカウントの資格情報が使えない場合に、そのアカウント名を示し、レート制限と無効なトークンを区別したうえで、別のログイン済みアカウントへの切り替えを提案するよう追加。切り替えが VS Code だけでなく、保存済みの `github.com` 資格情報を使う `gh` コマンド全体に適用されることを明示した確認を経て実行する（`GH_TOKEN` / `GITHUB_TOKEN` を設定している場合はそちらが優先）。成否を検証してから失敗したソース更新を再試行する

## [0.9.44] - 2026-08-18

### Fixed

- ⚠️ **Source Metadata No Longer Looks Like An Unsafe File Name** - A source-provided `.skill-meta.json` is still ignored and replaced with extension-owned metadata, but it no longer triggers the unsafe-file warning, telemetry count, or bulk-install excluded count. Genuinely unsafe path segments continue to be rejected and reported / 配布元が同梱した `.skill-meta.json` は従来どおり無視し、拡張が管理するメタデータへ置き換える一方、安全でないファイル名の警告・telemetry・一括インストールの除外件数には数えないよう修正。実際に危険なパスセグメントは引き続き拒否して報告する
- 🧭 **Preset Updates Keep Installable Paths And Stable Ownership** - The preset generator now excludes repository-root `SKILL.md` files that the installer cannot target, rejects empty paths in the bundled index, and prevents a partial source refresh from stealing a duplicate skill name from an untouched source. Index `v1.28.0` contains 1851 installable skills across 13 sources / preset generator でインストーラーが対象化できないリポジトリルートの `SKILL.md` を除外し、bundled index の空 path を拒否するとともに、source 限定更新が未更新 source の同名 skill を奪わないよう修正。index `v1.28.0` は13 source・1851件のインストール可能なskillを収録

## [0.9.43] - 2026-08-17

### Security

- 🛡️ **The Shared Sources Store Is Treated As Untrusted Input** - `%APPDATA%/agent-ninja/sources.json` is written by another extension, so its size is checked on the same file handle it is then read from, and an oversized file is rejected whole instead of being truncated. Every entry is validated: the id has to match a safe pattern, the URL has to be an `https://github.com/<owner>/<repo>` address whose owner and repo are not dot segments, a branch may not contain `.` or `..` because it goes straight into an API path, and `includePaths` / `excludePaths` have to be relative paths without `..`, drive letters or control characters. A bad entry is dropped on its own, while an over-cap entry count rejects the manifest, so a broken or hostile record never reaches a scan / `%APPDATA%/agent-ninja/sources.json` は別拡張が書くため、読み取るのと同じ file handle でサイズを確認し、上限超過は切り詰めずマニフェストごと拒否するよう変更。各 entry も検証し、id は安全な書式、URL は owner / repo が dot segment でない `https://github.com/<owner>/<repo>` のみ、branch は API path へそのまま入るため `.` や `..` を含めず、`includePaths` / `excludePaths` は `..`・ドライブレター・制御文字を含まない相対パスのみを受け付ける。壊れた entry はその entry だけ落とし、件数上限超過はマニフェスト全体を拒否するので、壊れた記録や悪意ある記録が走査へ届かない
- 🔒 **The Shared Store Lock Verifies Ownership** - The lock payload now carries a generation and is published atomically, so a lock is never observed empty. Release only deletes a lock this process still owns, a stale sweep reclaims by rename so only one process can win, and a stale lock whose owning process is still alive is left alone rather than stolen, with a hard cutoff so a reused PID cannot block the shared store forever. An unreadable leftover from a crash is reclaimed only once it is older than the stale window. A held lock is refreshed by a single-flight heartbeat that cannot resurrect a released lock, and the manifest write re-checks the on-disk generation immediately before it commits, so a process that stalled past the window cannot write with a lease it no longer holds / ロックの payload に世代を持たせ、中身ごと原子的に公開するよう変更（空のロックが見えない）。解放時は自分が保持しているロックだけを削除し、stale 回収は rename で 1 プロセスだけが勝ち、所有プロセスが生きている stale ロックは奪わない（PID 再利用で恒久停止しないよう上限時間あり）。クラッシュの残骸で読めないロックは stale 窓を過ぎたときだけ回収する。保持中のロックは single-flight の heartbeat で延長し、解放済みロックを書き戻さない。マニフェストの書き込みは commit 直前にディスク上の世代を再確認するので、停止中に契約を失ったプロセスは書けない

### Fixed

- 🗓️ **A Source's Freshness No Longer Comes From The Catalog Date** - `lastUpdated` is the bundled catalog's publish date and is no longer reused as a scan time, so a source this machine has never scanned is not reported as fresh, and scanning one source no longer makes every source look fresh. The terminal's own scan time is kept in `lastScannedAt` and per-source `lastIndexedAt` / `lastUpdated` は bundled カタログの発行日であり、走査時刻として流用しないよう修正。この端末で一度も走査していない source が新鮮扱いにならず、1 つ走査しただけで全 source が新鮮に見えることもなくなる。端末側の走査時刻は `lastScannedAt` と source ごとの `lastIndexedAt` が持つ
- 🔁 **A Shared Source Shows Whether This Extension Has Indexed It** - Scan history is read from the local index rather than the shared manifest, so a source registered by the sibling extension is listed as `not indexed` instead of showing another extension's timestamp next to `0 skills`. Syncing back no longer erases the other extension's scan stamps / 走査履歴は共有マニフェストではなくローカル index を正とするよう変更。姉妹拡張が登録した source は、別拡張の時刻を伴う `0 skills` ではなく `未インデックス` と表示される。共有ストアへ書き戻すときも、他拡張の走査時刻を消さない
- 🧹 **A Shared Manifest We Cannot Use Is Left Alone** - A manifest that fails validation is reported as rejected and never overwritten, quarantined or renamed, so a file the sibling extension is repairing, or one this version simply cannot accept, keeps its contents. The bootstrap only runs when the file is genuinely missing, and no write happens while any entry fails validation / 検証に通らないマニフェストは rejected として扱い、上書きも退避もリネームもしないよう変更。姉妹拡張が直している最中のファイルや、このバージョンが受け付けられないだけのファイルの中身が保たれる。bootstrap はファイルが本当に無いときだけ実行し、entry の検証に失敗している間は書き込まない
- 🔎 **A Rejected Shared Source Says So** - An entry dropped by validation is reported by id, or by position when the id itself is unsafe, so a source registered in the sibling extension does not disappear without a reason. `Explain Skill State` shows the same drops, and a source of ours that cannot be written back to the shared store is reported too / 検証で落とした entry を id 付き（id 自体が不正なら位置だけ）で報告するようにし、姉妹拡張で登録した source が理由もなく消えないよう修正。`スキル状態を診断` でも同じ内容を確認でき、共有ストアへ書き戻せなかった自分の source も報告する
- 🗑️ **Retired Preset Sources Are Removed On Merge** - A bundled index can now declare `retiredSources`, and merging removes those sources together with their skills and bundles instead of leaving a `0 skills` row behind. A retired skill is dropped rather than remapped onto a successor id, because its path belongs to the retired repository / bundled index が `retiredSources` を宣言できるようにし、merge 時に該当 source とその skill / bundle を取り除いて `0 skills` の行が残らないよう修正。退役 skill は後継 id へ付け替えず落とす（path が退役元リポジトリのものなので付け替えると 404 になる）

### Added

- ⏸️ **A Rate-Limited Source Update Can Be Resumed** - When GitHub rate limiting stops a batch, the remaining sources are remembered with the reset time and offered for resume, from the notification or the `Resume Deferred Source Index Update` command, and the automatic startup check resumes them once the limit has reset. The retry set is `failures ∪ skipped`, so the source that hit the limit is retried instead of being lost. Sources held back by the per-run update cap are carried in the same state and are resumable immediately, so a resume that is itself capped does not drop the rest / GitHub のレート制限でバッチが止まったとき、残りの source を reset 時刻とともに記録し、通知または `中断したソース更新を再開` コマンドから再開できるようにした。起動時の自動チェックも解除後に再開する。再試行集合は `failures ∪ skipped` なので、制限に当たった source 自身も取りこぼさない。1 回あたりの更新上限で持ち越した分も同じ state に載せ、reset 待ちなしで再開できるため、再開自体が上限に当たっても残りが消えない
- 🛑 **A Full Index Update Stops At The Rate Limit Instead Of Burning Through It** - Once a source fails with a rate limit, the remaining sources are guaranteed to fail too, so the run stops there, keeps every unscanned source's existing skills and bundles, and says which source it stopped on and how many were left / 全体更新で 1 つの source が rate limit で失敗したら残りも必ず失敗するため、そこで走査を止め、未走査 source の既存スキルと bundle をそのまま保持し、どの source で止まって何件残ったかを通知するようにした

### Changed

- 📚 **Preset Skill Index Updated** - The bundled index is refreshed to `v1.27.0` with 1852 skills across 13 sources / bundled skill index を `v1.27.0`・13 source・1852 skills へ更新
- 📝 **README Documents The Shared Source List Boundary** - Both READMEs now list the resume command and state that scan history is not shared, so a source only the sibling extension registered reads as `not indexed` until this extension scans it / 両 README に再開コマンドを追加し、走査履歴は共有しないこと（姉妹拡張だけが登録した source は自分で走査するまで `未インデックス`）を明記
- 🧪 **Startup Decisions Are Testable** - The stale-source decision (mode, daily prompt suppression, update) is a pure function outside `activate()`, leaving timers, I/O and notifications at the call site / stale source の判断（mode、1 日 1 回の prompt 抑止、更新）を `activate()` の外の純関数へ切り出し、タイマー・I/O・通知だけを呼び出し側に残した

## [0.9.42] - 2026-08-17

### Fixed

- 🔓 **A Token Without SAML SSO Authorization No Longer Blocks Public Sources** - When an organization rejects a credential with SAML SSO, that owner and token pair is remembered and the token is left off the following requests, so a public source such as MicrosoftDocs keeps updating anonymously instead of failing with `SSO authorization is required`. Other stored credentials are still tried, a credential already known to be blocked no longer repeats the same anonymous request nor gets forced onto raw content, and `404` responses keep their meaning so branch fallback is unaffected. Each index update entry point re-verifies a blocked credential once, so authorizing SSO elsewhere recovers without a reload, and the first credential dropped for an owner is logged by owner name without the token / organization が SAML SSO で credential を拒否したとき、その owner と token の組を覚えて以降のリクエストから token を外すよう修正し、MicrosoftDocs のような public source が `SSO 認可が必要です` で失敗せず匿名で更新できるようにした。他の保存済み credential は従来どおり試し、ブロック済みと分かっている credential で同じ匿名リクエストを繰り返さず raw content へも強制せず、`404` の意味も変えないのでブランチ fallback に影響しない。インデックス更新の各入口がブロック済み credential を 1 度再検証するため、別経路で SSO を認可すればリロードなしで回復し、owner ごとの初回の除外は token を含めず owner 名だけをログに残す
- 🧭 **The Reported Reason Is The Root Cause, Not The Last Attempt** - A credential walk that ends on a rate limit no longer hides the SAML SSO rejection that started it. The most root-causal `401` / `403` is the one reported / credential を順に試して最後が rate limit で終わっても、起点の SAML SSO 拒否が隠れないよう修正（最も根本原因に近い `401` / `403` を報告する）
- 📄 **License Lookups Stop Probing Files That Do Not Exist** - The repository tree is already complete when skills are scanned, so a license file missing from the tree is no longer requested. A large source no longer spends hundreds of requests on guaranteed `404`s / スキル走査時点で repository tree は完全なので、tree にない license ファイルを取得しないよう修正（大きい source で確定 `404` に数百リクエストを使わない）

### Added

- 🔑 **Open SSO Session From The Failure Notice** - A source index failure caused by SAML SSO now offers `Open SSO Session`, on the automatic stale-source update as well as the manual index update, single source update, and add source commands. Those command failures are now classified from the GitHub response instead of matching words in the message text. The link is taken from the `X-GitHub-SSO` header, validated against `https://github.com/orgs/.../sso` and `https://github.com/enterprises/.../sso`, and its `authorization_request` is dropped so the short-lived value is never stored or logged / SAML SSO で source index 更新が失敗したときに `SSO セッションを開く` を提示するよう追加。自動の stale source 更新に加えて、手動のインデックス更新、単一ソース更新、ソース追加コマンドでも表示する。これらのコマンドの失敗はメッセージ文字列の一致ではなく GitHub 応答の分類で判定するようにした。リンクは `X-GitHub-SSO` ヘッダーから取得し、`https://github.com/orgs/.../sso` と `https://github.com/enterprises/.../sso` で検証し、短命な `authorization_request` は保存もログ出力もしないよう落とす

## [0.9.41] - 2026-08-16

### Security

- 🔐 **PAT Setting Is No Longer Workspace-Settable** - `skillNinja.githubToken` is now machine-scoped, so a personal access token cannot be committed through `.vscode/settings.json`. Existing plaintext entries are detected in every settings scope, including each folder of a multi-root workspace, and offered for removal on startup. Only the value VS Code itself resolved is migrated to SecretStorage, so one folder's token is never promoted to the machine-wide credential, and the prompt says to copy the value first when a plaintext copy is not the one being kept. `Clear GitHub Token` clears the plaintext copies as well and reports a failure when one survives / `skillNinja.githubToken` を machine scope へ変更し、`.vscode/settings.json` 経由で PAT がコミットされないよう修正。既存の平文 entry は multi-root の各フォルダーを含む全設定スコープで検出し、起動時に削除を提案する。SecretStorage へ移行するのは VS Code 自身が解決していた値だけなので、あるフォルダーのトークンが machine 全体の資格情報へ昇格することはなく、保持されない平文が残る場合は値を控えるよう案内する。`GitHub トークンをクリア` は平文コピーも削除し、削除できなかった場合は失敗として報告する
- 🧱 **Confirmation Before Destructive Language Model Tools** - `#installSkill`, `#uninstallSkill`, `#addSkillSource`, `#removeSkillSource` and `#localizeSkill` now declare a confirmation. `#uninstallSkill` confirms the resolved skill together with its skill root and refuses to act when the name matches more than one installed skill, so the confirmed target is the one that gets deleted. Tool output tables escape interpolated names, descriptions and paths / `#installSkill`、`#uninstallSkill`、`#addSkillSource`、`#removeSkillSource`、`#localizeSkill` に確認ダイアログを追加。`#uninstallSkill` は解決済みのスキル名とスキルルートを確認し、複数一致する場合は何も削除しないため、確認した対象がそのまま削除対象になる。ツール出力の表に埋め込む名前、説明、パスもエスケープする

### Fixed

- 🗑️ **A Failed Reinstall Stays Recoverable** - Uninstall, the replace step of a reinstall, and cleanup after a failed install of a skill folder that already existed now move the folder to the trash, so a network failure right after the delete no longer destroys the only copy. Cleanup of a folder the install itself created still deletes directly, and the confirmation wording matches / アンインストール、再インストール時の置き換え、既存フォルダーへの上書きインストールが失敗したときの後片付けで、スキルフォルダーをごみ箱へ移動するよう修正（削除直後のネットワーク失敗で唯一のコピーを失わない）。そのインストールが自分で作ったフォルダーの後片付けは従来どおり直接削除し、確認文言も実際の削除方式に合わせた
- 🔑 **gh CLI Credential Is Reachable Behind A Stale Env Token** - `gh auth token` now runs without `GH_TOKEN` / `GITHUB_TOKEN` in its child environment, so a stale environment variable no longer makes gh return the same failing value. `GH_TOKEN` also takes priority over `GITHUB_TOKEN`, matching gh itself / `gh auth token` の子プロセスから `GH_TOKEN` / `GITHUB_TOKEN` を外し、古い環境変数のせいで gh が同じ失敗トークンを返す状態を解消。`GH_TOKEN` を `GITHUB_TOKEN` より優先し、gh 本体と同じ順序にした
- 🚦 **Rate Limit Is Not Reported As "Not Authenticated"** - The auth check now moves to the next credential only on `401`. Primary and secondary rate limits, SAML SSO authorization, and PAT policy rejections are kept apart with their own reason instead of being collapsed into one failure / 認証確認が次の資格情報へ進むのは `401` のときだけになり、primary / secondary rate limit、SAML SSO 承認、PAT ポリシー拒否をそれぞれ別の理由として保持するよう修正
- 🔕 **Startup Prompts Can Be Turned Off** - The plaintext-token prompt now offers `Don't ask again` and stops returning on every window; the dismissal is stored per workspace, so a token committed in a different workspace still surfaces there, and `Reset Settings (including token)` brings the prompt back. The "skills not found in index" startup warning gained `Do Not Check Again`, which excludes those skills from future reinstall checks instead of only offering that path after an index update, and it keeps working even when a skill's metadata cannot be written. A guard now walks every activation-time routine and fails when one can show a dialog with no way to stop it / 平文トークンのプロンプトに `今後表示しない` を追加し、ウィンドウを開くたびに再表示されないよう修正。抑止はワークスペース単位で保存するため、別ワークスペースにコミットされたトークンはそちらで通知される（`すべての設定をリセット（トークン含む）` で再表示できる）。「スキルがインデックスに見つかりません」の起動時警告に `今後確認しない` を追加し、インデックス更新後にしか出せなかった除外操作をその場で行えるようにしたうえ、スキルのメタデータを書き込めない場合でも選択が効き続けるようにした。起動時に走る処理を走査し、止める手段のないダイアログを出す実装を失敗させる guard を追加
- 🖱️ **Visible Actions Do Something Or Say Why** - `Copy URL` now works on source rows instead of returning silently and distinguishes "nothing selected" from "this item has no URL". `Copy URL` / `Copy Path` / `Open in Terminal` / `Edit whenToUse` / `Toggle Favorite` explain the reason when the selected item has nothing to act on, `Register` / `Unregister Local Skill` say so when the item is not a local skill or the write did not go through, and `Explain Skill State` says so when the item carries no skill metadata. A new guard runs the whole `view/item/context` contract, so a menu entry cannot be added for a context value the handler quietly ignores / ソース行の `Copy URL` が無言で終わらず動作し、「未選択」と「URL を持たない項目」を区別するよう修正。`Copy URL` / `Copy Path` / `Open in Terminal` / `whenToUse を編集` / `お気に入り切り替え` は対象がない場合に理由を表示し、`ローカルスキルを登録` / `登録解除` はローカルスキルでない場合や書き込みが通らなかった場合にその旨を伝え、`スキルの状態を説明` はスキル情報がない場合に理由を表示する。`view/item/context` の contract 全体を検査する guard を追加し、ハンドラーが黙って無視する context value にメニューを追加できないようにした

## [0.9.40] - 2026-08-15

### Security

- 🛡️ **Preview Trusts Nothing From A Source Index** - A star count taken from a source's own `search-index.json` or `registry.json` is now accepted only when it really is a finite non-negative number, and it is escaped before it reaches the preview. Previously a source could put markup in that field and have it rendered into the preview panel; the content security policy blocked scripts, but the markup and any image request it triggered were not / ソース側の `search-index.json` / `registry.json` が返すスター数を、有限の非負数のときだけ受け付け、プレビューへ渡す前にエスケープするよう変更（従来はこのフィールドにマークアップを入れるとプレビューに描画されていた。CSP がスクリプトは止めていたが、マークアップと画像リクエストは通っていた）
- 🎲 **Unguessable Preview Tokens** - The marker the renderer uses to park code blocks and links is now randomized per render, so a SKILL.md can no longer write that marker itself and have it replaced with another block of the same document. The webview nonce is generated with a cryptographic source instead of `Math.random` / レンダラがコードブロックやリンクを退避するマーカーを描画ごとにランダム化（SKILL.md 側が同じマーカーを書いて別ブロックの内容に差し替えることを防ぐ）。Webview の nonce も `Math.random` ではなく暗号論的乱数で生成する

### Fixed

- 🧩 **A Malformed Source Index No Longer Breaks Browsing** - Skill name, path, description, category and tags coming from a source's own index are accepted only as real strings, and an entry missing a usable name or path is skipped instead of being listed. Previously a wrong type in one entry could break the preview or the category list for the whole source / ソース側 index が返すスキル名、パス、説明、カテゴリ、タグを文字列のときだけ受け付け、名前かパスが使えないエントリは一覧に出さず読み飛ばすよう修正（従来は 1 件の型違いでソース全体のプレビューやカテゴリ表示が壊れることがあった）
- 🧾 **Bug Report Stays Openable** - The generated `issues/new` URL is now capped, and an oversized report is truncated with a visible marker instead of producing a `414 URI Too Long` page. The failing URL is also no longer repeated twice in each recorded download error, which roughly halves the error section / 生成する `issues/new` URL に上限を設け、超える場合は本文を切り詰めて明示するよう修正（`414 URI Too Long` でバグ報告そのものが開けなくなるのを防ぐ）。ダウンロード失敗の記録に同じ URL が 2 回入っていた重複も解消し、エラー欄がおよそ半分になる
- 🔑 **Bounded Credential Fallback** - The walk through stored credentials now stops after a fixed number of attempts and never retries a credential source that already returned the same token / 保存済み認証情報を順に試す処理に明示的な上限を設け、同じトークンを返したソースを繰り返し試さないよう修正
- ⏹️ **No Request After Cancel** - A cancelled request no longer starts the first attempt, and a retry no longer begins after the wait was cancelled / 中断済みのリクエストは初回の取得を開始せず、待機中に中断された再試行も次の取得を始めないよう修正

### Changed

- 🔍 **Redacted Request Diagnostics** - A request timeout now reports the host and path only, so query strings stay out of the error text. The full URL is still included in the bug report body / リクエストのタイムアウト表示をホストとパスだけに変更（クエリ文字列をエラー文へ残さない）。バグ報告の本文には従来どおり完全な URL を含める

## [0.9.39] - 2026-08-15

### Fixed

- ⏹️ **Cancel Stops Work Immediately** - Cancelling a bulk install now aborts the request that is already in flight, instead of waiting for it to finish. The signal reaches default-branch discovery, directory listing including symlink recursion, every file download, and the SKILL.md fallbacks, and an aborted probe ends branch discovery rather than falling through to the next branch and the repository API / 一括インストールのキャンセルが、実行中のリクエストを完了まで待たず中断するよう修正。中断はデフォルトブランチの探索、symlink 再帰を含むディレクトリ一覧、各ファイルの取得、SKILL.md のフォールバックまで届き、探索中の中断は次のブランチやリポジトリ API へ進まずその場で終了する
- ⏮️ **Cancel Stops At The Next File** - The skill being installed now stops at the next file or subdirectory boundary and is recorded as repairable, so `Repair Incomplete Skills` can finish it later. A cancelled install always leaves a SKILL.md, because the scanner only registers folders that have one / インストール中のスキルが次のファイルまたはサブディレクトリの手前で止まり、修復可能として記録されるよう修正（後から「不完全なスキルを修復」で仕上げられる）。走査は SKILL.md のあるフォルダしか登録しないため、中断しても SKILL.md は必ず残す
- 🔐 **Cancel Stops The Credential Walk** - A cancelled request no longer triggers the anonymous retry or the walk through the remaining stored credentials / 中断したリクエストから、匿名再試行や残りの認証情報を順に試す処理へ進まないよう修正
- 🗂️ **Windows Path Identity** - Skill root comparisons fold case on Windows, so a root written as `C:\Skills` and `c:\skills` is one root for the instruction-file update, the post-install reveal, and the repair notice / スキルルートの比較を Windows で大文字小文字を統一して行うよう修正（instruction ファイル更新、インストール後の選択、修復通知で同じルートとして扱われる）

## [0.9.38] - 2026-08-15

### Security

- 🔗 **Link-Aware Path Containment** - Creating a skill folder, writing any downloaded entry, and every recursive delete now resolve symlinks and junctions before trusting the path, so a link placed under a skill root can no longer redirect a write or a delete outside it. A broken link is refused instead of being treated as an unused name, and an entry that exists but cannot be resolved is refused rather than assumed safe / スキルフォルダの作成、ダウンロードした各エントリの書き込み、再帰削除のすべてで symlink / junction を解決してからパスを信用するよう変更（スキルルート配下に置かれたリンクでルート外へ書き込み・削除できないようにした）。リンク切れは「未使用の名前」ではなく拒否し、実体はあるのに解決できないエントリも安全とみなさず拒否する
- 🗑️ **Uninstall By Name** - A name like `foo!` sanitizes to the folder `foo`. If that folder exists it is now deleted only when its `.skill-meta.json` records the same skill; a folder owned by another skill, a hand-made local skill without metadata, and unreadable metadata are all refused / `foo!` のような名前はフォルダ `foo` にサニタイズされる。そのフォルダが実在する場合は `.skill-meta.json` が同じスキルを記録しているときだけ削除し、別スキルのフォルダ、メタデータの無い手作りローカルスキル、壊れたメタデータはいずれも拒否するよう変更
- 🏷️ **Install Target Ownership** - Before writing, an install compares the incoming source with the `.skill-meta.json` already in the target folder. A different or unidentifiable owner asks for confirmation, and confirming deletes the existing folder first; bulk runs count it as a failure instead of prompting / 書き込み前に、インストール先の `.skill-meta.json` が示す所有ソースとこれから入れるソースを比較するよう追加。所有者が違う、または特定できない場合は確認を求め、承認したときだけ既存フォルダを削除してから入れ直す（一括実行では確認を出さず失敗として数える）

### Added

- ♻️ **Retry Failed Installs** - After a bulk run, skills that failed with a `5xx` or a transport error are reinstalled in place exactly once, and whatever still fails offers a `Retry N failed` action that reruns only that subset. Rate limits, authentication failures, `404`, the subdirectory cap, cancellations, and unclassified errors are never retried automatically / 一括実行の後、`5xx` と通信エラーで失敗したスキルだけを削除せずその場で 1 回だけ入れ直し、それでも残る失敗には「失敗した N 件を再試行」を提示するよう追加（レート制限、認証失敗、`404`、サブディレクトリ上限、中断、分類できない失敗は自動リトライしない）
- 🩺 **Repair Incomplete Skills** - A new command reinstalls only the skills recorded as incomplete or partially downloaded, and the activation notice now routes there instead of reinstalling everything. The notice is gated by a fingerprint of the repair target set, so a problem that appears later is still reported / 不完全 / 一部未取得と記録されたスキルだけを入れ直すコマンドを追加し、起動時の通知の遷移先を全件再インストールから変更。通知は対象集合の fingerprint で制御するため、後から発生した問題も通知される
- ⏹️ **Cancellable Bulk Operations** - Reinstall All, per-root reinstall, multi-select reinstall, bundle install, Repair Incomplete Skills, and the retry action can all be cancelled. The current skill stops at the next file boundary and is recorded as incomplete, and each summary reports how many of the requested skills were actually processed / すべて再インストール、root 単位、複数選択、bundle インストール、不完全なスキルの修復、再試行のすべてをキャンセル可能にした。実行中のスキルは次のファイルの手前で止まり不完全として記録され、サマリには要求件数のうち実際に処理した件数を表示する

### Fixed

- ⚠️ **Partial Installs Reported Honestly** - When SKILL.md is real but other files could not be downloaded, the success notification is suppressed, the status bar shows the missing-file state, `.skill-meta.json` records `repairState`, and bulk summaries append how many skills installed with missing files. This now applies to every entry point including chat and the MCP tool / SKILL.md は取得できても他のファイルが落とせなかった場合、成功通知を出さず、ステータスバーに未取得がある旨を示し、`.skill-meta.json` に `repairState` を記録し、一括サマリに「一部ファイル未取得」の件数を加えるよう修正（チャットと MCP ツールを含む全経路に適用）
- ⏱️ **Failure Classification** - A request timeout and an HTTP `5xx` from the installer now carry a structured kind instead of a flattened message, so retry decisions no longer depend on string matching. A guessed default branch is no longer cached for the session, which used to turn one transient failure into 404s for every later fetch / インストーラー由来のタイムアウトと HTTP `5xx` が、文字列化されたメッセージではなく構造化された種別を持つよう修正（リトライ判定が文字列一致に依存しなくなった）。推測したデフォルトブランチをセッション中キャッシュしないよう変更（1 回の一時的失敗がその後の全取得を 404 にしていた）
- 🔍 **Browse Installed State** - The browse view now tracks installed skills per source, so a skill with the same name in another source is no longer shown as installed and can be installed / Browse ビューのインストール済み判定をソース単位にし、別ソースの同名スキルが installed 表示になってインストールできなくなる問題を修正
- 📅 **Source Index Freshness** - The global index date now advances only when every source was scanned successfully, so updating one source no longer makes the others look freshly indexed / index 全体の更新日を、全ソースの走査が成功したときだけ進めるよう修正（1 ソースの更新で他のソースまで新しく見える問題を解消）
- 🔕 **Bulk 404 Dialogs** - A bulk run no longer waits on a per-skill error dialog for each missing skill; those are reported in the final summary / 一括実行でスキルごとの 404 ダイアログを待たず、最後のサマリで報告するよう修正

## [0.9.37] - 2026-08-13

### Security

- 🛡️ **Install Path Containment** - Remote file and directory names from the GitHub Contents API are now validated as single path segments before any write, and every write / directory creation asserts it stays under the download root. `vscode.Uri.joinPath` joins POSIX-style, so a git file name such as `..\..\..\evil.txt` survived as one segment and escaped the install folder once converted to a Windows path / GitHub Contents API 由来のファイル名・ディレクトリ名を書き込み前に単一セグメントとして検証し、書き込みとディレクトリ作成のたびにダウンロードルート配下であることを確認するよう修正（`vscode.Uri.joinPath` は POSIX 結合のため `..\..\..\evil.txt` のような名前が 1 セグメントのまま通り、Windows パスへ変換された時点でインストール先の外へ出ていた）
- 🚫 **Untrusted Metadata Paths** - A source can ship its own `.skill-meta.json`, so the downloader no longer writes extension-owned metadata files, and `relativePath` / `packageParentRelativePath` are always recomputed from the position the scanner actually found instead of the value in the file. Previously that file-supplied path was passed straight to a recursive delete / 配布元が `.skill-meta.json` を同梱できるため、拡張が所有するメタデータファイルをダウンロードしないよう修正し、`relativePath` / `packageParentRelativePath` をファイルの値ではなく走査が実際に見つけた位置から常に再計算するよう変更（従来はファイル由来のパスがそのまま再帰削除へ渡っていた）
- 🧨 **Skill Root Deletion** - A skill name that sanitized to an empty string (any name made only of non-ASCII characters, brackets, or symbols) resolved to the skill root itself, so a failed download followed by Remove deleted the entire root. Folder names now always fall back to the remote path segment or a stable identity hash, and every recursive delete requires the target to be strictly inside its root / 空文字へサニタイズされるスキル名（非 ASCII のみ、括弧のみ、記号のみの名前）がスキルルート自身を指し、ダウンロード失敗後の削除でルートごと消えていた問題を修正（フォルダ名は配布元パスのセグメントまたは安定した識別子ハッシュへフォールバックし、再帰削除はルートの真配下であることを必須にした）
- 🔗 **Cross-Repository Fetch** - Remote repository paths are now rejected before URL construction when they contain `.` / `..` segments, separators, schemes, or their percent-encoded forms. `encodeURIComponent` passes `..` through unchanged and `%2e%2e` is normalized back to a parent segment, which could step over the owner / repo / branch prefix of a raw URL / 配布元リポジトリの相対パスに `.` / `..`、区切り、scheme、およびそのパーセントエンコード形が含まれる場合、URL 構築前に拒否するよう修正（`encodeURIComponent` は `..` を素通しし、`%2e%2e` も正規化で親セグメントへ戻るため、raw URL の owner / repo / branch を踏み越えられた）

### Fixed

- 🔢 **Bulk Uninstall Reporting** - Deleting all or multiple skills now counts actual successes and reports failures instead of always claiming the full requested count was deleted / 全件削除・複数選択削除で実際の成功件数を数え、失敗があればその件数を報告するよう修正（従来は要求件数をそのまま削除済みとして表示していた）
- 🔄 **Nested Metadata Refresh** - Metadata refresh now walks nested skills with the same recursive scan used elsewhere, instead of only direct children of a skill root / メタデータ再抽出をスキルルート直下だけでなく、他と同じ再帰走査でネストされたスキルも対象にするよう修正

### Added

- ⚠️ **Unsafe Entry Reporting** - Entries excluded by the new name policy are tracked separately from transfer errors, so a normal install is not downgraded to partial. A single install shows a dedicated warning, and Reinstall All / per-root reinstall / multi-select reinstall / bundle install add the excluded count to their final summary / 名前ポリシーで除外したエントリを転送エラーとは別チャネルで記録し、正常なインストールを partial へ降格させないよう追加。単体インストールでは専用の警告を出し、すべて再インストール / root 単位の再インストール / 複数選択の再インストール / bundle インストールでは最後のサマリに除外件数を加える
- 🩹 **Root Artifact Detection** - A skill root whose own `.skill-meta.json` records an empty install location, the signature of the empty-name bug, is reported once with a warning; nothing is deleted automatically. A plain `SKILL.md` at a root is a supported single-skill layout and is not flagged. The scan owns its own workspace state gate, so a workspace that already completed the incomplete-skill scan in an earlier version still receives it / 空文字フォルダ名バグの痕跡である「インストール位置が空の `.skill-meta.json` がルート直下にある」状態を 1 回だけ警告で通知するよう追加（自動削除は行わない）。ルート直下の `SKILL.md` 単体はルートを 1 スキルとする正規構成なので対象外。検出は専用の workspace state を持つため、旧バージョンで incomplete スキル検出を完了済みのワークスペースにも届く

### Changed

- 🧪 **Test Runner** - `npm test` now auto-discovers every `scripts/test-*.js` and runs them with bounded concurrency, buffering each script's output so only failures are printed in full, and prints a `DISCOVERED / TOTAL / PASSED / FAILED / ELAPSED` summary. The suite went from about 15s to about 5s. Set `SKILL_NINJA_TEST_CONCURRENCY=1` to run them serially; passing output stays suppressed either way, so run a single `node scripts/test-<name>.js` when you need its full log. The previous `&&` chain silently skipped every remaining test after the first failure and required manual updates for new test files / `npm test` が `scripts/test-*.js` を自動検出して上限付き並列で実行し、各 script の出力をバッファして失敗した分だけ全文表示し、`DISCOVERED / TOTAL / PASSED / FAILED / ELAPSED` を出力するよう変更（約 15 秒 → 約 5 秒。デバッグ時は `SKILL_NINJA_TEST_CONCURRENCY=1` で直列出力へ戻せる。従来の `&&` チェーンは最初の失敗以降を沈黙スキップし、新規テストの追記漏れも起きていた）

## [0.9.36] - 2026-08-07

### Added

- 🔁 **Rate-limit Aware Retry** - GitHub requests now share one backoff layer that retries `429` / `502` / `503` / `504` and transient network failures, honoring `Retry-After` and (when `x-ratelimit-remaining` is `0`) `x-ratelimit-reset`, capping the wait at 20 seconds and respecting caller cancellation; `401` / `403` / `404` stay out of the backoff and continue to use the authentication fallback / GitHub リクエストに共通のバックオフ層を追加し、`429` / `502` / `503` / `504` と一時的なネットワーク失敗を `Retry-After` と（`x-ratelimit-remaining` が `0` のとき）`x-ratelimit-reset` に従って最大 20 秒まで待機して再試行（`401` / `403` / `404` はバックオフ対象外で従来の認証フォールバックを継続）
- 🩺 **Incomplete Install Detection** - Installed skills whose `SKILL.md` is only placeholder content are surfaced once per workspace with a reinstall action that runs Reinstall All / `SKILL.md` がプレースホルダーのままのスキルをワークスペースごと 1 回だけ通知し、すべて再インストールを実行する再インストールの導線を提示
- ⚠️ **Incomplete Skill Badge** - Skills whose content is only a placeholder now show a red warning icon, an `Incomplete` description, and an incomplete status in the tooltip, including installs made before the flag existed, and their rows in the generated skill list are prefixed with `[incomplete]` / 内容がプレースホルダーのスキルを、赤い警告アイコン、`不完全` の説明、tooltip の状態表示で示すよう追加（フラグ導入前のインストールも対象）。生成されるスキル一覧の行にも `[incomplete]` を付与

### Fixed

- 🔐 **Credential Fallback Coverage** - A failing request now walks every remaining credential source instead of stopping unless the failing token came from SecretStorage, and repository file reads share the same fallback instead of hand-building an `Authorization` header / 失敗したリクエストが SecretStorage 起点のときだけでなく、残りの認証情報をすべて順に試すよう修正し、リポジトリファイル取得も同じフォールバックを共有するよう修正
- 🚫 **Placeholder Installs No Longer Report Success** - An install that could only write the generated template is now rejected and recorded as incomplete in `.skill-meta.json`; a single install offers Retry Install / Remove / Report Bug, while bulk operations suppress the per-skill dialog and report failures in their summary / 生成テンプレートしか書けなかったインストールを失敗として扱い、`.skill-meta.json` に不完全と記録するよう修正（単体インストールでは 再インストール / 削除 / バグ報告 を提示し、一括操作では個別ダイアログを抑制してサマリで報告）
- 📉 **Rate-limit Classification** - A `429` returned while reading repository files is now classified as a rate-limit failure so batched source updates short-circuit instead of treating the file as missing / リポジトリファイル取得中の `429` をレート制限失敗として分類し、ファイル欠損扱いせず一括ソース更新を短絡するよう修正
- 🐞 **Bug Report Accuracy** - Install bug reports now show the branch that was actually resolved, the classified failure kinds, and the recorded download errors instead of a literal `default` branch / インストールのバグ報告に、リテラルの `default` ではなく実際に解決された branch、分類された失敗種別、記録されたダウンロードエラーを載せるよう修正

## [0.9.35] - 2026-08-07

### Added

- 🛡️ **Repository Identity Guard** - Sources now store the GitHub numeric repository id and refuse to update when a URL starts resolving to a different repository, with a single aggregated warning / ソースに GitHub の数値リポジトリ ID を保存し、URL の参照先が別リポジトリに変わった場合は更新を拒否して 1 件の集約警告を表示するよう追加
- 🧭 **Source Scanner Contract** - Sources can declare `scanner` (`skill-md` / `claude-commands` / `top-level-dirs` / `registry-json`) so a repository rename can no longer silently change how a source is scanned / ソースに `scanner` を宣言できるようにし、リポジトリのリネームでスキャン方式が黙って変わらないよう追加
- 🧪 **Preset Completeness Gate** - `npm test` now verifies source referential integrity, empty sources, duplicate skill names, bundle references, `installOrder` consistency, README settings coverage, and documented output channel names / `npm test` にソース参照整合、空ソース、スキル名重複、bundle 参照、`installOrder` 整合、README 設定網羅、出力チャネル名の検証を追加

### Fixed

- 💾 **Empty Scan Protection** - A successful scan that returns zero skills no longer replaces an existing source's skills; the previous index is kept and the update is reported as failed / 取得結果が 0 件のスキャンで既存スキルを置き換えないよう修正し、既存インデックスを保持して更新を失敗として報告
- 🔗 **Repository Rename Following** - Repository scanning resolves the canonical `owner/repo` from GitHub and writes it back to the source URL instead of relying on redirects / リポジトリスキャンで canonical な `owner/repo` を解決し、リダイレクト頼みにせずソース URL へ書き戻すよう修正
- 📦 **Bundle Integrity** - Bundles are keyed by `source:id`, a rescanned source only replaces its own bundles when the scan produced any, and preset bundles removed from the bundled index are pruned from existing installs / bundle を `source:id` で識別し、再スキャンで bundle が得られた場合のみ置換して、bundled index から削除されたプリセット bundle を既存環境からも除去するよう修正
- 🚦 **Bounded Stale Updates** - Startup refreshes at most five stale sources per run, defers the rest to the `Agent Skills Ninja: Source Index` output channel, and reports progress against the full stale count / 起動時の更新を 1 回あたり最大 5 ソースに制限し、残りを `Agent Skills Ninja: Source Index` 出力チャネルへ繰り越して、stale 全件を分母に進捗を報告するよう修正
- 🗂️ **Preset Index Repairs** - Repointed the PRP source to its renamed repository, removed a bundle referencing skills that no longer exist, and dropped dangling bundle entries / PRP ソースをリネーム先へ付け替え、存在しないスキルを参照する bundle を削除し、宙に浮いた bundle 項目を整理
- 📝 **Settings Documentation** - `skillNinja.staleSourceIndexUpdateMode` was missing from both README settings tables and the following rows were misnumbered; both READMEs now document it plus the source index refresh behavior / `skillNinja.staleSourceIndexUpdateMode` が両 README の設定表から欠落し以降の番号がずれていた問題を修正し、ソースインデックス更新の挙動も追記

## [0.9.34] - 2026-07-31

### Added

- 🔑 **SecretStorage Recovery Command** - Added a SecretStorage-only GitHub token clear command, contextual recovery actions, and credential-source diagnostics without exposing token values / SecretStorage 専用の GitHub token クリアコマンド、状況に応じた復旧操作、token 値を露出しない認証元診断を追加

### Fixed

- 🔄 **Stale Credential Fallback** - Failed SecretStorage credentials now retry the next distinct environment, `gh` CLI, or legacy configuration credential, including credentials changed while a request is in flight / SecretStorage の古い認証情報が失敗した場合、request 中に認証元が変わったケースを含め、次の異なる環境変数・`gh` CLI・互換設定の認証情報で再試行するよう修正
- ⏱️ **Bounded GitHub Requests** - Shared GitHub requests now use bounded timeouts, preserve caller cancellation, and release timers and listeners after completion / 共通 GitHub request に timeout を適用し、呼び出し元のキャンセルを保持して完了後に timer と listener を解放するよう改善
- 🧵 **SecretStorage Mutation Safety** - Startup migration and token deletion are serialized so a completed clear cannot be undone by an in-flight migration, with localized success, empty, and failure feedback / 起動時 migration と token 削除を直列化し、clear 完了後に実行中の migration が token を復活させないよう修正して、成功・未保存・失敗の通知をローカライズ
- 🧭 **Private Branch Detection** - Source branch HEAD probes now use the bounded anonymous-first helper and retry private repositories with authentication only after an anonymous `404` / source branch の HEAD probe を timeout 付き匿名優先 helper へ統合し、private repository は匿名 `404` の後だけ認証付きで再試行するよう修正
- 🧪 **Authentication Regression Guards** - Added command-handler, migration-race, timeout, cancellation, private HEAD, fallback-order, manifest, and bilingual recovery coverage / command handler、migration 競合、timeout、キャンセル、private HEAD、fallback 順序、manifest、日英復旧導線の回帰テストを追加

## [0.9.33] - 2026-07-29

### Fixed

- 🔐 **GitHub Auth Source Recovery** - Public source content is fetched anonymously first, avoiding organization SAML SSO and stale-token failures, while private content retries with authentication only after an anonymous `404` and rate-limited requests preserve their original failures / public source content は最初に匿名取得して organization の SAML SSO と古い token の失敗を回避し、private content は匿名 `404` の後だけ認証付きで再試行して rate-limit request は元の失敗を維持するよう修正
- 🚦 **Rate-limit Short Circuit** - Stale source updates now stop after a GitHub API rate-limit failure and report remaining sources as not attempted instead of repeating the same failure across every source / stale source 更新は GitHub API の rate-limit 検知後に停止し、全 source で同じ失敗を繰り返さず残りを未試行として報告するよう修正
- 🔎 **Source Update Diagnostics** - Failure notifications now include a classified reason and recovery actions, with per-source results available in the `Agent Skills Ninja: Source Index` output channel / 失敗通知に分類済みの理由と復旧操作を追加し、source ごとの結果を `Agent Skills Ninja: Source Index` 出力チャネルで確認できるよう改善
- 🧭 **Source Update Feedback** - Multi-source progress now advances proportionally, partial results use one complete summary notification, and rate-limit reset times follow the active locale / 複数 source の進捗を正しい割合で表示し、部分結果を1件の完全な通知へ統合して、rate-limit の再試行時刻を現在の locale で表示するよう改善
- 🧪 **Source Update Regression Guards** - Added coverage for SAML fallback boundaries and sequential update behavior after rate-limit and non-systemic failures / SAML fallback の境界と、rate-limit および個別失敗後の順次更新動作を守る回帰テストを追加

## [0.9.32] - 2026-07-28

### Fixed

- 🔐 **Private Skill Raw Download** - Public raw content remains anonymous, while private GitHub raw files retry with authentication only after an anonymous `404` / public raw content は匿名取得を維持し、private GitHub raw file は匿名 `404` の後だけ認証付きで再試行するよう修正
- 🧭 **Auth-aware 404 Recovery** - Skill installation failures now distinguish missing GitHub authentication, insufficient `Contents: read` access, and outdated index paths, with direct recovery actions / skill install 失敗時に GitHub 認証未設定、`Contents: read` 権限不足、古い index path を区別し、直接復旧できる導線を追加
- 🧪 **Private Install Regression Guards** - Added coverage for public/private raw requests, authenticated retry boundaries, recovery actions, and token-safe bug reports / public/private raw request、認証再試行境界、復旧操作、token を漏らさないバグ報告の回帰テストを追加
- 🔄 **LifeOS Skill Source Migration** - Migrated the renamed PAI source to `danielmiessler/LifeOS`, refreshed its current skill paths, and updated the bundled index to `v1.25.0` with 1376 installable skills / rename・再構成された PAI source を `danielmiessler/LifeOS` へ移行し、現行 skill path を再取得して bundled index を `v1.25.0`・1376 installable skills に更新

## [0.9.31] - 2026-06-30

### Fixed

- 🛡️ **Skill Index Resilience** - Browse view, Chat participant, and MCP tools now tolerate malformed runtime skill index objects without crashing on missing `skills` arrays / Browse view、Chat participant、MCP tools が runtime の skill index で `skills` 配列が欠損していてもクラッシュしないよう改善
- 🧪 **Malformed Index Regression Guards** - Added regression and contract coverage to prevent direct `index.skills` dereferences from returning to user-facing paths / ユーザー向け経路に直接 `index.skills` 参照が戻らないよう、回帰テストと contract guard を追加
- 🧹 **Preset Skill Index Cleanup** - Pruned stale uninstallable entries and refreshed the bundled skill index to `v1.24.0` with 1375 installable skills / インストールできない stale entry を整理し、bundled skill index を `v1.24.0`・1375 件の installable な状態へ更新

## [0.9.30] - 2026-06-25

### Added

- 🔐 **SecretStorage GitHub Auth** - GitHub tokens are now resolved from VS Code SecretStorage first, with legacy `skillNinja.githubToken` values copied into secure storage for backward compatibility / GitHub token は VS Code SecretStorage を最優先で解決し、互換用 `skillNinja.githubToken` の値は安全な保存先へコピーするよう変更
- 🧪 **GitHub Auth Regression Tests** - Added coverage for SecretStorage precedence, legacy token migration, reset deletion, and symlink installer traversal / SecretStorage の優先順位、legacy token migration、reset 時削除、symlink installer traversal の回帰テストを追加

## [0.9.29] - 2026-06-24

### Added

- 🔄 **Stale Source Index Updates** - Source repositories now track per-source index timestamps and can prompt, auto-update, or skip startup updates when a source index is older than 30 days via `skillNinja.staleSourceIndexUpdateMode` / source repository ごとの index 更新日時を保持し、30 日を超えて古い source index を起動時に確認・自動更新・無効化できる `skillNinja.staleSourceIndexUpdateMode` を追加
- 🧪 **Source Index Freshness Tests** - Added regression coverage for stale source detection and shared manifest timestamp preservation / 古い source index の判定と shared manifest での timestamp 保持を守る回帰テストを追加

### Fixed

- 🌐 **Chat Participant Localization** - Routed chat participant followups and response text through runtime i18n and added a guard against hardcoded English chat copy / Chat Participant の followup と応答文を runtime i18n 経由にし、英語固定文言の再発を防ぐ guard を追加
- 🌐 **MCP Error Localization** - Routed MCP tool workspace/root availability and short failure responses through localized helpers, with guards against hardcoded English workspace errors / MCP tool の workspace/root 利用不可エラーと短い失敗応答をローカライズ helper 経由にし、英語固定の workspace error を防ぐ guard を追加
- 🔁 **Stale Source Refresh Feedback** - Refresh the remote skill view after stale source update attempts even when all sources fail, so the UI stays in sync with the attempted recovery path / stale source 更新試行後は全 source が失敗した場合も Remote Skills view を更新し、復旧試行後の UI 同期を保つよう修正

## [0.9.28] - 2026-06-21

### Added

- 🔒 **Private Source Repositories** - Source repositories can now be added from private GitHub repositories. File reads (`SKILL.md`, `bundle.json`, `LICENSE*`, `registry.json`, `docs/search-index.json`, `.claude/commands`) go through the authenticated GitHub Contents API, using `skillNinja.githubToken`, `GITHUB_TOKEN` / `GH_TOKEN`, or `gh` CLI auth / Private な GitHub repository を source として追加できるよう対応。ファイル取得を認証付き GitHub Contents API 経由にし、`skillNinja.githubToken`・`GITHUB_TOKEN` / `GH_TOKEN`・`gh` CLI 認証を利用
- 🗑️ **Remove Skill Source Tool** - Added the `#removeSkillSource` language model tool to remove a source repository (resolved by `sourceId`, `repoUrl`, or `sourceName`) and prune its skills and bundles from the index / source repository を index から削除する `#removeSkillSource` ツールを追加（`sourceId` / `repoUrl` / `sourceName` で対象を解決し、skills と bundles を整理）

### Fixed

- 🛡️ **Truncated Tree Guard** - Repository scans now fail explicitly when the GitHub Git Trees API response is truncated, avoiding silent partial indexing of large repositories / GitHub Git Trees API のレスポンスが truncated の場合は明示エラーにして、大規模 repository の部分 index 化を防止
- 🔑 **Private Repo Auth Errors** - `404` / `403` responses while scanning a source now explain that GitHub authentication or `Contents: read` access may be required / source scan 中の `404` / `403` で、GitHub 認証や `Contents: read` 権限が必要な可能性を示す文言に改善

## [0.9.27] - 2026-06-21

### Added

- 🧭 **OMX Skill Source** - Added `Yeachan-Heo/oh-my-codex` as a community preset source and refreshed the bundled skill index to `v1.23.0` with 1456 installable skills / `Yeachan-Heo/oh-my-codex` を community preset source として追加し、bundled skill index を `v1.23.0`・1456 件の installable な状態へ更新
- 🧪 **Preset Path Filter Guard** - Added regression coverage for preset source `includePaths` / `excludePaths` and bundled OMX skill paths / preset source の `includePaths` / `excludePaths` と bundled OMX skill path を守る回帰テストを追加

### Fixed

- 🧰 **Preset Source Path Filters** - Preset index updates now honor `includePaths` and `excludePaths`, keeping scoped sources limited to their intended skill folders / preset index 更新時に `includePaths` と `excludePaths` を尊重し、scoped source が意図した skill folder だけを取り込むよう修正
- 🛡️ **Installability Filter Audit** - Installability audits now reject skills outside their source path filters and reuse the preset updater filter logic / installability audit が source path filter 外の skill を検出し、preset updater と同じ filter logic を再利用するよう修正

## [0.9.26] - 2026-06-16

### Added

- 🧩 **Additional Workspace Skill Roots** - Added `skillNinja.additionalSkillRoots` so repo-local skill folders such as `copilot-skills/skills` and `copilot-skills/m-skills` can be discovered alongside `.github/skills` / `skillNinja.additionalSkillRoots` を追加し、`copilot-skills/skills` や `copilot-skills/m-skills` のような repo-local skill folder を `.github/skills` と並べて検出できるよう追加
- 🧪 **Multi-root Workspace Output Coverage** - Added regression coverage for multiple workspace skill roots sharing one instruction block and ref catalog, including mixed slash/backslash path handling / 複数 workspace skill root が 1 つの instruction block と ref catalog を共有するケース、および slash/backslash 混在パスを守る回帰テストを追加

### Fixed

- 🔄 **Workspace Skill Root Refresh** - Changing workspace skill root settings now refreshes views, recreates `SKILL.md` file watchers, and regenerates the shared skill output without requiring a reload / workspace skill root 設定を変更したときに、reload なしで view refresh、`SKILL.md` watcher の再作成、共有 skill output の再生成が走るよう修正
- 🧭 **Multi-root Instruction Output** - Workspace roots that share the same instruction file now aggregate their skills into the same generated block instead of overwriting each other root-by-root / 同じ instruction file を共有する workspace root は、root ごとの上書きではなく同じ生成ブロックへ skill を集約するよう修正

## [0.9.25] - 2026-06-14

### Added

- 🌐 **Google Official Skill Source** - Added `google/skills` to the bundled preset index and refreshed the bundled skill index to `v1.22.0` with 1410 installable skills / プリセットインデックスに `google/skills` を追加し、bundled skill index を `v1.22.0`・1410 件の installable な状態へ更新

### Fixed

- 🛟 **Primary SKILL.md Install Recovery** - When GitHub Contents directory listing fails, the installer now falls back to the primary raw `SKILL.md` and still writes installed-skill metadata / GitHub Contents API のディレクトリ一覧取得に失敗した場合でも、primary raw `SKILL.md` を直接取得し、installed-skill metadata まで保存するよう修正

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

[Unreleased]: https://github.com/aktsmm/vscode-agent-skill-ninja/compare/v0.9.30...HEAD
[0.9.30]: https://github.com/aktsmm/vscode-agent-skill-ninja/compare/v0.9.29...v0.9.30
[0.9.29]: https://github.com/aktsmm/vscode-agent-skill-ninja/releases/tag/v0.9.29
[0.9.24]: https://github.com/aktsmm/vscode-agent-skill-ninja/releases/tag/v0.9.24
[0.9.23]: https://github.com/aktsmm/vscode-agent-skill-ninja/releases/tag/v0.9.23
[0.9.22]: https://github.com/aktsmm/vscode-agent-skill-ninja/releases/tag/v0.9.22
[0.9.8]: https://github.com/aktsmm/vscode-agent-skill-ninja/releases/tag/v0.9.8
[0.9.7]: https://github.com/aktsmm/vscode-agent-skill-ninja/releases/tag/v0.9.7
