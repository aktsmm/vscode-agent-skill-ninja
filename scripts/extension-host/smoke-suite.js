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
