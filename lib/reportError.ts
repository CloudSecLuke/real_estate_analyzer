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

import * as Sentry from "@sentry/nextjs";

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

    // Forward to Sentry when a DSN is configured (initialised in
    // instrumentation.ts). captureException no-ops without an active client,
    // so this is safe when Sentry is off. severity → Sentry level lets an
    // alert rule fire only on the wake-someone paths (level:fatal).
    if (process.env.SENTRY_DSN) {
      Sentry.captureException(
        err instanceof Error ? err : new Error(String(payload.error.message)),
        {
          level: (ctx.severity ?? "error") === "alert" ? "fatal" : "error",
          tags: { event: ctx.event, severity: ctx.severity ?? "error" },
          user: ctx.username ? { username: ctx.username } : undefined,
          extra: ctx.extra,
        }
      );
    }
  } catch {
    // Reporting must never break the caller. If even console.error throws
    // (it shouldn't), stay silent — the original graceful path continues.
  }
}
