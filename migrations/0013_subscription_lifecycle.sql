-- 0013_subscription_lifecycle.sql
-- Subscription lifecycle edge cases (PROP-8). The webhook stored plan_status
-- but the non-happy paths had no policy. Add the state needed to implement:
--   past_due  -> 7-day grace (keep penciling; show a fix-payment banner)
--   unpaid / canceled -> drop to free immediately (saved data untouched)
--   cancel_at_period_end -> "Investor until <date>, resubscribe" in the menu
--
-- past_due_since starts the grace clock on first entry into past_due;
-- current_period_end + cancel_at_period_end drive the account-menu copy.

BEGIN;
ALTER TABLE entitlements
  ADD COLUMN IF NOT EXISTS past_due_since       timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS current_period_end   timestamptz;
COMMIT;
