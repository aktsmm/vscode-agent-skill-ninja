#!/usr/bin/env node
// Adapted from Agent Resources Ninja 8f5ccce. No normal profile is accessed.
// Usage: node scripts/verify-vsix-install.js <candidate.vsix> [--code <CLI path>]
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");
const { isDeepStrictEqual } = require("util");

function readZipBuffer(buffer) {
  // Read sizes from the central directory, not descriptor signatures which
  // can also occur inside compressed data.
  let end = buffer.length - 22;
  for (; end >= Math.max(0, buffer.length - 65557); end--) {
    if (
      buffer.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + buffer.readUInt16LE(end + 20) === buffer.length
    ) break;
  }
  if (end < 0 || buffer.readUInt32LE(end) !== 0x06054b50) {
    throw new Error("Missing ZIP central directory");
  }
  const count = buffer.readUInt16LE(end + 10);
  const directorySize = buffer.readUInt32LE(end + 12);
  let offset = buffer.readUInt32LE(end + 16);
  if (
    buffer.readUInt16LE(end + 4) !== 0 ||
    buffer.readUInt16LE(end + 6) !== 0 ||
    count !== buffer.readUInt16LE(end + 8) ||
    count === 0xffff ||
    offset + directorySize !== end
  ) throw new Error("Unsupported or damaged ZIP directory");

  const entries = new Map();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid ZIP entry");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const next = offset + 46 + nameLength +
      buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    if (
      next > end || local + 30 > offset ||
      buffer.readUInt32LE(local) !== 0x04034b50 ||
      flags & 1 || ![0, 8].includes(method)
    ) throw new Error("Unsupported or damaged ZIP entry");
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (entries.has(name)) throw new Error(`Duplicate ZIP entry: ${name}`);
    const start = local + 30 + buffer.readUInt16LE(local + 26) +
      buffer.readUInt16LE(local + 28);
    if (start + compressedSize > buffer.readUInt32LE(end + 16)) {
      throw new Error(`Truncated ZIP entry: ${name}`);
    }
    const compressed = buffer.subarray(start, start + compressedSize);
    const bytes = method === 8 ? zlib.inflateRawSync(compressed) : compressed;
    if (bytes.length !== size) throw new Error(`Invalid ZIP size: ${name}`);
    entries.set(name, bytes);
    offset = next;
  }
  if (offset !== end) throw new Error("Invalid ZIP directory size");
  return entries;
}

function assetPath(value) {
  if (typeof value !== "string") throw new Error("Missing runtime entrypoint");
  const normalized = value.replace(/^\.\//, "");
  if (
    !normalized || normalized.includes("\\") || normalized.includes(":") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) throw new Error(`Unsafe runtime asset path: ${value}`);
  return normalized;
}

function runtimeAssetPaths(manifest, archive) {
  return [...new Set([
    assetPath(manifest.main),
    "package.nls.json",
    "package.nls.ja.json",
    "resources/skill-index.json",
    ...[...archive.keys()]
      .filter((name) =>
        /^extension\/(?:dist\/|resources\/|package\.nls(?:\.[^/]+)?\.json$)/.test(name) &&
        !name.endsWith("/"))
      .map((name) => assetPath(name.slice("extension/".length))),
  ])];
}

function compareRuntimeAssets(archive, installedRoot, assets) {
  const problems = [];
  for (const asset of assets) {
    const packaged = archive.get(`extension/${asset}`);
    const installed = path.join(installedRoot, ...asset.split("/"));
    if (!packaged) {
      problems.push(`${asset}: missing from the VSIX`);
    } else if (!fs.existsSync(installed) || !fs.lstatSync(installed).isFile()) {
      problems.push(`${asset}: missing from the installed copy`);
    } else {
      const relative = path.relative(installedRoot, fs.realpathSync(installed));
      if (relative === ".." || relative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relative) ||
          !fs.readFileSync(installed).equals(packaged)) {
        problems.push(`${asset}: installed bytes differ from the VSIX`);
      }
    }
  }
  return problems;
}

function findCodeCli() {
  const candidate = path.join(
    process.env.LOCALAPPDATA || "",
    "Programs", "Microsoft VS Code", "bin", "code.cmd",
  );
  return process.platform === "win32" && fs.existsSync(candidate)
    ? candidate : process.platform === "win32" ? "code.cmd" : "code";
}

function run(cli, args) {
  const env = { ...process.env };
  delete env.VSCODE_PORTABLE;
  delete env.VSCODE_IPC_HOOK_CLI;
  const options = { encoding: "utf8", timeout: 120000, windowsHide: true, env };
  if (process.platform !== "win32") return spawnSync(cli, args, options);
  // cmd expands percent variables even inside quotes. Reject expansion and
  // quote terminators rather than letting candidate paths become commands.
  const command = [cli, ...args].map((value) => {
    if (/["%!\r\n]/.test(value)) throw new Error("Unsupported CLI path character");
    return `"${value}"`;
  }).join(" ");
  return spawnSync(command, { ...options, shell: true });
}

function verifyVsixInstall(vsixPath, { cli = findCodeCli(), execute = run } = {}) {
  const candidate = path.resolve(vsixPath);
  const archive = readZipBuffer(fs.readFileSync(candidate));
  const manifestBytes = archive.get("extension/package.json");
  if (!manifestBytes) throw new Error("Missing VSIX manifest");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const extensionId = `${manifest.publisher}.${manifest.name}`;
  if (
    extensionId !== "yamapan.agent-skill-ninja" ||
    typeof manifest.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(manifest.version)
  ) throw new Error("Unexpected VSIX identity or version");
  const assets = runtimeAssetPaths(manifest, archive);
  for (const asset of assets) {
    if (!archive.has(`extension/${asset}`)) {
      throw new Error(`${asset}: missing from the VSIX`);
    }
  }

  // Keep owned scratch data inside the checkout, never in the user's profile.
  const sandbox = fs.mkdtempSync(path.join(process.cwd(), ".skill-vsix-"));
  try {
    const extensionsDir = path.join(sandbox, "extensions");
    const userDataDir = path.join(sandbox, "user-data");
    const isolated = [
      "--extensions-dir", extensionsDir, "--user-data-dir", userDataDir,
    ];
    const invoke = (args) => {
      const result = execute(cli, [...args, ...isolated]);
      if (result.error || result.status !== 0) {
        throw new Error(`VS Code CLI failed: ${
          String(result.error?.message || result.stderr || result.stdout || result.status)
            .trim().slice(0, 300)}`);
      }
      return String(result.stdout || "");
    };
    invoke(["--install-extension", candidate, "--force"]);
    const expected = `${extensionId}@${manifest.version}`;
    if (!invoke(["--list-extensions", "--show-versions"])
      .split(/\r?\n/).some((line) => line.trim() === expected)) {
      throw new Error(`Installed extension list did not contain ${expected}`);
    }
    const installedRoot = path.join(extensionsDir, `${extensionId}-${manifest.version}`);
    const installedManifest = JSON.parse(
      fs.readFileSync(path.join(installedRoot, "package.json"), "utf8"),
    );
    const { __metadata: _installedMetadata, ...installedContents } = installedManifest;
    const { __metadata: _packagedMetadata, ...packagedContents } = manifest;
    if (!isDeepStrictEqual(installedContents, packagedContents)) {
      throw new Error("Installed manifest differs from the VSIX");
    }
    const problems = compareRuntimeAssets(archive, installedRoot, assets);
    if (problems.length) throw new Error(problems.join("\n"));
    return expected;
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 && !(args.length === 3 && args[1] === "--code")) {
      throw new Error("Usage: node scripts/verify-vsix-install.js <candidate.vsix> [--code <CLI path>]");
    }
    const expected = verifyVsixInstall(args[0], args[2] ? { cli: args[2] } : {});
    console.log(`PASS ${expected}: isolated install and runtime bytes match the VSIX`);
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  compareRuntimeAssets, readZipBuffer, runtimeAssetPaths, verifyVsixInstall,
};
