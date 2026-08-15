#!/usr/bin/env node

// TreeView のコンテキストメニューに出るコマンドが、実際に何かするか静的に確かめる。
//
// `when` に載っている contextValue はユーザーにメニュー項目として見えるので、
// 実装側がその形の item を受け取れないと「押せるのに何も起きない」になる。
// 実機がないと気づけない不具合なので、menu contract を source から検査する。

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const extensionSource = fs.readFileSync(
  path.join(root, "src", "extension.ts"),
  "utf8",
);

/** 何かをユーザーへ返しているとみなす呼び出し。これが無い return は無言終了。 */
const USER_VISIBLE_CALLS =
  /show(Information|Warning|Error)Message|showQuickPick|showInputBox|showTextDocument|executeCommand|createTerminal|withProgress|openExternal|clipboard/;

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

/** `viewItem == x` と `viewItem === x` の両方から contextValue を集める */
function contextValuesFrom(when) {
  return [
    ...String(when || "").matchAll(/viewItem\s*==+\s*([A-Za-z0-9_]+)/g),
  ].map((match) => match[1]);
}

function collectItemMenus() {
  const menus = manifest.contributes?.menus?.["view/item/context"] || [];
  const byCommand = new Map();
  for (const entry of menus) {
    const values = byCommand.get(entry.command) || new Set();
    for (const value of contextValuesFrom(entry.when)) {
      values.add(value);
    }
    byCommand.set(entry.command, values);
  }
  return byCommand;
}

/** 開き括弧の位置から対応する閉じ括弧までを返す（文字列とコメントは無視しない粗い対応） */
function sliceBalanced(source, openIndex, open = "(", close = ")") {
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

/**
 * command id を起点に handler を取る。
 * `registerCommand(` から前方走査すると、括弧の対応がずれたときに
 * 隣の handler を掴んで別コマンドの欠陥として報告してしまう。
 */
function findHandler(commandId) {
  const literal = `"${commandId}"`;
  let from = 0;
  while (true) {
    const at = extensionSource.indexOf(literal, from);
    if (at === -1) {
      return undefined;
    }
    from = at + literal.length;

    const marker = "registerCommand(";
    const markerAt = extensionSource.lastIndexOf(marker, at);
    if (markerAt === -1) {
      continue;
    }
    // id は第一引数でなければならない。間に別の呼び出しが挟まる場合は別物
    const between = extensionSource.slice(markerAt + marker.length, at);
    if (between.trim() !== "") {
      continue;
    }

    const call = sliceBalanced(extensionSource, markerAt + marker.length - 1);
    if (call) {
      return call;
    }
  }
}

/** ハンドラーの第一引数名。メニュー引数を見ている guard だけを対象にするために使う。 */
function firstParameterName(handler) {
  const arrow = handler.match(/(?:async\s*)?\(\s*([A-Za-z0-9_]+)[^)]*\)\s*=>/);
  return arrow?.[1];
}

/**
 * メニュー引数から派生したローカル名を集める。
 * `const skill = item.skill;` のように移してから無言 return する形を見逃さない。
 */
function itemDerivedNames(handler, parameterName) {
  const names = new Set([parameterName]);
  const assignment = /(?:const|let|var)?\s*([A-Za-z0-9_]+)\s*=\s*([^;]+);/g;
  const destructuring = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*([^;]+);/g;
  // 代入が連鎖するので、増えなくなるまで回す
  for (let pass = 0; pass < 6; pass++) {
    const before = names.size;
    const taints = (expression) =>
      [...names].some((name) => new RegExp(`\\b${name}\\b`).test(expression));

    let match;
    assignment.lastIndex = 0;
    while ((match = assignment.exec(handler)) !== null) {
      const [, target, expression] = match;
      // ダイアログの戻り値はユーザーの選択であって item 由来のデータではない。
      // 混ぜるとキャンセル時の無言 return まで欠陥として挙がる
      if (USER_VISIBLE_CALLS.test(expression)) {
        continue;
      }
      if (taints(expression)) {
        names.add(target);
      }
    }

    destructuring.lastIndex = 0;
    while ((match = destructuring.exec(handler)) !== null) {
      const [, bound, expression] = match;
      if (USER_VISIBLE_CALLS.test(expression) || !taints(expression)) {
        continue;
      }
      for (const part of bound.split(",")) {
        const name = part
          .split(":")
          .pop()
          .trim()
          .replace(/^\.\.\./, "");
        if (/^[A-Za-z0-9_]+$/.test(name)) {
          names.add(name);
        }
      }
    }

    if (names.size === before) {
      break;
    }
  }
  return names;
}

/** `if (...) return;` だけの分岐を列挙する（ブロック無しと `return undefined;` も含む） */
function silentGuards(handler, parameterName) {
  const found = [];
  const derived = itemDerivedNames(handler, parameterName);
  const pattern = /if\s*\(/g;
  let match;
  while ((match = pattern.exec(handler)) !== null) {
    const condition = sliceBalanced(handler, match.index + match[0].length - 1);
    if (!condition) {
      continue;
    }
    const afterCondition = match.index + match[0].length - 1 + condition.length;
    const rest = handler.slice(afterCondition);

    let body;
    if (/^\s*\{/.test(rest)) {
      const braceIndex = handler.indexOf("{", afterCondition);
      const block = sliceBalanced(handler, braceIndex, "{", "}");
      if (!block) {
        continue;
      }
      body = block.slice(1, -1).trim();
    } else {
      const inline = rest.match(/^\s*(return(?:\s+undefined)?\s*;)/);
      if (!inline) {
        continue;
      }
      body = inline[1];
    }

    if (!/\breturn(\s+undefined)?\s*;?\s*$/.test(body)) {
      continue;
    }
    // ログだけ残して戻るのも、ユーザーから見れば無言で何も起きない
    if (USER_VISIBLE_CALLS.test(body)) {
      continue;
    }
    if (
      [...derived].some((name) => new RegExp(`\\b${name}\\b`).test(condition))
    ) {
      found.push(condition.replace(/\s+/g, " "));
    }
  }
  return found;
}

/** 失敗側でユーザーへ何も返さない分岐を探す */
function unreportedFailureBranches(handler) {
  const found = [];
  const pattern =
    /if\s*\(\s*((?:[A-Za-z0-9_]+\.)?(?:success|updated|changed|removed|ok))\s*\)\s*\{/g;
  let match;
  while ((match = pattern.exec(handler)) !== null) {
    const braceIndex = match.index + match[0].length - 1;
    const block = sliceBalanced(handler, braceIndex, "{", "}");
    if (!block) {
      continue;
    }
    const after = handler.slice(braceIndex + block.length).trimStart();
    if (!after.startsWith("else")) {
      found.push(match[1]);
      continue;
    }
    // else があっても、そこでユーザーへ何も伝えなければ失敗は握り潰されたまま
    const elseTail = after.slice("else".length);
    const elseBody = /^\s*\{/.test(elseTail)
      ? sliceBalanced(elseTail, elseTail.indexOf("{"), "{", "}")
      : // ブロック無しの else は次の 1 文だけ
        elseTail.slice(0, elseTail.indexOf(";") + 1);
    if (elseBody && !USER_VISIBLE_CALLS.test(elseBody)) {
      found.push(match[1]);
    }
  }
  return found;
}

function main() {
  const byCommand = collectItemMenus();

  test("context menu entries are backed by a registered command", () => {
    assert.ok(byCommand.size > 0, "expected view/item/context entries");
    const declared = new Set(
      (manifest.contributes?.commands || []).map((entry) => entry.command),
    );
    const missing = [...byCommand.keys()].filter(
      (command) => !declared.has(command),
    );
    assert.deepStrictEqual(
      missing,
      [],
      "a menu must not point at an undeclared command",
    );
  });

  test("every context value in a when clause is a known tree item kind", () => {
    const treeSource = fs.readFileSync(
      path.join(root, "src", "treeProvider.ts"),
      "utf8",
    );
    // 比較にしか出てこない値は、メニューに載せても対象の行が存在しない
    const producedSomewhere = (value) => {
      const literal = `"${value}"`;
      let from = 0;
      while (true) {
        const at = treeSource.indexOf(literal, from);
        if (at === -1) {
          return false;
        }
        const before = treeSource.slice(0, at).trimEnd();
        const after = treeSource.slice(at + literal.length).trimStart();
        // リテラルが左辺にある比較も生成ではない
        const isComparison = /[=!]==?$/.test(before) || /^[=!]==?/.test(after);
        if (!isComparison) {
          return true;
        }
        from = at + literal.length;
      }
    };

    const unknown = [];
    for (const values of byCommand.values()) {
      for (const value of values) {
        if (!producedSomewhere(value)) {
          unknown.push(value);
        }
      }
    }
    assert.deepStrictEqual(
      [...new Set(unknown)].sort(),
      [],
      "a when clause names a context value the tree never assigns to an item",
    );
  });

  test("no visible menu command returns silently on its tree item", () => {
    const offenders = [];
    for (const command of byCommand.keys()) {
      const handler = findHandler(command);
      assert.ok(handler, `no registerCommand found for ${command}`);

      const parameterName = firstParameterName(handler);
      if (!parameterName) {
        continue;
      }

      for (const condition of silentGuards(handler, parameterName)) {
        offenders.push(`${command}: if ${condition} { return; }`);
      }
    }

    assert.deepStrictEqual(
      offenders,
      [],
      "a menu item the user can click must act or explain why it cannot",
    );
  });

  test("a failed menu action is reported, not swallowed", () => {
    const offenders = [];
    for (const command of byCommand.keys()) {
      const handler = findHandler(command);
      if (!handler) {
        continue;
      }
      for (const flag of unreportedFailureBranches(handler)) {
        offenders.push(
          `${command}: if (${flag}) { ... } has no failure branch`,
        );
      }
    }
    assert.deepStrictEqual(
      offenders,
      [],
      "a helper that reports failure with a flag needs a user-visible failure path",
    );
  });

  test("the silent-return detector actually detects", () => {
    const sample = `registerCommand(
      "demo.cmd",
      async (item: SkillTreeItem) => {
        const skill = item.skill;
        const choice = await vscode.window.showWarningMessage(skill.name, ok);
        if (!skill) {
          return;
        }
        if (!choice) {
          return;
        }
        if (!skill.path) return undefined;
        if (unrelated) {
          return;
        }
      },
    );`;
    assert.deepStrictEqual(silentGuards(sample, "item"), [
      // item から移した局所変数も対象
      "(!skill)",
      // ブロック無しと return undefined; も対象
      "(!skill.path)",
    ]);

    const destructured = `registerCommand(
      "demo.cmd",
      async (item: SkillTreeItem) => {
        const { skill, source } = item;
        if (!skill) {
          console.warn("missing");
          return;
        }
        if (!source) {
          vscode.window.showWarningMessage(x);
          return;
        }
      },
    );`;
    assert.deepStrictEqual(
      silentGuards(destructured, "item"),
      ["(!skill)"],
      "destructured item fields count, and logging is not user feedback",
    );

    assert.deepStrictEqual(unreportedFailureBranches("if (success) { a(); }"), [
      "success",
    ]);
    assert.deepStrictEqual(
      unreportedFailureBranches("if (result.success) { a(); }"),
      ["result.success"],
    );
    assert.deepStrictEqual(
      unreportedFailureBranches("if (success) { a(); } else { log(x); }"),
      ["success"],
      "an else that tells the user nothing still swallows the failure",
    );
    assert.deepStrictEqual(
      unreportedFailureBranches(
        "if (success) { a(); } else { vscode.window.showWarningMessage(x); }",
      ),
      [],
    );
    assert.deepStrictEqual(
      unreportedFailureBranches("if (success) { a(); } else console.warn(x);"),
      ["success"],
      "a blockless else that only logs still swallows the failure",
    );
    assert.ok(
      USER_VISIBLE_CALLS.test("vscode.window.showWarningMessage(x)"),
      "the feedback pattern must match the messages the extension actually uses",
    );
  });

  test("handler lookup is anchored on the command id", () => {
    for (const command of ["skillNinja.install", "skillNinja.editWhenToUse"]) {
      const handler = findHandler(command);
      assert.ok(handler, `no registerCommand found for ${command}`);
      assert.ok(
        handler.indexOf(`"${command}"`) < 40,
        `${command} must resolve to its own registration, not a neighbouring one`,
      );
    }
  });
}

main();
console.log(failures > 0 ? "RESULT=FAIL" : "RESULT=PASS");
if (failures > 0) {
  process.exitCode = 1;
}
