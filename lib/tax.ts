import type { TaxEstimate } from "./types";

// Free fallback: statewide average effective property tax rates
// (Tax Foundation / Census ACS, owner-occupied housing, ~2023).
// These are estimates — the UI lets the user override with the actual
// county rate or a known tax bill.
const STATE_RATES: Record<string, number> = {
  AL: 0.0040, AK: 0.0104, AZ: 0.0063, AR: 0.0064, CA: 0.0075,
  CO: 0.0051, CT: 0.0179, DE: 0.0061, DC: 0.0062, FL: 0.0091,
  GA: 0.0092, HI: 0.0032, ID: 0.0067, IL: 0.0208, IN: 0.0084,
  IA: 0.0152, KS: 0.0134, KY: 0.0083, LA: 0.0056, ME: 0.0124,
  MD: 0.0105, MA: 0.0114, MI: 0.0138, MN: 0.0111, MS: 0.0067,
  MO: 0.0101, MT: 0.0074, NE: 0.0163, NV: 0.0059, NH: 0.0193,
  NJ: 0.0223, NM: 0.0067, NY: 0.0140, NC: 0.0082, ND: 0.0098,
  OH: 0.0159, OK: 0.0089, OR: 0.0093, PA: 0.0149, RI: 0.0140,
  SC: 0.0057, SD: 0.0117, TN: 0.0067, TX: 0.0168, UT: 0.0057,
  VT: 0.0183, VA: 0.0087, WA: 0.0087, WV: 0.0059, WI: 0.0161,
  WY: 0.0056,
};

const DEFAULT_RATE = 0.011; // U.S. average

export function estimateTaxRate(state: string): TaxEstimate {
  const rate = STATE_RATES[state.toUpperCase()];
  if (rate !== undefined) {
    return {
      effectiveRate: rate,
      source: `${state.toUpperCase()} statewide average (override with actual county rate for accuracy)`,
    };
  }
  return { effectiveRate: DEFAULT_RATE, source: "U.S. average (state unknown)" };
}
