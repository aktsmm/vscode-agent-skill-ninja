import type { Bundle } from "./skillIndex";

/** 再試行しても結果が変わりにくい scan 失敗。通知の抑制と再試行間隔の判定に使う。 */
export type SourceScanFailureKind =
  | "empty-scan"
  | "not-found"
  | "identity-changed";

/** 文言は翻訳されるため、分類は message ではなく kind で行う。 */
export class SourceScanError extends Error {
  constructor(
    public readonly kind: SourceScanFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "SourceScanError";
  }
}

/**
 * 読みに行った候補があるのに 0 件なら、通信失敗や一時的な取得失敗かもしれない。
 * その場合は恒久的な空スキャンとして記録せず、従来どおり通常の失敗として扱う。
 */
export function createEmptyScanError(
  message: string,
  skillFileCount: number | undefined,
): Error {
  return skillFileCount
    ? new Error(message)
    : new SourceScanError("empty-scan", message);
}

/**
 * スキャンは成功したがスキルが 0 件だった場合に既存スキルを保持するか判定する。
 * 一時的な upstream 側の空応答で登録済みスキルを失わないためのガード。
 */
export function shouldPreserveSkillsOnEmptyScan(
  scannedSkillCount: number,
  existingSkillCount: number,
): boolean {
  return scannedSkillCount === 0 && existingSkillCount > 0;
}

export function createSourceBundleKey(
  bundle: Pick<Bundle, "source" | "id">,
): string {
  return `${bundle.source}:${bundle.id}`;
}

/**
 * 保存済み repo id と今回解決した id の不一致を検出する。
 * rename や transfer では id が変わらないため、不一致は別リポジトリを見ている合図。
 */
export function hasRepositoryIdentityChanged(
  storedRepoId: number | undefined,
  scannedRepoId: number | undefined,
): boolean {
  return (
    storedRepoId !== undefined &&
    scannedRepoId !== undefined &&
    storedRepoId !== scannedRepoId
  );
}

const USER_ADDED_DESCRIPTION_PATTERN =
  /^User added repository:\s*([^/\s]+)\/([^/\s]+)\s*$/;

export interface SourceRenameResolution {
  renamed: boolean;
  /** 旧 `owner/repo`。判定できなかった場合は undefined。 */
  previousFullName?: string;
  nextFullName?: string;
  /** 自動生成された表示名だったときだけ入る。ユーザーが変えた名前は上書きしない。 */
  name?: string;
  description?: string;
}

/**
 * 同じ repo id のまま owner/repo が変わった rename を検出する。
 * scan 側は canonical な full_name を解決済みなので、保存側が取り残されるだけ。
 */
export function resolveSourceRename(
  stored: { name?: string; description?: string },
  scanned: { name?: string; description?: string },
): SourceRenameResolution {
  const storedMatch = USER_ADDED_DESCRIPTION_PATTERN.exec(
    stored.description || "",
  );
  const scannedMatch = USER_ADDED_DESCRIPTION_PATTERN.exec(
    scanned.description || "",
  );
  if (!storedMatch || !scannedMatch) {
    return { renamed: false };
  }

  const previousFullName = `${storedMatch[1]}/${storedMatch[2]}`;
  const nextFullName = `${scannedMatch[1]}/${scannedMatch[2]}`;
  if (previousFullName === nextFullName) {
    return { renamed: false };
  }

  // 表示名が旧 repo 名そのままなら自動生成。ユーザーが付けた名前なら触らない。
  const autoNamed = (stored.name || "") === storedMatch[2];
  return {
    renamed: true,
    previousFullName,
    nextFullName,
    name: autoNamed ? scannedMatch[2] : undefined,
    description: autoNamed ? scanned.description : undefined,
  };
}

/**
 * 再スキャン成功後の、その source が持つべき bundle を返す。
 * スキャンが bundle を返した場合だけ置き換える。プリセットの手書き bundle は
 * スキャンでは再生成されないため、0 件のときは既存を保持する。
 */
export function reconcileSourceBundles(
  existingBundles: Bundle[],
  scannedBundles: Bundle[] | undefined,
  sourceId: string,
): Bundle[] {
  if (scannedBundles && scannedBundles.length > 0) {
    return scannedBundles.map((bundle) => ({ ...bundle, source: sourceId }));
  }

  return existingBundles.filter((bundle) => bundle.source === sourceId);
}
