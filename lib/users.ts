import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { sql as getSql } from "@/lib/sql";

// Self-serve accounts + entitlements. The two founder accounts
// (luke.miller / bart.miller) stay in env vars with unlimited use;
// everyone else lives in Postgres with one free pencil, then a paid plan.

export const FREE_PENCILS = 1;
export const INVESTOR_MONTHLY_PENCILS = 100;
export const INVESTOR_PRICE_USD = 19;
export const INVESTOR_LOOKUP_KEY = "proppencil_investor_monthly";

const FOUNDERS = new Set(["luke.miller", "bart.miller"]);
export const isFounder = (u: string) => FOUNDERS.has(u);


export function isUsersDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}


// Schema is managed by migrations (npm run db:migrate) — no runtime DDL.

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

// --- password reset (PROP-4) ----------------------------------------------
// Tokens are 32 random bytes; only a sha256 hash is stored, single-use,
// 30-minute expiry. Founder accounts live in env vars and cannot be
// reset here — callers respond identically either way so the endpoint
// never reveals which usernames exist.

const RESET_TTL_MIN = 30;

function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Returns the raw token to email, or null when no reset is possible
 *  (unknown user, founder, or no email on file). */
export async function createResetToken(
  username: string
): Promise<{ token: string; email: string } | null> {
  const u = username.trim().toLowerCase();
  if (!isUsersDbConfigured() || isFounder(u)) return null;
  const sql = getSql();
  const rows = (await sql`
    SELECT email FROM users WHERE username = ${u}
  `) as { email: string | null }[];
  const email = rows[0]?.email;
  if (!email) return null;
  const token = randomBytes(32).toString("hex");
  await sql`
    INSERT INTO password_resets (token_hash, username, expires_at)
    VALUES (${sha256hex(token)}, ${u}, now() + make_interval(mins => ${RESET_TTL_MIN}))
  `;
  return { token, email };
}

/** Consumes a valid token and sets the new password. */
export async function resetPassword(
  token: string,
  newPassword: string
): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  if (newPassword.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  if (!isUsersDbConfigured() || !/^[0-9a-f]{64}$/.test(token)) {
    return { ok: false, error: "That reset link is invalid or has expired." };
  }
  const sql = getSql();
  const rows = (await sql`
    UPDATE password_resets SET used_at = now()
    WHERE token_hash = ${sha256hex(token)}
      AND used_at IS NULL AND expires_at > now()
    RETURNING username
  `) as { username: string }[];
  const username = rows[0]?.username;
  if (!username) {
    return { ok: false, error: "That reset link is invalid or has expired." };
  }
  await sql`
    UPDATE users SET password_hash = ${hashPassword(newPassword)}
    WHERE username = ${username}
  `;
  return { ok: true, username };
}

export async function verifyDbUser(
  username: string,
  password: string
): Promise<boolean> {
  if (!isUsersDbConfigured()) return false;
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
  const rows = (await getSql()`
    SELECT username FROM entitlements WHERE stripe_customer_id = ${customerId}
  `) as { username: string }[];
  return rows[0]?.username ?? null;
}
