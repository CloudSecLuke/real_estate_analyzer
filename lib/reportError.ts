// Single seam for server-side error capture (PROP-9). Everything that would
// otherwise be a silent `.catch(() => {})` routes through here so failures
// are visible in logs and forwardable by a Vercel log drain (or Sentry, if a
// DSN is later wired at the marked spot below).
//
// Design goals:
//  - Never throw. Reporting an error must not create a second error in a
//    catch block. All work is wrapped and swallowed *here* (the one place
//    silence is correct), so callers keep their graceful degradation.
//  - Greppable + structured. Emits a single JSON line prefixed `ERROR_REPORT`
//    so a drain filter / alert rule can match on it and on `severity`.
//  - No PII beyond username. Never pass request bodies, emails, tokens, or
//    provider payloads as context.

type Severity = "alert" | "error";

export interface ErrorContext {
  /** Stable event name, e.g. "stripe_webhook_apply_failed". Alert rules match this. */
  event: string;
  /** "alert" = wake-someone (money/entitlement path); "error" = log + review. */
  severity?: Severity;
  username?: string;
  /** Small, non-sensitive extras only (ids, types, counts — never payloads/PII). */
  extra?: Record<string, string | number | boolean | null | undefined>;
}

function serializeError(err: unknown): { message: string; stack?: string; name?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: typeof err === "string" ? err : JSON.stringify(err) };
}

/** Capture a server-side error. Safe to call from any catch block; never throws. */
export function reportError(err: unknown, ctx: ErrorContext): void {
  try {
    const payload = {
      tag: "ERROR_REPORT",
      event: ctx.event,
      severity: ctx.severity ?? "error",
      username: ctx.username,
      ...ctx.extra,
      error: serializeError(err),
    };
    // Structured single line — Vercel captures stdout/stderr and a log drain
    // (or `vercel logs --level error`) can match on `"tag":"ERROR_REPORT"`
    // and `"severity":"alert"` for the wake-someone paths.
    console.error(JSON.stringify(payload));

    // --- Sentry seam -------------------------------------------------------
    // When a DSN is provisioned, initialise Sentry once at module load and
    // forward here, e.g.:
    //   if (sentry) sentry.captureException(err, { tags: { event: ctx.event,
    //     severity: ctx.severity }, user: ctx.username ? { username: ctx.username } : undefined });
    // Kept as a no-op seam so this file has zero external dependency today.
  } catch {
    // Reporting must never break the caller. If even console.error throws
    // (it shouldn't), stay silent — the original graceful path continues.
  }
}
