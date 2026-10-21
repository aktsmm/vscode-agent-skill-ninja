import type { OutputWriteResult } from "./instructionManager";

export function isBlockedOutput(result: OutputWriteResult): boolean {
  return result === "unreadable" || result === "locked" || result === "failed";
}

export function createOutputWriteFeedback(deps: {
  log(key: string, result: OutputWriteResult): void;
  detailsAction(): string;
  warn(
    action: string,
    key: string,
    result: OutputWriteResult,
  ): Thenable<string | undefined>;
  showDetails(): void;
}) {
  const failures = new Map<string, string>();
  return {
    reset(): void {
      failures.clear();
    },
    /** detail を渡すと、同じ result でも原因や局面が変わったときに再度警告する。 */
    record(key: string, result: OutputWriteResult, detail: string = ""): void {
      if (!isBlockedOutput(result)) {
        if (failures.delete(key)) {
          deps.log(key, result);
        }
        return;
      }
      const signature = `${result}|${detail}`;
      if (failures.get(key) === signature) {
        return;
      }
      failures.set(key, signature);
      deps.log(key, result);
      const action = deps.detailsAction();
      void deps
        .warn(action, key, result)
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
