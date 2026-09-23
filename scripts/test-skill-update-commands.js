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
      URL,
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
  showDetails = false,
  renameRevision,
  renameChoice,
  renameInstallStatus = "ok",
  renameInstallFailure = false,
  failRefresh = false,
  existingRenameTarget = false,
  existingRenameTargetPath,
  renamePick = 0,
  missingPath = Boolean(renameRevision),
  indexedNewPath = false,
  indexSources = [],
  disappear,
  item = { skillRoot: root },
  all = false,
  roots = [root],
}) {
  const commands = new Map();
  const installed = [];
  const installedRenamed = [];
  const refreshed = [];
  const messages = [];
  const executed = [];
  const notifications = [];
  const progressMessages = [];
  const output = { lines: [], shown: false };
  const renameChecks = { count: 0 };
  const quickPicks = [];
  class FileSystemError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
  let targets = 0;
  let cancel;
  let requests = 0;
  let rootReads = 0;
  let tokenReads = 0;
  const vscode = {
    env: { language: envLanguage },
    FileSystemError,
    workspace: {
      getConfiguration: () => ({ get: () => language }),
      fs: {
        stat: async (target) => {
          if (
            existingRenameTarget ||
            target.fsPath === existingRenameTargetPath
          ) {
            return { type: 2 };
          }
          throw new FileSystemError("FileNotFound");
        },
      },
    },
    ProgressLocation: { Notification: 15 },
    commands: {
      executeCommand: async (...args) => executed.push(args),
      registerCommand: (id, handler) => {
        commands.set(id, handler);
        return { dispose() {} };
      },
    },
    window: {
      showQuickPick: async (items) => {
        quickPicks.push(items);
        return items[renamePick];
      },
      createOutputChannel: () => ({
        clear: () => {
          output.lines.length = 0;
        },
        appendLine: (line) => output.lines.push(line),
        show: () => {
          output.shown = true;
        },
        dispose() {},
      }),
      showInformationMessage: (message, ...choices) => {
        messages.push(message);
        return showDetails
          ? Promise.resolve(choices[0])
          : new Promise(() => {});
      },
      showWarningMessage: (message, options, ...choices) => {
        messages.push(message);
        notifications.push({ message, options, choices });
        return options?.modal
          ? choices.includes("Install new skill") ||
            choices.includes("新しいスキルをインストール")
            ? Promise.resolve(
                renameChoice === "install" ? choices[0] : undefined,
              )
            : Promise.resolve(
                choice === "legacy"
                  ? choices.at(-1)
                  : choice === "cancel"
                    ? undefined
                    : choices[0],
              )
          : report
            ? Promise.resolve(options)
            : renameChoice === "install" || renameChoice === "decline"
              ? Promise.resolve(
                  [options, ...choices].find(
                    (value) =>
                      value === "Install renamed skill" ||
                      value === "名前が変わったスキルを導入",
                  ),
                )
              : showDetails
                ? Promise.resolve(
                    [options, ...choices].find(
                      (value) =>
                        value === "Show details" || value === "詳細を表示",
                    ),
                  )
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
      findRenamedSkillRevision: async () => {
        renameChecks.count++;
        return renameRevision;
      },
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
              tree: entries
                .filter(() => !missingPath)
                .map((entry) => ({
                  path: indexedNewPath
                    ? entry.skill?.path || entry.meta.remotePath
                    : entry.meta.remotePath,
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
      installSkill: async (...args) => {
        installedRenamed.push(args);
        if (renameInstallFailure) {
          throw Error("private-name ghp_secret C:\\private");
        }
        return { status: renameInstallStatus };
      },
      classifySkillInstallFailure: (error) =>
        githubResponse.isGitHubResponseError(error) ? error.kind : "unknown",
      resolveManagedSkillDirUri: (rootUri, relative) =>
        uri(path.join(rootUri.fsPath, relative)),
      resolveSkillFolderName: (skill) =>
        skill.name.toLowerCase().replace(/\./g, "-"),
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
    context: { subscriptions: [] },
    getRoots: async () => (disappear && rootReads++ > 0 ? [] : roots),
    getIndex: async () => ({ sources: indexSources }),
    getEntries: async () => {
      if (cancelEntries) cancel();
      return entries;
    },
    getToken: async () => {
      tokenReads++;
      return undefined;
    },
    afterUpdate: async (changedRoots) => {
      refreshed.push(...changedRoots);
      if (failRefresh) throw Error("private-name ghp_secret C:\\private");
    },
  });
  assert.strictEqual(disposables.length, 2);
  const summary = await commands.get(
    all ? "skillNinja.updateAll" : "skillNinja.updateRoot",
  )(item);
  return {
    summary,
    progressMessages,
    installed,
    installedRenamed,
    renameChecks,
    quickPicks,
    refreshed,
    messages,
    requests,
    tokenReads,
    executed,
    notifications,
    output,
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
  assert.ok(
    localOnly.messages.at(-1).includes("local: missing upstream entry"),
  );
  assert.ok(!localOnly.messages.at(-1).includes("forced reinstall"));
  const unindexedCurrent = await scenario({
    entries: [{ ...entry("new-name"), skill: undefined }],
    indexSources: [{ id: "source", url: "https://github.com/owner/repo" }],
  });
  assert.strictEqual(unindexedCurrent.summary.unchanged, 1);
  assert.strictEqual(unindexedCurrent.summary.deferred, 0);
  assert.strictEqual(unindexedCurrent.renameChecks.count, 0);
  const changedUnindexed = entry("new-name");
  changedUnindexed.meta.sourceRevision.contentSha = "d".repeat(40);
  changedUnindexed.skill = undefined;
  const requiresIndex = await scenario({
    entries: [changedUnindexed],
    indexSources: [{ id: "source", url: "https://github.com/owner/repo" }],
  });
  assert.strictEqual(requiresIndex.summary.deferred, 1);
  assert.strictEqual(requiresIndex.summary.checkFailed, 0);
  assert.strictEqual(requiresIndex.installed.length, 0);
  assert.ok(requiresIndex.messages.at(-1).includes("not in the index"));
  const cancelledUnindexed = await scenario({
    entries: [{ ...entry("new-name"), skill: undefined }],
    indexSources: [{ id: "source", url: "https://github.com/owner/repo" }],
    cancelEntries: true,
  });
  assert.strictEqual(cancelledUnindexed.summary.cancelled, true);
  assert.strictEqual(cancelledUnindexed.summary.deferred, 1);
  assert.strictEqual(cancelledUnindexed.tokenReads, 0);
  const oldEntry = { ...entry("old-name"), skill: undefined };
  const source = { id: "source", url: "https://github.com/owner/repo" };
  const renameResult = { ...revision, remotePath: "new-name" };
  const offered = await scenario({
    entries: [oldEntry],
    indexSources: [source],
    renameRevision: renameResult,
  });
  assert.strictEqual(offered.renameChecks.count, 1);
  assert.strictEqual(offered.summary.deferred, 1);
  assert.strictEqual(offered.installedRenamed.length, 0);
  assert.ok(offered.messages.at(-1).includes("old-name"));
  assert.ok(offered.messages.at(-1).includes("new-name"));
  const otherSource = await scenario({
    entries: [oldEntry],
    indexSources: [{ id: "source", url: "https://github.com/other/repo" }],
    renameRevision: renameResult,
    renameChoice: "install",
  });
  assert.strictEqual(otherSource.renameChecks.count, 0);
  assert.strictEqual(otherSource.tokenReads, 0);
  assert.strictEqual(otherSource.installedRenamed.length, 0);
  const unknownRename = await scenario({
    entries: [oldEntry],
    indexSources: [source],
    renameChoice: "install",
    missingPath: true,
  });
  assert.strictEqual(unknownRename.renameChecks.count, 1);
  assert.strictEqual(unknownRename.installedRenamed.length, 0);
  assert.ok(
    !unknownRename.notifications
      .at(-1)
      .choices.includes("Install renamed skill"),
  );
  const acceptedRename = await scenario({
    entries: [oldEntry],
    indexSources: [source],
    renameRevision: renameResult,
    renameChoice: "install",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(acceptedRename.installedRenamed.length, 1);
  assert.strictEqual(acceptedRename.installedRenamed[0][0].name, "new-name");
  assert.strictEqual(
    acceptedRename.installedRenamed[0][4].sourceRevision,
    renameResult,
  );
  for (const [language, expected] of [
    ["en", "installed, but view/instruction refresh failed"],
    ["ja", "インストールしましたが表示・出力更新に失敗"],
  ]) {
    const refreshFailed = await scenario({
      entries: [oldEntry],
      indexSources: [source],
      renameRevision: renameResult,
      renameChoice: "install",
      failRefresh: true,
      language,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(refreshFailed.installedRenamed.length, 1);
    assert.ok(
      refreshFailed.messages.some((message) => message.includes(expected)),
    );
    assert.ok(
      !/ghp_secret|C:\\private/.test(JSON.stringify(refreshFailed.messages)),
    );
  }
  const partialRefresh = await scenario({
    entries: [oldEntry],
    indexSources: [source],
    renameRevision: renameResult,
    renameChoice: "install",
    renameInstallStatus: "partial",
    failRefresh: true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(partialRefresh.installedRenamed.length, 1);
  assert.ok(
    partialRefresh.messages.some((message) =>
      message.includes("incomplete and view/instruction refresh failed"),
    ),
  );
  assert.ok(
    !partialRefresh.messages.some((message) =>
      message.includes("installed, but"),
    ),
  );
  const installFailed = await scenario({
    entries: [oldEntry],
    indexSources: [source],
    renameRevision: renameResult,
    renameChoice: "install",
    renameInstallFailure: true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(installFailed.refreshed.length, 0);
  assert.ok(
    installFailed.messages.some((message) =>
      message.includes("Could not install new-name"),
    ),
  );
  assert.ok(
    !/ghp_secret|C:\\private/.test(JSON.stringify(installFailed.messages)),
  );
  assert.ok(
    acceptedRename.notifications.some(
      (notice) =>
        notice.message.includes("old-name") &&
        notice.message.includes("new-name"),
    ),
  );
  const declinedRename = await scenario({
    entries: [oldEntry],
    indexSources: [source],
    renameRevision: renameResult,
    renameChoice: "decline",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(declinedRename.installedRenamed.length, 0);
  const occupiedRename = await scenario({
    entries: [oldEntry],
    indexSources: [source],
    renameRevision: renameResult,
    renameChoice: "install",
    existingRenameTarget: true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(occupiedRename.installedRenamed.length, 0);
  assert.ok(
    !occupiedRename.notifications[0].choices.includes("Install renamed skill"),
  );
  assert.ok(
    occupiedRename.notifications[0].message.includes("already installed"),
  );
  const normalizedCollision = await scenario({
    entries: [oldEntry],
    indexSources: [source],
    renameRevision: { ...renameResult, remotePath: "v1.0" },
    renameChoice: "install",
    existingRenameTargetPath: path.join(root.rootUri.fsPath, "v1-0"),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(normalizedCollision.installedRenamed.length, 0);
  const sameDestination = entry("old-name");
  sameDestination.meta.relativePath = "new-name";
  const preserved = await scenario({
    entries: [{ ...sameDestination, skill: undefined }],
    indexSources: [source],
    renameRevision: renameResult,
    renameChoice: "install",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(preserved.installedRenamed.length, 0);
  assert.ok(
    !preserved.notifications[0].choices.includes("Install renamed skill"),
  );
  const multiRename = await scenario({
    entries: [oldEntry, { ...entry("other-old"), skill: undefined }],
    indexSources: [source],
    renameRevision: renameResult,
    renameChoice: "install",
    renamePick: 1,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(multiRename.quickPicks[0].length, 2);
  assert.strictEqual(multiRename.installedRenamed.length, 1);
  assert.strictEqual(multiRename.installedRenamed[0][0].name, "new-name");
  const staleIndex = await scenario({
    entries: [entry("old-name")],
    indexSources: [source],
    renameRevision: renameResult,
    missingPath: true,
  });
  assert.strictEqual(staleIndex.renameChecks.count, 1);
  assert.strictEqual(staleIndex.summary.deferred, 1);
  assert.strictEqual(staleIndex.summary.checkFailed, 0);
  assert.ok(staleIndex.messages.at(-1).includes("new-name"));
  const changedIndexPath = entry("old-name");
  changedIndexPath.skill.path = "new-name";
  const pathChanged = await scenario({
    entries: [changedIndexPath],
    indexSources: [source],
    renameRevision: renameResult,
    missingPath: false,
    indexedNewPath: true,
  });
  assert.strictEqual(pathChanged.renameChecks.count, 1);
  assert.strictEqual(pathChanged.summary.deferred, 1);
  assert.strictEqual(pathChanged.installed.length, 0);
  const missingDetails = await scenario({
    entries: [{ ...entry("renamed"), skill: undefined }],
    showDetails: true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(missingDetails.output.shown, true);
  assert.strictEqual(
    missingDetails.output.lines.filter((line) =>
      line.includes("renamed: missing upstream entry"),
    ).length,
    1,
  );
  assert.ok(
    missingDetails.output.lines.some((line) =>
      line.includes("renamed: missing upstream entry"),
    ),
  );
  const localSkill = entry("local-only");
  localSkill.meta.remotePath = undefined;
  localSkill.meta.source = "local";
  localSkill.skill = undefined;
  const skippedLocal = await scenario({
    entries: [localSkill],
    showDetails: true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(
    skippedLocal.messages
      .at(-1)
      .includes("local-only: no upstream or install path"),
  );
  assert.ok(!skippedLocal.messages.at(-1).includes("removed or renamed"));
  assert.strictEqual(skippedLocal.output.shown, true);
  const japaneseMissing = await scenario({
    entries: [{ ...entry("renamed"), skill: undefined }],
    language: "ja",
    showDetails: true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(
    japaneseMissing.notifications.at(-1).options,
    "詳細を表示",
  );
  assert.strictEqual(japaneseMissing.output.shown, true);
  assert.ok(
    japaneseMissing.output.lines.some((line) =>
      line.includes("renamed: 配布元の項目が見つかりません"),
    ),
  );
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
  const disabled = entry("disabled");
  disabled.meta.reinstallDisabled = true;
  const groupedRepair = entry("repair");
  groupedRepair.meta.incomplete = true;
  const grouped = await scenario({
    entries: [
      { ...entry("renamed"), skill: undefined },
      disabled,
      groupedRepair,
      changed,
    ],
    failCheck: true,
    showDetails: true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(grouped.summary.deferred, 2);
  assert.strictEqual(grouped.summary.repairNeeded, 1);
  assert.strictEqual(grouped.summary.checkFailed, 1);
  for (const detail of [
    "renamed: missing upstream entry",
    "disabled: reinstall disabled",
    "repair: needs repair",
    "changed: check failed",
  ]) {
    assert.ok(
      grouped.output.lines.some((line) => line.includes(detail)),
      detail,
    );
  }
  const failedDetails = await scenario({
    entries: [changed],
    fail: true,
    showDetails: true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(
    failedDetails.output.lines.some((line) =>
      line.includes("changed: update failed"),
    ),
  );
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
}, 30000);
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
