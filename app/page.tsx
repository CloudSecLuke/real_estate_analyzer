"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  DEFAULT_ASSUMPTIONS,
  projectFiveYears,
  RATING_COLORS,
  TIERS,
} from "@/lib/metrics";
import { computeScenariosFromData, buildPin, stressTest } from "@/lib/scenarios";
import {
  bandNote,
  buildVerdict,
  DISPLAY_LABEL,
  ladderEyebrow,
  MARKET_SRC_LABEL,
  rankScenarios,
  signedUsd,
  usdWhole,
  pct1,
  type RankedScenario,
} from "@/lib/verdict";
import AssumptionsSidebar, {
  type SourceStatus,
} from "@/components/AssumptionsSidebar";
import FidelityCheck from "@/components/FidelityCheck";
import InfoTip from "@/components/InfoTip";
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
    <div className="h-[400px] w-full animate-pulse border border-input-border bg-sidebar" />
  ),
});

const ALL_RATINGS: Rating[] = ["Rare", "Fantastic", "Great", "Good", "Poor"];
const PINS_KEY = "rea_saved_pins_v1";
const SAMPLE = { address: "1418 Vine St, Cincinnati, OH 45202", price: 118000, beds: 3 };

type Phase = "empty" | "loading" | "results";

const usd = (n: number, digits = 0) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });

const cfClass = (n: number) => (n > 0 ? "text-positive" : "text-negative");

function RatingBadge({ rating, small }: { rating: Rating; small?: boolean }) {
  return (
    <span
      className={`rounded-[2px] font-semibold uppercase text-field ${
        small
          ? "px-[7px] py-[2px] text-[10px] tracking-[.06em]"
          : "px-[9px] py-[3px] text-[10.5px] tracking-[.08em]"
      }`}
      style={{ backgroundColor: RATING_COLORS[rating] }}
    >
      {rating}
    </span>
  );
}

function AlmostChip({ almost }: { almost: Rating }) {
  return (
    <span
      className="rounded-[2px] border border-dashed px-[7px] py-[2px] text-[10.5px] font-medium"
      style={{ borderColor: RATING_COLORS[almost], color: RATING_COLORS[almost] }}
    >
      Almost {almost}
    </span>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10.5px] font-semibold uppercase tracking-[.16em] text-accent">
      {children}
    </span>
  );
}

function SectionHead({
  title,
  caption,
  right,
}: {
  title: string;
  caption?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3 border-b-2 border-ink pb-2">
      <h3 className="font-serif text-[21px] font-medium">{title}</h3>
      {caption && <span className="text-[11.5px] text-label">{caption}</span>}
      {right}
    </div>
  );
}

function Metric({
  label,
  value,
  tip,
}: {
  label: string;
  value: string;
  tip: string;
}) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[.07em] text-label">
        {label}
        <InfoTip text={tip} />
      </span>
      <span className="text-[14.5px] font-medium text-ink">{value}</span>
    </div>
  );
}

function WhyRating({ s, units }: { s: ScenarioResult; units: number }) {
  const cfPerUnit = s.monthlyCashFlow / Math.max(1, units);
  const tier = TIERS.find((t) => t.rating === s.rating) ?? TIERS[TIERS.length - 1];
  const rows = [
    {
      label: `Cash flow${units > 1 ? " per unit" : ""}`,
      value: `${usdWhole(cfPerUnit)}/mo`,
      req: `${tier.cfExclusive ? ">" : "≥"} ${usdWhole(tier.cf)}/mo`,
      pass: tier.cfExclusive ? cfPerUnit > tier.cf : cfPerUnit >= tier.cf,
    },
    {
      label: "Cash-on-cash",
      value: pct1(s.cashOnCashPct),
      req: `≥ ${tier.coc}%`,
      pass: s.cashOnCashPct >= tier.coc,
    },
    ...(tier.cap !== undefined
      ? [
          {
            label: "Cap rate",
            value: pct1(s.capRatePct),
            req: `≥ ${tier.cap}%`,
            pass: s.capRatePct >= tier.cap,
          },
        ]
      : []),
  ];
  return (
    <details className="mt-2 text-[12.5px]">
      <summary className="cursor-pointer text-label">Why {s.rating}?</summary>
      <p className="mt-1 text-[11.5px] text-label">
        {s.rating === "Poor"
          ? "Fails the minimum (Good) thresholds:"
          : `Meets every ${s.rating}-tier threshold${
              s.rating !== "Rare" ? " (but not the next tier up)" : ""
            }:`}
      </p>
      <table className="mt-1 w-full">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-rule-light">
              <td className="py-1 text-[#4a423a]">{r.label}</td>
              <td className="py-1 text-right tabular-nums">{r.value}</td>
              <td className="w-20 py-1 text-right text-label">{r.req}</td>
              <td className={`w-5 py-1 text-right ${r.pass ? "text-positive" : "text-negative"}`}>
                {r.pass ? "✓" : "✗"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export default function Home() {
  const [address, setAddress] = useState("");
  const [price, setPrice] = useState<number | "">(100000);
  const [bedrooms, setBedrooms] = useState<number | "">(3);
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [phase, setPhase] = useState<Phase>("empty");
  const [loadStep, setLoadStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [autoFilled, setAutoFilled] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceStatus | null>(null);
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [adv, setAdv] = useState({ ...DEFAULT_ASSUMPTIONS });
  const setA = <K extends keyof typeof adv>(k: K, v: (typeof adv)[K]) =>
    setAdv((p) => ({ ...p, [k]: v }));

  // Map state — pins + assumptions persist per-user in Postgres, with
  // localStorage as offline fallback and one-time migration source
  const [savedPins, setSavedPins] = useState<SavedPin[]>([]);
  const [pinsLoaded, setPinsLoaded] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const [persistent, setPersistent] = useState(false);
  const [liveRate, setLiveRate] = useState<{ pct: number; asOf: string } | null>(
    null
  );
  const [colorBy, setColorBy] = useState<ScenarioKey>("market");
  const [ratingFilter, setRatingFilter] = useState<Set<Rating>>(
    new Set(ALL_RATINGS)
  );
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then(setSources)
      .catch(() => {});
  }, []);

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

      // Current 30-yr average (Freddie Mac via FRED) replaces the stale
      // hardcoded default — but never a rate the user set themselves.
      try {
        const r = await fetch("/api/rates").then((res) => res.json());
        if (r?.rate?.pct) {
          setLiveRate(r.rate);
          setAdv((p) =>
            p.interestRatePct === DEFAULT_ASSUMPTIONS.interestRatePct
              ? { ...p, interestRatePct: r.rate.pct }
              : p
          );
        }
      } catch {
        // keep the default
      }
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

  // The analyzing screen's six steps. /api/analyze is one server call that
  // fans out internally, so the timer paces the display while the fetch is
  // in flight and the response completes every step; keys that are not
  // configured render "skipped · no key" and are never counted as queried.
  const steps = useMemo(
    () => [
      { label: "Geocoding address", src: "Census", on: true },
      { label: "Fair Market Rents", src: "HUD", on: sources?.hud ?? true },
      { label: "Flood zone", src: "FEMA flood maps", on: true },
      { label: "Property record and tax bill", src: "ATTOM", on: sources?.attom ?? false },
      { label: "Short-term rental market", src: "Mashvisor", on: sources?.mashvisor ?? false },
      { label: "Underwriting three scenarios", src: "local", on: true },
    ],
    [sources]
  );

  async function analyze(addr?: string) {
    const target = (addr ?? address).trim();
    if (!target) return;
    setPhase("loading");
    setLoadStep(0);
    setError(null);
    setAutoFilled(null);
    if (stepTimer.current) clearInterval(stepTimer.current);
    stepTimer.current = setInterval(() => {
      // hold on the last real fetch step until the response lands
      setLoadStep((s) => Math.min(s + 1, 4));
    }, 450);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: target }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Analysis failed");
      const resp = json as AnalyzeResponse;
      // Auto-fill from real property data: listing (Mashvisor) wins, then
      // ATTOM's records — the user can still edit either field.
      const listing = resp.mashvisor?.listing;
      const bedsAuto = listing?.beds ?? resp.attom?.beds;
      const priceAuto = listing?.listPrice;
      if (bedsAuto != null) setBedrooms(bedsAuto);
      if (priceAuto != null) setPrice(Math.round(priceAuto));
      const vacancyAuto = resp.acsRent?.rentalVacancyPct;
      if (vacancyAuto != null) {
        setAdv((p) => ({
          ...p,
          vacancyPctMarket: Math.round(vacancyAuto * 10) / 10,
        }));
      }
      const filled = [
        priceAuto != null ? "price" : null,
        bedsAuto != null ? "bedrooms" : null,
        vacancyAuto != null
          ? `empty-months rate (county actual ${vacancyAuto}%)`
          : null,
      ].filter(Boolean);
      setAutoFilled(
        filled.length ? `${filled.join(" & ")} auto-filled — edit freely` : null
      );
      setData(resp);
      setLoadStep(6);
      setPhase("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setPhase(data ? "results" : "empty");
    } finally {
      if (stepTimer.current) {
        clearInterval(stepTimer.current);
        stepTimer.current = null;
      }
    }
  }

  function useSample() {
    setAddress(SAMPLE.address);
    setPrice(SAMPLE.price);
    setBedrooms(SAMPLE.beds);
    analyze(SAMPLE.address);
  }

  function startOver() {
    setData(null);
    setError(null);
    setAutoFilled(null);
    setPhase("empty");
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

  const assumptionsFull = useMemo<Assumptions | null>(() => {
    if (price === "" || bedrooms === "") return null;
    return { ...adv, price: Number(price), bedrooms: Number(bedrooms) };
  }, [adv, price, bedrooms]);

  const ranked = useMemo<RankedScenario[]>(
    () => (scenarios ? rankScenarios(scenarios) : []),
    [scenarios]
  );

  const verdict = useMemo(() => {
    if (!scenarios || !assumptionsFull || ranked.length === 0) return null;
    return buildVerdict(scenarios, assumptionsFull, {
      occupancyPct: data?.mashvisor?.str?.occupancyPct,
      revenue: scenarios.str?.monthlyRent,
    });
  }, [scenarios, assumptionsFull, ranked, data]);

  const outlook = useMemo(() => {
    if (!data || !scenarios || !assumptionsFull) return null;
    return {
      stress: stressTest(data, assumptionsFull, scenarios),
      projection: scenarios.market
        ? projectFiveYears(scenarios.market, assumptionsFull)
        : null,
    };
  }, [data, scenarios, assumptionsFull]);

  // "312 WALNUT ST, CINCINNATI, OH, 45202" → "Cincinnati" for PHA guidance
  const cityLabel = useMemo(() => {
    const city = data?.property.matchedAddress.split(",")[1]?.trim() ?? "";
    return city
      ? city.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
      : null;
  }, [data]);

  // Auto-save/update the analyzed property as a map pin; assumption tweaks
  // live-update its snapshot.
  useEffect(() => {
    if (!data || !scenarios) return;
    if (!scenarios.market && !scenarios.s8 && !scenarios.str) return;
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

  const dealDate = useMemo(
    () =>
      new Date().toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    []
  );

  const cashIn = ranked[0]?.s.cashInvested ?? null;
  const beds = data?.mashvisor?.listing?.beds ?? data?.attom?.beds ?? bedrooms;
  const baths = data?.mashvisor?.listing?.baths ?? data?.attom?.baths;
  const sqft = data?.mashvisor?.listing?.sqft ?? data?.attom?.sqft;
  const yearBuilt =
    data?.mashvisor?.listing?.yearBuilt ?? data?.attom?.yearBuilt;

  const subhead = data
    ? [
        `${data.property.countyName}, ${data.property.state}`,
        beds !== "" && beds != null
          ? `${beds} bed${baths != null ? ` / ${baths} bath` : ""}`
          : null,
        sqft != null ? `${sqft.toLocaleString()} sqft` : null,
        yearBuilt != null ? `built ${yearBuilt}` : null,
        price !== "" ? `asking ${usd(Number(price))}` : null,
        cashIn != null ? `${usd(cashIn)} cash in` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const divergePct =
    data?.attom?.rentalAvm != null && scenarios?.fmrRent != null
      ? (Math.abs(data.attom.rentalAvm - scenarios.fmrRent) /
          scenarios.fmrRent) *
        100
      : null;

  const hudMissing = Boolean(data && !data.fmr);
  const mvMissing = Boolean(data && !data.mashvisor?.str);

  return (
    <div className="grid min-h-screen grid-cols-[300px_minmax(0,1fr)] items-start max-lg:grid-cols-1">
      <AssumptionsSidebar
        address={address}
        onAddress={setAddress}
        price={price}
        onPrice={setPrice}
        bedrooms={bedrooms}
        onBedrooms={setBedrooms}
        adv={adv}
        setA={setA}
        onReset={() =>
          setAdv((p) => ({
            ...DEFAULT_ASSUMPTIONS,
            interestRatePct: liveRate?.pct ?? DEFAULT_ASSUMPTIONS.interestRatePct,
          }))
        }
        onAnalyze={() => analyze()}
        analyzing={phase === "loading"}
        sources={sources}
        liveRate={liveRate}
        user={user}
        persistent={persistent}
        onSignOut={signOut}
        batchAssumptions={adv}
        batchDefaultPrice={price === "" ? 100000 : Number(price)}
        batchDefaultBedrooms={bedrooms === "" ? 3 : Number(bedrooms)}
        onPin={(pin) =>
          setSavedPins((prev) => [...prev.filter((p) => p.id !== pin.id), pin])
        }
      />

      <main className="flex max-w-[1120px] flex-col gap-9 px-12 pb-[70px] pt-10 max-md:px-5">
        {error && (
          <div className="border-l-[3px] border-negative bg-accent-tint py-[14px] pl-4">
            <span className="text-[13px] font-semibold text-warn-ink">
              {error}
            </span>
          </div>
        )}

        {phase === "empty" && (
          <section className="flex flex-col gap-[34px]">
            <div className="flex flex-col gap-[14px] border-b-2 border-ink pb-[22px]">
              <Eyebrow>Start here</Eyebrow>
              <h2 className="max-w-[26ch] font-serif text-[40px] font-medium leading-[1.12] tracking-[-.02em] [text-wrap:pretty]">
                Underwrite one house three ways, then decide.
              </h2>
              <p className="max-w-[62ch] font-serif text-[17px] leading-[1.6] text-prose [text-wrap:pretty]">
                Enter an address and a price. The analyzer pulls the county, the
                HUD Fair Market Rent, the FEMA flood zone and the tax rate, then
                reports monthly cash flow after debt service for market rent,
                Section 8 and short-term rental — plus which of the three you
                should actually run.
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <button
                  onClick={useSample}
                  className="cursor-pointer rounded-[2px] bg-accent px-5 py-[11px] text-[13px] font-semibold text-field hover:bg-accent-hover"
                >
                  Try the sample deal
                </button>
                <span className="text-[13px] text-body">
                  1418 Vine St, Cincinnati — $118,000, 3 bed
                </span>
              </div>
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-x-11 gap-y-[34px]">
              <div className="flex flex-col">
                <h3 className="mb-1 border-b-2 border-ink pb-2 font-serif text-[21px] font-medium">
                  What you get back
                </h3>
                {[
                  [
                    "A recommendation, not a dashboard",
                    "Which of the three strategies wins, by how much, and what it costs you in certainty.",
                  ],
                  [
                    "Monthly cash flow after the mortgage",
                    "The headline number, with cash-on-cash, cap rate, GRM and NOI behind it.",
                  ],
                  [
                    "Every line item, side by side",
                    "Where the rent goes in each scenario, so a surprise is a number you can point at.",
                  ],
                  [
                    "A pin on the deal map",
                    "Every address you analyze is saved and colored by rating, so the pattern shows up.",
                  ],
                ].map(([title, body], i, arr) => (
                  <div
                    key={title}
                    className={`flex gap-[14px] py-[14px] ${
                      i < arr.length - 1 ? "border-b border-rule" : ""
                    }`}
                  >
                    <span className="w-[22px] font-serif text-[19px] leading-[1.2] text-accent">
                      {i + 1}
                    </span>
                    <div className="flex flex-col gap-[3px]">
                      <span className="text-[13.5px] font-medium">{title}</span>
                      <span className="text-[12.5px] leading-[1.55] text-body">
                        {body}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-col">
                <h3 className="mb-1 border-b-2 border-ink pb-2 font-serif text-[21px] font-medium">
                  How deals are rated
                </h3>
                {(
                  [
                    ["Rare", "≥ $400/mo cash flow · ≥ 12% cash-on-cash · ≥ 8% cap rate"],
                    ["Fantastic", "≥ $250/mo cash flow · ≥ 10% cash-on-cash"],
                    ["Great", "≥ $150/mo cash flow · ≥ 8% cash-on-cash"],
                    ["Good", "> $50/mo cash flow · ≥ 5% cash-on-cash"],
                    ["Poor", "Anything else, break-even included"],
                  ] as [Rating, string][]
                ).map(([rating, req]) => (
                  <div
                    key={rating}
                    className="flex items-center justify-between gap-3 border-b border-rule py-[11px]"
                  >
                    <RatingBadge rating={rating} />
                    <span className="text-right text-[12.5px] text-[#4a423a]">
                      {req}
                    </span>
                  </div>
                ))}
                <p className="mt-[14px] font-serif text-[14px] leading-[1.6] text-[#4a423a]">
                  Thresholds are per unit. A deal that misses the next tier by
                  less than $50/mo, 1.5 points of cash-on-cash or 1 point of cap
                  rate is flagged <i>Almost</i> with the exact shortfall — $13 a
                  month should not decide a purchase.
                </p>
              </div>
            </div>
          </section>
        )}

        {phase === "loading" && (
          <section className="flex flex-col gap-[26px]">
            <header className="flex flex-col gap-[10px] border-b-2 border-ink pb-[18px]">
              <Eyebrow>Underwriting</Eyebrow>
              <h2 className="font-serif text-[32px] font-medium leading-[1.15] tracking-[-.02em]">
                {address || SAMPLE.address}
              </h2>
            </header>
            <div className="flex max-w-[560px] flex-col">
              {steps.map((s, i) => {
                const done = loadStep > i;
                const active = loadStep === i;
                return (
                  <div
                    key={s.label}
                    className="flex items-center gap-3 border-b border-rule py-[11px]"
                  >
                    <span
                      className={`h-4 w-4 shrink-0 rounded-full border ${
                        active ? "animate-step-pulse" : ""
                      }`}
                      style={{
                        borderColor: !s.on
                          ? "#d9cfbe"
                          : done
                            ? "#2f6b4f"
                            : active
                              ? "#96552a"
                              : "#d9cfbe",
                        background: !s.on
                          ? "transparent"
                          : done
                            ? "#2f6b4f"
                            : active
                              ? "#96552a"
                              : "transparent",
                      }}
                    />
                    <span
                      className="text-[13.5px]"
                      style={{
                        color: !s.on ? "#7a7165" : done || active ? "#1d1a16" : "#7a7165",
                      }}
                    >
                      {s.label}
                    </span>
                    <span className="ml-auto text-[12px] text-label">
                      {!s.on
                        ? "skipped · no key"
                        : done
                          ? `${s.src} ✓`
                          : active
                            ? `querying ${s.src}…`
                            : s.src}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex max-w-[560px] flex-col gap-3">
              <div className="h-3 w-[70%] rounded-[1px] bg-skeleton" />
              <div className="h-3 w-[92%] rounded-[1px] bg-skeleton" />
              <div className="h-3 w-[54%] rounded-[1px] bg-skeleton" />
            </div>
          </section>
        )}

        {phase === "results" && data && (
          <section className="flex flex-col gap-9">
            <header className="flex flex-col gap-3 border-b-2 border-ink pb-[18px]">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <Eyebrow>Deal brief · {dealDate}</Eyebrow>
                <div className="flex gap-4 text-[12px]">
                  <button
                    onClick={() => window.print()}
                    className="cursor-pointer border-b border-accent/30 text-accent hover:text-link-hover"
                  >
                    Export PDF
                  </button>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(window.location.href).catch(() => {});
                    }}
                    className="cursor-pointer border-b border-accent/30 text-accent hover:text-link-hover"
                  >
                    Share with partner
                  </button>
                  <button
                    onClick={startOver}
                    className="cursor-pointer border-b border-accent/30 text-accent hover:text-link-hover"
                  >
                    Start over
                  </button>
                </div>
              </div>
              <h2 className="font-serif text-[38px] font-medium leading-[1.1] tracking-[-.02em]">
                {data.property.matchedAddress}
              </h2>
              <div className="text-[13px] text-body">{subhead}</div>
              {autoFilled && (
                <div className="text-[12px] text-positive">✓ {autoFilled}</div>
              )}
            </header>

            {hudMissing && (
              <div className="border-l-[3px] border-warn bg-accent-tint py-[14px] pl-4">
                <div className="flex flex-col gap-[5px]">
                  <span className="text-[13px] font-semibold text-warn-ink">
                    No HUD data — the Section 8 scenario is unavailable.
                  </span>
                  <p className="m-0 max-w-[76ch] font-serif text-[14px] leading-[1.6] text-warn-ink">
                    {data.attom?.rentalAvm != null
                      ? "Section 8 rent is FMR × payment standard, so that scenario stays dark until a free token from huduser.gov is in place. Market rent is unaffected — it falls back to ATTOM's rental AVM, which is property-specific rather than a county-wide 40th percentile."
                      : "Section 8 rent is FMR × payment standard, and with no ATTOM key either there is no market-rent baseline to fall back on. Register a free HUD token at huduser.gov, or enter a real comp in Market rent override to underwrite the market case by hand."}
                    {data.fmrError && (
                      <span className="text-[12px]"> ({data.fmrError})</span>
                    )}
                  </p>
                </div>
              </div>
            )}

            {mvMissing && (
              <div className="border-l-[3px] border-label bg-sidebar py-[14px] pl-4">
                <div className="flex flex-col gap-[5px]">
                  <span className="text-[13px] font-semibold text-[#4a423a]">
                    {data.mashvisorError
                      ? "Mashvisor unavailable — the short-term rental scenario is skipped."
                      : "No Mashvisor key — the short-term rental scenario is skipped."}
                  </span>
                  <p className="m-0 max-w-[76ch] font-serif text-[14px] leading-[1.6] text-[#4a423a]">
                    Occupancy and nightly rate come from Mashvisor; without them
                    there is no honest STR number to show. The two long-term
                    scenarios below are unaffected, and the fidelity check falls
                    back to ATTOM alone.
                    {data.mashvisorError && (
                      <span className="text-[12px]"> ({data.mashvisorError})</span>
                    )}
                  </p>
                </div>
              </div>
            )}

            {data.attomError && (
              <div className="border-l-[3px] border-label bg-sidebar py-[14px] pl-4">
                <div className="flex flex-col gap-[5px]">
                  <span className="text-[13px] font-semibold text-[#4a423a]">
                    ATTOM unavailable — property record, tax bill and rent
                    estimate fall back to free sources.
                  </span>
                  <p className="m-0 max-w-[76ch] font-serif text-[14px] leading-[1.6] text-[#4a423a]">
                    The tax line uses the county median instead of this parcel&apos;s
                    actual bill, and the market rent leans on HUD and Census
                    data. <span className="text-[12px]">({data.attomError})</span>
                  </p>
                </div>
              </div>
            )}

            {verdict && ranked.length > 0 && (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-start gap-x-11 gap-y-[30px]">
                <div className="flex flex-col gap-[14px]">
                  <Eyebrow>The call</Eyebrow>
                  <h3 className="font-serif text-[31px] font-medium leading-[1.22] tracking-[-.015em] [text-wrap:pretty]">
                    {verdict.headline}
                  </h3>
                  <p className="max-w-[60ch] font-serif text-[16.5px] leading-[1.62] text-prose [text-wrap:pretty]">
                    {verdict.p1}
                  </p>
                  <p className="max-w-[60ch] font-serif text-[16.5px] leading-[1.62] text-prose [text-wrap:pretty]">
                    {verdict.p2}
                  </p>
                </div>

                <div className="flex flex-col border-t-2 border-ink">
                  {ranked.map((r, i) => {
                    const maxAbs = Math.max(
                      1,
                      ...ranked.map((x) => Math.abs(x.s.monthlyCashFlow))
                    );
                    const width = Math.max(
                      3,
                      (Math.abs(r.s.monthlyCashFlow) / maxAbs) * 100
                    );
                    return (
                      <div
                        key={r.key}
                        className="flex flex-col gap-[6px] border-b border-rule py-[14px]"
                      >
                        <div className="flex items-baseline justify-between gap-[10px]">
                          <span className="text-[10.5px] font-semibold uppercase tracking-[.12em] text-label">
                            {ladderEyebrow(ranked, i)}
                          </span>
                          <RatingBadge rating={r.s.rating} small />
                        </div>
                        <span
                          className={`font-serif text-[38px] font-medium leading-none tracking-[-.02em] ${cfClass(r.s.monthlyCashFlow)}`}
                        >
                          {signedUsd(r.s.monthlyCashFlow)}/mo
                        </span>
                        <div className="h-[6px] overflow-hidden rounded-[1px] bg-bar-track">
                          <span
                            className="block h-full"
                            style={{
                              width: `${width.toFixed(1)}%`,
                              background: RATING_COLORS[r.s.rating],
                            }}
                          />
                        </div>
                        <span className="text-[12.5px] text-body">
                          {pct1(r.s.cashOnCashPct)} cash-on-cash return ·{" "}
                          {pct1(r.s.capRatePct)} cap rate
                          {r.s.ratingDetail.almost
                            ? ` · almost ${r.s.ratingDetail.almost}`
                            : ""}
                        </span>
                      </div>
                    );
                  })}
                  <div className="flex justify-between gap-3 py-[14px]">
                    <span className="text-[12.5px] text-body">
                      Spread, best to worst
                    </span>
                    <span className="text-[13px] font-semibold">
                      {ranked.length > 1
                        ? `${usdWhole(
                            ranked[0].s.monthlyCashFlow -
                              ranked[ranked.length - 1].s.monthlyCashFlow
                          )}/mo`
                        : "—"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {data.marketHealth && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 border-y border-rule py-3 text-[13px]">
                <span className="font-semibold">
                  Market health ({data.marketHealth.countyName})
                  <InfoTip text="County trajectory: 5-year change from Census ACS plus BLS unemployment. Shrinking population is the classic risk hiding behind cheap, high-cash-flow markets — rents and values erode and vacancies stretch." />
                </span>
                {data.marketHealth.populationChangePct5yr != null && (
                  <span
                    className={
                      data.marketHealth.populationChangePct5yr < 0
                        ? "text-negative"
                        : ""
                    }
                  >
                    Population{" "}
                    <b>
                      {data.marketHealth.populationChangePct5yr >= 0 ? "+" : ""}
                      {data.marketHealth.populationChangePct5yr.toFixed(1)}%
                    </b>{" "}
                    (5 yr
                    {data.marketHealth.population != null &&
                      `, now ${data.marketHealth.population.toLocaleString()}`}
                    )
                  </span>
                )}
                {data.marketHealth.valueChangePct5yr != null && (
                  <span>
                    Median value{" "}
                    <b>
                      {data.marketHealth.valueChangePct5yr >= 0 ? "+" : ""}
                      {data.marketHealth.valueChangePct5yr.toFixed(0)}%
                    </b>{" "}
                    (5 yr
                    {data.marketHealth.medianValue != null &&
                      `, now ${usd(data.marketHealth.medianValue)}`}
                    )
                  </span>
                )}
                {data.marketHealth.unemploymentPct != null && (
                  <span
                    className={
                      data.marketHealth.unemploymentPct >= 7 ? "text-negative" : ""
                    }
                  >
                    Unemployment{" "}
                    <b>{data.marketHealth.unemploymentPct.toFixed(1)}%</b>
                    {data.marketHealth.unemploymentAsOf && (
                      <span className="text-label">
                        {" "}
                        ({data.marketHealth.unemploymentAsOf})
                      </span>
                    )}
                  </span>
                )}
              </div>
            )}

            <section className="flex flex-col">
              <SectionHead
                title="The scenarios"
                caption="Monthly, after mortgage, taxes, insurance, reserves, management and vacancy"
              />
              {ranked.length === 0 && (
                <p className="max-w-[62ch] py-[18px] font-serif text-[16px] leading-[1.6] text-body">
                  No scenario can be computed without a rent source. Configure a
                  data source in the sidebar, or enter a real market rent under{" "}
                  <b className="font-semibold">Market rent override</b> to
                  underwrite the long-term case by hand.
                </p>
              )}
              {ranked.map((r) => {
                const s = r.s;
                const a = assumptionsFull!;
                const outflow = s.expenses.totalMonthly + s.monthlyPI;
                const t = outflow || 1;
                const insMaint = s.expenses.insurance + s.expenses.maintenance;
                const vacOrUtil =
                  r.key === "str" ? s.expenses.other : s.expenses.vacancy;
                const sub =
                  r.key === "market"
                    ? `${usdWhole(s.monthlyRent)}/mo rent · ${
                        (scenarios!.marketRentSource &&
                          MARKET_SRC_LABEL[scenarios!.marketRentSource]) ||
                        "modelled"
                      }`
                    : r.key === "s8"
                      ? `${usdWhole(s.monthlyRent)}/mo rent · Fair Market Rent × ${a.paymentStandardPct}%`
                      : `${usdWhole(s.monthlyRent)}/mo revenue${
                          data.mashvisor?.str?.occupancyPct != null
                            ? ` · ${Math.round(data.mashvisor.str.occupancyPct)}% occ`
                            : ""
                        }${
                          data.mashvisor?.str?.nightlyRate != null
                            ? ` · ${usdWhole(data.mashvisor.str.nightlyRate)}/night`
                            : ""
                        }`;
                const s8AboveMarket =
                  r.key === "s8" &&
                  scenarios?.market != null &&
                  s.monthlyRent > scenarios.market.monthlyRent * 1.05;
                return (
                  <article
                    key={r.key}
                    className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-x-7 gap-y-5 border-b border-rule py-5"
                  >
                    <div className="flex flex-col gap-[5px]">
                      <h4 className="font-serif text-[19px] font-medium">
                        {DISPLAY_LABEL[r.key]}
                      </h4>
                      <span className="text-[12px] text-label">{sub}</span>
                      <span className="mt-[3px] flex items-center gap-[5px]">
                        <RatingBadge rating={s.rating} />
                        {s.ratingDetail.almost && (
                          <AlmostChip almost={s.ratingDetail.almost} />
                        )}
                      </span>
                      <WhyRating s={s} units={a.units} />
                    </div>
                    <div className="flex flex-col gap-[14px]">
                      <div className="flex flex-col gap-[3px]">
                        <span className="text-[10.5px] font-semibold uppercase tracking-[.1em] text-label">
                          Monthly cash flow, after the mortgage
                        </span>
                        <span
                          className={`font-serif text-[33px] font-medium leading-none ${cfClass(s.monthlyCashFlow)}`}
                        >
                          {signedUsd(s.monthlyCashFlow)}/mo
                        </span>
                      </div>
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(100px,1fr))] gap-x-4 gap-y-3">
                        <Metric
                          label={r.key === "str" ? "Monthly revenue" : "Monthly rent"}
                          value={`${usdWhole(s.monthlyRent)}/mo`}
                          tip={
                            r.key === "str"
                              ? "Nightly rate multiplied by nights booked, already adjusted for the area's typical occupancy — not a full-occupancy fantasy."
                              : "What the tenant pays each month, before any expense comes out of it."
                          }
                        />
                        <Metric
                          label="Cash-on-cash return"
                          value={pct1(s.cashOnCashPct)}
                          tip="A year of cash flow divided by the cash you actually put in — down payment, closing costs and rehab. Answers: what does this deal pay on my money?"
                        />
                        <Metric
                          label="Cap rate"
                          value={pct1(s.capRatePct)}
                          tip="Capitalization rate: a year of income after operating expenses, divided by the purchase price. It ignores the mortgage, so it compares houses rather than loans."
                        />
                        <Metric
                          label="Gross rent multiple"
                          value={s.grm.toFixed(1)}
                          tip="Purchase price divided by one year of rent. Lower is cheaper: 4 means a year's rent covers a quarter of the price, before any expenses."
                        />
                        <Metric
                          label="Net income, yearly"
                          value={usdWhole(s.noi)}
                          tip="Net operating income: a year of rent minus operating expenses — taxes, insurance, reserves, management, vacancy — but before any mortgage payment."
                        />
                        <Metric
                          label="Cash invested"
                          value={usdWhole(s.cashInvested)}
                          tip="Down payment plus closing costs plus rehab budget — the money that actually leaves your account to buy the house."
                        />
                      </div>
                      <div className="flex flex-col gap-[5px]">
                        <div className="flex h-2 overflow-hidden rounded-[1px] bg-bar-track">
                          <span style={{ width: `${((s.monthlyPI / t) * 100).toFixed(1)}%`, background: "#96552a" }} />
                          <span style={{ width: `${((s.expenses.taxes / t) * 100).toFixed(1)}%`, background: "#b4794c" }} />
                          <span style={{ width: `${((insMaint / t) * 100).toFixed(1)}%`, background: "#c9a077" }} />
                          <span style={{ width: `${((s.expenses.management / t) * 100).toFixed(1)}%`, background: "#6b6257" }} />
                          <span style={{ width: `${(((s.expenses.vacancy + s.expenses.other) / t) * 100).toFixed(1)}%`, background: "#b9b0a2" }} />
                        </div>
                        <span className="text-[11.5px] text-label">
                          {usdWhole(outflow)} leaves each month: mortgage{" "}
                          {usdWhole(s.monthlyPI)} · property tax{" "}
                          {usdWhole(s.expenses.taxes)} · insurance and repair
                          reserve {usdWhole(insMaint)} · management{" "}
                          {usdWhole(s.expenses.management)} ·{" "}
                          {r.key === "str"
                            ? `utilities and supplies ${usdWhole(vacOrUtil)}`
                            : `empty-months allowance ${usdWhole(vacOrUtil)}`}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <p className="m-0 font-serif text-[14px] leading-[1.6] text-[#4a423a]">
                        {bandNote(r.key, scenarios!, a, {
                          occupancyPct: data.mashvisor?.str?.occupancyPct,
                          revenue: scenarios!.str?.monthlyRent,
                        })}
                      </p>
                      {r.key === "market" &&
                        scenarios!.marketRentSource === "FMR" && (
                          <p className="m-0 text-[11.5px] leading-[1.6] text-label">
                            Rent here is the area-wide HUD Fair Market Rent, not
                            an estimate for this specific property. In cheaper
                            submarkets actual rent often runs well below it —
                            verify with local comps.
                          </p>
                        )}
                      {r.key === "market" &&
                        scenarios!.marketRentSource === "local ACS median" && (
                          <p className="m-0 text-[11.5px] leading-[1.6] text-label">
                            Rent here uses the county&apos;s median rent for this
                            bedroom count (Census ACS, inflated to current)
                            because the HUD Fair Market Rent for this area runs
                            above what local units actually rent for. This is
                            the conservative estimate; verify with local comps.
                          </p>
                        )}
                      {s8AboveMarket && (
                        <p className="m-0 border-l-[3px] border-warn bg-accent-tint py-2 pl-3 font-serif text-[13px] leading-[1.6] text-warn-ink">
                          <b className="font-semibold">
                            Heads up: this assumes {usdWhole(s.monthlyRent)}/mo —
                            above the estimated market rent of{" "}
                            {usdWhole(scenarios!.market!.monthlyRent)}/mo.
                          </b>{" "}
                          Housing authorities run a &ldquo;rent
                          reasonableness&rdquo; check and won&apos;t approve rent
                          above comparable unassisted units. Call{" "}
                          {cityLabel
                            ? `the ${cityLabel} housing authority`
                            : "the local housing authority"}{" "}
                          to ask what they&apos;d approve for this specific unit
                          (
                          <a
                            href="https://www.hud.gov/program_offices/public_indian_housing/pha/contacts"
                            target="_blank"
                            rel="noreferrer"
                            className="border-b border-warn/40"
                          >
                            HUD PHA directory
                          </a>
                          ), or lower the payment standard % for the
                          conservative case.
                        </p>
                      )}
                      {r.key === "s8" && (
                        <details className="text-[12.5px]">
                          <summary className="cursor-pointer text-label">
                            How the Section 8 numbers work
                          </summary>
                          <div className="mt-2 flex flex-col gap-2 text-[12px] leading-[1.6] text-[#4a423a]">
                            <p>
                              HUD publishes a <b>Fair Market Rent (FMR)</b> for
                              every area — the 40th-percentile gross rent, i.e.
                              what the cheaper 40% of decent units rent for
                              (ZIP-level &ldquo;Small Area&rdquo; FMR where
                              available). The local housing authority (PHA) sets
                              a <b>payment standard</b> between 90% and 120% of
                              FMR — this card assumes{" "}
                              <b>{a.paymentStandardPct}%</b>. The voucher covers
                              the gap between the tenant&apos;s ~30% income
                              contribution and the approved rent, paid directly
                              to you.
                            </p>
                            <p>
                              Vacancy defaults to 2% (vs 5% market) because the
                              voucher portion keeps paying while a tenant stays,
                              and demand for voucher-ready units is deep.
                              Offsets: annual PHA inspections, and initial
                              lease-up takes longer.
                            </p>
                            <p>
                              <b>The number to verify:</b> the PHA won&apos;t
                              approve rent above comparable unassisted units
                              nearby (&ldquo;rent reasonableness&rdquo;). In
                              soft markets FMR can sit far above real market
                              rent, making this card look better than what the
                              PHA will actually approve. Call{" "}
                              {cityLabel
                                ? `the ${cityLabel} housing authority`
                                : "the local housing authority"}{" "}
                              with this specific unit before relying on FMR ×
                              payment standard —{" "}
                              <a
                                href="https://www.hud.gov/program_offices/public_indian_housing/pha/contacts"
                                target="_blank"
                                rel="noreferrer"
                                className="border-b border-accent/30 text-accent"
                              >
                                find their contact in HUD&apos;s PHA directory
                              </a>
                              .
                            </p>
                          </div>
                        </details>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>

            {ranked.length > 0 && (
              <section className="flex flex-col">
                <SectionHead title="Line by line" caption="Monthly unless noted" />
                <div className="grid grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
                  <span className="border-b border-rule py-[10px]" />
                  {(["Market rent", "Section 8", "Short-term"] as const).map(
                    (h, i) => (
                      <span
                        key={h}
                        className={`border-b border-rule py-[10px] text-right text-[12.5px] font-medium ${i === 2 ? "pl-3" : "px-3"}`}
                      >
                        {h}
                      </span>
                    )
                  )}
                  {(() => {
                    const a = assumptionsFull!;
                    const cols: (ScenarioResult | null)[] = [
                      scenarios!.market,
                      scenarios!.s8,
                      scenarios!.str,
                    ];
                    const cells = (
                      fn: (s: ScenarioResult, isStr: boolean) => React.ReactNode,
                      opts?: { emphasis?: boolean; last?: boolean }
                    ) =>
                      cols.map((s, i) => (
                        <span
                          key={i}
                          className={`py-[9px] text-right text-[13px] ${
                            i === 2 ? "pl-3" : "px-3"
                          } ${
                            opts?.emphasis
                              ? "border-b border-ink py-3 text-[15px] font-semibold"
                              : opts?.last
                                ? ""
                                : "border-b border-rule-light"
                          }`}
                        >
                          {s ? fn(s, i === 2) : <span className="text-label">—</span>}
                        </span>
                      ));
                    const label = (
                      text: string,
                      opts?: { title?: string; emphasis?: boolean; last?: boolean }
                    ) => (
                      <span
                        title={opts?.title}
                        className={`py-[9px] text-[13px] text-[#4a423a] ${
                          opts?.title ? "cursor-help" : ""
                        } ${
                          opts?.emphasis
                            ? "border-b border-ink py-3 text-[13.5px] font-semibold text-ink"
                            : opts?.last
                              ? ""
                              : "border-b border-rule-light"
                        }`}
                      >
                        {text}
                      </span>
                    );
                    return (
                      <>
                        {label("Gross income")}
                        {cells((s) => usdWhole(s.monthlyRent + a.otherMonthlyIncome))}
                        {label("Mortgage (principal + interest)", {
                          title:
                            "Principal and interest on the loan. Taxes and insurance are listed separately below, not escrowed into this figure.",
                        })}
                        {cells((s) => usdWhole(s.monthlyPI))}
                        {label("Taxes, insurance, reserves")}
                        {cells((s) =>
                          usdWhole(
                            s.expenses.taxes +
                              s.expenses.insurance +
                              s.expenses.maintenance
                          )
                        )}
                        {label("Management")}
                        {cells((s) => usdWhole(s.expenses.management))}
                        {label("Empty-months allowance", {
                          title:
                            "Money set aside for the months between tenants, taken as a percentage of rent.",
                        })}
                        {cells((s, isStr) =>
                          isStr ? (
                            <span className="text-label">already in revenue</span>
                          ) : (
                            usdWhole(s.expenses.vacancy)
                          )
                        )}
                        {label("Utilities & supplies")}
                        {cells((s, isStr) =>
                          isStr ? (
                            usdWhole(s.expenses.other)
                          ) : s.expenses.other > 0 ? (
                            usdWhole(s.expenses.other)
                          ) : (
                            <span className="text-label">tenant pays</span>
                          )
                        )}
                        <span className="border-y border-ink py-3 text-[13.5px] font-semibold">
                          Cash flow after the mortgage
                        </span>
                        {cols.map((s, i) => (
                          <span
                            key={i}
                            className={`border-y border-ink py-3 text-right text-[15px] font-semibold ${
                              i === 2 ? "pl-3" : "px-3"
                            } ${s ? cfClass(s.monthlyCashFlow) : "text-label"}`}
                          >
                            {s ? signedUsd(s.monthlyCashFlow) : "—"}
                          </span>
                        ))}
                        {label("Cash-on-cash return", {
                          title:
                            "A year of cash flow divided by the cash you put in — down payment, closing costs and rehab.",
                        })}
                        {cells((s) => pct1(s.cashOnCashPct))}
                        {label("Cap rate", {
                          title:
                            "Capitalization rate: yearly income after operating expenses, divided by the purchase price. Ignores the mortgage.",
                        })}
                        {cells((s) => pct1(s.capRatePct))}
                        {label("Net income, yearly", {
                          title:
                            "Net operating income: a year of rent minus operating expenses, before any mortgage payment.",
                        })}
                        {cells((s) => usdWhole(s.noi))}
                        {label("Gross rent multiple", {
                          title:
                            "Gross rent multiple: purchase price divided by one year of rent. Lower is cheaper.",
                          last: true,
                        })}
                        {cells((s) => s.grm.toFixed(1), { last: true })}
                      </>
                    );
                  })()}
                </div>
              </section>
            )}

            {outlook && (outlook.stress || outlook.projection) && (
              <section className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-x-11 gap-y-[34px]">
                {outlook.stress && (
                  <div className="flex flex-col">
                    <SectionHead
                      title="Stress test"
                      caption="Market scenario"
                    />
                    <div className="flex flex-col">
                      {outlook.stress.map((row) => (
                        <div
                          key={row.label}
                          className="flex items-baseline justify-between gap-3 border-b border-rule py-[9px]"
                        >
                          <span className="text-[13px] text-[#4a423a]">
                            {row.label}
                          </span>
                          <span
                            className={`text-[13px] font-semibold tabular-nums ${cfClass(row.monthlyCashFlow)}`}
                          >
                            {signedUsd(row.monthlyCashFlow)}/mo
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 font-serif text-[13px] leading-[1.6] text-[#4a423a]">
                      Rent −10%, empty months +5 points, rate +1 point — each
                      alone, then combined. A deal that only works when every
                      estimate is exactly right isn&apos;t a deal.
                    </p>
                  </div>
                )}
                {outlook.projection && assumptionsFull && (
                  <div className="flex flex-col">
                    <SectionHead
                      title="5-year hold"
                      caption="Market scenario, rents held flat"
                    />
                    <div className="flex flex-col">
                      {(
                        [
                          [
                            `Est. value in 5 yrs (${assumptionsFull.appreciationPctAnnual}%/yr)`,
                            usdWhole(outlook.projection.futureValue),
                          ],
                          ["Loan balance then", usdWhole(outlook.projection.loanBalance)],
                          [
                            "Principal paid down by tenant",
                            usdWhole(outlook.projection.equityPaydown),
                          ],
                          [
                            "Cumulative cash flow (60 mo)",
                            usdWhole(outlook.projection.cumulativeCashFlow),
                          ],
                          [
                            `Net if sold (${assumptionsFull.sellingCostPct}% selling costs)`,
                            usdWhole(outlook.projection.netIfSold),
                          ],
                          [
                            "Total profit vs cash in",
                            usdWhole(outlook.projection.totalProfit),
                          ],
                        ] as const
                      ).map(([labelText, value]) => (
                        <div
                          key={labelText}
                          className="flex items-baseline justify-between gap-3 border-b border-rule py-[9px]"
                        >
                          <span className="text-[13px] text-[#4a423a]">
                            {labelText}
                          </span>
                          <span className="text-[13px] tabular-nums">{value}</span>
                        </div>
                      ))}
                      <div className="flex items-baseline justify-between gap-3 py-[9px]">
                        <span className="flex items-center text-[13.5px] font-semibold">
                          Annualized total return
                          <InfoTip text="The compound annual growth rate on your invested cash if the 5-year projection plays out: (sale proceeds + all cash flow) relative to cash invested, annualized." />
                        </span>
                        <span
                          className={`text-[15px] font-semibold tabular-nums ${
                            outlook.projection.annualizedReturnPct > 0
                              ? "text-positive"
                              : "text-negative"
                          }`}
                        >
                          {outlook.projection.annualizedReturnPct.toFixed(1)}%/yr
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            <section className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-x-11 gap-y-[34px]">
              <div className="flex flex-col">
                <h3 className="mb-1 border-b-2 border-ink pb-2 font-serif text-[21px] font-medium">
                  What the analysis used
                </h3>
                {(
                  [
                    [
                      "Market rent baseline",
                      scenarios?.market
                        ? `${usdWhole(scenarios.market.monthlyRent)}/mo`
                        : "unavailable",
                      scenarios?.market
                        ? (scenarios.marketRentSource &&
                            MARKET_SRC_LABEL[scenarios.marketRentSource]) ||
                          "modelled"
                        : "no HUD data, no ATTOM key",
                    ],
                    [
                      "Section 8 rent",
                      scenarios?.s8
                        ? `${usdWhole(scenarios.s8.monthlyRent)}/mo`
                        : "unavailable",
                      scenarios?.s8
                        ? `${adv.paymentStandardPct}% payment standard`
                        : "needs HUD FMR",
                    ],
                    [
                      "Airbnb revenue",
                      scenarios?.str
                        ? `${usdWhole(scenarios.str.monthlyRent)}/mo`
                        : "unavailable",
                      scenarios?.str
                        ? "occupancy-adjusted, Mashvisor"
                        : data.mashvisorError
                          ? "Mashvisor unavailable"
                          : "no Mashvisor key",
                    ],
                    [
                      "Local median rent",
                      scenarios?.acsRentForBeds != null
                        ? `${usdWhole(scenarios.acsRentForBeds)}/mo`
                        : "unavailable",
                      scenarios?.acsRentForBeds != null
                        ? (data.acsRent?.source ?? "Census ACS")
                        : "needs a free Census key",
                    ],
                    [
                      "Property tax rate",
                      scenarios ? `${(scenarios.taxRate * 100).toFixed(2)}%/yr` : "—",
                      scenarios?.taxSource ?? data.tax.source,
                    ],
                    [
                      "Flood zone",
                      data.flood.zone ? `Zone ${data.flood.zone}` : "none mapped",
                      data.flood.highRisk
                        ? "insurance +40% · FEMA flood map"
                        : data.flood.moderateRisk
                          ? "insurance +15% · FEMA flood map"
                          : "no surcharge · FEMA flood map",
                    ],
                    [
                      "Estimated value",
                      data.attom?.avmValue != null
                        ? usdWhole(data.attom.avmValue)
                        : "unavailable",
                      data.attom?.avmValue != null
                        ? `automated valuation${
                            data.attom.avmConfidence != null
                              ? `, confidence ${data.attom.avmConfidence}/100`
                              : ""
                          }`
                        : data.attomError
                          ? "ATTOM unavailable"
                          : "no ATTOM key",
                    ],
                    [
                      "Last sale",
                      data.attom?.lastSalePrice != null
                        ? usdWhole(data.attom.lastSalePrice)
                        : "unavailable",
                      data.attom?.lastSalePrice != null
                        ? (data.attom.lastSaleDate?.slice(0, 4) ?? "ATTOM")
                        : data.attomError
                          ? "ATTOM unavailable"
                          : "no ATTOM key",
                    ],
                    [
                      "Cash required",
                      cashIn != null ? usdWhole(cashIn) : "—",
                      `${adv.downPaymentPct}% down + ${adv.closingCostPct}% closing${
                        adv.rehabCost > 0 ? " + rehab" : ""
                      }`,
                    ],
                  ] as [string, string, string][]
                ).map(([labelText, value, source], i, arr) => (
                  <div
                    key={labelText}
                    className={`flex items-baseline justify-between gap-4 py-[10px] ${
                      i < arr.length - 1 ? "border-b border-rule" : ""
                    }`}
                  >
                    <span className="text-[13px] text-[#4a423a]">{labelText}</span>
                    <span className="flex flex-col items-end gap-[1px]">
                      <b
                        className={`text-[13px] font-semibold ${
                          value === "unavailable" ? "font-normal text-disabled" : ""
                        }`}
                      >
                        {value}
                      </b>
                      <span className="text-right text-[12px] text-label">
                        {source}
                      </span>
                    </span>
                  </div>
                ))}
                {divergePct != null && divergePct > 0 && (
                  <div className="mt-4 border-l-[3px] border-warn bg-accent-tint py-[10px] pl-[14px]">
                    <p className="m-0 font-serif text-[14px] leading-[1.6] text-warn-ink">
                      <b className="font-semibold">Verify the market rent.</b>{" "}
                      ATTOM&apos;s model says {usdWhole(data.attom!.rentalAvm!)}
                      /mo, HUD says {usdWhole(scenarios!.fmrRent!)}/mo —{" "}
                      {divergePct.toFixed(0)}% apart. Both are estimates; one
                      real comp settles it. Section 8 keys off FMR either way.
                    </p>
                  </div>
                )}
              </div>

              <FidelityCheck
                data={data}
                scenarios={scenarios}
                price={price === "" ? 0 : Number(price)}
                bedrooms={bedrooms === "" ? 3 : Number(bedrooms)}
                mashvisorConfigured={sources?.mashvisor ?? false}
              />
            </section>

            {savedPins.length > 0 && (
              <section className="flex flex-col gap-[14px]">
                <div className="flex flex-wrap items-baseline justify-between gap-[14px] border-b-2 border-ink pb-2">
                  <h3 className="font-serif text-[21px] font-medium">
                    Deal map{" "}
                    <span className="text-[13px] font-normal text-label">
                      {visiblePins.length} of {savedPins.length} shown
                    </span>
                  </h3>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[11.5px] text-label">Color by</span>
                      <div className="flex gap-[14px]">
                        {(
                          [
                            ["market", "Market"],
                            ["s8", "Section 8"],
                            ["str", "Airbnb"],
                          ] as const
                        ).map(([key, labelText]) => (
                          <button
                            key={key}
                            onClick={() => setColorBy(key)}
                            className={`cursor-pointer pb-[1px] text-[12px] ${
                              colorBy === key
                                ? "border-b-2 border-accent text-ink"
                                : "border-b border-transparent text-label"
                            }`}
                          >
                            {labelText}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-[11.5px] text-[#4a423a]">
                      {ALL_RATINGS.map((r) => {
                        const on = ratingFilter.has(r);
                        return (
                          <button
                            key={r}
                            title={`${on ? "Hide" : "Show"} ${r} deals`}
                            onClick={() =>
                              setRatingFilter((prev) => {
                                const next = new Set(prev);
                                if (next.has(r)) next.delete(r);
                                else next.add(r);
                                return next;
                              })
                            }
                            className={`flex cursor-pointer items-center gap-[5px] ${
                              on ? "" : "opacity-35"
                            }`}
                          >
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ background: RATING_COLORS[r] }}
                            />
                            {r}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <PropertyMap
                  pins={visiblePins}
                  colorBy={colorBy}
                  focusId={focusId}
                />

                <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1.2fr_28px]">
                  {["Property", "Price", "Market", "Sec. 8", "Airbnb", "Best play", ""].map(
                    (h, i) => (
                      <span
                        key={h || "x"}
                        className={`border-b border-ink py-[9px] text-[10.5px] font-semibold uppercase tracking-[.11em] text-label ${
                          i >= 1 && i <= 4 ? "px-3 text-right" : i === 5 ? "pl-3" : ""
                        }`}
                      >
                        {h}
                      </span>
                    )
                  )}
                  {[...visiblePins]
                    .sort(
                      (a, b) =>
                        ((b[colorBy] ?? b.market ?? b.s8 ?? b.str)?.monthlyCashFlow ?? 0) -
                        ((a[colorBy] ?? a.market ?? a.s8 ?? a.str)?.monthlyCashFlow ?? 0)
                    )
                    .map((p) => {
                      const m = p[colorBy] ?? p.market ?? p.s8 ?? p.str;
                      const plays: [string, PinMetrics | undefined][] = [
                        ["Market rent", p.market],
                        ["Section 8", p.s8],
                        ["Short-term rental", p.str],
                      ];
                      let play = "—";
                      let playCf = -Infinity;
                      for (const [pl, pm] of plays) {
                        if (pm && pm.monthlyCashFlow > playCf) {
                          playCf = pm.monthlyCashFlow;
                          play = pl;
                        }
                      }
                      const cell = (
                        metric: PinMetrics | undefined,
                        key: ScenarioKey
                      ) => (
                        <span
                          className={`cursor-pointer border-b border-rule px-3 py-[11px] text-right text-[13px] tabular-nums ${
                            colorBy === key ? "font-semibold" : ""
                          } ${metric ? cfClass(metric.monthlyCashFlow) : "text-label"}`}
                          onClick={() => setFocusId(p.id)}
                        >
                          {metric ? signedUsd(metric.monthlyCashFlow) : "—"}
                        </span>
                      );
                      return (
                        <span key={p.id} className="contents">
                          <span
                            onClick={() => setFocusId(p.id)}
                            className="flex cursor-pointer items-center gap-[9px] border-b border-rule py-[11px] text-[13px] hover:bg-accent-tint"
                          >
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{
                                background: m ? RATING_COLORS[m.rating] : "#6b6257",
                              }}
                            />
                            <span className="truncate">{p.address}</span>
                          </span>
                          <span
                            onClick={() => setFocusId(p.id)}
                            className="cursor-pointer border-b border-rule px-3 py-[11px] text-right text-[13px] text-[#4a423a] tabular-nums"
                          >
                            {usd(p.price)}
                          </span>
                          {cell(p.market, "market")}
                          {cell(p.s8, "s8")}
                          {cell(p.str, "str")}
                          <span className="flex items-center gap-[7px] border-b border-rule py-[11px] pl-3 text-[12px]">
                            <span className="text-[#4a423a]">{play}</span>
                            {m && <RatingBadge rating={m.rating} small />}
                            {m?.almost && (
                              <span
                                title={
                                  m.gapText
                                    ? `${m.gapText} away from ${m.almost}`
                                    : `almost ${m.almost}`
                                }
                                className="text-[10px]"
                                style={{ color: RATING_COLORS[m.almost] }}
                              >
                                almost {m.almost}
                              </span>
                            )}
                          </span>
                          <span className="flex items-center justify-end border-b border-rule py-[11px]">
                            <button
                              onClick={() => {
                                setSavedPins((prev) =>
                                  prev.filter((x) => x.id !== p.id)
                                );
                                if (focusId === p.id) setFocusId(null);
                              }}
                              title="Remove from map"
                              className="cursor-pointer px-1 text-label hover:text-negative"
                            >
                              ✕
                            </button>
                          </span>
                        </span>
                      );
                    })}
                </div>
              </section>
            )}

            <p className="m-0 max-w-[96ch] border-t border-rule pt-4 text-[11.5px] leading-[1.75] text-label">
              Ratings are per unit, measured on monthly cash flow after the
              mortgage and cash-on-cash return.{" "}
              <b className="font-semibold text-body">Rare</b> ≥ $400/mo, ≥12%
              cash-on-cash, ≥8% cap rate ·{" "}
              <b className="font-semibold text-body">Fantastic</b> ≥ $250/mo,
              ≥10% cash-on-cash ·{" "}
              <b className="font-semibold text-body">Great</b> ≥ $150/mo, ≥8%
              cash-on-cash · <b className="font-semibold text-body">Good</b>{" "}
              &gt; $50/mo, ≥5% cash-on-cash ·{" "}
              <b className="font-semibold text-body">Poor</b> otherwise —
              breaking even is not a goal. A dashed{" "}
              <b className="font-semibold text-body">Almost</b> badge means the
              deal misses the next tier by less than $50/mo, 1.5 points of
              cash-on-cash or 1 point of cap rate. All figures are estimates
              from public data — HUD Fair Market Rents, FEMA flood maps, the
              Census geocoder, Census county data (taxes, rents, vacancy,
              population), BLS unemployment and the FRED mortgage average —
              plus ATTOM property records and Mashvisor short-term data where a
              key is configured. Verify rents with local comparable rentals,
              taxes with the county auditor and insurance with real quotes
              before making an offer. Not professional advice.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
