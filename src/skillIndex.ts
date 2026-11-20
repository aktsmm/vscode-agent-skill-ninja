// スキルインデックスの管理
// プリインストールされたインデックスと更新可能なローカルインデックスを管理

import * as vscode from "vscode";
import { fetchGitHubWithOptionalAuthRetry } from "./githubFetch";
import { applyRetiredSources, getRetiredSourceIds } from "./retiredSources";
import { pickNewerIndexedSource } from "./sourceIndexFreshness";
import {
  applySharedSourcesManifestToSkillIndex,
  bootstrapSharedSourcesManifest,
  readSharedSourcesManifestResult,
  syncSharedSourcesManifestFromSources,
} from "./shared-sources-manifest-store";
import type { SkillExecutionContext, SkillInvocation } from "./skillInvocation";

// スキル情報の型定義
export interface Skill {
  name: string;
  source: string;
  path: string;
  categories: string[];
  description: string; // 英語説明（デフォルト）
  description_ja?: string; // 日本語説明（オプション）
  url?: string; // GitHub URL (for preview/favorites)
  rawUrl?: string; // Raw content URL
  stars?: number; // GitHub stars count
  owner?: string; // Repository owner (user or org)
  isOrg?: boolean; // Whether owner is an organization
  // Bundle/Framework 対応
  standalone?: boolean; // false = 単体では動作しない（デフォルト true）
  requires?: string[]; // 依存スキル名のリスト
  bundle?: string; // 所属 Bundle ID
  // 公式仕様に基づくメタデータ
  license?: string; // ライセンス（例: MIT, Apache-2.0）
  author?: string; // 作成者
  version?: string; // バージョン
  /**
   * SKILL.md の frontmatter から取った呼び出しモード。未設定はインデックス未更新（不明）で、
   * 取得済みの通常スキルは "auto" が入る。
   */
  invocation?: SkillInvocation;
  /** frontmatter の `argument-hint`。`/name` 実行時にチャット入力欄へ出るヒント */
  argumentHint?: string;
  /** frontmatter の `context: fork`（サブエージェントで実行する実験的機能） */
  context?: SkillExecutionContext;
}

/**
 * 言語に応じたスキルの説明を取得
 */
export function getLocalizedDescription(skill: Skill, isJa: boolean): string {
  if (isJa && skill.description_ja) {
    return skill.description_ja;
  }
  return skill.description;
}

import { encodeGitRef } from "./sourceRefs";

// 実装は sourceRefs.ts に置き、テストとスクリプトが同じ 1 本を参照できるようにする
export {
  encodeGitRef,
  hasForeignScanner,
  isSourceScanner,
  type SourceScanner,
} from "./sourceRefs";

// ソース情報の型定義
export interface Source {
  id: string;
  name: string;
  url: string;
  type: string;
  branch?: string; // デフォルトブランチ（省略時は"main"）
  lastIndexedAt?: string; // 最後にこのソースをスキャンしてインデックス化した日時（ISO 8601）
  lastIndexedBy?: string; // lastIndexedAt を書いた拡張 ID。別拡張の走査時刻を自分の鮮度に使わないため
  description: string;
  description_ja?: string; // 日本語説明（オプション）
  includePaths?: string[]; // 取り込むパス prefix の限定
  excludePaths?: string[]; // 除外するパス prefix
  // 別拡張が書いた値も共有ストア経由で入るため、既知の union へは狭めない
  scanner?: string; // 明示しない場合は repo 名ベースの legacy 判定にフォールバック
  repoId?: number; // GitHub の数値 repository ID。rename や transfer では変わらない
}

// カテゴリ情報の型定義
export interface Category {
  id: string;
  name: string;
  name_ja?: string;
  description: string;
  description_ja?: string;
}

// Bundle情報の型定義
export interface Bundle {
  id: string;
  name: string;
  source: string; // ソースID
  description: string;
  description_ja?: string;
  skills: string[]; // 含まれるスキル名のリスト
  installOrder?: string[]; // インストール順序（依存解決済み）
  coreSkill?: string; // コアスキル（最初にインストール必須）
}

// 配布を終了した preset source。merge 時にローカル index から取り除く
export interface RetiredSource {
  id: string;
  supersededBy?: string;
}

// インデックス全体の型定義
export interface SkillIndex {
  version: string;
  lastUpdated: string; // カタログ（bundled index）の発行日。端末の走査時刻ではない
  lastScannedAt?: string; // この端末で全ソースを走査し終えた日時（ISO 8601）
  sources: Source[];
  skills: Skill[];
  categories: Category[];
  bundles?: Bundle[]; // Bundle一覧
  retiredSources?: RetiredSource[]; // 退役した preset source
}

function createSkillKey(skill: Pick<Skill, "source" | "name">): string {
  return `${skill.source}:${skill.name}`;
}

function createBundleKey(bundle: Pick<Bundle, "source" | "id">): string {
  return `${bundle.source}:${bundle.id}`;
}

let indexOutputChannel: Pick<vscode.OutputChannel, "appendLine"> | undefined;
const pendingIndexWarnings = new Set<string>();

export function setSkillIndexOutputChannel(
  channel: Pick<vscode.OutputChannel, "appendLine">,
): void {
  indexOutputChannel = channel;
  for (const warning of pendingIndexWarnings) {
    channel.appendLine(`[Index] ${warning}`);
  }
  pendingIndexWarnings.clear();
}

function warnInvalidIndex(message: string): void {
  if (indexOutputChannel) {
    indexOutputChannel.appendLine(`[Index] ${message}`);
  } else {
    pendingIndexWarnings.add(message);
  }
}

function isIndexRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIndexStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

type IndexEntryKind =
  | "sources"
  | "skills"
  | "categories"
  | "bundles"
  | "retiredSources";

function normalizeIndexEntries<T>(
  value: unknown,
  kind: IndexEntryKind,
  onInvalid?: () => void,
  rejectedSourceIds?: Set<string>,
): T[] {
  if (!Array.isArray(value)) {
    if (value !== undefined) {
      warnInvalidIndex(`${kind}: expected an array; ignoring invalid data.`);
    }
    return [];
  }

  const entries: T[] = [];
  let dropped = 0;
  let repaired = 0;
  let changedExisting = false;
  const identityFields =
    kind === "skills"
      ? ["name", "source"]
      : kind === "bundles"
        ? ["id", "name", "source"]
        : kind === "retiredSources"
          ? ["id"]
          : kind === "sources"
            ? ["id", "name", "url"]
            : ["id", "name"];
  for (const raw of value) {
    if (
      !isIndexRecord(raw) ||
      identityFields.some(
        (field) => typeof raw[field] !== "string" || !raw[field].trim(),
      ) ||
      (kind === "skills" && typeof raw.path !== "string") ||
      (kind === "bundles" && !isIndexStringList(raw.skills)) ||
      // Do not repair scan restrictions by removing them: that widens the scan.
      (kind === "sources" &&
        (["branch", "scanner"].some(
          (field) => raw[field] !== undefined && typeof raw[field] !== "string",
        ) ||
          ["includePaths", "excludePaths"].some(
            (field) => raw[field] !== undefined && !isIndexStringList(raw[field]),
          )))
    ) {
      dropped += 1;
      if (kind === "sources" && isIndexRecord(raw) && typeof raw.id === "string") {
        rejectedSourceIds?.add(raw.id);
      }
      continue;
    }

    const entry = { ...raw };
    const textFields = [
      "description_ja",
      "url",
      "rawUrl",
      "owner",
      "bundle",
      "license",
      "author",
      "version",
      "argumentHint",
      "lastIndexedAt",
      "lastIndexedBy",
      "name_ja",
      "coreSkill",
      "supersededBy",
    ];
    for (const field of textFields) {
      if (entry[field] !== undefined && typeof entry[field] !== "string") {
        delete entry[field];
      }
    }
    if (kind !== "retiredSources") {
      entry.description =
        typeof raw.description === "string" ? raw.description : "";
    }
    if (kind === "sources" && typeof raw.type !== "string") {
      entry.type = "community";
    }
    if (kind === "skills") {
      entry.categories = Array.isArray(raw.categories)
        ? raw.categories.filter((item) => typeof item === "string")
        : [];
      for (const field of ["isOrg", "standalone"]) {
        if (raw[field] !== undefined && typeof raw[field] !== "boolean") {
          delete entry[field];
        }
      }
      if (
        raw.invocation !== undefined &&
        !["auto", "explicitOnly", "modelOnly"].includes(raw.invocation as string)
      ) {
        delete entry.invocation;
      }
      if (raw.context !== undefined && raw.context !== "fork") {
        delete entry.context;
      }
    }
    for (const field of ["requires", "skills", "installOrder"]) {
      if (raw[field] !== undefined || (kind === "bundles" && field === "skills")) {
        if (field === "installOrder" && !isIndexStringList(raw[field])) {
          delete entry[field];
        } else {
          entry[field] = Array.isArray(raw[field])
            ? raw[field].filter((item) => typeof item === "string")
            : [];
        }
      }
    }
    for (const field of ["stars", "repoId"]) {
      if (
        raw[field] !== undefined &&
        !(
          typeof raw[field] === "number" &&
          Number.isFinite(raw[field]) &&
          raw[field] >= 0
        )
      ) {
        delete entry[field];
      }
    }
    if (JSON.stringify(entry) !== JSON.stringify(raw)) {
      repaired += 1;
      changedExisting ||= Object.keys(raw).some(
        (key) => JSON.stringify(raw[key]) !== JSON.stringify(entry[key]),
      );
    }
    entries.push(entry as T);
  }
  if (dropped || repaired) {
    if (dropped || changedExisting) onInvalid?.();
    warnInvalidIndex(
      `${kind}: ignored ${dropped} entries with invalid identity or scan fields; repaired ${repaired} entries with invalid metadata types.`,
    );
  }
  return entries;
}

function normalizeSkillIndex(
  value: unknown,
  onInvalid?: () => void,
  rejectedSourceIds?: Set<string>,
): SkillIndex {
  if (!isIndexRecord(value)) {
    warnInvalidIndex("Expected an index object; rejecting invalid data.");
    throw new Error("Invalid skill index");
  }
  const index = value;
  for (const field of ["version", "lastUpdated", "lastScannedAt"]) {
    if (index[field] !== undefined && typeof index[field] !== "string") {
      warnInvalidIndex(
        `Index metadata ${field} has an invalid type; using a fallback.`,
      );
    }
  }
  for (const field of ["sources", "skills", "categories"]) {
    if (field === "categories" && index[field] === undefined) continue;
    if (!Array.isArray(index[field])) {
      warnInvalidIndex(
        `Required index field ${field} is not an array; rejecting invalid data.`,
      );
      throw new Error("Invalid skill index");
    }
  }
  return {
    version:
      typeof index.version === "string" && index.version ? index.version : "1.0.0",
    lastUpdated:
      typeof index.lastUpdated === "string" && index.lastUpdated
        ? index.lastUpdated
        : new Date().toISOString().split("T")[0],
    lastScannedAt:
      typeof index.lastScannedAt === "string" ? index.lastScannedAt : undefined,
    sources: normalizeIndexEntries<Source>(index.sources, "sources", onInvalid, rejectedSourceIds),
    skills: normalizeIndexEntries<Skill>(index.skills, "skills", onInvalid),
    categories: normalizeIndexEntries<Category>(index.categories, "categories", onInvalid),
    bundles: normalizeIndexEntries<Bundle>(index.bundles, "bundles", onInvalid),
    retiredSources:
      index.retiredSources === undefined
        ? undefined
        : normalizeIndexEntries<RetiredSource>(
            index.retiredSources,
            "retiredSources",
            onInvalid,
          ),
  };
}

function getConfiguredUseSharedSourcesManifest(): boolean {
  return (
    vscode.workspace
      .getConfiguration("skillNinja")
      .get<boolean>("useSharedSourcesManifest") ?? false
  );
}

// 同梱 index は 800KB 超あり、loadSkillIndex は TreeView の更新ごとに呼ばれる。
// このファイルは実行時に誰も書かないので、パース結果だけを host 内に保持する。
// ローカル index、shared manifest、永続化はキャッシュしない（毎回の再試行や
// 自己修復がそこにぶら下がっているため）。
let bundledIndexCache: { key: string; value: SkillIndex } | null = null;
let bundledIndexInflight: { key: string; promise: Promise<SkillIndex> } | null =
  null;

function cloneSkillIndex(index: SkillIndex): SkillIndex {
  // 呼び出し側は返ってきた index を書き換えるので、キャッシュ実体は渡さない
  return typeof structuredClone === "function"
    ? structuredClone(index)
    : (JSON.parse(JSON.stringify(index)) as SkillIndex);
}

async function readBundledSkillIndex(
  bundledIndexPath: vscode.Uri,
): Promise<SkillIndex | null> {
  const parse = async (): Promise<SkillIndex> => {
    const bundledContent = await vscode.workspace.fs.readFile(bundledIndexPath);
    return normalizeSkillIndex(
      JSON.parse(
        Buffer.from(bundledContent).toString("utf-8"),
      ),
    );
  };

  let key: string | null = null;
  try {
    const stat = await vscode.workspace.fs.stat(bundledIndexPath);
    key = `${bundledIndexPath.fsPath}\u0000${stat.mtime}\u0000${stat.size}`;
  } catch {
    // fingerprint を取れないなら、キャッシュせずに毎回読む
    key = null;
  }

  if (key === null) {
    try {
      return await parse();
    } catch {
      warnInvalidIndex("Bundled index could not be read or parsed; not caching the failure.");
      return null;
    }
  }

  if (bundledIndexCache?.key === key) {
    return cloneSkillIndex(bundledIndexCache.value);
  }

  if (bundledIndexInflight?.key === key) {
    try {
      return cloneSkillIndex(await bundledIndexInflight.promise);
    } catch {
      warnInvalidIndex("Bundled index could not be read or parsed; not caching the failure.");
      return null;
    }
  }

  const promise = parse();
  bundledIndexInflight = { key, promise };
  try {
    const value = await promise;
    bundledIndexCache = { key, value };
    return cloneSkillIndex(value);
  } catch {
    // 失敗はキャッシュしない。次の呼び出しで読み直す
    warnInvalidIndex("Bundled index could not be read or parsed; not caching the failure.");
    return null;
  } finally {
    if (bundledIndexInflight?.promise === promise) {
      bundledIndexInflight = null;
    }
  }
}

async function writeLocalSkillIndex(
  context: vscode.ExtensionContext,
  index: SkillIndex,
): Promise<void> {
  const localIndexPath = vscode.Uri.joinPath(
    context.globalStorageUri,
    "skill-index.json",
  );
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);
  await vscode.workspace.fs.writeFile(
    localIndexPath,
    Buffer.from(JSON.stringify(index, null, 2), "utf-8"),
  );
}

async function loadSharedSourcesIntoSkillIndex(
  currentIndex: SkillIndex,
  rejectedSourceIds = new Set<string>(),
  bootstrap = true,
): Promise<SkillIndex> {
  if (!getConfiguredUseSharedSourcesManifest()) {
    return currentIndex;
  }

  const retiredSourceIds = getRetiredSourceIds(currentIndex.retiredSources);
  const result = await readSharedSourcesManifestResult();
  if (result.status === "valid") {
    const merged = normalizeSkillIndex(
      applySharedSourcesManifestToSkillIndex(
        currentIndex,
        {
          ...result.manifest,
          sources: normalizeIndexEntries<Source>(
            result.manifest.sources,
            "sources",
            undefined,
            rejectedSourceIds,
          ),
        },
        { retiredSourceIds },
      ),
    );
    return rejectedSourceIds.size
      ? {
          ...merged,
          sources: merged.sources.filter((source) => !rejectedSourceIds.has(source.id)),
          skills: merged.skills.filter((skill) => !rejectedSourceIds.has(skill.source)),
          bundles: merged.bundles?.filter((bundle) => !rejectedSourceIds.has(bundle.source)),
        }
      : merged;
  }

  // 採用できないだけで中身はある。bootstrap で上書きすると sibling の登録が消える
  if (result.status === "rejected") {
    warnInvalidIndex(
      "Shared sources manifest was rejected; leaving it untouched.",
    );
    return currentIndex;
  }

  if (!bootstrap) return currentIndex;
  try {
    await bootstrapSharedSourcesManifest(
      currentIndex.sources.map((source) => ({ ...source })),
    );
  } catch {
    warnInvalidIndex(
      "Shared sources manifest bootstrap failed; leaving it untouched.",
    );
  }

  return currentIndex;
}

/**
 * スキルインデックスを読み込む
 * 1. globalStorageUri にローカルインデックスがあればそれを使用
 * 2. なければバンドルされたインデックスをコピーして使用
 * 3. バンドル版のバージョンが新しければソースをマージ
 */
export async function loadSkillIndex(
  context: vscode.ExtensionContext,
): Promise<SkillIndex> {
  const localIndexPath = vscode.Uri.joinPath(
    context.globalStorageUri,
    "skill-index.json",
  );

  // バンドルされたインデックスを読み込む
  const bundledIndexPath = vscode.Uri.joinPath(
    context.extensionUri,
    "resources",
    "skill-index.json",
  );

  let bundledIndex: SkillIndex | null = null;
  try {
    bundledIndex = await readBundledSkillIndex(bundledIndexPath);
  } catch {
    // バンドルがなければ null のまま
  }

  let localIndex: SkillIndex;
  let localInvalid = false;
  const rejectedSourceIds = new Set<string>();
  try {
    // ローカルインデックスを読み込む
    const content = await vscode.workspace.fs.readFile(localIndexPath);
    localIndex = normalizeSkillIndex(
      JSON.parse(Buffer.from(content).toString("utf-8")),
      () => { localInvalid = true; },
      rejectedSourceIds,
    );
  } catch (error) {
    warnInvalidIndex(
      "Local index could not be read or parsed; preserving any existing local data.",
    );
    const code = (error as { code?: unknown } | undefined)?.code;
    const missing = code === "FileNotFound" || code === "ENOENT";
    if (missing && bundledIndex) {
      // ローカルにコピー
      await writeLocalSkillIndex(context, bundledIndex);
      return loadSharedSourcesIntoSkillIndex(bundledIndex);
    }

    // バンドルされたインデックスもない場合は空のインデックスを返す
    warnInvalidIndex(
      "No readable skill index; returning an unsaved empty fallback without bootstrapping shared data.",
    );
    const emptyIndex: SkillIndex = {
      version: "1.0.0",
      lastUpdated: new Date().toISOString().split("T")[0],
      sources: [],
      skills: [],
      categories: [],
    };
    return missing
      ? loadSharedSourcesIntoSkillIndex(emptyIndex, rejectedSourceIds, false)
      : emptyIndex;
  }

  const mergedIndex = bundledIndex
    ? mergeSkillIndexes(localIndex, bundledIndex)
    : localIndex;
  const sharedMergedIndex = await loadSharedSourcesIntoSkillIndex(
    mergedIndex, rejectedSourceIds, !localInvalid,
  );
  const safeIndex = rejectedSourceIds.size
    ? {
        ...sharedMergedIndex,
        sources: sharedMergedIndex.sources.filter((source) => !rejectedSourceIds.has(source.id)),
        skills: sharedMergedIndex.skills.filter((skill) => !rejectedSourceIds.has(skill.source)),
        bundles: sharedMergedIndex.bundles?.filter((bundle) => !rejectedSourceIds.has(bundle.source)),
      }
    : sharedMergedIndex;
  if (!localInvalid && rejectedSourceIds.size === 0 && shouldPersistMergedIndex(localIndex, safeIndex)) {
    await writeLocalSkillIndex(context, safeIndex);
  } else if (localInvalid || rejectedSourceIds.size) {
    warnInvalidIndex("Invalid entries were omitted; the local index was left untouched.");
  }
  return safeIndex;
}

/**
 * 2つのスキルインデックスをマージ
 * バンドル版の新しいソースをローカル版に追加
 * 既存スキルの多言語説明も更新
 */
function mergeSkillIndexes(
  localIndex: SkillIndex,
  bundledIndex: SkillIndex,
): SkillIndex {
  const bundledSourcesById = new Map(
    bundledIndex.sources.map((source) => [source.id, source]),
  );
  const bundledCategoriesById = new Map(
    bundledIndex.categories.map((category) => [category.id, category]),
  );
  const bundledBundlesByKey = new Map(
    (bundledIndex.bundles || []).map((bundle) => [
      createBundleKey(bundle),
      bundle,
    ]),
  );
  const bundledSkillsByKey = new Map(
    bundledIndex.skills.map((skill) => [createSkillKey(skill), skill]),
  );

  // ローカルのソース ID セット
  const localSourceIds = new Set(localIndex.sources.map((s) => s.id));
  const localCategoryIds = new Set(localIndex.categories.map((c) => c.id));
  const localBundleKeys = new Set(
    (localIndex.bundles || []).map((bundle) => createBundleKey(bundle)),
  );

  // バンドル版の新しいソースを追加
  const newSources = bundledIndex.sources.filter(
    (s) => !localSourceIds.has(s.id),
  );
  const newCategories = bundledIndex.categories.filter(
    (category) => !localCategoryIds.has(category.id),
  );
  const newBundles = (bundledIndex.bundles || []).filter(
    (bundle) => !localBundleKeys.has(createBundleKey(bundle)),
  );

  // 既存ソースをバンドル版で補完・更新
  const updatedSources = localIndex.sources.map((localSource) => {
    const bundledSource = bundledSourcesById.get(localSource.id);
    if (bundledSource) {
      // 走査日時は「そのデータをいつ取得したか」なので、古い方で上書きしない
      const newerStampOwner = pickNewerIndexedSource(
        localSource,
        bundledSource,
      );
      return {
        ...localSource,
        ...bundledSource,
        lastIndexedAt: newerStampOwner?.lastIndexedAt,
        lastIndexedBy: newerStampOwner?.lastIndexedBy,
        description_ja:
          bundledSource.description_ja || localSource.description_ja,
      };
    }
    return localSource;
  });

  // 既存カテゴリをバンドル版で補完・更新
  const updatedCategories = localIndex.categories.map((localCategory) => {
    const bundledCategory = bundledCategoriesById.get(localCategory.id);
    if (bundledCategory) {
      return {
        ...localCategory,
        ...bundledCategory,
        name_ja: bundledCategory.name_ja || localCategory.name_ja,
        description_ja:
          bundledCategory.description_ja || localCategory.description_ja,
      };
    }
    return localCategory;
  });

  // バンドル版の新しいスキルを追加
  // 既存ソースでも新スキルが追加されるため、source+name で欠分を補完する
  const localSkillKeys = new Set(
    localIndex.skills.map((skill) => createSkillKey(skill)),
  );
  const newSkills = bundledIndex.skills.filter(
    (skill) => !localSkillKeys.has(createSkillKey(skill)),
  );

  // 既存スキルをバンドル版で補完・更新
  const updatedSkills = localIndex.skills.map((localSkill) => {
    const bundledSkill = bundledSkillsByKey.get(createSkillKey(localSkill));
    if (bundledSkill) {
      return {
        ...localSkill,
        ...bundledSkill,
        description_ja:
          bundledSkill.description_ja || localSkill.description_ja,
        requires:
          bundledSkill.requires && bundledSkill.requires.length > 0
            ? bundledSkill.requires
            : localSkill.requires,
        categories:
          bundledSkill.categories.length > 0
            ? bundledSkill.categories
            : localSkill.categories,
        standalone: bundledSkill.standalone ?? localSkill.standalone,
        bundle: bundledSkill.bundle || localSkill.bundle,
        license: bundledSkill.license || localSkill.license,
        author: bundledSkill.author || localSkill.author,
        version: bundledSkill.version || localSkill.version,
      };
    }
    return localSkill;
  });

  // 既存バンドルをバンドル版で補完・更新
  // preset source（bundled index に定義がある source）の bundle は bundled index を正とし、
  // bundled 側から消えた bundle は既存ユーザーの index からも取り除く
  const updatedBundles = (localIndex.bundles || [])
    .filter(
      (localBundle) =>
        !bundledSourcesById.has(localBundle.source) ||
        bundledBundlesByKey.has(createBundleKey(localBundle)),
    )
    .map((localBundle) => {
      const bundledBundle = bundledBundlesByKey.get(
        createBundleKey(localBundle),
      );
      if (bundledBundle) {
        return {
          ...localBundle,
          ...bundledBundle,
          description_ja:
            bundledBundle.description_ja || localBundle.description_ja,
        };
      }
      return localBundle;
    });

  return applyRetiredSources(
    {
      ...localIndex,
      version: bundledIndex.version,
      lastUpdated: bundledIndex.lastUpdated,
      // lastScannedAt はこの端末の走査履歴なので、カタログ側の値で上書きしない
      lastScannedAt: localIndex.lastScannedAt,
      retiredSources: bundledIndex.retiredSources,
      sources: [...updatedSources, ...newSources],
      categories: [...updatedCategories, ...newCategories],
      skills: [...updatedSkills, ...newSkills],
      bundles: [...updatedBundles, ...newBundles],
    },
    bundledIndex.retiredSources,
  );
}

function areStringArraysEqual(left?: string[], right?: string[]): boolean {
  const leftValues = left || [];
  const rightValues = right || [];

  if (leftValues.length !== rightValues.length) {
    return false;
  }

  return leftValues.every((value, index) => value === rightValues[index]);
}

function shouldPersistMergedIndex(
  localIndex: SkillIndex,
  mergedIndex: SkillIndex,
): boolean {
  if (
    localIndex.version !== mergedIndex.version ||
    localIndex.lastUpdated !== mergedIndex.lastUpdated
  ) {
    return true;
  }

  if (localIndex.sources.length !== mergedIndex.sources.length) {
    return true;
  }

  for (let index = 0; index < localIndex.sources.length; index += 1) {
    const localSource = localIndex.sources[index];
    const mergedSource = mergedIndex.sources[index];
    if (
      localSource.id !== mergedSource.id ||
      localSource.name !== mergedSource.name ||
      localSource.url !== mergedSource.url ||
      localSource.type !== mergedSource.type ||
      localSource.branch !== mergedSource.branch ||
      localSource.description !== mergedSource.description ||
      localSource.description_ja !== mergedSource.description_ja ||
      localSource.scanner !== mergedSource.scanner ||
      localSource.repoId !== mergedSource.repoId ||
      !areStringArraysEqual(
        localSource.includePaths,
        mergedSource.includePaths,
      ) ||
      !areStringArraysEqual(localSource.excludePaths, mergedSource.excludePaths)
    ) {
      return true;
    }
  }

  if (localIndex.categories.length !== mergedIndex.categories.length) {
    return true;
  }

  for (let index = 0; index < localIndex.categories.length; index += 1) {
    const localCategory = localIndex.categories[index];
    const mergedCategory = mergedIndex.categories[index];
    if (
      localCategory.id !== mergedCategory.id ||
      localCategory.name !== mergedCategory.name ||
      localCategory.name_ja !== mergedCategory.name_ja ||
      localCategory.description !== mergedCategory.description ||
      localCategory.description_ja !== mergedCategory.description_ja
    ) {
      return true;
    }
  }

  const localBundles = localIndex.bundles || [];
  const mergedBundles = mergedIndex.bundles || [];
  if (localBundles.length !== mergedBundles.length) {
    return true;
  }

  for (let index = 0; index < localBundles.length; index += 1) {
    const localBundle = localBundles[index];
    const mergedBundle = mergedBundles[index];
    if (
      localBundle.id !== mergedBundle.id ||
      localBundle.name !== mergedBundle.name ||
      localBundle.source !== mergedBundle.source ||
      localBundle.description !== mergedBundle.description ||
      localBundle.description_ja !== mergedBundle.description_ja ||
      localBundle.coreSkill !== mergedBundle.coreSkill ||
      !areStringArraysEqual(localBundle.skills, mergedBundle.skills) ||
      !areStringArraysEqual(localBundle.installOrder, mergedBundle.installOrder)
    ) {
      return true;
    }
  }

  if (localIndex.skills.length !== mergedIndex.skills.length) {
    return true;
  }

  for (let index = 0; index < localIndex.skills.length; index += 1) {
    const localSkill = localIndex.skills[index];
    const mergedSkill = mergedIndex.skills[index];
    if (
      localSkill.name !== mergedSkill.name ||
      localSkill.source !== mergedSkill.source ||
      localSkill.path !== mergedSkill.path ||
      localSkill.description !== mergedSkill.description ||
      localSkill.description_ja !== mergedSkill.description_ja ||
      localSkill.url !== mergedSkill.url ||
      localSkill.rawUrl !== mergedSkill.rawUrl ||
      localSkill.stars !== mergedSkill.stars ||
      localSkill.owner !== mergedSkill.owner ||
      localSkill.isOrg !== mergedSkill.isOrg ||
      localSkill.standalone !== mergedSkill.standalone ||
      localSkill.bundle !== mergedSkill.bundle ||
      localSkill.license !== mergedSkill.license ||
      localSkill.author !== mergedSkill.author ||
      localSkill.version !== mergedSkill.version ||
      localSkill.invocation !== mergedSkill.invocation ||
      localSkill.argumentHint !== mergedSkill.argumentHint ||
      localSkill.context !== mergedSkill.context ||
      !areStringArraysEqual(localSkill.categories, mergedSkill.categories) ||
      !areStringArraysEqual(localSkill.requires, mergedSkill.requires)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * スキルインデックスを保存する
 */
export async function saveSkillIndex(
  context: vscode.ExtensionContext,
  index: SkillIndex,
): Promise<void> {
  const localIndexPath = vscode.Uri.joinPath(context.globalStorageUri, "skill-index.json");
  let content: Uint8Array | undefined;
  try {
    content = await vscode.workspace.fs.readFile(localIndexPath);
  } catch (error) {
    const code = (error as { code?: unknown } | undefined)?.code;
    if (code !== "FileNotFound" && code !== "ENOENT") {
      throw new Error("Cannot read the local skill index; it was not overwritten.");
    }
  }
  if (content) {
    let invalid = false;
    try {
      normalizeSkillIndex(JSON.parse(Buffer.from(content).toString("utf-8")), () => {
        invalid = true;
      });
    } catch {
      invalid = true;
    }
    if (invalid) {
      throw new Error("The local skill index is invalid; repair or restore it before saving.");
    }
  }
  if (getConfiguredUseSharedSourcesManifest()) {
    const shared = await readSharedSourcesManifestResult();
    if (shared.status === "valid") {
      const rejected = new Set<string>();
      normalizeIndexEntries<Source>(shared.manifest.sources, "sources", undefined, rejected);
      if (rejected.size) {
        throw new Error("The shared source index is invalid; repair or restore it before saving.");
      }
    }
  }
  await writeLocalSkillIndex(context, index);

  if (!getConfiguredUseSharedSourcesManifest()) {
    return;
  }

  try {
    const outcome = await syncSharedSourcesManifestFromSources(
      index.sources.map((source) => ({ ...source })),
      { preservedIds: getRetiredSourceIds(index.retiredSources) },
    );
    if (outcome === "refused") {
      console.warn(
        "[Skill Ninja] The shared sources manifest was left unchanged; this index was not shared",
      );
    }
  } catch (error) {
    console.warn(
      "[Skill Ninja] Failed to sync shared sources manifest:",
      error,
    );
  }
}

// デフォルトブランチのキャッシュ（リポジトリURL → ブランチ名）
const branchCache = new Map<string, string>();

// 判定できなかった repo の短期ネガティブキャッシュ。
// 推測を永続キャッシュするとセッション中 404 が固定され、
// 毎回再探索すると一括実行で skill 数分のプローブが発生する。
const UNRESOLVED_BRANCH_TTL_MS = 60_000;
const unresolvedBranchCache = new Map<string, number>();

export function clearResolvedBranchCache(): void {
  branchCache.clear();
  unresolvedBranchCache.clear();
}

export function cacheResolvedBranch(repoUrl: string, branch: string): void {
  branchCache.set(repoUrl, branch);
  unresolvedBranchCache.delete(repoUrl);
}

export function normalizeGitHubRepoUrl(repoUrl: string): string {
  const trimmed = repoUrl.trim().replace(/[?#].*$/, "");
  const match = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)/i);
  if (!match) {
    return trimmed.replace(/\.git$/i, "").replace(/\/$/, "");
  }

  return `https://github.com/${match[1]}/${match[2].replace(/\.git$/i, "")}`;
}

export function buildGitHubContentUrl(
  repoUrl: string,
  branch: string,
  skillPath?: string,
  explicitUrl?: string,
): string {
  if (explicitUrl?.trim()) {
    return explicitUrl.trim();
  }

  const normalizedRepoUrl = normalizeGitHubRepoUrl(repoUrl);
  const normalizedSkillPath = (skillPath || "").replace(/^\/+/, "");
  if (!normalizedSkillPath) {
    return normalizedRepoUrl;
  }

  const urlType = normalizedSkillPath.endsWith(".md") ? "blob" : "tree";
  return `${normalizedRepoUrl}/${urlType}/${branch}/${normalizedSkillPath}`;
}

export function getCachedSourceBranch(source: Source): string | undefined {
  return branchCache.get(source.url) || source.branch;
}

/**
 * URL が存在するか HEAD リクエストで確認
 */
/** 中断は探索の終端なので、失敗と同じように握り潰さない */
function isAbortError(error: unknown): boolean {
  return (error as { name?: unknown } | undefined)?.name === "AbortError";
}

async function checkUrlExists(
  url: string,
  token?: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const response = await fetchGitHubWithOptionalAuthRetry(url, {
      accept: "*/*",
      token,
      method: "HEAD",
      retry: { signal },
    });
    return response.ok;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return false;
  }
}

/**
 * GitHub リポジトリのデフォルトブランチを取得する
 * 1. キャッシュがあればそれを返す
 * 2. skill-index.json に設定があればそれを使用
 * 3. main/master を HEAD リクエストで確認
 * 4. どちらもダメなら GitHub API で取得
 */
export async function getDefaultBranch(
  repoUrl: string,
  token?: string,
  testPath?: string, // 存在確認用のパス（例: "skills/xxx/SKILL.md"）
  signal?: AbortSignal,
): Promise<string> {
  // キャッシュチェック
  if (branchCache.has(repoUrl)) {
    return branchCache.get(repoUrl)!;
  }

  const unresolvedAt = unresolvedBranchCache.get(repoUrl);
  if (unresolvedAt !== undefined) {
    if (Date.now() - unresolvedAt < UNRESOLVED_BRANCH_TTL_MS) {
      return "main";
    }
    unresolvedBranchCache.delete(repoUrl);
  }

  const match = normalizeGitHubRepoUrl(repoUrl).match(
    /github\.com\/([^/]+)\/([^/]+)/,
  );
  if (!match) {
    return "main"; // フォールバック
  }

  const [, owner, repo] = match;

  // HEAD リクエストで main/master を確認
  const branches = ["main", "master"];
  for (const branch of branches) {
    // testPath があればそれを使用、なければ README を確認
    const testFile = testPath || "README.md";
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeGitRef(branch)}/${testFile}`;

    if (await checkUrlExists(rawUrl, token, signal)) {
      cacheResolvedBranch(repoUrl, branch);
      return branch;
    }
  }

  // HEAD リクエストで判定できない場合は GitHub API で取得
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
  try {
    const response = await fetchGitHubWithOptionalAuthRetry(apiUrl, {
      accept: "application/vnd.github.v3+json",
      token,
      retry: { signal },
    });
    if (response.ok) {
      const data = (await response.json()) as { default_branch?: string };
      const branch = data.default_branch || "main";
      cacheResolvedBranch(repoUrl, branch);
      return branch;
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    // API エラー時はフォールバック
  }

  // 判定できなかった "main" は推測なので永続キャッシュしない。
  // 一括実行中の再探索だけを押さえるため、短い TTL でだけ覚える。
  unresolvedBranchCache.set(repoUrl, Date.now());
  return "main";
}

/**
 * ソースのブランチを取得（キャッシュ or HEAD確認 or API）
 */
export async function getSourceBranch(
  source: Source,
  token?: string,
  skillPath?: string, // 存在確認用のスキルパス
  signal?: AbortSignal,
): Promise<string> {
  // skill-index.json に明示的に設定されていればそれを使用
  if (source.branch) {
    return source.branch;
  }
  // HEAD リクエストまたは API で動的取得
  // パスが .md で終わる場合はそのまま使用、そうでなければ /SKILL.md を追加
  let testPath: string | undefined;
  if (skillPath) {
    testPath = skillPath.endsWith(".md") ? skillPath : `${skillPath}/SKILL.md`;
  }
  return await getDefaultBranch(source.url, token, testPath, signal);
}

/**
 * ソース情報からスキルの GitHub URL を取得する（非同期版）
 */
export async function getSkillGitHubUrlAsync(
  skill: Skill,
  sources: Source[],
  token?: string,
): Promise<string | undefined> {
  if (skill.url?.trim()) {
    return skill.url.trim();
  }

  const source = sources.find((s) => s.id === skill.source);
  if (!source) {
    if (skill.source.includes("/")) {
      return buildGitHubContentUrl(
        `https://github.com/${skill.source}`,
        "main",
        skill.path,
      );
    }
    return undefined;
  }

  const branch = await getSourceBranch(source, token, skill.path);
  return buildGitHubContentUrl(source.url, branch, skill.path, skill.url);
}

/**
 * ソース情報からスキルの GitHub URL を取得する（同期版 - フォールバック用）
 */
export function getSkillGitHubUrl(
  skill: Skill,
  sources: Source[],
): string | undefined {
  if (skill.url?.trim()) {
    return skill.url.trim();
  }

  const source = sources.find((s) => s.id === skill.source);
  if (!source) {
    if (skill.source.includes("/")) {
      return buildGitHubContentUrl(
        `https://github.com/${skill.source}`,
        "main",
        skill.path,
      );
    }
    return undefined;
  }

  const branch = getCachedSourceBranch(source) || "main";
  return buildGitHubContentUrl(source.url, branch, skill.path, skill.url);
}
