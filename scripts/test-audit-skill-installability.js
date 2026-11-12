#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  normalizeRepoUrl,
  getRepoParts,
  normalizeSkillPath,
  isSkillPathAllowed,
  shouldAttachGitHubToken,
  shouldRetryWithoutToken,
  fetchOk,
  resolveSourceBranches,
  fetchSourceTrees,
  auditSkill,
  buildPrunedIndex,
} = require(path.join(__dirname, "audit-skill-installability.js"));

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("normalizeRepoUrl strips tree/blob/query/hash suffixes", () => {
  assert.strictEqual(
    normalizeRepoUrl(
      "https://github.com/aktsmm/Agent-Skills/tree/master/local-media-transcription?tab=readme#top",
    ),
    "https://github.com/aktsmm/Agent-Skills",
  );
  assert.strictEqual(
    normalizeRepoUrl(
      "https://github.com/aktsmm/Agent-Skills/blob/master/local-media-transcription/SKILL.md",
    ),
    "https://github.com/aktsmm/Agent-Skills",
  );
});

test("getRepoParts resolves normalized owner/repo", () => {
  assert.deepStrictEqual(
    getRepoParts(
      "https://github.com/openai/skills/blob/main/skills/test/SKILL.md",
    ),
    {
      owner: "openai",
      repo: "skills",
      normalized: "https://github.com/openai/skills",
    },
  );
});

test("normalizeSkillPath trims surrounding slashes", () => {
  assert.strictEqual(normalizeSkillPath("/skills/example/"), "skills/example");
});

test("GitHub audit auth avoids raw URLs and retries classic PAT policy blocks", () => {
  assert.strictEqual(
    shouldAttachGitHubToken(
      "https://raw.githubusercontent.com/owner/repo/main/skills/demo/SKILL.md",
      "token",
    ),
    false,
  );
  assert.strictEqual(
    shouldAttachGitHubToken(
      "https://api.github.com/repos/owner/repo/git/trees/main?recursive=1",
      "token",
    ),
    true,
  );
  assert.strictEqual(
    shouldRetryWithoutToken(
      403,
      "Resource protected by organization SAML enforcement. This organization forbids access via a personal access tokens (classic).",
      "token",
    ),
    true,
  );
  assert.strictEqual(
    shouldRetryWithoutToken(403, "API rate limit exceeded", "token"),
    false,
  );
  assert.strictEqual(
    shouldRetryWithoutToken(
      403,
      "Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.",
      "token",
    ),
    true,
  );
});

test("auditSkill accepts markdown file paths and directory SKILL.md paths", () => {
  const sourceMap = new Map([
    ["sample", { id: "sample", url: "https://github.com/owner/repo" }],
  ]);
  const treeBySource = new Map([
    [
      "sample",
      {
        blobs: new Set([
          "skills/file-based.md",
          "skills/folder-based/SKILL.md",
        ]),
      },
    ],
  ]);

  assert.deepStrictEqual(
    auditSkill(
      { source: "sample", name: "file-based", path: "skills/file-based.md" },
      sourceMap,
      treeBySource,
    ),
    { ok: true },
  );
  assert.deepStrictEqual(
    auditSkill(
      { source: "sample", name: "folder-based", path: "skills/folder-based" },
      sourceMap,
      treeBySource,
    ),
    { ok: true },
  );
});

test("auditSkill reports missing directory SKILL.md", () => {
  const sourceMap = new Map([
    ["sample", { id: "sample", url: "https://github.com/owner/repo" }],
  ]);
  const treeBySource = new Map([["sample", { blobs: new Set() }]]);

  assert.deepStrictEqual(
    auditSkill(
      { source: "sample", name: "broken", path: "skills/broken" },
      sourceMap,
      treeBySource,
    ),
    { ok: false, reason: "missing SKILL.md: skills/broken/SKILL.md" },
  );
});

test("auditSkill rejects paths outside source filters", () => {
  const sourceMap = new Map([
    [
      "sample",
      {
        id: "sample",
        url: "https://github.com/owner/repo",
        includePaths: ["skills"],
      },
    ],
  ]);
  const treeBySource = new Map([
    [
      "sample",
      {
        blobs: new Set(["plugins/demo/skills/example/SKILL.md"]),
      },
    ],
  ]);

  assert.deepStrictEqual(
    auditSkill(
      {
        source: "sample",
        name: "example",
        path: "plugins/demo/skills/example",
      },
      sourceMap,
      treeBySource,
    ),
    {
      ok: false,
      reason: "path outside source filters: plugins/demo/skills/example",
    },
  );
});

test("isSkillPathAllowed applies include and exclude filters", () => {
  assert.strictEqual(
    isSkillPathAllowed("skills/alpha", { includePaths: ["skills"] }),
    true,
  );
  assert.strictEqual(
    isSkillPathAllowed("skills/archive/alpha", {
      includePaths: ["skills"],
      excludePaths: ["skills/archive"],
    }),
    false,
  );
});

test("buildPrunedIndex removes failed skills and bumps minor version", () => {
  const currentIndex = {
    version: "1.19.0",
    lastUpdated: "2026-05-26",
    skills: [
      { source: "a", name: "keep", path: "skills/keep" },
      { source: "b", name: "drop", path: "skills/drop" },
    ],
  };

  const { nextIndex, nextVersion, prunedSkills } = buildPrunedIndex(
    currentIndex,
    [{ source: "b", name: "drop", path: "skills/drop" }],
  );

  assert.strictEqual(nextVersion, "1.20.0");
  assert.strictEqual(nextIndex.version, "1.20.0");
  assert.strictEqual(prunedSkills.length, 1);
  assert.deepStrictEqual(prunedSkills[0], {
    source: "a",
    name: "keep",
    path: "skills/keep",
  });
});

async function testNetworkSafety() {
  const originalFetch = global.fetch;
  const response = (status, body = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone: () => ({ text: async () => "" }),
  });
  const url = "https://raw.githubusercontent.com/owner/repo/main/SKILL.md";
  const source = { id: "sample", url: "https://github.com/owner/repo" };

  try {
    global.fetch = async () => response(200);
    assert.strictEqual(await fetchOk(url), true);
    global.fetch = async () => response(404);
    assert.strictEqual(await fetchOk(url), false);
    global.fetch = async () => response(410);
    assert.strictEqual(await fetchOk(url), false);

    for (const status of [403, 429, 500]) {
      global.fetch = async () => response(status);
      await assert.rejects(() => fetchOk(url), new RegExp(`HTTP ${status}`));
    }

    const methods = [];
    global.fetch = async (_url, options) => {
      methods.push(options.method || "GET");
      return response(options.method === "HEAD" ? 405 : 429);
    };
    await assert.rejects(() => fetchOk(url), /HTTP 429/);
    assert.deepStrictEqual(methods, ["HEAD", "GET"]);

    global.fetch = async (_url, options) =>
      response(options.method === "HEAD" ? 405 : 404);
    assert.strictEqual(await fetchOk(url), false);

    global.fetch = async () => response(200, { truncated: true, tree: [] });
    await assert.rejects(
      () => fetchSourceTrees([source], new Map([["sample", "main"]])),
      /truncated/i,
    );

    global.fetch = async () => response(403);
    await assert.rejects(
      () => resolveSourceBranches([source], true),
      /refusing --apply/i,
    );

    global.fetch = async () => response(200, {});
    await assert.rejects(
      () => resolveSourceBranches([source], true),
      /refusing --apply/i,
    );
    console.log("PASS audit refuses uncertain network results");
  } finally {
    global.fetch = originalFetch;
  }
}

testNetworkSafety()
  .then(() => {
    test("apply leaves the index intact when a network result is uncertain", () => {
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "audit-apply-"));
      try {
        const scripts = path.join(temporary, "scripts");
        const resources = path.join(temporary, "resources");
        fs.mkdirSync(scripts);
        fs.mkdirSync(resources);
        const script = path.join(scripts, "audit-skill-installability.js");
        const preload = path.join(scripts, "fetch-mock.js");
        const indexPath = path.join(resources, "skill-index.json");
        const fixture = JSON.stringify({
          version: "1.0.0",
          sources: [{ id: "sample", url: "https://github.com/owner/repo" }],
          skills: [{ source: "sample", name: "test", path: "skills/test" }],
        });
        fs.copyFileSync(
          path.join(__dirname, "audit-skill-installability.js"),
          script,
        );
        fs.writeFileSync(
          path.join(scripts, "update-preset-index.js"),
          "module.exports = { isSkillPathAllowed: () => true };\n",
        );
        fs.writeFileSync(
          preload,
          `global.fetch = async (url) => {
            const api = url.startsWith("https://api.github.com/");
            const status = api
              ? (process.env.AUDIT_FIXTURE === "branch" ? 403 : 200)
              : (process.env.AUDIT_FIXTURE === "missing" ? 404 : 429);
            return {
              ok: status === 200,
              status,
              json: async () => ({ default_branch: "main" }),
              clone: () => ({ text: async () => "" })
            };
          };\n`,
        );

        for (const [scenario, expected] of [
          ["rate-limit", /HTTP 429/],
          ["branch", /refusing --apply/i],
        ]) {
          fs.writeFileSync(indexPath, fixture);
          const result = spawnSync(
            process.execPath,
            ["--require", preload, script, "--raw-only", "--apply"],
            {
              cwd: temporary,
              env: {
                ...process.env,
                GITHUB_TOKEN: "",
                GH_TOKEN: "",
                AUDIT_FIXTURE: scenario,
              },
              encoding: "utf8",
            },
          );
          assert.strictEqual(result.status, 1, result.stderr);
          assert.match(result.stderr, expected);
          assert.strictEqual(fs.readFileSync(indexPath, "utf8"), fixture);
        }

        fs.writeFileSync(indexPath, fixture);
        const missing = spawnSync(
          process.execPath,
          ["--require", preload, script, "--raw-only", "--apply"],
          {
            cwd: temporary,
            env: {
              ...process.env,
              GITHUB_TOKEN: "",
              GH_TOKEN: "",
              AUDIT_FIXTURE: "missing",
            },
            encoding: "utf8",
          },
        );
        assert.strictEqual(missing.status, 0, missing.stderr);
        assert.deepStrictEqual(
          JSON.parse(fs.readFileSync(indexPath, "utf8")).skills,
          [],
        );
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    });
    console.log("\nAudit installability tests passed.");
  })
  .catch((error) => {
    console.error("FAIL audit refuses uncertain network results", error);
    process.exitCode = 1;
  });
