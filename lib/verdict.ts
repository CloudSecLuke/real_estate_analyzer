import { monthlyMortgagePayment } from "./metrics";
import type { ScenarioSet } from "./scenarios";
import type { Assumptions, ScenarioResult } from "./types";

// The verdict layer from the UI redesign: pure functions over a ScenarioSet
// that produce the written recommendation, the ranked ladder and the band
// commentary. Copy templates come from the design handoff verbatim —
// including "once the mortgage is paid" rather than "after debt service".

export type ScenarioKey3 = "market" | "s8" | "str";

export interface RankedScenario {
  key: ScenarioKey3;
  s: ScenarioResult;
}

// Display names for the redesign (the lib labels stay untouched)
export const DISPLAY_LABEL: Record<ScenarioKey3, string> = {
  market: "Market rent",
  s8: "Section 8",
  str: "Short-term rental",
};

export const MARKET_SRC_LABEL: Record<string, string> = {
  override: "your own comp (override)",
  "rent AVM": "ATTOM automated rent estimate (rent AVM)",
  FMR: "HUD Fair Market Rent (FMR)",
  "local ACS median": "county median rent (Census ACS)",
};

export const usdWhole = (v: number): string =>
  (v < 0 ? "−$" : "$") + Math.abs(Math.round(v)).toLocaleString("en-US");

export const signedUsd = (v: number): string =>
  (v >= 0 ? "+" : "−") + "$" + Math.abs(Math.round(v)).toLocaleString("en-US");

export const pct1 = (v: number): string => v.toFixed(1) + "%";

export function rankScenarios(set: ScenarioSet): RankedScenario[] {
  const list: RankedScenario[] = [];
  if (set.market) list.push({ key: "market", s: set.market });
  if (set.s8) list.push({ key: "s8", s: set.s8 });
  if (set.str) list.push({ key: "str", s: set.str });
  return list.sort((a, b) => b.s.monthlyCashFlow - a.s.monthlyCashFlow);
}

export function gapText(s: ScenarioResult): string {
  return s.ratingDetail.gaps
    .map((g) =>
      g.metric === "cash flow"
        ? "$" + Math.ceil(g.needed) + "/mo of cash flow"
        : g.needed.toFixed(1) + " points of " + (g.metric === "CoC" ? "cash-on-cash" : g.metric)
    )
    .join(" and ");
}

export function ladderEyebrow(
  ranked: RankedScenario[],
  index: number
): string {
  const label = DISPLAY_LABEL[ranked[index].key].toLowerCase();
  if (ranked.length === 1) return "Only scenario · " + label;
  if (index === 0) return "Best case · " + label;
  if (index === ranked.length - 1) return "Weakest · " + label;
  return "Middle · " + label;
}

export interface StrMeta {
  occupancyPct?: number;
  revenue?: number; // monthly, occupancy-adjusted
}

/** Dollars/month lost if occupancy drops ten points, net of STR management. */
function tenPointCost(strMeta: StrMeta, a: Assumptions): number | null {
  if (!strMeta.revenue || !strMeta.occupancyPct) return null;
  return (
    ((strMeta.revenue * 10) / strMeta.occupancyPct) *
    (1 - (a.strManagementPct ?? 20) / 100)
  );
}

export function bandNote(
  key: ScenarioKey3,
  set: ScenarioSet,
  a: Assumptions,
  strMeta: StrMeta
): string {
  if (key === "str") {
    const dNet = tenPointCost(strMeta, a);
    const s = set.str!;
    if (dNet != null && strMeta.occupancyPct != null) {
      const s8Cf = set.s8 ? set.s8.monthlyCashFlow : 0;
      return (
        "Highest variance of the three. Ten points off " +
        Math.round(strMeta.occupancyPct) +
        "% occupancy costs about " +
        usdWhole(dNet) +
        " a month, which still leaves it " +
        (s.monthlyCashFlow - dNet > s8Cf ? "ahead of" : "behind") +
        " the voucher case."
      );
    }
    return "Highest variance of the three: the revenue line moves with occupancy, and occupancy moves with the season.";
  }
  if (key === "s8") {
    return "The voucher portion arrives on contract, so the only empty months are between tenants. In exchange the house must pass a housing-quality inspection and accept the housing authority's rent ceiling.";
  }
  const s = set.market!;
  if (s.ratingDetail.almost) {
    return (
      "Misses " +
      s.ratingDetail.almost +
      " by " +
      gapText(s) +
      ". A small rent bump or a lower price closes the gap entirely."
    );
  }
  return "Rent is a modelled number, not a signed lease. One real comp from the block is worth more than either estimate.";
}

export interface Verdict {
  headline: string;
  p1: string;
  p2: string;
}

export function buildVerdict(
  set: ScenarioSet,
  a: Assumptions,
  strMeta: StrMeta
): Verdict {
  const ranked = rankScenarios(set);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  if (!best) return { headline: "Nothing to underwrite yet.", p1: "", p2: "" };

  if (best.s.monthlyCashFlow <= 0) {
    const perTenK = monthlyMortgagePayment(
      10000 * (1 - a.downPaymentPct / 100),
      a.interestRatePct,
      a.loanTermYears
    );
    return {
      headline:
        "At " + usdWhole(a.price) + ", none of these strategies clears break-even.",
      p1:
        "The best of the " +
        ranked.length +
        " scenarios is " +
        DISPLAY_LABEL[best.key].toLowerCase() +
        " at " +
        signedUsd(best.s.monthlyCashFlow) +
        " a month once the mortgage is paid. Breaking even is not the goal, so this one only works if the price comes down or the rent assumption is wrong.",
      p2:
        "Try the price that would make it work: every $10,000 off the purchase takes roughly " +
        usdWhole(perTenK) +
        " a month off the mortgage, before the smaller tax and reserve lines.",
    };
  }

  const spread = best.s.monthlyCashFlow - worst.s.monthlyCashFlow;
  const safe = set.s8 && best.key !== "s8" ? set.s8 : null;

  let p2: string;
  if (best.key === "str") {
    const dNet = tenPointCost(strMeta, a);
    p2 =
      (dNet != null && strMeta.occupancyPct != null
        ? "That number assumes " +
          Math.round(strMeta.occupancyPct) +
          "% occupancy holds; ten points off it costs about " +
          usdWhole(dNet) +
          " a month."
        : "That number is only as good as the occupancy assumption behind it.") +
      (safe
        ? " Section 8 pays " +
          signedUsd(safe.monthlyCashFlow) +
          " off a contract-guaranteed voucher at " +
          a.vacancyPctSection8 +
          "% vacancy, so treat it as the floor beneath the upside case rather than a competing plan."
        : "");
  } else if (best.key === "s8") {
    p2 =
      "The voucher portion is contractual, so this is the rare case where the best number is also the steadiest one. The cost is an HQS inspection and a rent ceiling set by the housing authority." +
      (set.str
        ? " Short-term rental comes in at " +
          signedUsd(set.str.monthlyCashFlow) +
          " and carries the occupancy risk on top."
        : "");
  } else {
    p2 =
      "Market rent leading means the voucher ceiling and the short-term market are both soft here. Verify the rent with a real comp before acting on it — it is the one input with no contract behind it.";
  }

  const almostBand = ranked.find((r) => r.s.ratingDetail.almost);
  const p1 =
    DISPLAY_LABEL[best.key] +
    " clears " +
    signedUsd(best.s.monthlyCashFlow) +
    " a month once the mortgage is paid — " +
    (best.s.ratingDetail.almost
      ? best.s.rating +
        ", " +
        usdWhole(best.s.ratingDetail.gaps[0]?.needed ?? 0) +
        " of cash flow short of " +
        best.s.ratingDetail.almost
      : "rated " + best.s.rating) +
    " — and " +
    usdWhole(spread) +
    " ahead of " +
    DISPLAY_LABEL[worst.key].toLowerCase() +
    ", the weakest of the " +
    ranked.length +
    " scenarios on the same purchase." +
    (almostBand && almostBand.key !== best.key
      ? " " +
        DISPLAY_LABEL[almostBand.key] +
        " sits at " +
        signedUsd(almostBand.s.monthlyCashFlow) +
        " and misses " +
        almostBand.s.ratingDetail.almost +
        " by " +
        gapText(almostBand.s) +
        " — a rounding error, not a margin."
      : "");

  const headline =
    best.key === "str" && safe
      ? "Run it short-term and it is the best deal on the list; run it on a voucher and it is the safest."
      : DISPLAY_LABEL[best.key] + " is the strongest play on this house.";

  return { headline, p1, p2 };
}

export interface FidelityBenchmark {
  label: string;
  value: number;
}

export function fidelitySentence(
  benchmarks: FidelityBenchmark[],
  ourRent: number,
  likelihoodPct?: number
): string {
  if (benchmarks.length === 0) {
    return "No independent benchmark is available with the current keys. The market-rent number is a single modelled estimate — treat it as a hypothesis until a real comp confirms it.";
  }
  const allAtOrAbove = benchmarks.every((b) => b.value >= ourRent);
  if (allAtOrAbove) {
    return (
      "Every independent source sits at or above our baseline, so the market-rent case is conservative rather than optimistic." +
      (likelihoodPct != null
        ? " Mashvisor's own model puts the investment likelihood at " +
          Math.round(likelihoodPct) +
          "%."
        : "")
    );
  }
  return "At least one independent source sits below our baseline. Treat the market-rent scenario as the optimistic end of the range until a real comp confirms it.";
}
