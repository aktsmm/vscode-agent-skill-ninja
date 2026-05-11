#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);
const nls = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.nls.json"), "utf8"),
);
const nlsJa = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.nls.ja.json"), "utf8"),
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

function viewWelcomeItems() {
  return packageJson.contributes?.viewsWelcome || [];
}

function itemFor(viewId) {
  const item = viewWelcomeItems().find((entry) => entry.view === viewId);
  assert.ok(item, `Missing viewsWelcome item for ${viewId}`);
  return item;
}

function nlsKeyFor(item) {
  const match = item.contents.match(/^%([^%]+)%$/);
  assert.ok(
    match,
    `viewsWelcome contents should use NLS placeholder: ${item.view}`,
  );
  return match[1];
}

function localizedContent(viewId, locale = "en") {
  const key = nlsKeyFor(itemFor(viewId));
  const source = locale === "ja" ? nlsJa : nls;
  assert.ok(Object.hasOwn(source, key), `Missing ${locale} NLS key: ${key}`);
  return source[key];
}

function commandLinks(content) {
  return Array.from(
    content.matchAll(/\]\(command:([^)]+)\)/g),
    (match) => match[1],
  );
}

function contributedCommands() {
  return new Set(
    (packageJson.contributes?.commands || []).map((command) => command.command),
  );
}

function assertHasCommands(viewId, expectedCommands) {
  const links = commandLinks(localizedContent(viewId));
  for (const command of expectedCommands) {
    assert.ok(links.includes(command), `${viewId} should link ${command}`);
  }
}

const workspaceView = "skillNinja.installedView";
const userGlobalView = "skillNinja.userGlobalView";
const remoteView = "skillNinja.browseView";

test("every view has a welcome entry", () => {
  const views = new Set(
    packageJson.contributes.views["skill-ninja"].map((view) => view.id),
  );
  const welcomeViews = new Set(viewWelcomeItems().map((entry) => entry.view));
  for (const viewId of [workspaceView, userGlobalView, remoteView]) {
    assert.ok(views.has(viewId), `Missing contributed view: ${viewId}`);
    assert.ok(welcomeViews.has(viewId), `Missing welcome view: ${viewId}`);
  }
});

test("welcome entries use localized placeholders", () => {
  for (const item of viewWelcomeItems()) {
    assert.match(item.contents, /^%viewsWelcome\.[^%]+%$/);
  }
});

test("welcome command links resolve to contributed commands", () => {
  const commands = contributedCommands();
  for (const viewId of [workspaceView, userGlobalView, remoteView]) {
    for (const locale of ["en", "ja"]) {
      for (const command of commandLinks(localizedContent(viewId, locale))) {
        assert.ok(
          commands.has(command),
          `Unknown command link ${command} in ${viewId} ${locale}`,
        );
      }
    }
  }
});

test("workspace welcome links to search create and instruction file", () => {
  assertHasCommands(workspaceView, [
    "skillNinja.search",
    "skillNinja.createSkill",
    "skillNinja.openInstructionFile",
  ]);
});

test("user/global welcome links to create built-in toggle and settings", () => {
  assertHasCommands(userGlobalView, [
    "skillNinja.createSkill",
    "skillNinja.showBuiltInSkills",
    "skillNinja.openSettings",
  ]);
});

test("remote welcome links to search update index and add source", () => {
  assertHasCommands(remoteView, [
    "skillNinja.search",
    "skillNinja.updateIndex",
    "skillNinja.addSource",
  ]);
});

test("welcome text stays skill-oriented", () => {
  for (const viewId of [workspaceView, userGlobalView, remoteView]) {
    assert.doesNotMatch(localizedContent(viewId), /resource-ninja|resources/i);
    assert.doesNotMatch(
      localizedContent(viewId, "ja"),
      /Resource Ninja|リソース忍者/,
    );
  }
});

test("user/global welcome explains built-in skills are hidden by default", () => {
  assert.match(
    localizedContent(userGlobalView),
    /Built-in skills stay hidden until enabled/,
  );
  assert.match(
    localizedContent(userGlobalView, "ja"),
    /組み込みスキルは有効化するまで非表示/,
  );
});

test("welcome content stays compact for empty-state UI", () => {
  for (const viewId of [workspaceView, userGlobalView, remoteView]) {
    for (const locale of ["en", "ja"]) {
      const content = localizedContent(viewId, locale);
      assert.ok(
        content.length <= 320,
        `${viewId} ${locale} welcome content is too long`,
      );
      for (const line of content.split(/\r?\n/)) {
        assert.ok(
          line.length <= 120,
          `${viewId} ${locale} welcome line is too long: ${line}`,
        );
      }
    }
  }
});

console.log("RESULT=PASS");
