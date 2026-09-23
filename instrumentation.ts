// Sentry server-side wiring (PROP-9). Guarded on SENTRY_DSN so the app runs
// keyless without it (CI, local dev, and any deploy before the DSN is set).
// Errors-only: tracesSampleRate 0 keeps this on Sentry's free tier — no
// performance-transaction volume. Client-side capture is intentionally not
// wired here; the alert targets (webhook, metering, billing) are server-side.
import type { Instrumentation } from "next";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SENTRY_DSN) {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      tracesSampleRate: 0,
    });
  }
}

// Capture otherwise-unhandled server errors from route handlers / RSC.
export const onRequestError: Instrumentation.onRequestError = async (err) => {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SENTRY_DSN) {
    const Sentry = await import("@sentry/node");
    Sentry.captureException(err);
  }
};
