// スキル一覧の絞り込み・並べ替えの共通ロジック。
// vscode に依存しない純粋関数だけを置き、Installed / User-Global / Browse の各ビューが同じ規則を使う。

import {
  normalizeSkillInvocation,
  type SkillInvocation,
} from "./skillInvocation";

/** 呼び出しモードで絞る。`all` は絞り込みなし。 */
export type SkillInvocationFilter = "all" | SkillInvocation;

/**
 * - default: ビュー既定の順序（ローカルはパス順、Browse はインデックス順）
 * - name: 名前順
 * - stars: GitHub スター数の多い順（Browse のみ）
 * - invocation: 手動専用 → モデル専用 → 自動の順（ローカルのみ）
 */
export type SkillSortMode = "default" | "name" | "stars" | "invocation";

export const LOCAL_SORT_MODES: readonly SkillSortMode[] = [
  "default",
  "name",
  "invocation",
];
export const BROWSE_SORT_MODES: readonly SkillSortMode[] = [
  "default",
  "name",
  "stars",
];

export interface SkillViewOptions {
  filter: SkillInvocationFilter;
  sort: SkillSortMode;
}

export const DEFAULT_SKILL_VIEW_OPTIONS: Readonly<SkillViewOptions> = {
  filter: "all",
  sort: "default",
};

export function normalizeInvocationFilter(
  value: unknown,
): SkillInvocationFilter {
  return value === "auto" || value === "explicitOnly" || value === "modelOnly"
    ? value
    : "all";
}

export function normalizeSortMode(
  value: unknown,
  allowed: readonly SkillSortMode[],
): SkillSortMode {
  return allowed.includes(value as SkillSortMode)
    ? (value as SkillSortMode)
    : "default";
}

export function matchesInvocationFilter(
  skill: { invocation?: unknown },
  filter: SkillInvocationFilter,
): boolean {
  return (
    filter === "all" || normalizeSkillInvocation(skill.invocation) === filter
  );
}

export interface SortableSkill {
  name: string;
  stars?: number;
  invocation?: unknown;
}

// 探しやすさ優先: 明示呼び出し専用 → モデル専用 → 通常
const INVOCATION_SORT_RANK: Record<SkillInvocation, number> = {
  explicitOnly: 0,
  modelOnly: 1,
  auto: 2,
};

/** `default` は 0 を返すので、呼び出し側の既定順序（安定ソート）がそのまま残る。 */
export function compareSkillsByMode(
  left: SortableSkill,
  right: SortableSkill,
  mode: SkillSortMode,
): number {
  switch (mode) {
    case "name":
      return left.name.localeCompare(right.name);
    case "stars":
      return (
        (right.stars ?? 0) - (left.stars ?? 0) ||
        left.name.localeCompare(right.name)
      );
    case "invocation":
      return (
        INVOCATION_SORT_RANK[normalizeSkillInvocation(left.invocation)] -
          INVOCATION_SORT_RANK[normalizeSkillInvocation(right.invocation)] ||
        left.name.localeCompare(right.name)
      );
    default:
      return 0;
  }
}

export function sortSkills<T extends SortableSkill>(
  skills: readonly T[],
  mode: SkillSortMode,
): T[] {
  const copy = [...skills];
  return mode === "default"
    ? copy
    : copy.sort((left, right) => compareSkillsByMode(left, right, mode));
}

/**
 * インデックスに呼び出しモードが 1 件でも入っているか。
 * 未更新のインデックスでは絞り込みが「該当なし」になるため、案内を出す判断に使う。
 */
export function hasInvocationData(
  skills: ReadonlyArray<{ invocation?: unknown }>,
): boolean {
  return skills.some((skill) => skill.invocation !== undefined);
}
