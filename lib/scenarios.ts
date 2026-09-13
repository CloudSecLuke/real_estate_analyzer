import {
  computeScenario,
  formatGaps,
  marketRentFromFmr,
  section8Rent,
} from "./metrics";
import type {
  AnalyzeResponse,
  Assumptions,
  PinMetrics,
  SavedPin,
  ScenarioResult,
} from "./types";

export interface ScenarioSet {
  market: ScenarioResult | null;
  s8: ScenarioResult | null;
  str: ScenarioResult | null;
  fmrRent: number | null;
  acsRentForBeds: number | null;
  taxRate: number;
  taxSource: string;
  marketRentSource:
    | "override"
    | "rent AVM"
    | "FMR"
    | "local ACS median"
    | null;
}

/** Compute both scenarios from fetched property data + assumptions. */
export function computeScenariosFromData(
  data: AnalyzeResponse,
  a: Assumptions
): ScenarioSet {
  const beds = Math.min(4, Math.max(0, a.bedrooms)) as 0 | 1 | 2 | 3 | 4;
  const fmrRent = data.fmr ? data.fmr.byBedroom[beds] : null;
  const attom = data.attom ?? null;

  // Tax priority: manual override > actual tax bill (ATTOM) > state estimate.
  // Dividing the actual bill by price keeps computeScenario's price×rate math
  // producing the real monthly tax regardless of what price is entered.
  let taxRate: number;
  let taxSource: string;
  if (a.taxRateOverride != null && a.taxRateOverride !== 0) {
    taxRate = a.taxRateOverride / 100;
    taxSource = "manual override";
  } else if (attom?.annualTaxAmount && a.price > 0) {
    taxRate = attom.annualTaxAmount / a.price;
    taxSource = `actual${attom.taxYear ? ` ${attom.taxYear}` : ""} tax bill via ATTOM`;
  } else {
    taxRate = data.tax.effectiveRate;
    taxSource = data.tax.source;
  }
  const insuranceMult = data.flood.highRisk
    ? 1.4
    : data.flood.moderateRisk
      ? 1.15
      : 1;

  // Market rent priority: manual override > ATTOM rental AVM (property-
  // specific) > conservative area estimate. For the area estimate we take
  // the LOWER of HUD FMR and the county's ACS median for this bedroom
  // count: FMR is area-wide and can carry adjustment factors borrowed from
  // larger geographies (Decatur's FMR runs ~30% above local ACS medians),
  // so the county median is the reality check in soft markets. Section 8
  // still keys off FMR — that's what payment standards are based on.
  const acsRentForBeds = data.acsRent?.byBedroom?.[beds] ?? null;
  let marketRent: number | null;
  let marketRentSource: ScenarioSet["marketRentSource"];
  if (a.marketRentOverride != null && a.marketRentOverride > 0) {
    marketRent = a.marketRentOverride;
    marketRentSource = "override";
  } else if (attom?.rentalAvm) {
    marketRent = Math.round(attom.rentalAvm);
    marketRentSource = "rent AVM";
  } else if (fmrRent != null || acsRentForBeds != null) {
    const fmrDerived = fmrRent != null ? marketRentFromFmr(fmrRent) : null;
    if (
      acsRentForBeds != null &&
      (fmrDerived == null || acsRentForBeds < fmrDerived)
    ) {
      marketRent = acsRentForBeds;
      marketRentSource = "local ACS median";
    } else {
      marketRent = fmrDerived;
      marketRentSource = "FMR";
    }
  } else {
    marketRent = null;
    marketRentSource = null;
  }

  const market =
    marketRent != null
      ? computeScenario(
          "Market Rent",
          marketRent,
          a.vacancyPctMarket,
          a,
          taxRate,
          insuranceMult
        )
      : null;
  const s8 =
    fmrRent != null
      ? computeScenario(
          "Section 8",
          section8Rent(fmrRent, a.paymentStandardPct),
          a.vacancyPctSection8,
          a,
          taxRate,
          insuranceMult
        )
      : null;

  // Short-term rental: Mashvisor's revenue figure is already occupancy-
  // adjusted, so vacancy is 0; STR-specific management % and owner-paid
  // operating costs come from their own assumption fields.
  const strRevenue = data.mashvisor?.str?.monthlyRevenue;
  const str = strRevenue
    ? computeScenario(
        "Airbnb (STR)",
        Math.round(strRevenue),
        0,
        {
          ...a,
          managementPct: a.strManagementPct,
          otherMonthlyExpense: a.otherMonthlyExpense + a.strOtherMonthlyExpense,
        },
        taxRate,
        insuranceMult
      )
    : null;

  return {
    market,
    s8,
    str,
    fmrRent,
    acsRentForBeds,
    taxRate,
    taxSource,
    marketRentSource,
  };
}

export interface StressRow {
  label: string;
  monthlyCashFlow: number;
}

/**
 * Stress-test the market scenario: what happens to monthly cash flow if
 * rent, vacancy, or the interest rate move against you — separately and
 * all at once. A deal that only works when every estimate is right isn't
 * a deal.
 */
export function stressTest(
  data: AnalyzeResponse,
  a: Assumptions,
  base: ScenarioSet
): StressRow[] | null {
  const m = base.market;
  if (!m) return null;
  const variant = (label: string, a2: Assumptions): StressRow => {
    const s = computeScenariosFromData(data, a2).market;
    return { label, monthlyCashFlow: s ? s.monthlyCashFlow : 0 };
  };
  const rentDown = Math.round(m.monthlyRent * 0.9);
  return [
    { label: "As analyzed", monthlyCashFlow: m.monthlyCashFlow },
    variant("Rent −10%", { ...a, marketRentOverride: rentDown }),
    variant("Vacancy +5 pts", {
      ...a,
      vacancyPctMarket: a.vacancyPctMarket + 5,
    }),
    variant("Rate +1 pt", { ...a, interestRatePct: a.interestRatePct + 1 }),
    variant("All three at once", {
      ...a,
      marketRentOverride: rentDown,
      vacancyPctMarket: a.vacancyPctMarket + 5,
      interestRatePct: a.interestRatePct + 1,
    }),
  ];
}

export function toPinMetrics(s: ScenarioResult): PinMetrics {
  return {
    monthlyCashFlow: Math.round(s.monthlyCashFlow),
    rating: s.rating,
    almost: s.ratingDetail.almost,
    gapText: s.ratingDetail.almost ? formatGaps(s.ratingDetail) : "",
    capRatePct: s.capRatePct,
    cashOnCashPct: s.cashOnCashPct,
    rent: s.monthlyRent,
  };
}

export function buildPin(
  data: AnalyzeResponse,
  scenarios: ScenarioSet,
  price: number,
  bedrooms: number
): SavedPin {
  return {
    id: data.property.matchedAddress,
    address: data.property.matchedAddress,
    lat: data.property.lat,
    lon: data.property.lon,
    price,
    bedrooms,
    market: scenarios.market ? toPinMetrics(scenarios.market) : undefined,
    s8: scenarios.s8 ? toPinMetrics(scenarios.s8) : undefined,
    str: scenarios.str ? toPinMetrics(scenarios.str) : undefined,
  };
}
