import { NextRequest, NextResponse } from "next/server";
import { verifyCredentials } from "@/lib/auth";
import { getSessionVersion } from "@/lib/sessionVersion";
import { checkRateLimit, ipKey, tooMany } from "@/lib/ratelimit";
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/session";

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit("login_ip", ipKey(req), 10, 60);
  if (!rl.allowed) {
    return tooMany(
      "Too many sign-in attempts — wait a minute and try again.",
      rl.retryAfterSecs
    );
  }

  let username = "";
  let password = "";
  let remember = true;
  try {
    const body = await req.json();
    username = String(body.username ?? "").trim().toLowerCase();
    password = String(body.password ?? "");
    remember = body.remember !== false;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Per-account ceiling so a distributed guesser can't focus one
  // username across many IPs. Counted on every attempt, so the limit
  // is lax enough that a fumbling legit user never meets it.
  if (username) {
    const rlUser = await checkRateLimit("login_user", username, 20, 15 * 60);
    if (!rlUser.allowed) {
      return tooMany(
        "Too many attempts for this account — wait a few minutes and try again.",
        rlUser.retryAfterSecs
      );
    }
  }

  if (!(await verifyCredentials(username, password))) {
    return NextResponse.json(
      { error: "Invalid username or password." },
      { status: 401 }
    );
  }

  const res = NextResponse.json({ user: username });
  const version = await getSessionVersion(username);
  res.cookies.set(SESSION_COOKIE, await createSessionToken(username, version), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // "Keep me signed in" unchecked → session cookie (gone on browser close)
    ...(remember ? { maxAge: SESSION_MAX_AGE } : {}),
  });
  return res;
}
