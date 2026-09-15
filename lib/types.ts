// Shared types for the analyzer

export interface GeocodeResult {
  matchedAddress: string;
  lat: number;
  lon: number;
  zip: string;
  state: string; // 2-letter
  countyFips: string; // 5-digit state+county
  countyName: string;
}

export interface FmrData {
  year: number;
  areaName: string;
  smallAreaUsed: boolean; // true if ZIP-level SAFMR was used
  zip?: string;
  // monthly FMR by bedroom count, index 0 = efficiency/studio
  byBedroom: { 0: number; 1: number; 2: number; 3: number; 4: number };
}

export interface FloodData {
  zone: string | null; // e.g. "AE", "X", null = not mapped / lookup failed
  highRisk: boolean; // SFHA (A*/V* zones)
  moderateRisk: boolean; // shaded X / 0.2% annual chance
  source: string;
}

export interface TaxEstimate {
  effectiveRate: number; // e.g. 0.0159 = 1.59%
  source: string;
}

// ATTOM property record — every field optional since trial packages and
// county coverage vary; the analyzer falls back per-field.
export interface AttomData {
  beds?: number;
  baths?: number;
  sqft?: number;
  yearBuilt?: number;
  propertyType?: string;
  assessedValue?: number;
  marketValue?: number; // assessor market value
  annualTaxAmount?: number; // actual tax bill, $/yr
  taxYear?: number;
  avmValue?: number;
  avmLow?: number;
  avmHigh?: number;
  avmConfidence?: number; // 0-100
  lastSalePrice?: number;
  lastSaleDate?: string;
  rentalAvm?: number; // monthly
  rentalAvmLow?: number;
  rentalAvmHigh?: number;
}

// Mashvisor short-term-rental market data for the analyzed address's area
// (from rento-calculator/lookup, resource=airbnb).
export interface StrData {
  monthlyRevenue?: number; // occupancy-adjusted, $/mo
  occupancyPct?: number; // 0-100
  nightlyRate?: number;
  medianHomeValue?: number;
  marketLabel?: string; // e.g. "Cincinnati, OH"
}

// Listing facts for auto-filling the form (from traditional-property)
export interface ListingInfo {
  beds?: number;
  baths?: number;
  sqft?: number;
  yearBuilt?: number;
  listPrice?: number;
  propertyType?: string;
}

export interface MashvisorData {
  str?: StrData;
  listing?: ListingInfo;
}

// County median gross rents by bedroom (Census ACS), inflated to current —
// the local reality check on area-wide FMR.
export interface AcsRentData {
  byBedroom: Partial<Record<0 | 1 | 2 | 3 | 4, number>>;
  acsYear: number;
  inflationFactor: number;
  source: string;
  rentalVacancyPct?: number; // county rental vacancy rate (ACS DP04)
}

// County trajectory — the "is this market melting?" panel
export interface MarketHealth {
  countyName: string;
  population?: number;
  populationChangePct5yr?: number;
  medianValue?: number;
  valueChangePct5yr?: number;
  unemploymentPct?: number;
  unemploymentAsOf?: string; // e.g. "Jul 2026 (preliminary)"
}

export interface AnalyzeResponse {
  property: GeocodeResult;
  fmr: FmrData | null;
  fmrError?: boolean;
  flood: FloodData;
  tax: TaxEstimate;
  acsRent?: AcsRentData | null;
  marketHealth?: MarketHealth | null;
  attom?: AttomData | null;
  attomError?: boolean;
  mashvisor?: MashvisorData | null;
  mashvisorError?: boolean;
}

export interface Assumptions {
  price: number;
  bedrooms: number;
  units: number;
  downPaymentPct: number; // 0-100
  interestRatePct: number; // annual, 0-100
  loanTermYears: number;
  closingCostPct: number; // of price
  rehabCost: number;
  // income
  marketRentOverride: number | null; // monthly; null = use FMR-derived estimate
  paymentStandardPct: number; // Section 8 payment standard as % of FMR (90-120)
  otherMonthlyIncome: number;
  // expenses
  taxRateOverride: number | null; // annual effective %, e.g. 1.6
  insurancePctOfValue: number; // annual, e.g. 0.5
  maintenancePctOfValue: number; // annual, e.g. 1.0
  managementPct: number; // % of rent
  vacancyPctMarket: number; // % of rent
  vacancyPctSection8: number; // % of rent
  otherMonthlyExpense: number; // HOA, utilities, etc.
  // short-term rental (Airbnb) scenario — occupancy is baked into revenue
  strManagementPct: number; // % of revenue; STR co-hosting runs 20-30%
  strOtherMonthlyExpense: number; // utilities/supplies/wifi owner pays on STR
  // dollar floors — %-of-value expenses flatter cheap houses (0.5% of a
  // $60k house is $25/mo of insurance; real quotes run $60-100/mo)
  insuranceFloorMonthly: number;
  maintenanceFloorMonthly: number;
  // 5-year hold projection
  appreciationPctAnnual: number;
  sellingCostPct: number; // agent + closing on exit
  // PropPencil additions
  capexPctOfRent: number; // monthly reserve for roof/HVAC etc., % of rent
  targetCocPct: number; // required cash-on-cash — drives investor value + score
}

// Which scenario a pin/map view is keyed to
export type ScenarioKey = "market" | "s8" | "str";

// A previously analyzed address (feeds the address-field history dropdown)
export interface HistoryEntry {
  address: string; // geocoder-matched address
  queriedAt: string; // ISO timestamp
  price: number;
  bedrooms: number;
}

// A saved search: everything needed to re-run an analysis exactly as it
// was — address, price, bedrooms and the full assumption snapshot.
export interface SavedSearch {
  id: string;
  name: string;
  address: string;
  price: number;
  bedrooms: number;
  assumptions: Omit<Assumptions, "price" | "bedrooms">;
  savedAt: string; // ISO timestamp
}

export type Rating = "Rare" | "Fantastic" | "Great" | "Good" | "Poor";

// Snapshot of an analyzed property shown as a map pin (persisted in localStorage)
export interface SavedPin {
  id: string; // matched address
  address: string;
  lat: number;
  lon: number;
  price: number;
  bedrooms: number;
  market?: PinMetrics;
  s8?: PinMetrics;
  str?: PinMetrics;
  investorValue?: number; // at save time, for the active strategy
}

export interface PinMetrics {
  monthlyCashFlow: number;
  rating: Rating;
  almost: Rating | null; // next tier up, when narrowly missed
  gapText: string; // e.g. "+$13/mo cash flow" — what's missing for the next tier
  capRatePct: number;
  cashOnCashPct: number;
  rent: number;
  score?: number; // Pencil Score 0-100, when computed at save time
}

export interface RatingGap {
  metric: "cash flow" | "CoC" | "cap rate";
  needed: number; // shortfall amount ($/mo for cash flow, % points otherwise)
}

export interface RatingDetail {
  rating: Rating;
  almost: Rating | null; // set when every gap to the next tier is small
  gaps: RatingGap[]; // shortfalls to the next tier (only populated when almost)
}

// ---- Mashvisor data-fidelity comparison (on-demand, /api/compare) ----

export type RentByBedroom = Partial<Record<0 | 1 | 2 | 3 | 4, number>>;

export interface HistoricalMonth {
  year: number;
  month: number;
  rentalIncome?: number;
  nightPrice?: number;
  occupancyPct?: number;
}

export interface CompareRequest {
  state: string;
  city: string;
  zip: string;
  address: string;
  lat: number;
  lon: number;
  beds: number;
  baths?: number;
  sqft?: number;
  price: number;
  // our computed metrics, fed to Mashvisor's investment-likelihood model
  traditionalRent?: number;
  traditionalCoc?: number;
  strRent?: number;
  strCoc?: number;
}

export interface CompareResponse {
  traditionalRates: { byBedroom: RentByBedroom; sampleCount?: number } | null;
  strHistorical: {
    months: HistoricalMonth[];
    rentalIncomeYoYPct?: number;
    occupancyYoYPct?: number;
  } | null;
  traditionalHistorical: {
    months: HistoricalMonth[];
    rentalIncomeYoYPct?: number;
  } | null;
  comps: {
    medianRent?: number;
    count?: number;
    items: { address: string; rent?: number; beds?: number; sqft?: number }[];
  } | null;
  likelihood: { prediction?: number; likelihoodPct?: number } | null;
  neighborhoodHistorical: {
    neighborhoodName?: string;
    averages?: RentByBedroom;
    months: { year: number; month: number; byBedroom: RentByBedroom }[];
  } | null;
  // per-section failure messages; a section can fail without sinking the rest
  errors: Record<string, string>;
}

export interface ScenarioResult {
  label: string;
  monthlyRent: number;
  monthlyCashFlow: number; // THE headline number (after debt service)
  annualCashFlow: number;
  noi: number; // annual
  capRatePct: number;
  cashOnCashPct: number;
  grm: number;
  rating: Rating;
  ratingDetail: RatingDetail;
  cashInvested: number;
  monthlyPI: number;
  expenses: {
    taxes: number; // monthly
    insurance: number;
    maintenance: number;
    capex: number; // CapEx reserve (roof/HVAC), % of rent
    management: number;
    vacancy: number;
    other: number;
    totalMonthly: number; // operating, excl. debt service
  };
}
