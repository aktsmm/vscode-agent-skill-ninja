#!/usr/bin/env node

// scripts/test-*.js を自動検出して全件実行する。
//
// 以前は package.json の `test` が `&&` チェーンだったため、
// 1 本落ちると以降が沈黙スキップされ、新しいテストを足しても
// チェーンへ追記し忘れると誰も実行しないままになっていた。
//
// 各 script は mkdtemp 配下でのみ書き込むので並列実行しても衝突しない。
// 直列だと 29 本のプロセス起動で 15 秒かかっていたため既定で並列化する。
// 出力が混ざらないよう子プロセスの stdio は貯めておき、失敗した分だけ後でまとめて出す。

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SCRIPTS_DIR = __dirname;

// 1 本のテストが固まっても集計まで進めるための上限
const PER_TEST_TIMEOUT_MS = 10 * 60 * 1000;

// SIGTERM を無視する子を待ち続けないための猶予
const KILL_GRACE_MS = 10 * 1000;

// 暴走出力で runner 自身が OOM しないための保持上限。失敗原因は末尾に出るので末尾を残す
const MAX_OUTPUT_CHARS = 1_000_000;

function resolveConcurrency() {
  const requested = Number(process.env.SKILL_NINJA_TEST_CONCURRENCY);
  if (Number.isFinite(requested) && requested >= 1) {
    return Math.floor(requested);
  }
  return Math.max(1, Math.min(os.cpus()?.length || 1, 8));
}

function discoverTestScripts() {
  return fs
    .readdirSync(SCRIPTS_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith("test-") &&
        entry.name.endsWith(".js"),
    )
    .map((entry) => entry.name)
    .sort();
}

function runScript(script) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [path.join(SCRIPTS_DIR, script)], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let truncated = false;
    let settled = false;
    let timedOut = false;
    let timer;
    let graceTimer;

    // setEncoding を使わずに chunk を文字列化すると、
    // マルチバイト文字が chunk 境界で分割されて置換文字になる
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const append = (text) => {
      output += text;
      if (output.length > MAX_OUTPUT_CHARS) {
        output = output.slice(-MAX_OUTPUT_CHARS);
        truncated = true;
      }
    };

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      resolve({
        script,
        output: truncated ? `[output truncated]\n${output}` : output,
        ms: Date.now() - startedAt,
        ...result,
      });
    };

    timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      // SIGTERM を無視する子や、pipe を握る孫が居ると close が来ない
      graceTimer = setTimeout(() => {
        child.kill("SIGKILL");
        finish({
          ok: false,
          reason: `timed out after ${PER_TEST_TIMEOUT_MS / 1000}s and did not exit`,
        });
      }, KILL_GRACE_MS);
    }, PER_TEST_TIMEOUT_MS);

    child.stdout.on("data", append);
    child.stderr.on("data", append);

    child.on("error", (error) => {
      finish({ ok: false, reason: `could not start: ${error.message}` });
    });

    child.on("close", (code, signal) => {
      if (timedOut) {
        finish({
          ok: false,
          reason: `timed out after ${PER_TEST_TIMEOUT_MS / 1000}s`,
        });
        return;
      }

      finish({
        ok: code === 0,
        reason:
          code === 0
            ? ""
            : signal
              ? `terminated by signal ${signal}`
              : `exit code ${code}`,
      });
    });
  });
}

async function runAll(scripts, concurrency) {
  const results = new Map();
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < scripts.length) {
      const script = scripts[nextIndex];
      nextIndex += 1;

      const result = await runScript(script);
      results.set(script, result);
      console.log(
        `${result.ok ? "PASS" : "FAIL"}  ${script} (${result.ms} ms)`,
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, scripts.length) }, worker),
  );

  return scripts.map((script) => results.get(script));
}

async function main() {
  const scripts = discoverTestScripts();

  if (scripts.length === 0) {
    console.error("No test scripts discovered under scripts/.");
    process.exitCode = 1;
    return;
  }

  const concurrency = resolveConcurrency();
  console.log(
    `DISCOVERED ${scripts.length} test script(s), concurrency ${concurrency}\n`,
  );

  const startedAt = Date.now();
  const results = await runAll(scripts, concurrency);
  const elapsedMs = Date.now() - startedAt;

  const failed = results.filter((result) => !result.ok);

  for (const result of failed) {
    console.error(`\n=== ${result.script} (${result.reason}) ===`);
    console.error(result.output.trimEnd());
  }

  console.log("\n========================================");
  console.log(`DISCOVERED ${scripts.length}`);
  console.log(`TOTAL      ${scripts.length}`);
  console.log(`PASSED     ${results.length - failed.length}`);
  console.log(`FAILED     ${failed.length}`);
  console.log(`ELAPSED    ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log("========================================");

  if (failed.length > 0) {
    console.error("\nFailed scripts:");
    for (const { script, reason } of failed) {
      console.error(`  - ${script} (${reason})`);
    }
    // process.exit だと非同期 stdout が flush 前に切られる
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
