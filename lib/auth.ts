import { scryptSync, timingSafeEqual } from "node:crypto";

// Deliberately minimal auth: exactly two accounts, password hashes in env
// (scrypt, "salthex:hashhex"), no user table. Sessions are signed cookies
// (lib/session.ts). Swap for a real provider if accounts ever multiply.

const USER_HASH_ENV: Record<string, string> = {
  "luke.miller": "AUTH_HASH_LUKE",
  "bart.miller": "AUTH_HASH_BART",
};

export function verifyCredentials(
  username: string,
  password: string
): boolean {
  const envName = USER_HASH_ENV[username];
  if (!envName || !password) return false;
  const stored = process.env[envName];
  if (!stored) return false;
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
