import type { NextConfig } from "next";
// v11 moved withSentryConfig to the /config subpath (was the root export in <=v10).
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  /* config options here */
};

// Sentry build wrapping (PROP-9). org/project/authToken come from env, so
// source-map upload only runs when SENTRY_AUTH_TOKEN (+ SENTRY_ORG/PROJECT)
// are configured in the build env; otherwise the build proceeds without
// upload (stack traces stay minified until then). No tunnelRoute — it would
// need a carve-out in the auth proxy; server events (our alert targets) don't
// use it. silent unless CI.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  silent: !process.env.CI,
});
