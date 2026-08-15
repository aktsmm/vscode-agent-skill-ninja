#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { loadSrcModule, SRC_DIR } = require("./load-src-module.js");

const { buildIssueUrl, ISSUE_URL_MAX_LENGTH } = loadSrcModule("./issueReport");

const ISSUES_NEW =
  "https://github.com/aktsmm/vscode-agent-skill-ninja/issues/new";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function main() {
  test("keeps a short report intact", () => {
    const url = buildIssueUrl(ISSUES_NEW, "[Bug] demo", "line one\nline two");

    assert.ok(url.startsWith(`${ISSUES_NEW}?`));
    assert.ok(url.length <= ISSUE_URL_MAX_LENGTH);
    const params = new URL(url).searchParams;
    assert.strictEqual(params.get("title"), "[Bug] demo");
    assert.strictEqual(params.get("body"), "line one\nline two");
  });

  test("truncates an oversized body instead of emitting a 414 URL", () => {
    const body = `HEAD\n${"x".repeat(20000)}`;
    const url = buildIssueUrl(ISSUES_NEW, "[Bug] demo", body);

    assert.ok(
      url.length <= ISSUE_URL_MAX_LENGTH,
      `URL must stay within the limit, got ${url.length}`,
    );
    const decoded = new URL(url).searchParams.get("body");
    assert.ok(decoded.startsWith("HEAD\n"), "the start of the report survives");
    assert.ok(decoded.includes("truncated"), "truncation must be visible");
  });

  test("keeps a realistic incomplete-install report untruncated", () => {
    // 実際の incomplete install 報告に近い形。エンコード後に膨らむ文字が多い
    const failure =
      "Failed to download raw.githubusercontent.com/owner/repository-with-a-long-name/main/skills/some-deeply-nested-skill/SKILL.md";
    const body =
      `**Environment**\n- Extension Version: 0.9.39\n- VS Code: 1.100.0\n- OS: win32\n\n` +
      `**Download Errors**\n${Array.from({ length: 10 }, () => failure).join("\n")}`;

    const url = buildIssueUrl(
      ISSUES_NEW,
      "[Bug] Skill install incomplete",
      body,
    );

    assert.ok(url.length <= ISSUE_URL_MAX_LENGTH, `got ${url.length}`);
    assert.ok(
      !new URL(url).searchParams.get("body").includes("truncated"),
      "the limit must be loose enough that an ordinary report keeps every error",
    );
  });

  test("honors an explicit limit", () => {
    const url = buildIssueUrl(ISSUES_NEW, "t", "y".repeat(5000), 900);

    assert.ok(url.length <= 900, `got ${url.length}`);
    assert.ok(new URL(url).searchParams.get("body").includes("truncated"));
  });

  test("every issue URL in src goes through the bounded builder", () => {
    const offenders = [];
    for (const entry of fs.readdirSync(SRC_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) {
        continue;
      }
      const source = fs.readFileSync(path.join(SRC_DIR, entry.name), "utf8");
      if (/issues\/new\?/.test(source)) {
        offenders.push(entry.name);
      }
    }

    assert.deepStrictEqual(
      offenders,
      [],
      "issue URLs must be built with buildIssueUrl so they cannot exceed GitHub's limit",
    );
  });

  console.log("Issue report tests passed.");
}

main();
