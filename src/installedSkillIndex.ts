import type { Skill } from "./skillIndex";
import type { SkillMeta } from "./skillInstaller";

type InstalledSkillMetaIdentity = Pick<SkillMeta, "name" | "source">;

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

export function shouldAutoUpdateInstalledSkillFromIndex(
  meta: Pick<SkillMeta, "source">,
): boolean {
  const source = meta.source?.trim();
  return !!source && source !== "local" && source !== "unknown";
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

  if (meta.source === "unknown") {
    return skills.find((skill) => skill.name === meta.name);
  }

  return undefined;
}
