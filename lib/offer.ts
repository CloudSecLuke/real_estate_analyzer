import { TIERS } from "./metrics";
import { computeScenariosFromData } from "./scenarios";
import type { AnalyzeResponse, Assumptions, Rating } from "./types";
import type { ScenarioKey3 } from "./verdict";

// The offer-price solver: for each scenario and rating tier, the highest
// purchase price at which the scenario still earns that tier, holding every
// other assumption (and the rent estimates) constant. Lowering the price
// only improves cash flow, cash-on-cash and cap rate, so tier attainment is
// monotonic in price and a binary search is sound.

const SOLVE_TIERS: Rating[] = ["Rare", "Fantastic", "Great", "Good"];

const PRICE_FLOOR = 5000;

function ratingIndex(r: Rating): number {
  const i = TIERS.findIndex((t) => t.rating === r);
  return i === -1 ? TIERS.length : i; // Poor sorts last
}

export interface OfferSolution {
  key: ScenarioKey3;
  /** Max price (rounded down to $100) that still earns the tier; null =
   *  unreachable at any realistic price; Infinity-like cap = holds beyond
   *  the search ceiling. */
  byTier: Partial<Record<Rating, number | null>>;
  ceiling: number; // the search ceiling used, for display
}

export function solveOfferPrices(
  data: AnalyzeResponse,
  a: Assumptions,
  keys: ScenarioKey3[]
): OfferSolution[] {
  const ceiling = Math.max(a.price * 2, 400000);
  const ratingAt = (key: ScenarioKey3, price: number): Rating | null => {
    const set = computeScenariosFromData(data, { ...a, price });
    const s = key === "market" ? set.market : key === "s8" ? set.s8 : set.str;
    return s ? s.rating : null;
  };
  return keys.map((key) => {
    const byTier: OfferSolution["byTier"] = {};
    for (const tier of SOLVE_TIERS) {
      const target = ratingIndex(tier);
      const ok = (p: number) => {
        const r = ratingAt(key, p);
        return r != null && ratingIndex(r) <= target;
      };
      if (!ok(PRICE_FLOOR)) {
        // even nearly free the tier is out of reach (rent too low vs floors)
        byTier[tier] = null;
        continue;
      }
      if (ok(ceiling)) {
        byTier[tier] = ceiling;
        continue;
      }
      let lo = PRICE_FLOOR;
      let hi = ceiling;
      for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2;
        if (ok(mid)) lo = mid;
        else hi = mid;
      }
      byTier[tier] = Math.floor(lo / 100) * 100;
    }
    return { key, byTier, ceiling };
  });
}

/** The next tier up from a scenario's current rating, if any. */
export function nextTierUp(current: Rating): Rating | null {
  const i = ratingIndex(current);
  return i > 0 ? TIERS[i - 1]?.rating ?? null : null;
}
