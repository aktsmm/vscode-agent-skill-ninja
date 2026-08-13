#!/usr/bin/env node

// テストハーネス用: src/*.ts を実行時にトランスパイルして読み込む。
//
// 各テストは vscode などを差し替えたサンドボックスで src をロードするが、
// 差し替えないローカル import は実体を使いたい。CommonJS の解決は
// scripts/ 基準になるので、src/ を明示して解決する。

const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const SRC_DIR = path.join(__dirname, "..", "src");
const cache = new Map();

function loadSrcModule(relativeRequest) {
  const moduleName = relativeRequest.replace(/^\.\//, "");
  if (cache.has(moduleName)) {
    return cache.get(moduleName);
  }

  const filePath = path.join(SRC_DIR, `${moduleName}.ts`);
  const output = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  }).outputText;

  const loaded = new Module(filePath, module);
  loaded.filename = filePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(filePath));
  loaded._compile(output, filePath);

  cache.set(moduleName, loaded.exports);
  return loaded.exports;
}

/**
 * 相対 import なら src の TypeScript を、そうでなければ通常の require を返す。
 */
function requireSrcOrNodeModule(request) {
  if (request.startsWith("./") || request.startsWith("../")) {
    return loadSrcModule(request);
  }
  return require(request);
}

module.exports = { loadSrcModule, requireSrcOrNodeModule, SRC_DIR };
