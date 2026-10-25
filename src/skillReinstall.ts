// 既存スキルの再インストール（言語モデルツール向け）。
//
// 純粋ロジックは skillReinstallPlan.ts にあり、ここでは実際のルート列挙・ローカル
// ファイルの読み取り・正規のインストール処理（installSkillUpdate）への接続と、
// 実行後の検証だけを担う。メタデータの後付けや手動コピーはしない。

import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import * as vscode from "vscode";
import type { Skill, SkillIndex } from "./skillIndex";
import {
  getInstalledSkillsWithMeta,
  installSkillUpdate,
  resolveManagedSkillDirUri,
  resolveSkillDownloadTarget,
  resolveSkillFolderName,
  type SkillMeta,
} from "./skillInstaller";
import { getManagedSkillRoots, type SkillRoot } from "./skillLocations";
import {
  normalizeInstalledSkillSource,
  needsRepair,
} from "./installedSkillIndex";
import {
  formatRootWithPath,
  resolveSkillRootIdentity,
} from "./skillRootIds";
import {
  createSkillRevisionResolver,
  readSkillRemoteFiles,
  type SkillSourceRevision,
} from "./skillUpdates";
import {
  buildCandidateId,
  buildReinstallPlan,
  findNameCandidates,
  computeLocalFingerprint,
  describeContentDiffDetails,
  diffLocalAgainstRemote,
  hashLocalFile,
  selectEntries,
  validateReinstallInput,
  type EntrySelector,
  type LocalFileHash,
  type PlanCandidate,
  type PlanEntry,
  type PlanItem,
  type ReinstallPlan,
  type ReinstallPlanDeps,
  type ReinstallReason,
  type ReinstallRequest,
} from "./skillReinstallPlan";
import { getGitHubToken } from "./githubAuth";

export interface InstalledEntry {
  plan: PlanEntry;
  root: SkillRoot;
  meta: SkillMeta;
  /** ワークスペース未オープンでも動かすため、user root では root 自身を代用する */
  workspaceUri: vscode.Uri;
}

const MAX_LOCAL_FILES = 5000;
const MAX_LOCAL_FILE_BYTES = 10 * 1024 * 1024;
const META_FILE_NAME = ".skill-meta.json";

/** 同じ表示パスの root が複数あっても rootId が衝突しないようにする。 */
export function assignRootIds(roots: readonly SkillRoot[]): Map<string, string> {
  const identities = roots.map((root) => ({
    root,
    id: resolveSkillRootIdentity(root).id,
  }));
  const counts = new Map<string, number>();
  for (const { id } of identities) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const result = new Map<string, string>();
  for (const { root, id } of identities) {
    const unique =
      (counts.get(id) ?? 0) > 1
        ? `${id}@${createHash("sha1")
            .update(root.rootPath.toLowerCase())
            .digest("hex")
            .slice(0, 6)}`
        : id;
    result.set(root.rootPath, unique);
  }
  return result;
}

export function describeRoot(
  root: SkillRoot,
  rootId: string,
  japanese: boolean,
): string {
  return `${formatRootWithPath(
    { ...resolveSkillRootIdentity(root), id: rootId },
    root.displayPath,
    japanese,
  )} [${rootId}]`;
}

export interface ManagedRootInfo {
  root: SkillRoot;
  rootId: string;
  /** `ラベル (実パス) [rootId]` */
  label: string;
}

/**
 * その root に、同じインストール先フォルダの既存スキルがあるかを返す。
 * installSkill は既存フォルダへそのまま重ね書きするので、rootId を指定した新規インストールでは、
 * 独自編集を確認できないまま上書きしないよう、先にこれで止める。
 */
export function findExistingSkillFolder(
  root: SkillRoot,
  skill: Pick<Skill, "name" | "source" | "path">,
): string | undefined {
  const folder = resolveSkillFolderName(skill);
  return fs.existsSync(path.join(root.rootPath, folder))
    ? path.join(root.rootPath, folder)
    : undefined;
}

/** rootId と実パスの併記付きで、管理対象ルートを列挙する。 */
export async function listManagedRoots(
  workspaceUri: vscode.Uri | undefined,
  japanese: boolean,
): Promise<ManagedRootInfo[]> {
  const roots = (await getManagedSkillRoots(workspaceUri)).filter(
    (root) => root.isManaged && !root.isReadOnly && root.rootUri.scheme === "file",
  );
  const ids = assignRootIds(roots);
  return roots.map((root) => {
    const rootId = ids.get(root.rootPath) as string;
    return { root, rootId, label: describeRoot(root, rootId, japanese) };
  });
}

/**
 * アプリ（Claude / ChatGPT など）が同期するフォルダか。`synced/<ID>/manifest.json` を持つ配下を指す。
 * アプリが次の同期で再生成するため、こちらで置き換えても残らないうえ、同期元の記録とずれる。
 */
export function isAppSyncedSkill(
  rootPath: string,
  relativePath: string,
): boolean {
  const segments = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  const syncedAt = segments.indexOf("synced");
  if (syncedAt === -1) {
    return false;
  }
  for (let end = syncedAt + 1; end < segments.length; end += 1) {
    const manifest = path.join(
      rootPath,
      ...segments.slice(0, end + 1),
      "manifest.json",
    );
    if (fs.existsSync(manifest)) {
      return true;
    }
  }
  return false;
}

export async function collectInstalledEntries(
  workspaceUri: vscode.Uri | undefined,
  japanese: boolean,
): Promise<{ entries: InstalledEntry[]; roots: Map<string, SkillRoot> }> {
  const roots = (await getManagedSkillRoots(workspaceUri)).filter(
    (root) => root.isManaged && root.rootUri.scheme === "file",
  );
  const rootIds = assignRootIds(roots);
  const rootsById = new Map<string, SkillRoot>();
  const entries: InstalledEntry[] = [];

  for (const root of roots) {
    const rootId = rootIds.get(root.rootPath) as string;
    rootsById.set(rootId, root);
    const scope =
      vscode.workspace.getWorkspaceFolder(root.rootUri)?.uri ??
      workspaceUri ??
      root.rootUri;
    const metas = await getInstalledSkillsWithMeta(scope, root.rootUri);
    for (const meta of metas) {
      const relativePath = meta.relativePath || meta.name;
      const skillDir = resolveManagedSkillDirUri(root.rootUri, relativePath);
      entries.push({
        root,
        meta,
        workspaceUri: scope,
        plan: {
          entryId: `${rootId}::${relativePath}`,
          rootId,
          rootLabel: describeRoot(root, rootId, japanese),
          rootPath: root.rootPath,
          readOnly: root.isReadOnly,
          name: meta.name,
          relativePath,
          source: normalizeInstalledSkillSource(meta.source, meta.remotePath),
          remotePath: meta.remotePath,
          sourceRevision: meta.sourceRevision,
          metaFilePresent: fs.existsSync(path.join(skillDir.fsPath, META_FILE_NAME)),
          reinstallDisabled: meta.reinstallDisabled === true,
          needsRepair: needsRepair(meta),
          appManaged: isAppSyncedSkill(root.rootPath, relativePath),
        },
      });
    }
  }

  return { entries, roots: rootsById };
}

/** スキルフォルダ内のファイルをハッシュ化する。シンボリックリンクは読まずに失敗させる。 */
export async function readLocalSkillFiles(
  skillDir: string,
): Promise<Map<string, LocalFileHash>> {
  const files = new Map<string, LocalFileHash>();

  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await fs.promises.readdir(directory, {
      withFileTypes: true,
    })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        throw new Error(`symbolic link is not supported: ${relative}`);
      }
      if (entry.isDirectory()) {
        await walk(path.join(directory, entry.name), relative);
        continue;
      }
      if (!entry.isFile() || relative === META_FILE_NAME) {
        continue;
      }
      if (files.size >= MAX_LOCAL_FILES) {
        throw new Error("too many files in the skill folder");
      }
      const full = path.join(directory, entry.name);
      if ((await fs.promises.stat(full)).size > MAX_LOCAL_FILE_BYTES) {
        throw new Error(`file is too large to compare: ${relative}`);
      }
      files.set(relative, hashLocalFile(await fs.promises.readFile(full)));
    }
  };

  await walk(skillDir, "");
  return files;
}

export interface ReinstallInput {
  mode: "preview" | "apply";
  targets: EntrySelector;
  adopt?: Array<{ entryId: string; candidateId: string }>;
  allowLocalEdits?: string[];
  allowSourceSwitch?: string[];
  /** true のとき、記録済み revision と一致している項目も入れ直す */
  force?: boolean;
  planId?: string;
}

export interface PlanContext {
  plan: ReinstallPlan;
  entries: Map<string, InstalledEntry>;
  skills: Map<string, Skill>;
  revisions: Map<string, SkillSourceRevision>;
  request: ReinstallRequest;
  deps: ReinstallPlanDeps;
}

export function createReinstallDeps(
  index: SkillIndex,
  token: string | undefined,
  signal: AbortSignal | undefined,
): {
  deps: ReinstallPlanDeps;
  skills: Map<string, Skill>;
  revisions: Map<string, SkillSourceRevision>;
} {
  const skills = new Map<string, Skill>();
  for (const skill of index.skills ?? []) {
    if (!skill.path) {
      continue;
    }
    skills.set(buildCandidateId(skill.source, skill.path).toLowerCase(), skill);
  }

  const toCandidate = (skill: Skill): PlanCandidate => {
    const source = index.sources?.find((entry) => entry.id === skill.source);
    return {
      candidateId: buildCandidateId(skill.source, skill.path),
      source: skill.source,
      sourceLabel: source?.url ?? skill.source,
      path: skill.path,
      name: skill.name,
    };
  };

  const resolver = createSkillRevisionResolver(token, signal);
  const revisions = new Map<string, SkillSourceRevision>();
  const pending = new Map<string, Promise<SkillSourceRevision>>();
  const remoteFiles = new Map<
    string,
    Promise<{ files: Map<string, string>; truncated: boolean }>
  >();

  const deps: ReinstallPlanDeps = {
    findCandidates(entry, allowedSources) {
      return findNameCandidates(index.skills ?? [], entry, allowedSources).map(
        toCandidate,
      );
    },
    getCandidate(candidateId) {
      const skill = skills.get(candidateId.toLowerCase());
      return skill ? toCandidate(skill) : undefined;
    },
    resolveRevision(candidate) {
      const key = candidate.candidateId.toLowerCase();
      let promise = pending.get(key);
      if (!promise) {
        promise = (async () => {
          const skill = skills.get(key);
          if (!skill) {
            throw new Error("candidate is not in the source index");
          }
          const source = index.sources?.find((entry) => entry.id === skill.source);
          const target = await resolveSkillDownloadTarget(
            skill,
            source,
            token,
            signal,
          );
          if (!target) {
            throw new Error("no download target for the candidate");
          }
          const revision = await resolver({ ...target });
          // インストールは branch に固定した revision だけを受け付ける
          if (revision.ref !== target.branch) {
            throw new Error("source revision does not match the branch");
          }
          revisions.set(key, revision);
          return revision;
        })();
        pending.set(key, promise);
      }
      return promise;
    },
    readRemoteFiles(revision) {
      const key = `${revision.owner}/${revision.repo}@${revision.contentSha}`;
      let promise = remoteFiles.get(key);
      if (!promise) {
        promise = readSkillRemoteFiles(revision, token, signal);
        remoteFiles.set(key, promise);
      }
      return promise;
    },
    readLocalFiles(entry) {
      return readLocalSkillFiles(
        resolveManagedSkillDirUri(
          vscode.Uri.file(entry.rootPath),
          entry.relativePath,
        ).fsPath,
      );
    },
  };

  return { deps, skills, revisions };
}

export async function createReinstallPlan(
  input: ReinstallInput,
  options: {
    workspaceUri: vscode.Uri | undefined;
    index: SkillIndex;
    japanese: boolean;
    signal?: AbortSignal;
  },
): Promise<PlanContext | { error: string }> {
  const invalidInput = validateReinstallInput(input);
  if (invalidInput) {
    return { error: invalidInput };
  }

  const { entries } = await collectInstalledEntries(
    options.workspaceUri,
    options.japanese,
  );
  const selection = selectEntries(
    entries.map((entry) => entry.plan),
    input.targets ?? {},
  );
  if ("error" in selection) {
    return selection;
  }

  const selectedIds = new Set(selection.entries.map((entry) => entry.entryId));
  const adopt: Record<string, string> = {};
  for (const item of input.adopt ?? []) {
    adopt[item.entryId] = item.candidateId;
  }
  const referenced = [
    ...Object.keys(adopt),
    ...(input.allowLocalEdits ?? []),
    ...(input.allowSourceSwitch ?? []),
  ];
  const outside = referenced.filter((entryId) => !selectedIds.has(entryId));
  if (outside.length > 0) {
    return {
      error: `entryId is not part of the selected targets: ${[...new Set(outside)].join(", ")}`,
    };
  }

  const request: ReinstallRequest = {
    adopt,
    allowLocalEdits: new Set(input.allowLocalEdits ?? []),
    allowSourceSwitch: new Set(input.allowSourceSwitch ?? []),
    force: input.force === true,
    allowedSources: input.targets?.sources?.length
      ? new Set(input.targets.sources.map((source) => source.toLowerCase()))
      : undefined,
  };

  const token = await getGitHubToken();
  const { deps, skills, revisions } = createReinstallDeps(
    options.index,
    token,
    options.signal,
  );

  const missing: PlanItem[] = selection.notFound.map((id) => ({
    entryId: id,
    name: id,
    rootId: "",
    rootLabel: "",
    rootPath: "",
    relativePath: "",
    provenance: "origin-unknown",
    status: "skipped",
    reason: "not-found" as ReinstallReason,
  }));

  const plan = await buildReinstallPlan(
    selection.entries,
    request,
    deps,
    missing,
  );
  return {
    plan,
    entries: new Map(entries.map((entry) => [entry.plan.entryId, entry])),
    skills,
    revisions,
    request,
    deps,
  };
}

export type ApplyStatus = "updated" | "failed" | "held" | "skipped";

export interface ApplyResult {
  entryId: string;
  name: string;
  rootLabel: string;
  status: ApplyStatus;
  reason?: ReinstallReason;
  installedPath?: string;
  source?: string;
  recorded?: { commitSha: string; contentSha: string; ref: string };
  verification?: {
    metaRecorded: boolean;
    revisionMatches: boolean;
    skillMdPresent: boolean;
    contentMatchesRemote: boolean;
  };
  message?: string;
}

let applyInProgress = false;

/**
 * 計画の ready 項目だけを、正規の更新処理（ステージング + バックアップ）で入れ直す。
 * 項目ごとに結果を返し、1 件の失敗が独立した他の項目を止めない。
 */
export async function applyReinstallPlan(
  context: PlanContext,
  extension: vscode.ExtensionContext,
  signal?: AbortSignal,
): Promise<ApplyResult[]> {
  const deps = context.deps;
  if (applyInProgress) {
    throw new Error("Another reinstall is already running");
  }
  applyInProgress = true;
  const results: ApplyResult[] = [];

  try {
    for (const item of context.plan.items) {
      const base = {
        entryId: item.entryId,
        name: item.name,
        rootLabel: item.rootLabel,
      };
      if (item.status !== "ready") {
        results.push({
          ...base,
          status: item.status === "skipped" ? "skipped" : "held",
          reason: item.reason,
        });
        continue;
      }

      const installed = context.entries.get(item.entryId);
      const candidate = item.candidate;
      const skill = candidate
        ? context.skills.get(candidate.candidateId.toLowerCase())
        : undefined;
      const revision = candidate
        ? context.revisions.get(candidate.candidateId.toLowerCase())
        : undefined;
      if (!installed || !candidate || !skill || !revision) {
        results.push({
          ...base,
          status: "failed",
          message: "plan item is missing its source revision",
        });
        continue;
      }

      const switched =
        item.action === "adopt" ||
        buildCandidateId(
          installed.plan.source,
          installed.plan.remotePath ?? "",
        ) !== candidate.candidateId;

      try {
        const result = await installSkillUpdate(
          skill,
          installed.workspaceUri,
          extension,
          installed.root,
          installed.meta,
          revision,
          {
            signal,
            rebind: switched,
            // プレビュー後（取得中を含む）に内容が変わっていたら、入れ替えずに中止する
            beforeSwap: async (staged) => {
              // 取得した内容を先に取得元と照合し、壊れたファイルを入れ替えてから気づかないようにする
              const remote = await deps.readRemoteFiles(revision);
              if (remote.truncated) {
                throw new Error(
                  "the source file list was truncated, so the downloaded content could not be verified; nothing was replaced",
                );
              }
              const diff = diffLocalAgainstRemote(
                await readLocalSkillFiles(staged.fsPath),
                remote.files,
                { exact: true },
              );
              if (!diff.identical) {
                throw new Error(
                  `the downloaded content does not match the source revision (${describeContentDiffDetails(diff)}); nothing was replaced`,
                );
              }
              // 時間のかかる照合の後で、入れ替える直前に編集されていないことを確認する
              const current = computeLocalFingerprint(
                await readLocalSkillFiles(
                  resolveManagedSkillDirUri(
                    installed.root.rootUri,
                    installed.plan.relativePath,
                  ).fsPath,
                ),
              );
              if (current !== item.localFingerprint) {
                throw new Error(
                  "the installed content changed after the preview; nothing was replaced",
                );
              }
            },
          },
        );
        if (result.status !== "ok") {
          results.push({
            ...base,
            status: "failed",
            message: `install finished with status ${result.status}`,
          });
          continue;
        }

        const { verification, mismatch } = await verifyInstalledSkill(
          installed,
          candidate,
          revision,
          deps,
        );
        const verified = Object.values(verification).every(Boolean);
        results.push({
          ...base,
          status: verified ? "updated" : "failed",
          installedPath: path.join(installed.root.rootPath, result.installedPath),
          source: candidate.source,
          recorded: {
            commitSha: revision.commitSha,
            contentSha: revision.contentSha,
            ref: revision.ref,
          },
          verification,
          message: verified
            ? undefined
            : `post-install verification failed; the result is not recorded as up to date${mismatch ? `. Files that do not match the source: ${mismatch}` : ""}`,
        });
      } catch (error) {
        results.push({
          ...base,
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    applyInProgress = false;
  }

  return results;
}

/** 実配置先を読み戻し、記録したメタデータと取得内容を取得元と照合する。 */
async function verifyInstalledSkill(
  installed: InstalledEntry,
  candidate: PlanCandidate,
  revision: SkillSourceRevision,
  deps: ReinstallPlanDeps,
): Promise<{
  verification: NonNullable<ApplyResult["verification"]>;
  mismatch?: string;
}> {
  const skillDir = resolveManagedSkillDirUri(
    installed.root.rootUri,
    installed.plan.relativePath,
  ).fsPath;
  const verification = {
    metaRecorded: false,
    revisionMatches: false,
    skillMdPresent: fs.existsSync(path.join(skillDir, "SKILL.md")),
    contentMatchesRemote: false,
  };
  let mismatch: string | undefined;

  try {
    const stored = JSON.parse(
      await fs.promises.readFile(path.join(skillDir, META_FILE_NAME), "utf-8"),
    ) as SkillMeta;
    verification.metaRecorded =
      stored.source === candidate.source &&
      normalizeRemote(stored.remotePath) === normalizeRemote(candidate.path) &&
      !needsRepair(stored);
    verification.revisionMatches =
      stored.sourceRevision?.commitSha === revision.commitSha &&
      stored.sourceRevision?.contentSha === revision.contentSha;
  } catch {
    // 読み戻せないメタデータは未記録として扱う
  }

  try {
    const remote = await deps.readRemoteFiles(revision);
    if (remote.truncated) {
      mismatch = "the source file list was truncated, so the content could not be compared";
    } else {
      const diff = diffLocalAgainstRemote(
        await readLocalSkillFiles(skillDir),
        remote.files,
        { exact: true },
      );
      verification.contentMatchesRemote = diff.identical;
      if (!diff.identical) {
        mismatch = describeContentDiffDetails(diff);
      }
    }
  } catch (error) {
    verification.contentMatchesRemote = false;
    mismatch = `the source content could not be read: ${error instanceof Error ? error.message : String(error)}`;
  }

  return { verification, mismatch };
}

function normalizeRemote(value: string | undefined): string {
  return (value ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
}
