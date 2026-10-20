const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async () => {
  const root = process.env.SKILL_NINJA_SMOKE_ROOT;
  const resultPath = process.env.SKILL_NINJA_SMOKE_RESULT;
  const language = process.env.SKILL_NINJA_SMOKE_LANGUAGE;
  const checks = [];
  let stage = "isolation";
  const inside = (candidate) => {
    const relative = path.relative(root, candidate);
    assert.ok(
      relative &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative),
    );
  };
  try {
    assert.ok(root && path.basename(root).startsWith("skill-host-smoke-"));
    inside(resultPath);
    for (const candidate of [
      os.homedir(),
      process.env.APPDATA,
      process.env.LOCALAPPDATA,
      os.tmpdir(),
    ]) {
      inside(candidate);
    }
    for (const key of [
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "VSCE_PAT",
      "NODE_OPTIONS",
      "VSCODE_IPC_HOOK_CLI",
    ]) {
      assert.equal(process.env[key], undefined);
    }
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(workspace);
    inside(workspace.fsPath);
    const config = vscode.workspace.getConfiguration("skillNinja");
    assert.equal(config.get("language"), language);
    assert.equal(config.get("useVsCodeAgentSkillLocations"), false);
    assert.equal(config.get("autoUpdateSkillsOnUpgrade"), "never");
    assert.equal(config.get("staleSourceIndexUpdateMode"), "never");
    assert.deepEqual(config.get("outputTargets"), []);
    checks.push("isolated-home-workspace-settings");

    stage = "extension-discovery";
    const extension = vscode.extensions.getExtension(
      "yamapan.agent-skill-ninja",
    );
    assert.ok(extension);
    stage = "extension-path";
    assert.equal(
      path.relative(
        fs.realpathSync(path.resolve(__dirname, "../..")),
        fs.realpathSync(extension.extensionPath),
      ),
      "",
    );
    stage = "activation";
    await extension.activate();
    assert.equal(extension.isActive, true);
    checks.push("actual-extension-activation");
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      "updateRoot",
      "updateAll",
      "reinstallRoot",
      "reinstallAll",
      "reportBug",
    ]) {
      assert.ok(commands.includes(`skillNinja.${id}`), id);
    }
    checks.push("maintenance-commands-registered");

    stage = "local-update";
    const skillsPath = path.join(workspace.fsPath, ".github", "skills");
    const skillPath = path.join(skillsPath, "smoke-local", "SKILL.md");
    const original = fs.readFileSync(skillPath);
    const oldTime = new Date("2026-01-01T00:00:00Z");
    fs.utimesSync(skillPath, oldTime, oldTime);
    const before = fs.statSync(skillPath).mtimeMs;
    const item = {
      skillRoot: {
        scope: "workspace",
        rootPath: skillsPath,
        rootUri: vscode.Uri.file(skillsPath),
        isManaged: true,
        isReadOnly: true,
      },
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await vscode.commands.executeCommand(
        "skillNinja.updateRoot",
        item,
      );
      assert.ok(result);
      assert.equal(result.updated, 0);
      assert.equal(result.synchronized, 0);
      assert.equal(result.checkFailed, 0);
      assert.equal(result.deferred, 1);
    }
    assert.deepEqual(fs.readFileSync(skillPath), original);
    assert.equal(fs.statSync(skillPath).mtimeMs, before);
    checks.push("stale-root-first-and-second-command-noop");

    stage = "missing-root";
    const missing = await vscode.commands.executeCommand(
      "skillNinja.updateRoot",
    );
    assert.ok(missing);
    assert.equal(missing.updated, 0);
    assert.deepEqual(fs.readFileSync(skillPath), original);
    const all = await vscode.commands.executeCommand("skillNinja.updateAll");
    assert.equal(all.updated, 0);
    assert.equal(all.deferred, 1);
    checks.push("missing-root-and-update-all-noop");
    stage = "blocked-output";
    const outputPath = path.join(workspace.fsPath, "SMOKE-OUTPUT.md");
    inside(outputPath);
    fs.mkdirSync(outputPath);
    const sentinel = path.join(outputPath, "keep.txt");
    fs.writeFileSync(sentinel, "preserve this disposable fixture");
    await vscode.workspace.getConfiguration("skillNinja").update(
      "outputTargets",
      [
        {
          id: "workspace",
          instructionFile: "SMOKE-OUTPUT.md",
          format: "full",
        },
      ],
      vscode.ConfigurationTarget.Workspace,
    );
    const blocked = await vscode.commands.executeCommand(
      "skillNinja.updateInstruction",
      item,
    );
    assert.equal(blocked.blocked, 1);
    assert.equal(blocked.updated, 0);
    assert.equal(
      fs.readFileSync(sentinel, "utf8"),
      "preserve this disposable fixture",
    );
    stage = "output-recovery";
    await vscode.workspace.fs.delete(vscode.Uri.file(outputPath), {
      recursive: true,
      useTrash: false,
    });
    const recovered = await vscode.commands.executeCommand(
      "skillNinja.updateInstruction",
      item,
    );
    assert.equal(recovered.blocked, 0);
    assert.equal(recovered.updated + recovered.unchanged, 1);
    assert.ok(fs.readFileSync(outputPath, "utf8").includes("smoke-local"));
    const unchangedOutput = await vscode.commands.executeCommand(
      "skillNinja.updateInstruction",
      item,
    );
    assert.equal(unchangedOutput.unchanged, 1);
    checks.push("blocked-output-preserved-and-recovered");
    stage = "invocation-host";
    for (const id of [
      "copySlashCommand",
      "insertSlashCommandInChat",
      "setSkillInvocation",
      "filterSkillsByInvocation",
      "filterSkillsByInvocationActive",
      "filterBrowseSkills",
      "filterBrowseSkillsActive",
    ]) {
      assert.ok(commands.includes(`skillNinja.${id}`), id);
    }
    const writeInvocationSkill = (name, flags) => {
      const dir = path.join(skillsPath, name);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "SKILL.md");
      fs.writeFileSync(
        file,
        [
          "---",
          `name: ${name}`,
          "description: Invocation fixture",
          ...flags,
          "---",
          "",
          "Disposable fixture.",
        ].join("\n"),
      );
      return file;
    };
    const manualFile = writeInvocationSkill("smoke-manual", [
      "disable-model-invocation: true",
    ]);
    writeInvocationSkill("smoke-model", ["user-invocable: false"]);
    const readOutput = () => fs.readFileSync(outputPath, "utf8");
    const regenerate = () =>
      vscode.commands.executeCommand("skillNinja.updateInstruction", item);
    await vscode.commands.executeCommand("skillNinja.refreshLocal");
    await regenerate();
    // 既定では手動専用スキルを一覧に載せず、モデル専用は載せる
    assert.ok(readOutput().includes("smoke-model"));
    assert.ok(!readOutput().includes("smoke-manual"));
    const invocationConfig = vscode.workspace.getConfiguration(
      "skillNinja",
      workspace,
    );
    await invocationConfig.update(
      "explicitOnlySkillsInInstructions",
      "separate",
      vscode.ConfigurationTarget.Workspace,
    );
    await regenerate();
    assert.ok(readOutput().includes("### Explicit-only skills"));
    assert.ok(readOutput().includes("smoke-manual"));
    await invocationConfig.update(
      "explicitOnlySkillsInInstructions",
      undefined,
      vscode.ConfigurationTarget.Workspace,
    );
    await regenerate();
    assert.ok(!readOutput().includes("smoke-manual"));
    // metadata を持たない手書きスキルのフラグを外したら、保存だけで出力へ戻る
    fs.writeFileSync(
      manualFile,
      fs
        .readFileSync(manualFile, "utf8")
        .replace("disable-model-invocation: true\n", ""),
    );
    const deadline = Date.now() + 20000;
    while (!readOutput().includes("smoke-manual")) {
      assert.ok(
        Date.now() < deadline,
        "removing the manual-only flag must regenerate the output on save",
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    for (const name of ["smoke-manual", "smoke-model"]) {
      // 拡張の監視が掴んでいる間は Node の rm が EPERM になるため、host の API で消す
      await vscode.workspace.fs.delete(
        vscode.Uri.file(path.join(skillsPath, name)),
        { recursive: true, useTrash: false },
      );
    }
    // 削除イベントの debounce（500ms）が出力を再生成し終えてから次の段階へ進む
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await vscode.commands.executeCommand("skillNinja.refreshLocal");
    checks.push("invocation-mode-host");
    stage = "view-options-host";
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const pickerKeys = {
      next: "workbench.action.quickOpenSelectNext",
      previous: "workbench.action.quickOpenSelectPrevious",
      accept: "workbench.action.acceptSelectedQuickOpenItem",
    };
    // 実際の QuickPick をキー操作で動かす。ピッカーは選択後も開いたままなので、最後に閉じて戻り値を受け取る
    const driveViewOptions = async (commandId, keys) => {
      const pending = vscode.commands.executeCommand(commandId);
      await pause(800);
      for (const key of keys) {
        await vscode.commands.executeCommand(pickerKeys[key]);
        await pause(250);
      }
      await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
      return pending;
    };
    const repeat = (key, count) => Array(count).fill(key);
    for (const [commandId, sortSteps, expectedSort] of [
      // 項目順: 絞り込み(all/auto/explicitOnly/modelOnly) → 並べ替え。ローカルは default/name/invocation、Browse は default/name/stars
      ["skillNinja.filterSkillsByInvocation", 4, "invocation"],
      ["skillNinja.filterBrowseSkills", 3, "name"],
    ]) {
      const changed = await driveViewOptions(commandId, [
        ...repeat("next", 2),
        "accept",
        ...repeat("next", sortSteps),
        "accept",
      ]);
      assert.deepEqual(
        { ...changed },
        { filter: "explicitOnly", sort: expectedSort },
        `${commandId} must apply a filter and a sort from one open picker`,
      );
      const unchanged = await driveViewOptions(commandId, []);
      assert.deepEqual(
        { ...unchanged },
        { ...changed },
        `${commandId} must keep the applied options`,
      );
      const reset = await driveViewOptions(commandId, [
        ...repeat("previous", 2),
        "accept",
        ...repeat("next", 4),
        "accept",
      ]);
      assert.deepEqual(
        { ...reset },
        { filter: "all", sort: "default" },
        `${commandId} must return to the default view`,
      );
    }
    checks.push("view-options-picker-host");
    stage = "gitignore-host";
    const rootConfig = vscode.workspace.getConfiguration(
      "skillNinja",
      workspace,
    );
    assert.equal(rootConfig.get("autoManageGitignore"), true);
    const externalPath = path.join(skillsPath, "smoke-external");
    fs.mkdirSync(externalPath);
    fs.writeFileSync(
      path.join(externalPath, "SKILL.md"),
      "---\nname: smoke-external\n---\n",
    );
    fs.writeFileSync(
      path.join(externalPath, ".skill-meta.json"),
      JSON.stringify({
        name: "smoke-external",
        source: "smoke-catalog",
        categories: [],
      }),
    );
    const ignorePath = path.join(skillsPath, ".gitignore");
    const userRules =
      "# User rule\n/user-file\n# Agent Resources Ninja START\n/resource/\n# Agent Resources Ninja END\n";
    fs.writeFileSync(ignorePath, userRules);
    await vscode.commands.executeCommand("skillNinja.refreshLocal");
    const managedIgnore = fs.readFileSync(ignorePath, "utf8");
    assert.ok(managedIgnore.includes("/smoke-external/"));
    assert.ok(managedIgnore.includes("/smoke-local/.skill-meta.json"));
    assert.ok(!managedIgnore.includes("\n/smoke-local/\n"));
    assert.ok(managedIgnore.startsWith(userRules));
    const ignoreDocument = await vscode.workspace.openTextDocument(ignorePath);
    const dirtyEdit = new vscode.WorkspaceEdit();
    dirtyEdit.insert(
      ignoreDocument.uri,
      new vscode.Position(0, 0),
      "# Unsaved fixture\n",
    );
    assert.equal(await vscode.workspace.applyEdit(dirtyEdit), true);
    assert.equal(ignoreDocument.isDirty, true);
    await rootConfig.update(
      "autoManageGitignore",
      false,
      vscode.ConfigurationTarget.Workspace,
    );
    await vscode.commands.executeCommand("skillNinja.refreshLocal");
    assert.equal(fs.readFileSync(ignorePath, "utf8"), managedIgnore);
    await ignoreDocument.save();
    await vscode.commands.executeCommand("skillNinja.refreshLocal");
    const disabledIgnore = fs.readFileSync(ignorePath, "utf8");
    assert.ok(!disabledIgnore.includes("# Agent Skills Ninja START"));
    assert.ok(disabledIgnore.includes("# Agent Resources Ninja START"));
    assert.ok(disabledIgnore.includes("# Unsaved fixture"));
    await rootConfig.update(
      "autoManageGitignore",
      true,
      vscode.ConfigurationTarget.Workspace,
    );
    await vscode.commands.executeCommand("skillNinja.refreshLocal");
    assert.ok(fs.readFileSync(ignorePath, "utf8").includes("/smoke-external/"));
    await rootConfig.update(
      "skillsDirectory",
      "other-skills",
      vscode.ConfigurationTarget.Workspace,
    );
    await vscode.commands.executeCommand("skillNinja.refreshLocal");
    assert.ok(
      !fs
        .readFileSync(ignorePath, "utf8")
        .includes("# Agent Skills Ninja START"),
    );
    assert.ok(
      fs
        .readFileSync(ignorePath, "utf8")
        .includes("# Agent Resources Ninja START"),
    );
    checks.push("gitignore-real-config-dirty-recovery-and-old-root-cleanup");
    fs.writeFileSync(
      resultPath,
      JSON.stringify({
        status: "passed",
        language,
        vscode: vscode.version,
        extension: extension.packageJSON.version,
        checks,
      }),
    );
  } catch (error) {
    if (root && resultPath && path.dirname(resultPath) === root) {
      const detail =
        stage === "isolation"
          ? "Isolation assertion failed"
          : String(error.message)
              .replaceAll(root, "<scratch>")
              .replaceAll(path.resolve(__dirname, "../.."), "<extension>")
              .slice(0, 1000);
      fs.writeFileSync(
        resultPath,
        JSON.stringify({ status: "failed", stage, language, detail, checks }),
      );
    }
    throw error;
  }
};
