import { NextRequest, NextResponse } from "next/server";
import { createEmailVerification, setUserEmail } from "@/lib/users";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { checkRateLimit, tooMany } from "@/lib/ratelimit";
import { reportError } from "@/lib/reportError";

// Set (or replace) the logged-in account's email and send a verification
// link. Lets a free-tier user add/fix an address to pass the verify gate
// (PROP-7 / PROP-13 layer 2). Setting an email always resets it to unverified.
export async function POST(req: NextRequest) {
  const user = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rl = await checkRateLimit("account_email", user, 5, 60 * 60);
  if (!rl.allowed) {
    return tooMany("Too many changes — try again later.", rl.retryAfterSecs);
  }
  let email = "";
  try {
    email = String((await req.json()).email ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const set = await setUserEmail(user, email);
  if (!set.ok) {
    return NextResponse.json({ error: set.error }, { status: 400 });
  }
  if (!isEmailConfigured()) {
    // Email saved, but we can't send the link right now.
    return NextResponse.json({ ok: true, sent: false });
  }
  try {
    const v = await createEmailVerification(user);
    if (v) {
      const link = `${req.nextUrl.origin}/api/auth/verify-email?token=${v.token}`;
      await sendEmail({
        to: v.email,
        subject: "Verify your email for PropPencil",
        text:
          `Confirm your email so we can send password resets and receipts ` +
          `here.\n\nVerify (link expires in 24 hours):\n${link}`,
      });
    }
  } catch (err) {
    reportError(err, { event: "account_email_verify_send_failed", severity: "error", username: user });
  }
  return NextResponse.json({ ok: true, sent: true });
}
