import { scryptSync, timingSafeEqual } from "node:crypto";
import { verifyDbUser } from "./users";

// Auth: the two founder accounts live as scrypt hashes in env vars
// ("salthex:hashhex"); self-serve accounts live in Postgres (lib/users.ts).
// Sessions are signed cookies (lib/session.ts) either way.

const USER_HASH_ENV: Record<string, string> = {
  "luke.miller": "AUTH_HASH_LUKE",
  "bart.miller": "AUTH_HASH_BART",
};

function verifyFounder(username: string, password: string): boolean {
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

export async function verifyCredentials(
  username: string,
  password: string
): Promise<boolean> {
  if (!password) return false;
  if (USER_HASH_ENV[username]) return verifyFounder(username, password);
  return verifyDbUser(username, password);
}
