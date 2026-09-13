import type {
  Assumptions,
  Rating,
  RatingDetail,
  RatingGap,
  ScenarioResult,
} from "./types";

export const DEFAULT_ASSUMPTIONS: Omit<Assumptions, "price" | "bedrooms"> = {
  units: 1,
  downPaymentPct: 20,
  interestRatePct: 7.25,
  loanTermYears: 30,
  closingCostPct: 3,
  rehabCost: 0,
  marketRentOverride: null,
  paymentStandardPct: 110, // most PHAs set payment standard at 100-110% of FMR
  otherMonthlyIncome: 0,
  taxRateOverride: null,
  insurancePctOfValue: 0.5,
  maintenancePctOfValue: 1.0,
  managementPct: 10,
  vacancyPctMarket: 5,
  vacancyPctSection8: 2, // voucher portion is guaranteed; turnover-only vacancy
  otherMonthlyExpense: 0,
  strManagementPct: 20, // STR co-hosting typically runs 20-30%
  strOtherMonthlyExpense: 250, // owner-paid utilities/wifi/supplies on STR
  insuranceFloorMonthly: 65, // old Midwest SFR quotes don't scale with price
  maintenanceFloorMonthly: 110, // a 1920s roof costs the same on a $60k house
  appreciationPctAnnual: 3,
  sellingCostPct: 7, // agent commission + seller closing on exit
};

export function monthlyMortgagePayment(
  principal: number,
  annualRatePct: number,
  years: number
): number {
  if (principal <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

export interface TierReq {
  rating: Rating;
  cf: number; // monthly cash flow per unit
  coc: number; // cash-on-cash %
  cap?: number; // cap rate % (only Rare requires it)
  cfExclusive?: boolean; // Good requires cf strictly > threshold
}

// Best tier first. Poor is the implicit floor. Exported so the UI can show
// "why this rating" checklists against the same numbers.
export const TIERS: TierReq[] = [
  { rating: "Rare", cf: 400, coc: 12, cap: 8 },
  { rating: "Fantastic", cf: 250, coc: 10 },
  { rating: "Great", cf: 150, coc: 8 },
  { rating: "Good", cf: 50, coc: 5, cfExclusive: true },
];

// A miss this small shouldn't decide a purchase — flag it as "Almost <tier>".
const ALMOST_MARGINS = { cf: 50, coc: 1.5, cap: 1.0 };

function meetsTier(t: TierReq, cf: number, coc: number, cap: number): boolean {
  const cfOk = t.cfExclusive ? cf > t.cf : cf >= t.cf;
  return cfOk && coc >= t.coc && (t.cap === undefined || cap >= t.cap);
}

/**
 * Cash-flow-first rating. Breaking even is NOT the goal: anything at or
 * near zero monthly cash flow is Poor. Thresholds are per unit.
 *
 * Also reports near-misses: when the deal falls just short of the next tier
 * (within ALMOST_MARGINS on every failing metric), `almost` names that tier
 * and `gaps` lists exactly what's missing — a $13/mo shortfall shouldn't
 * read the same as a $200/mo one.
 */
export function rateDealDetailed(
  monthlyCashFlowPerUnit: number,
  cocPct: number,
  capRatePct: number
): RatingDetail {
  const cf = monthlyCashFlowPerUnit;
  const idx = TIERS.findIndex((t) => meetsTier(t, cf, cocPct, capRatePct));
  const rating: Rating = idx === -1 ? "Poor" : TIERS[idx].rating;
  const nextIdx = idx === -1 ? TIERS.length - 1 : idx - 1;
  if (nextIdx < 0) return { rating, almost: null, gaps: [] }; // already Rare

  const next = TIERS[nextIdx];
  const gaps: RatingGap[] = [];
  const cfOk = next.cfExclusive ? cf > next.cf : cf >= next.cf;
  if (!cfOk) gaps.push({ metric: "cash flow", needed: next.cf - cf || 1 });
  if (cocPct < next.coc) gaps.push({ metric: "CoC", needed: next.coc - cocPct });
  if (next.cap !== undefined && capRatePct < next.cap)
    gaps.push({ metric: "cap rate", needed: next.cap - capRatePct });

  const withinMargin = gaps.every((g) =>
    g.metric === "cash flow"
      ? g.needed <= ALMOST_MARGINS.cf
      : g.metric === "CoC"
        ? g.needed <= ALMOST_MARGINS.coc
        : g.needed <= ALMOST_MARGINS.cap
  );
  if (gaps.length > 0 && withinMargin) {
    return { rating, almost: next.rating, gaps };
  }
  return { rating, almost: null, gaps: [] };
}

export function formatGaps(detail: RatingDetail): string {
  return detail.gaps
    .map((g) =>
      g.metric === "cash flow"
        ? `+$${Math.ceil(g.needed)}/mo cash flow`
        : `+${g.needed.toFixed(1)}% ${g.metric}`
    )
    .join(", ");
}

export function computeScenario(
  label: string,
  monthlyRent: number,
  vacancyPct: number,
  a: Assumptions,
  effectiveTaxRate: number, // decimal, e.g. 0.0159
  insuranceMultiplier = 1 // flood risk bumps this
): ScenarioResult {
  const price = a.price;
  const grossMonthly = monthlyRent + a.otherMonthlyIncome;

  const taxes = (price * effectiveTaxRate) / 12;
  // dollar floors: %-of-value expenses understate cheap houses badly
  const insurance =
    Math.max(
      (price * (a.insurancePctOfValue / 100)) / 12,
      a.insuranceFloorMonthly ?? 0
    ) * insuranceMultiplier;
  const maintenance = Math.max(
    (price * (a.maintenancePctOfValue / 100)) / 12,
    a.maintenanceFloorMonthly ?? 0
  );
  const management = grossMonthly * (a.managementPct / 100);
  const vacancy = grossMonthly * (vacancyPct / 100);
  const other = a.otherMonthlyExpense;
  const totalOpex = taxes + insurance + maintenance + management + vacancy + other;

  const noi = (grossMonthly - totalOpex) * 12;

  const downPayment = price * (a.downPaymentPct / 100);
  const loanAmount = price - downPayment;
  const monthlyPI = monthlyMortgagePayment(
    loanAmount,
    a.interestRatePct,
    a.loanTermYears
  );
  const cashInvested =
    downPayment + price * (a.closingCostPct / 100) + a.rehabCost;

  const monthlyCashFlow = grossMonthly - totalOpex - monthlyPI;
  const annualCashFlow = monthlyCashFlow * 12;

  const capRatePct = price > 0 ? (noi / price) * 100 : 0;
  const cashOnCashPct =
    cashInvested > 0 ? (annualCashFlow / cashInvested) * 100 : 0;
  const grm = monthlyRent > 0 ? price / (monthlyRent * 12) : 0;

  const units = Math.max(1, a.units);
  const ratingDetail = rateDealDetailed(
    monthlyCashFlow / units,
    cashOnCashPct,
    capRatePct
  );

  return {
    label,
    monthlyRent,
    monthlyCashFlow,
    annualCashFlow,
    noi,
    capRatePct,
    cashOnCashPct,
    grm,
    rating: ratingDetail.rating,
    ratingDetail,
    cashInvested,
    monthlyPI,
    expenses: {
      taxes,
      insurance,
      maintenance,
      management,
      vacancy,
      other,
      totalMonthly: totalOpex,
    },
  };
}

/**
 * Market rent baseline from HUD FMR. FMRs are 40th-percentile gross rents,
 * so actual market rent for a decent unit is usually at or a bit above FMR.
 * We use FMR × 1.0 as a conservative baseline; the UI lets users override
 * with a real comp.
 */
export function marketRentFromFmr(fmrForBedrooms: number): number {
  return Math.round(fmrForBedrooms);
}

export function section8Rent(
  fmrForBedrooms: number,
  paymentStandardPct: number
): number {
  return Math.round(fmrForBedrooms * (paymentStandardPct / 100));
}

export interface FiveYearProjection {
  futureValue: number;
  loanBalance: number;
  equityPaydown: number; // principal paid off in 60 months
  cumulativeCashFlow: number;
  saleCosts: number;
  netIfSold: number; // future value − sale costs − loan balance
  totalProfit: number; // netIfSold + cumulative CF − cash invested
  annualizedReturnPct: number; // total-return CAGR on cash invested
}

/**
 * Simple 5-year hold: appreciation at the assumed annual rate, loan
 * amortization over 60 payments, cash flow held flat (conservative — no
 * rent growth), sale costs on exit.
 */
export function projectFiveYears(
  s: ScenarioResult,
  a: Assumptions
): FiveYearProjection | null {
  if (a.price <= 0 || s.cashInvested <= 0) return null;
  const years = 5;
  const k = years * 12;
  const appreciation = (a.appreciationPctAnnual ?? 3) / 100;
  const futureValue = a.price * Math.pow(1 + appreciation, years);

  const loan0 = a.price * (1 - a.downPaymentPct / 100);
  const r = a.interestRatePct / 100 / 12;
  const n = a.loanTermYears * 12;
  const loanBalance =
    loan0 <= 0
      ? 0
      : r === 0
        ? loan0 * Math.max(0, 1 - k / n)
        : (loan0 * (Math.pow(1 + r, n) - Math.pow(1 + r, Math.min(k, n)))) /
          (Math.pow(1 + r, n) - 1);

  const cumulativeCashFlow = s.monthlyCashFlow * k;
  const saleCosts = futureValue * ((a.sellingCostPct ?? 7) / 100);
  const netIfSold = futureValue - saleCosts - loanBalance;
  const totalProfit = netIfSold + cumulativeCashFlow - s.cashInvested;
  const multiple = (netIfSold + cumulativeCashFlow) / s.cashInvested;
  const annualizedReturnPct =
    multiple > 0 ? (Math.pow(multiple, 1 / years) - 1) * 100 : -100;

  return {
    futureValue,
    loanBalance,
    equityPaydown: loan0 - loanBalance,
    cumulativeCashFlow,
    saleCosts,
    netIfSold,
    totalProfit,
    annualizedReturnPct,
  };
}

export const RATING_COLORS: Record<Rating, string> = {
  Rare: "#7c3aed",
  Fantastic: "#059669",
  Great: "#16a34a",
  Good: "#ca8a04",
  Poor: "#dc2626",
};
