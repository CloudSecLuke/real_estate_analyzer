import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// Gate the whole app behind the session cookie. Unauthenticated page loads
// redirect to /login; unauthenticated API calls get a 401 (protecting the
// paid ATTOM/Mashvisor quota, not just the UI).
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const user = await verifySessionToken(
    request.cookies.get(SESSION_COOKIE)?.value
  );

  if (user) {
    if (pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (pathname === "/login" || pathname === "/api/auth/login") {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
