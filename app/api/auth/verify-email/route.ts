import { NextRequest, NextResponse } from "next/server";
import {
  createEmailVerification,
  verifyEmailToken,
} from "@/lib/users";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { checkRateLimit, ipKey, tooMany } from "@/lib/ratelimit";
import { reportError } from "@/lib/reportError";

// GET  /api/auth/verify-email?token=... — consume a link and redirect to the
//   app with a status flag. Public (the click may be signed-out).
// POST /api/auth/verify-email — resend the link for the logged-in user.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  let ok = false;
  try {
    ok = (await verifyEmailToken(token)).ok;
  } catch (err) {
    reportError(err, { event: "verify_email_failed", severity: "error" });
  }
  // Signed-in users land back in the app; signed-out at login. The flag drives
  // a one-line confirmation-or-invalid message.
  const signedIn = Boolean(
    await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)
  );
  const dest = new URL(signedIn ? "/app" : "/login", req.nextUrl.origin);
  dest.searchParams.set("verify", ok ? "ok" : "failed");
  return NextResponse.redirect(dest);
}

export async function POST(req: NextRequest) {
  const user = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Cap resends per account to avoid using us as a mailer.
  const rl = await checkRateLimit("verify_resend", user, 3, 60 * 60);
  if (!rl.allowed) {
    return tooMany("Too many requests — try again later.", rl.retryAfterSecs);
  }
  if (!isEmailConfigured()) {
    return NextResponse.json({ error: "Email isn't set up right now." }, { status: 503 });
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
    reportError(err, { event: "resend_verify_email_failed", severity: "error", username: user });
  }
  // Uniform ok — don't reveal whether an email exists or is already verified.
  return NextResponse.json({ ok: true });
}
