import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { bumpSessionVersion } from "@/lib/sessionVersion";
import { reportError } from "@/lib/reportError";

// "Sign out everywhere" (PROP-6): bumps the user's session_version, which
// revokes every outstanding token for the account (this browser included),
// then clears this browser's cookie. Other devices lose access within the
// 60s verify cache TTL.
export async function POST(req: NextRequest) {
  const user = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await bumpSessionVersion(user);
  } catch (err) {
    reportError(err, {
      event: "logout_all_failed",
      severity: "error",
      username: user,
    });
    return NextResponse.json(
      { error: "Could not sign out other sessions — try again." },
      { status: 500 }
    );
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
