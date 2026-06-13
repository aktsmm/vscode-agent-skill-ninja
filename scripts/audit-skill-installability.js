#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const indexPath = path.join(root, "resources", "skill-index.json");
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const APPLY = process.argv.includes("--apply");
const RAW_ONLY = process.argv.includes("--raw-only");
const SOURCE_FILTER = new Set(
  process.argv
    .filter((arg) => arg.startsWith("--sources="))
    .flatMap((arg) => arg.slice("--sources=".length).split(","))
    .map((value) => value.trim())
    .filter(Boolean),
);

const USER_AGENT = "Agent-Skill-Ninja-Audit";
const MAX_CONCURRENCY = 4;
const FETCH_TIMEOUT = 15000;

async function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeRepoUrl(repoUrl) {
  const trimmed = String(repoUrl || "")
    .trim()
    .replace(/[?#].*$/, "");
  const match = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)/i);
  if (!match) {
    return trimmed.replace(/\.git$/i, "").replace(/\/$/, "");
  }

  return `https://github.com/${match[1]}/${match[2].replace(/\.git$/i, "")}`;
}

function getRepoParts(repoUrl) {
  const normalized = normalizeRepoUrl(repoUrl);
  const match = normalized.match(/github\.com\/([^/]+)\/([^/]+)/i);
  if (!match) {
    return undefined;
  }

  return {
    owner: match[1],
    repo: match[2],
    normalized,
  };
}

function normalizeSkillPath(skillPath) {
  return String(skillPath || "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function buildHeaders(extraAccept) {
  const headers = {
    "User-Agent": USER_AGENT,
  };

  if (extraAccept) {
    headers.Accept = extraAccept;
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    headers.Authorization = `token ${token}`;
  }

  return headers;
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url, {
    headers: buildHeaders("application/vnd.github+json"),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.json();
}

async function fetchOk(url) {
  const response = await fetchWithTimeout(url, {
    method: "HEAD",
    headers: buildHeaders(),
  });

  if (response.ok) {
    return true;
  }

  if (response.status === 405) {
    const fallback = await fetchWithTimeout(url, {
      headers: buildHeaders(),
    });
    return fallback.ok;
  }

  return false;
}

async function resolveSourceBranches(sources) {
  const branchBySource = new Map();

  await mapWithConcurrency(sources, MAX_CONCURRENCY, async (source) => {
    if (source.branch) {
      branchBySource.set(source.id, source.branch);
      return;
    }

    const parts = getRepoParts(source.url);
    if (!parts) {
      throw new Error(`Invalid source URL: ${source.id} => ${source.url}`);
    }

    try {
      const repoInfo = await fetchJson(
        `https://api.github.com/repos/${parts.owner}/${parts.repo}`,
      );
      branchBySource.set(source.id, repoInfo.default_branch || "main");
    } catch (error) {
      console.warn(
        `[audit] Falling back to main for ${source.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      branchBySource.set(source.id, "main");
    }
  });

  return branchBySource;
}

async function fetchSourceTrees(sources, branchBySource) {
  const treeBySource = new Map();

  await mapWithConcurrency(sources, MAX_CONCURRENCY, async (source) => {
    const parts = getRepoParts(source.url);
    if (!parts) {
      throw new Error(`Invalid source URL: ${source.id} => ${source.url}`);
    }

    const branch = branchBySource.get(source.id) || "main";
    const tree = await fetchJson(
      `https://api.github.com/repos/${parts.owner}/${parts.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    );

    const blobs = new Set(
      (tree.tree || [])
        .filter((entry) => entry.type === "blob")
        .map((entry) => String(entry.path || "")),
    );

    treeBySource.set(source.id, {
      owner: parts.owner,
      repo: parts.repo,
      branch,
      blobs,
    });
  });

  return treeBySource;
}

async function auditSkillRaw(skill, sourceMap, branchBySource) {
  const remotePath = normalizeSkillPath(skill.path);
  if (!remotePath) {
    return {
      ok: false,
      reason: "empty path",
    };
  }

  const source = sourceMap.get(skill.source);
  if (!source) {
    return {
      ok: false,
      reason: `missing source: ${skill.source}`,
    };
  }

  const parts = getRepoParts(source.url);
  if (!parts) {
    return {
      ok: false,
      reason: `invalid source URL: ${source.url}`,
    };
  }

  const branch = branchBySource.get(skill.source) || source.branch || "main";
  const rawPath = remotePath.endsWith(".md")
    ? remotePath
    : `${remotePath}/SKILL.md`;
  const url = `https://raw.githubusercontent.com/${parts.owner}/${parts.repo}/${branch}/${rawPath}`;
  const ok = await fetchOk(url);

  if (!ok) {
    return {
      ok: false,
      reason: `missing raw path: ${rawPath}`,
    };
  }

  return { ok: true };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const queue = [...items];
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
    async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item === undefined) {
          return;
        }
        await mapper(item);
      }
    },
  );

  await Promise.all(workers);
}

function auditSkill(skill, sourceMap, treeBySource) {
  const remotePath = normalizeSkillPath(skill.path);
  if (!remotePath) {
    return {
      ok: false,
      reason: "empty path",
    };
  }

  const source = sourceMap.get(skill.source);
  if (!source) {
    return {
      ok: false,
      reason: `missing source: ${skill.source}`,
    };
  }

  const sourceTree = treeBySource.get(skill.source);
  if (!sourceTree) {
    return {
      ok: false,
      reason: `missing source tree: ${skill.source}`,
    };
  }

  if (remotePath.endsWith(".md")) {
    if (!sourceTree.blobs.has(remotePath)) {
      return {
        ok: false,
        reason: `missing file: ${remotePath}`,
      };
    }

    return { ok: true };
  }

  const expectedSkillMd = `${remotePath}/SKILL.md`;
  if (!sourceTree.blobs.has(expectedSkillMd)) {
    return {
      ok: false,
      reason: `missing SKILL.md: ${expectedSkillMd}`,
    };
  }

  return { ok: true };
}

function buildPrunedIndex(currentIndex, failures) {
  const failureKeys = new Set(
    failures.map((failure) =>
      JSON.stringify([failure.source, failure.name, failure.path]),
    ),
  );
  const prunedSkills = currentIndex.skills.filter(
    (skill) =>
      !failureKeys.has(JSON.stringify([skill.source, skill.name, skill.path])),
  );

  const versionParts = String(currentIndex.version || "1.0.0")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const nextVersion = [
    versionParts[0] || 1,
    (versionParts[1] || 0) + 1,
    0,
  ].join(".");

  return {
    nextIndex: {
      ...currentIndex,
      version: nextVersion,
      lastUpdated: new Date().toISOString().split("T")[0],
      skills: prunedSkills,
    },
    nextVersion,
    prunedSkills,
  };
}

async function main() {
  const sources =
    SOURCE_FILTER.size > 0
      ? index.sources.filter((source) => SOURCE_FILTER.has(source.id))
      : index.sources;
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const skills = index.skills.filter(
    (skill) => SOURCE_FILTER.size === 0 || SOURCE_FILTER.has(skill.source),
  );
  const branchBySource = await resolveSourceBranches(sources);
  const treeBySource = RAW_ONLY
    ? new Map()
    : await fetchSourceTrees(sources, branchBySource);

  const auditResults = [];
  await mapWithConcurrency(
    skills.map((skill, index) => ({ skill, index })),
    MAX_CONCURRENCY,
    async ({ skill, index }) => {
      const result = RAW_ONLY
        ? await auditSkillRaw(skill, sourceMap, branchBySource)
        : auditSkill(skill, sourceMap, treeBySource);
      auditResults.push({ skill, result, index });
    },
  );

  auditResults.sort((left, right) => left.index - right.index);

  const failures = [];
  const summary = new Map();

  for (const { skill, result } of auditResults) {
    const sourceSummary = summary.get(skill.source) || {
      total: 0,
      failed: 0,
    };
    sourceSummary.total += 1;
    if (!result.ok) {
      sourceSummary.failed += 1;
      failures.push({
        source: skill.source,
        name: skill.name,
        path: skill.path,
        reason: result.reason,
      });
    }
    summary.set(skill.source, sourceSummary);
  }

  console.log(
    `Audited ${skills.length} skills across ${sources.length} sources.${RAW_ONLY ? " (raw-only mode)" : ""}`,
  );

  for (const source of sources) {
    const item = summary.get(source.id) || { total: 0, failed: 0 };
    const branch = branchBySource.get(source.id) || source.branch || "main";
    console.log(
      `${source.id}: total=${item.total}, failed=${item.failed}, branch=${branch}`,
    );
  }

  if (failures.length > 0) {
    if (APPLY) {
      const { nextIndex, nextVersion, prunedSkills } = buildPrunedIndex(
        index,
        failures,
      );

      fs.writeFileSync(
        indexPath,
        JSON.stringify(nextIndex, null, 2) + "\n",
        "utf8",
      );

      console.error(
        `\nAPPLIED: pruned ${failures.length} uninstallable skills. New count: ${prunedSkills.length}. Skill Index version: v${nextVersion}`,
      );
      return;
    }

    console.error(
      `\nFAILED: ${failures.length} skill paths are not installable.`,
    );
    for (const failure of failures.slice(0, 50)) {
      console.error(
        `- ${failure.source} :: ${failure.name} :: ${failure.path} :: ${failure.reason}`,
      );
    }
    if (failures.length > 50) {
      console.error(`...and ${failures.length - 50} more`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("RESULT=PASS");
}

module.exports = {
  normalizeRepoUrl,
  getRepoParts,
  normalizeSkillPath,
  auditSkill,
  buildPrunedIndex,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}
