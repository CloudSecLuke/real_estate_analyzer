import type { Rating, ScenarioResult } from "./types";

// The Pencil Score: a weighted, explainable 0-100 reading of one strategy.
// Each part is a 0-1 fraction against a stated target. The ramps are
// DELIBERATELY hard to top out — an earlier draft scored the sample deal a
// perfect 100, which reads as fake precision. Do not tighten them.

export interface PencilTier {
  min: number;
  label: string;
  short: string;
  bg: string;
  fg: string;
  dot: string;
}

export const PENCIL_TIERS: PencilTier[] = [
  { min: 90, label: "Rare Pencil", short: "Rare", bg: "#171717", fg: "#f4c542", dot: "#171717" },
  { min: 80, label: "Fantastic Pencil", short: "Fantastic", bg: "#0f6b44", fg: "#ffffff", dot: "#0f6b44" },
  { min: 70, label: "Great Pencil", short: "Great", bg: "#3f7a2e", fg: "#ffffff", dot: "#3f7a2e" },
  { min: 60, label: "Good Pencil", short: "Good", bg: "#8a6410", fg: "#ffffff", dot: "#8a6410" },
  { min: 50, label: "Fair Pencil", short: "Fair", bg: "#a85520", fg: "#ffffff", dot: "#a85520" },
  { min: -Infinity, label: "Poor Pencil", short: "Poor", bg: "#a8281e", fg: "#ffffff", dot: "#a8281e" },
];

export const tierForScore = (score: number): PencilTier =>
  PENCIL_TIERS.find((t) => score >= t.min)!;

/** Legacy threshold ratings map onto tier visuals for old saved pins. */
export const tierForLegacyRating = (rating: Rating): PencilTier =>
  PENCIL_TIERS.find((t) => t.short === rating) ?? PENCIL_TIERS[PENCIL_TIERS.length - 1];

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export interface ScorePart {
  key: "cf" | "coc" | "cap" | "dscr" | "price";
  label: string;
  weight: number;
  frac: number; // 0-1
  value: string; // display value
}

export interface ScoreInputs {
  units: number;
  targetCoc: number; // %
  price: number;
  investorValue: number; // 0 = unknown / unattainable
}

/** DSCR: yearly income after operating expenses over yearly debt service. */
export function dscrOf(s: ScenarioResult): number {
  return s.monthlyPI > 0 ? s.noi / (s.monthlyPI * 12) : Infinity;
}

const signed = (v: number) =>
  (v >= 0 ? "+" : "−") + "$" + Math.abs(Math.round(v)).toLocaleString("en-US");

export function scoreParts(s: ScenarioResult, inp: ScoreInputs): ScorePart[] {
  const t = inp.targetCoc;
  const cfPerUnit = s.monthlyCashFlow / Math.max(1, inp.units);
  const dscr = dscrOf(s);
  const valueRatio = inp.investorValue > 0 ? inp.price / inp.investorValue : 2;
  return [
    { key: "cf", label: "Monthly cash flow", weight: 30, frac: clamp01(cfPerUnit / 750), value: signed(cfPerUnit) + "/mo" },
    { key: "coc", label: "Cash-on-cash", weight: 25, frac: clamp01(s.cashOnCashPct / (t * 2.5)), value: s.cashOnCashPct.toFixed(1) + "%" },
    { key: "cap", label: "Cap rate", weight: 15, frac: clamp01((s.capRatePct - 3) / 12), value: s.capRatePct.toFixed(1) + "%" },
    { key: "dscr", label: "Debt coverage", weight: 15, frac: clamp01((dscr - 0.9) / 1.1), value: (Number.isFinite(dscr) ? dscr.toFixed(2) : "—") + "x" },
    {
      key: "price",
      label: "Price vs value",
      weight: 15,
      frac: clamp01((1.1 - valueRatio) / 0.45),
      value: inp.investorValue > 0 ? Math.round((valueRatio - 1) * 100) + "% vs value" : "—",
    },
  ];
}

export function pencilScore(s: ScenarioResult, inp: ScoreInputs): number {
  return Math.round(
    scoreParts(s, inp).reduce((acc, p) => acc + p.frac * p.weight, 0)
  );
}
