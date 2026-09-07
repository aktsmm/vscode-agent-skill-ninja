/**
 * Local skill scanner regression tests.
 * Run: node scripts/test-local-skill-scanner.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "src", "localSkillScanner.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

function loadModule(vscodeOverrides = {}) {
  const moduleExports = {};
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    Buffer,
    Date,
    JSON,
    console,
    require(request) {
      if (request === "vscode") {
        return {
          workspace: {
            fs: vscodeOverrides.fs || {},
          },
          Uri: {
            joinPath(base, ...parts) {
              if (!vscodeOverrides.fs) {
                return {};
              }
              return {
                fsPath: [base?.fsPath ?? "", ...parts].join("/"),
              };
            },
          },
        };
      }
      if (request === "./instructionManager") {
        return {
          SHARED_MARKER_START: "<!-- agent-ninja-START -->",
          SHARED_MARKER_END: "<!-- agent-ninja-END -->",
          updateInstructionFileForRoot: async () => undefined,
        };
      }
      if (request === "./skillInstaller") {
        return {
          enrichSkillMeta: (meta, relativePath) => ({
            ...meta,
            relativePath: relativePath ?? meta.relativePath,
          }),
        };
      }
      if (request === "./installedSkillIndex") {
        return {
          needsRepair: (meta) =>
            Boolean(meta?.repairState) || Boolean(meta?.incomplete),
        };
      }
      if (request === "./skillIndex") {
        return {};
      }
      if (request === "./skillLocations") {
        return {
          normalizeFileSystemPath(value) {
            return String(value).replace(/\\/g, "/").toLowerCase();
          },
        };
      }
      return require(request);
    },
  };

  vm.runInNewContext(transpiled.outputText, sandbox, {
    filename: sourcePath,
  });

  return sandbox.module.exports;
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const {
  extractManagedSkillMarkerContent,
  isSkillReferencedInManagedBlock,
  isSkillRegisteredByMetadata,
} = loadModule();

test("isSkillRegisteredByMetadata treats enabled metadata as registered", () => {
  assert.strictEqual(isSkillRegisteredByMetadata(undefined), false);
  assert.strictEqual(isSkillRegisteredByMetadata({}), true);
  assert.strictEqual(
    isSkillRegisteredByMetadata({ registrationDisabled: false }),
    true,
  );
  assert.strictEqual(
    isSkillRegisteredByMetadata({ registrationDisabled: true }),
    false,
  );
});

test("extractManagedSkillMarkerContent prefers shared coexistence markers", () => {
  const text = [
    "# AGENTS",
    "<!-- agent-ninja-START -->",
    "- [Chrome DevTools](.github/skills/chrome-devtools/SKILL.md)",
    "<!-- agent-ninja-END -->",
  ].join("\n");

  const content = extractManagedSkillMarkerContent(text);
  assert.ok(content.includes("chrome-devtools/SKILL.md"));
  assert.ok(content.includes("agent-ninja-START"));
});

test("extractManagedSkillMarkerContent falls back to legacy skill markers", () => {
  const text = [
    "# AGENTS",
    "<!-- skill-ninja-START -->",
    "- [Chrome DevTools](.github/skills/chrome-devtools/SKILL.md)",
    "<!-- skill-ninja-END -->",
  ].join("\n");

  const content = extractManagedSkillMarkerContent(text);
  assert.ok(content.includes("chrome-devtools/SKILL.md"));
  assert.ok(content.includes("skill-ninja-START"));
});

test("extractManagedSkillMarkerContent returns undefined without a managed block", () => {
  assert.strictEqual(
    extractManagedSkillMarkerContent("# AGENTS\n- no managed block"),
    undefined,
  );
});

test("isSkillReferencedInManagedBlock detects skills inside a shared block", () => {
  const text = [
    "# AGENTS",
    "<!-- agent-ninja-START -->",
    "- [Chrome DevTools](.github/skills/chrome-devtools/SKILL.md)",
    "<!-- agent-ninja-END -->",
  ].join("\n");

  assert.strictEqual(
    isSkillReferencedInManagedBlock(text, ".github/skills", "chrome-devtools"),
    true,
  );
});

test("isSkillReferencedInManagedBlock detects skills inside a legacy block", () => {
  const text = [
    "<!-- skill-ninja-START -->",
    "- [Chrome DevTools](./.github/skills/chrome-devtools/SKILL.md)",
    "<!-- skill-ninja-END -->",
  ].join("\n");

  assert.strictEqual(
    isSkillReferencedInManagedBlock(text, ".github/skills", "chrome-devtools"),
    true,
  );
});

test("isSkillReferencedInManagedBlock ignores skills not present in the block", () => {
  const text = [
    "<!-- agent-ninja-START -->",
    "- [Other Skill](.github/skills/other/SKILL.md)",
    "<!-- agent-ninja-END -->",
  ].join("\n");

  assert.strictEqual(
    isSkillReferencedInManagedBlock(text, ".github/skills", "chrome-devtools"),
    false,
  );
});

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

/**
 * `.skill-meta.json` の読み取り結果ごとに register / unregister の書き込みを観測する。
 * `readable: false` は「ファイルはあるが読めない」状態を作る。
 */
function loadScannerWithMetaFile({ exists, readable, body, statError }) {
  const writes = [];
  const fsStub = {
    async readFile() {
      if (!exists || !readable) {
        const error = new Error("read failed");
        error.code = exists ? "EBUSY" : "ENOENT";
        throw error;
      }
      return Buffer.from(body, "utf-8");
    },
    async stat() {
      if (statError) {
        throw statError;
      }
      if (!exists) {
        const error = new Error("not found");
        error.code = "ENOENT";
        throw error;
      }
      return { type: 1, size: body.length };
    },
    async writeFile(uri, content) {
      writes.push(Buffer.from(content).toString("utf-8"));
    },
  };

  return { writes, scanner: loadModule({ fs: fsStub }) };
}

const LOCAL_SKILL = {
  name: "sample",
  relativePath: "sample",
  isManaged: true,
  isReadOnly: false,
  skillDirUri: { fsPath: "/skills/sample" },
  root: { rootPath: "/skills" },
  description: "desc",
  categories: [],
};

const REMOTE_META = JSON.stringify({
  name: "sample",
  source: "anthropics-skills",
  remotePath: "skills/sample",
  description: "desc",
});

async function runAsyncTests() {
  await asyncTest(
    "register and unregister preserve malformed and non-object metadata",
    async () => {
      for (const operation of ["registerLocalSkill", "unregisterLocalSkill"]) {
        for (const body of ["{broken", "null", "[]", "42", '"text"']) {
          const { writes, scanner } = loadScannerWithMetaFile({
            exists: true,
            readable: true,
            body,
          });
          assert.strictEqual(
            await scanner[operation](LOCAL_SKILL, {}, {}),
            false,
          );
          assert.deepStrictEqual(Array.from(writes), []);
        }
      }
    },
  );
  await asyncTest(
    "register and unregister preserve metadata when read and stat both fail",
    async () => {
      for (const operation of ["registerLocalSkill", "unregisterLocalSkill"]) {
        for (const code of ["NoPermissions", "EACCES", "EBUSY", undefined]) {
          const statError = new Error(
            "FileNotFound appears in a path, not an error code",
          );
          statError.code = code;
          const { writes, scanner } = loadScannerWithMetaFile({
            exists: true,
            readable: false,
            body: REMOTE_META,
            statError,
          });
          assert.strictEqual(
            await scanner[operation](LOCAL_SKILL, {}, {}),
            false,
          );
          assert.deepStrictEqual(Array.from(writes), []);
        }
      }
    },
  );
  await asyncTest(
    "register refuses to overwrite a .skill-meta.json it could not read",
    async () => {
      const { writes, scanner } = loadScannerWithMetaFile({
        exists: true,
        readable: false,
        body: REMOTE_META,
      });

      const result = await scanner.registerLocalSkill(LOCAL_SKILL, {}, {});

      assert.strictEqual(result, false);
      assert.deepStrictEqual(
        Array.from(writes),
        [],
        "an unreadable metadata file must not be replaced by defaults",
      );
    },
  );

  await asyncTest(
    "unregister refuses to overwrite a .skill-meta.json it could not read",
    async () => {
      const { writes, scanner } = loadScannerWithMetaFile({
        exists: true,
        readable: false,
        body: REMOTE_META,
      });

      const result = await scanner.unregisterLocalSkill(LOCAL_SKILL, {}, {});

      assert.strictEqual(result, false);
      assert.deepStrictEqual(Array.from(writes), []);
    },
  );

  await asyncTest(
    "register keeps the remote identity when the metadata reads fine",
    async () => {
      const { writes, scanner } = loadScannerWithMetaFile({
        exists: true,
        readable: true,
        body: REMOTE_META,
      });

      const result = await scanner.registerLocalSkill(LOCAL_SKILL, {}, {});

      assert.strictEqual(result, true);
      assert.strictEqual(writes.length, 1);
      const written = JSON.parse(writes[0]);
      assert.strictEqual(written.source, "anthropics-skills");
      assert.strictEqual(written.remotePath, "skills/sample");
    },
  );

  await asyncTest(
    "register still writes defaults when the metadata is absent",
    async () => {
      const { writes, scanner } = loadScannerWithMetaFile({
        exists: false,
        readable: false,
        body: "",
      });

      const result = await scanner.registerLocalSkill(LOCAL_SKILL, {}, {});

      assert.strictEqual(
        result,
        true,
        "refusing unreadable files must not block a first registration",
      );
      assert.strictEqual(writes.length, 1);
      assert.strictEqual(JSON.parse(writes[0]).name, "sample");
    },
  );
}

test("isSkillReferencedInManagedBlock normalizes trailing slashes and back slashes", () => {
  const text = [
    "<!-- agent-ninja-START -->",
    "- [Chrome DevTools](.github/skills/chrome-devtools/SKILL.md)",
    "<!-- agent-ninja-END -->",
  ].join("\n");

  assert.strictEqual(
    isSkillReferencedInManagedBlock(
      text,
      ".github\\skills\\",
      "chrome-devtools",
    ),
    true,
  );
});

test("isSkillReferencedInManagedBlock ignores hits outside the managed block", () => {
  const text = [
    "# AGENTS",
    "- [Manual reference](.github/skills/chrome-devtools/SKILL.md)",
    "<!-- agent-ninja-START -->",
    "- [Other Skill](.github/skills/other/SKILL.md)",
    "<!-- agent-ninja-END -->",
  ].join("\n");

  assert.strictEqual(
    isSkillReferencedInManagedBlock(text, ".github/skills", "chrome-devtools"),
    false,
  );
});

console.log("\nLocal skill scanner tests passed.");

runAsyncTests()
  .then(() => console.log("Local skill scanner async tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
