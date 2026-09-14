import { describe, expect, it } from "vitest";
import { investorValue } from "@/lib/investorValue";
import { DEFAULT_ASSUMPTIONS } from "@/lib/metrics";
import { computeScenariosFromData } from "@/lib/scenarios";
import type { AnalyzeResponse, Assumptions } from "@/lib/types";

// A minimal synthetic analysis: HUD-only data path, no paid keys.
const data: AnalyzeResponse = {
  property: {
    matchedAddress: "1 TEST ST, TESTVILLE, OH, 45000",
    lat: 39.1,
    lon: -84.5,
    zip: "45000",
    state: "OH",
    countyFips: "39061",
    countyName: "Test County",
  },
  fmr: {
    year: 2026,
    areaName: "Test MSA",
    smallAreaUsed: false,
    byBedroom: { 0: 800, 1: 900, 2: 1100, 3: 1300, 4: 1600 },
  },
  flood: { zone: null, highRisk: false, moderateRisk: false, source: "test" },
  tax: { effectiveRate: 0.015, source: "test statewide average" },
};

const a: Assumptions = {
  ...DEFAULT_ASSUMPTIONS,
  price: 118000,
  bedrooms: 3,
};

describe("investorValue", () => {
  it("finds a positive max buy price for an attainable target", () => {
    const iv = investorValue(data, a, "s8", 10);
    expect(iv).toBeGreaterThan(0);
  });

  it("rounds to the nearest $500", () => {
    const iv = investorValue(data, a, "s8", 10);
    expect(iv % 500).toBe(0);
  });

  it("falls as the required return rises", () => {
    const at8 = investorValue(data, a, "s8", 8);
    const at12 = investorValue(data, a, "s8", 12);
    const at16 = investorValue(data, a, "s8", 16);
    expect(at8).toBeGreaterThan(at12);
    expect(at12).toBeGreaterThan(at16);
  });

  it("returns 0 when even the floor price cannot reach the target", () => {
    // at the $5,000 floor a cheap house still produces triple-digit
    // cash-on-cash, so the unattainable bar has to be absurd
    expect(investorValue(data, a, "market", 10000)).toBe(0);
  });

  it("the strategy actually clears the target at the solved price", () => {
    const target = 10;
    const iv = investorValue(data, a, "s8", target);
    // re-run the scenario just below the solved price and confirm the
    // return holds (within the $500 rounding of the bisection result)
    const set = computeScenariosFromData(data, { ...a, price: iv - 500 });
    expect(set.s8).not.toBeNull();
    expect(set.s8!.cashOnCashPct).toBeGreaterThanOrEqual(target);
  });
});
