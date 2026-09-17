// Explicit, ordered migrations. Usage: npm run db:migrate
// Runs every migrations/NNNN_*.sql not yet recorded in schema_migrations,
// each inside its own transaction. Uses `pg` (TCP) so DDL and COPY work the
// same on Neon (sslmode=require in DATABASE_URL) and local Postgres.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { databaseUrl } from "../lib/dbUrl";

async function main() {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Set(
    (await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name)
  );
  const dir = join(process.cwd(), "migrations");
  const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    process.stdout.write(`applying ${f} ... `);
    const sql = readFileSync(join(dir, f), "utf8");
    // Files manage their own BEGIN/COMMIT; record the name in a follow-up txn.
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
    console.log("ok");
  }
  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
