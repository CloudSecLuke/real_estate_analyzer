import { NextRequest, NextResponse } from "next/server";
import { createResetToken } from "@/lib/users";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { checkRateLimit, ipKey, tooMany } from "@/lib/ratelimit";
import { reportError } from "@/lib/reportError";

// Always responds 200 with the same body — whether the username exists,
// has an email, or is a founder — so the endpoint can't be used to
// enumerate accounts. The only non-200s are rate limiting and the
// email provider being unconfigured (a truthful, non-revealing state).
export async function POST(req: NextRequest) {
  const rl = await checkRateLimit("forgot_ip", ipKey(req), 3, 60 * 60);
  if (!rl.allowed) {
    return tooMany(
      "Too many reset requests — try again later.",
      rl.retryAfterSecs
    );
  }

  if (!isEmailConfigured()) {
    return NextResponse.json(
      {
        error:
          "Password reset email isn't set up yet — contact luke.f.miller.8@gmail.com and we'll reset it for you.",
      },
      { status: 503 }
    );
  }

  let username = "";
  try {
    const body = await req.json();
    username = String(body.username ?? "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (username) {
    // Report but stay silent to the caller (uniform 200) — a DB or email
    // failure here must not reveal whether the account exists, but it also
    // must not be invisible: a swallowed failure means a user who asked for
    // a reset never got one.
    const reset = await createResetToken(username).catch((err) => {
      reportError(err, { event: "create_reset_token_failed", severity: "error" });
      return null;
    });
    if (reset) {
      const link = `${req.nextUrl.origin}/reset?token=${reset.token}`;
      await sendEmail({
        to: reset.email,
        subject: "Reset your PropPencil password",
        text:
          `Someone (hopefully you) asked to reset the password for the ` +
          `PropPencil account "${username}".\n\n` +
          `Reset it here (link expires in 30 minutes):\n${link}\n\n` +
          `If you didn't ask for this, ignore this email — your password ` +
          `is unchanged.`,
      }).catch((err) =>
        reportError(err, { event: "reset_email_send_failed", severity: "error" })
      );
    }
  }

  return NextResponse.json({
    ok: true,
    message:
      "If that account has an email on file, a reset link is on its way. Check spam too.",
  });
}
