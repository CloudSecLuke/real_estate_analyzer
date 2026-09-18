import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { isFounder } from "@/lib/users";
import { sql } from "@/lib/sql";

// Founder-only market-demand rollup (CLAUDE_CODE_BRIEF Phase 4 step 6).
// This query is the input to every future "which county gets owned
// coverage next" decision: where are pencils happening, and what is the
// external-provider spend there.
export async function GET(req: NextRequest) {
  const user = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user || !isFounder(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await sql()`
    SELECT county_fips, state, count(*)::int AS analyses,
           sum(provider_cost_cents)::int AS provider_cost_cents
    FROM analyses
    WHERE created_at > now() - interval '90 days'
    GROUP BY 1, 2
    ORDER BY 3 DESC
  `;
  return NextResponse.json({ windowDays: 90, markets: rows });
}
