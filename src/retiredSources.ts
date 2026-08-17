import type { RetiredSource, SkillIndex } from "./skillIndex";

/**
 * 退役した preset source をローカル index から取り除く。
 *
 * 後継 source がある場合も id の付け替えはしない。skill の path は
 * 退役元リポジトリのものなので、そのまま後継 id へ移すと raw 取得が 404 になる。
 * 後継側のエントリは bundled index の merge で入ってくる。
 */
export function applyRetiredSources(
  index: SkillIndex,
  retiredSources: RetiredSource[] | undefined,
): SkillIndex {
  const retiredIds = getRetiredSourceIds(retiredSources);
  if (retiredIds.size === 0) {
    return index;
  }

  const sources = index.sources.filter((source) => !retiredIds.has(source.id));
  if (sources.length === index.sources.length) {
    return index;
  }

  // インストール済みスキルの出所を後から追えるよう、消した source を残す
  const removedIds = index.sources
    .filter((source) => retiredIds.has(source.id))
    .map((source) => source.id);
  console.warn(
    `[Skill Ninja] Removed ${removedIds.length} retired preset source(s): ${removedIds.join(", ")}`,
  );

  const bundles = (index.bundles || []).filter(
    (bundle) => !retiredIds.has(bundle.source),
  );

  return {
    ...index,
    sources,
    skills: index.skills.filter((skill) => !retiredIds.has(skill.source)),
    bundles: bundles.length > 0 ? bundles : undefined,
  };
}

export function getRetiredSourceIds(
  retiredSources: RetiredSource[] | undefined,
): Set<string> {
  return new Set(
    (retiredSources || [])
      .map((entry) => (typeof entry?.id === "string" ? entry.id.trim() : ""))
      .filter(Boolean),
  );
}
