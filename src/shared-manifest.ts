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
  | "lastIndexedAt"
  | "lastIndexedBy"
  | "description"
  | "description_ja"
  | "includePaths"
  | "excludePaths"
  | "scanner"
  | "repoId"
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
// 所有プロセスが生きていてもここまで古ければ回収する。PID 再利用で恒久停止しないため
export const SHARED_STORE_LOCK_HARD_STALE_MS = 10 * 60 * 1000;
export const SHARED_STORE_LOCK_HEARTBEAT_MS = 15 * 1000;

// 共有ストアは他拡張・第三者も書き込める untrusted input として扱う
export const SHARED_SOURCES_MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
export const SHARED_SOURCES_MANIFEST_MAX_ENTRIES = 500;
export const SHARED_SOURCE_TEXT_MAX_LENGTH = 512;
export const SHARED_SOURCE_PATH_LIST_MAX_ENTRIES = 64;
export const SHARED_SOURCE_PATH_MAX_LENGTH = 256;
export const SHARED_SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const SHARED_SOURCE_URL_PATTERN =
  /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
export const SHARED_SOURCE_BRANCH_PATTERN = /^[A-Za-z0-9._\-/]{1,255}$/;
export const SHARED_SOURCE_TYPE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
export const SHARED_SOURCE_SCANNERS = [
  "skill-md",
  "claude-commands",
  "top-level-dirs",
  "registry-json",
] as const;

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
