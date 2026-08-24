#!/usr/bin/env node

// 一括再インストールがダイアログで止まらないことを、実装本体を呼んで固定する。
//
// 非モーダル通知を await する経路が一括処理に残ると、ユーザーが通知を放置した
// 時点で最後の 1 件が無期限に止まる。source の文字列一致では、prompt が別の
// helper へ移った瞬間に盲目化するので、ここでは実際の resolver を呼ぶ。

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { loadSrcModule } = require("./load-src-module.js");

const { resolveReinstallEntries } = loadSrcModule("./reinstallPlanner");

let failures = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`PASS ${name}`))
    .catch((error) => {
      failures += 1;
      console.error(`FAIL ${name}`);
      console.error(`  ${error.stack || error.message}`);
    });
}

/**
 * 実装が呼ぶ seam をすべて数える。prompt を出す 2 つは、呼ばれたかどうかと
 * どの options で呼ばれたかを記録する。
 */
function createDeps(options = {}) {
  const calls = { refreshIndex: [], offerDisableMissingChecks: [] };
  const indexedAfterRefresh = options.indexedAfterRefresh ?? [];
  return {
    calls,
    deps: {
      async refreshIndex(index, metas, refreshOptions) {
        calls.refreshIndex.push({ metas, options: refreshOptions });
        return { skills: [...index.skills, ...indexedAfterRefresh] };
      },
      async offerDisableMissingChecks(entries) {
        calls.offerDisableMissingChecks.push(entries);
        return entries.length;
      },
      isIndexed: (index, entry) => index.skills.includes(entry.name),
      metaOf: (entry) => ({ name: entry.name }),
      keyOf: (entry) => entry.name,
    },
  };
}

const ENTRIES = [{ name: "a" }, { name: "b" }, { name: "c" }];
const INDEX = { skills: ["a"] };

async function main() {
  await test("non-interactive resolves without ever prompting", async () => {
    const { calls, deps } = createDeps();

    const plan = await resolveReinstallEntries(INDEX, ENTRIES, deps, {
      interactive: false,
    });

    assert.strictEqual(
      calls.offerDisableMissingChecks.length,
      0,
      "the disable offer must not run in a batch",
    );
    assert.strictEqual(calls.refreshIndex.length, 1);
    assert.deepStrictEqual(
      calls.refreshIndex[0].options,
      { confirm: false },
      "the index refresh must not ask a blocking question in a batch",
    );
    assert.strictEqual(plan.disabledMissingCount, 0);
    assert.strictEqual(plan.skippedMissingCount, 2);
    assert.deepStrictEqual(
      plan.installableEntries.map((entry) => entry.name),
      ["a"],
    );
  });

  await test("interactive keeps both prompts", async () => {
    const { calls, deps } = createDeps();

    const plan = await resolveReinstallEntries(INDEX, ENTRIES, deps, {
      interactive: true,
    });

    assert.strictEqual(calls.refreshIndex.length, 1);
    assert.deepStrictEqual(
      calls.refreshIndex[0].options,
      {},
      "the interactive path must keep the confirm dialog",
    );
    assert.strictEqual(calls.offerDisableMissingChecks.length, 1);
    assert.strictEqual(plan.disabledMissingCount, 2);
  });

  await test("a refresh that recovers a skill makes it installable", async () => {
    const { calls, deps } = createDeps({ indexedAfterRefresh: ["b"] });

    const plan = await resolveReinstallEntries(INDEX, ENTRIES, deps, {
      interactive: false,
    });

    assert.deepStrictEqual(
      plan.installableEntries.map((entry) => entry.name),
      ["a", "b"],
    );
    assert.strictEqual(plan.skippedMissingCount, 1);
    assert.strictEqual(calls.offerDisableMissingChecks.length, 0);
  });

  await test("nothing missing skips the refresh entirely", async () => {
    const { calls, deps } = createDeps();

    const plan = await resolveReinstallEntries(
      { skills: ["a", "b", "c"] },
      ENTRIES,
      deps,
      { interactive: true },
    );

    assert.strictEqual(calls.refreshIndex.length, 0);
    assert.strictEqual(calls.offerDisableMissingChecks.length, 1);
    assert.deepStrictEqual(calls.offerDisableMissingChecks[0], []);
    assert.strictEqual(plan.skippedMissingCount, 0);
  });

  await test("every extension.ts caller opts out of prompting", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "src", "extension.ts"),
      "utf8",
    );

    const callSites = [];
    const needle = "resolveReinstallEntriesFromIndex(";
    let from = 0;
    for (;;) {
      const start = source.indexOf(needle, from);
      if (start === -1) {
        break;
      }
      from = start + needle.length;
      // 宣言そのものは呼び出しではない
      if (/function\s+$/.test(source.slice(Math.max(0, start - 40), start))) {
        continue;
      }
      callSites.push(start);
    }

    assert.ok(
      callSites.length >= 3,
      `expected at least 3 call sites, found ${callSites.length}`,
    );

    for (const start of callSites) {
      const args = readCallArguments(source, start + needle.length - 1);
      // この resolver を使うのは一括経路だけ。interactive: true を渡す呼び出しを
      // 追加するなら、その経路が本当に応答を待ってよいかをここで見直す
      assert.ok(
        /\binteractive\s*:\s*false\b/.test(args),
        `a resolveReinstallEntriesFromIndex call does not opt out of prompting:\n${args}`,
      );
    }
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log("\nAll reinstall batch prompt tests passed");
}

/** 呼び出しの `(` から対応する `)` までを、文字列とネストを見ながら返す。 */
function readCallArguments(source, openParenIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openParenIndex; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === "\\") {
        i += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openParenIndex, i + 1);
      }
    }
  }
  throw new Error("unbalanced parentheses while reading a call expression");
}

main();
