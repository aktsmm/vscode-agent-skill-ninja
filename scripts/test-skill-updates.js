const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const moduleExports = {};
const githubResponse = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/githubResponse.ts"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { exports: githubResponse.exports, URL },
);
let defaultRequest;
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/skillUpdates.ts"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  {
    exports: moduleExports,
    require(name) {
      if (name === "./githubResponse") return githubResponse.exports;
      assert.equal(name, "./githubFetch");
      return {
        fetchGitHubWithOptionalAuthRetry: (...args) => defaultRequest(...args),
      };
    },
  },
);
const {
  createSkillRevisionResolver,
  classifySkillUpdate,
  findRenamedSkillRevision,
} = moduleExports;
const hash = (digit) => digit.repeat(40);
const commitSha = hash("a");
const rootSha = hash("b");
const folderSha = hash("c");
const blobSha = hash("d");
const target = {
  owner: "Owner",
  repo: "Repo",
  branch: "feature/test",
  remotePath: "skills/example",
};
const entry = (remotePath, type, contentSha) => ({
  path: remotePath,
  type,
  sha: contentSha,
  mode: type === "tree" ? "040000" : "100644",
});
const commit = (value = commitSha) => ({
  sha: value,
  commit: { tree: { sha: rootSha } },
});
const tree = (value, entries, truncated = false) => ({
  sha: value,
  tree: entries,
  truncated,
});
const routes = () => ({
  "commits/feature%2Ftest": commit(),
  [`git/trees/${rootSha}?recursive=1`]: tree(rootSha, [
    entry("skills", "tree", hash("e")),
    entry("skills/example", "tree", folderSha),
    entry("skills/example/SKILL.md", "blob", blobSha),
    entry("single.md", "blob", blobSha),
  ]),
});
function mock(values, expectedSignal) {
  const calls = [];
  const request = async (url, options) => {
    calls.push(url);
    assert.equal(options.retry.signal, expectedSignal);
    assert.equal(options.token, "test-token");
    assert.ok(url.startsWith("https://api.github.com/repos/owner/repo/"));
    const key = url.slice("https://api.github.com/repos/owner/repo/".length);
    assert.ok(Object.hasOwn(values, key), `Unexpected request: ${key}`);
    const value = values[key];
    if (value instanceof Error) throw value;
    return {
      ok: typeof value.status !== "number",
      status: typeof value.status === "number" ? value.status : 200,
      headers: new Headers(value.headers),
      text: async () => value.body || "",
      json: async () => value,
    };
  };
  return { request, calls };
}
async function rejects(action) {
  await assert.rejects(
    action,
    (error) => error.message === "Unable to resolve skill source revision.",
  );
}

async function main() {
  const basic = mock(routes());
  defaultRequest = basic.request;
  const resolve = createSkillRevisionResolver("test-token");
  const [folder, standalone, nested] = await Promise.all([
    resolve(target),
    resolve({ ...target, remotePath: "single.md" }),
    resolve({ ...target, remotePath: "skills/example/SKILL.md" }),
  ]);
  assert.equal(basic.calls.length, 2);
  assert.deepEqual(
    { ...folder },
    {
      owner: "owner",
      repo: "repo",
      ref: target.branch,
      remotePath: target.remotePath,
      commitSha,
      contentSha: folderSha,
      kind: "tree",
    },
  );
  assert.equal(standalone.contentSha, blobSha);
  assert.equal(standalone.kind, "blob");
  assert.equal(nested.contentSha, blobSha);
  assert.equal(
    (await resolve({ ...target, remotePath: "" })).contentSha,
    rootSha,
  );
  const classify = (previous, current = folder) =>
    classifySkillUpdate({ sourceRevision: previous }, current);
  assert.equal(classify({ ...folder, commitSha: hash("f") }), "unchanged");
  assert.equal(
    classify({
      ...folder,
      owner: "OWNER",
      contentSha: folderSha.toUpperCase(),
    }),
    "unchanged",
  );
  for (const update of [
    { owner: "other" },
    { repo: "other" },
    { ref: "main" },
    { remotePath: "Skills/example" },
    { contentSha: hash("e") },
  ])
    assert.equal(classify(folder, { ...folder, ...update }), "changed");
  assert.equal(
    classify({ ...standalone, kind: "tree" }, standalone),
    "changed",
  );
  assert.equal(classify(standalone, standalone), "unchanged");
  assert.equal(classify(undefined), "untracked");
  for (const invalid of [
    null,
    {},
    { ...folder, commitSha: "bad" },
    { ...folder, contentSha: 1 },
    { ...folder, remotePath: "../bad" },
    { ...folder, owner: "a/b" },
    { ...folder, kind: "blob" },
    { ...folder, ref: "" },
  ]) {
    assert.equal(classify(invalid), "untracked");
  }
  assert.equal(
    classifySkillUpdate({ incomplete: true, sourceRevision: folder }, folder),
    "repair",
  );
  assert.equal(
    classifySkillUpdate({ repairState: "failed" }, folder),
    "repair",
  );
  await assert.rejects(() => resolve({ ...target, remotePath: "missing.md" }), {
    name: "SkillSourcePathMissingError",
  });
  for (const remotePath of [
    "../bad",
    "/absolute",
    "a//b",
    "a\\b",
    "a/%2e%2e/b",
    "a/./b",
    "a\u0000b",
  ]) {
    await rejects(() => resolve({ ...target, remotePath }));
  }
  await rejects(() => resolve({ ...target, owner: "../owner" }));
  await rejects(() => resolve({ ...target, branch: ".." }));
  await rejects(() => resolve({ ...target, branch: "." }));
  assert.equal(basic.calls.length, 2);

  const truncatedRoutes = routes();
  truncatedRoutes[`git/trees/${rootSha}?recursive=1`] = tree(rootSha, [], true);
  truncatedRoutes[`git/trees/${rootSha}`] = tree(rootSha, [
    entry("skills", "tree", hash("e")),
  ]);
  truncatedRoutes[`git/trees/${hash("e")}`] = tree(hash("e"), [
    entry("example", "tree", folderSha),
  ]);
  truncatedRoutes[`git/trees/${folderSha}`] = tree(folderSha, [
    entry("SKILL.md", "blob", blobSha),
  ]);
  const fallback = mock(truncatedRoutes);
  const fallbackResolve = createSkillRevisionResolver(
    "test-token",
    undefined,
    fallback.request,
  );
  assert.equal((await fallbackResolve(target)).contentSha, folderSha);
  assert.equal(
    (
      await fallbackResolve({
        ...target,
        remotePath: "skills/example/SKILL.md",
      })
    ).contentSha,
    blobSha,
  );
  const missingPath = mock({
    ...routes(),
    [`git/trees/${rootSha}?recursive=1`]: tree(rootSha, [
      entry("skills", "tree", hash("e")),
    ]),
  });
  await assert.rejects(
    createSkillRevisionResolver(
      "test-token",
      undefined,
      missingPath.request,
    )(target),
    { name: "SkillSourcePathMissingError" },
  );
  const renamedHead = hash("f");
  const renameRoutes = {
    ...routes(),
    "commits/feature%2Ftest": commit(renamedHead),
    [`git/trees/${rootSha}?recursive=1`]: tree(rootSha, [
      entry("skills/renamed", "tree", folderSha),
    ]),
    [`compare/${commitSha}...feature%2Ftest`]: {
      status: "ahead",
      ahead_by: 1,
      total_commits: 1,
      base_commit: { sha: commitSha },
      merge_base_commit: { sha: commitSha },
      commits: [{ sha: renamedHead }],
      files: [
        {
          status: "renamed",
          previous_filename: "skills/example/SKILL.md",
          filename: "skills/renamed/SKILL.md",
        },
      ],
    },
  };
  const rename = mock(renameRoutes);
  const renamed = await findRenamedSkillRevision(
    folder,
    "test-token",
    undefined,
    rename.request,
  );
  assert.equal(renamed?.remotePath, "skills/renamed");
  assert.equal(renamed?.commitSha, renamedHead);
  assert.equal(renamed?.ref, folder.ref);
  const renameKey = `compare/${commitSha}...feature%2Ftest`;
  const accepted = {
    status: "ahead",
    ahead_by: 1,
    total_commits: 1,
    base_commit: { sha: commitSha },
    merge_base_commit: { sha: commitSha },
    commits: [{ sha: renamedHead }],
    files: [
      {
        status: "renamed",
        previous_filename: "skills/example/SKILL.md",
        filename: "skills/renamed/SKILL.md",
      },
    ],
  };
  for (const rejected of [
    { ...accepted, status: "diverged" },
    { ...accepted, merge_base_commit: { sha: hash("d") } },
    { ...accepted, total_commits: 251 },
    {
      ...accepted,
      files: Array.from({ length: 300 }, () => accepted.files[0]),
    },
    { ...accepted, files: [] },
    {
      ...accepted,
      files: [
        ...accepted.files,
        { ...accepted.files[0], filename: "skills/other/SKILL.md" },
      ],
    },
    {
      ...accepted,
      files: [{ ...accepted.files[0], filename: "../unsafe/SKILL.md" }],
    },
    { ...accepted, commits: [{ sha: hash("e") }] },
  ]) {
    const candidate = mock({ ...renameRoutes, [renameKey]: rejected });
    assert.equal(
      await findRenamedSkillRevision(
        folder,
        "test-token",
        undefined,
        candidate.request,
      ),
      undefined,
    );
  }
  const forbiddenRename = mock({
    ...renameRoutes,
    [renameKey]: { status: 403, body: "private-path ghp_secret" },
  });
  await assert.rejects(
    () =>
      findRenamedSkillRevision(
        folder,
        "test-token",
        undefined,
        forbiddenRename.request,
      ),
    (error) => {
      assert.equal(error.kind, "auth-required");
      assert.ok(!error.message.includes("ghp_secret"));
      return true;
    },
  );
  await assert.rejects(
    () => fallbackResolve({ ...target, remotePath: "skills/missing" }),
    { name: "SkillSourcePathMissingError" },
  );
  assert.equal(fallback.calls.length, 5);
  const missingFallback = mock({
    ...truncatedRoutes,
    [`git/trees/${hash("e")}`]: tree(hash("e"), []),
  });
  await assert.rejects(
    () =>
      createSkillRevisionResolver(
        "test-token",
        undefined,
        missingFallback.request,
      )(target),
    { name: "SkillSourcePathMissingError" },
  );

  for (const status of [401, 403, 404, 429, 500]) {
    const failed = mock({ "commits/feature%2Ftest": { status } });
    const failedResolve = createSkillRevisionResolver(
      "test-token",
      undefined,
      failed.request,
    );
    await assert.rejects(
      () => failedResolve(target),
      (error) => {
        assert.ok(githubResponse.exports.isGitHubResponseError(error));
        assert.equal(error.status, status);
        assert.equal(
          error.kind,
          {
            401: "auth-required",
            403: "auth-required",
            404: "not-found",
            429: "rate-limit",
            500: "server-error",
          }[status],
        );
        assert.equal(error.message, "Unable to resolve skill source revision.");
        assert.equal(error.ssoAuthorizationUrl, undefined);
        return true;
      },
    );
    await rejects(() => failedResolve(target));
    assert.equal(failed.calls.length, 1);
  }
  for (const [headers, body, kind] of [
    [
      {
        "x-github-sso":
          "required; url=https://github.com/orgs/private-name/sso?token=ghp_secret",
      },
      "private-name",
      "sso-required",
    ],
    [
      {},
      "forbids access via a personal access tokens (classic) ghp_secret",
      "classic-pat-forbidden",
    ],
    [{ "x-ratelimit-remaining": "0" }, "C:\\private", "rate-limit"],
  ]) {
    const failed = mock({
      "commits/feature%2Ftest": { status: 403, headers, body },
    });
    await assert.rejects(
      () =>
        createSkillRevisionResolver(
          "test-token",
          undefined,
          failed.request,
        )(target),
      (error) => {
        assert.equal(error.kind, kind);
        assert.equal(error.message, "Unable to resolve skill source revision.");
        assert.equal(error.ssoAuthorizationUrl, undefined);
        assert.equal(error.resetAt, undefined);
        assert.ok(
          !/private|ghp_|test-token/.test(JSON.stringify(error) + error.stack),
        );
        return true;
      },
    );
  }
  for (const invalid of [
    {},
    { sha: "unsafe/path", commit: commit().commit },
    { sha: commitSha, commit: { tree: { sha: "bad" } } },
    new Error("secret token URL"),
  ]) {
    const malformed = mock({ "commits/feature%2Ftest": invalid });
    await rejects(() =>
      createSkillRevisionResolver(
        "test-token",
        undefined,
        malformed.request,
      )(target),
    );
  }
  for (const invalidTree of [
    tree(rootSha, [entry("../bad", "tree", folderSha)]),
    tree(rootSha, [entry("skills/example", "tree", "bad")]),
    tree(hash("f"), []),
    { sha: rootSha, tree: [] },
    tree(rootSha, [
      { ...entry("skills/example", "tree", folderSha), mode: "100644" },
    ]),
    tree(rootSha, [
      { ...entry("skills/example", "tree", folderSha), type: ["tree"] },
    ]),
    tree(rootSha, [
      { ...entry("single.md", "blob", blobSha), mode: ["100644"] },
    ]),
  ]) {
    const malformed = mock({
      ...routes(),
      [`git/trees/${rootSha}?recursive=1`]: invalidTree,
    });
    const malformedResolve = createSkillRevisionResolver(
      "test-token",
      undefined,
      malformed.request,
    );
    await rejects(() => malformedResolve(target));
    await rejects(() => malformedResolve(target));
    assert.equal(malformed.calls.length, 2);
  }
  const controller = new AbortController();
  const cancelled = mock(routes(), controller.signal);
  controller.abort();
  await assert.rejects(
    createSkillRevisionResolver(
      "test-token",
      controller.signal,
      cancelled.request,
    )(target),
    { name: "AbortError" },
  );
  assert.equal(cancelled.calls.length, 0);
  const inFlight = new AbortController();
  const midRequest = async (_url, options) => {
    assert.equal(options.retry.signal, inFlight.signal);
    inFlight.abort();
    throw new Error("sensitive abort reason");
  };
  await assert.rejects(
    createSkillRevisionResolver(
      "test-token",
      inFlight.signal,
      midRequest,
    )(target),
    { name: "AbortError" },
  );

  const refreshed = mock({
    ...routes(),
    "commits/feature%2Ftest": commit(hash("f")),
  });
  const fresh = await createSkillRevisionResolver(
    "test-token",
    undefined,
    refreshed.request,
  )(target);
  assert.equal(fresh.commitSha, hash("f"));
  assert.equal(classify(folder, fresh), "unchanged");
  assert.equal(refreshed.calls.length, 2);
  const otherRef = mock({ ...routes(), "commits/main": commit(hash("f")) });
  const multipleRefs = createSkillRevisionResolver(
    "test-token",
    undefined,
    otherRef.request,
  );
  await multipleRefs(target);
  assert.equal((await multipleRefs({ ...target, branch: "main" })).ref, "main");
  assert.equal(
    otherRef.calls.filter((url) => url.includes("/commits/")).length,
    2,
  );
  console.log(
    "PASS skill updates: resolution, classification, validation, fallback, errors, cancellation, cache freshness",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
