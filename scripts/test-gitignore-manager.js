const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");
const { execFileSync, spawnSync, spawn } = require("child_process");

const sourcePath = path.join(__dirname, "..", "src", "gitignoreManager.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const moduleExports = {};
let enabled = true;
let configurationUri;
const folderSettings = new Map();
const workerMode = process.argv[2] === "--sync-worker";
const workspacePath = workerMode
  ? process.argv[3]
  : fs.mkdtempSync(path.join(os.tmpdir(), "ninja-ignore-"));
const vscode = {
  workspace: {
    isTrusted: true,
    getWorkspaceFolder: () => ({ uri: { fsPath: workspacePath } }),
    getConfiguration: (section, uri) => {
      assert.strictEqual(section, "skillNinja");
      configurationUri = uri;
      return {
        get: (key, fallback) => {
          assert.strictEqual(key, "autoManageGitignore");
          return folderSettings.get(uri.fsPath) ?? enabled ?? fallback;
        },
      };
    },
  },
};
vm.runInNewContext(
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  {
    exports: moduleExports,
    module: { exports: moduleExports },
    require: (name) => (name === "vscode" ? vscode : require(name)),
    Buffer,
    console,
    setTimeout,
    process,
  },
  { filename: sourcePath },
);

const {
  buildSkillIgnorePatterns,
  updateIgnoreBlock,
  escapeIgnorePath,
  synchronizeSkillGitignore,
  GITIGNORE_LOCK_NAME,
} = moduleExports;

async function main() {
  try {
    const { createGitignoreInventory } = moduleExports;
    const inventoryRootA = { fsPath: path.join(workspacePath, "inventory-a") };
    const inventoryRootB = { fsPath: path.join(workspacePath, "inventory-b") };
    let currentInventoryRoots = [inventoryRootA];
    let releaseSave;
    let firstSaveStarted;
    const saveStarted = new Promise((resolve) => {
      firstSaveStarted = resolve;
    });
    const savedInventories = [];
    let inventoryFailures = 0;
    const inventory = createGitignoreInventory({
      initialRoots: [inventoryRootA, inventoryRootA],
      currentRoots: () => currentInventoryRoots,
      reconcile: async (current) => current,
      save: async (roots) => {
        if (savedInventories.length === 0 && !releaseSave) {
          const blocked = new Promise((resolve) => {
            releaseSave = resolve;
          });
          firstSaveStarted();
          await blocked;
        }
        savedInventories.push(Array.from(roots, (root) => root.fsPath));
      },
      onFailure: () => {
        inventoryFailures++;
      },
    });
    const firstRemember = inventory.remember(inventoryRootA);
    await saveStarted;
    currentInventoryRoots = [inventoryRootB];
    const pendingReconcile = inventory.synchronize();
    const staleRemember = inventory.remember(inventoryRootA);
    const newRemember = inventory.remember(inventoryRootB);
    assert.strictEqual(savedInventories.length, 0);
    releaseSave();
    await Promise.all([
      firstRemember,
      pendingReconcile,
      staleRemember,
      newRemember,
    ]);
    assert.deepStrictEqual(savedInventories, [
      [inventoryRootA.fsPath],
      [inventoryRootB.fsPath],
      [inventoryRootB.fsPath],
      [inventoryRootB.fsPath],
    ]);
    assert.strictEqual(inventoryFailures, 0);
    let failSave = true;
    let recoveredInventory;
    const recovering = createGitignoreInventory({
      initialRoots: [],
      currentRoots: () => [inventoryRootB],
      reconcile: async (current) => current,
      save: async (roots) => {
        if (failSave) {
          failSave = false;
          throw new Error("Injected save failure");
        }
        recoveredInventory = Array.from(roots, (root) => root.fsPath);
      },
      onFailure: () => {
        inventoryFailures++;
      },
    });
    await recovering.remember(inventoryRootB);
    await recovering.synchronize();
    assert.strictEqual(inventoryFailures, 1);
    assert.deepStrictEqual(recoveredInventory, [inventoryRootB.fsPath]);
    const transientRoot = { fsPath: path.join(workspacePath, "transient") };
    let releaseTransientSave;
    let transientStarted;
    const transientReady = new Promise((resolve) => {
      transientStarted = resolve;
    });
    const cleanupCandidates = [];
    let transientSaveCount = 0;
    const transientInventory = createGitignoreInventory({
      initialRoots: [inventoryRootA],
      currentRoots: () => currentInventoryRoots,
      reconcile: async (current, previous) => {
        cleanupCandidates.push(...Array.from(previous, (root) => root.fsPath));
        return current;
      },
      save: async () => {
        if (++transientSaveCount === 1) {
          const pending = new Promise((resolve) => {
            releaseTransientSave = resolve;
          });
          transientStarted();
          await pending;
        }
      },
      onFailure: () => {
        throw new Error("Unexpected inventory failure");
      },
    });
    currentInventoryRoots = [inventoryRootA];
    const held = transientInventory.remember(inventoryRootA);
    await transientReady;
    currentInventoryRoots = [transientRoot];
    const newlyWritten = transientInventory.remember(transientRoot);
    currentInventoryRoots = [inventoryRootB];
    releaseTransientSave();
    await Promise.all([held, newlyWritten]);
    assert(cleanupCandidates.includes(transientRoot.fsPath));
    const patterns = Array.from(
      buildSkillIgnorePatterns([
        { relativePath: "external", external: true, metadata: true },
        { relativePath: "local", external: false, metadata: true },
        { relativePath: "untouched", external: false, metadata: false },
        { relativePath: "package", external: true, metadata: true },
        { relativePath: "package/custom", external: false, metadata: false },
      ]),
    );
    assert(patterns.includes("/external/"));
    assert(patterns.includes("/local/.skill-meta.json"));
    assert(!patterns.includes("/local/"));
    assert(!patterns.includes("/untouched/"));
    assert(!patterns.includes("/package/"));
    assert.strictEqual(
      escapeIgnorePath("some [skill]!*? #"),
      "some\\ \\[skill\\]\\!\\*\\?\\ \\#",
    );
    assert.throws(() => escapeIgnorePath("../escape"));
    assert.throws(() => escapeIgnorePath("bad\nrule"));

    const sibling =
      "# Agent Resources Ninja START\r\n/resource/\r\n# Agent Resources Ninja END\r\n";
    const original = "user-rule\r\n" + sibling;
    const updated = updateIgnoreBlock(original, ["/external/"]);
    assert(updated.startsWith(original));
    assert(!updated.replace(/\r\n/g, "").includes("\n"));
    assert.strictEqual(updateIgnoreBlock(updated, ["/external/"]), updated);
    assert.strictEqual(
      updateIgnoreBlock(updateIgnoreBlock(updated, []), ["/external/"]),
      updated,
    );
    const bomBlock =
      "\uFEFF# Agent Skills Ninja START\n/old/\n# Agent Skills Ninja END\n";
    assert(
      updateIgnoreBlock(bomBlock, ["/new/"]).startsWith(
        "\uFEFF# Agent Skills Ninja START\n/new/",
      ),
    );
    assert(updateIgnoreBlock(updated, []).includes(sibling));
    assert(
      !updateIgnoreBlock(updated, []).includes("# Agent Skills Ninja START"),
    );
    assert.throws(() =>
      updateIgnoreBlock("# Agent Skills Ninja START\nuser-data\n", []),
    );
    assert.throws(() => updateIgnoreBlock(updated + updated, []));
    assert.throws(() =>
      updateIgnoreBlock(
        "# Agent Skills Ninja START\n" + sibling + "# Agent Skills Ninja END\n",
        [],
      ),
    );
    for (const malformed of [
      "# Agent Resources Ninja START\n" +
        updated +
        "# Agent Resources Ninja END\n",
      "# Agent Resources Ninja START\n/resource/\n",
      "# Agent Resources Ninja END\n",
      sibling + sibling,
    ]) {
      assert.throws(() => updateIgnoreBlock(malformed, []));
      assert.throws(() => updateIgnoreBlock(malformed, ["/new/"]));
    }
    assert(
      updateIgnoreBlock(updated, ["/new/"], "Agent Resources Ninja").includes(
        "/external/",
      ),
    );

    const rootPath = path.join(workspacePath, "skills");
    fs.mkdirSync(rootPath);
    for (const [name, meta] of [
      ["external", { name: "external", source: "catalog" }],
      ["local", { name: "local", source: "local" }],
      ["unknown", { name: "unknown", source: "unknown" }],
    ]) {
      const directory = path.join(rootPath, name);
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, "SKILL.md"), "skill");
      fs.writeFileSync(
        path.join(directory, ".skill-meta.json"),
        JSON.stringify(meta),
      );
    }
    const rootUri = { scheme: "file", fsPath: rootPath };
    const hiddenLocal = path.join(rootPath, "external", ".custom");
    fs.mkdirSync(hiddenLocal);
    fs.writeFileSync(path.join(hiddenLocal, "SKILL.md"), "local skill");
    const { collectSkillIgnoreEntries } = moduleExports;
    const hiddenPatterns = Array.from(
      buildSkillIgnorePatterns(await collectSkillIgnoreEntries(rootPath)),
    );
    assert(!hiddenPatterns.includes("/external/"));
    assert(hiddenPatterns.includes("/external/.skill-meta.json"));
    fs.rmSync(hiddenLocal, { recursive: true });
    const ignorePath = path.join(rootPath, ".gitignore");
    fs.writeFileSync(ignorePath, original);
    await synchronizeSkillGitignore(rootUri, vscode.workspace);
    const result = fs.readFileSync(ignorePath, "utf8");
    const unchangedOutcome = await synchronizeSkillGitignore(
      rootUri,
      vscode.workspace,
    );
    assert.strictEqual(unchangedOutcome.status, "unchanged");
    assert.strictEqual(unchangedOutcome.managedBlock, true);
    assert(result.includes("/external/\r\n"));
    assert(result.includes("/local/.skill-meta.json"));
    assert(!result.includes("/unknown/\r\n"));
    assert(result.includes(sibling));
    assert.strictEqual(configurationUri, rootUri);
    assert(!fs.existsSync(path.join(rootPath, GITIGNORE_LOCK_NAME)));

    enabled = false;
    const removalOutcome = await synchronizeSkillGitignore(
      rootUri,
      vscode.workspace,
    );
    assert.strictEqual(removalOutcome.status, "updated");
    assert.strictEqual(removalOutcome.managedBlock, false);
    assert(
      !fs
        .readFileSync(ignorePath, "utf8")
        .includes("# Agent Skills Ninja START"),
    );
    assert(fs.readFileSync(ignorePath, "utf8").includes(sibling));
    enabled = true;
    fs.writeFileSync(ignorePath, result);
    fs.writeFileSync(
      path.join(rootPath, "local", ".skill-meta.json"),
      "invalid",
    );
    const invalidResult = await synchronizeSkillGitignore(
      rootUri,
      vscode.workspace,
    );
    assert.strictEqual(invalidResult.status, "failed");
    assert.strictEqual(invalidResult.reason, "invalid-metadata");
    assert.strictEqual(fs.readFileSync(ignorePath, "utf8"), result);
    fs.writeFileSync(
      path.join(rootPath, GITIGNORE_LOCK_NAME),
      "another writer",
    );
    enabled = false;
    const lockedResult = await synchronizeSkillGitignore(
      rootUri,
      vscode.workspace,
    );
    assert.strictEqual(lockedResult.reason, "busy");
    assert.strictEqual(fs.readFileSync(ignorePath, "utf8"), result);
    assert(fs.existsSync(path.join(rootPath, GITIGNORE_LOCK_NAME)));
    fs.unlinkSync(path.join(rootPath, GITIGNORE_LOCK_NAME));
    fs.writeFileSync(
      path.join(rootPath, "local", ".skill-meta.json"),
      JSON.stringify({ name: "local", source: "local" }),
    );

    const rootB = path.join(workspacePath, "repo-b", "skills");
    fs.mkdirSync(path.join(rootB, "remote"), { recursive: true });
    fs.writeFileSync(
      path.join(rootB, "remote", ".skill-meta.json"),
      JSON.stringify({ name: "remote", source: "catalog" }),
    );
    const rootBUri = { scheme: "file", fsPath: rootB };
    const ignoreB = path.join(rootB, ".gitignore");
    fs.writeFileSync(ignoreB, updateIgnoreBlock("user-rule\n", ["/remote/"]));
    enabled = undefined;
    folderSettings.set(rootB, false);
    await synchronizeSkillGitignore(rootUri, vscode.workspace);
    await synchronizeSkillGitignore(rootBUri, vscode.workspace);
    assert(fs.readFileSync(ignorePath, "utf8").includes("/external/"));
    assert(
      !fs.readFileSync(ignoreB, "utf8").includes("# Agent Skills Ninja START"),
    );
    enabled = false;
    folderSettings.set(rootB, true);
    await synchronizeSkillGitignore(rootBUri, vscode.workspace);
    assert(fs.readFileSync(ignoreB, "utf8").includes("/remote/"));
    assert.strictEqual(configurationUri, rootBUri);

    enabled = true;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        synchronizeSkillGitignore(rootUri, vscode.workspace),
      ),
    );
    const concurrentResult = fs.readFileSync(ignorePath, "utf8");
    assert.strictEqual(
      (concurrentResult.match(/# Agent Skills Ninja START/g) || []).length,
      1,
    );
    assert(concurrentResult.includes(sibling));
    assert(!fs.existsSync(path.join(rootPath, GITIGNORE_LOCK_NAME)));
    await Promise.all(
      Array.from(
        { length: 3 },
        () =>
          new Promise((resolve, reject) => {
            const child = spawn(
              process.execPath,
              [__filename, "--sync-worker", workspacePath, rootPath],
              { stdio: ["ignore", "pipe", "pipe"] },
            );
            let output = "";
            child.stdout.on("data", (data) => {
              output += data;
            });
            child.stderr.on("data", (data) => {
              output += data;
            });
            child.on("error", reject);
            child.on("close", (code) =>
              code === 0 && output.includes("PASS worker")
                ? resolve()
                : reject(new Error(output || `Worker exited ${code}`)),
            );
          }),
      ),
    );
    assert.strictEqual(fs.readFileSync(ignorePath, "utf8"), concurrentResult);
    assert(!fs.existsSync(path.join(rootPath, GITIGNORE_LOCK_NAME)));

    vscode.workspace.textDocuments = [
      { isDirty: true, uri: { fsPath: ignorePath, scheme: "file" } },
    ];
    enabled = false;
    await synchronizeSkillGitignore(rootUri, vscode.workspace);
    assert.strictEqual(fs.readFileSync(ignorePath, "utf8"), concurrentResult);
    vscode.workspace.textDocuments = [];
    enabled = true;

    execFileSync("git", ["-C", workspacePath, "init", "--quiet"]);
    const checkIgnored = (relativePath, noIndex = false) => {
      const args = [
        "-C",
        workspacePath,
        "check-ignore",
        ...(noIndex ? ["--no-index"] : []),
        "--quiet",
        "--",
        relativePath,
      ];
      const check = spawnSync("git", args, { encoding: "utf8" });
      assert([0, 1].includes(check.status), check.stderr);
      return check.status === 0;
    };
    assert(checkIgnored("skills/external/SKILL.md"));
    assert(checkIgnored("skills/local/.skill-meta.json"));
    assert(!checkIgnored("skills/local/SKILL.md"));
    assert(!checkIgnored("skills/.gitignore"));
    const specialDirectory = "weird [skill]! #";
    fs.mkdirSync(path.join(rootPath, specialDirectory));
    fs.writeFileSync(
      path.join(rootPath, specialDirectory, "SKILL.md"),
      "skill",
    );
    fs.writeFileSync(
      path.join(rootPath, specialDirectory, ".skill-meta.json"),
      JSON.stringify({ name: "weird", source: "catalog" }),
    );
    await synchronizeSkillGitignore(rootUri, vscode.workspace);
    assert(checkIgnored(`skills/${specialDirectory}/SKILL.md`));
    assert(!checkIgnored("skills/weird unrelated/SKILL.md"));
    execFileSync("git", [
      "-C",
      workspacePath,
      "add",
      "-f",
      "--",
      "skills/external/SKILL.md",
    ]);
    await synchronizeSkillGitignore(rootUri, vscode.workspace);
    assert(!checkIgnored("skills/external/SKILL.md"));
    assert(checkIgnored("skills/external/SKILL.md", true));
    assert(
      execFileSync(
        "git",
        ["-C", workspacePath, "ls-files", "--", "skills/external/SKILL.md"],
        { encoding: "utf8" },
      ).trim(),
    );

    fs.rmSync(path.join(rootPath, "external"), { recursive: true });
    await synchronizeSkillGitignore(rootUri, vscode.workspace);
    assert(!fs.readFileSync(ignorePath, "utf8").includes("\n/external/"));
    const beforeGuard = fs.readFileSync(ignorePath, "utf8");
    vscode.workspace.isTrusted = false;
    enabled = false;
    await synchronizeSkillGitignore(rootUri, vscode.workspace);
    assert.strictEqual(fs.readFileSync(ignorePath, "utf8"), beforeGuard);
    vscode.workspace.isTrusted = true;
    await synchronizeSkillGitignore(
      { scheme: "file", fsPath: workspacePath },
      vscode.workspace,
    );
    assert(!fs.existsSync(path.join(workspacePath, ".gitignore")));

    enabled = true;
    const promises = require("fs/promises");
    const alias = path.join(workspacePath, "alias");
    fs.symlinkSync(rootPath, alias, "junction");
    vscode.workspace.textDocuments = [
      {
        isDirty: true,
        uri: { fsPath: path.join(alias, ".gitignore"), scheme: "file" },
      },
    ];
    enabled = false;
    const aliasDirty = await synchronizeSkillGitignore(
      rootUri,
      vscode.workspace,
    );
    assert.strictEqual(aliasDirty.reason, "dirty");
    assert.strictEqual(fs.readFileSync(ignorePath, "utf8"), beforeGuard);
    vscode.workspace.textDocuments = [];
    fs.unlinkSync(alias);
    enabled = true;
    const originalRename = promises.rename;
    promises.rename = async () => {
      throw Object.assign(new Error("Injected rename failure"), {
        code: "EACCES",
      });
    };
    try {
      fs.writeFileSync(ignorePath, original);
      const failureResult = await synchronizeSkillGitignore(
        rootUri,
        vscode.workspace,
      );
      assert.strictEqual(failureResult.status, "failed");
      assert.strictEqual(failureResult.reason, "io-failure");
      assert.strictEqual(fs.readFileSync(ignorePath, "utf8"), original);
      assert(!fs.readdirSync(rootPath).some((name) => name.endsWith(".tmp")));
      assert(!fs.existsSync(path.join(rootPath, GITIGNORE_LOCK_NAME)));
    } finally {
      promises.rename = originalRename;
    }
    const savedLstat = promises.lstat;
    let ignoreStatReads = 0;
    promises.lstat = async (...args) => {
      const stat = await savedLstat(...args);
      if (args[0] === ignorePath && ++ignoreStatReads === 2) {
        return { ...stat, isFile: () => true, isSymbolicLink: () => true };
      }
      return stat;
    };
    try {
      const switchedLink = await synchronizeSkillGitignore(
        rootUri,
        vscode.workspace,
      );
      assert.strictEqual(switchedLink.reason, "unsafe-path");
      assert.strictEqual(fs.readFileSync(ignorePath, "utf8"), original);
    } finally {
      promises.lstat = savedLstat;
    }
    const savedOpen = promises.open;
    let deniedLockAttempts = 0;
    promises.open = async (...args) => {
      if (
        process.platform === "win32" &&
        args[0].endsWith(GITIGNORE_LOCK_NAME) &&
        deniedLockAttempts++ < 2
      ) {
        throw Object.assign(new Error("Injected pending-delete lock"), {
          code: "EACCES",
        });
      }
      return savedOpen(...args);
    };
    try {
      const pendingDelete = await synchronizeSkillGitignore(
        rootUri,
        vscode.workspace,
      );
      assert(["updated", "unchanged"].includes(pendingDelete.status));
      if (process.platform === "win32") {
        assert(deniedLockAttempts >= 3);
      }
      fs.writeFileSync(ignorePath, original);
    } finally {
      promises.open = savedOpen;
    }
    promises.open = async (...args) => {
      const handle = await savedOpen(...args);
      if (args[0].endsWith(".tmp")) {
        handle.writeFile = async () => {
          await handle.write("partial");
          throw Object.assign(new Error("Injected partial write failure"), {
            code: "ENOSPC",
          });
        };
      }
      return handle;
    };
    try {
      const partialWrite = await synchronizeSkillGitignore(
        rootUri,
        vscode.workspace,
      );
      assert.strictEqual(partialWrite.reason, "io-failure");
      assert.strictEqual(fs.readFileSync(ignorePath, "utf8"), original);
      assert(!fs.readdirSync(rootPath).some((name) => name.endsWith(".tmp")));
    } finally {
      promises.open = savedOpen;
    }
    const { reconcileSkillGitignores, observeGitignoreSynchronization } =
      moduleExports;
    const observed = [];
    const stopObserving = observeGitignoreSynchronization((_root, result) =>
      observed.push(result),
    );
    await synchronizeSkillGitignore(rootUri, vscode.workspace);
    assert.strictEqual(observed.at(-1).status, "updated");
    const retained = await reconcileSkillGitignores(
      [rootBUri],
      [rootUri],
      vscode.workspace,
    );
    assert.strictEqual(retained.length, 1);
    assert(
      !fs
        .readFileSync(ignorePath, "utf8")
        .includes("# Agent Skills Ninja START"),
    );
    assert(fs.readFileSync(ignorePath, "utf8").includes(sibling));
    assert(
      fs.readFileSync(ignoreB, "utf8").includes("# Agent Skills Ninja START"),
    );
    fs.writeFileSync(ignorePath, updateIgnoreBlock(original, ["/old/"]));
    fs.writeFileSync(
      path.join(rootPath, GITIGNORE_LOCK_NAME),
      "another writer",
    );
    const retryRoots = await reconcileSkillGitignores(
      [rootBUri],
      [rootUri],
      vscode.workspace,
    );
    assert.strictEqual(retryRoots.length, 2);
    fs.unlinkSync(path.join(rootPath, GITIGNORE_LOCK_NAME));
    const recoveredRoots = await reconcileSkillGitignores(
      [rootBUri],
      Array.from(retryRoots),
      vscode.workspace,
    );
    assert.strictEqual(recoveredRoots.length, 1);
    stopObserving();

    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
    );
    const configurations = [].concat(manifest.contributes.configuration);
    const setting = configurations
      .flatMap((config) => Object.entries(config.properties))
      .find(([key]) => key === "skillNinja.autoManageGitignore")[1];
    assert.strictEqual(setting.default, true);
    assert.strictEqual(setting.scope, "resource");
    for (const filename of ["package.nls.json", "package.nls.ja.json"]) {
      const strings = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", filename), "utf8"),
      );
      assert(strings["config.autoManageGitignore.markdownDescription"]);
    }
    for (const key of [
      "skillNinja.skillsDirectory",
      "skillNinja.additionalSkillRoots",
    ]) {
      const rootSetting = configurations
        .flatMap((config) => Object.entries(config.properties))
        .find(([name]) => name === key)[1];
      assert.strictEqual(rootSetting.scope, "resource");
    }
    console.log(
      "PASS gitignore patterns, local skill protection, block coexistence, folder settings, fail-closed writes and lock ownership",
    );
  } finally {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
}
const execution = workerMode
  ? synchronizeSkillGitignore(
      { scheme: "file", fsPath: process.argv[4] },
      vscode.workspace,
    ).then((result) => {
      assert(["updated", "unchanged"].includes(result.status));
      console.log("PASS worker");
    })
  : main();
execution.catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
