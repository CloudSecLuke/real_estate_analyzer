import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { applySubscription, findUsernameByCustomer } from "@/lib/users";

// Stripe webhook: keeps entitlements in sync with subscription state.
// Public route (signature-verified), exempted from the auth proxy.
export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const username =
          session.client_reference_id ??
          (session.customer
            ? await findUsernameByCustomer(String(session.customer))
            : null);
        if (username && session.customer) {
          await applySubscription({
            username,
            customerId: String(session.customer),
            subscriptionId: session.subscription
              ? String(session.subscription)
              : null,
            status: "active",
          });
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const username =
          (sub.metadata?.username as string | undefined) ??
          (await findUsernameByCustomer(String(sub.customer)));
        if (username) {
          const status =
            event.type === "customer.subscription.deleted" ||
            sub.status === "canceled"
              ? "canceled"
              : sub.status === "past_due" || sub.status === "unpaid"
                ? "past_due"
                : sub.status === "active" || sub.status === "trialing"
                  ? "active"
                  : "none";
          await applySubscription({
            username,
            customerId: String(sub.customer),
            subscriptionId: sub.id,
            status,
          });
        }
        break;
      }
    }
  } catch {
    // webhook handlers must not throw at Stripe; state will re-sync on
    // the next event
  }
  return NextResponse.json({ received: true });
}
