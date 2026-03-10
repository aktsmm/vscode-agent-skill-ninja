import * as path from "path";

export interface GitHubDirectoryEntry {
  name: string;
  type: string;
  download_url: string | null;
  target?: string;
}

export function resolveSymlinkTargetPath(
  currentPath: string,
  targetPath: string,
): string {
  const normalizedCurrent = currentPath.replace(/^\/+|\/+$/g, "");
  const normalizedTarget = targetPath.replace(/\\/g, "/").trim();

  if (!normalizedTarget) {
    return normalizedCurrent;
  }

  const baseDir = normalizedCurrent.includes("/")
    ? normalizedCurrent.substring(0, normalizedCurrent.lastIndexOf("/"))
    : "";

  return path.posix
    .normalize(path.posix.join("/", baseDir, normalizedTarget))
    .replace(/^\/+/, "");
}

export function partitionGitHubDirectoryEntries(
  entries: GitHubDirectoryEntry[],
): {
  files: GitHubDirectoryEntry[];
  directoriesToTraverse: GitHubDirectoryEntry[];
} {
  const files = entries.filter(
    (entry) => entry.type === "file" && entry.download_url,
  );
  const dirs = entries.filter((entry) => entry.type === "dir");
  const symlinkDirs = entries.filter((entry) => entry.type === "symlink");

  return {
    files,
    directoriesToTraverse: [...dirs, ...symlinkDirs],
  };
}
