// Guarded access to DATABASE_URL (PROP-5). Local dev must use the
// isolated `proppencil_dev` database — a test script pointed at the
// production `neondb` once wiped real user state. Production builds and
// anything explicitly opted in via ALLOW_PROD_DB=1 (e.g. a deliberate
// maintenance script) bypass the guard.

const PROD_DB_NAME = "/neondb";

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.VERCEL_ENV !== "production" &&
    process.env.ALLOW_PROD_DB !== "1" &&
    new URL(url).pathname === PROD_DB_NAME
  ) {
    throw new Error(
      "Refusing to use the PRODUCTION database (neondb) outside production. " +
        "Point DATABASE_URL at proppencil_dev (run `npm run env:dev` after a " +
        "`vercel env pull`), or set ALLOW_PROD_DB=1 if this is deliberate."
    );
  }
  return url;
}
