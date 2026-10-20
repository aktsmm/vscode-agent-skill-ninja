/**
 * Browse view filter / sort behaviour (invocation mode, name, stars).
 * Run: node scripts/test-browse-view-options.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");
const { loadSrcModule } = require("./load-src-module");

const sourcePath = path.join(__dirname, "..", "src", "treeProvider.ts");
const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

const vscodeStub = {
  EventEmitter: class {
    event() {}
    fire() {}
  },
  TreeItem: class {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class {
    constructor(id, color) {
      this.id = id;
      this.color = color;
    }
  },
  ThemeColor: class {},
  Uri: { file: (filePath) => ({ fsPath: filePath }) },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
  },
};

let currentIndex;
// 既定ではワークスペースも導入済みスキルも無い。必要なテストだけが差し替える
let installedMetas = [];
let managedRoots = [];

function loadTreeProvider() {
  const moduleExports = {};
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    require(request) {
      switch (request) {
        case "vscode":
          return vscodeStub;
        case "./skillIndex":
          return {
            loadSkillIndex: async () => currentIndex,
            getLocalizedDescription: (skill) => skill.description,
          };
        case "./skillInstaller":
          return {
            getInstalledSkillsWithMeta: async (_workspace, rootUri) =>
              typeof installedMetas === "function"
                ? installedMetas(rootUri)
                : installedMetas,
          };
        case "./localSkillScanner":
          return { scanVisibleSkills: async () => [] };
        case "./i18n":
          return {
            isJapanese: () => false,
            messages: { sourceIndexNotIndexed: () => "not indexed" },
          };
        case "./skillPreview":
          return { getSkillId: (skill) => `${skill.source}/${skill.name}` };
        case "./skillLocations":
          return {
            normalizeFileSystemPath: (value) => String(value).toLowerCase(),
            getManagedSkillRoots: async () => managedRoots,
          };
        case "./installedSkillIndex":
          return {
            buildInstalledSkillKey: (skill) => `${skill.source}/${skill.name}`,
            shouldCheckInstalledSkillAgainstIndex: () => false,
          };
        case "./skillInvocation":
        case "./skillListOptions":
          return loadSrcModule(request);
        default:
          return require(request);
      }
    },
  };
  vm.runInNewContext(transpiled.outputText, sandbox, { filename: sourcePath });
  return sandbox.module.exports;
}

const { BrowseSkillsProvider, buildSkillRootGroups, setSkillViewOptions } =
  loadTreeProvider();

function makeIndex(withInvocationData = true) {
  const skill = (name, source, stars, invocation, extra = {}) => ({
    name,
    source,
    path: name,
    categories: [],
    description: `${name} description`,
    stars,
    ...(withInvocationData ? { invocation } : {}),
    ...extra,
  });
  return {
    version: "1",
    lastUpdated: "2026-10-20",
    categories: [],
    sources: [
      { id: "s1", name: "Source One", type: "official", lastIndexedAt: "x" },
      { id: "s2", name: "Source Two", type: "community", lastIndexedAt: "x" },
    ],
    bundles: [{ id: "b1", name: "Bundle", source: "s1", skills: ["a"] }],
    skills: [
      skill("a", "s1", 5, "auto"),
      skill("b", "s1", 10, "explicitOnly", { argumentHint: "[file]" }),
      skill("c", "s1", 1, "explicitOnly", { context: "fork" }),
      skill("d", "s2", 99, "auto"),
    ],
  };
}

function newProvider(index) {
  currentIndex = index;
  return new BrowseSkillsProvider({
    globalState: { get: (_key, fallback) => fallback },
  });
}

async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  } finally {
    setSkillViewOptions("browse", { filter: "all", sort: "default" });
  }
}

// vm サンドボックスの配列は realm が違い deepStrictEqual で弾かれるので、ホスト側の配列へ写す
const labels = (items) => Array.from(items, (item) => item.label);

async function sourceChildren(provider, sourceLabel) {
  const root = await provider.getChildren();
  const source = root.find((item) => item.label === sourceLabel);
  assert.ok(source, `${sourceLabel} should be listed`);
  return provider.getChildren(source);
}

async function main() {
  await run("without options the view keeps its original order", async () => {
    const provider = newProvider(makeIndex());
    const root = await provider.getChildren();
    assert.deepStrictEqual(labels(root), [
      "Source One",
      "Bundles",
      "Source Two",
    ]);
    const children = await sourceChildren(provider, "Source One");
    assert.deepStrictEqual(labels(children), ["a", "b", "c"]);
  });

  await run(
    "filtering by manual-only hides sources without a match",
    async () => {
      const provider = newProvider(makeIndex());
      setSkillViewOptions("browse", {
        filter: "explicitOnly",
        sort: "default",
      });

      const root = await provider.getChildren();
      // バンドルは単位で選ぶものなので、絞り込み中は出さない
      assert.deepStrictEqual(labels(root), ["Source One"]);
      assert.strictEqual(root[0].description, "2 / 3 skills");

      const children = await provider.getChildren(root[0]);
      assert.deepStrictEqual(labels(children), ["b", "c"]);
      assert.ok(children[0].description.startsWith("Manual only • "));
      assert.strictEqual(children[0].iconPath.id, "play-circle");
    },
  );

  await run("sorting by stars lists the most starred first", async () => {
    const provider = newProvider(makeIndex());
    setSkillViewOptions("browse", { filter: "all", sort: "stars" });
    const children = await sourceChildren(provider, "Source One");
    assert.deepStrictEqual(labels(children), ["b", "a", "c"]);
  });

  await run("sorting by name is alphabetical", async () => {
    const index = makeIndex();
    index.skills.reverse();
    const provider = newProvider(index);
    setSkillViewOptions("browse", { filter: "all", sort: "name" });
    const children = await sourceChildren(provider, "Source One");
    assert.deepStrictEqual(labels(children), ["a", "b", "c"]);
  });

  await run("the tooltip shows the usage hint and forked context", async () => {
    const provider = newProvider(makeIndex());
    const children = await sourceChildren(provider, "Source One");
    const byName = Object.fromEntries(
      children.map((item) => [item.label, item]),
    );
    assert.ok(byName.b.tooltip.includes("/b [file]"));
    assert.ok(byName.c.tooltip.includes("context: fork"));
    assert.ok(!byName.a.tooltip.includes("Usage"));
  });

  await run(
    "an index without invocation data explains why nothing matches",
    async () => {
      const provider = newProvider(makeIndex(false));
      setSkillViewOptions("browse", {
        filter: "explicitOnly",
        sort: "default",
      });
      const root = await provider.getChildren();
      assert.strictEqual(root.length, 1);
      assert.strictEqual(root[0].contextValue, "placeholder");
      assert.ok(root[0].label.includes("no invocation-mode data"));
    },
  );

  await run(
    "a filter with no match says so instead of showing an empty tree",
    async () => {
      const provider = newProvider(makeIndex());
      setSkillViewOptions("browse", { filter: "modelOnly", sort: "default" });
      const root = await provider.getChildren();
      assert.strictEqual(root.length, 1);
      assert.strictEqual(root[0].contextValue, "placeholder");
      assert.strictEqual(root[0].label, "No skills match the filter");
    },
  );
  await run(
    "installed views sort inside each root without mixing roots",
    async () => {
      const skill = (name, rootPath, invocation) => ({
        name,
        relativePath: `${name}/SKILL.md`,
        root: { rootPath },
        invocation,
      });
      const skills = [
        skill("zeta", "/root-b", "auto"),
        skill("beta", "/root-b", "explicitOnly"),
        skill("alpha", "/root-a", "auto"),
        skill("gamma", "/root-a", "modelOnly"),
        skill("delta", "/root-a", "explicitOnly"),
      ];
      const order = () =>
        Array.from(buildSkillRootGroups(skills), (group) =>
          Array.from(group.skills, (item) => item.name).join(","),
        );

      assert.deepStrictEqual(order(), ["alpha,delta,gamma", "beta,zeta"]);
      setSkillViewOptions("local", { filter: "all", sort: "invocation" });
      assert.deepStrictEqual(order(), ["delta,gamma,alpha", "beta,zeta"]);
      setSkillViewOptions("local", { filter: "all", sort: "name" });
      assert.deepStrictEqual(order(), ["alpha,delta,gamma", "beta,zeta"]);
      setSkillViewOptions("local", { filter: "all", sort: "default" });
    },
  );

  await run(
    "installed state is readable without opening the tree, by exact skill and by name",
    async () => {
      vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: "/ws" } }];
      managedRoots = [{ rootUri: { fsPath: "/ws/.github/skills" } }];
      // 導入時のフォルダ名は relativePath。スキル名（Code Review）とは別物になりうる
      installedMetas = [
        { name: "Review", source: "s1", relativePath: "review" },
        { name: "Code Review", source: "s1", relativePath: "code-review" },
        { name: "Nested", source: "s1", relativePath: "pack/nested" },
        { name: "Legacy Skill", source: "s1" },
      ];
      try {
        const provider = newProvider(makeIndex());
        // ツリーを開く前は、まだ何も読み込んでいない
        assert.strictEqual(provider.isInstallFolderTaken("review"), false);

        await provider.ensureInstalledSkillKeys();
        assert.strictEqual(
          provider.isSkillInstalled({ name: "Review", source: "s1" }),
          true,
        );
        // 同名の別ソースは「インストール済み」ではないが、フォルダは使われている
        assert.strictEqual(
          provider.isSkillInstalled({ name: "Review", source: "s2" }),
          false,
        );
        assert.strictEqual(provider.isInstallFolderTaken("review"), true);
        assert.strictEqual(provider.isInstallFolderTaken("REVIEW"), true);
        assert.strictEqual(provider.isInstallFolderTaken("other"), false);
        // フォルダ名で判定する。「Code Review」は code-review という場所を使っている
        assert.strictEqual(provider.isInstallFolderTaken("code-review"), true);
        assert.strictEqual(provider.isInstallFolderTaken("code review"), false);
        // 入れ子のスキル（pack/nested）は、最上位の nested というフォルダを使っていない
        assert.strictEqual(provider.isInstallFolderTaken("pack/nested"), true);
        assert.strictEqual(provider.isInstallFolderTaken("nested"), false);
        // relativePath が無い古いメタは、スキル名で代用する
        assert.strictEqual(provider.isInstallFolderTaken("legacy skill"), true);

        // 更新後は読み直す。古い名前を持ち越さない
        installedMetas = [];
        provider.refresh();
        await provider.ensureInstalledSkillKeys();
        assert.strictEqual(provider.isInstallFolderTaken("review"), false);

        // 上書きになるのは選んだ 1 つのルートだけ。別のルートにあるフォルダは衝突にしない
        const ws = "/ws/.github/skills";
        const userRoot = "/home/user/.copilot/skills";
        managedRoots = [
          { rootPath: ws, rootUri: { fsPath: ws } },
          { rootPath: userRoot, rootUri: { fsPath: userRoot } },
        ];
        installedMetas = async (rootUri) =>
          rootUri.fsPath === userRoot
            ? [{ name: "Review", source: "s1", relativePath: "review" }]
            : [{ name: "Own", source: "s1", relativePath: "own" }];
        const perRoot = newProvider(makeIndex());
        await perRoot.ensureInstalledSkillKeys();
        assert.strictEqual(
          perRoot.isInstallFolderTaken("review", userRoot),
          true,
        );
        assert.strictEqual(perRoot.isInstallFolderTaken("review", ws), false);
        assert.strictEqual(perRoot.isInstallFolderTaken("own", ws), true);
        assert.strictEqual(
          perRoot.isInstallFolderTaken("own", userRoot),
          false,
        );
        // ルートを指定しなければ、どのルートでも探す
        assert.strictEqual(perRoot.isInstallFolderTaken("review"), true);
        assert.strictEqual(perRoot.isInstallFolderTaken("missing"), false);
        // パスの大文字小文字や区切りの違いで取り違えない
        assert.strictEqual(
          perRoot.isInstallFolderTaken("review", userRoot.toUpperCase()),
          true,
        );

        installedMetas = [];
        managedRoots = [{ rootPath: ws, rootUri: { fsPath: ws } }];
        provider.refresh();
        await provider.ensureInstalledSkillKeys();
        assert.strictEqual(provider.isInstallFolderTaken("review"), false);
        // 2 つ目のルートだけ遅らせ、「1 つ目を読んだ時点で size > 0」の状態を作る
        managedRoots = [
          { rootUri: { fsPath: "/a" } },
          { rootUri: { fsPath: "/b" } },
        ];
        let releaseSlowRoot;
        const slowRootGate = new Promise((resolve) => {
          releaseSlowRoot = resolve;
        });
        installedMetas = async (rootUri) => {
          if (rootUri.fsPath === "/b") {
            await slowRootGate;
            return [{ name: "Slow", source: "s1" }];
          }
          return [{ name: "Fast", source: "s1" }];
        };
        const parallel = newProvider(makeIndex());
        const first = parallel.ensureInstalledSkillKeys();
        // 1 つ目のルートの読み込みが終わり、2 つ目で止まるまで進める
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.strictEqual(parallel.isInstallFolderTaken("fast"), true);
        assert.strictEqual(parallel.isInstallFolderTaken("slow"), false);

        let secondDone = false;
        const second = parallel.ensureInstalledSkillKeys().then(() => {
          secondDone = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.strictEqual(
          secondDone,
          false,
          "a concurrent caller must wait for the load, not read a partial set",
        );

        releaseSlowRoot();
        await Promise.all([first, second]);
        assert.strictEqual(secondDone, true);
        assert.strictEqual(parallel.isInstallFolderTaken("slow"), true);
      } finally {
        vscodeStub.workspace.workspaceFolders = undefined;
        managedRoots = [];
        installedMetas = [];
      }
    },
  );
}

main();
