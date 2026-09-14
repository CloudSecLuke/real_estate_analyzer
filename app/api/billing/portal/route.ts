import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { getStripe } from "@/lib/stripe";
import { getEntitlement } from "@/lib/users";

// Stripe customer portal: cancel / update payment method.
export async function POST(req: NextRequest) {
  const user = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Billing isn't configured yet." }, { status: 503 });
  }
  const ent = await getEntitlement(user);
  if (!ent.stripeCustomerId) {
    return NextResponse.json({ error: "No billing account yet." }, { status: 400 });
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: ent.stripeCustomerId,
    return_url: `${req.nextUrl.origin}/app`,
  });
  return NextResponse.json({ url: session.url });
}
