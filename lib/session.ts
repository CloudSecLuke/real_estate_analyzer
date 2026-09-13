// Signed session tokens using Web Crypto HMAC so verification works both in
// proxy.ts and in route handlers. Token: base64url(payload).base64url(sig),
// payload = "username|expiryEpochSeconds".

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

export async function createSessionToken(username: string): Promise<string> {
  const payload = `${username}|${Math.floor(Date.now() / 1000) + SESSION_MAX_AGE}`;
  const payloadBytes = new TextEncoder().encode(payload);
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), payloadBytes);
  return `${b64url(payloadBytes)}.${b64url(new Uint8Array(sig))}`;
}

/** Returns the username for a valid, unexpired token; null otherwise. */
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
  const sep = payload.lastIndexOf("|");
  if (sep === -1) return null;
  const username = payload.slice(0, sep);
  const exp = Number(payload.slice(sep + 1));
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  return username;
}
