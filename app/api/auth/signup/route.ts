import { NextRequest, NextResponse } from "next/server";
import { createUser, createEmailVerification, isUsersDbConfigured } from "@/lib/users";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { checkRateLimit, ipKey, tooMany } from "@/lib/ratelimit";
import { reportError } from "@/lib/reportError";
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/session";

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit("signup_ip", ipKey(req), 3, 60 * 60);
  if (!rl.allowed) {
    return tooMany(
      "Too many sign-ups from this connection — try again later.",
      rl.retryAfterSecs
    );
  }

  if (!isUsersDbConfigured()) {
    return NextResponse.json(
      { error: "Sign-ups are not available right now." },
      { status: 503 }
    );
  }
  let username = "";
  let password = "";
  let email: string | null = null;
  try {
    const body = await req.json();
    username = String(body.username ?? "").trim().toLowerCase();
    password = String(body.password ?? "");
    email = body.email ? String(body.email).trim().slice(0, 200) : null;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Store the hashed signup IP so free pencils can be capped per IP/week
  // (PROP-13). ipKey already returns a sha256 hash — no raw IP is stored.
  const result = await createUser(username, password, email, ipKey(req));
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Fire a verification link if they gave an email (PROP-7). Best-effort:
  // a send failure must not block signup — the in-app nudge lets them resend.
  if (email && isEmailConfigured()) {
    try {
      const v = await createEmailVerification(username);
      if (v) {
        const link = `${req.nextUrl.origin}/api/auth/verify-email?token=${v.token}`;
        await sendEmail({
          to: v.email,
          subject: "Verify your email for PropPencil",
          text:
            `Welcome to PropPencil! Confirm this is your email so we can send ` +
            `password resets and receipts here.\n\nVerify (link expires in 24 ` +
            `hours):\n${link}\n\nIf you didn't sign up, ignore this email.`,
        });
      }
    } catch (err) {
      reportError(err, { event: "signup_verify_email_failed", severity: "error", username });
    }
  }

  // sign the new account straight in (fresh account → version 0)
  const res = NextResponse.json({ user: username });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(username, 0), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
