// Crypto-free account primitives. Kept separate from lib/users.ts so that
// edge-reachable code (lib/session.ts → lib/sessionVersion.ts, imported by
// proxy.ts) can use them without pulling node:crypto (scrypt) into the proxy
// bundle. lib/users.ts re-exports these for existing import sites.

// The two founder accounts (luke.miller / bart.miller) live in env vars with
// unlimited use; everyone else lives in Postgres.
export const FOUNDERS = new Set(["luke.miller", "bart.miller"]);
export const isFounder = (u: string): boolean => FOUNDERS.has(u);

export function isUsersDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
