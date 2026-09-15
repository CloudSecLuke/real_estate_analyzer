import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { databaseUrl } from "./dbUrl";

// Self-serve accounts + entitlements. The two founder accounts
// (luke.miller / bart.miller) stay in env vars with unlimited use;
// everyone else lives in Postgres with one free pencil, then a paid plan.

export const FREE_PENCILS = 1;
export const INVESTOR_MONTHLY_PENCILS = 100;
export const INVESTOR_PRICE_USD = 19;
export const INVESTOR_LOOKUP_KEY = "proppencil_investor_monthly";

const FOUNDERS = new Set(["luke.miller", "bart.miller"]);
export const isFounder = (u: string) => FOUNDERS.has(u);

type Sql = ReturnType<typeof neon>;
let _sql: Sql | null = null;
let _schemaReady: Promise<void> | null = null;

export function isUsersDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function getSql(): Sql {
  if (!_sql) _sql = neon(databaseUrl());
  return _sql;
}

function ensureSchema(): Promise<void> {
  if (!_schemaReady) {
    const sql = getSql();
    _schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS users (
          username      text PRIMARY KEY,
          email         text,
          password_hash text NOT NULL,
          created_at    timestamptz NOT NULL DEFAULT now()
        )
      `;
      await sql`
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
        )
      `;
    })();
  }
  return _schemaReady;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyHash(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), 64, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;

export async function createUser(
  username: string,
  password: string,
  email: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const u = username.trim().toLowerCase();
  if (!USERNAME_RE.test(u)) {
    return {
      ok: false,
      error:
        "Username must be 3–30 characters: lowercase letters, numbers, dots, dashes or underscores.",
    };
  }
  if (isFounder(u)) return { ok: false, error: "That username is taken." };
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  await ensureSchema();
  const sql = getSql();
  const existing =
    (await sql`SELECT 1 FROM users WHERE username = ${u}`) as unknown[];
  if (existing.length > 0) return { ok: false, error: "That username is taken." };
  await sql`
    INSERT INTO users (username, email, password_hash)
    VALUES (${u}, ${email}, ${hashPassword(password)})
  `;
  await sql`
    INSERT INTO entitlements (username) VALUES (${u})
    ON CONFLICT (username) DO NOTHING
  `;
  return { ok: true };
}

export async function verifyDbUser(
  username: string,
  password: string
): Promise<boolean> {
  if (!isUsersDbConfigured()) return false;
  await ensureSchema();
  const rows = (await getSql()`
    SELECT password_hash FROM users WHERE username = ${username}
  `) as { password_hash: string }[];
  const stored = rows[0]?.password_hash;
  if (!stored) return false;
  return verifyHash(password, stored);
}

export interface Entitlement {
  plan: "founder" | "free" | "investor";
  planStatus: string;
  freeRemaining: number;
  monthlyRemaining: number | null; // null = unlimited
  stripeCustomerId: string | null;
}

const PERIOD_MS = 31 * 24 * 60 * 60 * 1000;

interface EntRow {
  free_pencils_used: number;
  pencils_this_period: number;
  period_start: string;
  plan: string;
  plan_status: string;
  stripe_customer_id: string | null;
}

async function getRow(username: string): Promise<EntRow | null> {
  await ensureSchema();
  const rows = (await getSql()`
    SELECT free_pencils_used, pencils_this_period, period_start, plan,
           plan_status, stripe_customer_id
    FROM entitlements WHERE username = ${username}
  `) as EntRow[];
  return rows[0] ?? null;
}

export async function getEntitlement(username: string): Promise<Entitlement> {
  if (isFounder(username)) {
    return {
      plan: "founder",
      planStatus: "active",
      freeRemaining: 0,
      monthlyRemaining: null,
      stripeCustomerId: null,
    };
  }
  const row = await getRow(username);
  const active = row?.plan === "investor" && row.plan_status === "active";
  const periodExpired =
    row != null && Date.now() - new Date(row.period_start).getTime() > PERIOD_MS;
  const used = active && !periodExpired ? (row?.pencils_this_period ?? 0) : 0;
  return {
    plan: active ? "investor" : "free",
    planStatus: row?.plan_status ?? "none",
    freeRemaining: Math.max(0, FREE_PENCILS - (row?.free_pencils_used ?? 0)),
    monthlyRemaining: active
      ? Math.max(0, INVESTOR_MONTHLY_PENCILS - used)
      : null,
    stripeCustomerId: row?.stripe_customer_id ?? null,
  };
}

export type PencilPermission =
  | { allowed: true; source: "founder" | "plan" | "free" }
  | { allowed: false; reason: "upgrade" | "quota" };

export async function canPencil(username: string): Promise<PencilPermission> {
  const ent = await getEntitlement(username);
  if (ent.plan === "founder") return { allowed: true, source: "founder" };
  if (ent.plan === "investor") {
    return (ent.monthlyRemaining ?? 0) > 0
      ? { allowed: true, source: "plan" }
      : { allowed: false, reason: "quota" };
  }
  return ent.freeRemaining > 0
    ? { allowed: true, source: "free" }
    : { allowed: false, reason: "upgrade" };
}

export async function recordPencil(
  username: string,
  source: "founder" | "plan" | "free"
): Promise<void> {
  if (source === "founder") return;
  await ensureSchema();
  const sql = getSql();
  if (source === "free") {
    await sql`
      UPDATE entitlements
      SET free_pencils_used = free_pencils_used + 1, updated_at = now()
      WHERE username = ${username}
    `;
    return;
  }
  // roll the monthly period forward when it has lapsed
  await sql`
    UPDATE entitlements
    SET pencils_this_period = CASE
          WHEN now() - period_start > interval '31 days' THEN 1
          ELSE pencils_this_period + 1
        END,
        period_start = CASE
          WHEN now() - period_start > interval '31 days' THEN now()
          ELSE period_start
        END,
        updated_at = now()
    WHERE username = ${username}
  `;
}

export async function applySubscription(args: {
  username: string;
  customerId: string;
  subscriptionId: string | null;
  status: "active" | "canceled" | "past_due" | "none";
}): Promise<void> {
  await ensureSchema();
  await getSql()`
    UPDATE entitlements
    SET plan = 'investor',
        plan_status = ${args.status},
        stripe_customer_id = ${args.customerId},
        stripe_subscription_id = ${args.subscriptionId},
        updated_at = now()
    WHERE username = ${args.username}
  `;
}

export async function findUsernameByCustomer(
  customerId: string
): Promise<string | null> {
  await ensureSchema();
  const rows = (await getSql()`
    SELECT username FROM entitlements WHERE stripe_customer_id = ${customerId}
  `) as { username: string }[];
  return rows[0]?.username ?? null;
}
