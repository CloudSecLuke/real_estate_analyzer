import { describe, expect, it } from "vitest";
import {
  pencilScore,
  scoreParts,
  tierForScore,
  dscrOf,
  PENCIL_TIERS,
} from "@/lib/pencilScore";
import type { ScenarioResult } from "@/lib/types";

// A ScenarioResult carrying exactly the handoff's sample-deal readings:
// +$557/mo cash flow, 24.6% cash-on-cash, 12.2% cap, 1.87x DSCR, against
// a $118,000 ask and a $156,500 investor value.
function sample(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  const monthlyPI = 600;
  const noi = 1.87 * monthlyPI * 12; // dscr = 1.87x
  return {
    label: "Test",
    monthlyRent: 1275,
    monthlyCashFlow: 557,
    annualCashFlow: 557 * 12,
    noi,
    capRatePct: 12.2,
    cashOnCashPct: 24.6,
    grm: 7.7,
    rating: "Fantastic",
    ratingDetail: { rating: "Fantastic", almost: null, gaps: [] },
    cashInvested: 27140,
    monthlyPI,
    expenses: {
      taxes: 156,
      insurance: 60,
      maintenance: 110,
      capex: 64,
      management: 128,
      vacancy: 64,
      other: 0,
      totalMonthly: 582,
    },
    ...overrides,
  };
}

const INPUTS = {
  units: 1,
  targetCoc: 10,
  price: 118000,
  investorValue: 156500,
};

describe("pencilScore", () => {
  it("scores the handoff's sample deal 83 — Fantastic Pencil", () => {
    const score = pencilScore(sample(), INPUTS);
    expect(score).toBe(83);
    expect(tierForScore(score).label).toBe("Fantastic Pencil");
  });

  it("drops when the required return rises (16%) and rises when it falls (6%), investor value held constant", () => {
    // The handoff's 71/86 figures also let investor value move with the
    // target; with it held constant the coc part alone moves the score.
    const at16 = pencilScore(sample(), { ...INPUTS, targetCoc: 16 });
    const at6 = pencilScore(sample(), { ...INPUTS, targetCoc: 6 });
    expect(at16).toBe(74);
    expect(at6).toBe(84);
    expect(at16).toBeLessThan(83);
    expect(at6).toBeGreaterThan(83);
  });

  it("never exceeds 100 and never goes below 0", () => {
    const monster = sample({
      monthlyCashFlow: 5000,
      cashOnCashPct: 300,
      capRatePct: 40,
      noi: 100000,
    });
    expect(pencilScore(monster, INPUTS)).toBeLessThanOrEqual(100);
    const disaster = sample({
      monthlyCashFlow: -2000,
      cashOnCashPct: -50,
      capRatePct: 0,
      noi: -1000,
    });
    expect(pencilScore(disaster, { ...INPUTS, investorValue: 0 })).toBeGreaterThanOrEqual(0);
  });

  it("weights sum to 100 and every part reports a clamped 0-1 fraction", () => {
    const parts = scoreParts(sample(), INPUTS);
    expect(parts.reduce((a, p) => a + p.weight, 0)).toBe(100);
    for (const p of parts) {
      expect(p.frac).toBeGreaterThanOrEqual(0);
      expect(p.frac).toBeLessThanOrEqual(1);
    }
  });

  it("the ramps are hard to top out: the sample deal does not read a fake 100", () => {
    expect(pencilScore(sample(), INPUTS)).toBeLessThan(100);
  });

  it("maps scores to the six tiers at their boundaries", () => {
    expect(tierForScore(90).label).toBe("Rare Pencil");
    expect(tierForScore(89).label).toBe("Fantastic Pencil");
    expect(tierForScore(80).label).toBe("Fantastic Pencil");
    expect(tierForScore(79).label).toBe("Great Pencil");
    expect(tierForScore(70).label).toBe("Great Pencil");
    expect(tierForScore(69).label).toBe("Good Pencil");
    expect(tierForScore(60).label).toBe("Good Pencil");
    expect(tierForScore(59).label).toBe("Fair Pencil");
    expect(tierForScore(50).label).toBe("Fair Pencil");
    expect(tierForScore(49).label).toBe("Poor Pencil");
    expect(PENCIL_TIERS).toHaveLength(6);
  });

  it("computes DSCR as NOI over yearly debt service", () => {
    expect(dscrOf(sample())).toBeCloseTo(1.87, 5);
    expect(dscrOf(sample({ monthlyPI: 0 }))).toBe(Infinity);
  });
});
