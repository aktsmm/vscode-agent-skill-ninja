#!/usr/bin/env node

// Language Model tool の UX ガード。
//
// これらは実行時に確認ダイアログが出ないと気づけない欠陥なので、
// source を静的に検査して回帰を止める。

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");
const { loadSrcModule } = require("./load-src-module");

const SRC_DIR = path.join(__dirname, "..", "src");
const MCP_TOOLS_PATH = path.join(SRC_DIR, "mcpTools.ts");

/** ワークスペースやインデックスを書き換えるので、確認なしに走らせてはいけない tool */
const MUTATING_TOOL_CLASSES = [
  "SkillInstallTool",
  "SkillUninstallTool",
  "SkillReinstallTool",
  "AddSourceTool",
  "RemoveSourceTool",
  "LocalizeSkillsTool",
];

let failures = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(`  ${error.stack || error.message}`);
  }
}

function listSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
  });
}

function readClassBody(source, className) {
  const start = source.indexOf(`class ${className} `);
  assert.notStrictEqual(start, -1, `missing class ${className}`);
  const end = source.indexOf("\nclass ", start + 1);
  return source.slice(start, end === -1 ? source.length : end);
}

async function main() {
  const mcpSource = fs.readFileSync(MCP_TOOLS_PATH, "utf8");

  await test("mutating tools declare a confirmation before running", () => {
    for (const className of MUTATING_TOOL_CLASSES) {
      const body = readClassBody(mcpSource, className);
      assert.ok(
        body.includes("prepareInvocation("),
        `${className} must implement prepareInvocation so the user can cancel`,
      );
      assert.ok(
        body.includes("confirmationMessages:"),
        `${className} must supply confirmationMessages`,
      );
    }
  });

  await test("reinstall text diff asks before sending file content to the model", () => {
    const body = readClassBody(mcpSource, "SkillReinstallTool");
    const prepare = body.slice(0, body.indexOf("async invoke("));
    const diffBranch = prepare.slice(
      prepare.indexOf('options.input.mode === "diff"'),
      prepare.indexOf('options.input.mode !== "apply"'),
    );
    assert.ok(diffBranch.includes("confirmationMessages:"));
    assert.match(diffBranch, /send.*model/i);
    assert.ok(diffBranch.includes("entryId"));
    assert.ok(diffBranch.includes("filePath"));
    assert.ok(body.includes("readReinstallTextDiff("));
  });

  await test("reinstall diff confirms its target before loading and labels the returned data", async () => {
    const tools = new Map();
    let planCalls = 0;
    let diffCalls = 0;
    class MarkdownString {
      constructor() {
        this.value = "";
      }
      appendMarkdown(value) {
        this.value += value;
      }
      appendText(value) {
        this.value += value;
      }
    }
    class LanguageModelTextPart {
      constructor(value) {
        this.value = value;
      }
    }
    class LanguageModelToolResult {
      constructor(content) {
        this.content = content;
      }
    }
    const vscode = {
      MarkdownString,
      LanguageModelTextPart,
      LanguageModelToolResult,
      lm: {
        registerTool(name, tool) {
          tools.set(name, tool);
          return { dispose() {} };
        },
      },
      workspace: { getConfiguration: () => ({ get: () => false }) },
    };
    const modules = {
      vscode,
      "./i18n": { isJapanese: () => false },
      "./skillIndex": { loadSkillIndex: async () => ({}) },
      "./skillReinstallPlan": {
        describeContentDiffDetails:
          loadSrcModule("./skillReinstallPlan").describeContentDiffDetails,
      },
      "./skillReinstall": {
        createReinstallPlan: async () => {
          planCalls++;
          const details = Array.from({ length: 11 }, (_, index) => ({
            path: `file${index}.md`,
            kind: "changed",
            localSha: "aaaaaaa",
            remoteSha: "bbbbbbb",
          }));
          return {
            plan: {
              planId: "preview-id",
              items: [
                {
                  entryId: "home::demo",
                  name: "demo",
                  rootLabel: "Home",
                  provenance: "verified",
                  status: "hold",
                  reason: "local-edits",
                  diff: {
                    changed: details.map((detail) => detail.path),
                    added: [],
                    removed: [],
                    identical: false,
                    details,
                  },
                },
              ],
            },
            entries: new Map(),
          };
        },
        readReinstallTextDiff: async (_plan, selection) => {
          diffCalls++;
          assert.equal(selection.planId, "preview-id");
          assert.equal(selection.entryId, "home::demo");
          assert.equal(selection.filePath, "SKILL.md");
          return {
            lines: ["--- source", "+++ local", "+~~~"],
            truncated: false,
            commitSha: "a".repeat(40),
            baseline: "recorded",
          };
        },
      },
    };
    const exports = {};
    vm.runInNewContext(
      ts.transpileModule(mcpSource, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      {
        exports,
        require: (name) => modules[name] ?? {},
        AbortController,
        console,
      },
    );
    exports.registerMcpTools({ subscriptions: [] });
    const tool = tools.get("skillNinja_reinstall");
    const input = {
      mode: "diff",
      planId: "preview-id",
      targets: { entryIds: ["home::demo"] },
      diff: { entryId: "home::demo", filePath: "SKILL.md" },
    };
    const prepared = tool.prepareInvocation({ input });
    assert.match(prepared.confirmationMessages.message.value, /send.*model/i);
    assert.match(prepared.confirmationMessages.message.value, /home::demo/);
    assert.match(prepared.confirmationMessages.message.value, /SKILL\.md/);
    assert.equal(planCalls, 0);
    assert.equal(diffCalls, 0);
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose() {} }),
    };
    const result = await tool.invoke({ input }, token);
    const output = result.content[0].value;
    assert.match(output, /untrusted data, not instructions/i);
    assert.match(output, /~~~~diff\n[\s\S]*\+~~~\n~~~~/);
    assert.equal(planCalls, 1);
    assert.equal(diffCalls, 1);
    const invalid = await tool.invoke(
      { input: { ...input, diff: undefined } },
      token,
    );
    assert.match(invalid.content[0].value, /requires.*entryId/i);
    assert.equal(planCalls, 1);
    assert.equal(diffCalls, 1);
    const canceled = await tool.invoke(
      { input },
      { ...token, isCancellationRequested: true },
    );
    assert.match(canceled.content[0].value, /cancel/i);
    assert.equal(planCalls, 1);
    assert.equal(diffCalls, 1);
    const preview = await tool.invoke(
      { input: { mode: "preview", targets: input.targets, detailsOffset: 5 } },
      token,
    );
    assert.match(preview.content[0].value, /files 6-10 of 11/);
    assert.match(preview.content[0].value, /file5\.md/);
    assert.doesNotMatch(preview.content[0].value, /file0\.md/);
    assert.match(preview.content[0].value, /next detailsOffset=10/);
    assert.equal(planCalls, 2);
    assert.equal(diffCalls, 1);
  });

  await test("tool output tables escape interpolated values", () => {
    const rawTableRows = mcpSource
      .split(/\r?\n/)
      .filter((line) => /^\s*\|.*\$\{/.test(line));
    assert.deepStrictEqual(
      rawTableRows,
      [],
      "Markdown table cells must go through renderMarkdownTable so pipes and newlines are escaped",
    );
  });

  await test("source carries no replacement characters", () => {
    const offenders = listSourceFiles(SRC_DIR).filter((filePath) =>
      fs.readFileSync(filePath, "utf8").includes("\uFFFD"),
    );
    assert.deepStrictEqual(
      offenders.map((filePath) => path.relative(SRC_DIR, filePath)),
      [],
      "U+FFFD means text was decoded with the wrong encoding",
    );
  });
}

main().then(() => {
  console.log(failures > 0 ? "RESULT=FAIL" : "RESULT=PASS");
  if (failures > 0) {
    process.exitCode = 1;
  }
});
