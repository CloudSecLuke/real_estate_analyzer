// Signed session tokens using Web Crypto HMAC so verification works both in
// proxy.ts and in route handlers. Token: base64url(payload).base64url(sig),
// payload = "username|sessionVersion|expiryEpochSeconds".
//
// The version (PROP-6) is compared against the user's current session_version
// on verify so sessions can be revoked. Legacy tokens minted before PROP-6
// have the 2-field payload "username|expiry" and are read as version 0 —
// matching the column default, so the change logs no one out.

import { getCachedSessionVersion } from "@/lib/sessionVersion";

export const SESSION_COOKIE = "rea_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacKey(): Promise<CryptoKey> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createSessionToken(
  username: string,
  sessionVersion: number
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = `${username}|${sessionVersion}|${exp}`;
  const payloadBytes = new TextEncoder().encode(payload);
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), payloadBytes);
  return `${b64url(payloadBytes)}.${b64url(new Uint8Array(sig))}`;
}

/** Returns the username for a valid, unexpired, un-revoked token; null
 *  otherwise. Username never contains "|" (enforced by USERNAME_RE), so the
 *  payload splits unambiguously. */
export async function verifySessionToken(
  token: string | undefined
): Promise<string | null> {
  if (!token) return null;
  const [payloadPart, sigPart] = token.split(".");
  if (!payloadPart || !sigPart) return null;
  const payloadBytes = fromB64url(payloadPart);
  const sigBytes = fromB64url(sigPart);
  if (!payloadBytes || !sigBytes) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      sigBytes as BufferSource,
      payloadBytes as BufferSource
    );
  } catch {
    return null;
  }
  if (!ok) return null;
  const payload = new TextDecoder().decode(payloadBytes);
  const parts = payload.split("|");
  // New tokens: username|version|expiry. Legacy: username|expiry (version 0).
  let username: string, tokenVersion: number, exp: number;
  if (parts.length === 3) {
    username = parts[0];
    tokenVersion = Number(parts[1]);
    exp = Number(parts[2]);
  } else if (parts.length === 2) {
    username = parts[0];
    tokenVersion = 0;
    exp = Number(parts[1]);
  } else {
    return null;
  }
  if (!username || !Number.isFinite(tokenVersion)) return null;
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;

  // Revocation check (cached 60s; fails open on DB error).
  const current = await getCachedSessionVersion(username);
  if (current === null) return username; // DB unavailable — fail open
  if (current < 0) return null; // no such user (deleted)
  if (current !== tokenVersion) return null; // revoked / superseded
  return username;
}
