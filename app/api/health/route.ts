import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { isFounder } from "@/lib/users";
import {
  latestHealthResults,
  runHealthChecks,
  storeHealthResults,
  upcomingKeyDates,
} from "@/lib/health";

// Upstream health (PROP-3). Two callers:
// - Vercel cron (Authorization: Bearer CRON_SECRET, sent automatically
//   when the env var is set) → always runs live checks and stores them.
// - A signed-in founder in the browser → returns the stored snapshot;
//   ?run=1 forces live checks. Founders only: the check itself spends
//   paid Mashvisor/ATTOM quota and the details are operational.
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const isCron =
    Boolean(cronSecret) &&
    req.headers.get("authorization") === `Bearer ${cronSecret}`;

  let founder = false;
  if (!isCron) {
    const user = await verifySessionToken(
      req.cookies.get(SESSION_COOKIE)?.value
    );
    founder = Boolean(user && isFounder(user));
    if (!founder) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const runLive = isCron || req.nextUrl.searchParams.get("run") === "1";
  let results;
  if (runLive) {
    results = await runHealthChecks();
    await storeHealthResults(results).catch((err) =>
      console.error("health_store_failed", err)
    );
    const down = results.filter((r) => r.configured && !r.ok);
    if (down.length > 0) {
      // Loud, greppable line for Vercel log alerts until an email
      // provider lands (PROP-4 wires this to actual alert emails).
      console.error(
        "HEALTH_ALERT sources down:",
        down.map((d) => `${d.source} (${d.detail})`).join("; ")
      );
    }
  } else {
    results = await latestHealthResults();
  }

  return NextResponse.json({
    live: runLive,
    results,
    keyDateWarnings: upcomingKeyDates(),
  });
}
