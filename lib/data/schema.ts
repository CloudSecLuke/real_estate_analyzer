import { sql } from "@/lib/sql";

// Schema is managed exclusively by migrations/ via `npm run db:migrate`
// (see migrations/0001–0003). This module keeps its exports so existing
// callers compile, but performs NO runtime DDL.

export const dataSql = sql;

export function ensureDataSchema(): Promise<void> {
  return Promise.resolve();
}
