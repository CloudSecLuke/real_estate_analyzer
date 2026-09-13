"use client";

import { useState } from "react";
import type { ScenarioSet } from "@/lib/scenarios";
import {
  fidelitySentence,
  MARKET_SRC_LABEL,
  usdWhole,
  type FidelityBenchmark,
} from "@/lib/verdict";
import type {
  AnalyzeResponse,
  CompareRequest,
  CompareResponse,
} from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function seasonColor(fraction: number): string {
  if (fraction >= 0.75) return "#96552a";
  if (fraction >= 0.55) return "#c9a077";
  return "#ddd3c2";
}

/**
 * The redesign's fidelity check: our market-rent baseline against every
 * independent benchmark, suppressing whichever source IS the baseline so no
 * row compares a number to itself. Free benchmarks render immediately; the
 * Re-run button spends ~6 Mashvisor calls for the paid ones, the ML score,
 * the seasonality chart, comps and the neighborhood history.
 */
export default function FidelityCheck({
  data,
  scenarios,
  price,
  bedrooms,
  mashvisorConfigured,
}: {
  data: AnalyzeResponse;
  scenarios: ScenarioSet | null;
  price: number;
  bedrooms: number;
  mashvisorConfigured: boolean;
}) {
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const beds = Math.min(4, Math.max(0, bedrooms)) as 0 | 1 | 2 | 3 | 4;
  const src = scenarios?.marketRentSource;
  const ourRent = scenarios?.market?.monthlyRent ?? 0;

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const parts = data.property.matchedAddress.split(",").map((s) => s.trim());
      const body: CompareRequest = {
        state: data.property.state,
        city: parts[1] ?? "",
        zip: data.property.zip,
        address: parts[0] ?? "",
        lat: data.property.lat,
        lon: data.property.lon,
        beds: bedrooms,
        baths: data.attom?.baths,
        sqft: data.attom?.sqft,
        price,
        traditionalRent: scenarios?.market?.monthlyRent,
        traditionalCoc: scenarios?.market?.cashOnCashPct,
        strRent: scenarios?.str?.monthlyRent,
        strCoc: scenarios?.str?.cashOnCashPct,
      };
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Comparison failed");
      setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Comparison failed");
    } finally {
      setLoading(false);
    }
  }

  // Independent benchmarks, minus whichever source is already the baseline.
  const benchmarks: FidelityBenchmark[] = [];
  if (scenarios?.fmrRent != null && src !== "FMR") {
    benchmarks.push({
      label: `HUD Fair Market Rent · ${bedrooms} bedroom`,
      value: scenarios.fmrRent,
    });
  }
  if (scenarios?.acsRentForBeds != null && src !== "local ACS median") {
    benchmarks.push({
      label: "County median rent · Census ACS, inflated",
      value: scenarios.acsRentForBeds,
    });
  }
  if (data.attom?.rentalAvm != null && src !== "rent AVM") {
    benchmarks.push({
      label: "ATTOM automated rent estimate",
      value: data.attom.rentalAvm,
    });
  }
  const mvMedian = result?.traditionalRates?.byBedroom?.[beds];
  if (mvMedian != null) {
    benchmarks.push({
      label: `Mashvisor median for this ZIP code${
        result?.traditionalRates?.sampleCount
          ? ` · ${result.traditionalRates.sampleCount} sampled`
          : ""
      }`,
      value: mvMedian,
    });
  }
  if (result?.comps?.medianRent != null) {
    benchmarks.push({
      label: `Comparable rentals median · ${result.comps.count ?? "?"} listings`,
      value: result.comps.medianRent,
    });
  }
  const hood = result?.neighborhoodHistorical;
  if (hood?.averages?.[beds] != null) {
    benchmarks.push({
      label: `${hood.neighborhoodName ?? "Neighborhood"} average · Mashvisor`,
      value: hood.averages[beds]!,
    });
  }

  const delta = (v: number) =>
    ourRent ? ((v - ourRent) / ourRent) * 100 : null;

  const seasonMonths = (result?.strHistorical?.months ?? []).filter(
    (m) => m.rentalIncome != null
  );
  const peak = Math.max(1, ...seasonMonths.map((m) => m.rentalIncome!));

  const yoyBits: string[] = [];
  if (result?.traditionalHistorical?.rentalIncomeYoYPct != null) {
    const v = result.traditionalHistorical.rentalIncomeYoYPct;
    yoyBits.push(`long-term rents ${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`);
  }
  if (result?.strHistorical?.rentalIncomeYoYPct != null) {
    const v = result.strHistorical.rentalIncomeYoYPct;
    yoyBits.push(`short-term revenue ${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`);
  }
  if (result?.strHistorical?.occupancyYoYPct != null) {
    const v = result.strHistorical.occupancyYoYPct;
    yoyBits.push(`short-term occupancy ${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`);
  }

  return (
    <div className="flex flex-col">
      <div className="mb-1 flex items-baseline justify-between gap-[10px] border-b-2 border-ink pb-2">
        <h3 className="font-serif text-[21px] font-medium">Fidelity check</h3>
        {mashvisorConfigured && (
          <button
            onClick={run}
            disabled={loading}
            className="cursor-pointer border-b border-accent/30 text-[12px] text-accent hover:text-link-hover disabled:opacity-60"
          >
            {loading ? "Running…" : "Re-run · ~6 calls"}
          </button>
        )}
      </div>

      {error && (
        <p className="py-2 text-[12.5px] text-negative">{error}</p>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto]">
        <span className="border-b border-rule py-[10px] text-[13px] font-semibold text-ink">
          Ours · {(src && MARKET_SRC_LABEL[src]) || "no baseline"}
        </span>
        <span className="border-b border-rule py-[10px] pl-[14px] text-right text-[13px] font-semibold">
          {ourRent ? usdWhole(ourRent) : "—"}
        </span>
        <span className="w-[66px] border-b border-rule py-[10px] pl-[14px] text-right text-[12px] text-label">
          baseline
        </span>
        {benchmarks.map((b) => {
          const d = delta(b.value);
          return (
            <span key={b.label} className="contents">
              <span className="border-b border-rule py-[10px] text-[13px] text-[#4a423a]">
                {b.label}
              </span>
              <span className="border-b border-rule py-[10px] pl-[14px] text-right text-[13px]">
                {usdWhole(b.value)}
              </span>
              <span
                className="w-[66px] border-b border-rule py-[10px] pl-[14px] text-right text-[12px]"
                style={{ color: d != null && d >= 0 ? "#2f6b4f" : "#6b6257" }}
              >
                {d != null ? `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(0)}%` : "—"}
              </span>
            </span>
          );
        })}
        {!mashvisorConfigured && data.attom?.rentalAvm == null && (
          <span className="contents">
            <span className="border-b border-rule py-[10px] text-[13px] text-disabled">
              Paid benchmarks
            </span>
            <span className="border-b border-rule py-[10px] pl-[14px] text-right text-[13px] text-disabled">
              —
            </span>
            <span className="w-[66px] border-b border-rule py-[10px] pl-[14px] text-right text-[12px] text-disabled">
              no keys
            </span>
          </span>
        )}
      </div>

      <p className="mt-3 font-serif text-[14px] leading-[1.6] text-[#4a423a]">
        {fidelitySentence(
          benchmarks,
          ourRent,
          result?.likelihood?.likelihoodPct ?? undefined
        )}
      </p>

      {result && Object.keys(result.errors).length > 0 && (
        <p className="mt-2 text-[11.5px] leading-[1.6] text-chip-off-text">
          {Object.entries(result.errors)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ")}
        </p>
      )}

      {seasonMonths.length > 0 && (
        <div className="mt-[18px] flex flex-col gap-[7px]">
          <span
            className="text-[10.5px] font-semibold uppercase tracking-[.12em] text-label"
            title="How short-term revenue moves across the year in this market. Tall bars are the booking season; the flat months are the ones that sink an annual average."
          >
            Short-term rental seasonality · monthly revenue
          </span>
          <div className="flex h-[58px] items-end gap-[5px]">
            {seasonMonths.map((m, i) => {
              const f = m.rentalIncome! / peak;
              return (
                <span
                  key={i}
                  title={`${MONTHS[(m.month - 1 + 12) % 12]} ${m.year}: ${usdWhole(m.rentalIncome!)}${m.occupancyPct != null ? ` · ${m.occupancyPct.toFixed(0)}% occupancy` : ""}`}
                  className="flex-1"
                  style={{
                    height: `${Math.max(4, f * 100)}%`,
                    background: seasonColor(f),
                  }}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[11px] text-label">
            {[0, Math.floor(seasonMonths.length / 3), Math.floor((2 * seasonMonths.length) / 3), seasonMonths.length - 1]
              .filter((v, i, arr) => arr.indexOf(v) === i)
              .map((idx) => (
                <span key={idx}>
                  {MONTHS[(seasonMonths[idx].month - 1 + 12) % 12]}
                </span>
              ))}
          </div>
          {yoyBits.length > 0 && (
            <span className="text-[12px] text-body">
              Year over year: {yoyBits.join(" · ")}
            </span>
          )}
        </div>
      )}

      {result?.comps && result.comps.items.length > 0 && (
        <details className="mt-3 text-[12.5px] text-[#4a423a]">
          <summary className="cursor-pointer text-label">
            Sample comparable rentals
          </summary>
          <ul className="mt-1 flex flex-col gap-[2px]">
            {result.comps.items.map((c, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="truncate">
                  {c.address}
                  {c.beds != null && (
                    <span className="text-label"> · {c.beds} BR</span>
                  )}
                  {c.sqft != null && (
                    <span className="text-label"> · {c.sqft.toLocaleString()} sqft</span>
                  )}
                </span>
                <span className="whitespace-nowrap tabular-nums">
                  {c.rent != null ? `${usdWhole(c.rent)}/mo` : "—"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {hood && hood.months.length > 0 && (
        <details className="mt-2 text-[12.5px] text-[#4a423a]">
          <summary className="cursor-pointer text-label">
            {hood.neighborhoodName ?? "Neighborhood"} rent history ({bedrooms} BR, Mashvisor)
          </summary>
          <ul className="mt-1 flex flex-col gap-[2px]">
            {hood.months.slice(-12).map((m, i) => (
              <li key={i} className="flex justify-between gap-2 tabular-nums">
                <span>
                  {MONTHS[(m.month - 1 + 12) % 12]} {m.year}
                </span>
                <span>
                  {m.byBedroom[beds] != null ? usdWhole(m.byBedroom[beds]!) : "—"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
