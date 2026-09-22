-- 0014_signup_ip_hash.sql
-- Free-pencil abuse controls (PROP-13). Accounts are free and instant, so a
-- freeloader can script signups and farm the one free pencil each, burning
-- paid Mashvisor/ATTOM quota. Record a hashed signup IP and cap how many
-- free-tier accounts from one IP get a free pencil per rolling week. Raw IPs
-- are never stored — only the same sha256 hash the rate limiter uses.

BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip_hash text;
-- Supports the per-IP, trailing-week ranking query in freeTierBlocked().
CREATE INDEX IF NOT EXISTS users_signup_ip_created_idx
  ON users (signup_ip_hash, created_at);
COMMIT;
