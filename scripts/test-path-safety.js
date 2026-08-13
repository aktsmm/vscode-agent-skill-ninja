#!/usr/bin/env node

// pathSafety のプリミティブを直接検証する。
// 実 vscode を使わないので Windows / Linux のどちらでも同じ結果になる。

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

function requireTypeScriptModule(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  });

  const loadedModule = new Module(filePath, module);
  loadedModule.filename = filePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(filePath));
  loadedModule._compile(transpiled.outputText, filePath);
  return loadedModule.exports;
}

const {
  isSafePathSegment,
  isContainedPath,
  isStrictlyInsidePath,
  toSafeRelativeSegments,
  isSafeRemoteRepoPath,
} = requireTypeScriptModule(path.join(__dirname, "..", "src", "pathSafety.ts"));

let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(`  ${error.message}`);
  }
}

test("isSafePathSegment accepts ordinary skill file names", () => {
  for (const name of [
    "SKILL.md",
    "reference.md",
    "docx",
    "my-skill_v2",
    "日本語ファイル.md",
    "a.b.c.json",
    ".skill-meta.json",
  ]) {
    assert.strictEqual(isSafePathSegment(name), true, `expected safe: ${name}`);
  }
});

test("isSafePathSegment rejects separators and relative refs", () => {
  for (const name of [
    "",
    ".",
    "..",
    "../evil",
    "..\\evil",
    "a/b",
    "a\\b",
    "..\\..\\..\\evil.txt",
    "/etc/passwd",
  ]) {
    assert.strictEqual(
      isSafePathSegment(name),
      false,
      `expected unsafe: ${JSON.stringify(name)}`,
    );
  }
});

test("isSafePathSegment rejects drive letters and UNC forms", () => {
  for (const name of ["c:", "c:evil.txt", "\\\\server\\share"]) {
    assert.strictEqual(
      isSafePathSegment(name),
      false,
      `expected unsafe: ${JSON.stringify(name)}`,
    );
  }
});

test("isSafePathSegment rejects control chars and Windows-invalid chars", () => {
  for (const name of [
    "evil\u0000.txt",
    "evil\n.txt",
    "a<b",
    "a>b",
    'a"b',
    "a|b",
    "a?b",
    "a*b",
  ]) {
    assert.strictEqual(
      isSafePathSegment(name),
      false,
      `expected unsafe: ${JSON.stringify(name)}`,
    );
  }
});

test("isSafePathSegment rejects trailing dot or space", () => {
  for (const name of ["evil.", "evil ", ".skill-meta.json "]) {
    assert.strictEqual(
      isSafePathSegment(name),
      false,
      `expected unsafe: ${JSON.stringify(name)}`,
    );
  }
});

test("isSafePathSegment rejects Windows reserved device names", () => {
  for (const name of ["CON", "con", "CON.txt", "nul.md", "COM1", "lpt9.json"]) {
    assert.strictEqual(
      isSafePathSegment(name),
      false,
      `expected unsafe: ${JSON.stringify(name)}`,
    );
  }
  // Windows は上付き数字もデバイス名へ解決しうる
  for (const name of ["COM\u00b9", "lpt\u00b2.md", "com\u00b3"]) {
    assert.strictEqual(
      isSafePathSegment(name),
      false,
      `expected unsafe: ${JSON.stringify(name)}`,
    );
  }
  assert.strictEqual(isSafePathSegment("console.md"), true);
  assert.strictEqual(isSafePathSegment("companion.md"), true);
});

test("isSafePathSegment rejects non-string input", () => {
  for (const value of [undefined, null, 42, {}, []]) {
    assert.strictEqual(isSafePathSegment(value), false);
  }
});

test("isContainedPath allows root itself and descendants", () => {
  const root = path.resolve("/tmp/skills-root");
  assert.strictEqual(isContainedPath(root, root), true);
  assert.strictEqual(isContainedPath(root, path.join(root, "a")), true);
  assert.strictEqual(isContainedPath(root, path.join(root, "a", "b")), true);
});

test("isContainedPath rejects escapes and siblings", () => {
  const root = path.resolve("/tmp/skills-root");
  assert.strictEqual(
    isContainedPath(root, path.join(root, "..", "evil.txt")),
    false,
  );
  assert.strictEqual(isContainedPath(root, path.resolve("/tmp")), false);
  assert.strictEqual(
    isContainedPath(root, path.resolve("/tmp/skills-root-sibling")),
    false,
  );
});

test("isStrictlyInsidePath excludes the root itself", () => {
  const root = path.resolve("/tmp/skills-root");
  assert.strictEqual(isStrictlyInsidePath(root, root), false);
  assert.strictEqual(isStrictlyInsidePath(root, path.join(root, "a")), true);
  assert.strictEqual(
    isStrictlyInsidePath(root, path.join(root, "..", "evil")),
    false,
  );
});

test("toSafeRelativeSegments splits on both separators", () => {
  assert.deepStrictEqual(toSafeRelativeSegments("a/b/c"), ["a", "b", "c"]);
  assert.deepStrictEqual(toSafeRelativeSegments("a\\b"), ["a", "b"]);
  assert.deepStrictEqual(toSafeRelativeSegments("a//b/"), ["a", "b"]);
});

test("toSafeRelativeSegments rejects degenerate and escaping inputs", () => {
  for (const value of [
    "",
    ".",
    "./",
    "/",
    "..",
    "../..",
    "a/../../b",
    "a/./b",
    "..\\..\\evil",
    undefined,
    null,
    42,
  ]) {
    assert.strictEqual(
      toSafeRelativeSegments(value),
      undefined,
      `expected undefined for ${JSON.stringify(value)}`,
    );
  }
});

test("isSafeRemoteRepoPath accepts ordinary repo paths", () => {
  for (const value of [
    "skills/docx",
    "skills/docx/SKILL.md",
    "a",
    "skills/日本語",
    // colon を含む repo パスは Linux 上で正当。
    // remotePath はローカルのセグメントにならないので拒否しない
    "notes:2026/SKILL.md",
  ]) {
    assert.strictEqual(
      isSafeRemoteRepoPath(value),
      true,
      `expected safe: ${value}`,
    );
  }
});

test("isSafeRemoteRepoPath rejects traversal, encoded traversal and schemes", () => {
  for (const value of [
    "",
    "   ",
    "..",
    "../..",
    "skills/../../other-owner/other-repo/main/evil",
    "%2e%2e/%2e%2e",
    "%252e%252e/x",
    "skills/%2E%2E/evil",
    "/absolute/path",
    "//evil.example.com/x",
    "https://evil.example.com/x",
    "file:///etc/passwd",
    "skills\\windows",
    "skills/./x",
    undefined,
    null,
    42,
  ]) {
    assert.strictEqual(
      isSafeRemoteRepoPath(value),
      false,
      `expected unsafe: ${JSON.stringify(value)}`,
    );
  }
});

test("encoded traversal really does resolve to a parent segment in URLs", () => {
  // 計画の根拠確認: encodeURIComponent は ".." を素通しし、
  // %2e%2e も URL 正規化で親セグメントへ戻る
  assert.strictEqual(encodeURIComponent(".."), "..");
  const escaped = new URL(
    "https://raw.githubusercontent.com/owner/repo/main/" +
      "%2e%2e/%2e%2e/%2e%2e/other-owner/other-repo/main/evil/SKILL.md",
  );
  assert.strictEqual(
    escaped.pathname.startsWith("/owner/repo/"),
    false,
    "encoded dot segments should have escaped the owner/repo prefix",
  );
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exitCode = 1;
} else {
  console.log("\nAll path safety tests passed");
}
