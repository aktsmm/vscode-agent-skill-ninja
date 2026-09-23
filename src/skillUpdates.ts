import { fetchGitHubWithOptionalAuthRetry } from "./githubFetch";
import {
  createGitHubResponseError,
  GitHubResponseError,
  isGitHubResponseError,
} from "./githubResponse";

export interface SkillSourceRevision {
  owner: string;
  repo: string;
  ref: string;
  remotePath: string;
  commitSha: string;
  contentSha: string;
  kind: "tree" | "blob";
}

export interface SkillDownloadTarget {
  owner: string;
  repo: string;
  branch: string;
  remotePath: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha(value: unknown): value is string {
  return typeof value === "string" && /^[a-fA-F0-9]{40}$/.test(value);
}

function segment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9_.-]+$/.test(value) &&
    value !== "." &&
    value !== ".."
  );
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function remotePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (value === "" ||
      (!hasControlCharacters(value) &&
        !/[\\%:*?"<>|]/.test(value) &&
        value
          .split("/")
          .every(
            (part) =>
              part !== "" &&
              part !== "." &&
              part !== ".." &&
              !/[. ]$/.test(part),
          )))
  );
}

function ref(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value !== "." &&
    value !== ".." &&
    !hasControlCharacters(value)
  );
}

function revision(value: unknown): value is SkillSourceRevision {
  return (
    record(value) &&
    segment(value.owner) &&
    segment(value.repo) &&
    ref(value.ref) &&
    remotePath(value.remotePath) &&
    sha(value.commitSha) &&
    sha(value.contentSha) &&
    (value.kind === "tree" ||
      (value.kind === "blob" && /\.md$/i.test(value.remotePath)))
  );
}

function failure(): Error {
  return new Error("Unable to resolve skill source revision.");
}

export class SkillSourcePathMissingError extends Error {
  constructor() {
    super("Skill source path no longer exists.");
    this.name = "SkillSourcePathMissingError";
  }
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Skill source revision request cancelled.");
    error.name = "AbortError";
    throw error;
  }
}

interface TreeEntry {
  path: string;
  sha: string;
  type: "tree" | "blob" | "commit";
}

interface Tree {
  entries: TreeEntry[];
  truncated: boolean;
}

function parseTree(
  value: unknown,
  expectedSha: string,
  recursive: boolean,
): Tree {
  if (
    !record(value) ||
    !sha(value.sha) ||
    value.sha.toLowerCase() !== expectedSha ||
    typeof value.truncated !== "boolean" ||
    !Array.isArray(value.tree)
  ) {
    throw failure();
  }
  const paths = new Set<string>();
  const entries: TreeEntry[] = value.tree.map((entry: unknown) => {
    if (
      !record(entry) ||
      !remotePath(entry.path) ||
      !entry.path ||
      (!recursive && entry.path.includes("/")) ||
      !sha(entry.sha) ||
      (entry.type !== "tree" &&
        entry.type !== "blob" &&
        entry.type !== "commit") ||
      paths.has(entry.path) ||
      (entry.type === "tree" && entry.mode !== "040000") ||
      (entry.type === "blob" &&
        entry.mode !== "100644" &&
        entry.mode !== "100755" &&
        entry.mode !== "120000") ||
      (entry.type === "commit" && entry.mode !== "160000")
    ) {
      throw failure();
    }
    paths.add(entry.path);
    return {
      path: entry.path,
      sha: entry.sha.toLowerCase(),
      type: entry.type as TreeEntry["type"],
    };
  });
  return { entries, truncated: value.truncated };
}

export function createSkillRevisionResolver(
  token?: string,
  signal?: AbortSignal,
  request: typeof fetchGitHubWithOptionalAuthRetry = fetchGitHubWithOptionalAuthRetry,
): (target: SkillDownloadTarget) => Promise<SkillSourceRevision> {
  const snapshots = new Map<
    string,
    Promise<{ commitSha: string; rootSha: string; tree: Tree }>
  >();
  const trees = new Map<string, Promise<Tree>>();

  async function json(url: string): Promise<unknown> {
    assertActive(signal);
    const response = await request(url, {
      accept: "application/vnd.github.v3+json",
      token,
      retry: { signal },
    });
    assertActive(signal);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw createGitHubResponseError(response, body, "Skill revision check");
    }
    const value: unknown = await response.json();
    assertActive(signal);
    return value;
  }

  function tree(
    base: string,
    treeSha: string,
    recursive: boolean,
  ): Promise<Tree> {
    const url = `${base}/git/trees/${treeSha}${recursive ? "?recursive=1" : ""}`;
    let pending = trees.get(url);
    if (!pending) {
      pending = json(url).then((value) => parseTree(value, treeSha, recursive));
      trees.set(url, pending);
    }
    return pending;
  }

  return async (target) => {
    try {
      assertActive(signal);
      if (
        !record(target) ||
        !segment(target.owner) ||
        !segment(target.repo) ||
        !ref(target.branch) ||
        !remotePath(target.remotePath)
      ) {
        throw failure();
      }
      const owner = target.owner.toLowerCase();
      const repo = target.repo.toLowerCase();
      const base = `https://api.github.com/repos/${owner}/${repo}`;
      const key = `${base}/commits/${encodeURIComponent(target.branch)}`;
      let snapshot = snapshots.get(key);
      if (!snapshot) {
        snapshot = (async () => {
          const commit = await json(key);
          if (
            !record(commit) ||
            !sha(commit.sha) ||
            !record(commit.commit) ||
            !record(commit.commit.tree) ||
            !sha(commit.commit.tree.sha)
          ) {
            throw failure();
          }
          const rootSha = commit.commit.tree.sha.toLowerCase();
          return {
            commitSha: commit.sha.toLowerCase(),
            rootSha,
            tree: await tree(base, rootSha, true),
          };
        })();
        snapshots.set(key, snapshot);
      }
      const current = await snapshot;
      assertActive(signal);
      let selected: TreeEntry | undefined =
        target.remotePath === ""
          ? { path: "", sha: current.rootSha, type: "tree" }
          : undefined;
      if (target.remotePath && current.tree.truncated) {
        let parentSha = current.rootSha;
        const parts = target.remotePath.split("/");
        for (const [index, part] of parts.entries()) {
          const parent = await tree(base, parentSha, false);
          if (parent.truncated) {
            throw failure();
          }
          selected = parent.entries.find((entry) => entry.path === part);
          if (!selected) {
            throw new SkillSourcePathMissingError();
          }
          if (index < parts.length - 1 && selected.type !== "tree") {
            throw failure();
          }
          parentSha = selected.sha;
        }
      } else if (target.remotePath) {
        selected = current.tree.entries.find(
          (entry) => entry.path === target.remotePath,
        );
      }
      assertActive(signal);
      if (!selected) {
        throw new SkillSourcePathMissingError();
      }
      if (
        selected.type !== "tree" &&
        !(selected.type === "blob" && /\.md$/i.test(target.remotePath))
      ) {
        throw failure();
      }
      return {
        owner,
        repo,
        ref: target.branch,
        remotePath: target.remotePath,
        commitSha: current.commitSha,
        contentSha: selected.sha,
        kind: selected.type as "tree" | "blob",
      };
    } catch (error) {
      assertActive(signal);
      if (error instanceof SkillSourcePathMissingError) {
        throw error;
      }
      if (isGitHubResponseError(error)) {
        throw new GitHubResponseError(
          error.kind,
          error.status,
          "Unable to resolve skill source revision.",
        );
      }
      throw failure();
    }
  };
}

export async function findRenamedSkillRevision(
  previous: SkillSourceRevision,
  token?: string,
  signal?: AbortSignal,
  request: typeof fetchGitHubWithOptionalAuthRetry = fetchGitHubWithOptionalAuthRetry,
): Promise<SkillSourceRevision | undefined> {
  if (!revision(previous) || previous.kind !== "tree" || !previous.remotePath) {
    return undefined;
  }
  assertActive(signal);
  const owner = previous.owner.toLowerCase();
  const repo = previous.repo.toLowerCase();
  const response = await request(
    `https://api.github.com/repos/${owner}/${repo}/compare/${previous.commitSha}...${encodeURIComponent(previous.ref)}`,
    { accept: "application/vnd.github.v3+json", token, retry: { signal } },
  );
  assertActive(signal);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw createGitHubResponseError(response, body, "Skill rename check");
  }
  const comparison: unknown = await response.json();
  assertActive(signal);
  if (
    !record(comparison) ||
    comparison.status !== "ahead" ||
    typeof comparison.total_commits !== "number" ||
    comparison.total_commits < 1 ||
    comparison.total_commits > 250 ||
    !record(comparison.base_commit) ||
    !record(comparison.merge_base_commit) ||
    comparison.base_commit.sha !== previous.commitSha ||
    comparison.merge_base_commit.sha !== previous.commitSha ||
    !Array.isArray(comparison.commits) ||
    comparison.commits.length !== comparison.total_commits ||
    !Array.isArray(comparison.files) ||
    comparison.files.length >= 300
  ) {
    return undefined;
  }
  const head = comparison.commits.at(-1);
  if (!record(head) || !sha(head.sha)) {
    return undefined;
  }
  const oldFile = `${previous.remotePath}/SKILL.md`;
  const renames = comparison.files.filter(
    (file: unknown) =>
      record(file) &&
      file.status === "renamed" &&
      file.previous_filename === oldFile &&
      typeof file.filename === "string" &&
      file.filename.endsWith("/SKILL.md"),
  );
  if (renames.length !== 1) {
    return undefined;
  }
  const newPath = (renames[0] as { filename: string }).filename.slice(
    0,
    -"/SKILL.md".length,
  );
  if (newPath === previous.remotePath || !newPath.split("/").every(segment)) {
    return undefined;
  }
  const current = await createSkillRevisionResolver(
    token,
    signal,
    request,
  )({
    owner,
    repo,
    branch: previous.ref,
    remotePath: newPath,
  });
  if (current.commitSha !== head.sha.toLowerCase()) {
    return undefined;
  }
  return current;
}

export function classifySkillUpdate(
  meta: {
    sourceRevision?: SkillSourceRevision;
    repairState?: string;
    incomplete?: boolean;
  },
  current: SkillSourceRevision,
): "changed" | "unchanged" | "untracked" | "repair" {
  if (meta.incomplete || meta.repairState) {
    return "repair";
  }
  if (!revision(current)) {
    throw failure();
  }
  const previous = meta.sourceRevision;
  if (!revision(previous)) {
    return "untracked";
  }
  return previous.owner.toLowerCase() === current.owner.toLowerCase() &&
    previous.repo.toLowerCase() === current.repo.toLowerCase() &&
    previous.ref === current.ref &&
    previous.remotePath === current.remotePath &&
    previous.kind === current.kind &&
    previous.contentSha.toLowerCase() === current.contentSha.toLowerCase()
    ? "unchanged"
    : "changed";
}
