const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const source = {
  id: "host-customer-source",
  name: "Host Customer Fixture",
  url: "https://github.com/aktsmm/agent-skills",
  branch: "master",
  type: "community",
  description: "",
};
const previous = {
  owner: "aktsmm",
  repo: "agent-skills",
  ref: "master",
  remotePath: "customer-workspace",
  commitSha: "4d5219afc7d557b2bf2bfacf32820f9918d5fc03",
  contentSha: "9c37338a4a53e672bbe97b356b75ed77e2e14120",
  kind: "tree",
};

async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  assert.ok(response.ok, `Public fixture request failed (${response.status})`);
  return response;
}

async function tree(sha) {
  const response = await get(
    `https://api.github.com/repos/aktsmm/agent-skills/git/trees/${sha}?recursive=1`,
  );
  const value = await response.json();
  assert.equal(value.truncated, false);
  return value.tree.filter((entry) => entry.type === "blob");
}

exports.prepare = async (root, workspace) => {
  const directory = path.join(
    workspace,
    ".github",
    "skills",
    "customer-workspace",
  );
  fs.mkdirSync(directory, { recursive: true });
  const files = await tree(previous.contentSha);
  for (let offset = 0; offset < files.length; offset += 5) {
    await Promise.all(
      files.slice(offset, offset + 5).map(async (entry) => {
        assert.match(entry.mode, /^100(644|755)$/);
        assert.ok(
          entry.path
            .split("/")
            .every((part) => part && part !== ".." && !part.includes("\\")),
        );
        const response = await get(
          `https://raw.githubusercontent.com/aktsmm/agent-skills/${previous.commitSha}/customer-workspace/${entry.path}`,
        );
        const destination = path.join(directory, entry.path);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(
          destination,
          Buffer.from(await response.arrayBuffer()),
        );
      }),
    );
  }
  fs.writeFileSync(
    path.join(directory, ".skill-meta.json"),
    JSON.stringify({
      name: "customer-workspace",
      source: source.id,
      description: "Isolated upstream update fixture",
      categories: [],
      installedAt: "2026-01-01T00:00:00.000Z",
      relativePath: "customer-workspace",
      remotePath: "customer-workspace",
      sourceRevision: previous,
    }),
  );
  const storage = path.join(
    root,
    "user-data",
    "User",
    "globalStorage",
    "yamapan.agent-skill-ninja",
  );
  fs.mkdirSync(storage, { recursive: true });
  fs.writeFileSync(
    path.join(storage, "skill-index.json"),
    JSON.stringify({
      version: "1.0.0",
      lastUpdated: new Date().toISOString(),
      sources: [source],
      skills: [
        {
          name: "customer-workspace",
          source: source.id,
          path: "customer-workspace",
          description: "Isolated upstream update fixture",
          categories: [],
        },
      ],
      categories: [],
    }),
  );
  return directory;
};

exports.run = async (vscode, directory, language) => {
  const notifications = [];
  const output = [];
  const originalWarning = vscode.window.showWarningMessage;
  const originalInformation = vscode.window.showInformationMessage;
  const originalChannel = vscode.window.createOutputChannel;
  let confirmations = 0;
  vscode.window.showWarningMessage = (message, options, ...actions) => {
    notifications.push(message);
    if (options?.modal) {
      const expected =
        language === "ja" ? "変更分のみ更新" : "Update changed only";
      assert.ok(actions.includes(expected), "Unexpected mutation confirmation");
      confirmations++;
      return Promise.resolve(expected);
    }
    return originalWarning(message, options, ...actions);
  };
  vscode.window.showInformationMessage = (message, ...actions) => {
    notifications.push(message);
    return originalInformation(message, ...actions);
  };
  vscode.window.createOutputChannel = (name, ...options) => {
    const channel = originalChannel(name, ...options);
    if (name !== "Agent Skills Ninja Skill Updates") return channel;
    return new Proxy(channel, {
      get(target, key) {
        if (key === "appendLine")
          return (line) => {
            output.push(line);
            target.appendLine(line);
          };
        const value = target[key];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  try {
    const skillRoot = {
      scope: "workspace",
      rootPath: path.dirname(directory),
      rootUri: vscode.Uri.file(path.dirname(directory)),
      isManaged: true,
      isReadOnly: false,
    };
    const result = await vscode.commands.executeCommand(
      "skillNinja.updateRoot",
      { skillRoot },
    );
    assert.equal(result.updated, 1, JSON.stringify({ result, output }));
    assert.equal(result.updateFailed, 0);
    assert.equal(result.checkFailed, 0);
    assert.equal(confirmations, 1);
    assert.ok(
      notifications.some((message) =>
        message.includes(
          language === "ja"
            ? "更新したスキル: customer-workspace"
            : "Updated skills: customer-workspace",
        ),
      ),
    );
    assert.ok(output.some((line) => line.startsWith("customer-workspace (")));
    const metadata = JSON.parse(
      fs.readFileSync(path.join(directory, ".skill-meta.json"), "utf8"),
    );
    assert.notEqual(metadata.sourceRevision.contentSha, previous.contentSha);
    const expected = await tree(metadata.sourceRevision.contentSha);
    const files = (folder, prefix = "") =>
      fs
        .readdirSync(folder, { withFileTypes: true })
        .flatMap((entry) =>
          entry.isDirectory()
            ? files(path.join(folder, entry.name), `${prefix}${entry.name}/`)
            : [`${prefix}${entry.name}`],
        );
    assert.deepEqual(
      files(directory)
        .filter((file) => file !== ".skill-meta.json")
        .sort(),
      expected.map((entry) => entry.path).sort(),
    );
    for (const entry of expected) {
      const bytes = fs.readFileSync(path.join(directory, entry.path));
      const hash = crypto
        .createHash("sha1")
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex");
      assert.equal(hash, entry.sha, entry.path);
    }
    const again = await vscode.commands.executeCommand(
      "skillNinja.updateRoot",
      { skillRoot },
    );
    assert.equal(again.updated, 0);
    assert.equal(again.unchanged, 1);
    assert.equal(again.updateFailed, 0);
    assert.equal(confirmations, 1);
    assert.deepEqual(
      fs
        .readdirSync(path.dirname(directory))
        .filter((name) => name.startsWith(".skill-update-")),
      [],
    );
  } finally {
    vscode.window.showWarningMessage = originalWarning;
    vscode.window.showInformationMessage = originalInformation;
    vscode.window.createOutputChannel = originalChannel;
  }
};
