import { NextRequest, NextResponse } from "next/server";
import { resetPassword } from "@/lib/users";
import { checkRateLimit, ipKey, tooMany } from "@/lib/ratelimit";
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/session";

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit("reset_ip", ipKey(req), 10, 60 * 60);
  if (!rl.allowed) {
    return tooMany("Too many attempts — try again later.", rl.retryAfterSecs);
  }

  let token = "";
  let password = "";
  try {
    const body = await req.json();
    token = String(body.token ?? "");
    password = String(body.password ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await resetPassword(token, password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // sign them straight in with the new password
  const res = NextResponse.json({ user: result.username });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(result.username), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
