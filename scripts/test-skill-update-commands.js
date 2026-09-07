const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

function load(name, mocks) {
  const filename = path.join(__dirname, "..", "src", `${name}.ts`);
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(
    output,
    {
      module,
      exports: module.exports,
      require: (id) => (Object.hasOwn(mocks, id) ? mocks[id] : require(id)),
      process,
      AbortController,
      console,
      Buffer,
    },
    { filename },
  );
  return module.exports;
}

const uri = (value) => ({
  scheme: "file",
  fsPath: value,
  toString: () => value,
});
const root = {
  scope: "workspace",
  rootPath: "/skills",
  rootUri: uri("/skills"),
  isManaged: true,
  isReadOnly: false,
};
const revision = {
  owner: "owner",
  repo: "repo",
  ref: "main",
  remotePath: "demo",
  commitSha: "a".repeat(40),
  contentSha: "b".repeat(40),
  kind: "tree",
};
const githubResponse = load("githubResponse", {});
const updates = load("skillUpdates", {
  "./githubFetch": {},
  "./githubResponse": githubResponse,
});

class IncompleteInstall extends Error {
  constructor(kinds) {
    super("private-name ghp_secret C:\\private");
    this.failures = kinds.map((kind) => ({ kind }));
  }
}

async function scenario({
  entries,
  choice,
  fail,
  failCheck,
  failKinds,
  partialKinds,
  cancelInstall,
  cancelCheck,
  cancelEntries,
  language = "auto",
  envLanguage = "en",
  report = false,
  disappear,
  item = { skillRoot: root },
  all = false,
  roots = [root],
}) {
  const commands = new Map();
  const installed = [];
  const refreshed = [];
  const messages = [];
  const executed = [];
  const notifications = [];
  const progressMessages = [];
  let targets = 0;
  let cancel;
  let requests = 0;
  let rootReads = 0;
  let tokenReads = 0;
  const vscode = {
    env: { language: envLanguage },
    workspace: { getConfiguration: () => ({ get: () => language }) },
    ProgressLocation: { Notification: 15 },
    commands: {
      executeCommand: async (...args) => executed.push(args),
      registerCommand: (id, handler) => {
        commands.set(id, handler);
        return { dispose() {} };
      },
    },
    window: {
      showInformationMessage: (message) => {
        messages.push(message);
        return new Promise(() => {});
      },
      showWarningMessage: (message, options, ...choices) => {
        messages.push(message);
        notifications.push({ message, options, choices });
        return options?.modal
          ? Promise.resolve(
              choice === "legacy"
                ? choices.at(-1)
                : choice === "cancel"
                  ? undefined
                  : choices[0],
            )
          : report
            ? Promise.resolve(options)
            : new Promise(() => {});
      },
      withProgress: async (_, callback) =>
        callback(
          {
            report(value) {
              progressMessages.push(value.message);
            },
          },
          {
            isCancellationRequested: false,
            onCancellationRequested: (listener) => {
              cancel = listener;
              return { dispose() {} };
            },
          },
        ),
    },
  };
  const controller = load("skillUpdateCommands", {
    vscode,
    "./i18n": load("i18n", { vscode }),
    "./githubResponse": githubResponse,
    "./treeProvider": {
      resolveCurrentSkillRoot: (item, current) => {
        const previous = item?.skillRoot || item?.skill?.root;
        const matches = current.filter(
          (candidate) =>
            candidate.scope === previous?.scope &&
            candidate.rootPath === previous?.rootPath,
        );
        return matches.length === 1 ? matches[0] : undefined;
      },
    },
    "./skillUpdates": {
      ...updates,
      createSkillRevisionResolver: (token, signal) =>
        updates.createSkillRevisionResolver(token, signal, async (url) => {
          requests++;
          if (failCheck) {
            return {
              ok: false,
              status: 429,
              headers: new Headers(),
              text: async () => "private-name ghp_secret C:\\private",
            };
          }
          if (url.includes("/commits/")) {
            return {
              ok: true,
              json: async () => ({
                sha: revision.commitSha,
                commit: { tree: { sha: "c".repeat(40) } },
              }),
            };
          }
          return {
            ok: true,
            json: async () => ({
              sha: "c".repeat(40),
              truncated: false,
              tree: entries.map((entry) => ({
                path: entry.meta.remotePath,
                sha: revision.contentSha,
                type: "tree",
                mode: "040000",
              })),
            }),
          };
        }),
    },
    "./skillInstaller": {
      SkillInstallIncompleteError: IncompleteInstall,
      classifySkillInstallFailure: (error) =>
        githubResponse.isGitHubResponseError(error) ? error.kind : "unknown",
      resolveManagedSkillDirUri: (rootUri, relative) =>
        uri(path.join(rootUri.fsPath, relative)),
      resolveSkillDownloadTarget: async (skill) => {
        if (++targets === cancelCheck) {
          cancel();
          throw Error("private-name ghp_secret C:\\private");
        }
        return {
          owner: "owner",
          repo: "repo",
          branch: "main",
          remotePath: skill.path,
        };
      },
      installSkillUpdate: async (...args) => {
        installed.push(args);
        if (failKinds) {
          throw new IncompleteInstall(failKinds);
        }
        if (partialKinds) {
          return {
            status: "partial",
            failures: partialKinds.map((kind) => ({ kind })),
          };
        }
        if (cancelInstall) {
          cancel();
          throw Error("cancelled");
        }
        if (fail) {
          throw Error("private-name ghp_secret C:\\private");
        }
        return { status: "ok" };
      },
    },
  });
  const disposables = controller.registerSkillUpdateCommands({
    context: {},
    getRoots: async () => (disappear && rootReads++ > 0 ? [] : roots),
    getIndex: async () => ({ sources: [] }),
    getEntries: async () => {
      if (cancelEntries) cancel();
      return entries;
    },
    getToken: async () => {
      tokenReads++;
      return undefined;
    },
    afterUpdate: async (changedRoots) => refreshed.push(...changedRoots),
  });
  assert.strictEqual(disposables.length, 2);
  const summary = await commands.get(
    all ? "skillNinja.updateAll" : "skillNinja.updateRoot",
  )(item);
  return {
    summary,
    progressMessages,
    installed,
    refreshed,
    messages,
    requests,
    tokenReads,
    executed,
    notifications,
    repeat: async () => {
      await commands.get(
        all ? "skillNinja.updateAll" : "skillNinja.updateRoot",
      )(item);
      return requests;
    },
  };
}

function entry(name, baseline = true) {
  return {
    workspaceUri: uri("/workspace"),
    skill: { name, source: "source", path: name },
    meta: {
      name,
      source: "source",
      remotePath: name,
      relativePath: name,
      customWhenToUse: "keep",
      registrationDisabled: true,
      ...(baseline
        ? { sourceRevision: { ...revision, remotePath: name } }
        : {}),
    },
  };
}

async function main() {
  const localOnly = await scenario({
    entries: [{ ...entry("local"), skill: undefined }],
  });
  assert.strictEqual(localOnly.tokenReads, 0);
  assert.strictEqual(localOnly.requests, 0);
  assert.strictEqual(localOnly.summary.deferred, 1);
  for (const language of ["en", "ja"]) {
    const checked = await scenario({
      entries: [entry("one"), entry("two")],
      language,
    });
    assert.ok(
      checked.progressMessages[0].includes(
        language === "ja" ? "確認中" : "Reading installed",
      ),
    );
    assert.ok(
      checked.progressMessages.includes(
        language === "ja"
          ? "スキルルートを確認中 (1/1)"
          : "Scanning skill roots (1/1)",
      ),
    );
    assert.ok(
      checked.progressMessages.includes(
        language === "ja"
          ? "更新の有無を確認中 (1/2)"
          : "Checking updates (1/2)",
      ),
    );
    assert.ok(
      checked.progressMessages.includes(
        language === "ja"
          ? "更新の有無を確認中 (2/2)"
          : "Checking updates (2/2)",
      ),
    );
    assert.strictEqual(checked.installed.length, 0);
    const synced = await scenario({
      entries: [entry("legacy", false)],
      language,
      choice: "legacy",
    });
    assert.ok(
      synced.progressMessages.includes(
        language === "ja" ? "スキルを更新中 (1/1)" : "Updating skills (1/1)",
      ),
    );
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  );
  const menus = manifest.contributes.menus["view/item/context"];
  assert.strictEqual(
    menus.filter(
      (menu) =>
        menu.command === "skillNinja.updateRoot" &&
        menu.group.startsWith("inline"),
    ).length,
    2,
  );
  assert.ok(
    !menus.some(
      (menu) =>
        menu.command === "skillNinja.reinstallRoot" &&
        menu.group.startsWith("inline"),
    ),
  );
  for (const id of [
    "updateRoot",
    "updateAll",
    "reinstallRoot",
    "reinstallAll",
  ]) {
    assert.ok(
      manifest.contributes.commands.some(
        (command) => command.command === `skillNinja.${id}`,
      ),
    );
    for (const file of ["package.nls.json", "package.nls.ja.json"]) {
      assert.ok(
        JSON.parse(fs.readFileSync(path.join(__dirname, "..", file), "utf8"))[
          `command.${id}`
        ],
      );
    }
  }
  let result = await scenario({ entries: [entry("demo")] });
  for (const [language, envLanguage, expected] of [
    ["ja", "en", "スキル更新:"],
    ["en", "ja", "Skill update:"],
  ]) {
    const localized = await scenario({
      entries: [entry("demo")],
      language,
      envLanguage,
    });
    assert.ok(localized.messages.at(-1).startsWith(expected));
  }
  assert.strictEqual(result.summary.unchanged, 1);
  assert.strictEqual(result.installed.length, 0);
  assert.strictEqual(result.refreshed.length, 0);
  assert.strictEqual(result.requests, 2);
  assert.strictEqual(
    await result.repeat(),
    4,
    "a later invocation must fetch a fresh snapshot",
  );
  const changed = entry("changed");
  changed.meta.sourceRevision.contentSha = "d".repeat(40);
  for (const cancellation of [{ cancelCheck: 2 }, { cancelEntries: true }]) {
    const cancelled = await scenario({
      entries: [changed, entry("legacy", false), entry("third", false)],
      ...cancellation,
    });
    assert.strictEqual(cancelled.summary.cancelled, true);
    assert.strictEqual(cancelled.summary.deferred, 3);
    assert.strictEqual(cancelled.summary.checkFailed, 0);
    assert.strictEqual(cancelled.installed.length, 0);
  }
  for (const option of ["failKinds", "partialKinds"]) {
    const failed = await scenario({
      entries: [changed],
      report: true,
      [option]: [
        "transport",
        "filesystem",
        "policy-limit",
        "C:/private-secret",
      ],
    });
    assert.strictEqual(failed.summary.updateFailed, 1);
    const diagnostics = failed.executed[0][1];
    assert.ok(diagnostics.includes("update:transport=1"));
    assert.ok(diagnostics.includes("update:filesystem=1"));
    assert.ok(diagnostics.includes("update:policy-limit=1"));
    assert.ok(diagnostics.includes("update:other=1"));
    assert.ok(!diagnostics.includes("private"));
  }

  for (const failure of [{ fail: true }, { failCheck: true }]) {
    const failed = await scenario({
      entries: [changed],
      report: true,
      ...failure,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(failed.executed.length, 1);
    assert.strictEqual(failed.executed[0][0], "skillNinja.reportBug");
    assert.strictEqual(
      failed.executed[0][1],
      `Skill update failures\n${failure.fail ? "update:other" : "check:rate-limit"}=1`,
    );
    assert.ok(
      !/private|ghp_|C:/.test(
        JSON.stringify(failed.messages) + JSON.stringify(failed.executed),
      ),
    );
    assert.strictEqual(failed.notifications.at(-1).options, "Report Bug");
    assert.strictEqual(failed.summary.updated, 0);
  }
  result = await scenario({
    entries: [changed, entry("unchanged"), entry("legacy", false)],
    choice: "changed",
  });
  assert.strictEqual(
    result.requests,
    2,
    "one repository/ref snapshot per invocation",
  );
  assert.strictEqual(result.installed.length, 1);
  assert.strictEqual(
    result.installed[0][4],
    changed.meta,
    "original metadata handed to transaction",
  );
  assert.strictEqual(result.installed[0][5].commitSha, revision.commitSha);
  assert.strictEqual(result.summary.deferred, 1);
  assert.strictEqual(result.refreshed.length, 1);
  result = await scenario({
    entries: [entry("legacy", false)],
    choice: "legacy",
    all: true,
  });
  assert.strictEqual(result.summary.synchronized, 1);
  result = await scenario({ entries: [changed], choice: "cancel" });
  assert.strictEqual(result.summary.cancelled, true);
  assert.strictEqual(result.installed.length, 0);
  result = await scenario({ entries: [changed], fail: true });
  assert.strictEqual(result.summary.updateFailed, 1);
  assert.strictEqual(result.refreshed.length, 0);
  result = await scenario({ entries: [changed], failCheck: true });
  assert.strictEqual(result.summary.checkFailed, 1);
  assert.strictEqual(result.summary.unchanged, 0);
  assert.strictEqual(result.installed.length, 0);
  result = await scenario({ entries: [changed], disappear: true });
  assert.strictEqual(result.summary.deferred, 1);
  assert.strictEqual(result.installed.length, 0);
  result = await scenario({ entries: [changed], cancelInstall: true });
  assert.strictEqual(result.summary.cancelled, true);
  assert.strictEqual(result.summary.updateFailed, 0);
  result = await scenario({ entries: [changed], item: {} });
  assert.strictEqual(result.installed.length, 0);
  result = await scenario({ entries: [changed], roots: [root, { ...root }] });
  assert.strictEqual(
    result.installed.length,
    0,
    "ambiguous current root must never pick the first match",
  );
  result = await scenario({
    entries: [changed],
    item: { skillRoot: { ...root, isReadOnly: true } },
  });
  assert.strictEqual(
    result.summary.updated,
    1,
    "current root overrides stale flags",
  );
  result = await scenario({
    entries: [changed],
    roots: [{ ...root, isReadOnly: true }],
  });
  assert.strictEqual(result.installed.length, 0);
  const repair = entry("repair");
  repair.meta.repairState = "partial";
  result = await scenario({
    entries: [repair, { ...entry("unknown"), skill: undefined }],
  });
  assert.strictEqual(result.summary.repairNeeded, 1);
  assert.strictEqual(result.summary.deferred, 1);
  assert.strictEqual(result.requests, 0);
  result = await scenario({
    entries: [entry("parent"), entry("parent/child")],
  });
  assert.strictEqual(result.installed.length, 0);
  assert.strictEqual(result.summary.deferred, 2);
  console.log(
    "PASS skill update controller: grouped fresh checks, no-op, confirmation, metadata, cancellation, failure, current roots and overlaps",
  );
}

const watchdog = setTimeout(() => {
  console.error(
    "FAIL controller awaited a non-confirmation notification or did not settle",
  );
  process.exitCode = 1;
}, 5000);
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
