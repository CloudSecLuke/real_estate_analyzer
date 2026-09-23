import * as Sentry from "@sentry/nextjs";

// Node server runtime. Errors-only by design (tracesSampleRate 0) to keep us
// on Sentry's free tier — PROP-9 is error alerting, not performance. Inert
// when SENTRY_DSN is unset (local dev, CI, pre-DSN deploys).
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0,
  includeLocalVariables: true,
});
