#!/usr/bin/env node

// 起動時に出るプロンプトが、ユーザー側から止められるかを検査する。
//
// 起動ごとに同じダイアログが出て、閉じても記憶されない実装は
// 実機を長く使わないと気づけない。抑止手段の有無を source で固定する。

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const extensionSource = fs.readFileSync(
  path.join(root, "src", "extension.ts"),
  "utf8",
);
const authSource = fs.readFileSync(
  path.join(root, "src", "githubAuth.ts"),
  "utf8",
);

/**
 * 起動経路でダイアログを出しうる処理と、それが繰り返さない理由。
 * `mechanical: true` は state gate かラベルとして source から確認できるもの。
 * 新しい起動時ダイアログはここへ理由付きで登録しないと通らない。
 */
const REVIEWED_STARTUP_DIALOGS = {
  offerToRemoveLegacyPlaintextGitHubToken: {
    mechanical: true,
    why: "workspaceState dismissal plus an explicit Don't ask again action",
  },
  checkStaleSourceIndexesOnStartup: {
    mechanical: true,
    why: "globalState prompt-date key throttles to once per day",
  },
  showRefFormatUpdateNotice: {
    mechanical: true,
    why: "one-shot globalState flag",
  },
  notifyIncompleteSkillsOnce: {
    mechanical: true,
    why: "workspaceState fingerprint, persisted before the dialog is shown",
  },
  notifyRootLevelArtifactsOnce: {
    mechanical: true,
    why: "workspaceState scan flag, persisted before the dialog is shown",
  },
  checkVersionAndRefreshMetadata: {
    mechanical: false,
    why: "only runs when the stored extension version changed or a format migration happened, so it cannot repeat on an unchanged install",
  },
  updateStaleSourceIndexes: {
    mechanical: false,
    why: "reached only from checkStaleSourceIndexesOnStartup, which is already throttled, or from an explicit user command",
  },
  saveRateLimitResumeStateFromBatch: {
    mechanical: false,
    why: "reached only from updateStaleSourceIndexes, and only when a run actually hit the rate limit; the resume it offers refuses to rerun before the reset time, so it cannot loop",
  },
  offerDisableMissingReinstallChecks: {
    mechanical: false,
    why: "itself the permanent-exit offer, reached only after the user chose Update Index on the throttled index warning",
  },
  pickManagedRoot: {
    mechanical: false,
    why: "a picker shown only after the user chose an action that needs a target root",
  },
  openManagedOutputForRoot: {
    mechanical: false,
    why: "user-invoked output command; reachable name only because it is declared inside activate()",
  },
  openManagedOutputForPreferredScope: {
    mechanical: false,
    why: "user-invoked output command; reachable name only because it is declared inside activate()",
  },
  promptOutputTargetFormats: {
    mechanical: false,
    why: "reached only from the Configure Output Targets command, after the user already picked targets; the loop exits on Esc",
  },
};

/** 恒久的に止められることを示す手段。どれか 1 つは必要。 */
const SUPPRESSION_SIGNALS = [
  /Do Not Check Again/,
  /Don't ask again/,
  /actionDontAskAgain/,
  /今後確認しない/,
  /今後表示しない/,
];

/**
 * state を読んでいるだけでは足りない。読みと保存の両方があって初めて
 * 「次の起動で出ない」と言える。Memento 変数名は promptState など止まらない。
 */
const STATE_READ = /State\??\.get\s*[<(]/;
const STATE_WRITE = /State\??\.update\s*\(/;

function persistsChoice(body) {
  return STATE_READ.test(body) && STATE_WRITE.test(body);
}

function isSuppressible(body) {
  return (
    persistsChoice(body) &&
    (SUPPRESSION_SIGNALS.some((pattern) => pattern.test(body)) ||
      /\breturn\b/.test(body))
  );
}

let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(`  ${error.stack || error.message}`);
  }
}

function sliceBalanced(source, openIndex, open = "{", close = "}") {
  let depth = 0;
  for (let index = openIndex; index < source.length; index++) {
    if (source[index] === open) {
      depth += 1;
    } else if (source[index] === close) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex, index + 1);
      }
    }
  }
  return undefined;
}

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notStrictEqual(start, -1, `missing ${signature}`);
  const braceIndex = source.indexOf("{", start + signature.length);
  const body = sliceBalanced(source, braceIndex);
  assert.ok(body, `could not read the body of ${signature}`);
  return body;
}

/** 名前から関数本体を探す。見つからなければローカル定義ではない。 */
function findFunctionBody(name) {
  for (const source of [extensionSource, authSource]) {
    for (const shape of [
      `function ${name}(`,
      `const ${name} = async (`,
      `const ${name} = (`,
    ]) {
      const start = source.indexOf(shape);
      if (start === -1) {
        continue;
      }
      const braceIndex = source.indexOf("{", start + shape.length);
      const body = sliceBalanced(source, braceIndex);
      if (body) {
        return body;
      }
    }
  }
  return undefined;
}

function showsDialog(body) {
  return /show(Warning|Information|Error)Message|showQuickPick|showInputBox/.test(
    body,
  );
}

/** activate() から起動時に走り、ダイアログを出しうる経路 */
const STARTUP_PROMPTS = [
  {
    label: "legacy plaintext PAT prompt",
    source: authSource,
    signature: "export async function offerToRemoveLegacyPlaintextGitHubToken(",
  },
  {
    label: "stale source index prompt",
    source: extensionSource,
    signature: "async function checkStaleSourceIndexesOnStartup(",
  },
  {
    label: "ref output format notice",
    source: extensionSource,
    signature: "async function showRefFormatUpdateNotice(",
  },
];

function main() {
  test("every startup prompt can be turned off for good", () => {
    for (const { label, source, signature } of STARTUP_PROMPTS) {
      const body = functionBody(source, signature);
      if (!/show(Warning|Information|Error)Message/.test(body)) {
        continue;
      }
      assert.ok(
        isSuppressible(body),
        `${label} shows a dialog at startup with no way to stop it returning`,
      );
    }
  });

  test("the missing-from-index startup warning offers a permanent exit", () => {
    const start = extensionSource.indexOf(
      "const missingSkills = missingEntries",
    );
    assert.notStrictEqual(start, -1, "missing the startup index-check warning");
    const region = extensionSource.slice(start, start + 3500);
    assert.ok(
      region.includes("Do Not Check Again") &&
        region.includes("今後確認しない"),
      "dismissing this warning must be able to stop it returning every window",
    );
    assert.ok(
      region.includes("disableMissingReinstallChecksWithFeedback("),
      "the permanent exit must persist through the shared meta writer",
    );
    // メタを書けないエントリが混ざっても、ユーザーの「今後確認しない」は効き続ける
    assert.ok(
      region.includes("MISSING_INDEX_WARNING_DISMISSED_KEY"),
      "a failed metadata write must not bring the warning back next window",
    );
    const guardStart = extensionSource.indexOf(
      "MISSING_INDEX_WARNING_DISMISSED_KEY",
    );
    assert.ok(
      /workspaceState\.get<boolean>\(\s*MISSING_INDEX_WARNING_DISMISSED_KEY/.test(
        extensionSource,
      ) && guardStart !== -1,
      "the stored dismissal must actually gate the warning",
    );
  });

  test("every activation-time routine that prompts can be turned off", () => {
    // activate() は全コマンドを登録するので、ハンドラー本体まで辿ると
    // ユーザー操作でしか走らない処理まで「起動時」に混ざる
    const activateBody = functionBody(
      extensionSource,
      "export function activate(",
    );
    const marker = "registerCommand(";
    let immediate = "";
    let cursor = 0;
    while (cursor < activateBody.length) {
      const at = activateBody.indexOf(marker, cursor);
      if (at === -1) {
        immediate += activateBody.slice(cursor);
        break;
      }
      immediate += activateBody.slice(cursor, at);
      const call = sliceBalanced(
        activateBody,
        at + marker.length - 1,
        "(",
        ")",
      );
      // 対応括弧を失ったら、その先は検査対象から落とさず素通しする
      cursor = call ? at + marker.length - 1 + call.length : at + marker.length;
    }

    // ネストした `.then()` コールバック内の呼び出しも起動時に走るので、
    // インデントではなく本体全体から集める。宣言は呼び出しではない
    const startupCalls = [
      ...new Set(
        [
          ...immediate.matchAll(
            /(\bfunction\s+|\.)?\b([A-Za-z][A-Za-z0-9_]*)\s*\(/g,
          ),
        ]
          // 宣言と `.activate()` のような member call はここでの呼び出しではない
          .filter((match) => !match[1])
          .map((match) => match[2]),
      ),
    ];

    const unreviewed = [];
    const notSuppressible = [];
    let prompting = 0;
    for (const name of startupCalls) {
      const body = findFunctionBody(name);
      if (!body || !showsDialog(body)) {
        continue;
      }
      prompting += 1;
      const reviewed = REVIEWED_STARTUP_DIALOGS[name];
      if (!reviewed) {
        unreviewed.push(name);
        continue;
      }
      // 機械的に確かめられる種類だけは、記録どおりであることも確認する
      if (reviewed.mechanical && !isSuppressible(body)) {
        notSuppressible.push(name);
      }
    }

    // 空入力なら否定述語は必ず通るので、検査対象があったことを別に確かめる
    assert.ok(
      prompting >= 3,
      `expected several activation-time dialogs to inspect, got ${prompting}`,
    );
    assert.deepStrictEqual(
      unreviewed,
      [],
      "a new activation-time dialog must be reviewed here with how it stops repeating",
    );
    assert.deepStrictEqual(
      notSuppressible,
      [],
      "a routine recorded as state-gated no longer gates anything",
    );

    // 名前付き関数を経由せず、起動経路へ直接書かれたダイアログも同じ契約に従う
    const inlineDialogs = [
      ...immediate.matchAll(
        /vscode\.window\.show(?:Warning|Information|Error)Message\s*\(/g,
      ),
    ];
    if (inlineDialogs.length > 0) {
      assert.ok(
        isSuppressible(immediate) ||
          SUPPRESSION_SIGNALS.some((pattern) => pattern.test(immediate)),
        `${inlineDialogs.length} dialog(s) are written directly into the activation path with no recorded way to stop them`,
      );
    }
  });

  test("the suppression detector actually detects", () => {
    assert.ok(
      isSuppressible(
        "const seen = context.workspaceState.get<boolean>(KEY); if (seen) { return; } await context.workspaceState.update(KEY, true);",
      ),
      "reading a flag, gating on it and persisting it counts as suppression",
    );
    assert.ok(
      !isSuppressible("await context.globalState.update(KEY, Date.now());"),
      "writing state without reading it back does not stop the dialog returning",
    );
    assert.ok(
      !isSuppressible(
        "const v = context.globalState.get<string>(KEY); use(v);",
      ),
      "reading state without persisting a decision does not stop the dialog returning",
    );
    assert.ok(
      !isSuppressible('const label = isJapanese() ? "今後確認しない" : "x";'),
      "a label alone proves nothing unless the choice is stored",
    );
    assert.ok(
      !isSuppressible(
        "await vscode.window.showWarningMessage(msg, ok, cancel);",
      ),
      "a plain dialog with only OK/Cancel must not count as suppressible",
    );
    assert.ok(
      showsDialog("vscode.window.showWarningMessage(x)") &&
        !showsDialog("console.warn(x)"),
      "the dialog detector must separate dialogs from logging",
    );
  });
}

main();
console.log(failures > 0 ? "RESULT=FAIL" : "RESULT=PASS");
if (failures > 0) {
  process.exitCode = 1;
}
