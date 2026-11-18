import type { OutputWriteResult } from "./instructionManager";

export function isBlockedOutput(result: OutputWriteResult): boolean {
  return (
    result === "unreadable" ||
    result === "locked" ||
    result === "lease-lost" ||
    result === "failed"
  );
}

export interface OutputFeedbackEntry {
  key: string;
  result: OutputWriteResult;
  detail?: string;
}

export function createOutputWriteFeedback(deps: {
  log(key: string, result: OutputWriteResult): void;
  detailsAction(): string;
  warn(
    action: string,
    key: string,
    result: OutputWriteResult,
    results: readonly OutputWriteResult[],
  ): Thenable<string | undefined>;
  showDetails(): void;
}) {
  const failures = new Map<string, string>();
  function recordBatch(entries: readonly OutputFeedbackEntry[]): void {
    let firstChange: OutputFeedbackEntry | undefined;
    const blocked = new Set<OutputWriteResult>();
    for (const entry of entries) {
      const { key, result, detail = "" } = entry;
      if (!isBlockedOutput(result)) {
        if (failures.delete(key)) {
          deps.log(key, result);
        }
        continue;
      }
      blocked.add(result);
      const signature = `${result}|${detail}`;
      if (failures.get(key) !== signature) {
        failures.set(key, signature);
        deps.log(key, result);
        firstChange ??= entry;
      }
    }
    if (firstChange) {
      const action = deps.detailsAction();
      void deps
        .warn(action, firstChange.key, firstChange.result, [...blocked])
        .then((choice) => {
          if (choice === action) {
            deps.showDetails();
          }
        })
        .then(undefined, () => undefined);
    }
  }
  return {
    reset(): void {
      failures.clear();
    },
    /** detail を渡すと、同じ result でも原因や局面が変わったときに再度警告する。 */
    record(key: string, result: OutputWriteResult, detail: string = ""): void {
      recordBatch([{ key, result, detail }]);
    },
    recordBatch,
  };
}

export function summarizeOutputWrites(results: OutputWriteResult[]) {
  return {
    updated: results.filter((result) => result === "updated").length,
    unchanged: results.filter((result) => result === "unchanged").length,
    disabled: results.filter((result) => result === "disabled").length,
    deferred: results.filter((result) => result === "deferred").length,
    blocked: results.filter(isBlockedOutput).length,
  };
}
