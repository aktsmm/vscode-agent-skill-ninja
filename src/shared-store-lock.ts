import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";

import {
  getAgentNinjaSharedDirectoryPath,
  SHARED_STORE_LOCK_FILE,
  SHARED_STORE_LOCK_HARD_STALE_MS,
  SHARED_STORE_LOCK_HEARTBEAT_MS,
  SHARED_STORE_LOCK_MAX_BYTES,
  SHARED_STORE_LOCK_RETRY_COUNT,
  SHARED_STORE_LOCK_STALE_MS,
  SHARED_STORE_RETRY_DELAY_MS,
} from "./shared-manifest";

export interface SharedStoreLockPayload {
  pid: number;
  acquiredAt: string;
  extensionId: string;
  generation: string;
}

/**
 * ロックを保持している間だけ共有 state を書いてよい、という契約。
 * stale 判定で他プロセスに奪われたら書き込みを止める。
 */
export interface SharedStoreLease {
  readonly generation: string;
  assertHeld(): void;
  /**
   * ローカルのフラグだけでは fence にならない。
   * 停止中に契約を奪われたプロセスは heartbeat 未実行のまま再開し得るので、
   * 共有 state を commit する直前にディスク上の世代を確かめる。
   */
  assertStillOwned(): Promise<void>;
}

export class SharedStoreLeaseLostError extends Error {
  constructor(generation: string) {
    super(`Shared store lease was lost (generation: ${generation})`);
    this.name = "SharedStoreLeaseLostError";
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getSharedStoreLockPath(): string {
  return path.join(getAgentNinjaSharedDirectoryPath(), SHARED_STORE_LOCK_FILE);
}

function normalizeLockPayload(
  raw: unknown,
): SharedStoreLockPayload | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const candidate = raw as Partial<SharedStoreLockPayload>;
  if (
    typeof candidate.acquiredAt !== "string" ||
    typeof candidate.extensionId !== "string"
  ) {
    return undefined;
  }

  return {
    pid: typeof candidate.pid === "number" ? candidate.pid : -1,
    acquiredAt: candidate.acquiredAt,
    extensionId: candidate.extensionId,
    generation:
      typeof candidate.generation === "string" ? candidate.generation : "",
  };
}

interface SharedStoreLockState {
  exists: boolean;
  payload?: SharedStoreLockPayload;
  mtimeMs?: number;
}

async function readLockState(lockPath: string): Promise<SharedStoreLockState> {
  let handle: fs.FileHandle | undefined;
  try {
    // stat と read を同じ handle で行う。別々に開くと、間に差し替えて上限を迂回できる
    handle = await fs.open(lockPath, "r");
    const stats = await handle.stat();
    if (stats.size > SHARED_STORE_LOCK_MAX_BYTES) {
      return { exists: true, mtimeMs: stats.mtimeMs };
    }

    const content = await handle.readFile("utf8");

    let payload: SharedStoreLockPayload | undefined;
    try {
      payload = normalizeLockPayload(JSON.parse(content));
    } catch {
      payload = undefined;
    }

    return { exists: true, payload, mtimeMs: stats.mtimeMs };
  } catch {
    return { exists: false };
  } finally {
    try {
      await handle?.close();
    } catch {
      // 既に閉じている場合は無視
    }
  }
}

async function readLockPayload(
  lockPath: string,
): Promise<SharedStoreLockPayload | undefined> {
  return (await readLockState(lockPath)).payload;
}

/** 記録された pid が生きているなら、その所有者はまだ動いている可能性が高い */
function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM は「存在するが操作権限が無い」なので生存扱いにする
    return (
      !!error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "EPERM"
    );
  }
}

/**
 * 読めるロックは、世代と acquiredAt が変わっておらず、かつ所有プロセスが
 * 生きていないときだけ回収する。停止中の生存プロセスからロックを奪うと、
 * その所有者が再開したときに fence をすり抜けて両者が書ける。
 * PID 再利用で恒久停止しないよう、十分に古いロックは生存判定に関わらず回収する。
 * 読めないロックは、書き込み途中で落ちた残骸なのでファイル自体の古さで判断する。
 */
async function removeStaleLock(lockPath: string): Promise<void> {
  const state = await readLockState(lockPath);
  if (!state.exists) {
    return;
  }

  if (state.payload) {
    const acquiredAt = Date.parse(state.payload.acquiredAt);
    if (!Number.isFinite(acquiredAt)) {
      return;
    }

    const age = Date.now() - acquiredAt;
    if (age <= SHARED_STORE_LOCK_STALE_MS) {
      return;
    }

    if (
      age <= SHARED_STORE_LOCK_HARD_STALE_MS &&
      isProcessAlive(state.payload.pid)
    ) {
      return;
    }

    // 読み直しの間に heartbeat が延長した、または別プロセスが取り直したなら触らない
    const current = await readLockState(lockPath);
    if (
      !current.payload ||
      current.payload.generation !== state.payload.generation ||
      current.payload.acquiredAt !== state.payload.acquiredAt
    ) {
      return;
    }

    await reclaimLockFile(lockPath);
    return;
  }
  if (
    state.mtimeMs === undefined ||
    Date.now() - state.mtimeMs <= SHARED_STORE_LOCK_STALE_MS
  ) {
    return;
  }

  const current = await readLockState(lockPath);
  if (current.payload || current.mtimeMs !== state.mtimeMs) {
    return;
  }

  console.warn(
    "[Skill Ninja] Reclaiming an unreadable shared store lock that is older than the stale window",
  );
  await reclaimLockFile(lockPath);
}

/**
 * 消す側も rename で 1 プロセスだけが勝つようにする。
 * read してから rm までの間に heartbeat が延長すると、生きているロックを消してしまう。
 * rename を奪われた所有者は heartbeat の世代不一致で lease 喪失を検知して書き込みを止める。
 */
async function reclaimLockFile(lockPath: string): Promise<void> {
  const reclaimPath = `${lockPath}.reclaim-${crypto.randomUUID()}`;
  try {
    await fs.rename(lockPath, reclaimPath);
  } catch {
    return;
  }

  await fs.rm(reclaimPath, { force: true });
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "EEXIST"
  );
}

/**
 * payload を書いてから link するので、中身の無いロックが観測される窓が無い。
 * link は既存ファイルがあると EEXIST で失敗するため、排他生成としても機能する。
 */
async function publishLockFile(
  lockPath: string,
  payload: SharedStoreLockPayload,
): Promise<boolean> {
  const stagingPath = `${lockPath}.${payload.generation}`;
  const body = JSON.stringify(payload, null, 2);

  try {
    await fs.writeFile(stagingPath, body, "utf8");
    try {
      await fs.link(stagingPath, lockPath);
      return true;
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        return false;
      }

      // link が使えない環境向けのフォールバック。空ファイルの窓は残る
      try {
        const handle = await fs.open(lockPath, "wx");
        try {
          await handle.writeFile(body, "utf8");
        } finally {
          await handle.close();
        }
        return true;
      } catch (fallbackError) {
        // 競合を例外にすると retry ループごと抜けるので、取得失敗として返す
        if (isAlreadyExistsError(fallbackError)) {
          return false;
        }
        throw fallbackError;
      }
    }
  } finally {
    await fs.rm(stagingPath, { force: true });
  }
}

async function releaseOwnedLock(
  lockPath: string,
  generation: string,
): Promise<void> {
  const payload = await readLockPayload(lockPath);
  if (!payload || payload.generation !== generation) {
    // 奪われた後のロックは他プロセスの所有物なので消さない
    return;
  }

  await fs.rm(lockPath, { force: true });
}

export async function withSharedStoreLock<T>(
  extensionId: string,
  task: (lease: SharedStoreLease) => Promise<T>,
): Promise<T> {
  const sharedDir = getAgentNinjaSharedDirectoryPath();
  const lockPath = getSharedStoreLockPath();
  await fs.mkdir(sharedDir, { recursive: true });

  for (let attempt = 0; attempt < SHARED_STORE_LOCK_RETRY_COUNT; attempt += 1) {
    const generation = crypto.randomUUID();
    const payload: SharedStoreLockPayload = {
      pid: typeof process.pid === "number" ? process.pid : -1,
      acquiredAt: new Date().toISOString(),
      extensionId,
      generation,
    };

    if (!(await publishLockFile(lockPath, payload))) {
      await removeStaleLock(lockPath);
      // retry 予算は payload や stale しきい値と違いプロセス間契約ではないので、待ちだけ伸ばす
      await delay(SHARED_STORE_RETRY_DELAY_MS * 2 ** attempt);
      continue;
    }

    let held = true;
    const lease: SharedStoreLease = {
      generation,
      assertHeld: () => {
        if (!held) {
          throw new SharedStoreLeaseLostError(generation);
        }
      },
      assertStillOwned: async () => {
        const current = await readLockPayload(lockPath);
        if (!current || current.generation !== generation) {
          held = false;
          throw new SharedStoreLeaseLostError(generation);
        }
      },
    };

    // 解放と重なった heartbeat が、削除済みのロックを書き戻さないようにする
    let pendingHeartbeat: Promise<void> | undefined;
    const runHeartbeat = async (): Promise<void> => {
      if (!held) {
        return;
      }

      const current = await readLockPayload(lockPath);
      if (!current || current.generation !== generation) {
        held = false;
        return;
      }

      try {
        // in-place で書くと、途中で落ちたとき truncate された payload が残る
        const refreshPath = `${lockPath}.refresh-${generation}`;
        await fs.writeFile(
          refreshPath,
          JSON.stringify(
            { ...current, acquiredAt: new Date().toISOString() },
            null,
            2,
          ),
          "utf8",
        );

        if (!held) {
          await fs.rm(refreshPath, { force: true });
          return;
        }

        await fs.rename(refreshPath, lockPath);
      } catch {
        held = false;
      }
    };

    // stale 閾値より短い間隔で acquiredAt を延長し、長い task が奪われるのを防ぐ
    const heartbeat =
      typeof setInterval === "function"
        ? setInterval(() => {
            if (pendingHeartbeat) {
              return;
            }

            pendingHeartbeat = runHeartbeat().finally(() => {
              pendingHeartbeat = undefined;
            });
          }, SHARED_STORE_LOCK_HEARTBEAT_MS)
        : undefined;
    if (heartbeat && typeof heartbeat.unref === "function") {
      heartbeat.unref();
    }

    try {
      return await task(lease);
    } finally {
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      held = false;
      await pendingHeartbeat;
      await releaseOwnedLock(lockPath, generation);
    }
  }

  throw new Error("Failed to acquire shared store lock");
}
