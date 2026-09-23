import * as Sentry from "@sentry/nextjs";

// Edge runtime (the proxy). Errors-only; inert without SENTRY_DSN.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0,
});
