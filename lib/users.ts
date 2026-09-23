import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { sql as getSql } from "@/lib/sql";
import { isFounder, isUsersDbConfigured } from "@/lib/accounts";

// Self-serve accounts + entitlements. The two founder accounts
// (luke.miller / bart.miller) stay in env vars with unlimited use;
// everyone else lives in Postgres with one free pencil, then a paid plan.

export const FREE_PENCILS = 1;
export const INVESTOR_MONTHLY_PENCILS = 100;
export const INVESTOR_PRICE_USD = 19;
export const INVESTOR_LOOKUP_KEY = "proppencil_investor_monthly";

// Re-export for existing import sites (edge-reachable code should import
// these from @/lib/accounts directly to stay crypto-free).
export { isFounder, isUsersDbConfigured };


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
  email: string | null,
  signupIpHash: string | null = null
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
    INSERT INTO users (username, email, password_hash, signup_ip_hash)
    VALUES (${u}, ${email}, ${hashPassword(password)}, ${signupIpHash})
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
 *  (unknown user, founder, or no VERIFIED email on file). An unverified
 *  address is treated as absent (PROP-7) — we never send a reset link to an
 *  address the account owner hasn't proven they control. */
export async function createResetToken(
  username: string
): Promise<{ token: string; email: string } | null> {
  const u = username.trim().toLowerCase();
  if (!isUsersDbConfigured() || isFounder(u)) return null;
  const sql = getSql();
  const rows = (await sql`
    SELECT email FROM users
    WHERE username = ${u} AND email_verified_at IS NOT NULL
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

// --- email verification (PROP-7) -------------------------------------------
// Same single-use hashed-token pattern as password reset, 24h expiry. An
// account stays valid without a verified email (email is optional) — but its
// address receives no account mail until verified.

const VERIFY_TTL_HOURS = 24;

/** Mint a verification token for the user's current email, or null when there
 *  is nothing to verify (no DB, founder, no email, or already verified). */
export async function createEmailVerification(
  username: string
): Promise<{ token: string; email: string } | null> {
  const u = username.trim().toLowerCase();
  if (!isUsersDbConfigured() || isFounder(u)) return null;
  const sql = getSql();
  const rows = (await sql`
    SELECT email, email_verified_at FROM users WHERE username = ${u}
  `) as { email: string | null; email_verified_at: string | null }[];
  const row = rows[0];
  if (!row?.email || row.email_verified_at) return null; // nothing to verify
  const token = randomBytes(32).toString("hex");
  await sql`
    INSERT INTO email_verifications (token_hash, username, email, expires_at)
    VALUES (${sha256hex(token)}, ${u}, ${row.email},
            now() + make_interval(hours => ${VERIFY_TTL_HOURS}))
  `;
  return { token, email: row.email };
}

/** Consume a valid verification token and stamp the email verified. Only
 *  marks verified if the stored email still matches the account's current
 *  email (a later email change invalidates an outstanding link). */
export async function verifyEmailToken(
  token: string
): Promise<{ ok: true; username: string } | { ok: false }> {
  if (!isUsersDbConfigured() || !/^[0-9a-f]{64}$/.test(token)) {
    return { ok: false };
  }
  const sql = getSql();
  const rows = (await sql`
    UPDATE email_verifications SET used_at = now()
    WHERE token_hash = ${sha256hex(token)}
      AND used_at IS NULL AND expires_at > now()
    RETURNING username, email
  `) as { username: string; email: string }[];
  const row = rows[0];
  if (!row) return { ok: false };
  const updated = (await sql`
    UPDATE users SET email_verified_at = now()
    WHERE username = ${row.username} AND email = ${row.email}
      AND email_verified_at IS NULL
    RETURNING username
  `) as { username: string }[];
  // Token consumed either way; success is reported only if the address still
  // matches (idempotent re-clicks after a change report failure, which is fine).
  return updated[0] ? { ok: true, username: row.username } : { ok: false };
}

/** Account flags for the client (nudge banner + status). */
export async function getAccountFlags(
  username: string
): Promise<{ hasEmail: boolean; emailVerified: boolean }> {
  if (isFounder(username)) return { hasEmail: false, emailVerified: false };
  if (!isUsersDbConfigured()) return { hasEmail: false, emailVerified: false };
  const rows = (await getSql()`
    SELECT email, email_verified_at FROM users WHERE username = ${username}
  `) as { email: string | null; email_verified_at: string | null }[];
  const row = rows[0];
  return {
    hasEmail: Boolean(row?.email),
    emailVerified: Boolean(row?.email_verified_at),
  };
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
  // Bump session_version so every other outstanding session for this user is
  // revoked on next verify (PROP-6) — a reset should kick out a thief.
  await sql`
    UPDATE users
    SET password_hash = ${hashPassword(newPassword)},
        session_version = session_version + 1
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
  /** In the past_due grace window: keep full access, but prompt to fix payment. */
  pastDue: boolean;
  /** ISO instant the grace window ends (null unless pastDue). */
  graceEndsAt: string | null;
  /** Subscription set to end at period close — still active until then. */
  cancelAtPeriodEnd: boolean;
  /** ISO instant the current paid period ends (for "Investor until <date>"). */
  currentPeriodEnd: string | null;
}

const PERIOD_MS = 31 * 24 * 60 * 60 * 1000;
// past_due keeps full access for this long (dunning/Smart Retries window)
// before the account drops to free. unpaid/canceled drop immediately.
export const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

interface EntRow {
  free_pencils_used: number;
  pencils_this_period: number;
  period_start: string;
  plan: string;
  plan_status: string;
  stripe_customer_id: string | null;
  past_due_since: string | null;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
}

async function getRow(username: string): Promise<EntRow | null> {
  const rows = (await getSql()`
    SELECT free_pencils_used, pencils_this_period, period_start, plan,
           plan_status, stripe_customer_id, past_due_since,
           cancel_at_period_end, current_period_end
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
      pastDue: false,
      graceEndsAt: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    };
  }
  const row = await getRow(username);
  // past_due keeps access during the grace window; unpaid/canceled do not.
  const inGrace =
    row?.plan_status === "past_due" &&
    row.past_due_since != null &&
    Date.now() - new Date(row.past_due_since).getTime() < PAST_DUE_GRACE_MS;
  const active =
    row?.plan === "investor" && (row.plan_status === "active" || inGrace);
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
    pastDue: Boolean(inGrace),
    graceEndsAt:
      inGrace && row?.past_due_since
        ? new Date(new Date(row.past_due_since).getTime() + PAST_DUE_GRACE_MS).toISOString()
        : null,
    cancelAtPeriodEnd: Boolean(active && row?.cancel_at_period_end),
    // neon returns timestamptz as a Date — normalize to ISO so the type
    // (and every consumer) sees a string, not a Date.
    currentPeriodEnd:
      active && row?.current_period_end
        ? new Date(row.current_period_end).toISOString()
        : null,
  };
}

export type PencilPermission =
  | { allowed: true; source: "founder" | "plan" | "free" }
  | { allowed: false; reason: "upgrade" | "quota" | "ip_capped" | "verify_email" };

// Layer-2 abuse gate (PROP-13 / PROP-7): the free pencil requires a verified
// email — the strongest deterrent against scripted throwaway signups. On by
// default; set FREE_PENCIL_REQUIRES_VERIFIED_EMAIL=0 to disable without a
// deploy if it ever hurts conversion.
export function freePencilRequiresVerifiedEmail(): boolean {
  return process.env.FREE_PENCIL_REQUIRES_VERIFIED_EMAIL !== "0";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Minimal email-shape check shared by signup and setUserEmail. */
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/** Set/replace the account email and reset its verification (PROP-7). Lets a
 *  free-tier user add or fix an address so they can pass the verify gate. */
export async function setUserEmail(
  username: string,
  email: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const e = email.trim().toLowerCase().slice(0, 200);
  if (!EMAIL_RE.test(e)) return { ok: false, error: "Enter a valid email address." };
  if (!isUsersDbConfigured()) return { ok: false, error: "Not available right now." };
  await getSql()`
    UPDATE users SET email = ${e}, email_verified_at = NULL WHERE username = ${username}
  `;
  return { ok: true };
}

// Free-tier abuse cap (PROP-13): at most this many free-tier accounts from a
// single signup IP get their free pencil within a rolling week. The 4th+
// account from that IP is asked to subscribe instead. Ranked by signup time
// so the earlier, legitimate accounts are never retroactively blocked.
export const FREE_PENCILS_PER_IP_WEEK = 3;
const IP_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function allowlistedIpHashes(): Set<string> {
  return new Set(
    (process.env.FREE_PENCIL_IP_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/** True when this user's free pencil should be withheld because too many
 *  free-tier accounts already came from the same signup IP this week.
 *  Fails OPEN (returns false) on any error or missing data — a check outage
 *  must never wrongly deny a legitimate free pencil. */
export async function freeTierBlocked(username: string): Promise<boolean> {
  try {
    const rows = (await getSql()`
      SELECT signup_ip_hash, created_at FROM users WHERE username = ${username}
    `) as { signup_ip_hash: string | null; created_at: string }[];
    const me = rows[0];
    if (!me?.signup_ip_hash) return false; // legacy/no-IP account — allow
    if (allowlistedIpHashes().has(me.signup_ip_hash)) return false;
    // Count accounts from the same IP created earlier, within the trailing
    // week. >= the cap means this account is the 4th+ → block its free pencil.
    const earlier = (await getSql()`
      SELECT count(*)::int AS n FROM users
      WHERE signup_ip_hash = ${me.signup_ip_hash}
        AND created_at < ${me.created_at}
        AND created_at > now() - ${`${IP_WEEK_MS / 1000} seconds`}::interval
    `) as { n: number }[];
    return (earlier[0]?.n ?? 0) >= FREE_PENCILS_PER_IP_WEEK;
  } catch {
    return false; // fail open
  }
}

export async function canPencil(username: string): Promise<PencilPermission> {
  const ent = await getEntitlement(username);
  if (ent.plan === "founder") return { allowed: true, source: "founder" };
  if (ent.plan === "investor") {
    return (ent.monthlyRemaining ?? 0) > 0
      ? { allowed: true, source: "plan" }
      : { allowed: false, reason: "quota" };
  }
  if (ent.freeRemaining > 0) {
    if (freePencilRequiresVerifiedEmail()) {
      const flags = await getAccountFlags(username);
      if (!flags.emailVerified) return { allowed: false, reason: "verify_email" };
    }
    return (await freeTierBlocked(username))
      ? { allowed: false, reason: "ip_capped" }
      : { allowed: true, source: "free" };
  }
  return { allowed: false, reason: "upgrade" };
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
  status: "active" | "canceled" | "past_due" | "unpaid" | "none";
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: string | null; // ISO
}): Promise<void> {
  // past_due_since starts the grace clock on first entry and clears on any
  // other status, so a recovered payment resets the window cleanly.
  await getSql()`
    UPDATE entitlements
    SET plan = 'investor',
        plan_status = ${args.status},
        stripe_customer_id = ${args.customerId},
        stripe_subscription_id = ${args.subscriptionId},
        past_due_since = CASE
          WHEN ${args.status} = 'past_due' THEN COALESCE(past_due_since, now())
          ELSE NULL
        END,
        cancel_at_period_end = ${args.cancelAtPeriodEnd ?? false},
        current_period_end = ${args.currentPeriodEnd ?? null},
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
