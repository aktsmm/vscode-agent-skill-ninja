import type { BulkInstallOutcomeOf } from "./bulkInstall";

const failureKinds = new Set([
  "server-error",
  "transport",
  "rate-limit",
  "auth",
  "auth-required",
  "sso-required",
  "classic-pat-forbidden",
  "other",
  "not-found",
  "policy-limit",
  "filesystem",
  "cancelled",
  "unknown",
]);

export function formatBulkFailureDetails<TItem>(
  outcomes: BulkInstallOutcomeOf<TItem>[],
  manualRetries: number,
): string {
  const lines = outcomes
    .filter((outcome) => outcome.status !== "ok")
    .slice(0, 20)
    .map((outcome, index) => {
      const kinds = (
        outcome.failureKinds?.length ? outcome.failureKinds : ["unknown"]
      ).map((kind) => (failureKinds.has(kind) ? kind : "unknown"));
      const status = outcome.status === "partial" ? "partial" : "failed";
      const attempts =
        outcome.attempts === 0 ? 0 : outcome.attempts === 2 ? 2 : 1;
      const previous = outcome.previousFailureKinds?.map((kind) =>
        failureKinds.has(kind) ? kind : "unknown",
      );
      const previousDetails = previous?.length
        ? `; previous kinds=${[...new Set(previous)].join(", ")}`
        : "";
      return `- Item ${index + 1}: ${status}; kinds=${[...new Set(kinds)].join(", ")}; attempts in last batch=${attempts}${previousDetails}`;
    });
  return `**Bulk install diagnostics**\nManual retries: ${manualRetries === 1 ? 1 : 0}\n${lines.join("\n")}\n\nSkill names, repository URLs, local paths and raw errors are omitted. Add only details that are safe to share.`;
}

export function showBulkFailureActions<TItem>(
  summary: string,
  outcomes: BulkInstallOutcomeOf<TItem>[],
  manualRetries: number,
  deps: {
    retryLabel(count: number): string;
    reportLabel: string;
    stoppedText: string;
    showWarning(
      message: string,
      ...actions: string[]
    ): Thenable<string | undefined>;
    retry(items: TItem[]): Promise<void>;
    report(details: string): Promise<void>;
    onError(): void;
  },
): void {
  const retryable =
    manualRetries === 0
      ? outcomes.filter(
          (outcome) =>
            outcome.status !== "ok" &&
            !!outcome.failureKinds?.length &&
            outcome.failureKinds.every(
              (kind) => kind === "transport" || kind === "server-error",
            ),
        )
      : [];
  const retryLabel = deps.retryLabel(retryable.length);
  const actions = retryable.length
    ? [retryLabel, deps.reportLabel]
    : [deps.reportLabel];
  void deps
    .showWarning(
      retryable.length ? summary : `${summary}${deps.stoppedText}`,
      ...actions,
    )
    .then(async (choice) => {
      if (choice === deps.reportLabel) {
        await deps.report(formatBulkFailureDetails(outcomes, manualRetries));
      } else if (retryable.length && choice === retryLabel) {
        await deps.retry(retryable.map((outcome) => outcome.item));
      }
    })
    .then(undefined, deps.onError);
}
