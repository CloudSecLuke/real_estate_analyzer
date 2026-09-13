import { neon } from "@neondatabase/serverless";
import type { Assumptions, SavedPin } from "./types";

// Neon Postgres (Vercel Marketplace). Lazy init so `next build` and
// key-less local dev don't crash; callers check isDbConfigured() first
// and the app degrades to non-persistent (in-memory/localStorage) state.

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

type Sql = ReturnType<typeof neon>;
let _sql: Sql | null = null;
let _schemaReady: Promise<void> | null = null;

function getSql(): Sql {
  if (!_sql) _sql = neon(process.env.DATABASE_URL!);
  return _sql;
}

function ensureSchema(): Promise<void> {
  if (!_schemaReady) {
    _schemaReady = getSql()`
      CREATE TABLE IF NOT EXISTS user_state (
        username    text PRIMARY KEY,
        pins        jsonb NOT NULL DEFAULT '[]'::jsonb,
        assumptions jsonb,
        updated_at  timestamptz NOT NULL DEFAULT now()
      )
    `.then(() => undefined);
  }
  return _schemaReady;
}

export interface UserState {
  pins: SavedPin[];
  assumptions: Omit<Assumptions, "price" | "bedrooms"> | null;
}

export async function getUserState(username: string): Promise<UserState> {
  await ensureSchema();
  const rows = (await getSql()`
    SELECT pins, assumptions FROM user_state WHERE username = ${username}
  `) as { pins: SavedPin[]; assumptions: UserState["assumptions"] }[];
  const row = rows[0];
  return { pins: row?.pins ?? [], assumptions: row?.assumptions ?? null };
}

export async function saveUserState(
  username: string,
  state: UserState
): Promise<void> {
  await ensureSchema();
  await getSql()`
    INSERT INTO user_state (username, pins, assumptions, updated_at)
    VALUES (${username}, ${JSON.stringify(state.pins)}::jsonb,
            ${state.assumptions ? JSON.stringify(state.assumptions) : null}::jsonb,
            now())
    ON CONFLICT (username) DO UPDATE
      SET pins = EXCLUDED.pins,
          assumptions = EXCLUDED.assumptions,
          updated_at = now()
  `;
}
