import { sql as getSql } from "@/lib/sql";
import type { Assumptions, HistoryEntry, SavedPin, SavedSearch } from "./types";

// Neon Postgres (Vercel Marketplace). Lazy init so `next build` and
// key-less local dev don't crash; callers check isDbConfigured() first
// and the app degrades to non-persistent (in-memory/localStorage) state.

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}



// Schema is managed by migrations (npm run db:migrate) — no runtime DDL.

export interface UserState {
  pins: SavedPin[];
  assumptions: Omit<Assumptions, "price" | "bedrooms"> | null;
  history: HistoryEntry[];
  searches: SavedSearch[];
}

export async function getUserState(username: string): Promise<UserState> {
  const rows = (await getSql()`
    SELECT pins, assumptions, history, searches
    FROM user_state WHERE username = ${username}
  `) as {
    pins: SavedPin[];
    assumptions: UserState["assumptions"];
    history: HistoryEntry[];
    searches: SavedSearch[];
  }[];
  const row = rows[0];
  return {
    pins: row?.pins ?? [],
    assumptions: row?.assumptions ?? null,
    history: row?.history ?? [],
    searches: row?.searches ?? [],
  };
}

export async function saveUserState(
  username: string,
  state: UserState
): Promise<void> {
  await getSql()`
    INSERT INTO user_state (username, pins, assumptions, history, searches, updated_at)
    VALUES (${username}, ${JSON.stringify(state.pins)}::jsonb,
            ${state.assumptions ? JSON.stringify(state.assumptions) : null}::jsonb,
            ${JSON.stringify(state.history)}::jsonb,
            ${JSON.stringify(state.searches)}::jsonb,
            now())
    ON CONFLICT (username) DO UPDATE
      SET pins = EXCLUDED.pins,
          assumptions = EXCLUDED.assumptions,
          history = EXCLUDED.history,
          searches = EXCLUDED.searches,
          updated_at = now()
  `;
}
