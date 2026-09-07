// 一括インストールの再試行オーケストレーション。
//
// VS Code API へ依存しない純粋な制御だけを置き、実行可能な回帰テストで
// 「自動リトライは 1 回まで」「リトライは削除しない」を固定する。

export type BulkAttemptStatus = "ok" | "partial" | "failed";

export interface BulkAttemptResult {
  status: BulkAttemptStatus;
  failureKinds?: string[];
  previousFailureKinds?: string[];
  attempts?: number;
  /** 一時的な失敗として自動リトライしてよいか */
  retryable: boolean;
  unsafeSkips: number;
}

export interface BulkAttemptContext {
  /** 明示的な入れ直しのときだけ true。自動リトライでは常に false */
  allowUninstall: boolean;
  /** 実行中の 1 件が、途中で中断要求を観測するための probe */
  isCancelled: () => boolean;
}

export interface BulkInstallPlanOptions<TItem> {
  autoRetry: boolean;
  allowUninstall?: boolean;
  label: (item: TItem) => string;
  reportProgress: (message: string, increment?: number) => void;
  retryMessage: (label: string) => string;
  /** 中断要求。次の 1 件を始める前に見るほか、実行中の 1 件へも probe として渡す */
  isCancelled?: () => boolean;
}

export type BulkInstallOutcomeOf<TItem> = BulkAttemptResult & { item: TItem };

export async function runBulkInstallPlan<TItem>(
  items: TItem[],
  attempt: (
    item: TItem,
    context: BulkAttemptContext,
  ) => Promise<BulkAttemptResult>,
  options: BulkInstallPlanOptions<TItem>,
): Promise<BulkInstallOutcomeOf<TItem>[]> {
  const outcomes: BulkInstallOutcomeOf<TItem>[] = [];
  const increment = items.length > 0 ? 100 / items.length : 0;
  const isCancelled = () => options.isCancelled?.() === true;

  for (const [index, item] of items.entries()) {
    if (isCancelled()) {
      return outcomes;
    }

    options.reportProgress(
      `${options.label(item)} (${index + 1}/${items.length})`,
      increment,
    );
    const result = await attempt(item, {
      allowUninstall: options.allowUninstall !== false,
      isCancelled,
    });
    outcomes.push({ ...result, item, attempts: 1 });
  }

  if (!options.autoRetry) {
    return outcomes;
  }

  for (const [index, outcome] of outcomes.entries()) {
    if (!outcome.retryable) {
      continue;
    }
    if (isCancelled()) {
      return outcomes;
    }

    options.reportProgress(options.retryMessage(options.label(outcome.item)));
    const retried = await attempt(outcome.item, {
      allowUninstall: false,
      isCancelled,
    });
    outcomes[index] = {
      ...retried,
      item: outcome.item,
      attempts: 2,
      // 自動リトライは 1 回だけ。手動ボタン以外で再入させない
      retryable: false,
      unsafeSkips: Math.max(outcome.unsafeSkips, retried.unsafeSkips),
    };
  }

  return outcomes;
}
