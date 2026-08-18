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
