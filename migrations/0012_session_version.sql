-- 0012_session_version.sql
-- Session revocation (PROP-6). Sessions are stateless 30-day HMAC tokens with
-- no kill switch today. Embed a per-user version in the token and compare it
-- to this column on verify (cached 60s to keep the proxy cheap). Bump the
-- version to invalidate every outstanding session for a user: on password
-- reset and on an explicit "sign out everywhere". Existing tokens carry no
-- version and are treated as version 0, matching this default, so deploying
-- does not log anyone out.

BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;
COMMIT;
