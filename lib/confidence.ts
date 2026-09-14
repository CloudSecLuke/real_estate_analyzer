import type { ScenarioSet } from "./scenarios";
import type { AnalyzeResponse, Assumptions } from "./types";
import { usdWhole } from "./verdict";

// "Where each number came from": one row per input with its source, its
// confidence, and (where we have more than one signal) a range. The
// roll-up percentage answers: how much of this analysis rests on directly
// sourced data rather than inferred estimates?

export type ConfidenceLevel = "High" | "Medium" | "Low";

export interface SourceRow {
  label: string;
  source: string;
  value: string;
  conf: ConfidenceLevel;
}

export const CONF_PILL: Record<ConfidenceLevel, { bg: string; fg: string }> = {
  High: { bg: "#e8f0e9", fg: "#1f5437" },
  Medium: { bg: "#fdf6e4", fg: "#6b4508" },
  Low: { bg: "#f7ece9", fg: "#8a231a" },
};

export interface ConfidenceModel {
  rows: SourceRow[];
  pct: number;
  label: string; // "High confidence · 80%"
  color: string;
  note: string;
  rentRange: { low: number; high: number } | null;
}

export function buildConfidence(
  data: AnalyzeResponse,
  set: ScenarioSet,
  a: Assumptions
): ConfidenceModel {
  // range for the market rent: the spread across every independent signal
  const rentSignals = [
    set.fmrRent,
    set.acsRentForBeds,
    data.attom?.rentalAvm ?? null,
  ].filter((v): v is number => v != null && v > 0);
  const rentRange =
    rentSignals.length >= 2
      ? { low: Math.min(...rentSignals), high: Math.max(...rentSignals) }
      : null;

  const marketSrcLabel =
    set.marketRentSource === "override"
      ? "your own comp (override)"
      : set.marketRentSource === "rent AVM"
        ? "ATTOM automated rent estimate"
        : set.marketRentSource === "local ACS median"
          ? "county median rent (Census ACS)"
          : set.marketRentSource === "FMR"
            ? "HUD Fair Market Rent"
            : "no source configured";

  const taxConf: ConfidenceLevel =
    a.taxRateOverride != null && a.taxRateOverride !== 0
      ? "High"
      : /tax bill via ATTOM/.test(set.taxSource)
        ? "High"
        : /median effective rate/.test(set.taxSource)
          ? "Medium"
          : "Low";

  const rows: SourceRow[] = [
    {
      label: "Market rent",
      source:
        marketSrcLabel +
        (rentRange
          ? ` · range ${usdWhole(rentRange.low)}–${usdWhole(rentRange.high)}`
          : ""),
      value: set.market ? usdWhole(set.market.monthlyRent) + "/mo" : "—",
      conf:
        set.marketRentSource === "override"
          ? "High"
          : set.marketRentSource
            ? "Medium"
            : "Low",
    },
    {
      label: "Section 8 rent",
      source: set.s8
        ? `HUD Fair Market Rent × ${a.paymentStandardPct}% payment standard`
        : "needs HUD Fair Market Rent data",
      value: set.s8 ? usdWhole(set.s8.monthlyRent) + "/mo" : "—",
      conf: set.s8 ? "High" : "Low",
    },
    {
      label: "Short-term revenue",
      source: set.str
        ? "Mashvisor, occupancy-adjusted"
        : "needs a Mashvisor key",
      value: set.str ? usdWhole(set.str.monthlyRent) + "/mo" : "—",
      conf: set.str ? "Medium" : "Low",
    },
    {
      label: "Property taxes",
      source: set.taxSource,
      value: (set.taxRate * 100).toFixed(2) + "%/yr",
      conf: taxConf,
    },
    {
      label: "Insurance",
      source: `your assumption, ${a.insurancePctOfValue}% of value per year (floor ${usdWhole(a.insuranceFloorMonthly ?? 0)}/mo)`,
      value: set.market
        ? usdWhole(set.market.expenses.insurance) + "/mo"
        : set.s8
          ? usdWhole(set.s8.expenses.insurance) + "/mo"
          : "—",
      conf: "Medium",
    },
    {
      label: "Flood zone",
      source: data.flood.highRisk
        ? "FEMA flood map · high risk, insurance +40%"
        : data.flood.moderateRisk
          ? "FEMA flood map · moderate risk, insurance +15%"
          : "FEMA flood map · no surcharge",
      value: data.flood.zone ? `Zone ${data.flood.zone}` : "none mapped",
      conf: "High",
    },
    {
      label: "Estimated value",
      source:
        data.attom?.avmValue != null
          ? `ATTOM automated valuation${data.attom.avmConfidence != null ? `, confidence ${data.attom.avmConfidence}/100` : ""}`
          : data.attomError
            ? "ATTOM unavailable"
            : "no ATTOM key",
      value: data.attom?.avmValue != null ? usdWhole(data.attom.avmValue) : "—",
      conf: data.attom?.avmValue != null ? "Medium" : "Low",
    },
    {
      label: "Last sale",
      source:
        data.attom?.lastSalePrice != null
          ? `county record${data.attom.lastSaleDate ? `, ${data.attom.lastSaleDate.slice(0, 4)}` : ""}`
          : data.attomError
            ? "ATTOM unavailable"
            : "no ATTOM key",
      value:
        data.attom?.lastSalePrice != null
          ? usdWhole(data.attom.lastSalePrice)
          : "—",
      conf: data.attom?.lastSalePrice != null ? "High" : "Low",
    },
  ];

  const pct = Math.round(
    (rows.reduce(
      (acc, r) => acc + (r.conf === "High" ? 1 : r.conf === "Medium" ? 0.6 : 0.1),
      0
    ) /
      rows.length) *
      100
  );

  return {
    rows,
    pct,
    label:
      (pct >= 80
        ? "High confidence · "
        : pct >= 60
          ? "Medium confidence · "
          : "Low confidence · ") + pct + "%",
    color: pct >= 80 ? "#0f6b44" : pct >= 60 ? "#8a5a0b" : "#a8281e",
    note:
      pct >= 80
        ? "Property facts and taxes come straight from public records. Rent and insurance carry the usual modelling uncertainty."
        : "Several inputs are inferred rather than sourced. Treat the score as a first read and verify the flagged rows before making an offer.",
    rentRange,
  };
}
