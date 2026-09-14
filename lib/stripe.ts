import Stripe from "stripe";
import { INVESTOR_LOOKUP_KEY, INVESTOR_PRICE_USD } from "./users";

// Stripe billing for the Investor plan. Keys come from the Vercel
// Marketplace Stripe integration; the code degrades gracefully (503 from
// the billing routes) until they exist, so nothing breaks pre-provisioning.

export function stripeKey(): string | null {
  return (
    process.env.STRIPE_SECRET_KEY ??
    process.env.STRIPE_API_KEY ??
    null
  );
}

let _stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = stripeKey();
  if (!key) return null;
  if (!_stripe) _stripe = new Stripe(key);
  return _stripe;
}

/**
 * Idempotently resolve the Investor plan price: STRIPE_PRICE_INVESTOR wins
 * when set; otherwise look up (or create) a $19/mo price by lookup_key.
 */
export async function getInvestorPriceId(stripe: Stripe): Promise<string> {
  const configured = process.env.STRIPE_PRICE_INVESTOR;
  if (configured) return configured;
  const existing = await stripe.prices.list({
    lookup_keys: [INVESTOR_LOOKUP_KEY],
    limit: 1,
  });
  if (existing.data[0]) return existing.data[0].id;
  const product = await stripe.products.create({
    name: "PropPencil Investor",
    description:
      "100 pencils a month: full deal analyses with Pencil Score, investor value, Section 8 and short-term data.",
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: INVESTOR_PRICE_USD * 100,
    currency: "usd",
    recurring: { interval: "month" },
    lookup_key: INVESTOR_LOOKUP_KEY,
  });
  return price.id;
}
