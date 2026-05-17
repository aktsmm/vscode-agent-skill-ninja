---
applyTo: "**/package.json,**/CHANGELOG.md,**/*.vsix"
---

# VS Code 拡張リリース手順

## ⚠️ 重要: テストファーストの原則

**コードを変更したら、ビルド・リリース前に必ずテストを実行すること！**

### テスト実行（必須）

```bash
# 1. TypeScript コンパイル & Lint（型エラー・構文エラーの検出）
npm run compile

# 2. 回帰テスト一式
npm test
```

### テストが必要なケース

| 変更内容                 | 必須テスト                                                  |
| ------------------------ | ----------------------------------------------------------- |
| `instructionManager.ts`  | `npm run compile` + 手動で Update Instruction File 確認     |
| `skillInstaller.ts`      | `npm run compile` + 手動でスキルインストール確認            |
| `skillIndex.ts`          | `npm run compile` + インデックス読み込み確認                |
| `indexUpdater.ts`        | `npm run compile` + ソース更新・追加確認                    |
| `treeProvider.ts`        | `npm run compile` + TreeView 表示確認                       |
| `i18n.ts`                | `npm run compile` + 日英両方で UI 確認                      |
| `skillSearch.ts`         | `npm run compile` + `node scripts/test-search-logic.js`     |
| スキルスキャン範囲       | `npm run compile` + `node scripts/test-skill-scan-paths.js` |
| When to Use 抽出ロジック | `node scripts/test-whenToUse.js`                            |

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
```

**テストが全て PASS していることを確認してからリリースに進む。**

新しい回帰テスト script を追加した場合は、存在確認だけで満足せず、同じ変更で `package.json` の `npm test` に組み込むこと（2026-05-11 / GitHub Copilot）。

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

### 4. コミット & プッシュ

```bash
git add .
git commit -m "[Release] vX.X.X - 変更内容の要約"
git push origin master  # ⚠️ main ではなく master
```

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

### 5.1 VSIX install 検証（publish 前に必須）

`vsce ls` だけでは VSIX 作成中の zip 破損（`End of central directory record` エラー等）を検出できない。生成後は必ずローカル VS Code へ install テストを走らせてセルフチェックする（2026-05-12 / GitHub Copilot）。

```pwsh
$cli = "C:\Users\$env:USERNAME\AppData\Local\Programs\Microsoft VS Code\bin\code.cmd"
& $cli --install-extension artifacts\vsix\agent-skill-ninja-X.X.X.vsix --force
# Error: End of central directory record signature not found ... が出たら
# VSIX が truncate しているので再生成する
```

`vsce ls` が prepublish ログだけを返す・出力不安定な場合は、生成済み `.vsix` を zip として直接列挙して収録物を確認する（例：PowerShell で `tar -xf <vsix> -C <tmpdir>` または `System.IO.Compression.ZipFile`）。この場合も、上記の不要物チェックは省略しない（2026-05-11 / GitHub Copilot）。

### 6. Marketplace 公開

```bash
npx vsce publish --packagePath artifacts/vsix/agent-skill-ninja-X.X.X.vsix  # Marketplace に公開
```

対象バージョンの publish が `already exists` を返した場合、そのバージョンは Marketplace 側で公開済みと扱ってよい。ただし Marketplace metadata は反映遅延することがあるため、GitHub Release、VSIX asset、必要なら後続の `vsce show` で別経路確認を続ける（2026-05-11 / GitHub Copilot）。

Marketplace の public HTML ページ（`items?itemName=...`）も publish 直後は stale な version 表示のまま残ることがある。HTML が旧版を出していても、`vsce publish` 成功出力、`gh release view vX.Y.Z`、`git ls-remote --tags origin vX.Y.Z` が揃っていれば、即座に version bump や再 publish を行わず、反映待ちとして扱う（2026-05-17 / GitHub Copilot）。

### 7. GitHub Release 作成

```bash
gh release create vX.X.X artifacts/vsix/agent-skill-ninja-X.X.X.vsix --title "vX.X.X - タイトル" --notes "リリースノート"
```

PowerShell で release の JSON を確認するときは、`--json` の field list を 1 引数としてクォートすること。クォートしないと `accepts at most 1 arg(s)` で失敗する。

```pwsh
gh release view vX.X.X --json "tagName,name,url,isDraft,isPrerelease,publishedAt"
```

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

| ファイル                                 | 内容                                                        |
| ---------------------------------------- | ----------------------------------------------------------- |
| `scripts/test-whenToUse.js`              | When to Use 抽出ロジックのテスト                            |
| `scripts/test-search-logic.js`           | 検索ロジックのテスト（存在する場合）                        |
| `scripts/test-skill-scan-paths.js`       | skillsDirectory 配下だけをスキャンする境界テスト            |
| `scripts/test-skill-locations.js`        | workspace / user/global skill root 解決の境界テスト         |
| `scripts/test-workspace-skill-groups.js` | TreeView の root grouping 回帰テスト                        |
| `scripts/test-view-welcome-ux.js`        | viewsWelcome の empty-state 導線と文量制約の回帰テスト      |
| `scripts/test-package-manifest.js`       | Settings 表示順・Command Palette・README 導線の整合性テスト |

## 注意事項

- ⚠️ **同じバージョン番号で再公開不可** - エラーになったらバージョン番号を上げて再実行
- ⚠️ **ブランチ名は `master`** - `git push origin main` ではエラー
- ✅ **コード変更時は必ずテストを実行**
- ✅ リリース前に `git status` で未コミットファイルがないことを確認
- ✅ `npm run compile` が成功することを確認してから公開
- ✅ `npx vsce ls` で不要な開発用ファイルが VSIX に入っていないことを確認してから公開
- ✅ **`code --install-extension <vsix>` でローカル install が通ることを確認してから publish**（VSIX truncate / zip 破損は `vsce ls` で見逃しやすい，2026-05-12 / GitHub Copilot）
- ✅ 一時的な VS Code task を使った場合は、公開完了前に `.vscode/tasks.json` から release / verify 用 task を削除し、watch task だけの状態に戻す
- ✅ `git status --short` と `git rev-parse HEAD` / `git rev-parse origin/master` で、作業ツリーと push 状態を最後に確認

## 公開後の確認

- 🛒 Marketplace: https://marketplace.visualstudio.com/items?itemName=yamapan.agent-skill-ninja
- 📦 GitHub Releases: https://github.com/aktsmm/vscode-agent-skill-ninja/releases
- PowerShell / CLI 裏取り例: `npx vsce show yamapan.agent-skill-ninja --json`, `gh release view vX.X.X --json "tagName,name,url,isDraft,isPrerelease,publishedAt"`, `git ls-remote --tags origin vX.X.X`
