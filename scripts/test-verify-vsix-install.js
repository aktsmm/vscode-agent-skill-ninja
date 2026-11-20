const assert = require("assert");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const {
  readZipBuffer, verifyVsixInstall,
} = require("./verify-vsix-install");

function zip(entries, { deflate = false, descriptor = false } = {}) {
  const files = [];
  const directory = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const bytes = Buffer.from(data);
    const filename = Buffer.from(name);
    const compressed = deflate ? zlib.deflateRawSync(bytes) : bytes;
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(descriptor ? 8 : 0, 6);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    if (!descriptor) {
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(compressed.length, 18);
      local.writeUInt32LE(bytes.length, 22);
    }
    local.writeUInt16LE(filename.length, 26);
    const trailer = Buffer.alloc(descriptor ? 16 : 0);
    if (descriptor) {
      trailer.writeUInt32LE(0x08074b50);
      trailer.writeUInt32LE(crc, 4);
      trailer.writeUInt32LE(compressed.length, 8);
      trailer.writeUInt32LE(bytes.length, 12);
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(descriptor ? 8 : 0, 8);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    files.push(local, filename, compressed, trailer);
    directory.push(central, filename);
    offset += local.length + filename.length + compressed.length + trailer.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, central, end]);
}

const root = fs.mkdtempSync(path.join(process.cwd(), ".vsix-gate-test-"));
let count = 0;
function test(name, fn) {
  fn();
  count++;
  console.log(`PASS ${name}`);
}

const manifest = {
  publisher: "yamapan", name: "agent-skill-ninja", version: "9.8.7",
  main: "./dist/candidate.js",
  contributes: { commands: [{ command: "skillNinja.example", title: "Example" }] },
};
function candidateEntries(overrides = {}) {
  return Object.entries({
    "extension/package.json": JSON.stringify({ ...manifest, ...overrides }),
    "extension/dist/candidate.js": "candidate runtime bytes",
    "extension/dist/worker.js": "candidate worker bytes",
    "extension/package.nls.json": '{"label":"English"}',
    "extension/package.nls.ja.json": '{"label":"日本語"}',
    "extension/resources/skill-index.json": '{"skills":[]}',
    "extension/resources/icon.png": Buffer.from([0, 1, 2, 255]),
  });
}

function exercise({ entries = candidateEntries(), mode = "success", expected } = {}) {
  const vsixPath = path.join(root, "candidate with spaces & parentheses (1).vsix");
  fs.writeFileSync(vsixPath, zip(entries, { deflate: true, descriptor: true }));
  let ownedRoot;
  let calls = 0;
  const execute = (_cli, args) => {
    calls++;
    const extensions = args[args.indexOf("--extensions-dir") + 1];
    const userData = args[args.indexOf("--user-data-dir") + 1];
    assert.ok(extensions && userData, "every CLI call must isolate both directories");
    ownedRoot = path.dirname(extensions);
    assert.strictEqual(path.dirname(userData), ownedRoot);
    assert.notStrictEqual(ownedRoot, root);
    assert.strictEqual(path.dirname(ownedRoot), process.cwd());
    if (mode === "throw") throw new Error("spawn failed");
    if (mode === "install-fails") return { status: 1, stderr: "install failed" };
    if (mode === "timeout") return { status: null, error: new Error("timed out") };
    if (args.includes("--install-extension")) {
      assert.strictEqual(args[args.indexOf("--install-extension") + 1], vsixPath);
      const installed = path.join(extensions, "yamapan.agent-skill-ninja-9.8.7");
      for (const [name, bytes] of entries) {
        const destination = path.join(installed, ...name.slice(10).split("/"));
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, bytes);
      }
      const installedManifest = { ...manifest, __metadata: { installedTimestamp: 123 } };
      if (mode === "stale-manifest") installedManifest.version = "9.8.6";
      if (mode === "wrong-entrypoint") installedManifest.main = "./dist/stale.js";
      if (mode === "stale-contributions") installedManifest.contributes = { commands: [] };
      fs.writeFileSync(path.join(installed, "package.json"), JSON.stringify(installedManifest));
      if (mode === "missing-manifest") fs.unlinkSync(path.join(installed, "package.json"));
      if (mode === "missing") fs.unlinkSync(path.join(installed, "resources", "skill-index.json"));
      if (mode === "mismatch") fs.writeFileSync(path.join(installed, "dist", "worker.js"), "stale worker bytes");
      if (mode === "icon-mismatch") fs.writeFileSync(path.join(installed, "resources", "icon.png"), "wrong icon");
      return { status: 0 };
    }
    return {
      status: mode === "list-fails" ? 1 : 0,
      stdout: mode === "stale-list" ? "yamapan.agent-skill-ninja@9.8.6\n" :
        "yamapan.agent-skill-ninja@9.8.7\r\n",
    };
  };
  if (expected) assert.throws(() => verifyVsixInstall(vsixPath, { execute }), expected);
  else assert.strictEqual(verifyVsixInstall(vsixPath, { execute }), "yamapan.agent-skill-ninja@9.8.7");
  if (ownedRoot) assert.ok(!fs.existsSync(ownedRoot), "owned profile must be removed");
  return calls;
}

try {
  test("candidate manifest, not checkout version/main, drives readback; metadata may differ", () => {
    assert.strictEqual(exercise(), 2);
  });
  for (const [mode, expected] of [
    ["install-fails", /CLI failed/], ["list-fails", /CLI failed/],
    ["throw", /spawn failed/], ["timeout", /timed out/],
    ["stale-list", /did not contain/], ["stale-manifest", /manifest differs/],
    ["wrong-entrypoint", /manifest differs/], ["missing-manifest", /ENOENT/],
    ["stale-contributions", /manifest differs/],
    ["missing", /missing from the installed copy/],
    ["mismatch", /worker.js: installed bytes differ/],
    ["icon-mismatch", /icon.png: installed bytes differ/],
  ]) {
    test(`reject ${mode} and clean the owned profile`, () => exercise({ mode, expected }));
  }
  test("missing packaged runtime fails before installing", () => {
    assert.strictEqual(exercise({
      entries: candidateEntries().filter(([name]) => !name.endsWith("skill-index.json")),
      expected: /missing from the VSIX/,
    }), 0);
  });
  test("traversal entrypoint fails before installing", () => {
    assert.strictEqual(exercise({
      entries: candidateEntries({ main: "../outside.js" }), expected: /Unsafe runtime/,
    }), 0);
  });
  test("wrong extension candidate fails before installing", () => {
    assert.strictEqual(exercise({
      entries: candidateEntries({ name: "other-extension" }), expected: /identity/,
    }), 0);
  });
  test("ZIP supports stored/deflated and descriptor entries, including signature bytes in data", () => {
    const entries = [["extension/data", Buffer.from([0x50, 0x4b, 7, 8, 0, 255])]];
    for (const options of [{}, { descriptor: true }, { deflate: true, descriptor: true }]) {
      assert.deepStrictEqual(readZipBuffer(zip(entries, options)).get("extension/data"), entries[0][1]);
    }
  });
  test("truncated and duplicate ZIPs fail closed", () => {
    assert.throws(() => readZipBuffer(Buffer.from("not a zip")), /ZIP/);
    const valid = zip(candidateEntries());
    assert.throws(() => readZipBuffer(valid.subarray(0, valid.length - 1)), /ZIP/);
    assert.throws(() => readZipBuffer(zip([["same", "a"], ["same", "b"]])), /Duplicate ZIP/);
  });
  if (process.platform === "win32") {
    test("real Windows CLI subprocess handles quoted candidate and CLI paths", () => {
      const fixtureDir = path.join(root, "fake cli & (isolated)");
      fs.mkdirSync(fixtureDir);
      const cli = path.join(fixtureDir, "code.cmd");
      const installer = path.join(fixtureDir, "cli.js");
      const rootsLog = path.join(fixtureDir, "roots.json");
      const candidate = path.join(root, "candidate & (quoted).vsix");
      fs.writeFileSync(candidate, zip(candidateEntries(), { deflate: true, descriptor: true }));
      fs.writeFileSync(installer, `
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { readZipBuffer } = require(${JSON.stringify(require.resolve("./verify-vsix-install"))});
const args = process.argv.slice(2);
const extensions = args[args.indexOf("--extensions-dir") + 1];
const userData = args[args.indexOf("--user-data-dir") + 1];
assert.ok(extensions && userData);
assert.strictEqual(path.dirname(extensions), path.dirname(userData));
assert.ok(path.basename(path.dirname(extensions)).startsWith(".skill-vsix-"));
assert.strictEqual(process.env.VSCODE_PORTABLE, undefined);
assert.strictEqual(process.env.VSCODE_IPC_HOOK_CLI, undefined);
fs.writeFileSync(${JSON.stringify(rootsLog)}, JSON.stringify(path.dirname(extensions)));
if (args.includes("--install-extension")) {
  const archive = readZipBuffer(fs.readFileSync(args[args.indexOf("--install-extension") + 1]));
  const manifest = JSON.parse(archive.get("extension/package.json"));
  const installed = path.join(extensions, manifest.publisher + "." + manifest.name + "-" + manifest.version);
  for (const [name, bytes] of archive) {
    const destination = path.join(installed, ...name.slice(10).split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
  }
} else {
  console.log("yamapan.agent-skill-ninja@9.8.7");
}
`);
      fs.writeFileSync(cli, `@"${process.execPath}" "${installer}" %*\r\n`);
      assert.strictEqual(verifyVsixInstall(candidate, { cli }), "yamapan.agent-skill-ninja@9.8.7");
      assert.ok(!fs.existsSync(JSON.parse(fs.readFileSync(rootsLog, "utf8"))));
    });
  }
  console.log(`PASS ${count} VSIX verification tests`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
