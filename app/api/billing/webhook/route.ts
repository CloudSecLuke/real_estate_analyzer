import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { applySubscription, findUsernameByCustomer } from "@/lib/users";
import { sql } from "@/lib/sql";

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

  // Idempotency (Phase 5): record the event id; a replayed delivery is
  // acknowledged without reprocessing.
  try {
    const fresh = (await sql()`
      INSERT INTO stripe_events (id, type) VALUES (${event.id}, ${event.type})
      ON CONFLICT (id) DO NOTHING RETURNING id
    `) as unknown[];
    if (fresh.length === 0) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  } catch (err) {
    // If we can't record the event we also can't guarantee processing —
    // 500 so Stripe retries later.
    console.error("stripe_event_record_failed", err);
    return NextResponse.json({ error: "db unavailable" }, { status: 500 });
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
  } catch (err) {
    // A DB write failure means the entitlement did NOT sync — return 500
    // so Stripe retries, and drop the event id so the retry reprocesses.
    console.error("stripe_webhook_apply_failed", event.type, err);
    await sql()`DELETE FROM stripe_events WHERE id = ${event.id}`.catch(() => {});
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
