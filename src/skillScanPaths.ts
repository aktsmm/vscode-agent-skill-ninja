export function normalizeWorkspacePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function getSkillsDirectorySearchPattern(
  skillsDirectory: string,
): string {
  const normalizedSkillsDirectory =
    normalizeWorkspacePath(skillsDirectory) || ".github/skills";

  return `${normalizedSkillsDirectory}/**/SKILL.md`;
}

export function isPathInSkillsDirectory(
  relativePath: string,
  skillsDirectory: string,
): boolean {
  const normalizedPath = normalizeWorkspacePath(relativePath);
  const normalizedSkillsDirectory =
    normalizeWorkspacePath(skillsDirectory) || ".github/skills";

  return (
    normalizedPath === normalizedSkillsDirectory ||
    normalizedPath.startsWith(`${normalizedSkillsDirectory}/`)
  );
}
