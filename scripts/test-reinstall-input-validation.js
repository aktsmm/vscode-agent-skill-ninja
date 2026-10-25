#!/usr/bin/env node

// reinstallSkills の入力検証: フラグに見えるオプションの誤用を、文字分解ではなく明確なエラーにする。

const assert = require("assert");
const { loadSrcModule } = require("./load-src-module");

const { validateReinstallInput } = loadSrcModule("./skillReinstallPlan");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("valid entry ID arrays and absent options are accepted", () => {
  assert.strictEqual(validateReinstallInput({}), undefined);
  assert.strictEqual(
    validateReinstallInput({
      allowLocalEdits: ["home-copilot::a"],
      allowSourceSwitch: [],
      adopt: [{ entryId: "home-copilot::a", candidateId: "src::skills/a" }],
    }),
    undefined,
  );
});

test("a boolean or string is rejected with the expected shape, never split", () => {
  for (const field of ["allowLocalEdits", "allowSourceSwitch"]) {
    for (const bad of [true, false, "true", "home-copilot::a", 1, {}]) {
      const message = validateReinstallInput({ [field]: bad });
      assert.ok(message, `${field}=${JSON.stringify(bad)} must be rejected`);
      assert.ok(message.includes(`${field} must be an array of entry IDs`));
      assert.ok(!message.includes("t, r, u, e"));
    }
  }
});

test("array items must be non-empty strings", () => {
  assert.ok(validateReinstallInput({ allowLocalEdits: [true] }));
  assert.ok(validateReinstallInput({ allowLocalEdits: [""] }));
  assert.ok(validateReinstallInput({ allowSourceSwitch: [null] }));
});

test("adopt must be an array of entryId/candidateId objects", () => {
  assert.ok(validateReinstallInput({ adopt: "x" }));
  assert.ok(validateReinstallInput({ adopt: [{ entryId: "a" }] }));
  assert.ok(validateReinstallInput({ adopt: [null] }));
});
