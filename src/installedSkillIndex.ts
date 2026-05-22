import type { Skill } from "./skillIndex";
import type { SkillMeta } from "./skillInstaller";

type InstalledSkillMetaIdentity = Pick<
  SkillMeta,
  "name" | "source" | "remotePath"
>;

function normalizeRemotePath(remotePath?: string): string | undefined {
  const normalized = remotePath?.trim().replace(/\\/g, "/");
  return normalized ? normalized.replace(/^\/+/, "") : undefined;
}

export function isLocalInstalledSkillMeta(
  meta: Pick<SkillMeta, "source">,
): boolean {
  const source = meta.source?.trim();
  return !source || source === "local";
}

export function shouldCheckInstalledSkillAgainstIndex(
  meta: Pick<SkillMeta, "source">,
): boolean {
  return !isLocalInstalledSkillMeta(meta);
}

type ManagedInstalledSkillLike = {
  root: { isReadOnly: boolean };
  meta: Pick<SkillMeta, "source">;
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
  const source = entry.meta.source?.trim();
  return (
    !entry.root.isReadOnly &&
    !!source &&
    source !== "local" &&
    source !== "unknown"
  );
}

export function shouldAutoUpdateInstalledSkillFromIndex(
  meta: Pick<SkillMeta, "source">,
): boolean {
  const source = meta.source?.trim();
  return !!source && source !== "local" && source !== "unknown";
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

  const exactMatch = skills.find(
    (skill) => skill.name === meta.name && skill.source === meta.source,
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

  if (meta.source === "unknown") {
    return skills.find((skill) => skill.name === meta.name);
  }

  return undefined;
}
