#!/usr/bin/env node

// 出荷される helper が本当に extension から参照されているかを AST で確認する。
//
// 以前の guard は「名前が consumer 一覧のどこかに現れるか」を正規表現で見ていたため、
// コメント・文字列・宣言行そのものまで「使用」に数え、consumer 一覧の更新漏れで
// false positive も出していた。ここでは src/extension.ts を root とした
// import / re-export グラフを作り、その中の実 identifier 参照だけを数える。
//
// 判定の名前は「extension entry-reachable source reference」。
// runtime に必ず呼ばれることまでは保証しない（callback 登録や動的経路は追わない）。

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const srcDir = path.join(__dirname, "..", "src");

const ENTRY_MODULE = "extension.ts";

const AUDITED_MODULES = [
  "githubAuth.ts",
  "githubResponse.ts",
  "shared-store-lock.ts",
  "authRecovery.ts",
  // 到達不能な export を実際に掃い出した module。戻りをここで止める
  "instructionManager.ts",
  "localSkillScanner.ts",
  "outputTargets.ts",
  "skillIndex.ts",
  "skillInstaller.ts",
  "skillSearch.ts",
  "treeProvider.ts",
];

/**
 * 到達不能でも許すもの。理由を書けないものは allowlist しない。
 * entry module 自身の export は package.json の contributes/main 契約で
 * VS Code が直接呼ぶため、そもそも監査対象に入れていない。
 */
const ALLOWED_UNREACHABLE = new Map([
  [
    "shared-store-lock.ts:configureSharedStoreLockRuntime",
    "test seam: scripts/test-shared-store-contract.js が clock と fs を差し替える",
  ],
  [
    "shared-store-lock.ts:resetSharedStoreLockRuntime",
    "test seam: 上記 seam を戻すために対で必要",
  ],
  [
    "githubAuth.ts:checkGitHubAuth",
    "本番からの参照なし。indexUpdater.ts の re-export は素通しで、実呼び出しは scripts/test-github-auth.js だけ。仕様テストがあるので消さず、本番配線は follow-up",
  ],
  [
    "localSkillScanner.ts:isSkillRegisteredByMetadata",
    "本番参照なし。scripts/test-local-skill-scanner.js が登録判定の仕様として検証している",
  ],
  [
    "skillIndex.ts:clearResolvedBranchCache",
    "本番参照なし。branch cache を使うテストが run 間を分離するために呼ぶ",
  ],
]);

let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

function moduleKeyFromSpecifier(fromModule, specifier) {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromModule), specifier),
  );
  return `${resolved}.ts`;
}

function hasExportModifier(node) {
  const modifiers = ts.canHaveModifiers(node)
    ? ts.getModifiers(node)
    : undefined;
  return (modifiers || []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
}

function collectExports(sourceFile) {
  const exports = [];
  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(statement)) {
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      exports.push({ name: statement.name.text, kind: "function" });
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      exports.push({ name: statement.name.text, kind: "class" });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          exports.push({ name: declaration.name.text, kind: "const" });
        }
      }
    }
  }
  return exports;
}

/** `export { a as b } from "./x"` を辿れるようにする */
function collectReExports(moduleKey, sourceFile) {
  const reExports = new Map();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const target = moduleKeyFromSpecifier(
      moduleKey,
      statement.moduleSpecifier.text,
    );
    if (!target || !statement.exportClause) {
      continue;
    }
    if (ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        reExports.set(element.name.text, {
          module: target,
          name: (element.propertyName || element.name).text,
        });
      }
    }
  }
  return reExports;
}

function collectImports(moduleKey, sourceFile) {
  const imports = [];
  const addNamed = (target, elements) => {
    for (const element of elements) {
      imports.push({
        module: target,
        imported: (element.propertyName || element.name).text,
        local: element.name.text,
      });
    }
  };

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const target = moduleKeyFromSpecifier(
      moduleKey,
      statement.moduleSpecifier.text,
    );
    if (!target || !statement.importClause) {
      continue;
    }

    // `import def, { a as b } from "./x"` は両方拾う
    if (statement.importClause.name) {
      imports.push({
        module: target,
        imported: "default",
        local: statement.importClause.name.text,
      });
    }
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      addNamed(target, bindings.elements);
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      imports.push({
        module: target,
        imported: "*",
        local: bindings.name.text,
      });
    }
  }
  return imports;
}

function collectModuleEdges(moduleKey, sourceFile) {
  const edges = new Set();
  for (const statement of sourceFile.statements) {
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) {
      continue;
    }
    const target = moduleKeyFromSpecifier(moduleKey, specifier.text);
    if (target) {
      edges.add(target);
    }
  }
  return edges;
}

/** 宣言そのものは参照ではない。property key と property access の右辺も除く */
function isReferencePosition(node) {
  const parent = node.parent;
  if (!parent) {
    return false;
  }
  if (
    (ts.isPropertyAccessExpression(parent) ||
      ts.isQualifiedName(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isEnumMember(parent) ||
      ts.isPropertyAssignment(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  // `{ showAuthHelp }` はキー兼値なので参照として数える
  if (ts.isShorthandPropertyAssignment(parent)) {
    return parent.name === node;
  }
  if (
    (ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isTypeParameterDeclaration(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  // import / export 節は別途 alias として解決するので二重に数えない
  if (
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent)
  ) {
    return false;
  }
  return true;
}

/** 宣言 1 つ分の参照。identifier と `ns.member` の両方を拾う */
function collectRefs(node, options = {}) {
  const names = new Set();
  const members = new Set();
  const visit = (current) => {
    // load 時に評価される部分だけを見るときは、関数本体へ入らない
    if (
      options.skipFunctionBodies &&
      (ts.isArrowFunction(current) ||
        ts.isFunctionExpression(current) ||
        ts.isFunctionDeclaration(current) ||
        ts.isMethodDeclaration(current) ||
        ts.isGetAccessorDeclaration(current) ||
        ts.isSetAccessorDeclaration(current) ||
        ts.isConstructorDeclaration(current))
    ) {
      return;
    }
    if (ts.isIdentifier(current) && isReferencePosition(current)) {
      names.add(current.text);
    }
    if (
      ts.isPropertyAccessExpression(current) &&
      ts.isIdentifier(current.expression) &&
      ts.isIdentifier(current.name)
    ) {
      members.add(`${current.expression.text}.${current.name.text}`);
    }
    ts.forEachChild(current, visit);
  };
  ts.forEachChild(node, visit);
  return { names, members };
}

function bindingNames(name) {
  if (ts.isIdentifier(name)) {
    return [name.text];
  }
  const names = [];
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      names.push(...bindingNames(element.name));
    }
  }
  return names;
}

/** top-level 宣言ごとの参照と、module scope で実行される副作用の参照 */
function collectModuleFacts(sourceFile) {
  const declarations = new Map();
  const sideEffects = { names: new Set(), members: new Set() };

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) ||
      ts.isExportDeclaration(statement)
    ) {
      continue;
    }
    if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      continue;
    }

    const exported = hasExportModifier(statement);
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      declarations.set(statement.name.text, {
        exported,
        refs: collectRefs(statement),
      });
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const refs = collectRefs(declaration);
        // 関数式以外の initializer は import 時に評価されるので、
        // 宣言名が使われていなくてもその参照は生きている
        const eager = Boolean(
          declaration.initializer &&
          !ts.isArrowFunction(declaration.initializer) &&
          !ts.isFunctionExpression(declaration.initializer) &&
          !ts.isClassExpression(declaration.initializer),
        );
        // 入れ子の callback 本体は load 時に実行されないので seed に含めない
        const eagerRefs = eager
          ? collectRefs(declaration, { skipFunctionBodies: true })
          : undefined;
        for (const name of bindingNames(declaration.name)) {
          declarations.set(name, { exported, refs, eagerRefs });
        }
      }
      continue;
    }

    const refs = collectRefs(statement);
    for (const name of refs.names) {
      sideEffects.names.add(name);
    }
    for (const member of refs.members) {
      sideEffects.members.add(member);
    }
  }

  return { declarations, sideEffects };
}

/**
 * @param {{ files: Map<string, string>, entry: string, audited: string[] }} input
 * @returns {{ reachableModules: Set<string>, unreachableExports: Array<{module: string, name: string, kind: string}>, live: Set<string> }}
 */
function analyzeReachability(input) {
  const parsed = new Map();
  for (const [moduleKey, text] of input.files) {
    parsed.set(moduleKey, {
      sourceFile: ts.createSourceFile(
        moduleKey,
        text,
        ts.ScriptTarget.Latest,
        true,
      ),
    });
  }

  for (const [moduleKey, entry] of parsed) {
    entry.exports = collectExports(entry.sourceFile);
    entry.reExports = collectReExports(moduleKey, entry.sourceFile);
    entry.imports = collectImports(moduleKey, entry.sourceFile);
    entry.edges = collectModuleEdges(moduleKey, entry.sourceFile);
    entry.facts = collectModuleFacts(entry.sourceFile);
  }

  const reachableModules = new Set();
  const queue = [input.entry];
  while (queue.length > 0) {
    const current = queue.shift();
    if (reachableModules.has(current) || !parsed.has(current)) {
      continue;
    }
    reachableModules.add(current);
    for (const edge of parsed.get(current).edges) {
      queue.push(edge);
    }
  }

  // `export { a } from "./x"` を辿って本来の宣言元へ寄せる
  const resolveOrigin = (moduleKey, name, seen = new Set()) => {
    const key = `${moduleKey}:${name}`;
    if (seen.has(key) || !parsed.has(moduleKey)) {
      return { module: moduleKey, name };
    }
    seen.add(key);
    const forwarded = parsed.get(moduleKey).reExports.get(name);
    if (!forwarded) {
      return { module: moduleKey, name };
    }
    return resolveOrigin(forwarded.module, forwarded.name, seen);
  };

  // 到達性は推移的に見る。互いを呼び合うだけの死んだクラスタを
  // 「自モジュール内で使われている」で通さない
  const live = new Set();
  const pending = [];
  const markLive = (moduleKey, name) => {
    const key = `${moduleKey}:${name}`;
    if (live.has(key)) {
      return;
    }
    live.add(key);
    pending.push({ module: moduleKey, name });
  };

  const follow = (moduleKey, refs) => {
    const entry = parsed.get(moduleKey);
    if (!entry) {
      return;
    }
    for (const name of refs.names) {
      if (entry.facts.declarations.has(name)) {
        markLive(moduleKey, name);
        continue;
      }
      const imported = entry.imports.find(
        (item) =>
          item.local === name &&
          item.imported !== "*" &&
          item.imported !== "default",
      );
      if (imported) {
        const origin = resolveOrigin(imported.module, imported.imported);
        markLive(origin.module, origin.name);
      }
    }
    for (const member of refs.members) {
      const separator = member.indexOf(".");
      const local = member.slice(0, separator);
      const property = member.slice(separator + 1);
      const namespaceImport = entry.imports.find(
        (item) => item.local === local && item.imported === "*",
      );
      if (namespaceImport) {
        markLive(namespaceImport.module, property);
      }
    }
  };

  // entry module の export は package.json の contract で VS Code が直接呼ぶ。
  // import された module の top-level 副作用と eager な初期化も起点になる
  for (const moduleKey of reachableModules) {
    const entry = parsed.get(moduleKey);
    if (moduleKey === input.entry) {
      for (const exported of entry.exports) {
        markLive(moduleKey, exported.name);
      }
    }
    follow(moduleKey, entry.facts.sideEffects);
    for (const declaration of entry.facts.declarations.values()) {
      if (declaration.eagerRefs) {
        follow(moduleKey, declaration.eagerRefs);
      }
    }
  }

  while (pending.length > 0) {
    const current = pending.shift();
    const entry = parsed.get(current.module);
    if (!entry || !reachableModules.has(current.module)) {
      continue;
    }
    const declaration = entry.facts.declarations.get(current.name);
    if (declaration) {
      follow(current.module, declaration.refs);
    }
  }

  const unreachableExports = [];
  for (const moduleKey of input.audited) {
    const entry = parsed.get(moduleKey);
    if (!entry) {
      continue;
    }
    for (const exported of entry.exports) {
      const key = `${moduleKey}:${exported.name}`;
      if (!reachableModules.has(moduleKey) || !live.has(key)) {
        unreachableExports.push({
          module: moduleKey,
          name: exported.name,
          kind: exported.kind,
        });
      }
    }
  }

  return { reachableModules, unreachableExports, live };
}

function readSrcModules() {
  const files = new Map();
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.set(
        entry.name,
        fs.readFileSync(path.join(srcDir, entry.name), "utf8"),
      );
    }
  }
  return files;
}

test("the detector separates real references from lookalikes", () => {
  const files = new Map([
    [
      "extension.ts",
      [
        'import { used, aliased } from "./helpers";',
        'import { unusedButImported } from "./helpers";',
        "export function activate() {",
        "  used();",
        "  const shorthand = { aliased };",
        "  return shorthand;",
        "}",
      ].join("\n"),
    ],
    [
      "helpers.ts",
      [
        "export function used() {}",
        "export function aliased() {}",
        "export function unusedButImported() {}",
        "// commentOnly is documented here but never called",
        "export function commentOnly() {}",
        'export const stringOnly = "stringOnly";',
        "export const declaredOnly = 1;",
        "export class NeverUsed {}",
        "export function selfUsed() {",
        "  return declaredOnlyHelper();",
        "}",
        "function declaredOnlyHelper() {",
        "  return selfUsed;",
        "}",
      ].join("\n"),
    ],
  ]);

  const result = analyzeReachability({
    files,
    entry: "extension.ts",
    audited: ["helpers.ts"],
  });

  const flagged = result.unreachableExports.map((item) => item.name).sort();
  assert.deepStrictEqual(flagged, [
    "NeverUsed",
    "commentOnly",
    "declaredOnly",
    "selfUsed",
    "stringOnly",
    "unusedButImported",
  ]);
});

test("a cluster that only references itself is still dead", () => {
  // 本番で見つけた形。互いを呼び合うだけの 2 つは到達していない
  const files = new Map([
    ["extension.ts", 'import { entry } from "./helpers";\nentry();'],
    [
      "helpers.ts",
      [
        "export function entry() {}",
        "export function ping() {",
        "  return pong();",
        "}",
        "export function pong() {",
        "  return ping();",
        "}",
      ].join("\n"),
    ],
  ]);

  const result = analyzeReachability({
    files,
    entry: "extension.ts",
    audited: ["helpers.ts"],
  });

  assert.deepStrictEqual(
    result.unreachableExports.map((item) => item.name).sort(),
    ["ping", "pong"],
  );
});

test("modules outside the extension entry graph do not vouch for exports", () => {
  const files = new Map([
    ["extension.ts", 'import { wired } from "./helpers";\nwired();'],
    ["helpers.ts", "export function wired() {}\nexport function orphan() {}"],
    ["detached.ts", 'import { orphan } from "./helpers";\norphan();'],
  ]);

  const result = analyzeReachability({
    files,
    entry: "extension.ts",
    audited: ["helpers.ts"],
  });

  assert.strictEqual(result.reachableModules.has("detached.ts"), false);
  assert.deepStrictEqual(
    result.unreachableExports.map((item) => item.name),
    ["orphan"],
  );
});

test("re-exported and aliased imports resolve back to the declaring module", () => {
  const files = new Map([
    [
      "extension.ts",
      'import { forwarded as renamed } from "./barrel";\nrenamed();',
    ],
    ["barrel.ts", 'export { forwarded } from "./helpers";'],
    ["helpers.ts", "export function forwarded() {}"],
  ]);

  const result = analyzeReachability({
    files,
    entry: "extension.ts",
    audited: ["helpers.ts"],
  });

  assert.deepStrictEqual(result.unreachableExports, []);
});

test("namespace imports count as references to the members they touch", () => {
  const files = new Map([
    [
      "extension.ts",
      'import * as helpers from "./helpers";\nhelpers.touched();',
    ],
    [
      "helpers.ts",
      "export function touched() {}\nexport function skipped() {}",
    ],
  ]);

  const result = analyzeReachability({
    files,
    entry: "extension.ts",
    audited: ["helpers.ts"],
  });

  assert.deepStrictEqual(
    result.unreachableExports.map((item) => item.name),
    ["skipped"],
  );
});

test("module-level work outside the entry module still seeds liveness", () => {
  // 起点を entry module だけにしまう mutation を止める。
  // import された module の top-level は load 時に実行される
  const files = new Map([
    ["extension.ts", 'import "./bootstrap";'],
    [
      "bootstrap.ts",
      [
        'import { registerSideEffect, eagerlyUsed } from "./helpers";',
        "registerSideEffect();",
        "const table = { handler: eagerlyUsed };",
        "export const registry = table;",
      ].join("\n"),
    ],
    [
      "helpers.ts",
      [
        "export function registerSideEffect() {}",
        "export function eagerlyUsed() {}",
        "export function neverTouched() {}",
      ].join("\n"),
    ],
  ]);

  const result = analyzeReachability({
    files,
    entry: "extension.ts",
    audited: ["helpers.ts"],
  });

  assert.deepStrictEqual(
    result.unreachableExports.map((item) => item.name),
    ["neverTouched"],
  );
});

test("a function-valued const is lazy, so its body does not seed liveness", () => {
  const files = new Map([
    ["extension.ts", 'import "./lazy";'],
    [
      "lazy.ts",
      [
        'import { onlyCalledFromDeadArrow } from "./helpers";',
        "export const unusedHandler = () => onlyCalledFromDeadArrow();",
      ].join("\n"),
    ],
    ["helpers.ts", "export function onlyCalledFromDeadArrow() {}"],
  ]);

  const result = analyzeReachability({
    files,
    entry: "extension.ts",
    audited: ["helpers.ts"],
  });

  assert.deepStrictEqual(
    result.unreachableExports.map((item) => item.name),
    ["onlyCalledFromDeadArrow"],
  );
});

test("a callback nested in an eager initializer is not treated as load-time work", () => {
  // initializer 自体は load 時に走るが、その中の callback 本体は走らない。
  // table が誰かに保持される場合は callback も呼ばれ得るので、ここは未保持のケース
  const files = new Map([
    ["extension.ts", 'import "./registry";'],
    [
      "registry.ts",
      [
        'import { runsAtLoad, onlyInsideCallback } from "./helpers";',
        "const table = { ready: runsAtLoad(), handler: () => onlyInsideCallback() };",
      ].join("\n"),
    ],
    [
      "helpers.ts",
      [
        "export function runsAtLoad() {}",
        "export function onlyInsideCallback() {}",
      ].join("\n"),
    ],
  ]);

  const result = analyzeReachability({
    files,
    entry: "extension.ts",
    audited: ["helpers.ts"],
  });

  assert.deepStrictEqual(
    result.unreachableExports.map((item) => item.name),
    ["onlyInsideCallback"],
  );
});

test("shipped helpers stay reachable from the extension entry graph", () => {
  const files = readSrcModules();
  assert.ok(files.has(ENTRY_MODULE), "src/extension.ts should exist");
  for (const moduleKey of AUDITED_MODULES) {
    assert.ok(files.has(moduleKey), `src/${moduleKey} should exist`);
  }

  const result = analyzeReachability({
    files,
    entry: ENTRY_MODULE,
    audited: AUDITED_MODULES,
  });

  const unexpected = result.unreachableExports.filter(
    (item) => !ALLOWED_UNREACHABLE.has(`${item.module}:${item.name}`),
  );
  assert.deepStrictEqual(
    unexpected.map((item) => `${item.module}:${item.name}`),
    [],
    "these exports are not referenced from the extension entry graph",
  );

  // allowlist が形骸化しないよう、理由付きの seam が実在することも確認する
  for (const key of ALLOWED_UNREACHABLE.keys()) {
    const [moduleKey, name] = key.split(":");
    assert.match(
      files.get(moduleKey) || "",
      new RegExp(`export (?:async )?function ${name}\\b`),
      `${key} is allowlisted but no longer exists`,
    );
  }
});

test("the real consumer graph is discovered without a hardcoded list", () => {
  const files = readSrcModules();
  const result = analyzeReachability({
    files,
    entry: ENTRY_MODULE,
    audited: AUDITED_MODULES,
  });

  // 以前は consumer 一覧の書き漏れで false positive を出した。
  // 直近の実例が shared-sources-manifest-store.ts なので、自動発見をここで固定する。
  assert.ok(
    result.reachableModules.has("shared-sources-manifest-store.ts"),
    "shared-sources-manifest-store.ts must be reached through the import graph",
  );
  assert.ok(
    result.live.has("shared-store-lock.ts:describeSharedStoreLockFailure"),
    "the shared store consumer must register as a reference",
  );
  assert.ok(
    result.reachableModules.size > 10,
    `expected the full module graph (found ${result.reachableModules.size})`,
  );

  const guardSource = fs.readFileSync(__filename, "utf8");
  assert.doesNotMatch(
    guardSource,
    /const consumers = \[/,
    "the guard must not reintroduce a manual consumer list",
  );
});

test("the guard fails when an audited module grows an unused export", () => {
  // 実コーパスで弁別性を確認する。src は変更せず、読み込んだ本文だけを汚す
  const files = readSrcModules();
  files.set(
    "githubResponse.ts",
    `${files.get("githubResponse.ts")}\nexport function neverWiredHelper(): boolean {\n  return true;\n}\n`,
  );

  const result = analyzeReachability({
    files,
    entry: ENTRY_MODULE,
    audited: AUDITED_MODULES,
  });

  assert.deepStrictEqual(
    result.unreachableExports
      .filter((item) => !ALLOWED_UNREACHABLE.has(`${item.module}:${item.name}`))
      .map((item) => `${item.module}:${item.name}`),
    ["githubResponse.ts:neverWiredHelper"],
    "an export nobody references must be reported",
  );
});

if (failures > 0) {
  console.error(`\n${failures} export reachability test(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("\nExport reachability tests passed.");
}
