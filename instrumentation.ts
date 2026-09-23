import * as Sentry from "@sentry/nextjs";

// Server-side registration hook (PROP-9). Loads the runtime-appropriate
// Sentry init; both are inert without a DSN so the app runs keyless.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captures unhandled server/RSC request errors automatically (>=8.28.0).
export const onRequestError = Sentry.captureRequestError;
