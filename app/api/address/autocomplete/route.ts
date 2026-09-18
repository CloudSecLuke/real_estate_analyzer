import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { firstResult } from "@/lib/providers/registry";

// Address typeahead (PROP-33/41): serves suggestions through the provider
// registry — owned county data first (free, trigram-indexed), mock in
// demo mode. Authed like every API route; results are suggestions only,
// no provider keys or vendor payloads reach the browser.
export async function GET(req: NextRequest) {
  const user = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 3) {
    return NextResponse.json({ suggestions: [] });
  }
  const hit = await firstResult("address", async (p) => {
    const s = await p.autocomplete(q);
    return s.length > 0 ? s : null;
  });
  return NextResponse.json({
    suggestions: (hit?.result ?? []).slice(0, 8).map((s) => ({
      displayAddress: s.displayAddress,
      city: s.city ?? null,
      state: s.state ?? null,
      postalCode: s.postalCode ?? null,
    })),
    source: hit?.provider ?? null,
  });
}
