#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "./githubResponse") {
    return {
      isGitHubResponseError(error) {
        return error?.name === "GitHubResponseError";
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function requireTypeScriptModule(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  });

  const loadedModule = new Module(filePath, module);
  loadedModule.filename = filePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(filePath));
  loadedModule._compile(transpiled.outputText, filePath);
  return loadedModule.exports;
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main() {
  const { runSourceIndexUpdateBatch } = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "sourceIndexUpdateBatch.ts"),
  );

  await test("stops after a rate limit failure and marks remaining entries skipped", async () => {
    const calls = [];
    const result = await runSourceIndexUpdateBatch(
      ["first", "second", "third"],
      [],
      async (value, entry) => {
        calls.push(entry);
        throw Object.assign(new Error("rate limit"), {
          name: "GitHubResponseError",
          kind: "rate-limit",
        });
      },
    );

    assert.deepStrictEqual(calls, ["first"]);
    assert.strictEqual(result.failures.length, 1);
    assert.deepStrictEqual(result.skipped, ["second", "third"]);
  });

  await test("continues after a non-systemic failure", async () => {
    const calls = [];
    const result = await runSourceIndexUpdateBatch(
      ["first", "second"],
      [],
      async (value, entry) => {
        calls.push(entry);
        if (entry === "first") {
          throw new Error("not found");
        }
        return [...value, entry];
      },
    );

    assert.deepStrictEqual(calls, ["first", "second"]);
    assert.deepStrictEqual(result.value, ["second"]);
    assert.strictEqual(result.failures.length, 1);
    assert.strictEqual(result.skipped.length, 0);
  });

  console.log("\nSource index update batch tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
