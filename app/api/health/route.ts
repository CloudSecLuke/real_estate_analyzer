import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { isFounder } from "@/lib/users";
import { isEmailConfigured, sendEmail } from "@/lib/email";
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
    if (isCron) {
      // nightly provider-cache hygiene: expired commercial responses must
      // not outlive their TTL (vendor terms) — Phase 4 step 3.
      const { sql } = await import("@/lib/sql");
      try {
        await sql()`DELETE FROM provider_cache WHERE expires_at < now()`;
      } catch (err) {
        console.error("provider_cache_cleanup_failed", err);
      }
    }
    results = await runHealthChecks();
    await storeHealthResults(results).catch((err) =>
      console.error("health_store_failed", err)
    );
    const down = results.filter((r) => r.configured && !r.ok);
    const dates = upcomingKeyDates();
    if (down.length > 0 || dates.length > 0) {
      const lines = [
        ...down.map((d) => `DOWN: ${d.source} — ${d.detail}`),
        ...dates.map((k) => `RENEWAL: ${k.label} on ${k.date} (${k.daysAway} days)`),
      ];
      // Greppable for Vercel log alerts even when email is configured.
      console.error("HEALTH_ALERT", lines.join("; "));
      if (isCron && isEmailConfigured()) {
        await sendEmail({
          to: process.env.ALERT_EMAIL ?? "luke.f.miller.8@gmail.com",
          subject: `PropPencil health: ${down.length > 0 ? `${down.length} source(s) down` : "renewal reminder"}`,
          text: lines.join("\n") + "\n\nDetails: https://www.proppencil.com/api/health (founder login)",
        }).catch(() => {});
      }
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
