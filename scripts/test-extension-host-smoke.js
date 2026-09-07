const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");
const {
  prepareSmokeRun,
  buildSmokeEnvironment,
  stopOwnedProcess,
} = require("./run-extension-host-smoke");

for (const language of ["en", "ja"]) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "skill-smoke-env-"));
  try {
    const run = prepareSmokeRun(language, parent);
    assert.equal(path.dirname(run.root), parent);
    const env = buildSmokeEnvironment(run, {
      PATH: "test-cli",
      SystemRoot: "test-system",
      GH_TOKEN: "secret",
      GITHUB_TOKEN: "secret",
      VSCE_PAT: "secret",
      NODE_OPTIONS: "secret",
      VSCODE_IPC_HOOK_CLI: "existing-window",
      APPDATA: "real-user",
      HOME: "real-user",
    });
    assert.equal(env.PATH, "test-cli");
    for (const key of [
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "VSCE_PAT",
      "NODE_OPTIONS",
      "VSCODE_IPC_HOOK_CLI",
    ]) {
      assert.equal(env[key], undefined);
    }
    for (const key of [
      "HOME",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "TEMP",
      "TMP",
    ]) {
      const relative = path.relative(run.root, env[key]);
      assert.ok(
        relative && !relative.startsWith("..") && !path.isAbsolute(relative),
      );
    }
    const settings = JSON.parse(
      fs.readFileSync(
        path.join(run.paths["user-data"], "User", "settings.json"),
      ),
    );
    assert.equal(settings["skillNinja.language"], language);
    assert.equal(settings["skillNinja.useVsCodeAgentSkillLocations"], false);
    assert.equal(settings["skillNinja.useSharedSourcesManifest"], false);
    assert.equal(settings["skillNinja.autoUpdateSkillsOnUpgrade"], "never");
    assert.equal(settings["skillNinja.staleSourceIndexUpdateMode"], "never");
    assert.deepEqual(settings["skillNinja.outputTargets"], []);
    assert.ok(
      fs.existsSync(
        path.join(
          run.paths.workspace,
          ".github",
          "skills",
          "smoke-local",
          "SKILL.md",
        ),
      ),
    );
    assert.equal(fs.existsSync(run.result), false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
}
console.log(
  "PASS Extension Host smoke environment isolates profile, storage and fixture without inherited credentials",
);

async function checkTermination() {
  let launched = 0;
  await stopOwnedProcess({ pid: 42, exitCode: 0 }, () => {
    launched++;
  });
  assert.equal(launched, 0);
  if (process.platform !== "win32") {
    return;
  }
  const killer = new EventEmitter();
  let completed = false;
  const pending = stopOwnedProcess(
    { pid: 42, exitCode: null },
    (command, args) => {
      assert.equal(command, "taskkill.exe");
      assert.deepEqual(args, ["/pid", "42", "/t", "/f"]);
      return killer;
    },
  ).then(() => {
    completed = true;
  });
  await Promise.resolve();
  assert.equal(completed, false);
  killer.emit("close", 0);
  await pending;
  assert.equal(completed, true);
  console.log("PASS cleanup waits for termination of only the owned PID tree");
}
checkTermination().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
