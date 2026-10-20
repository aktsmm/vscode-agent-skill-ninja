/**
 * Bulk install selection logic (Browse multi-select, checkbox picker, source row)
 * and the wiring guards that keep multi-select from breaking existing commands.
 * Run: node scripts/test-skill-bulk-selection.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { loadSrcModule } = require("./load-src-module");

const {
  BULK_INSTALL_LARGE_THRESHOLD,
  collectSkillsFromTreeArgs,
  isSkillRootLike,
  keepSelectable,
  listBulkCandidates,
  planBulkInstall,
} = loadSrcModule("./skillBulkSelection");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const skill = (name, source, extra = {}) => ({ name, source, ...extra });
const names = (list) => Array.from(list, (item) => item.name);

run("already installed skills are excluded and counted", () => {
  const installed = new Set(["s1::b"]);
  const plan = planBulkInstall(
    [skill("a", "s1"), skill("b", "s1"), skill("c", "s1")],
    (s) => installed.has(`${s.source}::${s.name}`),
  );
  assert.deepStrictEqual(names(plan.toInstall), ["a", "c"]);
  assert.strictEqual(plan.alreadyInstalled, 1);
  assert.strictEqual(plan.duplicates, 0);
  assert.strictEqual(plan.nameConflicts, 0);
});

run("the same skill passed twice is installed once", () => {
  const plan = planBulkInstall(
    [skill("a", "s1"), skill("a", "s1"), skill("b", "s1")],
    () => false,
  );
  assert.deepStrictEqual(names(plan.toInstall), ["a", "b"]);
  assert.strictEqual(plan.duplicates, 1);
});

run(
  "a same-name skill from another source would overwrite, so it is skipped",
  () => {
    const plan = planBulkInstall(
      [skill("review", "s1"), skill("Review", "s2"), skill("other", "s2")],
      () => false,
    );
    // 先に来た方を残す。大文字小文字だけの違いも同じディレクトリになる
    assert.deepStrictEqual(
      Array.from(plan.toInstall, (s) => `${s.source}/${s.name}`),
      ["s1/review", "s2/other"],
    );
    assert.strictEqual(plan.nameConflicts, 1);
  },
);

run(
  "an installed skill's folder blocks a candidate that would land in it",
  () => {
    const plan = planBulkInstall(
      [skill("x", "s1"), skill("x", "s2")],
      (s) => s.source === "s1",
      (folder) => folder === "x",
    );
    // s1/x は入っている。s2/x は同じフォルダに入るので、失敗させずに除く
    assert.deepStrictEqual(names(plan.toInstall), []);
    assert.strictEqual(plan.alreadyInstalled, 1);
    assert.strictEqual(plan.installedNameConflicts, 1);
  },
);

// 実装の `resolveSkillFolderName` と同じ規則（小文字化し、空白と記号をハイフンへ）
const folderOf = (s) =>
  s.name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[()[\]{}]/g, "")
    .replace(/[^a-z0-9\-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

run(
  "different names that map to the same install folder would overwrite, so the later one is skipped",
  () => {
    const plan = planBulkInstall(
      [
        skill("Code Review", "s1"),
        skill("code-review", "s1"),
        skill("code.review", "s2"),
        skill("code_review", "s1"),
      ],
      () => false,
      () => false,
      folderOf,
    );
    // code_review は別フォルダ（アンダースコアは残る）。残り 3 つは code-review に集まる
    assert.deepStrictEqual(names(plan.toInstall), [
      "Code Review",
      "code_review",
    ]);
    assert.strictEqual(plan.nameConflicts, 2);
  },
);

run(
  "a differently named skill that lands in an installed folder is skipped, not failed later",
  () => {
    const taken = new Set(["code-review"]);
    const plan = planBulkInstall(
      [skill("Code Review", "s2"), skill("other", "s2")],
      () => false,
      (folder) => taken.has(folder),
      folderOf,
    );
    assert.deepStrictEqual(names(plan.toInstall), ["other"]);
    assert.strictEqual(plan.installedNameConflicts, 1);
    assert.strictEqual(plan.nameConflicts, 0);
  },
);

run(
  "a same-name skill installed from another source is skipped, not failed later",
  () => {
    const installedNames = new Set(["review"]);
    const plan = planBulkInstall(
      [skill("Review", "s2"), skill("other", "s2")],
      () => false,
      (name) => installedNames.has(name.toLowerCase()),
    );
    assert.deepStrictEqual(names(plan.toInstall), ["other"]);
    assert.strictEqual(plan.installedNameConflicts, 1);
    assert.strictEqual(plan.alreadyInstalled, 0);
    assert.strictEqual(plan.nameConflicts, 0);
  },
);

run(
  "the exact installed skill counts as installed, not as a name conflict",
  () => {
    const plan = planBulkInstall(
      [skill("review", "s1")],
      (s) => s.source === "s1",
      () => true,
    );
    assert.strictEqual(plan.alreadyInstalled, 1);
    assert.strictEqual(plan.installedNameConflicts, 0);
  },
);

run("candidates follow the Browse filter and sort", () => {
  const all = [
    skill("c", "s1", { stars: 1, invocation: "auto" }),
    skill("a", "s1", { stars: 50, invocation: "explicitOnly" }),
    skill("b", "s2", { stars: 10, invocation: "explicitOnly" }),
  ];
  assert.deepStrictEqual(
    names(listBulkCandidates(all, { filter: "all", sort: "default" })),
    ["c", "a", "b"],
  );
  assert.deepStrictEqual(
    names(listBulkCandidates(all, { filter: "explicitOnly", sort: "name" })),
    ["a", "b"],
  );
  assert.deepStrictEqual(
    names(listBulkCandidates(all, { filter: "all", sort: "stars" })),
    ["a", "b", "c"],
  );
});

run("installed rows are dropped from a picker selection", () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepStrictEqual(
    Array.from(
      keepSelectable(items, (item) => item.id === 2),
      (i) => i.id,
    ),
    [1, 3],
  );
});

run("tree arguments yield only skill rows", () => {
  const row = (contextValue, extra = {}) => ({ contextValue, ...extra });
  const a = row("skill", { skill: skill("a", "s1") });
  const b = row("skill", { skill: skill("b", "s2") });
  const source = row("source", { source: { id: "s1" } });
  const noSkill = row("skill", {});

  // 選択配列があれば、クリックした行ではなく選択全体を使う
  assert.deepStrictEqual(
    names(collectSkillsFromTreeArgs(a, [a, b, source, noSkill])),
    ["a", "b"],
  );
  // 選択配列が無い・空なら、クリックした行だけ
  assert.deepStrictEqual(names(collectSkillsFromTreeArgs(a, undefined)), ["a"]);
  assert.deepStrictEqual(names(collectSkillsFromTreeArgs(a, [])), ["a"]);
  assert.deepStrictEqual(collectSkillsFromTreeArgs(source, [source]), []);
  assert.deepStrictEqual(collectSkillsFromTreeArgs(undefined, undefined), []);
  assert.deepStrictEqual(collectSkillsFromTreeArgs("x", [null, 1, "y"]), []);
});

run("a selection array is never taken for an install target root", () => {
  assert.strictEqual(
    isSkillRootLike({ rootPath: "/r", scope: "workspace" }),
    true,
  );
  assert.strictEqual(
    isSkillRootLike([{ rootPath: "/r", scope: "workspace" }]),
    false,
  );
  assert.strictEqual(isSkillRootLike([]), false);
  assert.strictEqual(isSkillRootLike(undefined), false);
  assert.strictEqual(isSkillRootLike({ rootPath: "/r" }), false);
});

run("the large-batch warning threshold is a sane positive number", () => {
  assert.ok(Number.isInteger(BULK_INSTALL_LARGE_THRESHOLD));
  assert.ok(
    BULK_INSTALL_LARGE_THRESHOLD >= 10 && BULK_INSTALL_LARGE_THRESHOLD <= 200,
  );
});

// 配線の取り違えは実行時まで出ないので、ソースの形で固定する
const root = path.join(__dirname, "..");
const extension = fs.readFileSync(
  path.join(root, "src", "extension.ts"),
  "utf8",
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);

run(
  "the picker drops installed rows both while selecting and on accept",
  () => {
    // QuickPick は項目を無効化できない。選択イベントと確定の両方で外さないと、インストール済みが紛れ込む
    const start = extension.indexOf('"skillNinja.installMultiple"');
    assert.ok(start >= 0, "installMultiple handler not found");
    const handler = extension.slice(start, start + 6000);
    const changeAt = handler.indexOf("onDidChangeSelection");
    const acceptAt = handler.indexOf("onDidAccept");
    assert.ok(changeAt >= 0 && acceptAt >= 0, "picker events must be wired");
    assert.ok(
      /onDidChangeSelection[\s\S]*?keepSelectable[\s\S]*?onDidAccept/.test(
        handler,
      ),
      "selection changes must drop installed rows",
    );
    assert.ok(
      /onDidAccept[\s\S]*?keepSelectable/.test(handler.slice(acceptAt)),
      "accept must drop installed rows again",
    );
    // 何も選ばずに確定したときは、無反応にせず案内する
    assert.ok(
      /installMultipleNoneSelected/.test(handler),
      "an empty accept must tell the user nothing was selected",
    );
  },
);

run(
  "the plan is driven by the real install-folder resolver, not the raw name",
  () => {
    // フォルダ名は resolveSkillFolderName で決まる。生の名前で比べると、名前が違っても同じフォルダに入るものを見逃し、黙って上書きする
    const start = extension.indexOf("async function installSkillsBulk(");
    assert.ok(start >= 0, "runSkillsBulkInstall not found");
    const body = extension.slice(start, start + 2500);
    assert.ok(
      /planBulkInstall\([\s\S]*?isInstallFolderTaken[\s\S]*?resolveSkillFolderName\(/.test(
        body,
      ),
      "planBulkInstall must receive the folder-taken check and resolveSkillFolderName",
    );
    assert.ok(
      /from "\.\/skillInstaller"/.test(extension) &&
        /resolveSkillFolderName,/.test(extension),
      "resolveSkillFolderName must come from the installer, the single source of the folder rule",
    );
  },
);

run(
  "a second bulk install cannot start while one is active, and the flag always clears",
  () => {
    const start = extension.indexOf("async function installSkillsBulk(");
    assert.ok(start >= 0, "installSkillsBulk not found");
    const body = extension.slice(start, start + 900);
    assert.ok(
      /if \(bulkInstallActive\)[\s\S]*?bulkInstallBusy[\s\S]*?return;/.test(
        body,
      ),
      "a re-entrant call must be told to wait, not run in parallel",
    );
    assert.ok(
      /bulkInstallActive = true;\s*try \{[\s\S]*?\} finally \{\s*bulkInstallActive = false;/.test(
        body,
      ),
      "the flag must be cleared in a finally so a failure cannot lock bulk install for the session",
    );
  },
);

run("bulk progress and summary use a noun label, not the command title", () => {
  const labels = [
    ...extension.matchAll(
      /installSkillsBulk\(bulkInstallDeps,\s*\{[\s\S]*?label:\s*([^,\n]+)/g,
    ),
  ].map((match) => match[1].trim());
  assert.strictEqual(
    labels.length,
    3,
    "all three entry points must pass a label",
  );
  assert.ok(
    !labels.some((label) => /installMultipleTitle/.test(label)),
    "the command title would read 'Installing Install Multiple Skills...'",
  );
});

run("the Browse tree allows multi-select", () => {
  assert.ok(
    /createTreeView\("skillNinja\.browseView",\s*\{[^}]*canSelectMany:\s*true/.test(
      extension,
    ),
    "Browse must be created with canSelectMany: true",
  );
});

run(
  "only the Browse tree is multi-select, so other views keep their arguments",
  () => {
    for (const view of ["installedView", "userGlobalView"]) {
      const match = extension.match(
        new RegExp(
          `createTreeView\\(\\s*"skillNinja\\.${view}",\\s*\\{[^}]*\\}`,
        ),
      );
      assert.ok(match, `${view} tree creation not found`);
      assert.ok(
        !/canSelectMany/.test(match[0]),
        `${view} must stay single-select`,
      );
    }
  },
);

run(
  "Install Skill ignores a selection array passed as the second argument",
  () => {
    assert.ok(
      /isSkillRootLike\(explicitTargetRoot\)/.test(extension),
      "skillNinja.install must validate its explicit target root",
    );
    assert.ok(
      !/explicitTargetRoot\s*\|\|\s*\(await resolveInstallTargetRoot/.test(
        extension,
      ),
      "the raw second argument must not be used as the install target",
    );
  },
);

run(
  "every Browse context-menu command that takes a second parameter is guarded",
  () => {
    const menus = manifest.contributes.menus["view/item/context"].filter(
      (entry) => /browseView/.test(entry.when),
    );
    for (const { command } of menus) {
      const at = extension.indexOf(`"${command}",`);
      assert.ok(at >= 0, `${command} handler not found`);
      const handlerHead = extension.slice(at, at + 400);
      const params = handlerHead.match(/async\s*\(([^)]*)\)/);
      if (!params) {
        continue;
      }
      const count = params[1].split(",").filter((part) => part.trim()).length;
      if (count > 1) {
        // 第 2 引数を持つのは、選択配列を受け取る一括コマンドか、検証済みの install だけ
        assert.ok(
          command === "skillNinja.install" ||
            command === "skillNinja.installSelectedSkills",
          `${command} takes a second parameter and would receive the selection array`,
        );
      }
    }
  },
);

run(
  "the three install entry points are declared and hidden from the palette where item-bound",
  () => {
    const commands = new Set(
      manifest.contributes.commands.map((c) => c.command),
    );
    const palette = manifest.contributes.menus.commandPalette;
    for (const id of [
      "installMultiple",
      "installSelectedSkills",
      "installSourceSkills",
    ]) {
      assert.ok(commands.has(`skillNinja.${id}`), id);
    }
    const hidden = (id) =>
      palette.some(
        (entry) =>
          entry.command === `skillNinja.${id}` && entry.when === "false",
      );
    assert.strictEqual(hidden("installMultiple"), false);
    assert.strictEqual(hidden("installSelectedSkills"), true);
    assert.strictEqual(hidden("installSourceSkills"), true);

    const contextMenus = manifest.contributes.menus["view/item/context"];
    const selected = contextMenus.find(
      (e) => e.command === "skillNinja.installSelectedSkills",
    );
    assert.ok(/viewItem == skill/.test(selected.when));
    assert.ok(
      /listMultiSelection/.test(selected.when),
      "show it only for a multi-selection",
    );
    const sourceEntry = contextMenus.find(
      (e) => e.command === "skillNinja.installSourceSkills",
    );
    assert.ok(/viewItem == source/.test(sourceEntry.when));
  },
);

console.log("\nBulk selection tests passed.");
