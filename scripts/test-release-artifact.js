const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const verifier = path.join(root, "scripts", "Test-ReleaseArtifact.ps1");
const scratch = fs.mkdtempSync(
  path.join(os.tmpdir(), "release-artifact-test-"),
);

function createFixture(name, changelog) {
  const source = path.join(scratch, `${name}-source`);
  const extension = path.join(source, "extension");
  fs.mkdirSync(path.join(extension, "dist"), { recursive: true });
  fs.mkdirSync(path.join(extension, "resources"), { recursive: true });
  fs.writeFileSync(path.join(source, "[Content_Types].xml"), "<Types />");
  fs.writeFileSync(
    path.join(source, "extension.vsixmanifest"),
    "<PackageManifest />",
  );
  fs.writeFileSync(
    path.join(extension, "package.json"),
    JSON.stringify({ version: "1.2.3" }),
  );
  fs.writeFileSync(path.join(extension, "changelog.md"), changelog);
  fs.writeFileSync(
    path.join(extension, "dist", "extension.js"),
    "module.exports = {};",
  );
  fs.writeFileSync(path.join(extension, "resources", "icon.png"), "fixture");
  fs.writeFileSync(path.join(extension, "resources", "icon.svg"), "<svg />");
  fs.writeFileSync(path.join(extension, "resources", "skill-index.json"), "{}");

  const vsix = path.join(scratch, `${name}.vsix`);
  const archive = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${source.replaceAll("'", "''")}\\*' -DestinationPath '${vsix.replaceAll("'", "''")}'`,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(archive.status, 0, archive.stderr);
  return vsix;
}

function verify(vsix) {
  return spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-File",
      verifier,
      "-VsixPath",
      vsix,
      "-ExpectedVersion",
      "1.2.3",
    ],
    { cwd: root, encoding: "utf8" },
  );
}

try {
  const clean = createFixture(
    "clean",
    [
      "# Changelog",
      "## [1.2.3] - 2026-09-07",
      "- Safe release notes",
      "```powershell",
      "PS repo> npm test",
      "```",
    ].join("\n"),
  );
  const cleanResult = verify(clean);
  assert.equal(cleanResult.status, 0, cleanResult.stderr);
  assert.match(cleanResult.stdout, /PASS/);

  const contaminated = createFixture(
    "contaminated",
    [
      "# Changelog",
      "## [1.2.3] - 2026-09-07",
      "Paste the NEW Marketplace PAT here (input is hidden):- Release note",
    ].join("\n"),
  );
  const contaminatedResult = verify(contaminated);
  assert.notEqual(contaminatedResult.status, 0);
  assert.match(
    `${contaminatedResult.stdout}${contaminatedResult.stderr}`,
    /terminal or secret-input transcript text/,
  );

  console.log(
    "PASS release artifact verifier checks version, contents and packaged changelog contamination",
  );
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
