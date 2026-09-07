const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const script = path.join(root, "scripts", "Test-ReleaseCredentials.ps1");
const scratch = fs.mkdtempSync(
  path.join(os.tmpdir(), "release-credential-test-"),
);
const mock = path.join(scratch, "mock-vsce.ps1");

function run({
  pat = "fixture-secret",
  expected = "0.9.50",
  verifyFails = false,
} = {}) {
  fs.writeFileSync(
    mock,
    [
      "param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)",
      `$verifyFails = $${verifyFails ? "true" : "false"}`,
      'if ($Args[0] -eq "verify-pat") { if ($verifyFails) { exit 7 }; "Credential valid"; exit 0 }',
      'if ($Args[0] -eq "show") { \'{"versions":[{"version":"0.9.49"}]}\'; exit 0 }',
      "exit 9",
    ].join("\r\n"),
  );
  return spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-File",
      script,
      "-UseProcessCredential",
      "-VsceExecutable",
      mock,
      "-ExpectedVersion",
      expected,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, VSCE_PAT: pat },
    },
  );
}

function normalizedOutput(result) {
  return `${result.stdout}${result.stderr}`
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\s+/g, " ");
}

try {
  const parse = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      `[void][scriptblock]::Create((Get-Content -Raw -Encoding UTF8 -LiteralPath '${script.replaceAll("'", "''")}'))`,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(parse.status, 0, parse.stderr);

  const success = run();
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /PASS/);
  assert.doesNotMatch(normalizedOutput(success), /fixture-secret/);

  const missing = run({ pat: "" });
  assert.notEqual(missing.status, 0);
  assert.match(normalizedOutput(missing), /VSCE_PAT is not configured/);

  const duplicate = run({ expected: "0.9.49" });
  assert.notEqual(duplicate.status, 0);
  assert.match(normalizedOutput(duplicate), /already exists/);

  const expired = run({ verifyFails: true });
  assert.notEqual(expired.status, 0);
  assert.match(
    normalizedOutput(expired),
    /Marketplace credential verification failed/,
  );
  assert.doesNotMatch(normalizedOutput(expired), /fixture-secret/);

  console.log(
    "PASS release credential preflight reloads safely, blocks expired/missing/duplicate releases and never prints the PAT",
  );
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
