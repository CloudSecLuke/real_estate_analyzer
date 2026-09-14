import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { stripeKey } from "@/lib/stripe";
import {
  FREE_PENCILS,
  getEntitlement,
  INVESTOR_MONTHLY_PENCILS,
  INVESTOR_PRICE_USD,
} from "@/lib/users";

export async function GET(req: NextRequest) {
  const user = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const ent = await getEntitlement(user);
    return NextResponse.json({
      ...ent,
      billingConfigured: Boolean(stripeKey()),
      limits: {
        free: FREE_PENCILS,
        investorMonthly: INVESTOR_MONTHLY_PENCILS,
        investorPriceUsd: INVESTOR_PRICE_USD,
      },
    });
  } catch {
    return NextResponse.json(
      { plan: "free", planStatus: "none", freeRemaining: 0, monthlyRemaining: null },
      { status: 200 }
    );
  }
}
