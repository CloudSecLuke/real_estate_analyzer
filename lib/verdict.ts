import type { ScenarioSet } from "./scenarios";
import type { AnalyzeResponse, Assumptions, ScenarioResult } from "./types";
import { dscrOf, type ScorePart } from "./pencilScore";

// The PropPencil verdict layer: the verdict sentence, "Why it pencils",
// "What could break the pencil", the price recommendation and the band
// commentary. Copy templates come from the design handoff verbatim —
// including "once the mortgage is paid" phrasing and quantified details.

export type ScenarioKey3 = "market" | "s8" | "str";

export const DISPLAY_LABEL: Record<ScenarioKey3, string> = {
  market: "Traditional rental",
  s8: "Section 8 voucher",
  str: "Short-term rental",
};

export const TAB_LABEL: Record<ScenarioKey3, string> = {
  market: "Traditional",
  s8: "Section 8",
  str: "Short-term",
};

export const MARKET_SRC_LABEL: Record<string, string> = {
  override: "your own comp",
  "rent AVM": "ATTOM automated rent estimate",
  FMR: "HUD Fair Market Rent",
  "local ACS median": "county median rent (Census ACS)",
};

export const usdWhole = (v: number): string =>
  (v < 0 ? "−$" : "$") + Math.abs(Math.round(v)).toLocaleString("en-US");

export const signedUsd = (v: number): string =>
  (v >= 0 ? "+" : "−") + "$" + Math.abs(Math.round(v)).toLocaleString("en-US");

export const pct1 = (v: number): string => v.toFixed(1) + "%";

export interface RankedScenario {
  key: ScenarioKey3;
  s: ScenarioResult;
}

export function rankScenarios(set: ScenarioSet): RankedScenario[] {
  const list: RankedScenario[] = [];
  if (set.market) list.push({ key: "market", s: set.market });
  if (set.s8) list.push({ key: "s8", s: set.s8 });
  if (set.str) list.push({ key: "str", s: set.str });
  return list.sort((a, b) => b.s.monthlyCashFlow - a.s.monthlyCashFlow);
}

export interface PencilVerdict {
  line: string;
  detail: string;
  recommendation: string;
  recommendationDetail: string;
  gap: number; // ask − investor value; positive = overpriced vs target
}

export function buildPencilVerdict(args: {
  score: number;
  price: number;
  investorValue: number;
  active: RankedScenario | null;
  count: number;
  cashIn: number;
  targetCoc: number;
}): PencilVerdict {
  const { score, price, investorValue, active, count, cashIn, targetCoc } = args;
  const gap = price - investorValue;
  if (!active) {
    return {
      line: "Nothing to pencil yet.",
      detail: "",
      recommendation: "",
      recommendationDetail: "",
      gap,
    };
  }
  const label = DISPLAY_LABEL[active.key];
  const line =
    score >= 70
      ? `At ${usdWhole(price)}, this property pencils.`
      : score >= 50
        ? `At ${usdWhole(price)}, this property barely pencils.`
        : `At ${usdWhole(price)}, this property does not pencil.`;
  const detail =
    `${label} is the strongest of the ${count} strategies at ${signedUsd(active.s.monthlyCashFlow)} a month after the mortgage, ` +
    `${pct1(active.s.cashOnCashPct)} cash-on-cash on ${usdWhole(cashIn)} of cash in. ` +
    (gap > 0
      ? `The ask is ${usdWhole(gap)} above what the income supports at your ${targetCoc}% target.`
      : `The income supports ${usdWhole(-gap)} more than the ask at your ${targetCoc}% target.`);
  const recommendation =
    gap > 0
      ? `Recommendation: negotiate to ${usdWhole(investorValue)} or walk away.`
      : `Recommendation: the ask already works — move before someone else pencils it.`;
  const recommendationDetail =
    gap > 0
      ? `Above ${usdWhole(investorValue)} the ${label.toLowerCase()} strategy no longer returns your required ${targetCoc}%. That is your walk-away price, not a target to stretch past.`
      : `At ${usdWhole(price)} the ${label.toLowerCase()} strategy returns ${pct1(active.s.cashOnCashPct)} against the ${targetCoc}% you require, leaving ${usdWhole(-gap)} of headroom if you need to compete on price.`;
  return { line, detail, recommendation, recommendationDetail, gap };
}

export interface WhyRiskItem {
  title: string;
  detail: string;
}

/** Dollars/month lost if occupancy drops ten points, net of STR management. */
function tenPointCost(
  revenue: number | undefined,
  occupancyPct: number | undefined,
  a: Assumptions
): number | null {
  if (!revenue || !occupancyPct) return null;
  return ((revenue * 10) / occupancyPct) * (1 - (a.strManagementPct ?? 20) / 100);
}

export function whyAndRisks(args: {
  data: AnalyzeResponse;
  set: ScenarioSet;
  active: RankedScenario;
  a: Assumptions;
  investorValue: number;
  parts: ScorePart[];
  targetCoc: number;
  rentRange: { low: number; high: number } | null;
}): { why: WhyRiskItem[]; risks: WhyRiskItem[] } {
  const { data, set, active, a, investorValue, parts, targetCoc, rentRange } = args;
  const s = active.s;
  const why: WhyRiskItem[] = [];
  const risks: WhyRiskItem[] = [];
  const price = a.price;
  const cashIn = s.cashInvested;
  const gross = s.monthlyRent + a.otherMonthlyIncome;
  const outflow = s.expenses.totalMonthly + s.monthlyPI;
  const dscr = dscrOf(s);

  if (investorValue > price)
    why.push({
      title: "Asking price is below your investor value",
      detail: `At a required ${targetCoc}% return the deal supports ${usdWhole(investorValue)}, which is ${usdWhole(investorValue - price)} above the ${usdWhole(price)} ask.`,
    });
  if (s.monthlyCashFlow > 0)
    why.push({
      title: "Rent covers every expense plus the mortgage",
      detail: `${usdWhole(gross)} in, ${usdWhole(outflow)} out, leaving ${signedUsd(s.monthlyCashFlow)} a month after reserves and empty months.`,
    });
  if (s.cashOnCashPct >= targetCoc)
    why.push({
      title: "Cash-on-cash beats your target",
      detail: `${pct1(s.cashOnCashPct)} against the ${targetCoc}% you asked for, on ${usdWhole(cashIn)} of cash in.`,
    });
  if (Number.isFinite(dscr) && dscr >= 1.25)
    why.push({
      title: "Debt coverage clears the lender threshold",
      detail: `${dscr.toFixed(2)}x — most lenders want 1.25x, so financing should not be the obstacle.`,
    });
  if (set.s8 && set.s8.monthlyCashFlow > 0 && active.key !== "s8")
    why.push({
      title: "A contract-backed fallback exists",
      detail: `Section 8 pays ${signedUsd(set.s8.monthlyCashFlow)} a month on a voucher at ${a.vacancyPctSection8}% empty months, so there is a floor under the upside case.`,
    });

  const occ = data.mashvisor?.str?.occupancyPct;
  if (active.key === "str") {
    const dNet = tenPointCost(s.monthlyRent, occ, a);
    if (dNet != null && occ != null) {
      risks.push({
        title: "Occupancy",
        detail:
          `The whole case rests on ${Math.round(occ)}% occupancy holding. Ten points off costs roughly ${usdWhole(dNet)} a month` +
          (set.s8
            ? `, which would put it ${s.monthlyCashFlow - dNet > set.s8.monthlyCashFlow ? "still ahead of" : "behind"} the voucher case.`
            : "."),
      });
    }
    risks.push({
      title: "Regulation",
      detail:
        "Short-term rental rules can change with a single council vote. Confirm the local ordinance and any permit cap before you count on this number.",
    });
  }
  if (active.key === "s8")
    risks.push({
      title: "Inspection and rent ceiling",
      detail:
        "The house must pass a housing-quality inspection, and the housing authority sets the ceiling — your rent is not yours to raise.",
    });
  risks.push({
    title: "Insurance",
    detail: `Budgeted at ${a.insurancePctOfValue}% of value (floor ${usdWhole(a.insuranceFloorMonthly ?? 0)}/mo), or ${usdWhole(s.expenses.insurance)} a month. A real quote coming back $60 higher takes the score down a tier.`,
  });
  if (set.marketRentSource !== "override") {
    risks.push({
      title: "Rent estimate",
      detail:
        `The rent is modelled, not leased. Source: ${(set.marketRentSource && MARKET_SRC_LABEL[set.marketRentSource]) || "none"}` +
        (rentRange
          ? `, range ${usdWhole(rentRange.low)}–${usdWhole(rentRange.high)}`
          : "") +
        `. One real comp from the block settles it.`,
    });
  }
  const yearBuilt = data.mashvisor?.listing?.yearBuilt ?? data.attom?.yearBuilt;
  if (yearBuilt != null && yearBuilt < 1960)
    risks.push({
      title: "Age and big-ticket repairs",
      detail: `Built ${yearBuilt}. The ${a.capexPctOfRent}% CapEx reserve is ${usdWhole(s.expenses.capex)} a month — thin for a roof and an HVAC on a house this old.`,
    });
  const pop = data.marketHealth?.populationChangePct5yr;
  if (pop != null && pop <= -1)
    risks.push({
      title: "Shrinking market",
      detail: `${data.marketHealth?.countyName ?? "The county"} lost ${Math.abs(pop).toFixed(1)}% of its population over five years. Cheap cash flow in a melting market erodes through vacancy and flat rents.`,
    });
  if (data.flood.highRisk)
    risks.push({
      title: "Flood zone",
      detail: `FEMA maps this location as high risk (Zone ${data.flood.zone}); the model already carries insurance +40%, and a real flood policy quote can be worse.`,
    });
  const pricePart = parts.find((p) => p.key === "price");
  if (pricePart && pricePart.frac < 0.5)
    risks.push({
      title: "Purchase price",
      detail: `At ${usdWhole(price)} the return falls short of your ${targetCoc}% target. ${investorValue > 0 ? usdWhole(investorValue) + " is where it works." : "No price in range reaches it with these rents."}`,
    });

  return { why: why.slice(0, 5), risks: risks.slice(0, 5) };
}

export function bandNote(
  key: ScenarioKey3,
  set: ScenarioSet,
  a: Assumptions,
  occupancyPct: number | undefined
): string {
  if (key === "str") {
    const dNet = tenPointCost(set.str?.monthlyRent, occupancyPct, a);
    return dNet != null
      ? `Highest return and highest variance. Ten points off occupancy costs about ${usdWhole(dNet)} a month.`
      : "Highest return and highest variance: the revenue line moves with occupancy, and occupancy moves with the season.";
  }
  if (key === "s8")
    return "The voucher portion arrives on contract, so the only empty months are between tenants. The trade is an inspection and the authority's rent ceiling.";
  return "A modelled rent, not a signed lease. One comparable rental from the block is worth more than either estimate.";
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
