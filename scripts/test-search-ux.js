/**
 * Search/auth UX contract tests.
 * Run: node scripts/test-search-ux.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const skillSearchSource = fs.readFileSync(
  path.join(root, "src", "skillSearch.ts"),
  "utf8",
);
const extensionSource = fs.readFileSync(
  path.join(root, "src", "extension.ts"),
  "utf8",
);
const skillInstallerSource = fs.readFileSync(
  path.join(root, "src", "skillInstaller.ts"),
  "utf8",
);
const i18nSource = fs.readFileSync(path.join(root, "src", "i18n.ts"), "utf8");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("search skills returns metadata for truncated results", () => {
  assert.ok(
    skillSearchSource.includes("export interface SearchSkillsResult"),
    "skillSearch should expose metadata for UI state",
  );
  assert.ok(
    skillSearchSource.includes("export const MAX_SEARCH_RESULTS = 100;"),
    "skillSearch should centralize the result limit",
  );
  assert.ok(
    skillSearchSource.includes("truncated: sorted.length > MAX_SEARCH_RESULTS"),
    "browse results should report truncation",
  );
  assert.ok(
    skillSearchSource.includes(
      "truncated: scoredSkills.length > MAX_SEARCH_RESULTS",
    ),
    "filtered results should report truncation",
  );
});

test("search quick pick surfaces truncation guidance", () => {
  assert.ok(
    extensionSource.includes("messages.searchResultsLimited"),
    "search UI should show a limited-results hint for filtered searches",
  );
  assert.ok(
    extensionSource.includes("messages.browseResultsLimited"),
    "search UI should show a browse hint when the initial list is capped",
  );
});

test("GitHub 403 guidance mentions both auth-required and rate-limit cases", () => {
  assert.ok(
    skillInstallerSource.includes(
      "function buildGitHub403Message(token?: string): string",
    ),
    "skillInstaller should centralize 403 guidance",
  );
  assert.ok(
    skillInstallerSource.includes("unauthenticated rate limit") &&
      skillInstallerSource.includes("require authentication"),
    "403 guidance should mention rate limit and auth-required cases",
  );
  assert.ok(
    i18nSource.includes("this repository/search requires authentication") ||
      i18nSource.includes("対象リポジトリ/検索に認証が必要"),
    "auth help text should cover auth-required repositories and searches",
  );
});

console.log("\nSearch/auth UX tests passed.");
