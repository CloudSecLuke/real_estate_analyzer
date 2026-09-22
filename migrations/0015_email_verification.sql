-- 0015_email_verification.sql
-- Email verification at signup (PROP-7). Emails were optional and unverified,
-- so account links (resets, receipts) could be sent to an address the account
-- owner never proved they control. Track verification and gate outbound
-- account mail on it. Same single-use hashed-token pattern as password_resets.

BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS email_verifications (
  token_hash text PRIMARY KEY,
  username   text NOT NULL,
  email      text NOT NULL,           -- the address being verified (may change later)
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE INDEX IF NOT EXISTS email_verifications_username_idx
  ON email_verifications (username);
COMMIT;
