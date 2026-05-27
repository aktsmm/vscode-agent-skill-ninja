import type { Skill } from "./skillIndex";
import type { SkillMeta } from "./skillInstaller";

type InstalledSkillMetaIdentity = Pick<
  SkillMeta,
  "name" | "source" | "remotePath"
>;

type SourceLike = { id: string };

function normalizeRemotePath(remotePath?: string): string | undefined {
  const normalized = remotePath?.trim().replace(/\\/g, "/");
  return normalized ? normalized.replace(/^\/+/, "") : undefined;
}

export function normalizeInstalledSkillSource(
  source: string | undefined,
  remotePath?: string,
): string {
  const trimmedSource = source?.trim();
  if (trimmedSource) {
    return trimmedSource;
  }

  return normalizeRemotePath(remotePath) ? "unknown" : "local";
}

export function resolveSingleAffectedSourceId(
  metas: Array<Pick<SkillMeta, "source" | "remotePath">>,
  availableSources: SourceLike[],
): string | undefined {
  const availableSourceIds = new Set(
    availableSources.map((source) => source.id?.trim()).filter(Boolean),
  );
  const affectedSourceIds = new Set(
    metas
      .map((meta) =>
        normalizeInstalledSkillSource(meta.source, meta.remotePath),
      )
      .filter(
        (sourceId) =>
          sourceId !== "local" &&
          sourceId !== "unknown" &&
          availableSourceIds.has(sourceId),
      ),
  );

  if (affectedSourceIds.size !== 1) {
    return undefined;
  }

  return [...affectedSourceIds][0];
}

export function summarizeBatchOutcome(totalCount: number, failedCount: number) {
  const normalizedTotalCount = Math.max(0, totalCount);
  const normalizedFailedCount = Math.max(
    0,
    Math.min(failedCount, normalizedTotalCount),
  );
  const succeededCount = normalizedTotalCount - normalizedFailedCount;

  return {
    totalCount: normalizedTotalCount,
    failedCount: normalizedFailedCount,
    succeededCount,
    isPartialFailure: normalizedFailedCount > 0 && succeededCount > 0,
    isTotalFailure: normalizedFailedCount > 0 && succeededCount === 0,
  };
}

export function isLocalInstalledSkillMeta(
  meta: Pick<SkillMeta, "source" | "remotePath">,
): boolean {
  const source = normalizeInstalledSkillSource(meta.source, meta.remotePath);
  const hasRemotePath = !!normalizeRemotePath(meta.remotePath);
  return (!source || source === "local") && !hasRemotePath;
}

export function shouldCheckInstalledSkillAgainstIndex(
  meta: Pick<SkillMeta, "source" | "remotePath">,
): boolean {
  return !isLocalInstalledSkillMeta(meta);
}

type ManagedInstalledSkillLike = {
  root: { isReadOnly: boolean };
  meta: Pick<SkillMeta, "source" | "remotePath">;
};

export function shouldCheckManagedInstalledSkillAgainstIndex(
  entry: ManagedInstalledSkillLike,
): boolean {
  return (
    !entry.root.isReadOnly && shouldCheckInstalledSkillAgainstIndex(entry.meta)
  );
}

export function shouldWarnManagedInstalledSkillMissingFromIndex(
  entry: ManagedInstalledSkillLike,
): boolean {
  const source = normalizeInstalledSkillSource(
    entry.meta.source,
    entry.meta.remotePath,
  );
  return (
    !entry.root.isReadOnly &&
    shouldCheckInstalledSkillAgainstIndex(entry.meta) &&
    source !== "unknown"
  );
}

export function shouldAutoUpdateInstalledSkillFromIndex(
  meta: Pick<SkillMeta, "source" | "remotePath">,
): boolean {
  const source = normalizeInstalledSkillSource(meta.source, meta.remotePath);
  return shouldCheckInstalledSkillAgainstIndex(meta) && source !== "unknown";
}

export function shouldAutoUpdateManagedInstalledSkillFromIndex(
  entry: ManagedInstalledSkillLike,
): boolean {
  return (
    !entry.root.isReadOnly &&
    shouldAutoUpdateInstalledSkillFromIndex(entry.meta)
  );
}

export function findIndexedSkillForInstalledMeta(
  skills: Skill[],
  meta: InstalledSkillMetaIdentity,
): Skill | undefined {
  if (isLocalInstalledSkillMeta(meta)) {
    return undefined;
  }

  const normalizedSource = normalizeInstalledSkillSource(
    meta.source,
    meta.remotePath,
  );
  const exactMatch = skills.find(
    (skill) => skill.name === meta.name && skill.source === normalizedSource,
  );
  if (exactMatch) {
    return exactMatch;
  }

  const normalizedRemotePath = normalizeRemotePath(meta.remotePath);
  if (normalizedRemotePath) {
    const pathMatch = skills.find(
      (skill) => normalizeRemotePath(skill.path) === normalizedRemotePath,
    );
    if (pathMatch) {
      return pathMatch;
    }
  }

  if (normalizedSource === "unknown") {
    return skills.find((skill) => skill.name === meta.name);
  }

  return undefined;
}
