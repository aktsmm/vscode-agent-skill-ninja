import { isGitHubResponseError } from "./githubResponse";

export interface SourceIndexUpdateFailure<TEntry> {
  entry: TEntry;
  error: unknown;
}

export interface SourceIndexUpdateBatchResult<TEntry, TValue> {
  value: TValue;
  succeeded: TEntry[];
  failures: SourceIndexUpdateFailure<TEntry>[];
  skipped: TEntry[];
}

export async function runSourceIndexUpdateBatch<TEntry, TValue>(
  entries: TEntry[],
  initialValue: TValue,
  update: (value: TValue, entry: TEntry) => Promise<TValue>,
): Promise<SourceIndexUpdateBatchResult<TEntry, TValue>> {
  let value = initialValue;
  const succeeded: TEntry[] = [];
  const failures: SourceIndexUpdateFailure<TEntry>[] = [];
  let skipped: TEntry[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    try {
      value = await update(value, entry);
      succeeded.push(entry);
    } catch (error) {
      failures.push({ entry, error });
      if (isGitHubResponseError(error) && error.kind === "rate-limit") {
        skipped = entries.slice(index + 1);
        break;
      }
    }
  }

  return { value, succeeded, failures, skipped };
}
