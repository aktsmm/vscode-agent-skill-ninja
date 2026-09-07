---
description: "Release workflow rules for package metadata, changelog, and VSIX artifacts"
applyTo: "**/package.json,**/CHANGELOG.md,**/*.vsix"
---

# VS Code 拡張リリース手順

## ⚠️ 重要: テストファーストの原則

**コードを変更したら、ビルド・リリース前に必ずテストを実行すること！**

### Release Sequence Guardrail

- `release` 明示時は、品質 gate → VSIX 作成/検査 → Marketplace publish → GitHub Release → tag/公開状態確認まで進める。commit/push だけで release 完了扱いにしない。
- **最初の外部ゲートとして、版上げ・index再生成・audit fix・VSIX作成より前に** `pwsh -NoProfile -File scripts/Test-ReleaseCredentials.ps1` を実行する。候補版が決まっている場合は `-ExpectedVersion X.Y.Z` も渡す。期限切れ・権限不足・同版公開済みなら、この時点で停止し、tracked release metadataを変更しない。
- preflight は User スコープの `VSCE_PAT` を Process へ読み直し、PAT をCLI引数やログへ出さない。PAT はチャットやrepoへ保存せず、Azure DevOpsで `Marketplace > Manage` と将来の有効期限を設定する。
- `vsce package` 後、publish前に `pwsh -NoProfile -File scripts/Test-ReleaseArtifact.ps1 -VsixPath <path> -ExpectedVersion X.Y.Z` を通す。収録物の有無だけでなく、パッケージ内Changelogの版とコードフェンス外の端末・秘密入力 transcript 汚染を検査する。
- version bump 後に publish へ進めない blocker が出たら、`Version / VSIX / Publish / GitHub Release / Tag` の状態を分けて報告し、同じ version を再利用してよい状態か確認する。
- blocker 後の再開では `git status`、候補版のMarketplace不在、remote HEAD、VSIXのSHA256を再確認する。source/metadataがcheckpoint作成後に変わっていれば、古いVSIXを公開せず品質gateとpackageをやり直す。Marketplace publish成功前に「公開済み」を示すtag/GitHub Releaseを作らない。
- `npm audit fix` で `package-lock.json` が変わった場合は、`npm test` と package metadata 同期を再確認し、dirty tree のまま tag / publish へ進まない。

### テスト実行（必須）

```bash
# 1. TypeScript コンパイル & Lint（型エラー・構文エラーの検出）
npm run compile

# 2. 回帰テスト一式
npm test
```

### テストが必要なケース

| 変更内容                 | 必須テスト                                                     |
| ------------------------ | -------------------------------------------------------------- |
| `instructionManager.ts`  | `npm run compile` + 手動で Update Instruction File 確認        |
| `skillInstaller.ts`      | `npm run compile` + 手動でスキルインストール確認               |
| `skillIndex.ts`          | `npm run compile` + インデックス読み込み確認                   |
| `indexUpdater.ts`        | `npm run compile` + ソース更新・追加確認                       |
| `treeProvider.ts`        | `npm run compile` + TreeView 表示確認                          |
| `i18n.ts`                | `npm run compile` + 日英両方で UI 確認                         |
| `skillSearch.ts`         | `npm run compile` + `node scripts/test-search-logic.js`        |
| スキルスキャン範囲       | `npm run compile` + `node scripts/test-skill-scan-paths.js`    |
| 登録状態 / 共存マーカー  | `npm run compile` + `node scripts/test-local-skill-scanner.js` |
| When to Use 抽出ロジック | `node scripts/test-whenToUse.js`                               |

### 結合テスト（手動）

新機能やバグ修正後、以下を手動確認：

1. **スキルインストール** - リモートスキルをダブルクリックでインストール
2. **スキルアンインストール** - インストール済みスキルを右クリック → アンインストール
3. **AGENTS.md 更新** - Update Instruction File コマンドで正しく更新されるか
4. **設定変更** - instructionFile を変更して古いファイルがクリーンアップされるか
5. **ソース更新** - リモートスキルのソースを右クリック → Update Source

## クイックリリース（ドキュメント修正など軽微な変更）

⚠️ **コード変更がある場合は必ずテストを実行すること！**

変更をコミット済みの場合、以下のコマンドで一括リリース：

```bash
New-Item -ItemType Directory -Force artifacts/vsix | Out-Null
npx vsce package --out artifacts/vsix/agent-skill-ninja-X.X.X.vsix && npx vsce ls && npx vsce publish --packagePath artifacts/vsix/agent-skill-ninja-X.X.X.vsix && gh release create vX.X.X artifacts/vsix/agent-skill-ninja-X.X.X.vsix --title "vX.X.X - タイトル" --notes "リリースノート"
```

軽微な変更でも、`npx vsce ls` による VSIX 収録物確認は省略しないこと。
リリース後は `artifacts/vsix/` 配下の VSIX を **最新 10 件だけ残す**。

## フルリリース手順

### 1. テスト実行（必須）

コード変更がある場合は、必ずテストを実行すること：

```bash
# TypeScript コンパイル & Lint
npm run compile

# 回帰テスト一式
npm test

# プリセット skill index の installability 監査
node scripts/audit-skill-installability.js --raw-only
```

**テストが全て PASS していることを確認してからリリースに進む。**

プリセット source の内容を更新した場合は、監査の前に `node scripts/update-preset-index.js` で `resources/skill-index.json` を再生成する（特定 source だけなら `$env:SKILL_NINJA_SOURCES = "<source-id>"` を付ける）。再生成後は `node scripts/test-update-preset-index.js` の完全性ゲート（bundle 参照の実在、source ごとの 0 件検知、skill 名重複、truncated tree 拒否）が PASS することと、`package.nls.json` / `package.nls.ja.json` のバージョン情報ブロックが index の `version` / `lastUpdated` / 件数と一致することを確認する。

`audit-skill-installability.js --raw-only` は source ごとの件数差が大きく、`composio-awesome` のような大規模 source では silent に数分かかることがある。3 分以上無出力で不安定なら、`--sources=<source-id>` で分割実行し、ログを `artifacts/` に逃がして PASS/FAIL を source 単位で判定する。

新しい回帰テスト script は `scripts/test-<name>.js` に置く。`npm test` は `scripts/run-skill-tests.js` が `scripts/test-*.js` を自動検出して全件実行するため、`package.json` への追記は不要になった。命名が違うと検出されないので、追加後は `npm test` の `DISCOVERED` 件数が増えたことを確認する（2026-05-11 追記 / 2026-08-13 自動検出へ更新）。

各 script は mkdtemp 配下でしか書き込まない前提で並列実行する。新規 script で repo 内の固定パスへ書くと並列時に衝突するので、一時ファイルは必ず `fs.mkdtempSync` 配下に置く。`SKILL_NINJA_TEST_CONCURRENCY=1` で直列実行に戻せるが、成功した script の出力はどちらでも抑制されるので、全ログが要るときは `node scripts/test-<name>.js` を単体で実行する。2026-08-13 時点で並列 4.8 秒 / 直列 14.2 秒。

### 2. バージョン更新（必須）

リリース時は以下の **4 ファイルを同時に** 更新すること：

| ファイル              | 更新箇所                                                      |
| --------------------- | ------------------------------------------------------------- |
| `package.json`        | `version` フィールド                                          |
| `package.nls.json`    | `config.versionInfo.markdownDescription` 内のバージョン・日付 |
| `package.nls.ja.json` | 同上（日本語版）                                              |
| `CHANGELOG.md`        | リリースノート追加（日付・変更内容）                          |

### 3. CHANGELOG の書き方

- **英日併記形式**（`English / 日本語`）
- 絵文字 + **太字タイトル** + 英語説明 / 日本語説明

例:

```markdown
### Fixed

- 🐛 **Skill Install Fix** - Fixed issue / 問題を修正
```

### 4. コミット（必要時のみ push）

```bash
git add .
git commit -m "[Release] vX.X.X - 変更内容の要約"
# 公開同期が明示的に必要な場合だけ push する
git push origin master  # ⚠️ main ではなく master
```

push や tag push は、ユーザーがリモート同期まで依頼した場合だけ実行する。ローカル release 準備だけなら commit までで止める。

### 5. パッケージ作成 & VSIX 収録物確認

```bash
npm run compile          # ビルド確認
New-Item -ItemType Directory -Force artifacts/vsix | Out-Null
npx vsce package --out artifacts/vsix/agent-skill-ninja-X.X.X.vsix  # VSIX パッケージ作成
npx vsce ls              # VSIX 収録物確認
```

`npx vsce ls` の出力に、runtime と Marketplace 表示に必要なファイル以外が入っていないことを確認する。

`npx vsce ls` が prepublish ログだけを返す、または出力確認が不安定な場合は、生成済み `.vsix` を zip として直接列挙して収録物を確認すること（例: PowerShell で `System.IO.Compression.ZipFile` を使う）。この場合も、以下の不要物チェックは省略しない（2026-05-11 / GitHub Copilot）。

特に以下が含まれていたら、`.vscodeignore` を修正してから `npx vsce package` と `npx vsce ls` をやり直すこと：

- `.github/**`
- `.vscode/**`
- `.vscode-test/**`
- `scripts/**`
- `src/**`
- `node_modules/**`
- `output_*`
- `AGENTS.md.backup`
- `compile-output.txt`
- `DASHBOARD.md`
- `robots.txt`
- README で参照している画像 / GIF / 動画（`docs/**` 等） — Marketplace は `repository.url` を base にして `raw.githubusercontent.com` から自動解決するため VSIX 同梱不要（2026-05-12 / GitHub Copilot）
- その他 runtime に不要なローカル作業成果物、ログ、バックアップ

`vsce package` の完了出力が見えないケース（terminal 出力タイミングのバグ）でも、`Get-ChildItem artifacts/vsix/<file>.vsix` で生成サイズを見て完了を判定する。期待サイズより著しく小さければビルド中断、著しく大きければ不要ファイル混入の準拠とする（2026-05-12 / GitHub Copilot）。

`npm run package` / `vsce package` が prepublish ログ途中で戻る場合は、同じコマンドを繰り返さず、`tsc --noEmit`、`eslint src` 相当、`node esbuild.js --production` を構成要素ごとに確認し、VSIX の存在・サイズ・zip 展開結果を正本にする。

`vsce package` が prepublish / lint 付近で止まり VSIX が出ないが、`npm run compile`、`npm test`、audit、`node esbuild.js --production` が通る場合は、通常 CLI の反復をやめ、VSIX 作成だけを隔離する。一時 `%TEMP%` 配下に `@vscode/vsce` を置き、品質 gate 通過後に VSCE の `pack` API で `artifacts/vsix/` へ出す fallback を使ってよい。ただし fallback で作った VSIX も、サイズ、zip 収録物、`code --install-extension` を必ず確認し、fallback 用 script / task / 一時 install は公開完了前に削除する（2026-06-21 / GitHub Copilot）。

### 5.1 VSIX install 検証（publish 前に必須）

`vsce ls` だけでは VSIX 作成中の zip 破損（`End of central directory record` エラー等）を検出できない。生成後は必ずローカル VS Code へ install テストを走らせてセルフチェックする（2026-05-12 / GitHub Copilot）。

```pwsh
$cli = "C:\Users\$env:USERNAME\AppData\Local\Programs\Microsoft VS Code\bin\code.cmd"
& $cli --install-extension artifacts\vsix\agent-skill-ninja-X.X.X.vsix --force
# Error: End of central directory record signature not found ... が出たら
# VSIX が truncate しているので再生成する
```

`Developer: Reload Window` だけでは、ワークスペースの未インストール変更は読まれず、既に入っている Marketplace / VSIX 版を再読込するだけのことがある。ローカル修正版の実機確認は、**生成した VSIX を `code --install-extension ... --force` で入れ直してから reload** するか、Extension Development Host (`F5`) を使うこと（2026-05-23 / GitHub Copilot）。

`vsce ls` が prepublish ログだけを返す・出力不安定な場合は、生成済み `.vsix` を zip として直接列挙して収録物を確認する（例：PowerShell で `tar -xf <vsix> -C <tmpdir>` または `System.IO.Compression.ZipFile`）。この場合も、上記の不要物チェックは省略しない（2026-05-11 / GitHub Copilot）。

### 6. Marketplace 公開

```bash
npx vsce publish --packagePath artifacts/vsix/agent-skill-ninja-X.X.X.vsix  # Marketplace に公開
```

対象バージョンの publish が `already exists` を返した場合、そのバージョンは Marketplace 側で公開済みと扱ってよい。ただし Marketplace metadata は反映遅延することがあるため、GitHub Release、VSIX asset、必要なら後続の `vsce show` で別経路確認を続ける（2026-05-11 / GitHub Copilot）。

Marketplace の public HTML ページ（`items?itemName=...`）も publish 直後は stale な version 表示のまま残ることがある。HTML が旧版を出していても、`vsce publish` 成功出力、`gh release view vX.Y.Z`、`git ls-remote --tags origin vX.Y.Z` が揃っていれば、即座に version bump や再 publish を行わず、反映待ちとして扱う（2026-05-17 / GitHub Copilot）。

`vsce show --json` も publish 直後は旧版を返すことがある。publish 成功出力と GitHub Release / remote tag が揃っている場合は stale として記録し、再 publish ではなく時間を置いて再確認する。

v0.9.28 では `vsce show --json` が 0.9.28 publish 成功直後に古い version 一覧を返した。`DONE Published ... v0.9.28`、GitHub Release asset、remote tag が揃っていれば Marketplace 側は反映遅延として扱い、追加 version bump しない（2026-06-21 / GitHub Copilot）。

#### 公開完了の判定は成果物のハッシュで行う

`vsce show` と Marketplace の HTML は反映遅延で旧版を返すので、**公開完了の正本にしない**。version を固定して成果物を実際に取得し、ローカル VSIX とサイズ + SHA256 が一致することを確認する。

```pwsh
$version = "X.Y.Z"
$local = "artifacts/vsix/agent-skill-ninja-$version.vsix"
$marketplace = "$env:TEMP/mp-$version.vsix"
$release = "$env:TEMP/gh-$version.vsix"

$url = "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/yamapan/vsextensions/agent-skill-ninja/$version/vspackage"
Invoke-WebRequest -Uri $url -OutFile $marketplace -Headers @{ "Accept-Encoding" = "gzip" }
gh release download "v$version" --pattern "*.vsix" --output $release --clobber

Get-FileHash $local, $marketplace, $release -Algorithm SHA256 |
	Select-Object Hash, Path
Get-Item $local, $marketplace, $release | Select-Object Length, Name
```

3 つの Hash が一致し、Length も揃っていれば公開完了とする。一致しない場合は再 publish の前に、どの経路が古いのかを切り分ける。取得した一時 VSIX は確認後に削除する。

### 7. GitHub Release 作成

```bash
gh release create vX.X.X artifacts/vsix/agent-skill-ninja-X.X.X.vsix --title "vX.X.X - タイトル" --notes "リリースノート"
```

PowerShell で release の JSON を確認するときは、`--json` の field list を 1 引数としてクォートすること。クォートしないと `accepts at most 1 arg(s)` で失敗する。

```pwsh
gh release view vX.X.X --json "tagName,name,url,isDraft,isPrerelease,publishedAt"
```

`gh` を複数アカウントで使っている環境では、release 作成前に `gh auth status` で **active account** を確認すること。対象 repo の owner ではない account が active だと、`gh release create` が `workflow scope may be required` などの誤解しやすい権限エラーで失敗することがある。必要なら release 前に正しい account へ切り替え、完了後に元へ戻す（2026-05-23 / GitHub Copilot）。

tag が指す commit を PowerShell で確認するときは、`git rev-parse vX.Y.Z^{}` を裸で実行しないこと。`^{}` が ScriptBlock として解釈され、別の revision を見ているような結果になる。`git rev-list -n 1 vX.Y.Z` を使うか、revision 全体をシングルクォートで囲む。

### 8. ローカル VSIX の整理

```bash
$vsixDir = "artifacts/vsix"
Get-ChildItem $vsixDir -Filter "agent-skill-ninja-*.vsix" |
	Sort-Object { [version]($_.BaseName -replace '^agent-skill-ninja-', '') } -Descending |
	Select-Object -Skip 10 |
	Remove-Item -Force
```

ルート直下には `.vsix` を置かず、`artifacts/vsix/` に集約すること。

## ワンライナー（コミット済み & テスト済みの場合）

```bash
New-Item -ItemType Directory -Force artifacts/vsix | Out-Null; npx vsce package --out artifacts/vsix/agent-skill-ninja-X.X.X.vsix; npx vsce ls; npx vsce publish --packagePath artifacts/vsix/agent-skill-ninja-X.X.X.vsix; gh release create vX.X.X artifacts/vsix/agent-skill-ninja-X.X.X.vsix --title "vX.X.X - Title" --notes "Notes"
```

`npx vsce ls` の内容を確認してから publish に進むこと。不要物が見つかった場合は、ワンライナーを中断して `.vscodeignore` を修正する。

## テストファイル一覧

| ファイル                                            | 内容                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `scripts/test-whenToUse.js`                         | When to Use 抽出ロジックのテスト                                                 |
| `scripts/test-search-logic.js`                      | 検索ロジックのテスト（存在する場合）                                             |
| `scripts/test-skill-scan-paths.js`                  | skillsDirectory 配下だけをスキャンする境界テスト                                 |
| `scripts/test-skill-locations.js`                   | workspace / user/global skill root 解決の境界テスト                              |
| `scripts/test-local-skill-scanner.js`               | shared / legacy marker の登録状態判定回帰テスト                                  |
| `scripts/test-skill-installer-metadata-fallback.js` | metadata-less skill を local 扱いに寄せる fallback / metadata 再生成の回帰テスト |
| `scripts/test-workspace-skill-groups.js`            | TreeView の root grouping 回帰テスト                                             |
| `scripts/test-view-welcome-ux.js`                   | viewsWelcome の empty-state 導線と文量制約の回帰テスト                           |
| `scripts/test-package-manifest.js`                  | Settings 表示順・Command Palette・README 導線の整合性テスト                      |
| `scripts/test-audit-skill-installability.js`        | installability 監査スクリプトのローカル単体テスト                                |

## 注意事項

- ⚠️ **同じバージョン番号で再公開不可** - エラーになったらバージョン番号を上げて再実行
- ⚠️ **ブランチ名は `master`** - push が必要な場合は `git push origin master` を使う
- ✅ **コード変更時は必ずテストを実行**
- ✅ リリース前に `git status` で未コミットファイルがないことを確認
- ✅ `npm run compile` が成功することを確認してから公開
- ✅ `node scripts/audit-skill-installability.js --raw-only` で、プリセット index の全 skill が install 到達可能であることを確認してから公開
- ✅ `npx vsce ls` で不要な開発用ファイルが VSIX に入っていないことを確認してから公開
- ✅ **`code --install-extension <vsix>` でローカル install が通ることを確認してから publish**（VSIX truncate / zip 破損は `vsce ls` で見逃しやすい，2026-05-12 / GitHub Copilot）
- ✅ 一時的な VS Code task を使った場合は、公開完了前に `.vscode/tasks.json` から release / verify 用 task を削除し、watch task だけの状態に戻す
- ✅ 一時 script（例: publish / release / verify / VSCE fallback）や `%TEMP%` 配下の一時 VSCE install は、公開完了前に削除する
- ✅ `git status --short` と `git rev-parse HEAD` / `git rev-parse origin/master` で、作業ツリーと push 状態を最後に確認

## 公開後の確認

- 🛒 Marketplace: https://marketplace.visualstudio.com/items?itemName=yamapan.agent-skill-ninja
- 📦 GitHub Releases: https://github.com/aktsmm/vscode-agent-skill-ninja/releases
- **公開完了の判定は「成果物のハッシュ照合」で行う**（上記「公開完了の判定は成果物のハッシュで行う」）。`vsce show` / Marketplace HTML は補助シグナルとして扱う
- PowerShell / CLI 裏取り例: `npx vsce show yamapan.agent-skill-ninja --json`, `gh release view vX.X.X --json "tagName,name,url,isDraft,isPrerelease,publishedAt"`, `git ls-remote --tags origin vX.X.X`, `git rev-list -n 1 vX.X.X`
