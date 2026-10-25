#!/usr/bin/env node

// 既存スキル再インストールの計画ロジック（純粋関数）の通常系・曖昧系・失敗系を固定する。
//
// 重視するのは「黙って上書きしない」こと:
// - メタデータのない配置は名前だけで source を決めない
// - 独自編集・source 切り替え・取得失敗は保留にする
// - 同名の public / private を先頭一致で選ばない

const assert = require("assert");
const { loadSrcModule } = require("./load-src-module.js");

const {
  buildCandidateId,
  buildReinstallPlan,
  classifyProvenance,
  computeGitBlobSha,
  computeLocalFingerprint,
  computePlanId,
  describeProvenance,
  diffLocalAgainstRemote,
  findNameCandidates,
  hashLocalFile,
  planEntry,
  selectEntries,
  selectSkillForInstall,
} = loadSrcModule("./skillReinstallPlan");

let failures = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(`  ${error.stack || error.message}`);
  }
}

const sha = (char) => char.repeat(40);

function files(map) {
  return new Map(
    Object.entries(map).map(([name, text]) => [
      name,
      hashLocalFile(Buffer.from(text)),
    ]),
  );
}

function remoteOf(map) {
  return new Map(
    Object.entries(map).map(([name, text]) => [
      name,
      computeGitBlobSha(Buffer.from(text)),
    ]),
  );
}

function revision(source, remotePath, char = "a") {
  return {
    owner: "owner",
    repo: source,
    ref: "main",
    remotePath,
    commitSha: sha(char),
    contentSha: sha(char === "a" ? "b" : "c"),
    kind: "tree",
  };
}

function entry(overrides = {}) {
  return {
    entryId: "home-copilot::demo",
    rootId: "home-copilot",
    rootLabel: "GitHub Copilot Home (~/.copilot/skills) [home-copilot]",
    rootPath: "/home/u/.copilot/skills",
    readOnly: false,
    name: "demo",
    relativePath: "demo",
    source: "mine",
    remotePath: "skills/demo",
    sourceRevision: revision("mine", "skills/demo", "d"),
    metaFilePresent: true,
    reinstallDisabled: false,
    needsRepair: false,
    ...overrides,
  };
}

/**
 * index: [{ source, path, name, remote: {file: text}, revision?, error? }]
 * local: { file: text } for every entry unless overridden by localByEntry
 */
function makeDeps({
  index,
  local = { "SKILL.md": "same" },
  localByEntry = {},
  baseline,
}) {
  const candidates = index.map((item) => ({
    candidateId: buildCandidateId(item.source, item.path),
    source: item.source,
    sourceLabel: item.source,
    path: item.path,
    name: item.name,
  }));
  const calls = { resolve: [], remote: [] };
  return {
    calls,
    deps: {
      findCandidates(target, allowed) {
        return candidates.filter(
          (candidate) =>
            candidate.name.toLowerCase() === target.name.toLowerCase() &&
            (!allowed || allowed.has(candidate.source.toLowerCase())),
        );
      },
      getCandidate(candidateId) {
        return candidates.find(
          (candidate) =>
            candidate.candidateId.toLowerCase() === candidateId.toLowerCase(),
        );
      },
      async resolveRevision(candidate) {
        calls.resolve.push(candidate.candidateId);
        const item = index.find(
          (value) =>
            buildCandidateId(value.source, value.path) ===
            candidate.candidateId,
        );
        if (item.error) {
          throw item.error;
        }
        return item.revision ?? revision(item.source, item.path, "e");
      },
      async readRemoteFiles(rev) {
        calls.remote.push(rev.commitSha);
        if (baseline && rev.commitSha === baseline.commitSha) {
          return { files: remoteOf(baseline.files), truncated: false };
        }
        const item = index.find(
          (value) => value.source === rev.repo && value.path === rev.remotePath,
        );
        if (item?.truncated) {
          return { files: new Map(), truncated: true };
        }
        return { files: remoteOf(item?.remote ?? {}), truncated: false };
      },
      async readLocalFiles(target) {
        return files(localByEntry[target.entryId] ?? local);
      },
    },
  };
}

const NO_FLAGS = {
  adopt: {},
  allowLocalEdits: new Set(),
  allowSourceSwitch: new Set(),
};

function missingPathError() {
  const error = new Error("Skill source path no longer exists.");
  error.name = "SkillSourcePathMissingError";
  return error;
}

(async () => {
  await test("verified skill with untouched content is ready to reinstall", async () => {
    const { deps } = makeDeps({
      index: [
        {
          source: "mine",
          path: "skills/demo",
          name: "demo",
          remote: { "SKILL.md": "new upstream" },
        },
      ],
      baseline: { commitSha: sha("d"), files: { "SKILL.md": "same" } },
    });
    const item = await planEntry(entry(), NO_FLAGS, deps);
    assert.strictEqual(item.status, "ready");
    assert.strictEqual(item.action, "reinstall");
    assert.strictEqual(item.baseline, "recorded");
    assert.strictEqual(item.target.commitSha, sha("e"));
    assert.strictEqual(item.provenance, "verified");
  });

  await test("an item already at the recorded revision with identical content is skipped, not reinstalled", async () => {
    const setup = () =>
      makeDeps({
        index: [
          {
            source: "mine",
            path: "skills/demo",
            name: "demo",
            remote: { "SKILL.md": "same" },
          },
        ],
        local: { "SKILL.md": "same" },
      });
    // 記録済み revision == 目標 revision（どちらも "e"）
    const upToDate = entry({
      sourceRevision: revision("mine", "skills/demo", "e"),
    });

    const skipped = await planEntry(upToDate, NO_FLAGS, setup().deps);
    assert.strictEqual(skipped.status, "skipped");
    assert.strictEqual(skipped.reason, "up-to-date");

    const forced = await planEntry(
      upToDate,
      { ...NO_FLAGS, force: true },
      setup().deps,
    );
    assert.strictEqual(forced.status, "ready");
  });

  await test("same revision but locally edited content is still held, not skipped", async () => {
    const { deps } = makeDeps({
      index: [
        {
          source: "mine",
          path: "skills/demo",
          name: "demo",
          remote: { "SKILL.md": "same" },
        },
      ],
      local: { "SKILL.md": "my edit" },
      baseline: { commitSha: sha("e"), files: { "SKILL.md": "same" } },
    });
    const item = await planEntry(
      entry({ sourceRevision: revision("mine", "skills/demo", "e") }),
      NO_FLAGS,
      deps,
    );
    assert.strictEqual(item.status, "hold");
    assert.strictEqual(item.reason, "local-edits");
  });

  await test("local edits against the recorded revision are held, then released by approval", async () => {
    const setup = () =>
      makeDeps({
        index: [
          { source: "mine", path: "skills/demo", name: "demo", remote: {} },
        ],
        local: { "SKILL.md": "my edit" },
        baseline: { commitSha: sha("d"), files: { "SKILL.md": "original" } },
      });
    const held = await planEntry(entry(), NO_FLAGS, setup().deps);
    assert.strictEqual(held.status, "hold");
    assert.strictEqual(held.reason, "local-edits");
    assert.deepStrictEqual(held.diff.changed, ["SKILL.md"]);

    const approved = await planEntry(
      entry(),
      { ...NO_FLAGS, allowLocalEdits: new Set(["home-copilot::demo"]) },
      setup().deps,
    );
    assert.strictEqual(approved.status, "ready");
  });

  await test("a skill without metadata is never matched by name alone", async () => {
    const { deps, calls } = makeDeps({
      index: [
        {
          source: "mine-private",
          path: ".github/skills/demo",
          name: "demo",
          remote: { "SKILL.md": "same" },
        },
        {
          source: "mine",
          path: "demo",
          name: "demo",
          remote: { "SKILL.md": "different" },
        },
      ],
    });
    const orphan = entry({
      source: "local",
      remotePath: undefined,
      sourceRevision: undefined,
      metaFilePresent: false,
    });
    const item = await planEntry(orphan, NO_FLAGS, deps);
    assert.strictEqual(item.status, "hold");
    assert.strictEqual(item.reason, "no-provenance");
    assert.strictEqual(item.action, undefined);
    assert.strictEqual(item.provenance, "origin-unknown");
    assert.deepStrictEqual(
      item.candidates.map((value) => value.candidate.candidateId),
      ["mine-private::.github/skills/demo", "mine::demo"],
    );
    // 根拠: 一致する候補と、異なる候補を区別して返す
    assert.strictEqual(item.candidates[0].diff.identical, true);
    assert.strictEqual(item.candidates[1].diff.identical, false);
    // 提示のための照合はしても、書き込み用の revision 解決で選択はしていない
    assert.ok(calls.resolve.length >= 2);
  });

  await test("adopting a content-identical candidate is ready; a differing one needs approval", async () => {
    const index = [
      {
        source: "mine-private",
        path: ".github/skills/demo",
        name: "demo",
        remote: { "SKILL.md": "same" },
      },
      {
        source: "mine",
        path: "demo",
        name: "demo",
        remote: { "SKILL.md": "different" },
      },
    ];
    const orphan = entry({
      source: "local",
      remotePath: undefined,
      sourceRevision: undefined,
      metaFilePresent: false,
    });

    const identical = await planEntry(
      orphan,
      {
        ...NO_FLAGS,
        adopt: { [orphan.entryId]: "mine-private::.github/skills/demo" },
      },
      makeDeps({ index }).deps,
    );
    assert.strictEqual(identical.status, "ready");
    assert.strictEqual(identical.action, "adopt");
    assert.strictEqual(identical.baseline, "target");
    assert.strictEqual(identical.candidate.source, "mine-private");

    const differing = await planEntry(
      orphan,
      { ...NO_FLAGS, adopt: { [orphan.entryId]: "mine::demo" } },
      makeDeps({ index }).deps,
    );
    assert.strictEqual(differing.status, "hold");
    assert.strictEqual(differing.reason, "local-edits");

    const approved = await planEntry(
      orphan,
      {
        ...NO_FLAGS,
        adopt: { [orphan.entryId]: "mine::demo" },
        allowLocalEdits: new Set([orphan.entryId]),
      },
      makeDeps({ index }).deps,
    );
    assert.strictEqual(approved.status, "ready");
  });

  await test("adopt with an ineligible candidate is rejected and other sources are not offered", async () => {
    const index = [
      {
        source: "mine",
        path: "demo",
        name: "demo",
        remote: { "SKILL.md": "same" },
      },
      {
        source: "vendor",
        path: "skills/demo",
        name: "demo",
        remote: { "SKILL.md": "same" },
      },
    ];
    const orphan = entry({
      source: "local",
      remotePath: undefined,
      sourceRevision: undefined,
      metaFilePresent: false,
    });

    const restricted = await planEntry(
      orphan,
      {
        ...NO_FLAGS,
        adopt: { [orphan.entryId]: "vendor::skills/demo" },
        allowedSources: new Set(["mine"]),
      },
      makeDeps({ index }).deps,
    );
    assert.strictEqual(restricted.status, "hold");
    assert.strictEqual(restricted.reason, "candidate-not-found");
    assert.deepStrictEqual(
      restricted.candidates.map((value) => value.candidate.source),
      ["mine"],
    );

    const noMatch = await planEntry(
      orphan,
      { ...NO_FLAGS, allowedSources: new Set(["nobody"]) },
      makeDeps({ index }).deps,
    );
    assert.strictEqual(noMatch.reason, "no-candidate");
  });

  await test("recorded source missing from the index, or removed upstream, is held", async () => {
    const missing = await planEntry(
      entry(),
      NO_FLAGS,
      makeDeps({ index: [] }).deps,
    );
    assert.strictEqual(missing.status, "hold");
    assert.strictEqual(missing.reason, "source-missing");

    const removed = await planEntry(
      entry(),
      NO_FLAGS,
      makeDeps({
        index: [
          {
            source: "mine",
            path: "skills/demo",
            name: "demo",
            error: missingPathError(),
          },
        ],
      }).deps,
    );
    assert.strictEqual(removed.status, "hold");
    assert.strictEqual(removed.reason, "source-removed");
    assert.strictEqual(removed.action, undefined);
  });

  await test("fetch failures are held and never marked ready", async () => {
    const failed = await planEntry(
      entry(),
      NO_FLAGS,
      makeDeps({
        index: [
          {
            source: "mine",
            path: "skills/demo",
            name: "demo",
            error: new Error("HTTP 502"),
          },
        ],
      }).deps,
    );
    assert.strictEqual(failed.status, "hold");
    assert.strictEqual(failed.reason, "fetch-failed");
    assert.match(failed.detail, /502/);

    const truncated = await planEntry(
      entry(),
      NO_FLAGS,
      makeDeps({
        index: [
          {
            source: "mine",
            path: "skills/demo",
            name: "demo",
            remote: {},
            truncated: true,
          },
        ],
        baseline: undefined,
      }).deps,
    );
    assert.strictEqual(truncated.status, "hold");
    assert.strictEqual(truncated.reason, "fetch-failed");
  });

  await test("switching to a different source needs its own approval", async () => {
    const index = [
      {
        source: "mine",
        path: "skills/demo",
        name: "demo",
        remote: { "SKILL.md": "same" },
      },
      {
        source: "mine-private",
        path: ".github/skills/demo",
        name: "demo",
        remote: { "SKILL.md": "same" },
      },
    ];
    const request = {
      ...NO_FLAGS,
      adopt: { "home-copilot::demo": "mine-private::.github/skills/demo" },
    };
    const held = await planEntry(
      entry(),
      request,
      makeDeps({
        index,
        baseline: { commitSha: sha("d"), files: { "SKILL.md": "same" } },
      }).deps,
    );
    assert.strictEqual(held.status, "hold");
    assert.strictEqual(held.reason, "source-switch");

    const approved = await planEntry(
      entry(),
      { ...request, allowSourceSwitch: new Set(["home-copilot::demo"]) },
      makeDeps({ index }).deps,
    );
    assert.strictEqual(approved.status, "ready");
    assert.strictEqual(approved.action, "reinstall");
    assert.strictEqual(approved.candidate.source, "mine-private");
    // 別 source へ切り替えるときは、記録済み revision ではなく取得先を基準にする
    assert.strictEqual(approved.baseline, "target");
  });

  await test("read-only roots and disabled skills are skipped without network access", async () => {
    const { deps, calls } = makeDeps({ index: [] });
    const readOnly = await planEntry(entry({ readOnly: true }), NO_FLAGS, deps);
    assert.strictEqual(readOnly.status, "skipped");
    assert.strictEqual(readOnly.reason, "read-only-root");
    const disabled = await planEntry(
      entry({ reinstallDisabled: true }),
      NO_FLAGS,
      deps,
    );
    assert.strictEqual(disabled.status, "skipped");
    assert.strictEqual(disabled.reason, "reinstall-disabled");
    assert.deepStrictEqual(calls.resolve, []);
  });

  await test("app-synced skills are skipped without network access", async () => {
    const { deps, calls } = makeDeps({ index: [] });
    const item = await planEntry(entry({ appManaged: true }), NO_FLAGS, deps);
    assert.strictEqual(item.status, "skipped");
    assert.strictEqual(item.reason, "app-managed");
    assert.deepStrictEqual(calls.resolve, []);
  });

  await test("a placeholder install is repaired; only edits beyond SKILL.md hold it back", async () => {
    const index = [
      {
        source: "mine",
        path: "skills/demo",
        name: "demo",
        remote: { "SKILL.md": "real" },
      },
    ];
    const plain = await planEntry(
      entry({ needsRepair: true }),
      NO_FLAGS,
      makeDeps({ index, local: { "SKILL.md": "placeholder" } }).deps,
    );
    assert.strictEqual(plain.provenance, "needs-repair");
    assert.strictEqual(plain.status, "ready");
    assert.deepStrictEqual(plain.diff.changed, ["SKILL.md"]);

    const extra = await planEntry(
      entry({ needsRepair: true }),
      NO_FLAGS,
      makeDeps({
        index,
        local: { "SKILL.md": "placeholder", "notes.md": "my notes" },
      }).deps,
    );
    assert.strictEqual(extra.status, "hold");
    assert.strictEqual(extra.reason, "local-edits");

    const approved = await planEntry(
      entry({ needsRepair: true }),
      { ...NO_FLAGS, allowLocalEdits: new Set(["home-copilot::demo"]) },
      makeDeps({
        index,
        local: { "SKILL.md": "placeholder", "notes.md": "my notes" },
      }).deps,
    );
    assert.strictEqual(approved.status, "ready");
  });

  await test("a legacy record without a revision is compared with the latest source", async () => {
    const legacy = entry({ sourceRevision: undefined });
    assert.strictEqual(classifyProvenance(legacy), "revision-missing");
    const identical = await planEntry(
      legacy,
      NO_FLAGS,
      makeDeps({
        index: [
          {
            source: "mine",
            path: "skills/demo",
            name: "demo",
            remote: { "SKILL.md": "same" },
          },
        ],
      }).deps,
    );
    assert.strictEqual(identical.status, "ready");
    assert.strictEqual(identical.baseline, "target");

    const differing = await planEntry(
      legacy,
      NO_FLAGS,
      makeDeps({
        index: [
          {
            source: "mine",
            path: "skills/demo",
            name: "demo",
            remote: { "SKILL.md": "other" },
          },
        ],
      }).deps,
    );
    assert.strictEqual(differing.status, "hold");
    assert.strictEqual(differing.reason, "local-edits");
  });

  await test("line-ending differences are not treated as edits, binary files are untouched", () => {
    const local = new Map([
      ["SKILL.md", hashLocalFile(Buffer.from("a\r\nb\r\n"))],
      ["bin.dat", hashLocalFile(Buffer.from([1, 13, 10, 0, 2]))],
    ]);
    const remote = new Map([
      ["SKILL.md", computeGitBlobSha(Buffer.from("a\nb\n"))],
      ["bin.dat", computeGitBlobSha(Buffer.from([1, 13, 10, 0, 2]))],
    ]);
    assert.strictEqual(diffLocalAgainstRemote(local, remote).identical, true);

    const edited = new Map([
      ["SKILL.md", hashLocalFile(Buffer.from("a\nc\n"))],
    ]);
    const diff = diffLocalAgainstRemote(
      edited,
      new Map([
        ["SKILL.md", computeGitBlobSha(Buffer.from("a\nb\n"))],
        ["extra.md", computeGitBlobSha(Buffer.from("x"))],
      ]),
    );
    assert.deepStrictEqual(diff.changed, ["SKILL.md"]);
    assert.deepStrictEqual(diff.removed, ["extra.md"]);
    assert.strictEqual(diff.identical, false);
  });

  await test("exact mode catches NUL-free byte corruption that line-ending tolerance would hide", () => {
    // ソース [255,10,1] に対し、取得側が [255,13,10,1] を書いた場合
    const remote = new Map([
      ["a.bin", computeGitBlobSha(Buffer.from([255, 10, 1]))],
    ]);
    const local = new Map([
      ["a.bin", hashLocalFile(Buffer.from([255, 13, 10, 1]))],
    ]);
    assert.strictEqual(diffLocalAgainstRemote(local, remote).identical, true);
    const exact = diffLocalAgainstRemote(local, remote, { exact: true });
    assert.strictEqual(exact.identical, false);
    assert.deepStrictEqual(exact.changed, ["a.bin"]);
  });

  await test("extension-owned metadata is ignored at any depth and in any case on both sides", () => {
    const local = new Map([["SKILL.md", hashLocalFile(Buffer.from("x"))]]);
    const remote = new Map([
      ["SKILL.md", computeGitBlobSha(Buffer.from("x"))],
      ["sub/.skill-meta.json", computeGitBlobSha(Buffer.from("{}"))],
      [".SKILL-META.JSON", computeGitBlobSha(Buffer.from("{}"))],
    ]);
    assert.strictEqual(
      diffLocalAgainstRemote(local, remote, { exact: true }).identical,
      true,
    );
  });

  await test("the metadata file never counts as a content difference", () => {
    const local = new Map([
      ["SKILL.md", hashLocalFile(Buffer.from("x"))],
      [".skill-meta.json", hashLocalFile(Buffer.from("{}"))],
    ]);
    const remote = new Map([
      ["SKILL.md", computeGitBlobSha(Buffer.from("x"))],
      [".skill-meta.json", computeGitBlobSha(Buffer.from('{"a":1}'))],
    ]);
    assert.strictEqual(diffLocalAgainstRemote(local, remote).identical, true);
  });

  await test("planId changes when local content or the target changes", async () => {
    const index = [
      {
        source: "mine",
        path: "skills/demo",
        name: "demo",
        remote: { "SKILL.md": "same" },
      },
    ];
    const planWith = async (local, targetChar) => {
      const { deps } = makeDeps({
        index: [
          {
            ...index[0],
            revision: revision("mine", "skills/demo", targetChar),
          },
        ],
        local,
      });
      return buildReinstallPlan(
        [entry({ sourceRevision: undefined })],
        NO_FLAGS,
        deps,
      );
    };
    const first = await planWith({ "SKILL.md": "same" }, "e");
    const again = await planWith({ "SKILL.md": "same" }, "e");
    assert.strictEqual(first.planId, again.planId);
    const editedLocal = await planWith(
      { "SKILL.md": "same", "x.md": "new" },
      "e",
    );
    assert.notStrictEqual(first.planId, editedLocal.planId);
    const newTarget = await planWith({ "SKILL.md": "same" }, "f");
    assert.notStrictEqual(first.planId, newTarget.planId);
    assert.notStrictEqual(
      computeLocalFingerprint(files({ a: "1" })),
      computeLocalFingerprint(files({ a: "2" })),
    );
    assert.strictEqual(typeof computePlanId([]), "string");
  });

  await test("an independent skill is planned even when another is on hold", async () => {
    const index = [
      {
        source: "mine",
        path: "skills/demo",
        name: "demo",
        remote: { "SKILL.md": "same" },
      },
    ];
    const ok = entry({ sourceRevision: undefined });
    const orphan = entry({
      entryId: "home-copilot::orphan",
      name: "orphan",
      relativePath: "orphan",
      source: "local",
      remotePath: undefined,
      sourceRevision: undefined,
      metaFilePresent: false,
    });
    const { deps } = makeDeps({ index });
    const plan = await buildReinstallPlan([ok, orphan], NO_FLAGS, deps);
    assert.deepStrictEqual(
      plan.items.map((item) => [item.name, item.status]),
      [
        ["demo", "ready"],
        ["orphan", "hold"],
      ],
    );
  });

  await test("targets must be explicit and are filtered by root, source and name", () => {
    const all = [
      entry(),
      entry({
        entryId: "home-codex::demo",
        rootId: "home-codex",
        rootLabel: "Codex Home",
      }),
      entry({
        entryId: "home-codex::other",
        rootId: "home-codex",
        name: "other",
        relativePath: "other",
        source: "vendor",
      }),
      entry({
        entryId: "home-codex::orphan",
        rootId: "home-codex",
        name: "orphan",
        relativePath: "orphan",
        source: "local",
        remotePath: undefined,
        sourceRevision: undefined,
      }),
    ];
    assert.ok("error" in selectEntries(all, {}));
    assert.ok("error" in selectEntries(all, { sources: ["mine"] }));

    const codex = selectEntries(all, {
      rootIds: ["home-codex"],
      sources: ["MINE"],
    });
    assert.deepStrictEqual(
      codex.entries.map((value) => value.entryId),
      ["home-codex::demo", "home-codex::orphan"],
    );
    const strict = selectEntries(all, {
      rootIds: ["home-codex"],
      sources: ["mine"],
      includeOriginUnknown: false,
    });
    assert.deepStrictEqual(
      strict.entries.map((value) => value.entryId),
      ["home-codex::demo"],
    );

    const byName = selectEntries(all, {
      rootIds: ["home-codex"],
      names: ["other"],
    });
    assert.deepStrictEqual(
      byName.entries.map((value) => value.entryId),
      ["home-codex::other"],
    );

    const exact = selectEntries(all, {
      entryIds: ["home-copilot::demo", "nope::x"],
      rootIds: ["ghost"],
    });
    assert.deepStrictEqual(
      exact.entries.map((value) => value.entryId),
      ["home-copilot::demo"],
    );
    assert.deepStrictEqual(exact.notFound, ["nope::x", "root:ghost"]);
  });

  await test("provenance column separates local-only skills from unmatched same-name candidates", () => {
    const skills = [
      { name: "demo", source: "mine", path: "skills/demo" },
      { name: "demo", source: "mine-private", path: ".github/skills/demo" },
      { name: "Other", source: "vendor", path: "o" },
      { name: "nopath", source: "vendor", path: "" },
    ];
    const orphan = entry({
      name: "demo",
      relativePath: "group/demo",
      source: "local",
      remotePath: undefined,
      sourceRevision: undefined,
    });
    assert.strictEqual(findNameCandidates(skills, orphan).length, 2);
    assert.deepStrictEqual(
      findNameCandidates(skills, orphan, new Set(["mine"])).map(
        (s) => s.source,
      ),
      ["mine"],
    );
    // フォルダ名が違っても SKILL.md の name で、name が違ってもフォルダ名で一致する
    assert.strictEqual(
      findNameCandidates(skills, { name: "x", relativePath: "OTHER" }).length,
      1,
    );
    assert.strictEqual(
      findNameCandidates(skills, { name: "nopath", relativePath: "nopath" })
        .length,
      0,
    );

    assert.strictEqual(
      describeProvenance(orphan, 0),
      "no metadata (local only: no same-name skill in the index)",
    );
    assert.strictEqual(
      describeProvenance(orphan, 1),
      "no metadata (1 same-name candidate in the index; not matched)",
    );
    assert.match(describeProvenance(orphan, 2), /2 same-name candidates/);
    assert.strictEqual(describeProvenance(entry(), 5), "verified");
    assert.strictEqual(
      describeProvenance(entry({ sourceRevision: undefined }), 0),
      "no revision",
    );
    assert.strictEqual(
      describeProvenance(entry({ needsRepair: true }), 0),
      "needs repair",
    );
    assert.strictEqual(
      describeProvenance(entry({ appManaged: true }), 0),
      "app-synced",
    );
  });

  await test("install selection never picks one of several same-named skills", () => {
    const skills = [
      {
        name: "vscode-extension-guide",
        source: "mine-private",
        path: ".github/skills/vscode-extension-guide",
      },
      {
        name: "vscode-extension-guide",
        source: "mine",
        path: "vscode-extension-guide",
      },
      { name: "vscode-extension-guide-extra", source: "mine", path: "extra" },
    ];
    const ambiguous = selectSkillForInstall(skills, {
      skillName: "vscode-extension-guide",
    });
    assert.strictEqual(ambiguous.kind, "ambiguous");
    assert.strictEqual(ambiguous.skills.length, 2);

    const bySource = selectSkillForInstall(skills, {
      skillName: "vscode-extension-guide",
      source: "mine",
    });
    assert.strictEqual(bySource.kind, "selected");
    assert.strictEqual(bySource.skill.source, "mine");

    const byId = selectSkillForInstall(skills, {
      skillName: "vscode-extension-guide",
      candidateId: "mine-private::.github/skills/vscode-extension-guide",
    });
    assert.strictEqual(byId.kind, "selected");
    assert.strictEqual(byId.skill.source, "mine-private");

    // 部分一致が複数あるときも、先頭を選ばない
    assert.strictEqual(
      selectSkillForInstall(skills, { skillName: "extension" }).kind,
      "ambiguous",
    );
    assert.strictEqual(
      selectSkillForInstall(skills, { skillName: "guide-extra" }).kind,
      "selected",
    );
    assert.strictEqual(
      selectSkillForInstall(skills, { skillName: "missing" }).kind,
      "none",
    );
    assert.strictEqual(
      selectSkillForInstall(skills, {
        skillName: "x",
        candidateId: "mine::unknown",
      }).kind,
      "none",
    );
  });

  if (failures > 0) {
    console.error(`\n${failures} skill reinstall plan test(s) failed.`);
    process.exit(1);
  }
  console.log("\nSkill reinstall plan tests passed.");
})();
