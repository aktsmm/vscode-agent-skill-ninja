export type SourceIndexUpdateNotificationKind = "success" | "warning";

export function getSourceIndexUpdateNotificationKind(
  failureCount: number,
): SourceIndexUpdateNotificationKind {
  return failureCount > 0 ? "warning" : "success";
}

export function scaleSourceIndexProgressIncrement(
  sourceCount: number,
  increment: number | undefined,
): number | undefined {
  if (increment === undefined || !Number.isFinite(increment)) {
    return undefined;
  }

  return sourceCount > 0 ? increment / sourceCount : increment;
}

export function formatSourceIndexResetAt(
  resetAt: string,
  locale: string,
): string {
  const date = new Date(resetAt);
  if (Number.isNaN(date.getTime())) {
    return resetAt;
  }

  return new Intl.DateTimeFormat(locale || undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}
