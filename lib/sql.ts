import { neon } from "@neondatabase/serverless";
import { databaseUrl } from "@/lib/dbUrl";

// The one HTTP-driver client for the request path. Schema is managed
// exclusively by `npm run db:migrate` (migrations/*.sql) — no runtime DDL.
// Bulk tooling (COPY, transactions) uses `pg` over TCP in scripts/ instead.

type Sql = ReturnType<typeof neon>;
let _sql: Sql | null = null;

export function sql(): Sql {
  if (!_sql) _sql = neon(databaseUrl());
  return _sql;
}
