"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { DEFAULT_ASSUMPTIONS, formatGaps, RATING_COLORS } from "@/lib/metrics";
import { buildPin, computeScenariosFromData } from "@/lib/scenarios";
import BatchImport from "@/components/BatchImport";
import MashvisorCompare from "@/components/MashvisorCompare";
import type {
  AnalyzeResponse,
  Assumptions,
  PinMetrics,
  Rating,
  SavedPin,
  ScenarioKey,
  ScenarioResult,
} from "@/lib/types";

// Leaflet touches `window` at import time — client-only
const PropertyMap = dynamic(() => import("@/components/PropertyMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[440px] w-full rounded-xl border border-zinc-200 dark:border-zinc-800 animate-pulse bg-zinc-100 dark:bg-zinc-900" />
  ),
});

const ALL_RATINGS: Rating[] = ["Rare", "Fantastic", "Great", "Good", "Poor"];
const PINS_KEY = "rea_saved_pins_v1";

function RatingBadge({
  rating,
  almost,
}: {
  rating: Rating;
  almost: Rating | null;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
        style={{ backgroundColor: RATING_COLORS[rating] }}
      >
        {rating}
      </span>
      {almost && (
        <span
          className="rounded-full px-2 py-0.5 text-xs font-semibold border border-dashed"
          style={{ borderColor: RATING_COLORS[almost], color: RATING_COLORS[almost] }}
        >
          Almost {almost}
        </span>
      )}
    </span>
  );
}

const usd = (n: number, digits = 0) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });

function NumInput({
  label,
  value,
  onChange,
  step = 1,
  suffix,
  placeholder,
}: {
  label: string;
  value: number | "";
  onChange: (v: number | "") => void;
  step?: number;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          step={step}
          value={value}
          placeholder={placeholder}
          onChange={(e) =>
            onChange(e.target.value === "" ? "" : Number(e.target.value))
          }
          className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5"
        />
        {suffix && <span className="text-zinc-400 text-xs">{suffix}</span>}
      </div>
    </label>
  );
}

function ScenarioCard({ s }: { s: ScenarioResult }) {
  const positive = s.monthlyCashFlow > 0;
  const almost = s.ratingDetail.almost;
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-lg">{s.label}</h3>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="rounded-full px-3 py-0.5 text-sm font-semibold text-white"
            style={{ backgroundColor: RATING_COLORS[s.rating] }}
          >
            {s.rating}
          </span>
          {almost && (
            <span
              className="rounded-full px-2.5 py-0.5 text-sm font-semibold border-2 border-dashed"
              style={{
                borderColor: RATING_COLORS[almost],
                color: RATING_COLORS[almost],
              }}
            >
              Almost {almost}
            </span>
          )}
        </span>
      </div>

      <div>
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          Monthly cash flow (after mortgage)
        </div>
        <div
          className={`text-4xl font-bold tabular-nums ${
            positive ? "text-emerald-600" : "text-red-600"
          }`}
        >
          {usd(s.monthlyCashFlow)}
          <span className="text-base font-medium text-zinc-400"> /mo</span>
        </div>
        {almost && (
          <div
            className="text-sm font-medium mt-1"
            style={{ color: RATING_COLORS[almost] }}
          >
            Only {formatGaps(s.ratingDetail)} away from {almost} — worth a
            second look.
          </div>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Rent</dt>
          <dd className="font-semibold tabular-nums">{usd(s.monthlyRent)}/mo</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Cash-on-cash ROI</dt>
          <dd className="font-semibold tabular-nums">
            {s.cashOnCashPct.toFixed(1)}%
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Cap rate</dt>
          <dd className="font-semibold tabular-nums">{s.capRatePct.toFixed(1)}%</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">GRM</dt>
          <dd className="font-semibold tabular-nums">{s.grm.toFixed(1)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">NOI (annual)</dt>
          <dd className="font-semibold tabular-nums">{usd(s.noi)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Cash invested</dt>
          <dd className="font-semibold tabular-nums">{usd(s.cashInvested)}</dd>
        </div>
      </dl>

      <details className="text-sm">
        <summary className="cursor-pointer text-zinc-500 dark:text-zinc-400">
          Monthly expense breakdown
        </summary>
        <table className="mt-2 w-full">
          <tbody>
            {(
              [
                ["Mortgage (P&I)", s.monthlyPI],
                ["Property taxes", s.expenses.taxes],
                ["Insurance", s.expenses.insurance],
                ["Maintenance reserve", s.expenses.maintenance],
                ["Management", s.expenses.management],
                ["Vacancy allowance", s.expenses.vacancy],
                ["Other (HOA/utilities)", s.expenses.other],
              ] as const
            ).map(([name, amt]) => (
              <tr key={name} className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="py-1 text-zinc-600 dark:text-zinc-300">{name}</td>
                <td className="py-1 text-right tabular-nums">{usd(amt)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-1">Total outflow</td>
              <td className="py-1 text-right tabular-nums">
                {usd(s.expenses.totalMonthly + s.monthlyPI)}
              </td>
            </tr>
          </tbody>
        </table>
      </details>
    </div>
  );
}

export default function Home() {
  const [address, setAddress] = useState("");
  const [price, setPrice] = useState<number | "">(100000);
  const [bedrooms, setBedrooms] = useState<number | "">(3);
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [adv, setAdv] = useState({ ...DEFAULT_ASSUMPTIONS });
  const setA = <K extends keyof typeof adv>(k: K, v: (typeof adv)[K]) =>
    setAdv((p) => ({ ...p, [k]: v }));

  // Map state — pins + assumptions persist per-user in Postgres, with
  // localStorage as offline fallback and one-time migration source
  const [savedPins, setSavedPins] = useState<SavedPin[]>([]);
  const [pinsLoaded, setPinsLoaded] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const [persistent, setPersistent] = useState(false);
  const [colorBy, setColorBy] = useState<ScenarioKey>("market");
  const [ratingFilter, setRatingFilter] = useState<Set<Rating>>(
    new Set(ALL_RATINGS)
  );
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      let pins: SavedPin[] = [];
      try {
        const res = await fetch("/api/pins");
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const json = await res.json();
        setUser(json.user ?? null);
        setPersistent(Boolean(json.persistent));
        pins = Array.isArray(json.pins) ? json.pins : [];
        if (json.assumptions) setAdv((p) => ({ ...p, ...json.assumptions }));
      } catch {
        // server unreachable — run local-only
      }
      if (pins.length === 0) {
        // migrate any pre-auth localStorage pins into the account
        try {
          const raw = localStorage.getItem(PINS_KEY);
          if (raw) {
            const local = JSON.parse(raw);
            if (Array.isArray(local)) pins = local;
          }
        } catch {
          // corrupted storage — start fresh
        }
      }
      setSavedPins(pins);
      setPinsLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!pinsLoaded) return;
    localStorage.setItem(PINS_KEY, JSON.stringify(savedPins));
    if (!persistent) return;
    const t = setTimeout(() => {
      fetch("/api/pins", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pins: savedPins, assumptions: adv }),
      }).catch(() => {
        // transient save failure — localStorage still has the data
      });
    }, 800);
    return () => clearTimeout(t);
  }, [savedPins, adv, pinsLoaded, persistent]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }

  async function analyze(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Analysis failed");
      setData(json);
      // ATTOM knows the actual bedroom count — use it so the FMR row matches
      const attomBeds = (json as AnalyzeResponse).attom?.beds;
      if (attomBeds != null) setBedrooms(attomBeds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  const scenarios = useMemo(() => {
    if (!data || price === "" || bedrooms === "") return null;
    const a: Assumptions = {
      ...adv,
      price: Number(price),
      bedrooms: Number(bedrooms),
    };
    return computeScenariosFromData(data, a);
  }, [data, price, bedrooms, adv]);

  // Auto-save/update the analyzed property as a map pin; assumption tweaks
  // live-update its snapshot.
  useEffect(() => {
    if (!data || !scenarios || (!scenarios.market && !scenarios.s8 && !scenarios.str))
      return;
    if (price === "" || bedrooms === "") return;
    const pin = buildPin(data, scenarios, Number(price), Number(bedrooms));
    setSavedPins((prev) => {
      const rest = prev.filter((p) => p.id !== pin.id);
      return [...rest, pin];
    });
    setFocusId(pin.id);
  }, [data, scenarios, price, bedrooms]);

  const visiblePins = useMemo(
    () =>
      savedPins.filter((p) => {
        const m = p[colorBy] ?? p.market ?? p.s8 ?? p.str;
        return m ? ratingFilter.has(m.rating) : true;
      }),
    [savedPins, colorBy, ratingFilter]
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Real Estate Cash Flow Analyzer</h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
            Enter an address and price — get monthly cash flow, ROI, cap rate and a
            deal rating for market-rate and Section 8 rentals. Built on free HUD,
            FEMA and Census data, upgraded with ATTOM property records when an API
            key is configured.
          </p>
        </div>
        {user && (
          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <span className="text-zinc-500 dark:text-zinc-400">
              {user}
              {!persistent && " (local only)"}
            </span>
            <button
              onClick={signOut}
              className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 text-zinc-600 dark:text-zinc-300"
            >
              Sign out
            </button>
          </div>
        )}
      </header>

      <form
        onSubmit={analyze}
        className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 flex flex-col gap-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_110px_auto] gap-3 items-end">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500 dark:text-zinc-400">Property address</span>
            <input
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, Cincinnati, OH 45202"
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5"
            />
          </label>
          <NumInput label="Purchase price" value={price} onChange={setPrice} step={1000} />
          <NumInput label="Bedrooms" value={bedrooms} onChange={setBedrooms} />
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold px-5 py-2"
          >
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((s) => !s)}
          className="self-start text-sm text-emerald-700 dark:text-emerald-400"
        >
          {showAdvanced ? "▾ Hide" : "▸ Show"} financing & expense assumptions
        </button>

        {showAdvanced && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <NumInput label="Down payment" suffix="%" value={adv.downPaymentPct} onChange={(v) => setA("downPaymentPct", v === "" ? 0 : v)} step={5} />
            <NumInput label="Interest rate" suffix="%" value={adv.interestRatePct} onChange={(v) => setA("interestRatePct", v === "" ? 0 : v)} step={0.125} />
            <NumInput label="Loan term" suffix="yrs" value={adv.loanTermYears} onChange={(v) => setA("loanTermYears", v === "" ? 30 : v)} />
            <NumInput label="Rehab budget" suffix="$" value={adv.rehabCost} onChange={(v) => setA("rehabCost", v === "" ? 0 : v)} step={1000} />
            <NumInput label="Market rent override" suffix="$/mo" placeholder="auto (FMR)" value={adv.marketRentOverride ?? ""} onChange={(v) => setA("marketRentOverride", v === "" ? null : v)} step={25} />
            <NumInput label="Payment standard" suffix="% FMR" value={adv.paymentStandardPct} onChange={(v) => setA("paymentStandardPct", v === "" ? 100 : v)} step={5} />
            <NumInput label="Tax rate override" suffix="%/yr" placeholder="auto" value={adv.taxRateOverride ?? ""} onChange={(v) => setA("taxRateOverride", v === "" ? null : v)} step={0.1} />
            <NumInput label="Insurance" suffix="%/yr" value={adv.insurancePctOfValue} onChange={(v) => setA("insurancePctOfValue", v === "" ? 0.5 : v)} step={0.1} />
            <NumInput label="Maintenance" suffix="%/yr" value={adv.maintenancePctOfValue} onChange={(v) => setA("maintenancePctOfValue", v === "" ? 1 : v)} step={0.25} />
            <NumInput label="Management" suffix="% rent" value={adv.managementPct} onChange={(v) => setA("managementPct", v === "" ? 0 : v)} />
            <NumInput label="Vacancy (market)" suffix="%" value={adv.vacancyPctMarket} onChange={(v) => setA("vacancyPctMarket", v === "" ? 5 : v)} />
            <NumInput label="Vacancy (Sec. 8)" suffix="%" value={adv.vacancyPctSection8} onChange={(v) => setA("vacancyPctSection8", v === "" ? 2 : v)} />
            <NumInput label="Other income" suffix="$/mo" value={adv.otherMonthlyIncome} onChange={(v) => setA("otherMonthlyIncome", v === "" ? 0 : v)} step={25} />
            <NumInput label="Other expenses" suffix="$/mo" value={adv.otherMonthlyExpense} onChange={(v) => setA("otherMonthlyExpense", v === "" ? 0 : v)} step={25} />
            <NumInput label="Units" value={adv.units} onChange={(v) => setA("units", v === "" ? 1 : v)} />
            <NumInput label="STR management" suffix="% rev" value={adv.strManagementPct} onChange={(v) => setA("strManagementPct", v === "" ? 20 : v)} step={5} />
            <NumInput label="STR extra costs" suffix="$/mo" value={adv.strOtherMonthlyExpense} onChange={(v) => setA("strOtherMonthlyExpense", v === "" ? 250 : v)} step={25} />
          </div>
        )}
      </form>

      <BatchImport
        assumptions={adv}
        defaultPrice={price === "" ? 100000 : Number(price)}
        defaultBedrooms={bedrooms === "" ? 3 : Number(bedrooms)}
        onPin={(pin) =>
          setSavedPins((prev) => [...prev.filter((p) => p.id !== pin.id), pin])
        }
      />

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {data && (
        <section className="flex flex-col gap-4">
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 px-4 py-3 text-sm flex flex-wrap gap-x-6 gap-y-1">
            <span className="font-semibold">{data.property.matchedAddress}</span>
            <span>
              {data.property.countyName}, {data.property.state}
            </span>
            {data.attom?.beds != null && (
              <span>
                {data.attom.beds} bd
                {data.attom.baths != null && <> / {data.attom.baths} ba</>}
                {data.attom.sqft != null && (
                  <> · {data.attom.sqft.toLocaleString()} sqft</>
                )}
                {data.attom.yearBuilt != null && <> · built {data.attom.yearBuilt}</>}
              </span>
            )}
            {data.attom?.avmValue != null && (
              <span>
                Est. value (AVM): <b>{usd(data.attom.avmValue)}</b>
                {data.attom.avmConfidence != null && (
                  <span className="text-zinc-500">
                    {" "}
                    (confidence {data.attom.avmConfidence}/100)
                  </span>
                )}
              </span>
            )}
            {data.attom?.lastSalePrice != null && (
              <span>
                Last sale: <b>{usd(data.attom.lastSalePrice)}</b>
                {data.attom.lastSaleDate && (
                  <span className="text-zinc-500">
                    {" "}
                    ({data.attom.lastSaleDate.slice(0, 4)})
                  </span>
                )}
              </span>
            )}
            {data.attom?.rentalAvm != null && (
              <span>
                Rent AVM: <b>{usd(data.attom.rentalAvm)}</b>/mo
                {scenarios?.marketRentSource === "rent AVM" && (
                  <span className="text-zinc-500"> (used for market scenario)</span>
                )}
              </span>
            )}
            {data.mashvisor?.str && (
              <span>
                Airbnb market:{" "}
                {data.mashvisor.str.occupancyPct != null && (
                  <>
                    <b>{data.mashvisor.str.occupancyPct.toFixed(0)}%</b> occupancy
                  </>
                )}
                {data.mashvisor.str.nightlyRate != null && (
                  <> · <b>{usd(data.mashvisor.str.nightlyRate)}</b>/night</>
                )}
                {data.mashvisor.str.monthlyRevenue != null && (
                  <> · <b>{usd(data.mashvisor.str.monthlyRevenue)}</b>/mo</>
                )}
                <span className="text-zinc-500"> (Mashvisor)</span>
              </span>
            )}
            {data.fmr && (
              <span>
                FY{data.fmr.year} {data.fmr.smallAreaUsed ? "Small-Area " : ""}FMR
                ({data.fmr.areaName}){scenarios?.fmrRent != null && (
                  <>: <b>{usd(scenarios.fmrRent)}</b>/mo for {bedrooms} BR</>
                )}
              </span>
            )}
            <span>
              Flood zone:{" "}
              <b className={data.flood.highRisk ? "text-red-600" : ""}>
                {data.flood.zone ?? "none mapped"}
              </b>
              {data.flood.highRisk && " (high risk — insurance increased 40%)"}
              {data.flood.moderateRisk && " (moderate risk — insurance +15%)"}
            </span>
            <span>
              Tax rate used:{" "}
              <b>{((scenarios?.taxRate ?? data.tax.effectiveRate) * 100).toFixed(2)}%</b>{" "}
              <span className="text-zinc-500">
                ({scenarios?.taxSource ?? data.tax.source})
              </span>
            </span>
          </div>

          {data.fmrError && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 text-amber-800 dark:text-amber-300 px-4 py-3 text-sm">
              HUD data unavailable: {data.fmrError} You can still analyze with a
              manual rent override under advanced assumptions.
            </div>
          )}

          {data.attomError && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 text-amber-800 dark:text-amber-300 px-4 py-3 text-sm">
              ATTOM data unavailable: {data.attomError} Falling back to HUD FMR
              rents and the statewide tax estimate.
            </div>
          )}

          {data.mashvisorError && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 text-amber-800 dark:text-amber-300 px-4 py-3 text-sm">
              Mashvisor data unavailable: {data.mashvisorError} The Airbnb
              scenario and data fidelity check are skipped.
            </div>
          )}

          {data.attom?.rentalAvm != null &&
            scenarios?.fmrRent != null &&
            Math.abs(data.attom.rentalAvm - scenarios.fmrRent) /
              scenarios.fmrRent >
              0.15 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 text-amber-800 dark:text-amber-300 px-4 py-3 text-sm">
                Rent signals diverge: ATTOM&apos;s rent AVM (
                {usd(data.attom.rentalAvm)}/mo) is{" "}
                {Math.round(
                  (Math.abs(data.attom.rentalAvm - scenarios.fmrRent) /
                    scenarios.fmrRent) *
                    100
                )}
                % {data.attom.rentalAvm > scenarios.fmrRent ? "above" : "below"}{" "}
                the HUD FMR ({usd(scenarios.fmrRent)}/mo for {bedrooms} BR).
                Verify with local comps before trusting either number.
              </div>
            )}

          <div
            className={`grid grid-cols-1 md:grid-cols-2 ${
              scenarios?.str ? "xl:grid-cols-3" : ""
            } gap-4`}
          >
            {scenarios?.market && <ScenarioCard s={scenarios.market} />}
            {scenarios?.s8 && <ScenarioCard s={scenarios.s8} />}
            {scenarios?.str && <ScenarioCard s={scenarios.str} />}
          </div>

          {(data.mashvisor != null || data.mashvisorError != null) && (
            <MashvisorCompare
              data={data}
              scenarios={scenarios}
              price={price === "" ? 0 : Number(price)}
              bedrooms={bedrooms === "" ? 3 : Number(bedrooms)}
            />
          )}

          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            Ratings (per unit): <b>Rare</b> ≥ $400/mo cash flow, ≥12% CoC, ≥8% cap ·{" "}
            <b>Fantastic</b> ≥ $250/mo, ≥10% CoC · <b>Great</b> ≥ $150/mo, ≥8% CoC ·{" "}
            <b>Good</b> &gt; $50/mo, ≥5% CoC · <b>Poor</b> otherwise (break-even is
            not a goal). A dashed <b>Almost</b> badge means the deal misses the
            next tier by a rounding error — within $50/mo cash flow, 1.5% CoC, or
            1% cap rate — and the exact shortfall is shown, since $13/mo shouldn&apos;t
            disqualify a purchase. On the map, near-miss pins wear a ring in the
            next tier&apos;s color. All figures are estimates from public data (HUD FMR, FEMA
            NFHL, Census, statewide tax averages, plus ATTOM property records
            when configured) — verify with local comps, actual tax bills and
            insurance quotes before offering. Not professional advice.
          </p>
        </section>
      )}

      {savedPins.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <h2 className="text-lg font-bold">
              Deal Map{" "}
              <span className="text-sm font-normal text-zinc-500">
                ({visiblePins.length} of {savedPins.length})
              </span>
            </h2>
            <div className="flex items-center gap-1 text-sm">
              <span className="text-zinc-500 mr-1">Color by:</span>
              {(
                [
                  ["market", "Market"],
                  ["s8", "Section 8"],
                  ["str", "Airbnb"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setColorBy(key)}
                  className={`rounded-md px-2.5 py-1 border ${
                    colorBy === key
                      ? "bg-emerald-600 border-emerald-600 text-white font-semibold"
                      : "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 text-sm">
              {ALL_RATINGS.map((r) => (
                <label key={r} className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ratingFilter.has(r)}
                    onChange={() =>
                      setRatingFilter((prev) => {
                        const next = new Set(prev);
                        if (next.has(r)) next.delete(r);
                        else next.add(r);
                        return next;
                      })
                    }
                  />
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: RATING_COLORS[r] }}
                  />
                  {r}
                </label>
              ))}
            </div>
          </div>

          <PropertyMap pins={visiblePins} colorBy={colorBy} focusId={focusId} />

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-1.5 font-medium">Property</th>
                <th className="py-1.5 font-medium text-right">Price</th>
                <th className="py-1.5 font-medium text-right">Market CF/mo</th>
                <th className="py-1.5 font-medium text-right">Sec. 8 CF/mo</th>
                <th className="py-1.5 font-medium text-right">Airbnb CF/mo</th>
                <th className="py-1.5 font-medium text-center">Rating</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {[...visiblePins]
                .sort(
                  (a, b) =>
                    ((b[colorBy] ?? b.market ?? b.s8 ?? b.str)?.monthlyCashFlow ?? 0) -
                    ((a[colorBy] ?? a.market ?? a.s8 ?? a.str)?.monthlyCashFlow ?? 0)
                )
                .map((p) => {
                  const m = p[colorBy] ?? p.market ?? p.s8 ?? p.str;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setFocusId(p.id)}
                      className="border-b border-zinc-100 dark:border-zinc-800/60 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    >
                      <td className="py-1.5">{p.address}</td>
                      <td className="py-1.5 text-right tabular-nums">{usd(p.price)}</td>
                      <td
                        className={`py-1.5 text-right tabular-nums font-semibold ${
                          (p.market?.monthlyCashFlow ?? 0) > 0
                            ? "text-emerald-600"
                            : "text-red-600"
                        }`}
                      >
                        {p.market ? usd(p.market.monthlyCashFlow) : "—"}
                      </td>
                      <td
                        className={`py-1.5 text-right tabular-nums font-semibold ${
                          (p.s8?.monthlyCashFlow ?? 0) > 0
                            ? "text-emerald-600"
                            : "text-red-600"
                        }`}
                      >
                        {p.s8 ? usd(p.s8.monthlyCashFlow) : "—"}
                      </td>
                      <td
                        className={`py-1.5 text-right tabular-nums font-semibold ${
                          (p.str?.monthlyCashFlow ?? 0) > 0
                            ? "text-emerald-600"
                            : "text-red-600"
                        }`}
                      >
                        {p.str ? usd(p.str.monthlyCashFlow) : "—"}
                      </td>
                      <td className="py-1.5 text-center">
                        {m && <RatingBadge rating={m.rating} almost={m.almost} />}
                      </td>
                      <td className="py-1.5 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSavedPins((prev) =>
                              prev.filter((x) => x.id !== p.id)
                            );
                            if (focusId === p.id) setFocusId(null);
                          }}
                          className="text-zinc-400 hover:text-red-600 px-1"
                          title="Remove from map"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
