import { sql as getSql } from "@/lib/sql";
import { isFounder, isUsersDbConfigured } from "@/lib/accounts";

// Session-version lookups for revocation (PROP-6). Kept out of lib/session.ts
// so that file stays a small HMAC primitive; this module owns the DB + cache.
//
// Founders live in env vars, not the users table — their version comes from
// FOUNDER_SESSION_VERSION (default 0), so a founder "logout everywhere" is an
// env bump + redeploy, exactly as the rest of the founder auth works.

const CACHE_TTL_MS = 60_000; // a revoked session may live at most this long
const cache = new Map<string, { version: number; expires: number }>();

function founderVersion(): number {
  const v = Number(process.env.FOUNDER_SESSION_VERSION ?? 0);
  return Number.isFinite(v) ? v : 0;
}

/** Authoritative current version (no cache) — used when minting a token.
 *  Returns -1 for a non-founder username with no row (deleted/unknown user). */
export async function getSessionVersion(username: string): Promise<number> {
  if (isFounder(username)) return founderVersion();
  if (!isUsersDbConfigured()) return 0; // dev/test without a DB: versionless
  const rows = (await getSql()`
    SELECT session_version FROM users WHERE username = ${username}
  `) as { session_version: number }[];
  if (rows.length === 0) return -1;
  return Number(rows[0].session_version) || 0;
}

/** Cached current version for the hot verify path. On a DB error it fails
 *  OPEN (returns null) so a database blip never mass-logs-out every user —
 *  the tradeoff is that a revocation may not take effect until the DB
 *  recovers, which is strictly better than the zero-revocation status quo. */
export async function getCachedSessionVersion(
  username: string
): Promise<number | null> {
  const hit = cache.get(username);
  const now = Date.now();
  if (hit && hit.expires > now) return hit.version;
  try {
    const version = await getSessionVersion(username);
    cache.set(username, { version, expires: now + CACHE_TTL_MS });
    return version;
  } catch {
    return null; // fail open — see doc comment
  }
}

/** Invalidate every outstanding session for a user (password reset,
 *  "sign out everywhere"). No-op for founders (env-versioned). */
export async function bumpSessionVersion(username: string): Promise<void> {
  if (isFounder(username) || !isUsersDbConfigured()) return;
  await getSql()`
    UPDATE users SET session_version = session_version + 1 WHERE username = ${username}
  `;
  cache.delete(username);
}
