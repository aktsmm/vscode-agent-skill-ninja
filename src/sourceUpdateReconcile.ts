import type { Bundle } from "./skillIndex";

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
