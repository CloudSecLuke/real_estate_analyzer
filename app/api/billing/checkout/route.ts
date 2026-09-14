import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { getInvestorPriceId, getStripe } from "@/lib/stripe";
import { getEntitlement, isFounder } from "@/lib/users";

// Start a Stripe Checkout session for the Investor plan.
export async function POST(req: NextRequest) {
  const user = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isFounder(user)) {
    return NextResponse.json(
      { error: "Founder accounts don't need a plan." },
      { status: 400 }
    );
  }
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Billing isn't configured yet — try again soon." },
      { status: 503 }
    );
  }
  try {
    const ent = await getEntitlement(user);
    const priceId = await getInvestorPriceId(stripe);
    const origin = req.nextUrl.origin;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user,
      ...(ent.stripeCustomerId ? { customer: ent.stripeCustomerId } : {}),
      subscription_data: { metadata: { username: user } },
      success_url: `${origin}/app?billing=success`,
      cancel_url: `${origin}/app?billing=cancelled`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Checkout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
