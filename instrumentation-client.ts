import * as Sentry from "@sentry/nextjs";

// Browser runtime. Uses the public DSN (NEXT_PUBLIC_SENTRY_DSN); inert when
// unset, so client capture is opt-in separately from the server. Errors-only
// (no tracing, no Session Replay) to keep bundle + volume minimal — Replay
// can be added later if we want session context around client errors.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0,
});

// App Router navigation instrumentation hook (required export for the SDK).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
