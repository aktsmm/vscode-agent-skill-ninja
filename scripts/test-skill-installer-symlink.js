#!/usr/bin/env node

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

const { partitionGitHubDirectoryEntries, resolveSymlinkTargetPath } =
  requireTypeScriptModule(
    path.join(__dirname, "..", "src", "githubDirectoryTraversal.ts"),
  );

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function listFakeDirectory(tree, remotePath, visitedPaths = new Set()) {
  const normalizedPath = remotePath.replace(/^\/+|\/+$/g, "");
  if (visitedPaths.has(normalizedPath)) {
    throw new Error(`Symlink loop detected: ${normalizedPath}`);
  }
  visitedPaths.add(normalizedPath);

  let entry = tree[normalizedPath];
  if (!entry) {
    const symlinkPrefix = Object.keys(tree)
      .filter((candidatePath) => {
        const candidateEntry = tree[candidatePath];
        return (
          !Array.isArray(candidateEntry) &&
          candidateEntry.type === "symlink" &&
          normalizedPath.startsWith(`${candidatePath}/`)
        );
      })
      .sort((left, right) => right.length - left.length)[0];

    if (symlinkPrefix) {
      const candidateEntry = tree[symlinkPrefix];
      const suffix = normalizedPath.slice(symlinkPrefix.length + 1);
      const resolvedPrefix = resolveSymlinkTargetPath(
        symlinkPrefix,
        candidateEntry.target,
      );
      return listFakeDirectory(
        tree,
        `${resolvedPrefix}/${suffix}`,
        visitedPaths,
      );
    }
  }

  assert(entry, `Missing fake repository entry: ${normalizedPath}`);

  if (Array.isArray(entry)) {
    return entry;
  }

  if (entry.type === "symlink" && entry.target) {
    return listFakeDirectory(
      tree,
      resolveSymlinkTargetPath(normalizedPath, entry.target),
      visitedPaths,
    );
  }

  throw new Error(`Path is not a directory: ${normalizedPath}`);
}

function collectInstalledFiles(tree, remotePath, localPath, output = []) {
  const entries = listFakeDirectory(tree, remotePath);
  const { files, directoriesToTraverse } =
    partitionGitHubDirectoryEntries(entries);

  for (const entry of files) {
    output.push(path.posix.join(localPath, entry.name));
  }

  for (const entry of directoriesToTraverse) {
    collectInstalledFiles(
      tree,
      `${remotePath}/${entry.name}`,
      path.posix.join(localPath, entry.name),
      output,
    );
  }

  return output;
}

test("resolveSymlinkTargetPath handles parent segments and backslashes", () => {
  assert.strictEqual(
    resolveSymlinkTargetPath(
      "skills/example/linked-assets",
      "..\\shared-assets",
    ),
    "skills/shared-assets",
  );
});

test("partitionGitHubDirectoryEntries keeps symlink directories in traversal", () => {
  const { files, directoriesToTraverse } = partitionGitHubDirectoryEntries([
    { name: "SKILL.md", type: "file", download_url: "https://raw/skill" },
    { name: "docs", type: "dir", download_url: null },
    {
      name: "linked-assets",
      type: "symlink",
      download_url: "https://raw/linked-assets",
      target: "../shared-assets",
    },
    {
      name: "README.md",
      type: "file",
      download_url: "https://raw/readme",
      target: "../README.md",
    },
  ]);

  assert.deepStrictEqual(
    files.map((entry) => entry.name),
    ["SKILL.md", "README.md"],
  );
  assert.deepStrictEqual(
    directoriesToTraverse.map((entry) => entry.name),
    ["docs", "linked-assets"],
  );
});

test("recursive traversal installs files from symlinked directories", () => {
  const fakeTree = {
    "skills/example": [
      { name: "SKILL.md", type: "file", download_url: "https://raw/skill" },
      {
        name: "linked-assets",
        type: "symlink",
        download_url: "https://raw/linked-assets",
        target: "../shared-assets",
      },
    ],
    "skills/example/linked-assets": {
      name: "linked-assets",
      type: "symlink",
      download_url: "https://raw/linked-assets",
      target: "../shared-assets",
    },
    "skills/shared-assets": [
      {
        name: "reference.md",
        type: "file",
        download_url: "https://raw/reference",
      },
      { name: "nested", type: "dir", download_url: null },
    ],
    "skills/shared-assets/nested": [
      {
        name: "guide.md",
        type: "file",
        download_url: "https://raw/guide",
      },
    ],
  };

  const installedFiles = collectInstalledFiles(
    fakeTree,
    "skills/example",
    ".github/skills/example",
  );

  assert.deepStrictEqual(installedFiles.sort(), [
    ".github/skills/example/SKILL.md",
    ".github/skills/example/linked-assets/nested/guide.md",
    ".github/skills/example/linked-assets/reference.md",
  ]);
});

console.log("RESULT=PASS");
