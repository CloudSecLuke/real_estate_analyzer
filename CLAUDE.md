@AGENTS.md

# Project workflow

Work is tracked as GitHub issues on this repo titled `PROP-<n>: …` (JIRA
style — the PROP number in the title is the canonical ID and may differ
from the GitHub issue number). Labels: priority `P0`/`P1`/`P2` plus area
(`security`, `reliability`, `billing`, `infra`, `ux`, `legal`).

- Session start: `gh issue list --label P0` (then P1) to see what matters
  most before picking up new work.
- Resolving a ticket: reference it in the commit message ("Resolves
  PROP-4"), close the issue with `gh issue close <#> -c "<what shipped>"`.
- New improvement ideas discovered mid-task: file a new `PROP-<next n>`
  issue instead of expanding the current task's scope.

# Production notes

- Live at proppencil.com (the apex 308-redirects to **www.**proppencil.com —
  use the www host for API probes and webhooks).
- Deploy with `npx -y vercel@latest deploy --prod` (the git-push webhook has
  been unreliable). Run typecheck + `npm test` first.
- Stripe is **live mode** in the production env; the development env keeps
  sandbox test keys on purpose. Production values for Stripe are marked
  Sensitive in Vercel and cannot be pulled — verify changes functionally
  (e.g. checkout session URLs contain `cs_live_`).
- Accounts: self-serve signup at `/signup` (users table in Neon) plus two
  env-hash founder accounts (`luke.miller`, `bart.miller`) with unlimited
  pencils. Everyone else: 1 free pencil, then the $19/mo Investor plan
  (100/mo) via Stripe Checkout.
- Local dev uses the isolated `proppencil_dev` database (same Neon
  host). After any `vercel env pull`, run `npm run env:dev` to repoint
  `.env.local`. `lib/dbUrl.ts` hard-refuses the production `neondb`
  outside production unless `ALLOW_PROD_DB=1` is set deliberately.
