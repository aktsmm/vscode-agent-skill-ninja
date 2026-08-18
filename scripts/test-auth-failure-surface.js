#!/usr/bin/env node

// 認証エラーの導線が日本語 UI でも成立することを守る。
//
// 以前は command ごとに errorMessage.includes("rate limit") などの英語マーカーで
// 判定していたため、日本語の自前文言（「GitHub API の制限に達しました」など）が
// どれにも一致せず、認証ヘルプではなく素のエラーが出ていた。
// 判定は githubResponse.ts の 1 か所に集約し、ここで両言語の実文言を固定する。

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const srcDir = path.join(__dirname, "..", "src");
const { containsHttpStatus, looksLikeGitHubAuthMessage } = require(
  path.join(srcDir, "githubResponse.ts"),
);
const { encodeGitRef } = require(path.join(srcDir, "sourceRefs.ts"));

// CRLF のまま複数行 regex を当てると行末アンカーが外れて 0 件になる
function readNormalized(fileName) {
  return fs
    .readFileSync(path.join(srcDir, fileName), "utf8")
    .replace(/\r\n/g, "\n");
}

const i18nSource = readNormalized("i18n.ts");
const extensionSource = readNormalized("extension.ts");

let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

/** i18n.ts から実際に出荷される文言を取り出す。テスト側で書き写すと乖離する */
function readLocalizedMessages(key) {
  const pattern = new RegExp(`^ {2}${key}:\\s*("(?:[^"\\\\]|\\\\.)*"),$`, "gm");
  const found = [];
  let match;
  while ((match = pattern.exec(i18nSource)) !== null) {
    found.push(JSON.parse(match[1]));
  }
  return found;
}

test("shipped auth messages are recognized in both languages", () => {
  for (const key of ["rateLimitExceeded", "authRequired"]) {
    const values = readLocalizedMessages(key);
    assert.ok(
      values.length >= 2,
      `${key} should exist for both locales (found ${values.length})`,
    );

    for (const value of values) {
      assert.ok(
        looksLikeGitHubAuthMessage(value),
        `${key} must route to the auth help surface: ${value.slice(0, 60)}`,
      );
    }
  }
});

test("japanese 403 wording routes to the auth surface", () => {
  const japanese403 =
    "GitHub API へのアクセスが拒否されました (403)。未認証のレート制限に達したか、対象リポジトリ/検索に認証が必要な可能性があります。";
  assert.ok(looksLikeGitHubAuthMessage(japanese403));
});

test("unrelated failures do not hijack the auth surface", () => {
  assert.strictEqual(looksLikeGitHubAuthMessage("No skills found"), false);
  assert.strictEqual(
    looksLikeGitHubAuthMessage("スキルが見つかりませんでした"),
    false,
  );
  assert.strictEqual(
    looksLikeGitHubAuthMessage("Request timeout: api.github.com/repos"),
    false,
  );
});

test("status codes are not matched inside names, paths, or counts", () => {
  // 裸の部分一致だと 4291 バイトや 403 を含むスキル名まで認証エラーになる
  for (const benign of [
    "Wrote 4291 bytes",
    "Failed to install skill 401k-planner",
    "Skill not found: azure-403-troubleshoot",
    "Repository or branch not found: acme/tools403 (branch: main)",
  ]) {
    assert.strictEqual(
      looksLikeGitHubAuthMessage(benign),
      false,
      `must not be treated as an auth failure: ${benign}`,
    );
  }
});

test("real status codes are still detected", () => {
  for (const real of [
    "GitHub API access was denied (403).",
    "HTTP 429: too many requests",
    "GitHub API エラー: 401",
  ]) {
    assert.strictEqual(
      looksLikeGitHubAuthMessage(real),
      true,
      `must reach the auth surface: ${real}`,
    );
  }

  assert.strictEqual(containsHttpStatus("status 404 returned", 404), true);
  assert.strictEqual(containsHttpStatus("skill-404-handler", 404), false);
});

test("containsHttpStatus only matches a standalone status token", () => {
  // looksLikeGitHubAuthMessage 経由だと marker 側で偶然通るので、ここは直接呼ぶ。
  // 姉妹拡張の `(?:^|[\s(:])` 版へ寄せると、全角句読点や引用符付きの status を
  // 落として日本語 UI が認証導線に入らなくなるため、この境界を固定する。
  for (const status of [401, 403, 404, 429]) {
    for (const benign of [
      `x${status}x`,
      `1${status}`,
      `${status}0`,
      `_${status}_`,
      `error-${status}-detail`,
      `azure-${status}-troubleshoot`,
    ]) {
      assert.strictEqual(
        containsHttpStatus(benign, status),
        false,
        `must not read ${status} out of ${benign}`,
      );
    }

    for (const real of [
      `HTTP ${status}:`,
      `"${status}"`,
      `${status}。`,
      `エラー：${status}`,
    ]) {
      assert.strictEqual(
        containsHttpStatus(real, status),
        true,
        `must still detect ${status} in ${real}`,
      );
    }
  }
});

test("commands no longer classify auth failures with ad-hoc strings", () => {
  // 新しい command が英語マーカーだけの判定を再導入すると、日本語 UI でまた素通りする
  const adHoc = extensionSource.match(
    /errorMessage\s*\.includes\(\s*["'`](rate limit|authentication|403|401|429)["'`]\s*\)/g,
  );
  assert.strictEqual(
    adHoc,
    null,
    `use isGitHubAuthFailure() instead of ad-hoc message matching: ${adHoc}`,
  );
});

test("status codes are never matched as bare substrings", () => {
  const installerSource = readNormalized("skillInstaller.ts");
  for (const [file, source] of [
    ["extension.ts", extensionSource],
    ["skillInstaller.ts", installerSource],
    ["githubResponse.ts", readNormalized("githubResponse.ts")],
  ]) {
    // 引用符や空白のゆらぎですり抜けないようにする
    const bare = source.match(/includes\(\s*["'`](401|403|404|429)["'`]\s*\)/g);
    assert.strictEqual(
      bare,
      null,
      `${file} must use containsHttpStatus(): ${bare}`,
    );
  }
});

test("auth recovery re-runs the failed operation instead of stopping", () => {
  // 実装は authRecovery.ts、配線は extension.ts に分かれたので、両方を別々に見る。
  // 片側だけ見ると「実装はあるが呼ばれていない」を取り逃がす。
  const authRecoverySource = readNormalized("authRecovery.ts");

  // 再試行中の失敗からさらに再試行を提案すると同じ操作を往復できる
  assert.match(authRecoverySource, /authRecoveryRetryInFlight/);
  assert.match(
    authRecoverySource,
    /async function showAuthHelpWithRetry\(/,
    "the retry helper must live in authRecovery.ts",
  );

  // 認証を直せた直後にユーザーへ同じ操作をやり直させない
  const wired = extensionSource.match(/showAuthHelpWithRetry\(/g) || [];
  assert.ok(
    wired.length >= 4,
    `command handlers should retry after recovery (found ${wired.length})`,
  );

  // command 再実行だと入力を聞き直すので、捕捉済みの引数を閉じ込める
  for (const closure of [
    "runInstall",
    "runIndexUpdate",
    "runSourceUpdate",
    "runAddSource",
  ]) {
    assert.match(
      extensionSource,
      new RegExp(`showAuthHelpWithRetry\\(${closure}\\)`),
      `${closure} should be reused as the retry closure`,
    );
  }

  // 分類済みエラーは offerGitHubFailureRecovery が先に処理して return するため、
  // そちらへ closure を渡さないと retry へ到達しない
  const recoveryCalls =
    extensionSource.match(
      /await offerGitHubFailureRecovery\([\s\S]*?\n\s*\)/g,
    ) || [];
  assert.ok(
    recoveryCalls.length >= 3,
    `expected the classified-error path at three call sites (found ${recoveryCalls.length})`,
  );
  for (const call of recoveryCalls) {
    assert.match(
      call,
      /run(IndexUpdate|SourceUpdate|AddSource)/,
      `classified auth failures must retry too: ${call.replace(/\s+/g, " ")}`,
    );
  }
});

test("the auth recovery composition root is built once with every seam", () => {
  // behavior test は fake seam を、配線テストは call site を見るため、
  // 型が合う誤 seam を注入すると両方すり抜ける。合流点をここで固定する。
  const authRecoverySource = readNormalized("authRecovery.ts");

  const created = extensionSource.match(/createAuthRecovery\(/g) || [];
  assert.strictEqual(
    created.length,
    1,
    `createAuthRecovery must be called exactly once (found ${created.length})`,
  );

  // command ハンドラ内で作ると再入防止フラグが増えるので、module scope を強制する
  const factoryBlock =
    /^const authRecovery = createAuthRecovery\(\{\n([\s\S]*?)^\}\);$/m.exec(
      extensionSource,
    );
  assert.ok(
    factoryBlock,
    "the factory must be created at module scope as `const authRecovery = createAuthRecovery({...})`",
  );

  const seamBlock =
    /export interface AuthRecoverySeams \{\n([\s\S]*?)\n\}/.exec(
      authRecoverySource,
    );
  assert.ok(
    seamBlock,
    "AuthRecoverySeams should stay declared as an interface",
  );
  const seamNames = [
    ...seamBlock[1].matchAll(/^ {2}([A-Za-z0-9_]+)\??:/gm),
  ].map((match) => match[1]);
  assert.ok(
    seamNames.length >= 6,
    `expected the injected seams to be discoverable (found ${seamNames.join(", ")})`,
  );

  for (const seam of seamNames) {
    assert.match(
      factoryBlock[1],
      new RegExp(`^ {2}${seam}[,:]`, "m"),
      `${seam} must be passed to createAuthRecovery`,
    );
  }

  // 名前が並んでいるだけでは `showAuthHelp: async () => {}` のような無害に見える
  // 差し替えを止められない。実バインディングと VS Code API に固定する
  for (const passthrough of [
    "showAuthHelp",
    "messages",
    "resetGitHubSsoCache",
    "formatStaleSourceFailureReason",
  ]) {
    assert.match(
      factoryBlock[1],
      new RegExp(`^ {2}${passthrough},$`, "m"),
      `${passthrough} must be the real binding, not an inline stub`,
    );
  }
  assert.match(
    factoryBlock[1],
    /showWarningMessage:[\s\S]*?vscode\.window\.showWarningMessage\(/,
    "the warning seam must reach vscode.window.showWarningMessage",
  );
  assert.match(
    factoryBlock[1],
    /openExternal:[\s\S]*?vscode\.env\.openExternal\(/,
    "the external-open seam must reach vscode.env.openExternal",
  );

  // extension.ts 側が使う名前は factory の戻り値から取る（旧ローカル定義の残骸を防ぐ）
  const bound = /^const \{\n([\s\S]*?)^\} = authRecovery;$/m.exec(
    extensionSource,
  );
  assert.ok(
    bound,
    "extension.ts should bind the recovery helpers from the factory",
  );
  for (const name of [
    "shouldOfferGitHubAuth",
    "isGitHubAuthFailure",
    "showAuthHelpWithRetry",
    "offerGitHubFailureRecovery",
  ]) {
    assert.match(
      bound[1],
      new RegExp(`^ {2}${name},$`, "m"),
      `${name} must come from the shared factory instance`,
    );
    assert.doesNotMatch(
      extensionSource,
      new RegExp(`^(?:async )?function ${name}\\(`, "m"),
      `${name} must not be re-declared locally in extension.ts`,
    );
  }
});

test("both READMEs document the multi-account gh pitfall", () => {
  // active でないアカウントが健全でも認証は通らない。実際に踏んだので手順を残す
  const root = path.join(__dirname, "..");
  for (const [file, marker] of [
    ["README.md", "gh auth switch"],
    ["README_ja.md", "gh auth switch"],
  ]) {
    const source = fs
      .readFileSync(path.join(root, file), "utf8")
      .replace(/\r\n/g, "\n");
    assert.ok(
      source.includes(marker),
      `${file} should tell the reader how to change the active gh account`,
    );
    assert.ok(
      source.includes("gh auth status"),
      `${file} should tell the reader how to see which gh account is active`,
    );
  }
});

test("maintenance scripts keep ref escaping identical to the shipped helper", () => {
  // .js スクリプトは src の TS を require できないので複製が必要。挙動一致だけは固定する
  const scriptsDir = path.join(__dirname);
  const samples = [
    "feature/x",
    "release/1.0",
    "a b",
    "a?b#c",
    "main",
    "feature/a b/c",
  ];

  for (const scriptName of [
    "audit-skill-installability.js",
    "update-preset-index.js",
  ]) {
    const source = fs
      .readFileSync(path.join(scriptsDir, scriptName), "utf8")
      .replace(/\r\n/g, "\n");
    const declarations = source.match(/function encodeGitRef\b/g) || [];
    assert.strictEqual(
      declarations.length,
      1,
      `${scriptName} should declare encodeGitRef exactly once (found ${declarations.length})`,
    );

    const body = /function encodeGitRef\(ref\) \{\n([\s\S]*?)\n\}/.exec(source);
    assert.ok(body, `${scriptName} should define encodeGitRef`);

    // eslint-disable-next-line no-new-func
    const copy = new Function("ref", body[1]);
    for (const sample of samples) {
      assert.strictEqual(
        copy(sample),
        encodeGitRef(sample),
        `${scriptName} drifted from src/sourceRefs.ts for ${JSON.stringify(sample)}`,
      );
    }
  }
});

if (failures > 0) {
  console.error(`\n${failures} auth surface test(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("\nAuth failure surface tests passed.");
}
