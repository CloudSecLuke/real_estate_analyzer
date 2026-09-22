-- 0016_grandfather_existing_emails.sql
-- One-time grandfather for PROP-7. createResetToken now requires a verified
-- email, so without this every EXISTING account (all created before
-- verification existed, email_verified_at NULL) would silently lose password
-- reset until they re-verified. Treat emails already on file at this cutover
-- as verified — they were entered by the account owner at signup, before the
-- feature existed. NEW signups after this migration get NULL and must verify.
-- Runs exactly once (tracked in schema_migrations); new rows are unaffected.

BEGIN;
UPDATE users
SET email_verified_at = created_at
WHERE email IS NOT NULL AND email_verified_at IS NULL;
COMMIT;
