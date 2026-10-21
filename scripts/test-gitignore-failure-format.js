#!/usr/bin/env node

// Gitignore 同期失敗の通知文が、原因・対象・cleanup の別を伝えることを検証する。

const assert = require("assert");
const { loadSrcModule } = require("./load-src-module");

const { formatGitignoreFailure } = loadSrcModule("./gitignoreManager");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const REASONS = [
  "busy",
  "dirty",
  "unsafe-path",
  "invalid-metadata",
  "invalid-block",
  "changed",
  "limit",
  "io-failure",
];

test("every failure reason produces a cause in both languages", () => {
  for (const reason of REASONS) {
    for (const japanese of [true, false]) {
      const text = formatGitignoreFailure(
        { status: "failed", reason },
        { rootLabel: ".github/skills", japanese, cleanup: false },
      );
      assert.ok(text.includes(".github/skills"), `${reason} lacks the root`);
      assert.ok(!text.includes("undefined"), `${reason} leaks undefined`);
      assert.ok(
        japanese ? text.includes("原因:") : text.includes("Cause:"),
        `${reason} lacks a cause`,
      );
    }
  }
});

test("a busy lock names the lock file and forbids blind deletion", () => {
  const text = formatGitignoreFailure(
    { status: "failed", reason: "busy" },
    { rootLabel: "skills", japanese: false, cleanup: false },
  );
  assert.ok(text.includes(".gitignore.agent-ninja.lock"));
  assert.ok(text.includes("only if it remains"));
});

test("cleanup failures say exclusions may remain", () => {
  const ja = formatGitignoreFailure(
    { status: "failed", reason: "io-failure" },
    { rootLabel: "skills", japanese: true, cleanup: true },
  );
  const en = formatGitignoreFailure(
    { status: "failed", reason: "io-failure" },
    { rootLabel: "skills", japanese: false, cleanup: true },
  );
  assert.ok(ja.includes("管理ブロックを外せませんでした"));
  assert.ok(en.includes("exclusions may remain"));
});

test("a cleanup-failed warning is described even when the sync succeeded", () => {
  const text = formatGitignoreFailure(
    { status: "updated", warning: "cleanup-failed" },
    { rootLabel: "skills", japanese: false, cleanup: false },
  );
  assert.ok(text.includes("temporary file or lock could not be removed"));
});
