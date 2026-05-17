import * as fs from "fs/promises";

import type { SkillIndex } from "./skillIndex";
import {
  createEmptySharedSourcesManifest,
  getAgentNinjaSharedDirectoryPath,
  getSharedSourcesManifestPath,
  SHARED_MANIFEST_SCHEMA_VERSION,
  SHARED_SOURCES_MANIFEST_TEMP_FILE,
  type SharedSourcesManifest,
  type SourceEntry,
} from "./shared-manifest";
import { withSharedStoreLock } from "./shared-store-lock";

const SELF_EXTENSION_ID = "yamapan.agent-skill-ninja";

async function renameBrokenFile(filePath: string): Promise<void> {
  const brokenPath = `${filePath}.broken-${Date.now()}`;
  await fs.rename(filePath, brokenPath);
}

function normalizePathList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeSourceEntry(source: SourceEntry): SourceEntry {
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    type: source.type,
    branch: source.branch,
    description: source.description,
    description_ja: source.description_ja,
    includePaths: normalizePathList(source.includePaths),
    excludePaths: normalizePathList(source.excludePaths),
  };
}

function normalizeSharedSourcesManifest(
  raw: unknown,
): SharedSourcesManifest | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const candidate = raw as Partial<SharedSourcesManifest>;
  if (candidate.schemaVersion !== SHARED_MANIFEST_SCHEMA_VERSION) {
    return undefined;
  }

  if (!Array.isArray(candidate.sources)) {
    return undefined;
  }

  return {
    schemaVersion: SHARED_MANIFEST_SCHEMA_VERSION,
    sources: candidate.sources.map((source) =>
      normalizeSourceEntry(source as SourceEntry),
    ),
    lastUpdated:
      typeof candidate.lastUpdated === "string"
        ? candidate.lastUpdated
        : new Date().toISOString(),
    updatedBy:
      typeof candidate.updatedBy === "string"
        ? candidate.updatedBy
        : SELF_EXTENSION_ID,
  };
}

export async function readSharedSourcesManifest(): Promise<
  SharedSourcesManifest | undefined
> {
  const filePath = getSharedSourcesManifestPath();

  try {
    const content = await fs.readFile(filePath, "utf8");
    return normalizeSharedSourcesManifest(JSON.parse(content));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT|FileNotFound/i.test(message)) {
      return undefined;
    }

    try {
      await renameBrokenFile(filePath);
    } catch {
      // Ignore rename failures and fall back to local data.
    }

    console.warn(
      "[Skill Ninja] Failed to parse shared sources manifest:",
      error,
    );
    return undefined;
  }
}

export async function writeSharedSourcesManifest(
  manifest: SharedSourcesManifest,
): Promise<void> {
  const normalizedManifest: SharedSourcesManifest = {
    schemaVersion: SHARED_MANIFEST_SCHEMA_VERSION,
    sources: manifest.sources.map(normalizeSourceEntry),
    lastUpdated: manifest.lastUpdated,
    updatedBy: manifest.updatedBy,
  };
  const sharedDir = getAgentNinjaSharedDirectoryPath();
  const filePath = getSharedSourcesManifestPath();
  const tempPath = `${sharedDir}/${SHARED_SOURCES_MANIFEST_TEMP_FILE}`;

  await withSharedStoreLock(SELF_EXTENSION_ID, async () => {
    await fs.mkdir(sharedDir, { recursive: true });
    await fs.writeFile(
      tempPath,
      JSON.stringify(normalizedManifest, null, 2),
      "utf8",
    );
    await fs.rename(tempPath, filePath);
  });
}

export async function bootstrapSharedSourcesManifest(
  sources: SourceEntry[],
): Promise<SharedSourcesManifest> {
  const manifest = createEmptySharedSourcesManifest(SELF_EXTENSION_ID);
  manifest.sources = sources.map(normalizeSourceEntry);
  manifest.lastUpdated = new Date().toISOString();
  await writeSharedSourcesManifest(manifest);
  return manifest;
}

export function applySharedSourcesManifestToSkillIndex(
  currentIndex: SkillIndex,
  manifest: SharedSourcesManifest,
): SkillIndex {
  const nextSources = manifest.sources.map((source) => ({ ...source }));
  const currentSourceIds = new Set(nextSources.map((source) => source.id));
  const nextBundles = (currentIndex.bundles || []).filter((bundle) =>
    currentSourceIds.has(bundle.source),
  );

  return {
    ...currentIndex,
    sources: nextSources,
    skills: currentIndex.skills.filter((skill) =>
      currentSourceIds.has(skill.source),
    ),
    bundles: nextBundles.length > 0 ? nextBundles : undefined,
  };
}

export async function syncSharedSourcesManifestFromSources(
  sources: SourceEntry[],
): Promise<void> {
  await writeSharedSourcesManifest({
    schemaVersion: SHARED_MANIFEST_SCHEMA_VERSION,
    sources: sources.map(normalizeSourceEntry),
    lastUpdated: new Date().toISOString(),
    updatedBy: SELF_EXTENSION_ID,
  });
}
