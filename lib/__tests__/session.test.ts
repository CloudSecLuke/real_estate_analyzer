import { beforeAll, describe, expect, it, vi } from "vitest";

// Control the version the verifier sees without a DB.
let currentVersion: number | null = 0;
vi.mock("@/lib/sessionVersion", () => ({
  getCachedSessionVersion: async () => currentVersion,
}));

import {
  createSessionToken,
  verifySessionToken,
  SESSION_MAX_AGE,
} from "@/lib/session";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-please-ignore";
});

async function legacyToken(username: string, exp: number): Promise<string> {
  // Reproduce the pre-PROP-6 2-field payload to prove back-compat.
  const b64url = (bytes: Uint8Array) => {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const payload = `${username}|${exp}`;
  const bytes = new TextEncoder().encode(payload);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(process.env.AUTH_SECRET!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, bytes);
  return `${b64url(bytes)}.${b64url(new Uint8Array(sig))}`;
}

describe("session tokens with revocation (PROP-6)", () => {
  it("accepts a token whose version matches the current version", async () => {
    currentVersion = 3;
    const t = await createSessionToken("alice", 3);
    expect(await verifySessionToken(t)).toBe("alice");
  });

  it("rejects a token whose version is stale (revoked)", async () => {
    const t = await createSessionToken("alice", 2);
    currentVersion = 3; // version was bumped after the token was minted
    expect(await verifySessionToken(t)).toBeNull();
  });

  it("fails open when the version store is unavailable", async () => {
    const t = await createSessionToken("alice", 7);
    currentVersion = null; // DB error path
    expect(await verifySessionToken(t)).toBe("alice");
  });

  it("rejects a token for a deleted user (version < 0)", async () => {
    const t = await createSessionToken("ghost", 0);
    currentVersion = -1;
    expect(await verifySessionToken(t)).toBeNull();
  });

  it("treats a legacy 2-field token as version 0", async () => {
    const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
    const t = await legacyToken("bob", exp);
    currentVersion = 0;
    expect(await verifySessionToken(t)).toBe("bob");
    currentVersion = 1; // a later bump revokes even legacy tokens
    expect(await verifySessionToken(t)).toBeNull();
  });

  it("rejects a tampered signature", async () => {
    currentVersion = 0;
    const t = await createSessionToken("alice", 0);
    const [payload] = t.split(".");
    expect(await verifySessionToken(`${payload}.deadbeef`)).toBeNull();
  });

  it("rejects an expired token", async () => {
    currentVersion = 0;
    // mint, then verify against an already-past expiry via a legacy token
    const past = Math.floor(Date.now() / 1000) - 10;
    expect(await verifySessionToken(await legacyToken("alice", past))).toBeNull();
  });
});
