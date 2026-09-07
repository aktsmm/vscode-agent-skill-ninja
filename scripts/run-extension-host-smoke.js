const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function prepareSmokeRun(language = "en", parentDirectory = os.tmpdir()) {
  assert.ok(["en", "ja"].includes(language));
  const root = fs.mkdtempSync(path.join(parentDirectory, "skill-host-smoke-"));
  const paths = Object.fromEntries(
    [
      "home",
      "appdata",
      "localappdata",
      "temp",
      "user-data",
      "extensions",
      "workspace",
    ].map((name) => [name, path.join(root, name)]),
  );
  for (const directory of Object.values(paths)) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.mkdirSync(path.join(paths["user-data"], "User"));
  const settings = {
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
    "extensions.autoUpdate": false,
    "extensions.autoCheckUpdates": false,
    "workbench.startupEditor": "none",
    "workbench.enableExperiments": false,
    "workbench.settings.enableNaturalLanguageSearch": false,
    "security.workspace.trust.enabled": false,
    "skillNinja.language": language,
    "skillNinja.skillsDirectory": ".github/skills",
    "skillNinja.additionalSkillRoots": [],
    "skillNinja.useVsCodeAgentSkillLocations": false,
    "skillNinja.showBuiltInSkills": false,
    "skillNinja.useSharedSourcesManifest": false,
    "skillNinja.coexistenceMode": "independent",
    "skillNinja.outputTargets": [],
    "skillNinja.outputFormat": "full",
    "skillNinja.autoUpdateSkillsOnUpgrade": "never",
    "skillNinja.staleSourceIndexUpdateMode": "never",
  };
  fs.writeFileSync(
    path.join(paths["user-data"], "User", "settings.json"),
    JSON.stringify(settings),
  );
  const skillDir = path.join(
    paths.workspace,
    ".github",
    "skills",
    "smoke-local",
  );
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    "---\nname: smoke-local\ndescription: Local smoke fixture with no remote source\n---\n\nThis disposable local skill is never downloaded or replaced by the smoke test.\n",
  );
  fs.writeFileSync(
    path.join(skillDir, ".skill-meta.json"),
    JSON.stringify({
      name: "smoke-local",
      source: "local",
      relativePath: "smoke-local",
      installedAt: "2026-01-01T00:00:00.000Z",
      description: "Smoke fixture",
      categories: [],
    }),
  );
  return {
    root,
    paths,
    settings,
    language,
    result: path.join(root, "result.json"),
  };
}

function buildSmokeEnvironment(run, parent = process.env) {
  const environment = {};
  const allowed = new Set([
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "PATH",
    "PROCESSOR_ARCHITECTURE",
    "NUMBER_OF_PROCESSORS",
  ]);
  for (const [key, value] of Object.entries(parent)) {
    if (allowed.has(key.toUpperCase())) {
      environment[key] = value;
    }
  }
  return Object.assign(environment, {
    HOME: run.paths.home,
    USERPROFILE: run.paths.home,
    HOMEDRIVE: path.parse(run.paths.home).root.replace(/[\\/]$/, ""),
    HOMEPATH: run.paths.home.slice(path.parse(run.paths.home).root.length - 1),
    APPDATA: run.paths.appdata,
    LOCALAPPDATA: run.paths.localappdata,
    TEMP: run.paths.temp,
    TMP: run.paths.temp,
    SKILL_NINJA_SMOKE_ROOT: run.root,
    SKILL_NINJA_SMOKE_RESULT: run.result,
    SKILL_NINJA_SMOKE_LANGUAGE: run.language,
  });
}

async function stopOwnedProcess(child, startProcess = spawn) {
  if (!child.pid || child.exitCode !== null) {
    return;
  }
  assert.ok(Number.isInteger(child.pid) && child.pid > 0);
  if (process.platform === "win32") {
    await new Promise((resolve, reject) => {
      const killer = startProcess(
        "taskkill.exe",
        ["/pid", String(child.pid), "/t", "/f"],
        { stdio: "ignore", windowsHide: true },
      );
      killer.once("error", reject);
      killer.once("close", (code) =>
        code === 0 || child.exitCode !== null
          ? resolve()
          : reject(
              new Error("Could not stop the owned Extension Host process"),
            ),
      );
    });
  } else {
    await new Promise((resolve) => {
      child.once("close", resolve);
      child.kill("SIGKILL");
    });
  }
}

async function runSmoke(executable, language = "en") {
  assert.ok(fs.existsSync(executable), "VS Code executable must exist");
  const repository = path.resolve(__dirname, "..");
  assert.ok(
    fs.existsSync(path.join(repository, "dist", "extension.js")),
    "Run npm run compile first",
  );
  const run = prepareSmokeRun(language);
  let child;
  try {
    const args = [
      run.paths.workspace,
      `--user-data-dir=${run.paths["user-data"]}`,
      `--extensions-dir=${run.paths.extensions}`,
      `--extensionDevelopmentPath=${repository}`,
      `--extensionTestsPath=${path.join(__dirname, "extension-host", "smoke-suite.js")}`,
      "--disable-extensions",
      "--disable-updates",
      "--disable-telemetry",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--new-window",
      `--locale=${language}`,
    ];
    const log = fs.openSync(path.join(run.root, "host.log"), "w");
    let code;
    try {
      child = spawn(executable, args, {
        env: buildSmokeEnvironment(run),
        cwd: run.paths.workspace,
        stdio: ["ignore", log, log],
        windowsHide: false,
      });
      code = await new Promise((resolve, reject) => {
        const deadline = setTimeout(() => {
          reject(new Error("Extension Host smoke exceeded 90 seconds"));
        }, 90000);
        child.once("error", (error) => {
          clearTimeout(deadline);
          reject(error);
        });
        child.once("close", (exitCode) => {
          clearTimeout(deadline);
          resolve(exitCode);
        });
      });
    } finally {
      fs.closeSync(log);
    }
    assert.equal(code, 0, "Extension Host did not exit successfully");
    assert.ok(
      fs.existsSync(run.result),
      "Extension Host did not write test evidence",
    );
    const result = JSON.parse(fs.readFileSync(run.result, "utf8"));
    assert.equal(result.status, "passed");
    assert.equal(result.language, language);
    assert.ok(result.checks.length >= 5);
    assert.ok(result.checks.includes("blocked-output-preserved-and-recovered"));
    console.log(JSON.stringify(result));
    return result;
  } catch (error) {
    await stopOwnedProcess(child ?? {});
    const result = fs.existsSync(run.result)
      ? JSON.parse(fs.readFileSync(run.result, "utf8"))
      : undefined;
    console.error(
      JSON.stringify({
        status: "failed",
        stage: result?.stage ?? "host-launch",
        reason: result?.detail ?? error.message,
        checks: result?.checks,
      }),
    );
    throw error;
  } finally {
    fs.rmSync(run.root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
}

module.exports = {
  prepareSmokeRun,
  buildSmokeEnvironment,
  stopOwnedProcess,
  runSmoke,
};
if (require.main === module) {
  const args = process.argv.slice(2);
  const executable = args[args.indexOf("--code") + 1];
  const language = args.includes("--locale")
    ? args[args.indexOf("--locale") + 1]
    : "en";
  if (!args.includes("--code") || !executable) {
    console.error(
      "Usage: node scripts/run-extension-host-smoke.js --code <VS Code executable> [--locale en|ja]",
    );
    process.exitCode = 1;
  } else {
    runSmoke(path.resolve(executable), language).catch(() => {
      process.exitCode = 1;
    });
  }
}
