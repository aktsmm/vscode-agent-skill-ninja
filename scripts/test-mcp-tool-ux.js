#!/usr/bin/env node

// Language Model tool の UX ガード。
//
// これらは実行時に確認ダイアログが出ないと気づけない欠陥なので、
// source を静的に検査して回帰を止める。

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..", "src");
const MCP_TOOLS_PATH = path.join(SRC_DIR, "mcpTools.ts");

/** ワークスペースやインデックスを書き換えるので、確認なしに走らせてはいけない tool */
const MUTATING_TOOL_CLASSES = [
  "SkillInstallTool",
  "SkillUninstallTool",
  "AddSourceTool",
  "RemoveSourceTool",
  "LocalizeSkillsTool",
];

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

function listSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
  });
}

function readClassBody(source, className) {
  const start = source.indexOf(`class ${className} `);
  assert.notStrictEqual(start, -1, `missing class ${className}`);
  const end = source.indexOf("\nclass ", start + 1);
  return source.slice(start, end === -1 ? source.length : end);
}

function main() {
  const mcpSource = fs.readFileSync(MCP_TOOLS_PATH, "utf8");

  test("mutating tools declare a confirmation before running", () => {
    for (const className of MUTATING_TOOL_CLASSES) {
      const body = readClassBody(mcpSource, className);
      assert.ok(
        body.includes("prepareInvocation("),
        `${className} must implement prepareInvocation so the user can cancel`,
      );
      assert.ok(
        body.includes("confirmationMessages:"),
        `${className} must supply confirmationMessages`,
      );
    }
  });

  test("tool output tables escape interpolated values", () => {
    const rawTableRows = mcpSource
      .split(/\r?\n/)
      .filter((line) => /^\s*\|.*\$\{/.test(line));
    assert.deepStrictEqual(
      rawTableRows,
      [],
      "Markdown table cells must go through renderMarkdownTable so pipes and newlines are escaped",
    );
  });

  test("source carries no replacement characters", () => {
    const offenders = listSourceFiles(SRC_DIR).filter((filePath) =>
      fs.readFileSync(filePath, "utf8").includes("\uFFFD"),
    );
    assert.deepStrictEqual(
      offenders.map((filePath) => path.relative(SRC_DIR, filePath)),
      [],
      "U+FFFD means text was decoded with the wrong encoding",
    );
  });
}

main();
console.log(failures > 0 ? "RESULT=FAIL" : "RESULT=PASS");
if (failures > 0) {
  process.exitCode = 1;
}
