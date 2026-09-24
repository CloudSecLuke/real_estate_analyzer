import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

// TEMPORARY (PROP-9 delivery check) — remove after verifying Sentry receives
// events. Token-gated so bots can't spam test events during the short window.
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("token") !== "prop9check") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const eventId = Sentry.captureException(
    new Error("PROP-9 Sentry delivery check — safe to ignore")
  );
  // flush waits for the event to actually reach Sentry (true = delivered).
  const flushed = await Sentry.flush(3000);
  return NextResponse.json({
    ok: true,
    eventId,
    flushed,
    dsnConfigured: Boolean(process.env.SENTRY_DSN),
  });
}
