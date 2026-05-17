import * as os from "os";
import * as path from "path";

import type { Source } from "./skillIndex";

export type SourceEntry = Pick<
  Source,
  | "id"
  | "name"
  | "url"
  | "type"
  | "branch"
  | "description"
  | "description_ja"
  | "includePaths"
  | "excludePaths"
>;

export interface SharedSourcesManifest {
  schemaVersion: 1;
  sources: SourceEntry[];
  lastUpdated: string;
  updatedBy: string;
}

export const SHARED_MANIFEST_SCHEMA_VERSION = 1;
export const SHARED_AGENT_NINJA_DIR_WINDOWS = "agent-ninja";
export const SHARED_SOURCES_MANIFEST_FILE = "sources.json";
export const SHARED_SOURCES_MANIFEST_TEMP_FILE = "sources.json.tmp";
export const SHARED_STORE_LOCK_FILE = "index.lock";
export const SHARED_STORE_RETRY_DELAY_MS = 100;
export const SHARED_STORE_LOCK_RETRY_COUNT = 5;
export const SHARED_STORE_LOCK_STALE_MS = 60 * 1000;

export function getAgentNinjaSharedDirectoryPath(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim();
    if (appData) {
      return path.join(appData, SHARED_AGENT_NINJA_DIR_WINDOWS);
    }
  }

  return path.join(os.homedir(), ".agent-ninja");
}

export function getSharedSourcesManifestPath(): string {
  return path.join(
    getAgentNinjaSharedDirectoryPath(),
    SHARED_SOURCES_MANIFEST_FILE,
  );
}

export function createEmptySharedSourcesManifest(
  updatedBy: string,
): SharedSourcesManifest {
  return {
    schemaVersion: SHARED_MANIFEST_SCHEMA_VERSION,
    sources: [],
    lastUpdated: new Date().toISOString(),
    updatedBy,
  };
}
