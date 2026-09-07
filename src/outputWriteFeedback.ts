import type { OutputWriteResult } from "./instructionManager";

export function isBlockedOutput(result: OutputWriteResult): boolean {
  return result === "unreadable" || result === "locked" || result === "failed";
}

export function createOutputWriteFeedback(deps: {
  log(key: string, result: OutputWriteResult): void;
  detailsAction(): string;
  warn(action: string): Thenable<string | undefined>;
  showDetails(): void;
}) {
  const failures = new Map<string, OutputWriteResult>();
  return {
    reset(): void {
      failures.clear();
    },
    record(key: string, result: OutputWriteResult): void {
      if (!isBlockedOutput(result)) {
        if (failures.delete(key)) {
          deps.log(key, result);
        }
        return;
      }
      if (failures.get(key) === result) {
        return;
      }
      failures.set(key, result);
      deps.log(key, result);
      const action = deps.detailsAction();
      void deps
        .warn(action)
        .then((choice) => {
          if (choice === action) {
            deps.showDetails();
          }
        })
        .then(undefined, () => undefined);
    },
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
