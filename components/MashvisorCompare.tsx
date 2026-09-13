"use client";

import { useState } from "react";
import type { ScenarioSet } from "@/lib/scenarios";
import type {
  AnalyzeResponse,
  CompareRequest,
  CompareResponse,
} from "@/lib/types";

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Signed % difference of a benchmark vs our number, e.g. "+12%"
function delta(benchmark: number, ours: number): string {
  if (!ours) return "";
  const d = ((benchmark - ours) / ours) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(0)}%`;
}

function SectionError({ name, msg }: { name: string; msg?: string }) {
  if (!msg) return null;
  return (
    <p className="text-xs text-amber-700 dark:text-amber-400">
      {name} unavailable: {msg}
    </p>
  );
}

/**
 * On-demand data-fidelity check: pulls Mashvisor's rental rates, comps,
 * historical performance and ML score for the analyzed address and lines
 * them up against our HUD/ATTOM-derived numbers. Costs ~6 Mashvisor API
 * calls, so it only runs when clicked.
 */
export default function MashvisorCompare({
  data,
  scenarios,
  price,
  bedrooms,
}: {
  data: AnalyzeResponse;
  scenarios: ScenarioSet | null;
  price: number;
  bedrooms: number;
}) {
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const beds = Math.min(4, Math.max(0, bedrooms)) as 0 | 1 | 2 | 3 | 4;
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

  const mvTraditional = result?.traditionalRates?.byBedroom?.[beds];

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-lg">Data fidelity check</h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Benchmark our HUD/ATTOM numbers against Mashvisor for this address.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="rounded-md border border-emerald-600 text-emerald-700 dark:text-emerald-400 px-4 py-1.5 font-semibold disabled:opacity-50"
        >
          {loading ? "Comparing…" : result ? "Re-run" : "Run comparison (~6 API calls)"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5 text-sm">
          <div className="flex flex-col gap-2">
            <h4 className="font-semibold">
              Monthly rent for {bedrooms} BR — sources side by side
            </h4>
            <table className="w-full">
              <tbody>
                <tr className="border-b border-zinc-100 dark:border-zinc-800 font-semibold">
                  <td className="py-1">
                    Ours ({scenarios?.marketRentSource ?? "n/a"})
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {ourRent ? usd(ourRent) : "—"}
                  </td>
                  <td className="py-1 text-right w-16" />
                </tr>
                {scenarios?.fmrRent != null && (
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="py-1">HUD FMR</td>
                    <td className="py-1 text-right tabular-nums">
                      {usd(scenarios.fmrRent)}
                    </td>
                    <td className="py-1 text-right text-zinc-500">
                      {delta(scenarios.fmrRent, ourRent)}
                    </td>
                  </tr>
                )}
                {data.attom?.rentalAvm != null && (
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="py-1">ATTOM rent AVM</td>
                    <td className="py-1 text-right tabular-nums">
                      {usd(data.attom.rentalAvm)}
                    </td>
                    <td className="py-1 text-right text-zinc-500">
                      {delta(data.attom.rentalAvm, ourRent)}
                    </td>
                  </tr>
                )}
                {mvTraditional != null && (
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="py-1">
                      Mashvisor median (ZIP
                      {result.traditionalRates?.sampleCount
                        ? `, n=${result.traditionalRates.sampleCount}`
                        : ""}
                      )
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {usd(mvTraditional)}
                    </td>
                    <td className="py-1 text-right text-zinc-500">
                      {delta(mvTraditional, ourRent)}
                    </td>
                  </tr>
                )}
                {result.comps?.medianRent != null && (
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="py-1">
                      Mashvisor comps median ({result.comps.count ?? "?"} listings)
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {usd(result.comps.medianRent)}
                    </td>
                    <td className="py-1 text-right text-zinc-500">
                      {delta(result.comps.medianRent, ourRent)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <SectionError name="Rental rates" msg={result.errors.traditionalRates} />
            <SectionError name="Comps" msg={result.errors.comps} />

            {result.comps && result.comps.items.length > 0 && (
              <details>
                <summary className="cursor-pointer text-zinc-500">
                  Sample comps
                </summary>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {result.comps.items.map((c, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="truncate">
                        {c.address}
                        {c.beds != null && (
                          <span className="text-zinc-500"> · {c.beds} BR</span>
                        )}
                      </span>
                      <span className="tabular-nums whitespace-nowrap">
                        {c.rent != null ? `${usd(c.rent)}/mo` : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {result.likelihood?.likelihoodPct != null && (
              <div className="mt-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2">
                Mashvisor ML investment likelihood (scoring our numbers):{" "}
                <b>{result.likelihood.likelihoodPct.toFixed(0)}%</b>
                {scenarios?.market && (
                  <span className="text-zinc-500">
                    {" "}
                    — our rating: {scenarios.market.rating}
                  </span>
                )}
              </div>
            )}
            <SectionError name="Investment likelihood" msg={result.errors.likelihood} />
          </div>

          <div className="flex flex-col gap-2">
            <h4 className="font-semibold">Trends (Mashvisor historicals)</h4>
            {result.neighborhoodHistorical && (
              <p>
                Neighborhood{" "}
                <b>{result.neighborhoodHistorical.neighborhoodName ?? "?"}</b>{" "}
                traditional avg for {bedrooms} BR:{" "}
                <b>
                  {result.neighborhoodHistorical.averages?.[beds] != null
                    ? usd(result.neighborhoodHistorical.averages[beds]!)
                    : "—"}
                </b>
                {result.neighborhoodHistorical.averages?.[beds] != null &&
                  ourRent > 0 && (
                    <span className="text-zinc-500">
                      {" "}
                      ({delta(result.neighborhoodHistorical.averages[beds]!, ourRent)}{" "}
                      vs ours)
                    </span>
                  )}
              </p>
            )}
            <SectionError
              name="Neighborhood history"
              msg={result.errors.neighborhoodHistorical}
            />

            {(result.traditionalHistorical?.rentalIncomeYoYPct != null ||
              result.strHistorical?.rentalIncomeYoYPct != null) && (
              <p>
                Year over year:{" "}
                {result.traditionalHistorical?.rentalIncomeYoYPct != null && (
                  <>
                    traditional rents{" "}
                    <b>
                      {result.traditionalHistorical.rentalIncomeYoYPct >= 0 ? "+" : ""}
                      {result.traditionalHistorical.rentalIncomeYoYPct.toFixed(1)}%
                    </b>
                  </>
                )}
                {result.strHistorical?.rentalIncomeYoYPct != null && (
                  <>
                    {" "}· STR revenue{" "}
                    <b>
                      {result.strHistorical.rentalIncomeYoYPct >= 0 ? "+" : ""}
                      {result.strHistorical.rentalIncomeYoYPct.toFixed(1)}%
                    </b>
                  </>
                )}
                {result.strHistorical?.occupancyYoYPct != null && (
                  <>
                    {" "}· STR occupancy{" "}
                    <b>
                      {result.strHistorical.occupancyYoYPct >= 0 ? "+" : ""}
                      {result.strHistorical.occupancyYoYPct.toFixed(1)}%
                    </b>
                  </>
                )}
              </p>
            )}

            {result.strHistorical && result.strHistorical.months.length > 0 && (
              <details open>
                <summary className="cursor-pointer text-zinc-500">
                  STR monthly history (seasonality)
                </summary>
                <table className="mt-1 w-full">
                  <thead>
                    <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                      <th className="py-1 font-medium">Month</th>
                      <th className="py-1 font-medium text-right">Revenue</th>
                      <th className="py-1 font-medium text-right">Nightly</th>
                      <th className="py-1 font-medium text-right">Occupancy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.strHistorical.months.slice(-12).map((m, i) => (
                      <tr
                        key={i}
                        className="border-b border-zinc-100 dark:border-zinc-800/60"
                      >
                        <td className="py-0.5">
                          {MONTHS[(m.month - 1 + 12) % 12]} {m.year}
                        </td>
                        <td className="py-0.5 text-right tabular-nums">
                          {m.rentalIncome != null ? usd(m.rentalIncome) : "—"}
                        </td>
                        <td className="py-0.5 text-right tabular-nums">
                          {m.nightPrice != null ? usd(m.nightPrice) : "—"}
                        </td>
                        <td className="py-0.5 text-right tabular-nums">
                          {m.occupancyPct != null
                            ? `${m.occupancyPct.toFixed(0)}%`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
            <SectionError name="STR history" msg={result.errors.strHistorical} />
            <SectionError
              name="Traditional history"
              msg={result.errors.traditionalHistorical}
            />
          </div>
        </div>
      )}
    </div>
  );
}
