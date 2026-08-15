#!/usr/bin/env node

// symlink / junction を跨いだ書き込み・削除の封じ込めを、実ファイルシステムで検証する。
//
// 文字列比較だけの封じ込めは、スキルルート配下に作られたリンクがルート外を
// 指していると通ってしまう。ここでは実際にリンクを作って判定を確認する。

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadSrcModule } = require("./load-src-module.js");

const { isRealPathStrictlyInside, isStrictlyInsidePath } =
  loadSrcModule("./pathSafety");

let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(`  ${error.stack || error.message}`);
  }
}

function withTempTree(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "skill-ninja-link-"));
  try {
    return fn(base);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

/** Windows では junction、それ以外では symlink を使う（どちらも管理者権限不要） */
function linkDirectory(target, linkPath) {
  fs.symlinkSync(
    target,
    linkPath,
    process.platform === "win32" ? "junction" : "dir",
  );
}

function main() {
  test("a plain folder under the root is allowed", () => {
    withTempTree((base) => {
      const root = path.join(base, "skills");
      const skill = path.join(root, "demo");
      fs.mkdirSync(skill, { recursive: true });

      assert.strictEqual(isRealPathStrictlyInside(root, skill), true);
    });
  });

  test("a not-yet-created folder under the root is allowed", () => {
    withTempTree((base) => {
      const root = path.join(base, "skills");
      fs.mkdirSync(root, { recursive: true });

      assert.strictEqual(
        isRealPathStrictlyInside(root, path.join(root, "new-skill")),
        true,
      );
    });
  });

  test("a link inside the root that escapes it is rejected", () => {
    withTempTree((base) => {
      const root = path.join(base, "skills");
      const outside = path.join(base, "outside");
      fs.mkdirSync(root, { recursive: true });
      fs.mkdirSync(outside, { recursive: true });

      const escaping = path.join(root, "escaping");
      linkDirectory(outside, escaping);

      // 文字列判定はルート配下に見えるので通ってしまう
      assert.strictEqual(isStrictlyInsidePath(root, escaping), true);
      assert.strictEqual(
        isRealPathStrictlyInside(root, escaping),
        false,
        "a junction pointing outside the root must be refused",
      );
    });
  });

  test("a child of an escaping link is rejected", () => {
    withTempTree((base) => {
      const root = path.join(base, "skills");
      const outside = path.join(base, "outside");
      fs.mkdirSync(root, { recursive: true });
      fs.mkdirSync(path.join(outside, "nested"), { recursive: true });

      linkDirectory(outside, path.join(root, "escaping"));

      assert.strictEqual(
        isRealPathStrictlyInside(root, path.join(root, "escaping", "nested")),
        false,
      );
      assert.strictEqual(
        isRealPathStrictlyInside(
          root,
          path.join(root, "escaping", "does-not-exist-yet"),
        ),
        false,
        "an unresolved leaf under an escaping link must also be refused",
      );
    });
  });

  test("a link that stays inside the root is allowed", () => {
    withTempTree((base) => {
      const root = path.join(base, "skills");
      const real = path.join(root, "real");
      fs.mkdirSync(real, { recursive: true });

      const inner = path.join(root, "alias");
      linkDirectory(real, inner);

      assert.strictEqual(isRealPathStrictlyInside(root, inner), true);
    });
  });

  test("a dangling link pointing outside is rejected", () => {
    withTempTree((base) => {
      const root = path.join(base, "skills");
      fs.mkdirSync(root, { recursive: true });

      // ターゲットをまだ作らない。存在判定を通ると未作成パス扱いで許可されてしまう
      const dangling = path.join(root, "demo");
      linkDirectory(path.join(base, "outside"), dangling);

      assert.strictEqual(
        isRealPathStrictlyInside(root, dangling),
        false,
        "a broken link must not be treated as an unused path name",
      );
      assert.strictEqual(
        isRealPathStrictlyInside(root, path.join(dangling, "child")),
        false,
      );
    });
  });

  test("an intermediate link is rejected even when the leaf is new", () => {
    withTempTree((base) => {
      const root = path.join(base, "skills");
      const outside = path.join(base, "outside");
      fs.mkdirSync(path.join(root, "demo"), { recursive: true });
      fs.mkdirSync(outside, { recursive: true });

      linkDirectory(outside, path.join(root, "demo", "assets"));

      assert.strictEqual(
        isRealPathStrictlyInside(
          root,
          path.join(root, "demo", "assets", "new-file.md"),
        ),
        false,
        "a link in the middle of the path must be resolved too",
      );
    });
  });

  test("the root itself is never strictly inside", () => {
    withTempTree((base) => {
      const root = path.join(base, "skills");
      fs.mkdirSync(root, { recursive: true });

      assert.strictEqual(isRealPathStrictlyInside(root, root), false);
    });
  });

  test("a linked root still accepts its own children", () => {
    withTempTree((base) => {
      const realRoot = path.join(base, "real-skills");
      fs.mkdirSync(path.join(realRoot, "demo"), { recursive: true });

      const linkedRoot = path.join(base, "linked-skills");
      linkDirectory(realRoot, linkedRoot);

      assert.strictEqual(
        isRealPathStrictlyInside(linkedRoot, path.join(linkedRoot, "demo")),
        true,
        "a workspace reached through a link must keep working",
      );
    });
  });

  test("the installer enforces real-path containment before deleting", () => {
    const installerSource = fs.readFileSync(
      path.join(__dirname, "..", "src", "skillInstaller.ts"),
      "utf8",
    );
    const start = installerSource.indexOf(
      "async function deleteSkillDirectory(",
    );
    const body = installerSource.slice(
      start,
      installerSource.indexOf("\n}", start),
    );

    assert.ok(
      body.includes("isRealPathStrictlyInside"),
      "recursive delete must resolve links before trusting the path",
    );
  });

  test("only user-owned deletes go to the trash", () => {
    const installerSource = fs.readFileSync(
      path.join(__dirname, "..", "src", "skillInstaller.ts"),
      "utf8",
    );

    const readFunctionBody = (signature) => {
      const start = installerSource.indexOf(signature);
      assert.notStrictEqual(start, -1, `missing ${signature}`);
      return installerSource.slice(
        start,
        installerSource.indexOf("\n}", start),
      );
    };

    assert.ok(
      /deleteSkillDirectory\([\s\S]{0,200}?options:\s*\{\s*useTrash:\s*boolean\s*\}\s*=\s*\{\s*useTrash:\s*false\s*\}/.test(
        installerSource,
      ),
      "the helper must default to a permanent delete so every trash use is explicit",
    );

    for (const signature of [
      "export async function uninstallSkill(",
      "export async function uninstallSkillByPath(",
    ]) {
      assert.ok(
        /deleteSkillDirectory\([^)]*useTrash:\s*true/s.test(
          readFunctionBody(signature),
        ),
        `${signature} must delete via the trash so a failed reinstall stays recoverable`,
      );
    }

    // 上書きインストールの置き換えも、ユーザーの唯一のコピーを消しうる
    assert.ok(
      /if \(replaceExisting\) \{[\s\S]{0,300}?deleteSkillDirectory\([^;]*useTrash: true/.test(
        installerSource,
      ),
      "replacing an existing install must go through the trash",
    );

    // 未完了ダウンロードの後片付けは、既存フォルダへ上書きしていたときだけごみ箱へ送る
    for (const [signature, expected] of [
      ["async function handleSkillNotFound(", "useTrash: cleanupUsesTrash"],
      [
        "async function reportInstallResult(",
        "useTrash: options.cleanupUsesTrash",
      ],
    ]) {
      const body = readFunctionBody(signature);
      assert.ok(
        body.includes(expected),
        `${signature} must pass through the pre-existing-folder flag, not a constant`,
      );
      assert.ok(
        !/useTrash:\s*(true|false)/.test(body),
        `${signature} must not hardcode the deletion method`,
      );
    }
  });
}

main();
if (failures > 0) {
  process.exitCode = 1;
}
