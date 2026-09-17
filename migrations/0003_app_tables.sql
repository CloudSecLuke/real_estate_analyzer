-- 0003_app_tables.sql
-- Application tables previously created lazily at request time by
-- ensureSchema() in lib/db.ts, lib/users.ts, lib/ratelimit.ts and
-- lib/health.ts. DDL now runs only from `npm run db:migrate`; the runtime
-- code paths assume these tables exist. Idempotent.

BEGIN;

-- lib/db.ts — per-user app state (pins/assumptions/history/searches)
CREATE TABLE IF NOT EXISTS user_state (
  username    text PRIMARY KEY,
  pins        jsonb NOT NULL DEFAULT '[]'::jsonb,
  assumptions jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_state ADD COLUMN IF NOT EXISTS history jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE user_state ADD COLUMN IF NOT EXISTS searches jsonb NOT NULL DEFAULT '[]'::jsonb;

-- lib/users.ts — self-serve accounts, entitlements, password resets
CREATE TABLE IF NOT EXISTS users (
  username      text PRIMARY KEY,
  email         text,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entitlements (
  username            text PRIMARY KEY,
  free_pencils_used   int NOT NULL DEFAULT 0,
  pencils_this_period int NOT NULL DEFAULT 0,
  period_start        timestamptz NOT NULL DEFAULT now(),
  plan                text NOT NULL DEFAULT 'free',
  plan_status         text NOT NULL DEFAULT 'none',
  stripe_customer_id  text,
  stripe_subscription_id text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash text PRIMARY KEY,
  username   text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);

-- lib/ratelimit.ts — fixed-window rate limiting
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       text NOT NULL,
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  count        int NOT NULL,
  PRIMARY KEY (bucket, key)
);

-- lib/health.ts — latest upstream health snapshot per source
CREATE TABLE IF NOT EXISTS health_checks (
  source     text PRIMARY KEY,
  ok         boolean NOT NULL,
  configured boolean NOT NULL,
  latency_ms int NOT NULL,
  detail     text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
