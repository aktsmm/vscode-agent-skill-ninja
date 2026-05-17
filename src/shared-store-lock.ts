import * as fs from "fs/promises";
import * as path from "path";

import {
  getAgentNinjaSharedDirectoryPath,
  SHARED_STORE_LOCK_FILE,
  SHARED_STORE_LOCK_RETRY_COUNT,
  SHARED_STORE_LOCK_STALE_MS,
  SHARED_STORE_RETRY_DELAY_MS,
} from "./shared-manifest";

export interface SharedStoreLockPayload {
  pid: number;
  acquiredAt: string;
  extensionId: string;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getSharedStoreLockPath(): string {
  return path.join(getAgentNinjaSharedDirectoryPath(), SHARED_STORE_LOCK_FILE);
}

async function safeReadLockPayload(
  lockPath: string,
): Promise<SharedStoreLockPayload | undefined> {
  try {
    const content = await fs.readFile(lockPath, "utf8");
    return JSON.parse(content) as SharedStoreLockPayload;
  } catch {
    return undefined;
  }
}

async function removeStaleLock(lockPath: string): Promise<void> {
  const payload = await safeReadLockPayload(lockPath);
  if (!payload?.acquiredAt) {
    return;
  }

  const acquiredAt = Date.parse(payload.acquiredAt);
  if (!Number.isFinite(acquiredAt)) {
    return;
  }

  if (Date.now() - acquiredAt > SHARED_STORE_LOCK_STALE_MS) {
    await fs.rm(lockPath, { force: true });
  }
}

export async function withSharedStoreLock<T>(
  extensionId: string,
  task: () => Promise<T>,
): Promise<T> {
  const sharedDir = getAgentNinjaSharedDirectoryPath();
  const lockPath = getSharedStoreLockPath();
  await fs.mkdir(sharedDir, { recursive: true });

  for (let attempt = 0; attempt < SHARED_STORE_LOCK_RETRY_COUNT; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx");
      try {
        const payload: SharedStoreLockPayload = {
          pid: typeof process.pid === "number" ? process.pid : -1,
          acquiredAt: new Date().toISOString(),
          extensionId,
        };
        await handle.writeFile(JSON.stringify(payload, null, 2), "utf8");
      } finally {
        await handle.close();
      }

      try {
        return await task();
      } finally {
        await fs.rm(lockPath, { force: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !/exist/i.test(message) &&
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code?: string }).code === "EEXIST"
        )
      ) {
        throw error;
      }

      await removeStaleLock(lockPath);
      await delay(SHARED_STORE_RETRY_DELAY_MS);
    }
  }

  throw new Error("Failed to acquire shared store lock");
}
