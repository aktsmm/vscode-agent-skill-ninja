// 再インストール対象の解決。VS Code API へ依存しない純粋な制御だけを置き、
// 「一括実行中はダイアログで止めない」を実行可能な回帰テストで固定する。

export interface ReinstallPlannerDeps<TIndex, TEntry, TMeta> {
  /** インデックスに無いスキルのために index を更新する。confirm:false なら質問しない */
  refreshIndex(
    index: TIndex,
    metas: TMeta[],
    options: { confirm?: boolean },
  ): Promise<TIndex>;
  /** 恒久的な除外を提案する。ダイアログを伴うので一括実行では呼ばない */
  offerDisableMissingChecks(entries: TEntry[]): Promise<number>;
  isIndexed(index: TIndex, entry: TEntry): boolean;
  metaOf(entry: TEntry): TMeta;
  keyOf(entry: TEntry): string;
}

export interface ReinstallPlan<TIndex, TEntry> {
  index: TIndex;
  installableEntries: TEntry[];
  skippedMissingCount: number;
  disabledMissingCount: number;
}

/**
 * 一括再インストールの対象を決める。
 *
 * `interactive: false` の経路ではダイアログを一切出さない。非モーダル通知を
 * await すると、ユーザーが通知を放置した場合に一括処理が無期限で止まる。
 * 見つからなかったスキルは `skippedMissingCount` としてサマリに出す。
 */
export async function resolveReinstallEntries<TIndex, TEntry, TMeta>(
  index: TIndex,
  entries: TEntry[],
  deps: ReinstallPlannerDeps<TIndex, TEntry, TMeta>,
  options: { interactive: boolean },
): Promise<ReinstallPlan<TIndex, TEntry>> {
  const missingBeforeRefresh = entries.filter(
    (entry) => !deps.isIndexed(index, entry),
  );

  let nextIndex = index;
  if (missingBeforeRefresh.length > 0) {
    nextIndex = await deps.refreshIndex(
      index,
      missingBeforeRefresh.map((entry) => deps.metaOf(entry)),
      options.interactive ? {} : { confirm: false },
    );
  }

  const missingAfterRefresh = entries.filter(
    (entry) => !deps.isIndexed(nextIndex, entry),
  );

  const disabledMissingCount = options.interactive
    ? await deps.offerDisableMissingChecks(missingAfterRefresh)
    : 0;

  const missingKeys = new Set(
    missingAfterRefresh.map((entry) => deps.keyOf(entry)),
  );

  return {
    index: nextIndex,
    installableEntries: entries.filter(
      (entry) => !missingKeys.has(deps.keyOf(entry)),
    ),
    skippedMissingCount: missingAfterRefresh.length,
    disabledMissingCount,
  };
}
