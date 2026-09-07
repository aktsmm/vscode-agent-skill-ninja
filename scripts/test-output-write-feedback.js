const assert = require("node:assert/strict");
const { loadSrcModule } = require("./load-src-module");
const { createOutputWriteFeedback, summarizeOutputWrites } = loadSrcModule(
  "./outputWriteFeedback",
);

async function main() {
  const warnings = [];
  const logs = [];
  let details = 0;
  const feedback = createOutputWriteFeedback({
    log: (key, result) => logs.push({ key, result }),
    detailsAction: () => "Details",
    warn: (action) => {
      warnings.push(action);
      return Promise.resolve(action);
    },
    showDetails: () => {
      details++;
    },
  });
  for (const result of ["updated", "unchanged", "disabled", "deferred"]) {
    feedback.record("one", result);
  }
  assert.equal(warnings.length, 0);
  feedback.record("one", "unreadable");
  feedback.record("one", "unreadable");
  assert.equal(warnings.length, 1);
  feedback.record("one", "locked");
  assert.equal(warnings.length, 2);
  feedback.record("one", "unchanged");
  feedback.record("one", "locked");
  assert.equal(warnings.length, 3);
  feedback.reset();
  feedback.record("one", "locked");
  assert.equal(warnings.length, 4);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(details, 4);
  assert.deepEqual(
    {
      ...summarizeOutputWrites([
        "updated",
        "unchanged",
        "disabled",
        "deferred",
        "unreadable",
        "locked",
        "failed",
      ]),
    },
    { updated: 1, unchanged: 1, disabled: 1, deferred: 1, blocked: 3 },
  );
  const pending = createOutputWriteFeedback({
    log() {},
    detailsAction: () => "Details",
    warn: () => new Promise(() => {}),
    showDetails() {},
  });
  assert.equal(pending.record("two", "failed"), undefined);
  assert.equal(logs[0].result, "unreadable");
  console.log(
    "PASS output failure feedback is bounded, recoverable, result-aware and non-blocking",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
