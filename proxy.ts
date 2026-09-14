import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// Routing + auth gate. The marketing landing page lives at "/" and is
// public; the app lives at /app behind the session cookie. Signed-in
// visitors hitting "/" or /login go straight into the app; signed-out
// visitors hitting the app are sent to /login with a `next` param so the
// landing page's address funnel survives the round-trip.
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const user = await verifySessionToken(
    request.cookies.get(SESSION_COOKIE)?.value
  );

  // Routes with their own auth: Stripe signs webhook calls; the health
  // endpoint checks CRON_SECRET / founder session itself.
  if (pathname === "/api/billing/webhook" || pathname === "/api/health") {
    return NextResponse.next();
  }

  if (user) {
    if (pathname === "/login" || pathname === "/signup" || pathname === "/") {
      return NextResponse.redirect(new URL("/app", request.url));
    }
    return NextResponse.next();
  }

  if (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/signup"
  ) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png).*)"],
};
