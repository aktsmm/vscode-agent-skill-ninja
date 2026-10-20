/**
 * Skill invocation mode (disable-model-invocation / user-invocable) tests.
 * Covers frontmatter parsing, minimal-diff rewriting, and how manual-only
 * skills are handled in the generated instruction block.
 * Run: node scripts/test-skill-invocation.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");
const { loadSrcModule } = require("./load-src-module");

const {
  readSkillInvocationFromText,
  setSkillInvocationInText,
  normalizeSkillInvocation,
} = loadSrcModule("./skillInvocation");

async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const doc = (...frontmatter) =>
  [
    "---",
    "name: demo",
    "description: demo skill",
    ...frontmatter,
    "---",
    "",
    "# Demo",
  ].join("\n");

function parsingTests() {
  const cases = [
    [doc(), "auto"],
    [doc("disable-model-invocation: true"), "explicitOnly"],
    [doc("disable-model-invocation: false"), "auto"],
    [doc("disable-model-invocation: 'true'"), "explicitOnly"],
    [doc('disable-model-invocation: "TRUE"'), "explicitOnly"],
    [doc("disable-model-invocation: true # manual only"), "explicitOnly"],
    [doc("user-invocable: false"), "modelOnly"],
    [doc("user-invocable: true"), "auto"],
    // 両方立っている場合は、誰も自動では使わない手動専用を優先する
    [
      doc("user-invocable: false", "disable-model-invocation: true"),
      "explicitOnly",
    ],
    // 不正値は既定へ戻す
    [doc("disable-model-invocation: maybe"), "auto"],
    [doc("disable-model-invocation:"), "auto"],
    // ネストしたキーや本文中の記述は frontmatter のトップレベルではない
    [doc("metadata:", "  disable-model-invocation: true"), "auto"],
    ["# no frontmatter\ndisable-model-invocation: true\n", "auto"],
    ["---\nname: x\ndisable-model-invocation: true\n", "auto"],
    ["---\nname: x\n---\n\ndisable-model-invocation: true\n", "auto"],
  ];
  for (const [text, expected] of cases) {
    assert.strictEqual(
      readSkillInvocationFromText(text),
      expected,
      JSON.stringify(text),
    );
  }
  // CRLF と BOM
  assert.strictEqual(
    readSkillInvocationFromText(
      doc("disable-model-invocation: true").replace(/\n/g, "\r\n"),
    ),
    "explicitOnly",
  );
  assert.strictEqual(
    readSkillInvocationFromText("\uFEFF" + doc("user-invocable: false")),
    "modelOnly",
  );
  assert.strictEqual(normalizeSkillInvocation("explicitOnly"), "explicitOnly");
  assert.strictEqual(normalizeSkillInvocation("bogus"), "auto");
  assert.strictEqual(normalizeSkillInvocation(undefined), "auto");
}

function rewriteTests() {
  const base = doc();
  assert.strictEqual(
    setSkillInvocationInText(base, "explicitOnly"),
    doc("disable-model-invocation: true"),
  );
  assert.strictEqual(
    setSkillInvocationInText(base, "modelOnly"),
    doc("user-invocable: false"),
  );
  assert.strictEqual(setSkillInvocationInText(base, "auto"), base);

  // 切り替えでは、反対側のキーが残らない
  assert.strictEqual(
    setSkillInvocationInText(
      doc("disable-model-invocation: true"),
      "modelOnly",
    ),
    doc("user-invocable: false"),
  );
  assert.strictEqual(
    setSkillInvocationInText(doc("user-invocable: false"), "explicitOnly"),
    doc("disable-model-invocation: true"),
  );
  assert.strictEqual(
    setSkillInvocationInText(
      doc("user-invocable: false", "disable-model-invocation: true"),
      "auto",
    ),
    base,
  );

  // 既に正しい値なら 1 バイトも変えない（コメントや引用符も保つ）
  const already = doc("disable-model-invocation: 'true' # manual");
  assert.strictEqual(
    setSkillInvocationInText(already, "explicitOnly"),
    already,
  );

  // 値だけ差し替え、位置と他の行は保つ
  const reordered = [
    "---",
    "disable-model-invocation: false",
    "name: demo",
    "---",
    "body",
  ].join("\n");
  assert.strictEqual(
    setSkillInvocationInText(reordered, "explicitOnly"),
    ["---", "disable-model-invocation: true", "name: demo", "---", "body"].join(
      "\n",
    ),
  );

  // 重複キーは 1 つにまとめる
  assert.strictEqual(
    setSkillInvocationInText(
      doc("disable-model-invocation: false", "disable-model-invocation: false"),
      "explicitOnly",
    ),
    doc("disable-model-invocation: true"),
  );

  // CRLF を保つ
  const crlf = base.replace(/\n/g, "\r\n");
  const crlfResult = setSkillInvocationInText(crlf, "explicitOnly");
  assert.strictEqual(
    crlfResult,
    doc("disable-model-invocation: true").replace(/\n/g, "\r\n"),
  );
  assert.ok(!/(?<!\r)\n/.test(crlfResult), "no bare LF may be introduced");

  // 本文は触らない（本文中の同名行も）
  const body = "---\nname: x\n---\n\ndisable-model-invocation: true\n";
  assert.strictEqual(setSkillInvocationInText(body, "auto"), body);

  // frontmatter が無い・閉じていないなら書けない
  assert.strictEqual(
    setSkillInvocationInText("# no frontmatter\n", "explicitOnly"),
    undefined,
  );
  assert.strictEqual(
    setSkillInvocationInText("---\nname: x\n", "explicitOnly"),
    undefined,
  );

  // 往復で元に戻る
  for (const mode of ["explicitOnly", "modelOnly"]) {
    assert.strictEqual(
      setSkillInvocationInText(setSkillInvocationInText(base, mode), "auto"),
      base,
    );
  }
}

// ---- instruction block ----

function loadInstructionManager(settings) {
  const sourcePath = path.join(__dirname, "..", "src", "instructionManager.ts");
  const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const files = new Map();
  const metas = [];
  const uri = (fsPath) => ({ fsPath });
  const exports = {};
  const sandbox = {
    exports,
    module: { exports },
    process,
    console: { ...console, log() {}, warn() {} },
    Promise,
    Buffer,
    setTimeout,
    Set,
    Map,
    Date,
    WeakMap,
    require(request) {
      if (request === "vscode") {
        return {
          Uri: {
            file: uri,
            joinPath: (base, ...parts) =>
              uri(path.posix.join(base.fsPath, ...parts)),
          },
          workspace: {
            workspaceFolders: [],
            getConfiguration: () => ({
              get: (key, fallback) =>
                key in settings ? settings[key] : fallback,
            }),
            fs: {
              async readFile(target) {
                if (!files.has(target.fsPath)) {
                  const error = new Error("not found");
                  error.code = "ENOENT";
                  throw error;
                }
                return Buffer.from(files.get(target.fsPath), "utf-8");
              },
              async stat(target) {
                if (!files.has(target.fsPath)) {
                  const error = new Error("not found");
                  error.code = "ENOENT";
                  throw error;
                }
                return {};
              },
              async writeFile(target, content) {
                files.set(
                  target.fsPath,
                  Buffer.from(content).toString("utf-8"),
                );
              },
              async createDirectory() {},
            },
          },
        };
      }
      if (request === "./skillInstaller") {
        return {
          getInstalledSkillsWithMeta: async () => metas.map((m) => ({ ...m })),
        };
      }
      if (request === "./localSkillScanner") {
        return {};
      }
      if (request === "./toolDetector") {
        return { resolveOutputFormat: async () => ({ format: "full" }) };
      }
      if (request === "./constants") {
        return {
          SELF_EXTENSION_ID: "yamapan.agent-skill-ninja",
          SKILL_DESCRIPTION_LIMITS: { MAX_TOTAL: 200, MAX_EACH: 100 },
        };
      }
      if (request === "./shared-store-lock") {
        return {
          withSharedStoreLock: async (_id, task) =>
            task({ assertHeld() {}, assertStillOwned: async () => {} }),
          describeSharedStoreLockFailure: () => undefined,
        };
      }
      if (request === "./outputTargets") {
        return {
          findDeepestContainingFolder: () => undefined,
          resolveOutputGroups: async () => [],
        };
      }
      if (request === "./skillLocations") {
        return {
          computeRelativeDirectoryPath: () => ".github/skills",
          getManagedSkillRoots: async () => [],
          resolveConfiguredPathToUri: () => undefined,
        };
      }
      if (request === "./skillInvocation") {
        return loadSrcModule(request);
      }
      if (request === "./coexistence") {
        return {
          getCoexistenceMode: () => "auto",
          getEffectiveOwnership: async () => ({
            owner: "self",
            reason: "no-sibling",
            selfKinds: ["skill"],
            siblingInstalled: false,
          }),
        };
      }
      return require(request);
    },
  };
  vm.runInNewContext(transpiled.outputText, sandbox, { filename: sourcePath });
  return { exports: sandbox.module.exports, files, metas, uri };
}

const meta = (name, invocation) => ({
  name,
  source: "local",
  description: `${name} description`,
  categories: [],
  installedAt: "",
  relativePath: name,
  ...(invocation ? { invocation } : {}),
});

async function generate(format, handling, skills) {
  const { exports, files, metas, uri } = loadInstructionManager({
    explicitOnlySkillsInInstructions: handling,
  });
  metas.push(...skills);
  const root = {
    rootUri: uri("/ws/.github/skills"),
    rootPath: "/ws/.github/skills",
    instructionPath: "/ws/AGENTS.md",
  };
  const instruction = "/ws/AGENTS.md";
  files.set(instruction, "# Notes\n");
  const result = await exports.writeOutputGroup(
    {
      id: "workspace",
      scope: "workspace",
      instructionUri: uri(instruction),
      instructionPath: instruction,
      format,
      formatIsExplicit: true,
      catalogPath: "skills-catalog.md",
      catalogFormat: "full",
      catalogUri: uri("/ws/skills-catalog.md"),
      members: [root],
      targetIds: ["workspace"],
    },
    {},
  );
  assert.ok(
    ["updated", "unchanged"].includes(result),
    `write result: ${result}`,
  );
  return {
    instruction: files.get(instruction),
    catalog: files.get("/ws/skills-catalog.md"),
  };
}

const MIXED = [
  meta("alpha"),
  meta("manual-only", "explicitOnly"),
  meta("model-only", "modelOnly"),
];

async function instructionTests() {
  for (const format of ["full", "compact", "legacy"]) {
    const { instruction: excluded } = await generate(format, "exclude", MIXED);
    assert.ok(excluded.includes("[alpha]"), `${format}: auto skill listed`);
    assert.ok(
      excluded.includes("[model-only]"),
      `${format}: model-only skill listed`,
    );
    assert.ok(
      !excluded.includes("manual-only"),
      `${format}: manual-only skill left out`,
    );
    assert.ok(
      !excluded.includes("Explicit-only"),
      `${format}: no explicit-only section`,
    );
    assert.ok(excluded.startsWith("# Notes\n"), `${format}: user text kept`);

    const { instruction: separated } = await generate(
      format,
      "separate",
      MIXED,
    );
    const sectionAt = separated.indexOf("### Explicit-only skills");
    assert.ok(sectionAt > 0, `${format}: explicit-only section present`);
    assert.ok(
      separated.indexOf("[alpha]") < sectionAt &&
        separated.indexOf("[model-only]") < sectionAt,
      `${format}: auto skills come before the section`,
    );
    assert.ok(
      separated.indexOf("[manual-only]") > sectionAt,
      `${format}: manual-only skill sits inside the section`,
    );
    assert.ok(
      separated.includes("Do not apply these on your own"),
      `${format}: section tells the model not to use them`,
    );

    const { instruction: included } = await generate(format, "include", MIXED);
    assert.ok(included.includes("[manual-only]"), `${format}: included`);
    assert.ok(
      !included.includes("Explicit-only"),
      `${format}: included without a section`,
    );
  }

  // 手動専用が無いなら、設定に関係なく出力は変わらない
  const plain = [meta("alpha"), meta("model-only", "modelOnly")];
  for (const format of ["full", "compact", "legacy"]) {
    const outputs = await Promise.all(
      ["exclude", "separate", "include"].map(
        async (handling) =>
          (await generate(format, handling, plain)).instruction,
      ),
    );
    assert.strictEqual(
      outputs[0],
      outputs[1],
      `${format}: exclude == separate`,
    );
    assert.strictEqual(outputs[0], outputs[2], `${format}: exclude == include`);
  }

  // 全部が手動専用で除外されたとき、「未インストール」とは書かない
  for (const format of ["full", "compact", "legacy"]) {
    const { instruction } = await generate(format, "exclude", [
      meta("only-manual", "explicitOnly"),
    ]);
    assert.ok(
      instruction.includes("No skills are available for automatic use"),
      `${format}: ${instruction}`,
    );
    assert.ok(!instruction.includes("No skills installed yet"));
    assert.ok(!instruction.includes("only-manual"));
  }

  // 全部が手動専用でも separate なら節だけで表は出さない
  const { instruction: onlySeparate } = await generate("full", "separate", [
    meta("only-manual", "explicitOnly"),
  ]);
  assert.ok(onlySeparate.includes("### Explicit-only skills"));
  assert.ok(!onlySeparate.includes("### Skills\n"));

  // ref 形式: 入口は変わらず、catalog 側へ同じ規則を適用する
  const { catalog } = await generate("ref", "exclude", MIXED);
  assert.ok(catalog.includes("[alpha]"));
  assert.ok(!catalog.includes("manual-only"));

  // 重複名の修飾は手動専用を除く前の集合で決めない（除外後に再計算される）
  const duplicated = [
    { ...meta("same"), relativePath: "a/same" },
    { ...meta("same", "explicitOnly"), relativePath: "b/same" },
  ];
  const { instruction: dedupe } = await generate("full", "exclude", duplicated);
  assert.ok(dedupe.includes("[same]"), dedupe);
}

async function scannerTests() {
  const os = require("os");
  const sourcePath = path.join(__dirname, "..", "src", "localSkillScanner.ts");
  const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-scan-invocation-"));
  try {
    const writeSkill = (name, extra, meta) => {
      const dir = path.join(tmp, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "SKILL.md"),
        ["---", `name: ${name}`, "description: demo", ...extra, "---", ""].join(
          "\n",
        ),
      );
      if (meta) {
        fs.writeFileSync(
          path.join(dir, ".skill-meta.json"),
          JSON.stringify({ name, source: "local", ...meta }),
        );
      }
    };
    writeSkill("plain", []);
    writeSkill("manual", ["disable-model-invocation: true"]);
    writeSkill("hidden", ["user-invocable: false"]);
    writeSkill("manual-disabled", ["disable-model-invocation: true"], {
      registrationDisabled: true,
    });
    writeSkill("manual-meta", ["disable-model-invocation: true"], {});
    writeSkill("hinted", [
      'argument-hint: "[file] [options]"',
      "context: fork",
    ]);
    writeSkill("inline-context", ["context: inline", "argument-hint:"]);
    // CRLF の SKILL.md でも、引用符付きの値が崩れずに読める
    fs.mkdirSync(path.join(tmp, "crlf-hint"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "crlf-hint", "SKILL.md"),
      "---\r\nname: crlf-hint\r\ndescription: demo\r\nargument-hint: '[issue number]'\r\n---\r\n",
    );

    const scan = async (handling) => {
      const uri = (fsPath) => ({ fsPath });
      const root = {
        rootPath: tmp,
        rootUri: uri(tmp),
        displayPath: "skills",
        scope: "workspace",
        isManaged: true,
        isReadOnly: false,
      };
      const exports = {};
      const sandbox = {
        exports,
        module: { exports },
        Buffer,
        Date,
        JSON,
        console: { ...console, warn() {} },
        require(request) {
          if (request === "vscode") {
            return {
              FileType: { File: 1, Directory: 2 },
              Uri: {
                file: uri,
                joinPath: (base, ...parts) =>
                  uri(path.join(base.fsPath, ...parts)),
              },
              workspace: {
                getConfiguration: () => ({
                  get: (key) =>
                    key === "explicitOnlySkillsInInstructions"
                      ? handling
                      : undefined,
                }),
                fs: {
                  async readDirectory(target) {
                    return fs
                      .readdirSync(target.fsPath, { withFileTypes: true })
                      .map((entry) => [
                        entry.name,
                        entry.isDirectory() ? 2 : 1,
                      ]);
                  },
                  async readFile(target) {
                    return fs.readFileSync(target.fsPath);
                  },
                  async stat(target) {
                    return fs.statSync(target.fsPath);
                  },
                },
              },
            };
          }
          if (request === "./gitignoreManager") {
            return {};
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
              isFallbackSkillMd: () => false,
            };
          }
          if (request === "./installedSkillIndex") {
            return { needsRepair: () => false };
          }
          if (request === "./skillIndex") {
            return {};
          }
          if (request === "./skillLocations") {
            return {
              getManagedSkillRoots: async () => [root],
              getExtensionSkillRoots: async () => [],
              getBuiltInSkillRoots: async () => [],
              normalizeFileSystemPath: (value) =>
                String(value).replace(/\\/g, "/").toLowerCase(),
            };
          }
          if (request === "./skillInvocation") {
            return loadSrcModule(request);
          }
          return require(request);
        },
      };
      vm.runInNewContext(transpiled.outputText, sandbox, {
        filename: sourcePath,
      });
      const skills = await sandbox.module.exports.scanVisibleSkills(uri(tmp));
      return Object.fromEntries(skills.map((skill) => [skill.name, skill]));
    };

    const excluded = await scan("exclude");
    assert.strictEqual(excluded["manual"].invocation, "explicitOnly");
    assert.strictEqual(excluded["hidden"].invocation, "modelOnly");
    assert.strictEqual(excluded["plain"].invocation, "auto");
    // /name 実行時のヒントとフォーク実行は、Browse と同じ項目でローカル行にも載る
    assert.strictEqual(excluded["hinted"].argumentHint, "[file] [options]");
    assert.strictEqual(excluded["hinted"].context, "fork");
    assert.strictEqual(excluded["crlf-hint"].argumentHint, "[issue number]");
    assert.strictEqual(excluded["plain"].argumentHint, undefined);
    assert.strictEqual(excluded["plain"].context, undefined);
    // 空のヒントと未対応の context 値は無視する
    assert.strictEqual(excluded["inline-context"].argumentHint, undefined);
    assert.strictEqual(excluded["inline-context"].context, undefined);
    // 一覧から外れる手動専用スキルを「未登録」と表示しない
    assert.strictEqual(excluded["manual"].registrationState, "registered");
    assert.strictEqual(excluded["manual"].isRegistered, true);
    assert.match(excluded["manual"].registrationReason, /Manual-only/);
    // 他のスキルと、ユーザーが登録解除したスキルの状態は変えない
    assert.strictEqual(excluded["plain"].registrationState, "unregistered");
    assert.strictEqual(excluded["hidden"].registrationState, "unregistered");
    assert.strictEqual(
      excluded["manual-disabled"].registrationState,
      "unregistered",
    );
    assert.strictEqual(excluded["manual-meta"].registrationSource, "metadata");

    // 一覧に載せる設定なら、通常の判定に戻る
    for (const handling of ["separate", "include"]) {
      const listed = await scan(handling);
      assert.strictEqual(
        listed["manual"].registrationState,
        "unregistered",
        handling,
      );
    }
    // 不正な設定値は既定（exclude）として扱う
    assert.strictEqual(
      (await scan("bogus"))["manual"].registrationState,
      "registered",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function writeQueueTests() {
  const { exports } = loadInstructionManager({});
  let active = 0;
  let maxActive = 0;
  const order = [];
  const task = (name, ms, fail) => async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    order.push(`start:${name}`);
    await new Promise((resolve) => setTimeout(resolve, ms));
    order.push(`end:${name}`);
    active -= 1;
    if (fail) {
      throw new Error(`boom:${name}`);
    }
    return name;
  };

  const results = await Promise.allSettled([
    exports.withOutputWriteLock("workspace", task("a", 30)),
    exports.withOutputWriteLock("workspace", task("b", 5, true)),
    exports.withOutputWriteLock("workspace", task("c", 1)),
  ]);
  // 同時に走らず、投入順に実行される
  assert.strictEqual(maxActive, 1);
  assert.deepStrictEqual(order, [
    "start:a",
    "end:a",
    "start:b",
    "end:b",
    "start:c",
    "end:c",
  ]);
  // 失敗は呼び出し側へ返り、後続を止めない
  assert.deepStrictEqual(
    results.map((result) => result.status),
    ["fulfilled", "rejected", "fulfilled"],
  );
  assert.strictEqual(results[0].value, "a");
  assert.strictEqual(results[2].value, "c");
}

async function main() {
  await run("frontmatter flags resolve to an invocation mode", parsingTests);
  await run("rewriting changes only the invocation keys", rewriteTests);
  await run(
    "workspace output writes run one at a time and survive a failure",
    writeQueueTests,
  );
  await run(
    "manual-only skills follow the instruction block setting",
    instructionTests,
  );
  await run(
    "manual-only skills left out of the list are not shown as unregistered",
    scannerTests,
  );
  console.log("\nSkill invocation tests passed.");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
