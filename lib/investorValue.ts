import { computeScenariosFromData } from "./scenarios";
import type { AnalyzeResponse, Assumptions } from "./types";
import type { ScenarioKey3 } from "./verdict";

// Investor value / Maximum Buy Price: the highest price at which the given
// strategy still returns the user's required cash-on-cash. Both cash flow
// and cash-in move with price, so solve numerically: bisect on price,
// 40 iterations, result rounded to the nearest $500. Returns 0 when even
// the floor price misses the target.
//
// This single number drives the investor-value card, the maximum buy
// price, the walk-away gap, the price recommendation AND the score's
// price-vs-value part — compute it once per render (useMemo) and thread
// it through; never recompute per consumer.

const FLOOR = 5000;

export function investorValue(
  data: AnalyzeResponse,
  a: Assumptions,
  key: ScenarioKey3,
  targetCoc: number
): number {
  const cocAt = (price: number): number => {
    const set = computeScenariosFromData(data, { ...a, price });
    const s = key === "market" ? set.market : key === "s8" ? set.s8 : set.str;
    return s ? s.cashOnCashPct : -100;
  };
  let lo = FLOOR;
  let hi = Math.max(50000, a.price * 3);
  if (cocAt(lo) < targetCoc) return 0;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (cocAt(mid) >= targetCoc) lo = mid;
    else hi = mid;
  }
  return Math.round(lo / 500) * 500;
}
