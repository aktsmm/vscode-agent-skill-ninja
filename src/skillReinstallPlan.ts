// 既存スキルの再インストール計画。VS Code API に依存しない純粋ロジック。
//
// 「何を・どの source から・上書きしてよいか」を実行前に確定する。
// 出所が分からない配置は名前だけで source を断定せず、候補と根拠を返して
// 呼び出し側が明示的に選ぶまで保留する。計画は planId で固定し、
// プレビューと実行の間に状態が変わったら実行を拒否する。

import { createHash } from "crypto";
import type { SkillSourceRevision } from "./skillUpdates";
import type { Skill } from "./skillIndex";

export type ReinstallAction = "reinstall" | "adopt";

export type ReinstallStatus = "ready" | "hold" | "skipped";

export type ReinstallReason =
  | "read-only-root"
  | "reinstall-disabled"
  | "no-provenance"
  | "no-candidate"
  | "candidate-not-found"
  | "source-missing"
  | "source-removed"
  | "source-switch"
  | "local-edits"
  | "fetch-failed"
  | "not-found"
  | "app-managed";

/** メタデータから見た出所の状態 */
export type ProvenanceState =
  | "verified"
  | "revision-missing"
  | "origin-unknown"
  | "needs-repair";

export interface PlanEntry {
  entryId: string;
  rootId: string;
  /** `ラベル (実パス)` 形式。Agents Home と Codex Home の取り違えを防ぐ */
  rootLabel: string;
  rootPath: string;
  readOnly: boolean;
  name: string;
  relativePath: string;
  /** "local" / "unknown" / index の source ID */
  source: string;
  remotePath?: string;
  sourceRevision?: SkillSourceRevision;
  metaFilePresent: boolean;
  reinstallDisabled: boolean;
  needsRepair: boolean;
  /** Claude / ChatGPT などのアプリが同期・再生成するフォルダ配下。再インストールで置き換えない */
  appManaged?: boolean;
}

export interface PlanCandidate {
  /** 次の呼び出しにそのまま渡せる ID。`source::path` */
  candidateId: string;
  source: string;
  sourceLabel: string;
  path: string;
  name: string;
}

export interface LocalFileHash {
  blobSha: string;
  /** CRLF を LF に正規化した内容の blob SHA。改行コード差を編集と誤認しないため */
  blobShaLf: string;
}

export interface ContentDiff {
  changed: string[];
  added: string[];
  removed: string[];
  identical: boolean;
}

export interface CandidateEvidence {
  candidate: PlanCandidate;
  commitSha?: string;
  contentSha?: string;
  /** 取得元の内容との比較。取得できなかったときは undefined */
  diff?: ContentDiff;
  error?: string;
}

export interface PlanItem {
  entryId: string;
  name: string;
  rootId: string;
  rootLabel: string;
  rootPath: string;
  relativePath: string;
  provenance: ProvenanceState;
  recordedSource?: string;
  recordedRemotePath?: string;
  recordedCommitSha?: string;
  status: ReinstallStatus;
  action?: ReinstallAction;
  reason?: ReinstallReason;
  detail?: string;
  candidate?: PlanCandidate;
  target?: { commitSha: string; contentSha: string; ref: string };
  /** 比較の基準。recorded = インストール時の revision、target = 取得先の最新 */
  baseline?: "recorded" | "target";
  diff?: ContentDiff;
  /** no-provenance のとき、選択肢と根拠 */
  candidates?: CandidateEvidence[];
  /** 状態が変わったかを検出するためのローカル内容の指紋 */
  localFingerprint?: string;
}

export interface InstallSelectionInput {
  skillName: string;
  candidateId?: string;
  source?: string;
}

export type InstallSelection =
  | { kind: "selected"; skill: Skill }
  | { kind: "ambiguous"; skills: Skill[] }
  | { kind: "none" };

/**
 * インストール対象をインデックスから選ぶ。同名の候補が複数あるときは、
 * 先頭を選ばずに候補を返す（public / private の取り違えを防ぐ）。
 */
export function selectSkillForInstall(
  skills: readonly Skill[],
  input: InstallSelectionInput,
): InstallSelection {
  const source = input.source?.trim().toLowerCase();
  const pool = skills.filter(
    (skill) => !source || skill.source.toLowerCase() === source,
  );

  const unique = (values: Skill[]): Skill[] => {
    const seen = new Set<string>();
    return values.filter((skill) => {
      const key = `${skill.source}\0${skill.path}`.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  };

  let matches: Skill[];
  if (input.candidateId?.trim()) {
    const wanted = input.candidateId.trim().toLowerCase();
    matches = unique(
      pool.filter(
        (skill) =>
          Boolean(skill.path) &&
          buildCandidateId(skill.source, skill.path).toLowerCase() === wanted,
      ),
    );
  } else {
    const lower = input.skillName.toLowerCase();
    const exact = pool.filter((skill) => skill.name.toLowerCase() === lower);
    matches = unique(
      exact.length > 0
        ? exact
        : pool.filter((skill) => skill.name.toLowerCase().includes(lower)),
    );
  }

  if (matches.length === 0) {
    return { kind: "none" };
  }
  return matches.length === 1
    ? { kind: "selected", skill: matches[0] }
    : { kind: "ambiguous", skills: matches };
}

export interface ReinstallRequest {
  /** entryId → candidateId。メタなし配置の初回関連付け、または source 切り替え */
  adopt: Record<string, string>;
  /** 独自編集を上書きしてよい entryId */
  allowLocalEdits: ReadonlySet<string>;
  /** 記録済みと異なる source への切り替えを許す entryId */
  allowSourceSwitch: ReadonlySet<string>;
  /** 指定したとき、候補検索をこの source に限る（他社 source へ関連付けない） */
  allowedSources?: ReadonlySet<string>;
}

export interface ReinstallPlanDeps {
  findCandidates(
    entry: PlanEntry,
    allowedSources?: ReadonlySet<string>,
  ): PlanCandidate[];
  getCandidate(candidateId: string): PlanCandidate | undefined;
  resolveRevision(candidate: PlanCandidate): Promise<SkillSourceRevision>;
  readRemoteFiles(
    revision: SkillSourceRevision,
  ): Promise<{ files: Map<string, string>; truncated: boolean }>;
  readLocalFiles(entry: PlanEntry): Promise<Map<string, LocalFileHash>>;
}

const META_FILE_NAME = ".skill-meta.json";
const MAX_CANDIDATES = 5;

export function computeGitBlobSha(bytes: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

/** バイナリ（NUL を含む）は改行を正規化しない。 */
export function hashLocalFile(bytes: Uint8Array): LocalFileHash {
  const blobSha = computeGitBlobSha(bytes);
  if (bytes.includes(0) || !bytes.includes(13)) {
    return { blobSha, blobShaLf: blobSha };
  }
  const normalized: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 13 && bytes[index + 1] === 10) {
      continue;
    }
    normalized.push(bytes[index]);
  }
  return { blobSha, blobShaLf: computeGitBlobSha(Uint8Array.from(normalized)) };
}

export function diffLocalAgainstRemote(
  local: Map<string, LocalFileHash>,
  remote: Map<string, string>,
): ContentDiff {
  const remoteFiles = new Map(
    [...remote].filter(([filePath]) => filePath !== META_FILE_NAME),
  );
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  for (const [filePath, hash] of local) {
    if (filePath === META_FILE_NAME) {
      continue;
    }
    const remoteSha = remoteFiles.get(filePath);
    if (remoteSha === undefined) {
      added.push(filePath);
    } else if (hash.blobSha !== remoteSha && hash.blobShaLf !== remoteSha) {
      changed.push(filePath);
    }
  }
  for (const filePath of remoteFiles.keys()) {
    if (!local.has(filePath)) {
      removed.push(filePath);
    }
  }

  changed.sort();
  added.sort();
  removed.sort();
  return {
    changed,
    added,
    removed,
    identical: changed.length + added.length + removed.length === 0,
  };
}

export function computeLocalFingerprint(
  local: Map<string, LocalFileHash>,
): string {
  const lines = [...local]
    .filter(([filePath]) => filePath !== META_FILE_NAME)
    .map(([filePath, hash]) => `${filePath}\0${hash.blobSha}`)
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

export function classifyProvenance(entry: PlanEntry): ProvenanceState {
  if (entry.needsRepair) {
    return "needs-repair";
  }
  const hasSource =
    entry.source !== "local" &&
    entry.source !== "unknown" &&
    Boolean(entry.remotePath);
  if (!hasSource) {
    return "origin-unknown";
  }
  return entry.sourceRevision ? "verified" : "revision-missing";
}

export function buildCandidateId(source: string, remotePath: string): string {
  return `${source}::${remotePath.replace(/\\/g, "/").replace(/^\/+/, "")}`;
}

/**
 * メタデータのない配置に対する、index 上の同名の候補。
 * 名前（SKILL.md の name とフォルダ名）が一致するものだけを返し、出所の断定には使わない。
 * 一覧の表示と再インストール計画で同じ判定を使うため、ここに 1 つだけ置く。
 */
export function findNameCandidates(
  skills: readonly Skill[],
  entry: Pick<PlanEntry, "name" | "relativePath">,
  allowedSources?: ReadonlySet<string>,
): Skill[] {
  const names = new Set([
    entry.name.toLowerCase(),
    (entry.relativePath.replace(/\\/g, "/").split("/").pop() ?? "").toLowerCase(),
  ]);
  const found = new Map<string, Skill>();
  for (const skill of skills) {
    if (!skill.path || !names.has(skill.name.toLowerCase())) {
      continue;
    }
    if (allowedSources && !allowedSources.has(skill.source.toLowerCase())) {
      continue;
    }
    found.set(buildCandidateId(skill.source, skill.path), skill);
  }
  return [...found.values()];
}

/** 一覧の「Provenance」列。ローカル専用と、候補ありの出所不明を区別する。 */
export function describeProvenance(
  entry: PlanEntry,
  nameCandidateCount: number,
): string {
  if (entry.appManaged) {
    return "app-synced";
  }
  switch (classifyProvenance(entry)) {
    case "verified":
      return "verified";
    case "revision-missing":
      return "no revision";
    case "needs-repair":
      return "needs repair";
    default:
      return nameCandidateCount === 0
        ? "no metadata (local only: no same-name skill in the index)"
        : `no metadata (${nameCandidateCount} same-name candidate${nameCandidateCount === 1 ? "" : "s"} in the index; not matched)`;
  }
}

export interface EntrySelector {
  entryIds?: string[];
  rootIds?: string[];
  sources?: string[];
  names?: string[];
  includeOriginUnknown?: boolean;
}

export interface Selection {
  entries: PlanEntry[];
  notFound: string[];
}

/**
 * 対象を明示的に絞る。entryIds か rootIds のどちらも無い指定は受け付けない
 * （「全 root の全スキル」を暗黙に対象にしない）。
 */
export function selectEntries(
  all: readonly PlanEntry[],
  selector: EntrySelector,
): Selection | { error: string } {
  const entryIds = selector.entryIds?.filter(Boolean) ?? [];
  const rootIds = selector.rootIds?.filter(Boolean) ?? [];
  if (entryIds.length === 0 && rootIds.length === 0) {
    return { error: "targets must include entryIds or rootIds" };
  }

  const lower = (values: string[] | undefined) =>
    new Set((values ?? []).map((value) => value.toLowerCase()));
  const sources = lower(selector.sources);
  const names = lower(selector.names);
  const roots = new Set(rootIds);
  const byId = new Map(all.map((entry) => [entry.entryId, entry]));

  const selected = new Map<string, PlanEntry>();
  const notFound: string[] = [];

  for (const entryId of entryIds) {
    const entry = byId.get(entryId);
    if (entry) {
      selected.set(entry.entryId, entry);
    } else {
      notFound.push(entryId);
    }
  }

  const unknownRoots = rootIds.filter(
    (rootId) => !all.some((entry) => entry.rootId === rootId),
  );

  for (const entry of all) {
    if (!roots.has(entry.rootId)) {
      continue;
    }
    if (names.size > 0 && !names.has(entry.name.toLowerCase())) {
      continue;
    }
    if (sources.size > 0) {
      const originUnknown =
        classifyProvenance(entry) === "origin-unknown" &&
        selector.includeOriginUnknown !== false;
      if (!sources.has(entry.source.toLowerCase()) && !originUnknown) {
        continue;
      }
    }
    selected.set(entry.entryId, entry);
  }

  return {
    entries: [...selected.values()],
    notFound: [...notFound, ...unknownRoots.map((rootId) => `root:${rootId}`)],
  };
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "Error" ? error.message : error.name;
  }
  return String(error);
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && error.name === "SkillSourcePathMissingError";
}

async function diffAgainst(
  revision: SkillSourceRevision,
  local: Map<string, LocalFileHash>,
  deps: ReinstallPlanDeps,
): Promise<ContentDiff> {
  const remote = await deps.readRemoteFiles(revision);
  if (remote.truncated) {
    throw new Error("remote file list was truncated");
  }
  return diffLocalAgainstRemote(local, remote.files);
}

async function buildEvidence(
  entry: PlanEntry,
  candidate: PlanCandidate,
  local: Map<string, LocalFileHash>,
  deps: ReinstallPlanDeps,
): Promise<CandidateEvidence> {
  try {
    const revision = await deps.resolveRevision(candidate);
    return {
      candidate,
      commitSha: revision.commitSha,
      contentSha: revision.contentSha,
      diff: await diffAgainst(revision, local, deps),
    };
  } catch (error) {
    return { candidate, error: describeError(error) };
  }
}

function baseItem(entry: PlanEntry): PlanItem {
  return {
    entryId: entry.entryId,
    name: entry.name,
    rootId: entry.rootId,
    rootLabel: entry.rootLabel,
    rootPath: entry.rootPath,
    relativePath: entry.relativePath,
    provenance: classifyProvenance(entry),
    recordedSource:
      entry.source === "local" || entry.source === "unknown"
        ? undefined
        : entry.source,
    recordedRemotePath: entry.remotePath,
    recordedCommitSha: entry.sourceRevision?.commitSha,
    status: "hold",
  };
}

export async function planEntry(
  entry: PlanEntry,
  request: ReinstallRequest,
  deps: ReinstallPlanDeps,
): Promise<PlanItem> {
  const item = baseItem(entry);

  if (entry.readOnly) {
    return { ...item, status: "skipped", reason: "read-only-root" };
  }
  if (entry.appManaged) {
    return { ...item, status: "skipped", reason: "app-managed" };
  }
  if (entry.reinstallDisabled) {
    return { ...item, status: "skipped", reason: "reinstall-disabled" };
  }

  let local: Map<string, LocalFileHash>;
  try {
    local = await deps.readLocalFiles(entry);
  } catch (error) {
    return {
      ...item,
      reason: "fetch-failed",
      detail: `local files could not be read: ${describeError(error)}`,
    };
  }
  item.localFingerprint = computeLocalFingerprint(local);

  const adoptId = request.adopt[entry.entryId];
  const provenance = item.provenance;
  const hasRecordedOrigin =
    provenance === "verified" ||
    provenance === "revision-missing" ||
    (provenance === "needs-repair" &&
      entry.source !== "local" &&
      entry.source !== "unknown" &&
      Boolean(entry.remotePath));

  let candidate: PlanCandidate | undefined;
  let action: ReinstallAction;

  if (adoptId) {
    const allowed = deps.findCandidates(entry, request.allowedSources);
    candidate =
      allowed.find((value) => value.candidateId === adoptId) ??
      (hasRecordedOrigin
        ? deps.getCandidate(adoptId)
        : undefined);
    if (!candidate) {
      return {
        ...item,
        reason: "candidate-not-found",
        detail: `candidateId ${adoptId} is not an eligible candidate for this skill`,
        candidates: await Promise.all(
          allowed
            .slice(0, MAX_CANDIDATES)
            .map((value) => buildEvidence(entry, value, local, deps)),
        ),
      };
    }
    if (
      hasRecordedOrigin &&
      (candidate.source.toLowerCase() !== entry.source.toLowerCase() ||
        buildCandidateId(entry.source, entry.remotePath ?? "") !==
          candidate.candidateId) &&
      !request.allowSourceSwitch.has(entry.entryId)
    ) {
      return {
        ...item,
        candidate,
        reason: "source-switch",
        detail: `recorded ${entry.source}::${entry.remotePath}, requested ${candidate.candidateId}`,
      };
    }
    action = hasRecordedOrigin ? "reinstall" : "adopt";
  } else if (hasRecordedOrigin) {
    candidate = deps.getCandidate(
      buildCandidateId(entry.source, entry.remotePath ?? ""),
    );
    if (!candidate) {
      return {
        ...item,
        reason: "source-missing",
        detail: `${entry.source}::${entry.remotePath} is not in the source index`,
      };
    }
    action = "reinstall";
  } else {
    const found = deps.findCandidates(entry, request.allowedSources);
    if (found.length === 0) {
      return { ...item, reason: "no-candidate" };
    }
    return {
      ...item,
      reason: "no-provenance",
      candidates: await Promise.all(
        found
          .slice(0, MAX_CANDIDATES)
          .map((value) => buildEvidence(entry, value, local, deps)),
      ),
    };
  }

  item.candidate = candidate;
  item.action = action;

  let target: SkillSourceRevision;
  try {
    target = await deps.resolveRevision(candidate);
  } catch (error) {
    return {
      ...item,
      action: undefined,
      reason: isMissingPathError(error) ? "source-removed" : "fetch-failed",
      detail: describeError(error),
    };
  }
  item.target = {
    commitSha: target.commitSha,
    contentSha: target.contentSha,
    ref: target.ref,
  };

  // 初回の関連付けでは取得先、記録済みの再インストールではインストール時の revision を基準に、
  // 独自編集を確認する。プレースホルダー（要修復）は SKILL.md が取得元と違うのが前提なので、
  // それ以外のファイルの差分だけを編集として扱う。
  const repairing = item.provenance === "needs-repair";
  const recorded =
    !repairing &&
    action === "reinstall" &&
    entry.sourceRevision &&
    candidate.candidateId ===
      buildCandidateId(entry.source, entry.remotePath ?? "")
      ? entry.sourceRevision
      : undefined;
  try {
    item.baseline = recorded ? "recorded" : "target";
    item.diff = await diffAgainst(recorded ?? target, local, deps);
  } catch (error) {
    return {
      ...item,
      action: undefined,
      reason: "fetch-failed",
      detail: `content check failed: ${describeError(error)}`,
    };
  }
  const hasEdits = repairing
    ? item.diff.added.length > 0 ||
      item.diff.changed.some((filePath) => filePath !== "SKILL.md")
    : !item.diff.identical;
  if (hasEdits && !request.allowLocalEdits.has(entry.entryId)) {
    return { ...item, reason: "local-edits" };
  }

  return { ...item, status: "ready" };
}

export interface ReinstallPlan {
  planId: string;
  items: PlanItem[];
}

export function computePlanId(items: readonly PlanItem[]): string {
  const stable = items
    .map((item) => [
      item.entryId,
      item.status,
      item.action ?? "",
      item.reason ?? "",
      item.candidate?.candidateId ?? "",
      item.target?.commitSha ?? "",
      item.target?.contentSha ?? "",
      item.localFingerprint ?? "",
    ])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  return createHash("sha256")
    .update(JSON.stringify(stable))
    .digest("hex")
    .slice(0, 16);
}

export async function buildReinstallPlan(
  entries: readonly PlanEntry[],
  request: ReinstallRequest,
  deps: ReinstallPlanDeps,
  extraItems: PlanItem[] = [],
): Promise<ReinstallPlan> {
  const items: PlanItem[] = [];
  for (const entry of entries) {
    items.push(await planEntry(entry, request, deps));
  }
  items.push(...extraItems);
  return { planId: computePlanId(items), items };
}
