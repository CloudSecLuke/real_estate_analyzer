"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  DEFAULT_ASSUMPTIONS,
  LEGACY_RATING_LABEL,
  projectFiveYears,
  RATING_COLORS,
  TIERS,
} from "@/lib/metrics";
import { computeScenariosFromData, buildPin, stressTest } from "@/lib/scenarios";
import { nextTierUp, solveOfferPrices } from "@/lib/offer";
import { investorValue as solveInvestorValue } from "@/lib/investorValue";
import {
  dscrOf,
  pencilScore,
  PENCIL_TIERS,
  scoreParts,
  tierForLegacyRating,
  tierForScore,
  type PencilTier,
} from "@/lib/pencilScore";
import { buildConfidence, CONF_PILL } from "@/lib/confidence";
import {
  bandNote,
  buildPencilVerdict,
  DISPLAY_LABEL,
  MARKET_SRC_LABEL,
  rankScenarios,
  signedUsd,
  TAB_LABEL,
  usdWhole,
  pct1,
  whyAndRisks,
  type RankedScenario,
  type ScenarioKey3,
} from "@/lib/verdict";
import AssumptionsSidebar, {
  type SourceStatus,
} from "@/components/AssumptionsSidebar";
import FidelityCheck from "@/components/FidelityCheck";
import InfoTip from "@/components/InfoTip";
import { AppMark } from "@/components/PencilMark";
import type {
  AnalyzeResponse,
  Assumptions,
  HistoryEntry,
  PinMetrics,
  Rating,
  SavedPin,
  SavedSearch,
  ScenarioKey,
  ScenarioResult,
} from "@/lib/types";

// Leaflet touches `window` at import time — client-only
const PropertyMap = dynamic(() => import("@/components/PropertyMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[400px] w-full animate-pulse rounded-[10px] border border-border bg-sidebar" />
  ),
});

const PINS_KEY = "rea_saved_pins_v1";
const HISTORY_KEY = "rea_history_v1";
const SEARCHES_KEY = "rea_searches_v1";
const HISTORY_MAX = 20;
const SEARCHES_MAX = 30;

type Phase = "empty" | "loading" | "results";
type Strategy = "auto" | ScenarioKey3;

const usd = (n: number, digits = 0) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });

const cfClass = (n: number) => (n > 0 ? "text-positive" : "text-negative");

const CAPEX_TIP =
  "CapEx = capital expenditures: the big-ticket replacements a house needs every 15–25 years — roof, furnace/AC, water heater, siding. The reserve treats those future bills as a monthly cost today, so one roof doesn't erase years of paper profit. Distinct from routine maintenance.";

const OUTLINE_BTN =
  "cursor-pointer rounded-[7px] border border-input-border bg-card px-[14px] py-[9px] text-[12.5px] font-semibold text-ink hover:border-ink";

function TierBadge({ tier, small }: { tier: PencilTier; small?: boolean }) {
  return (
    <span
      className={`flex-none whitespace-nowrap rounded-[5px] font-bold uppercase ${
        small ? "px-[7px] py-[2px] text-[10px] tracking-[.05em]" : "px-[9px] py-[3px] text-[10.5px] tracking-[.05em]"
      }`}
      style={{ backgroundColor: tier.bg, color: tier.fg, minWidth: "fit-content" }}
    >
      {tier.label}
    </span>
  );
}

function LegacyBadge({ rating }: { rating: Rating }) {
  return (
    <span
      title="Sharpness — the fixed-threshold read (Razor Sharp ≥ $400/mo cash flow, ≥12% cash-on-cash, ≥8% cap rate; Sharp ≥ $250/≥10%; Pointed ≥ $150/≥8%; Needs Sharpening > $50/≥5%; Broken otherwise)"
      className="flex-none whitespace-nowrap rounded-[5px] px-[7px] py-[2px] text-[10px] font-bold uppercase tracking-[.05em] text-card"
      style={{ backgroundColor: RATING_COLORS[rating] }}
    >
      {LEGACY_RATING_LABEL[rating]}
    </span>
  );
}

function AlmostChip({ almost }: { almost: Rating }) {
  return (
    <span
      className="flex-none whitespace-nowrap rounded-[5px] border border-dashed px-[7px] py-[2px] text-[10.5px] font-medium"
      style={{ borderColor: RATING_COLORS[almost], color: RATING_COLORS[almost] }}
    >
      Almost {LEGACY_RATING_LABEL[almost]}
    </span>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10.5px] font-bold uppercase tracking-[.14em] text-accent">
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
    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3 border-b border-ink pb-[9px]">
      <h3 className="text-[19px] font-bold tracking-[-.02em]">{title}</h3>
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
  tip?: string;
}) {
  return (
    <div className="flex flex-col gap-[1px]">
      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[.07em] text-label">
        {label}
        {tip && <InfoTip text={tip} />}
      </span>
      <span className="text-[14px] font-semibold tabular-nums">{value}</span>
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
    <details className="mt-1 text-[12.5px]">
      <summary className="cursor-pointer text-label">
        Why {LEGACY_RATING_LABEL[s.rating]} (sharpness)?
      </summary>
      <p className="mt-1 text-[11.5px] text-label">
        {s.rating === "Poor"
          ? "Fails the minimum (Needs Sharpening) thresholds:"
          : `Meets every ${LEGACY_RATING_LABEL[s.rating]} threshold${s.rating !== "Rare" ? " (but not the next tier up)" : ""}:`}
      </p>
      <table className="mt-1 w-full">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-rule">
              <td className="py-1 text-body">{r.label}</td>
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

interface BillingStatus {
  plan: "free" | "investor" | "founder";
  planStatus?: string;
  freeRemaining: number | null;
  monthlyRemaining: number | null;
  billingConfigured?: boolean;
  limits?: { free: number; investorMonthly: number; investorPriceUsd: number };
  pastDue?: boolean;
  graceEndsAt?: string | null;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: string | null;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function planLine(b: BillingStatus): string {
  if (b.plan === "founder") return "Founder · unlimited pencils";
  if (b.plan === "investor") {
    if (b.cancelAtPeriodEnd && b.currentPeriodEnd)
      return `Investor until ${fmtDate(b.currentPeriodEnd)} · ${
        b.monthlyRemaining ?? "—"
      } pencils left`;
    return `Investor plan · ${b.monthlyRemaining ?? "—"} of ${
      b.limits?.investorMonthly ?? 100
    } pencils left this month`;
  }
  const free = b.freeRemaining ?? 0;
  return free > 0
    ? `Free plan · ${free} free pencil${free === 1 ? "" : "s"} left`
    : "Free plan · free pencil used";
}

function AccountMenu({
  user,
  persistent,
  billing,
  onUpgrade,
  onManageBilling,
  onSignOut,
  onSignOutEverywhere,
}: {
  user: string | null;
  persistent: boolean;
  billing: BillingStatus | null;
  onUpgrade: () => void;
  onManageBilling: () => void;
  onSignOut: () => void;
  onSignOutEverywhere: () => void;
}) {
  if (!user) return null;
  const initials = user
    .split(".")
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
  return (
    <details className="relative">
      <summary
        title={user}
        className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-full border border-input-border bg-card text-[11px] font-bold text-ink hover:border-ink [&::-webkit-details-marker]:hidden"
      >
        {initials || "?"}
      </summary>
      <div className="absolute right-0 z-40 mt-1 flex w-48 flex-col gap-2 rounded-[8px] border border-border bg-card p-3">
        <div className="flex flex-col">
          <span className="text-[12.5px] font-bold text-ink">{user}</span>
          <span className="text-[11px] text-label">
            {persistent ? "synced to your account" : "saved on this device only"}
          </span>
        </div>
        {billing && (
          <div className="flex flex-col gap-[6px] border-t border-border pt-2">
            <span className="text-[11.5px] leading-[1.45] text-body">
              {planLine(billing)}
            </span>
            {billing.plan === "free" && (
              <button
                onClick={onUpgrade}
                className="cursor-pointer rounded-[7px] bg-pencil px-3 py-[6px] text-left text-[12px] font-bold text-ink hover:bg-pencil-dark"
              >
                Upgrade — ${billing.limits?.investorPriceUsd ?? 19}/mo
              </button>
            )}
            {billing.pastDue && (
              <span className="text-[11px] leading-[1.45] text-negative">
                Payment failed — update your card by {fmtDate(billing.graceEndsAt)} to
                keep your plan.
              </span>
            )}
            {billing.plan === "investor" && billing.cancelAtPeriodEnd && (
              <button
                onClick={onManageBilling}
                className="cursor-pointer rounded-[7px] bg-pencil px-3 py-[6px] text-left text-[12px] font-bold text-ink hover:bg-pencil-dark"
              >
                Resubscribe
              </button>
            )}
            {billing.plan === "investor" && (
              <button
                onClick={onManageBilling}
                className="cursor-pointer rounded-[7px] border border-input-border bg-paper px-3 py-[6px] text-left text-[12px] font-semibold text-ink hover:border-ink"
              >
                {billing.pastDue ? "Fix payment" : "Manage billing"}
              </button>
            )}
          </div>
        )}
        <button
          onClick={onSignOut}
          className="cursor-pointer rounded-[7px] border border-input-border bg-paper px-3 py-[6px] text-left text-[12px] font-semibold text-negative hover:border-negative"
        >
          Sign out
        </button>
        <button
          onClick={onSignOutEverywhere}
          className="cursor-pointer rounded-[7px] px-3 py-[5px] text-left text-[11px] font-medium text-muted hover:text-negative"
        >
          Sign out of all devices
        </button>
      </div>
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
  const [strategy, setStrategy] = useState<Strategy>("auto");
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [adv, setAdv] = useState({ ...DEFAULT_ASSUMPTIONS });
  const setA = <K extends keyof typeof adv>(k: K, v: (typeof adv)[K]) =>
    setAdv((p) => ({ ...p, [k]: v }));
  const targetCoc = adv.targetCocPct ?? 10;

  const [savedPins, setSavedPins] = useState<SavedPin[]>([]);
  const [pinsLoaded, setPinsLoaded] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const [persistent, setPersistent] = useState(false);
  const [liveRate, setLiveRate] = useState<{ pct: number; asOf: string } | null>(null);
  const [tierFilter, setTierFilter] = useState<Set<string>>(
    new Set(PENCIL_TIERS.map((t) => t.short))
  );
  const [focusId, setFocusId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [justSaved, setJustSaved] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [paywall, setPaywall] = useState<"upgrade" | "quota" | null>(null);
  const [billingNote, setBillingNote] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  const refreshBilling = () =>
    fetch("/api/billing/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b && setBilling(b))
      .catch(() => {});

  useEffect(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then(setSources)
      .catch(() => {});
    refreshBilling();
    // Back from Stripe Checkout: ?billing=success|cancelled
    const q = new URLSearchParams(window.location.search).get("billing");
    if (q === "success") {
      setBillingNote(
        "You're on the Investor plan — 100 pencils a month. Happy penciling."
      );
      // the webhook may land a beat after the redirect; re-check shortly
      setTimeout(refreshBilling, 4000);
      window.history.replaceState(null, "", "/app");
    } else if (q === "cancelled") {
      setBillingNote("Checkout cancelled — no charge was made.");
      window.history.replaceState(null, "", "/app");
    }
  }, []);

  async function startCheckout() {
    if (checkoutBusy) return;
    setCheckoutBusy(true);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.url) {
        throw new Error(json.error ?? "Could not start checkout.");
      }
      window.location.href = json.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout.");
      setCheckoutBusy(false);
    }
  }

  async function openPortal() {
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.url) {
        throw new Error(json.error ?? "Could not open billing portal.");
      }
      window.location.href = json.url;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not open billing portal."
      );
    }
  }

  useEffect(() => {
    (async () => {
      let pins: SavedPin[] = [];
      let hist: HistoryEntry[] = [];
      let srch: SavedSearch[] = [];
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
        hist = Array.isArray(json.history) ? json.history : [];
        srch = Array.isArray(json.searches) ? json.searches : [];
        if (json.assumptions) setAdv((p) => ({ ...p, ...json.assumptions }));
      } catch {
        // server unreachable — run local-only
      }
      const localFallback = <T,>(key: string, current: T[]): T[] => {
        if (current.length > 0) return current;
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const local = JSON.parse(raw);
            if (Array.isArray(local)) return local;
          }
        } catch {
          // corrupted storage — start fresh
        }
        return current;
      };
      pins = localFallback(PINS_KEY, pins);
      hist = localFallback(HISTORY_KEY, hist);
      srch = localFallback(SEARCHES_KEY, srch);
      setSavedPins(pins);
      setHistory(hist);
      setSearches(srch);
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

      // landing-page funnel: /app?address=... (surviving the login
      // round-trip via the proxy's `next` param) auto-pencils on arrival
      const urlAddress = new URLSearchParams(window.location.search).get(
        "address"
      );
      if (urlAddress) {
        window.history.replaceState({}, "", "/app");
        setAddress(urlAddress);
        analyze(urlAddress);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pinsLoaded) return;
    localStorage.setItem(PINS_KEY, JSON.stringify(savedPins));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    localStorage.setItem(SEARCHES_KEY, JSON.stringify(searches));
    if (!persistent) return;
    const t = setTimeout(() => {
      fetch("/api/pins", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pins: savedPins, assumptions: adv, history, searches }),
      }).catch(() => {
        // transient save failure — localStorage still has the data
      });
    }, 800);
    return () => clearTimeout(t);
  }, [savedPins, adv, history, searches, pinsLoaded, persistent]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }

  async function signOutEverywhere() {
    if (
      !window.confirm(
        "Sign out of all devices? You'll be signed out here and everywhere else this account is logged in."
      )
    ) {
      return;
    }
    await fetch("/api/auth/logout-all", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }

  // The eight penciling steps. /api/analyze is one server call that fans
  // out internally, so the timer paces the display while the fetch is in
  // flight; keys that are not configured render "skipped · no key".
  const steps = useMemo(
    () => [
      // Capability labels only — commercial vendor names never render in
      // the product UI (government sources like HUD are fine to show).
      { label: "Finding the property…", src: "public records", on: true },
      { label: "Checking comparable sales…", src: "sales data", on: sources?.attom ?? false },
      { label: "Estimating market rent…", src: "rent data", on: sources?.attom ?? false },
      { label: "Checking Section 8 potential…", src: "HUD", on: sources?.hud ?? true },
      { label: "Checking property taxes…", src: "county data", on: sources?.attom ?? false },
      { label: "Testing short-term demand…", src: "market data", on: sources?.mashvisor ?? false },
      { label: "Modeling financing…", src: "PropPencil", on: true },
      { label: "Penciling the deal…", src: "PropPencil", on: true },
    ],
    [sources]
  );

  async function analyze(addr?: string, opts?: { keepInputs?: boolean }) {
    const target = (addr ?? address).trim();
    if (!target) return;
    setSidebarOpen(false); // on mobile, reveal the results
    setPhase("loading");
    setLoadStep(0);
    setError(null);
    setPaywall(null);
    setAutoFilled(null);
    if (stepTimer.current) clearInterval(stepTimer.current);
    stepTimer.current = setInterval(() => {
      setLoadStep((s) => Math.min(s + 1, 6));
    }, 400);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: target }),
      });
      const json = await res.json();
      if (res.status === 402) {
        setPaywall(json.paywall === "quota" ? "quota" : "upgrade");
        setPhase(data ? "results" : "empty");
        refreshBilling();
        if (stepTimer.current) {
          clearInterval(stepTimer.current);
          stepTimer.current = null;
        }
        return;
      }
      if (!res.ok) throw new Error(json.error ?? "Penciling failed");
      const resp = json as AnalyzeResponse;
      const listing = resp.mashvisor?.listing;
      const bedsAuto = listing?.beds ?? resp.attom?.beds;
      const priceAuto = listing?.listPrice;
      let finalPrice = price === "" ? 0 : Number(price);
      let finalBeds = bedrooms === "" ? 3 : Number(bedrooms);
      if (!opts?.keepInputs) {
        if (bedsAuto != null) {
          setBedrooms(bedsAuto);
          finalBeds = bedsAuto;
        }
        if (priceAuto != null) {
          const rounded = Math.round(priceAuto);
          setPrice(rounded);
          finalPrice = rounded;
        }
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
      }
      const matched = resp.property.matchedAddress;
      setHistory((prev) =>
        [
          {
            address: matched,
            queriedAt: new Date().toISOString(),
            price: finalPrice,
            bedrooms: finalBeds,
          },
          ...prev.filter((h) => h.address.toLowerCase() !== matched.toLowerCase()),
        ].slice(0, HISTORY_MAX)
      );
      setData(resp);
      setStrategy("auto");
      setLoadStep(8);
      setPhase("results");
      refreshBilling(); // a pencil was just spent — keep the menu count honest
    } catch (err) {
      setError(err instanceof Error ? err.message : "Penciling failed");
      setPhase(data ? "results" : "empty");
    } finally {
      if (stepTimer.current) {
        clearInterval(stepTimer.current);
        stepTimer.current = null;
      }
    }
  }

  function startOver() {
    setData(null);
    setError(null);
    setAutoFilled(null);
    setPhase("empty");
  }

  function saveSearch() {
    if (!data || price === "" || bedrooms === "") return;
    const entry: SavedSearch = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: data.property.matchedAddress,
      address: data.property.matchedAddress,
      price: Number(price),
      bedrooms: Number(bedrooms),
      assumptions: { ...adv },
      savedAt: new Date().toISOString(),
    };
    setSearches((prev) =>
      [entry, ...prev.filter((s) => s.address !== entry.address)].slice(0, SEARCHES_MAX)
    );
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  }

  function loadSearch(s: SavedSearch) {
    setAddress(s.address);
    setPrice(s.price);
    setBedrooms(s.bedrooms);
    setAdv((p) => ({ ...p, ...s.assumptions }));
    analyze(s.address, { keepInputs: true });
  }

  const assumptionsFull = useMemo<Assumptions | null>(() => {
    if (price === "" || bedrooms === "") return null;
    return { ...adv, price: Number(price), bedrooms: Number(bedrooms) };
  }, [adv, price, bedrooms]);

  const scenarios = useMemo(() => {
    if (!data || !assumptionsFull) return null;
    return computeScenariosFromData(data, assumptionsFull);
  }, [data, assumptionsFull]);

  const ranked = useMemo<RankedScenario[]>(
    () => (scenarios ? rankScenarios(scenarios) : []),
    [scenarios]
  );

  const activeKey: ScenarioKey3 | null = useMemo(() => {
    if (ranked.length === 0) return null;
    if (strategy !== "auto" && ranked.some((r) => r.key === strategy)) return strategy;
    return ranked[0].key;
  }, [ranked, strategy]);

  const active = useMemo(
    () => ranked.find((r) => r.key === activeKey) ?? null,
    [ranked, activeKey]
  );

  // Investor value: one bisection per render, threaded everywhere — the
  // investor-value card, max buy price, walk-away gap, recommendation AND
  // the score's price-vs-value part all read this single number.
  const iv = useMemo(() => {
    if (!data || !assumptionsFull || !active) return 0;
    return solveInvestorValue(data, assumptionsFull, active.key, targetCoc);
  }, [data, assumptionsFull, active, targetCoc]);

  const scoreInputs = useMemo(
    () =>
      assumptionsFull
        ? {
            units: Math.max(1, assumptionsFull.units),
            targetCoc,
            price: assumptionsFull.price,
            investorValue: iv,
          }
        : null,
    [assumptionsFull, targetCoc, iv]
  );

  const parts = useMemo(
    () => (active && scoreInputs ? scoreParts(active.s, scoreInputs) : []),
    [active, scoreInputs]
  );
  const score = useMemo(
    () => (active && scoreInputs ? pencilScore(active.s, scoreInputs) : 0),
    [active, scoreInputs]
  );
  const tier = tierForScore(score);

  const confidence = useMemo(
    () => (data && scenarios && assumptionsFull ? buildConfidence(data, scenarios, assumptionsFull) : null),
    [data, scenarios, assumptionsFull]
  );

  const verdict = useMemo(() => {
    if (!active || !assumptionsFull) return null;
    return buildPencilVerdict({
      score,
      price: assumptionsFull.price,
      investorValue: iv,
      active,
      count: ranked.length,
      cashIn: active.s.cashInvested,
      targetCoc,
    });
  }, [active, assumptionsFull, score, iv, ranked.length, targetCoc]);

  const wr = useMemo(() => {
    if (!data || !scenarios || !active || !assumptionsFull) return { why: [], risks: [] };
    return whyAndRisks({
      data,
      set: scenarios,
      active,
      a: assumptionsFull,
      investorValue: iv,
      parts,
      targetCoc,
      rentRange: confidence?.rentRange ?? null,
    });
  }, [data, scenarios, active, assumptionsFull, iv, parts, targetCoc, confidence]);

  const outlook = useMemo(() => {
    if (!data || !scenarios || !assumptionsFull) return null;
    return {
      stress: stressTest(data, assumptionsFull, scenarios),
      projection: scenarios.market
        ? projectFiveYears(scenarios.market, assumptionsFull)
        : null,
    };
  }, [data, scenarios, assumptionsFull]);

  const offers = useMemo(() => {
    if (!data || !assumptionsFull || ranked.length === 0) return null;
    return solveOfferPrices(data, assumptionsFull, ranked.map((r) => r.key));
  }, [data, assumptionsFull, ranked]);

  // "312 WALNUT ST, CINCINNATI, OH, 45202" → "Cincinnati" for PHA guidance
  const cityLabel = useMemo(() => {
    const city = data?.property.matchedAddress.split(",")[1]?.trim() ?? "";
    return city ? city.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null;
  }, [data]);

  // Auto-save/update the penciled property as a map pin, with per-strategy
  // Pencil Scores computed against the current investor value.
  useEffect(() => {
    if (!data || !scenarios || !scoreInputs) return;
    if (!scenarios.market && !scenarios.s8 && !scenarios.str) return;
    if (price === "" || bedrooms === "") return;
    const pin = buildPin(data, scenarios, Number(price), Number(bedrooms));
    const withScore = (m: PinMetrics | undefined, s: ScenarioResult | null) =>
      m && s ? { ...m, score: pencilScore(s, scoreInputs) } : m;
    const scored: SavedPin = {
      ...pin,
      investorValue: iv > 0 ? iv : undefined,
      market: withScore(pin.market, scenarios.market),
      s8: withScore(pin.s8, scenarios.s8),
      str: withScore(pin.str, scenarios.str),
    };
    setSavedPins((prev) => {
      const rest = prev.filter((p) => p.id !== scored.id);
      return [...rest, scored];
    });
    setFocusId(scored.id);
  }, [data, scenarios, price, bedrooms, scoreInputs, iv]);

  const pinKey: ScenarioKey = (activeKey ?? "market") as ScenarioKey;

  const pinTier = (m: PinMetrics | undefined): PencilTier | null =>
    m ? (m.score != null ? tierForScore(m.score) : tierForLegacyRating(m.rating)) : null;

  const visiblePins = useMemo(
    () =>
      savedPins.filter((p) => {
        const m = p[pinKey] ?? p.market ?? p.s8 ?? p.str;
        const t = pinTier(m);
        return t ? tierFilter.has(t.short) : true;
      }),
    [savedPins, pinKey, tierFilter]
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
  const yearBuilt = data?.mashvisor?.listing?.yearBuilt ?? data?.attom?.yearBuilt;

  const subhead = data
    ? [
        `${data.property.countyName}, ${data.property.state}`,
        beds !== "" && beds != null
          ? `${beds} bed${baths != null ? ` / ${baths} bath` : ""}`
          : null,
        sqft != null ? `${sqft.toLocaleString()} sqft` : null,
        yearBuilt != null ? `built ${yearBuilt}` : null,
        cashIn != null ? `${usdWhole(cashIn)} cash in` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const divergePct =
    data?.attom?.rentalAvm != null && scenarios?.fmrRent != null
      ? (Math.abs(data.attom.rentalAvm - scenarios.fmrRent) / scenarios.fmrRent) * 100
      : null;

  const hudMissing = Boolean(data && !data.fmr);
  const mvMissing = Boolean(data && !data.mashvisor?.str);

  const strategyTabs = (
    <div className="flex gap-3">
      {ranked.map((r) => (
        <button
          key={r.key}
          onClick={() => setStrategy(r.key)}
          className={`cursor-pointer pb-[2px] text-[12px] font-semibold ${
            activeKey === r.key
              ? "border-b-2 border-pencil text-ink"
              : "border-b-2 border-transparent text-label"
          }`}
        >
          {TAB_LABEL[r.key]}
        </button>
      ))}
    </div>
  );

  return (
    <div className="grid min-h-screen grid-cols-[304px_minmax(0,1fr)] items-start max-lg:block">
      {/* mobile top bar — the sidebar becomes a toggled drawer under lg */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-sidebar px-4 py-3 lg:hidden">
        <span className="flex items-center gap-2">
          <AppMark size={24} />
          <span className="text-[15px] font-extrabold tracking-[-.032em]">PropPencil</span>
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="cursor-pointer rounded-[7px] border border-input-border bg-card px-3 py-[6px] text-[12px] font-semibold text-ink"
          >
            {sidebarOpen ? "Close" : "Inputs"}
          </button>
          <AccountMenu user={user} persistent={persistent} billing={billing} onUpgrade={startCheckout} onManageBilling={openPortal} onSignOut={signOut} onSignOutEverywhere={signOutEverywhere} />
        </div>
      </div>
      <div className={`${sidebarOpen ? "block" : "hidden"} lg:block`}>
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
            setAdv(() => ({
              ...DEFAULT_ASSUMPTIONS,
              interestRatePct: liveRate?.pct ?? DEFAULT_ASSUMPTIONS.interestRatePct,
            }))
          }
          onAnalyze={() => analyze()}
          analyzing={phase === "loading"}
          sources={sources}
          liveRate={liveRate}
          batchAssumptions={adv}
          batchDefaultPrice={price === "" ? 100000 : Number(price)}
          batchDefaultBedrooms={bedrooms === "" ? 3 : Number(bedrooms)}
          onPin={(pin) =>
            setSavedPins((prev) => [...prev.filter((p) => p.id !== pin.id), pin])
          }
          history={history}
          searches={searches}
          onLoadSearch={loadSearch}
          onDeleteSearch={(id) =>
            setSearches((prev) => prev.filter((s) => s.id !== id))
          }
        />
      </div>

      <main className="flex max-w-[1440px] flex-col gap-[34px] px-10 pb-[70px] pt-[34px] max-md:px-5">
        <div className="-mb-4 flex items-center justify-end gap-2 max-lg:hidden">
          <details className="relative">
            <summary className={`${OUTLINE_BTN} flex list-none items-center gap-[6px] [&::-webkit-details-marker]:hidden`}>
              My Pencils
              {searches.length > 0 && (
                <span className="rounded-full bg-pencil px-[7px] py-[1px] text-[10.5px] font-bold text-ink tabular-nums">
                  {searches.length}
                </span>
              )}
              <span className="text-[10px] text-label">▾</span>
            </summary>
            <div className="absolute right-0 z-40 mt-1 flex w-[320px] flex-col gap-1 rounded-[8px] border border-border bg-card p-2">
              {searches.length === 0 && (
                <p className="px-2 py-2 text-[12px] leading-[1.5] text-label">
                  Nothing saved yet — pencil a property, then use{" "}
                  <b className="font-semibold">Save to My Pencils</b> in the deal
                  brief.
                </p>
              )}
              {searches.map((sv) => (
                <div
                  key={sv.id}
                  className="flex items-start justify-between gap-2 rounded-[5px] px-2 py-[6px] hover:bg-accent-tint"
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.currentTarget.closest("details")?.removeAttribute("open");
                      loadSearch(sv);
                    }}
                    title="Pencil this property again with the saved price, bedrooms and assumptions"
                    className="flex min-w-0 cursor-pointer flex-col items-start gap-[1px] text-left"
                  >
                    <span className="w-full truncate text-[12.5px] font-semibold text-ink">
                      {sv.name}
                    </span>
                    <span className="text-[11px] text-label tabular-nums">
                      ${sv.price.toLocaleString("en-US")} · {sv.bedrooms} bed ·{" "}
                      {new Date(sv.savedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSearches((prev) => prev.filter((x) => x.id !== sv.id))
                    }
                    title="Remove from My Pencils"
                    className="cursor-pointer px-1 text-[12px] text-label hover:text-negative"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </details>
          <details className="relative">
            <summary className={`${OUTLINE_BTN} flex list-none items-center gap-[6px] [&::-webkit-details-marker]:hidden`}>
              Recent
              <span className="text-[10px] text-label">▾</span>
            </summary>
            <div className="absolute right-0 z-40 mt-1 flex w-[320px] flex-col gap-1 rounded-[8px] border border-border bg-card p-2">
              {history.length === 0 && (
                <p className="px-2 py-2 text-[12px] leading-[1.5] text-label">
                  No addresses penciled yet.
                </p>
              )}
              {history.slice(0, 8).map((h) => (
                <button
                  key={h.address}
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.closest("details")?.removeAttribute("open");
                    setAddress(h.address);
                    setPrice(h.price);
                    setBedrooms(h.bedrooms);
                    analyze(h.address, { keepInputs: true });
                  }}
                  title="Pencil this address again"
                  className="flex cursor-pointer flex-col items-start gap-[1px] rounded-[5px] px-2 py-[6px] text-left hover:bg-accent-tint"
                >
                  <span className="w-full truncate text-[12.5px] font-medium text-ink">
                    {h.address}
                  </span>
                  <span className="text-[11px] text-label tabular-nums">
                    ${h.price.toLocaleString("en-US")} · {h.bedrooms} bed
                  </span>
                </button>
              ))}
            </div>
          </details>
          <AccountMenu user={user} persistent={persistent} billing={billing} onUpgrade={startCheckout} onManageBilling={openPortal} onSignOut={signOut} onSignOutEverywhere={signOutEverywhere} />
        </div>

        {error && (
          <div className="rounded-[8px] border border-[#f0dba8] border-l-4 border-l-negative bg-accent-tint px-4 py-[14px]">
            <span className="text-[13px] font-bold text-warn-ink">{error}</span>
          </div>
        )}

        {billingNote && (
          <div className="flex items-start justify-between gap-3 rounded-[8px] border border-border border-l-4 border-l-pencil bg-card px-4 py-[14px]">
            <span className="text-[13px] font-semibold text-ink">
              {billingNote}
            </span>
            <button
              onClick={() => setBillingNote(null)}
              className="cursor-pointer text-[12px] text-label hover:text-ink"
            >
              ✕
            </button>
          </div>
        )}

        {paywall && (
          <div className="flex flex-col gap-[14px] rounded-[10px] border border-border border-l-4 border-l-pencil bg-card px-5 py-[18px]">
            <div className="flex flex-col gap-[4px]">
              <span className="text-[15px] font-extrabold tracking-[-.01em] text-ink">
                {paywall === "quota"
                  ? "You've used all 100 pencils this month."
                  : "Your free pencil is used — keep penciling for $19/mo."}
              </span>
              <p className="max-w-[64ch] text-[13px] leading-[1.6] text-body">
                {paywall === "quota"
                  ? "Your Investor plan includes 100 full analyses each month, and the counter resets on your billing date. Your saved pencils and assumptions are untouched — you just can't run new addresses until the reset."
                  : `Every analysis pulls live data — HUD rents, county taxes, market comps — which is what your plan pays for. The Investor plan is $${
                      billing?.limits?.investorPriceUsd ?? 19
                    } a month for ${
                      billing?.limits?.investorMonthly ?? 100
                    } pencils, cancel any time. Your saved pencils and assumptions stay either way.`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-[10px]">
              {paywall === "upgrade" &&
                (billing?.billingConfigured === false ? (
                  <span className="text-[12.5px] font-semibold text-label">
                    Paid plans are opening shortly — email{" "}
                    <a
                      href="mailto:luke.f.miller.8@gmail.com?subject=PropPencil%20Investor%20plan"
                      className="text-accent underline"
                    >
                      luke.f.miller.8@gmail.com
                    </a>{" "}
                    and we&apos;ll set you up.
                  </span>
                ) : (
                  <button
                    onClick={startCheckout}
                    disabled={checkoutBusy}
                    className="cursor-pointer rounded-[7px] bg-pencil px-4 py-[9px] text-[13px] font-extrabold text-ink hover:bg-pencil-dark disabled:opacity-60"
                  >
                    {checkoutBusy
                      ? "Opening checkout…"
                      : `Upgrade to Investor — $${
                          billing?.limits?.investorPriceUsd ?? 19
                        }/mo`}
                  </button>
                ))}
              {paywall === "quota" && (
                <button
                  onClick={openPortal}
                  className="cursor-pointer rounded-[7px] border border-input-border bg-paper px-4 py-[9px] text-[13px] font-semibold text-ink hover:border-ink"
                >
                  Manage billing
                </button>
              )}
              <button
                onClick={() => setPaywall(null)}
                className="cursor-pointer px-2 py-[9px] text-[12.5px] font-semibold text-label hover:text-ink"
              >
                Not now
              </button>
            </div>
          </div>
        )}

        {phase === "empty" && (
          <section className="flex flex-col gap-[34px]">
            <div className="flex flex-col gap-4 border-b border-border pb-[26px]">
              <h1 className="text-[56px] font-extrabold leading-none tracking-[-.04em] max-md:text-[38px]">
                Does it pencil?
              </h1>
              <span className="block h-[5px] w-[132px] rounded-[3px] bg-pencil" />
              <p className="max-w-[60ch] text-[17px] leading-[1.6] text-body [text-wrap:pretty]">
                PropPencil turns any property into an investor-ready deal
                analysis. Enter an address and see estimated value, rent, cash
                flow, expenses, returns and risk — then decide whether the deal
                actually works.
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <a
                  href="/#score"
                  className="cursor-pointer rounded-[8px] bg-ink px-[22px] py-[13px] text-[14px] font-bold text-on-dark hover:bg-[#333]"
                >
                  See a sample analysis
                </a>
                <span className="text-[13px] text-label">
                  or enter any address in the sidebar to pencil it
                </span>
              </div>
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(290px,1fr))] gap-x-10 gap-y-7">
              <div className="flex flex-col">
                <h2 className="mb-[6px] border-b border-ink pb-[9px] text-[19px] font-bold tracking-[-.02em]">
                  Every screen answers one question
                </h2>
                {[
                  ["What is it worth to you?", "An investor value from the property's own economics, not a Zestimate."],
                  ["What will it earn and cost?", "Rent, expenses and financing across three tenant strategies."],
                  ["What could go wrong?", "The specific assumptions that would break the deal, quantified."],
                  ["What price should you pay?", "A maximum buy price tied to the return you actually require."],
                ].map(([title, body], i, arr) => (
                  <div
                    key={title}
                    className={`flex gap-[13px] py-[13px] ${i < arr.length - 1 ? "border-b border-rule" : ""}`}
                  >
                    <span className="w-5 shrink-0 text-[15px] font-extrabold text-pencil">
                      0{i + 1}
                    </span>
                    <div className="flex flex-col gap-[2px]">
                      <span className="text-[13.5px] font-bold">{title}</span>
                      <span className="text-[12.5px] leading-[1.5] text-label">{body}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-col">
                <h2 className="mb-[6px] border-b border-ink pb-[9px] text-[19px] font-bold tracking-[-.02em]">
                  The Pencil Score
                </h2>
                <p className="my-3 text-[13.5px] leading-[1.6] text-body">
                  One number from zero to a hundred, weighted across cash flow,
                  cash-on-cash, cap rate, debt coverage and price against
                  investor value. Never a black box — every analysis shows what
                  moved the score and by how much.
                </p>
                {PENCIL_TIERS.map((t) => (
                  <div
                    key={t.label}
                    className="flex items-center justify-between gap-3 border-b border-rule py-[9px]"
                  >
                    <TierBadge tier={t} />
                    <span className="text-[12.5px] font-semibold text-body tabular-nums">
                      {t.min === -Infinity
                        ? "below 50"
                        : t.min === 90
                          ? "90 and up"
                          : `${t.min}–${t.min + 9}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {phase === "loading" && (
          <section className="flex flex-col gap-[26px]">
            <div className="flex flex-col gap-[10px] border-b border-ink pb-[18px]">
              <Eyebrow>Penciling the deal</Eyebrow>
              <h2 className="text-[30px] font-extrabold leading-[1.15] tracking-[-.03em] max-md:text-[24px]">
                {address}
              </h2>
            </div>
            <div className="flex max-w-[580px] flex-col">
              {steps.map((s, i) => {
                const done = loadStep > i;
                const act = loadStep === i;
                return (
                  <div key={s.label} className="flex items-center gap-3 border-b border-rule py-[10px]">
                    <span
                      className={`h-4 w-4 shrink-0 rounded-full ${act ? "animate-step-pulse" : ""}`}
                      style={{
                        border: `1.5px solid ${!s.on ? "#ddd6c6" : done ? "#0f6b44" : act ? "#171717" : "#ddd6c6"}`,
                        background: !s.on ? "transparent" : done ? "#0f6b44" : act ? "#f4c542" : "transparent",
                      }}
                    />
                    <span
                      className="text-[13.5px] font-medium"
                      style={{ color: !s.on ? "#8a8780" : "#171717" }}
                    >
                      {s.label}
                    </span>
                    <span className="ml-auto text-[12px] text-label">
                      {!s.on ? "skipped · no key" : done ? `${s.src} ✓` : act ? "working…" : s.src}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex max-w-[580px] flex-col gap-3">
              <div className="h-[14px] w-[68%] rounded-[4px] bg-skeleton" />
              <div className="h-[14px] w-[90%] rounded-[4px] bg-skeleton" />
              <div className="h-[14px] w-[52%] rounded-[4px] bg-skeleton" />
            </div>
          </section>
        )}

        {phase === "results" && data && assumptionsFull && (
          <section className="flex flex-col gap-[34px]">
            <header className="flex flex-wrap items-end justify-between gap-4 border-b border-ink pb-4">
              <div className="flex flex-col gap-[6px]">
                <Eyebrow>Penciled {dealDate}</Eyebrow>
                <h2 className="text-[32px] font-extrabold leading-[1.1] tracking-[-.032em] max-md:text-[24px]">
                  {data.property.matchedAddress}
                </h2>
                <span className="text-[13px] text-label">{subhead}</span>
                {data.factsProvenance && (
                  <span className="inline-flex w-fit items-center gap-[6px] rounded-[5px] border border-[#cfe3d4] bg-[#eef6f0] px-[9px] py-[3px] text-[11.5px] font-semibold text-[#0f6b44]">
                    ✓ Facts from public record — {data.factsProvenance}
                  </span>
                )}
                {autoFilled && (
                  <span className="text-[12px] font-medium text-positive">✓ {autoFilled}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-[9px]">
                <button
                  onClick={saveSearch}
                  className={justSaved ? `${OUTLINE_BTN} border-positive text-positive` : OUTLINE_BTN}
                >
                  {justSaved ? "Saved ✓" : "Save to My Pencils"}
                </button>
                <button onClick={() => window.print()} className={OUTLINE_BTN}>
                  Export
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(window.location.href).catch(() => {});
                  }}
                  className={OUTLINE_BTN}
                  title="Copies the app link — your partner signs in and loads the same pencil"
                >
                  Share with partner
                </button>
                <button
                  onClick={startOver}
                  className={OUTLINE_BTN}
                  title="Clear this analysis and return to the start screen (My Pencils and the map are kept)"
                >
                  Start over
                </button>
              </div>
            </header>

            {hudMissing && (
              <div className="flex gap-[13px] rounded-[8px] border border-[#f0dba8] border-l-4 border-l-warn bg-accent-tint px-4 py-[14px]">
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] font-bold text-warn-ink">
                    No HUD data — the Section 8 strategy can&apos;t be penciled.
                  </span>
                  <p className="m-0 max-w-[78ch] text-[13px] leading-[1.6] text-warn-ink">
                    {data.attom?.rentalAvm != null
                      ? "Fair Market Rent data wasn't available for this area, so the voucher strategy is skipped. The traditional rental is unaffected — it uses the property's rent estimate."
                      : "Fair Market Rent data wasn't available for this area, and no rent estimate came back either. Enter a local comp under Market rent override to pencil this one."}
                  </p>
                </div>
              </div>
            )}

            {mvMissing && (
              <div className="flex gap-[13px] rounded-[8px] border border-[#e0dacd] border-l-4 border-l-label bg-[#f4f2ec] px-4 py-[14px]">
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] font-bold text-body">
                    Short-term rental data wasn&apos;t available — that
                    strategy is skipped.
                  </span>
                  <p className="m-0 max-w-[78ch] text-[13px] leading-[1.6] text-body">
                    Without occupancy and nightly-rate data there is no honest
                    short-term number to pencil. The long-term strategies
                    below are unaffected.
                  </p>
                </div>
              </div>
            )}

            {data.attomError && (
              <div className="flex gap-[13px] rounded-[8px] border border-[#e0dacd] border-l-4 border-l-label bg-[#f4f2ec] px-4 py-[14px]">
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] font-bold text-body">
                    This parcel&apos;s detailed records weren&apos;t
                    available — estimates use county-level data.
                  </span>
                  <p className="m-0 max-w-[78ch] text-[13px] leading-[1.6] text-body">
                    The tax line uses the county median instead of this
                    parcel&apos;s actual bill, and market rent leans on
                    public rent data. The confidence rows below reflect this.
                  </p>
                </div>
              </div>
            )}

            {active && verdict && (
              <section className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-start gap-x-11 gap-y-[30px]">
                <div className="flex flex-col gap-[14px]">
                  <Eyebrow>Pencil Score</Eyebrow>
                  <div className="flex flex-wrap items-end gap-[18px]">
                    <div className="flex flex-col gap-[6px]">
                      <div className="flex items-baseline gap-1">
                        <span className="text-[84px] font-extrabold leading-[.86] tracking-[-.05em] text-ink tabular-nums max-md:text-[64px]">
                          {score}
                        </span>
                        <span className="text-[22px] font-semibold text-label">/100</span>
                      </div>
                      <span
                        className="block h-[5px] rounded-[3px] bg-pencil"
                        style={{ width: `${Math.max(8, score)}%` }}
                      />
                    </div>
                    <span
                      className="flex-none whitespace-nowrap rounded-[7px] px-[14px] py-[7px] text-[14px] font-extrabold tracking-[-.01em]"
                      style={{ backgroundColor: tier.bg, color: tier.fg, minWidth: "fit-content" }}
                    >
                      {tier.label}
                    </span>
                  </div>
                  <p className="m-0 max-w-[46ch] text-[17px] font-semibold leading-[1.55] text-ink [text-wrap:pretty]">
                    {verdict.line}
                  </p>
                  <p className="m-0 max-w-[58ch] text-[13.5px] leading-[1.6] text-body [text-wrap:pretty]">
                    {verdict.detail}
                  </p>
                  <div className="flex flex-col gap-[7px] border-t border-rule pt-[13px]">
                    <span className="text-[10.5px] font-bold uppercase tracking-[.1em] text-label">
                      What moved the score
                    </span>
                    {parts.map((p) => (
                      <div key={p.key} className="flex items-center gap-[11px]">
                        <span className="w-[132px] shrink-0 text-[12px] text-body">{p.label}</span>
                        <span className="h-[7px] min-w-[40px] flex-1 overflow-hidden rounded-[4px] bg-bar-track">
                          <span
                            className="block h-full"
                            style={{
                              width: `${Math.max(2, p.frac * 100).toFixed(0)}%`,
                              background: p.frac >= 0.66 ? "#0f6b44" : p.frac >= 0.33 ? "#8a6410" : "#a8281e",
                            }}
                          />
                        </span>
                        <span className="w-[78px] shrink-0 text-right text-[11.5px] font-semibold text-body tabular-nums">
                          {p.value}
                        </span>
                        <span className="w-[52px] shrink-0 text-right text-[11px] text-label tabular-nums">
                          {(p.frac * p.weight).toFixed(0)}/{p.weight}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-px overflow-hidden rounded-[10px] border border-border bg-border">
                  <div className="flex flex-col gap-[3px] bg-card px-[18px] py-4">
                    <span className="text-[10.5px] font-bold uppercase tracking-[.1em] text-label">
                      Investor value
                    </span>
                    <span className="text-[28px] font-extrabold tracking-[-.03em] tabular-nums">
                      {iv > 0 ? usdWhole(iv) : "—"}
                    </span>
                    <span className="text-[12px] text-label">
                      What the income supports at {targetCoc}% ·{" "}
                      {DISPLAY_LABEL[active.key].toLowerCase()}
                    </span>
                  </div>
                  <div className="flex flex-col gap-[3px] bg-card px-[18px] py-4">
                    <span className="text-[10.5px] font-bold uppercase tracking-[.1em] text-label">
                      Asking price
                    </span>
                    <span className="text-[28px] font-extrabold tracking-[-.03em] tabular-nums">
                      {usdWhole(assumptionsFull.price)}
                    </span>
                    <span
                      className="text-[12px] font-semibold"
                      style={{ color: verdict.gap > 0 ? "#a8281e" : "#0f6b44" }}
                    >
                      {verdict.gap > 0
                        ? `${usdWhole(verdict.gap)} above your investor value`
                        : `${usdWhole(-verdict.gap)} below your investor value`}
                    </span>
                  </div>
                  <div className="flex flex-col gap-[3px] bg-card px-[18px] py-4">
                    <span className="text-[10.5px] font-bold uppercase tracking-[.1em] text-label">
                      Monthly cash flow
                    </span>
                    <span
                      className={`text-[28px] font-extrabold tracking-[-.03em] tabular-nums ${cfClass(active.s.monthlyCashFlow)}`}
                    >
                      {signedUsd(active.s.monthlyCashFlow)}/mo
                    </span>
                    <span className="text-[12px] text-label">
                      Penciling {DISPLAY_LABEL[active.key].toLowerCase()}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 bg-card px-[18px] py-4">
                    <div className="flex flex-col gap-[2px]">
                      <span className="flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[.08em] text-label">
                        Cash-on-cash
                        <InfoTip text="A year of cash flow divided by the cash you actually put in — down payment, closing costs and rehab." />
                      </span>
                      <span className="text-[17px] font-bold tabular-nums">
                        {pct1(active.s.cashOnCashPct)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-[2px]">
                      <span className="flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[.08em] text-label">
                        Cap rate
                        <InfoTip text="Capitalization rate: a year of income after operating expenses, divided by the purchase price. Ignores the mortgage, so it compares houses rather than loans." />
                      </span>
                      <span className="text-[17px] font-bold tabular-nums">
                        {pct1(active.s.capRatePct)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-[2px]">
                      <span className="flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[.08em] text-label">
                        Debt coverage
                        <InfoTip text="DSCR: yearly income after operating expenses divided by the yearly mortgage payment. Above 1.25 is what most lenders want to see." />
                      </span>
                      <span className="text-[17px] font-bold tabular-nums">
                        {Number.isFinite(dscrOf(active.s)) ? dscrOf(active.s).toFixed(2) + "x" : "—"}
                      </span>
                    </div>
                    <div className="flex flex-col gap-[2px]">
                      <span className="flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[.08em] text-label">
                        Data confidence
                        <InfoTip text="How much of the analysis rests on directly sourced data rather than inferred estimates." />
                      </span>
                      <span className="text-[17px] font-bold tabular-nums">
                        {confidence ? `${confidence.pct}%` : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {(wr.why.length > 0 || wr.risks.length > 0) && (
              <section className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-x-10 gap-y-[26px]">
                <div className="flex flex-col">
                  <h3 className="mb-1 border-b border-ink pb-[9px] text-[19px] font-bold tracking-[-.02em]">
                    Why it pencils
                  </h3>
                  {wr.why.map((w) => (
                    <div key={w.title} className="flex gap-[11px] border-b border-rule py-3">
                      <span className="shrink-0 text-[14px] font-extrabold leading-[1.35] text-positive">✓</span>
                      <div className="flex flex-col gap-[2px]">
                        <span className="text-[13.5px] font-semibold">{w.title}</span>
                        <span className="text-[12.5px] leading-[1.55] text-label">{w.detail}</span>
                      </div>
                    </div>
                  ))}
                  {wr.why.length === 0 && (
                    <p className="py-3 text-[13px] text-label">
                      Nothing clears its bar at this price — see the risks and
                      the price panel below.
                    </p>
                  )}
                </div>
                <div className="flex flex-col">
                  <h3 className="mb-1 border-b border-ink pb-[9px] text-[19px] font-bold tracking-[-.02em]">
                    What could break the pencil
                  </h3>
                  {wr.risks.map((r) => (
                    <div key={r.title} className="flex gap-[11px] border-b border-rule py-3">
                      <span className="shrink-0 text-[13px] font-extrabold leading-[1.45] text-warn">⚠</span>
                      <div className="flex flex-col gap-[2px]">
                        <span className="text-[13.5px] font-semibold">{r.title}</span>
                        <span className="text-[12.5px] leading-[1.55] text-label">{r.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {active && verdict && (
              <section className="flex flex-col gap-4 rounded-[12px] bg-ink-panel px-7 py-[26px] max-md:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="text-[22px] font-extrabold tracking-[-.028em] text-on-dark">
                    What should you pay?
                  </h3>
                  <span className="text-[12.5px] text-on-dark-dim">
                    At a required {targetCoc}% cash-on-cash, penciling the{" "}
                    {DISPLAY_LABEL[active.key].toLowerCase()} strategy
                  </span>
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-[22px]">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10.5px] font-bold uppercase tracking-[.1em] text-on-dark-dim">
                      Asking price
                    </span>
                    <span className="text-[30px] font-extrabold tracking-[-.03em] text-on-dark tabular-nums">
                      {usdWhole(assumptionsFull.price)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10.5px] font-bold uppercase tracking-[.1em] text-pencil">
                      Maximum buy price
                    </span>
                    <span className="text-[30px] font-extrabold tracking-[-.03em] text-pencil tabular-nums">
                      {iv > 0 ? usdWhole(iv) : "—"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10.5px] font-bold uppercase tracking-[.1em] text-on-dark-dim">
                      {verdict.gap > 0 ? "Above target" : "Room below target"}
                    </span>
                    <span
                      className="text-[30px] font-extrabold tracking-[-.03em] tabular-nums"
                      style={{ color: verdict.gap > 0 ? "#ff9d8f" : "#7ddba8" }}
                    >
                      {usdWhole(Math.abs(verdict.gap))}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-[9px] border-t border-[#3a3a37] pt-4">
                  <span className="text-[15px] font-bold text-on-dark">
                    {verdict.recommendation}
                  </span>
                  <p className="m-0 max-w-[82ch] text-[13px] leading-[1.6] text-on-dark-dim">
                    {verdict.recommendationDetail}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-[10px] border-t border-[#3a3a37] pt-4">
                  <span className="text-[12.5px] text-on-dark-dim">
                    Change the return you require in{" "}
                    <b className="font-bold text-on-dark">Sharpen the Pencil</b>{" "}
                    and this price moves with it.
                  </span>
                </div>
              </section>
            )}

            <section className="flex flex-col gap-2 border-y border-rule py-3">
              <span className="flex items-center text-[10.5px] font-bold uppercase tracking-[.12em] text-label">
                Quick adjustments — every number recomputes instantly
                <InfoTip text="Change a value here or in Sharpen the Pencil and the whole brief — score, verdict, investor value, offer prices, stress test — recalculates immediately, no re-query. The full set of assumptions (closing costs, rehab, CapEx, floors, appreciation and more) is in the sidebar." />
              </span>
              <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
                {(
                  [
                    ["Interest rate", "interestRatePct", "%", 0.125],
                    ["Down payment", "downPaymentPct", "%", 5],
                    ["Closing costs", "closingCostPct", "%", 0.5],
                    ["Management", "managementPct", "% (0 = self-manage)", 1],
                    ["Payment standard", "paymentStandardPct", "% of FMR", 5],
                    ["Required return", "targetCocPct", "% cash-on-cash", 0.5],
                  ] as const
                ).map(([labelText, key, unit, step]) => (
                  <label key={key} className="flex flex-col gap-[3px]">
                    <span className="text-[11px] text-label">{labelText}</span>
                    <span className="flex items-center gap-1">
                      <input
                        type="number"
                        step={step}
                        value={adv[key]}
                        onChange={(e) =>
                          setA(key, e.target.value === "" ? 0 : Number(e.target.value))
                        }
                        className="w-[64px] rounded-[5px] border border-input-border bg-card px-[6px] py-1 text-right text-[12.5px] font-semibold text-ink outline-none tabular-nums focus:border-ink"
                      />
                      <span className="text-[10.5px] text-label">{unit}</span>
                    </span>
                  </label>
                ))}
                <label className="flex flex-col gap-[3px]">
                  <span className="text-[11px] text-label">Rent override</span>
                  <span className="flex items-center gap-1">
                    <input
                      type="number"
                      step={25}
                      placeholder="auto"
                      value={adv.marketRentOverride ?? ""}
                      onChange={(e) =>
                        setA(
                          "marketRentOverride",
                          e.target.value === "" ? null : Number(e.target.value)
                        )
                      }
                      className="w-[72px] rounded-[5px] border border-input-border bg-card px-[6px] py-1 text-right text-[12.5px] font-semibold text-ink outline-none tabular-nums focus:border-ink"
                    />
                    <span className="text-[10.5px] text-label">$/mo</span>
                  </span>
                </label>
              </div>
            </section>

            {offers && offers.length > 0 && (
              <section className="flex flex-col">
                <SectionHead
                  title="What to offer, by sharpness"
                  caption="Highest price that still earns each sharpness tier — rent estimates held constant"
                />
                <div className="flex flex-col">
                  {offers.map((o) => {
                    const scenario = ranked.find((r) => r.key === o.key);
                    if (!scenario) return null;
                    return (
                      <div
                        key={o.key}
                        className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-rule py-[11px]"
                      >
                        <span className="w-[150px] text-[14px] font-bold">
                          {DISPLAY_LABEL[o.key]}
                        </span>
                        {(["Rare", "Fantastic", "Great", "Good"] as Rating[]).map((tr) => {
                          const p = o.byTier[tr];
                          const achievedNow = scenario.s.rating === tr;
                          return (
                            <span
                              key={tr}
                              className={`rounded-[5px] border px-2 py-[3px] text-[11.5px] tabular-nums ${achievedNow ? "font-bold" : ""}`}
                              style={{
                                borderColor: RATING_COLORS[tr],
                                color: p == null ? "#8a8780" : RATING_COLORS[tr],
                                background: achievedNow ? "rgba(244,197,66,.12)" : "transparent",
                                borderStyle: p == null ? "dashed" : "solid",
                              }}
                              title={
                                p == null
                                  ? `${LEGACY_RATING_LABEL[tr]} is out of reach at any realistic price with these rents and expenses.`
                                  : p >= o.ceiling
                                    ? `${LEGACY_RATING_LABEL[tr]} holds even past ${usdWhole(o.ceiling)}.`
                                    : `Offer at or below ${usdWhole(p)} and this strategy rates ${LEGACY_RATING_LABEL[tr]} on the sharpness thresholds.`
                              }
                            >
                              {LEGACY_RATING_LABEL[tr]}{" "}
                              {p == null
                                ? "out of reach"
                                : p >= o.ceiling
                                  ? "at any price"
                                  : `≤ ${usdWhole(p)}`}
                            </span>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11.5px] leading-[1.6] text-label">
                  Sharpness tiers read fixed bars (Razor Sharp ≥ $400/mo cash
                  flow · ≥12% cash-on-cash · ≥8% cap rate, and so on down to
                  Broken) and complement the Pencil Score&apos;s Maximum Buy
                  Price above: that answers &ldquo;what price hits my required
                  return&rdquo;, these answer &ldquo;what price hits each
                  sharpness&rdquo;.
                </p>
              </section>
            )}

            {data.marketHealth && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 border-y border-rule py-3 text-[13px]">
                <span className="font-bold">
                  Market health ({data.marketHealth.countyName})
                  <InfoTip text="County trajectory: 5-year change from Census ACS plus BLS unemployment. Shrinking population is the classic risk hiding behind cheap, high-cash-flow markets — rents and values erode and vacancies stretch." />
                </span>
                {data.marketHealth.populationChangePct5yr != null && (
                  <span className={data.marketHealth.populationChangePct5yr < 0 ? "text-negative" : ""}>
                    Population{" "}
                    <b className="tabular-nums">
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
                    <b className="tabular-nums">
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
                  <span className={data.marketHealth.unemploymentPct >= 7 ? "text-negative" : ""}>
                    Unemployment{" "}
                    <b className="tabular-nums">{data.marketHealth.unemploymentPct.toFixed(1)}%</b>
                    {data.marketHealth.unemploymentAsOf && (
                      <span className="text-label"> ({data.marketHealth.unemploymentAsOf})</span>
                    )}
                  </span>
                )}
              </div>
            )}

            <section className="flex flex-col">
              <SectionHead
                title="Which strategy pencils best"
                caption="Monthly, after mortgage, taxes, insurance, reserves, management and empty months"
              />
              {ranked.length === 0 && (
                <p className="max-w-[64ch] py-[18px] text-[14.5px] leading-[1.6] text-body">
                  Nothing can be penciled without a rent source. Switch a data
                  source back on, or enter a market rent under{" "}
                  <b className="font-bold">Market rent override</b>.
                </p>
              )}
              {ranked.map((r) => {
                const s = r.s;
                const a = assumptionsFull;
                const bScore = scoreInputs ? pencilScore(s, scoreInputs) : 0;
                const bTier = tierForScore(bScore);
                const outflow = s.expenses.totalMonthly + s.monthlyPI;
                const t = outflow || 1;
                const insMaintCapex =
                  s.expenses.insurance + s.expenses.maintenance + s.expenses.capex;
                const dscr = dscrOf(s);
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
                            ? ` · ${Math.round(data.mashvisor.str.occupancyPct)}% occupancy`
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
                    <div className="flex flex-col gap-[7px]">
                      <div className="flex flex-wrap items-baseline gap-[9px]">
                        <span className="text-[30px] font-extrabold leading-none tracking-[-.04em] tabular-nums">
                          {bScore}
                        </span>
                        <TierBadge tier={bTier} />
                      </div>
                      <h4 className="text-[16px] font-bold tracking-[-.018em]">
                        {DISPLAY_LABEL[r.key]}
                      </h4>
                      <span className="text-[12px] leading-[1.5] text-label">{sub}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-[5px]">
                        <LegacyBadge rating={s.rating} />
                        {s.ratingDetail.almost && <AlmostChip almost={s.ratingDetail.almost} />}
                      </span>
                      <WhyRating s={s} units={a.units} />
                    </div>
                    <div className="flex flex-col gap-[13px]">
                      <div className="flex flex-col gap-[3px]">
                        <span className="text-[10.5px] font-bold uppercase tracking-[.09em] text-label">
                          Monthly cash flow, after the mortgage
                        </span>
                        <span
                          className={`text-[30px] font-extrabold leading-none tracking-[-.032em] tabular-nums ${cfClass(s.monthlyCashFlow)}`}
                        >
                          {signedUsd(s.monthlyCashFlow)}/mo
                        </span>
                      </div>
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(92px,1fr))] gap-x-[14px] gap-y-[11px]">
                        <Metric
                          label={r.key === "str" ? "Revenue" : "Rent"}
                          value={`${usdWhole(s.monthlyRent)}/mo`}
                          tip={
                            r.key === "str"
                              ? "Nightly rate multiplied by nights booked, already adjusted for the area's typical occupancy — not a full-occupancy fantasy."
                              : "What the tenant pays each month, before any expense comes out of it."
                          }
                        />
                        <Metric
                          label="Cash-on-cash"
                          value={pct1(s.cashOnCashPct)}
                          tip="A year of cash flow divided by the cash you actually put in — down payment, closing costs and rehab."
                        />
                        <Metric
                          label="Cap rate"
                          value={pct1(s.capRatePct)}
                          tip="Capitalization rate: a year of income after operating expenses, divided by the purchase price. Ignores the mortgage."
                        />
                        <Metric
                          label="Debt coverage"
                          value={Number.isFinite(dscr) ? dscr.toFixed(2) + "x" : "—"}
                          tip="DSCR: yearly income after operating expenses divided by the yearly mortgage payment. Above 1.25 is what most lenders want to see."
                        />
                        <Metric
                          label="Net income, yr"
                          value={usdWhole(s.noi)}
                          tip="Net operating income: a year of rent minus operating expenses — taxes, insurance, reserves, management, empty months — before any mortgage payment."
                        />
                        <Metric
                          label="Cash invested"
                          value={usdWhole(s.cashInvested)}
                          tip="Down payment plus closing costs plus rehab budget — the money that actually leaves your account."
                        />
                        <Metric
                          label="Gross rent multiple"
                          value={s.grm.toFixed(1)}
                          tip="Purchase price divided by one year of rent. Lower is cheaper: 4 means a year's rent covers a quarter of the price."
                        />
                      </div>
                      <div className="flex flex-col gap-[5px]">
                        <div className="flex h-2 overflow-hidden rounded-[4px] bg-bar-track">
                          <span style={{ width: `${((s.monthlyPI / t) * 100).toFixed(1)}%`, background: "#171717" }} />
                          <span style={{ width: `${((s.expenses.taxes / t) * 100).toFixed(1)}%`, background: "#4a4a46" }} />
                          <span style={{ width: `${((insMaintCapex / t) * 100).toFixed(1)}%`, background: "#7a7a73" }} />
                          <span style={{ width: `${((s.expenses.management / t) * 100).toFixed(1)}%`, background: "#b0aa9a" }} />
                          <span style={{ width: `${(((s.expenses.vacancy + s.expenses.other) / t) * 100).toFixed(1)}%`, background: "#f4c542" }} />
                        </div>
                        <span className="text-[11.5px] leading-[1.5] text-label">
                          {usdWhole(outflow)} out: mortgage {usdWhole(s.monthlyPI)} · tax{" "}
                          {usdWhole(s.expenses.taxes)} · insurance, maintenance and CapEx{" "}
                          <InfoTip text={CAPEX_TIP} />{" "}
                          {usdWhole(insMaintCapex)} · management {usdWhole(s.expenses.management)} ·{" "}
                          {r.key === "str"
                            ? `utilities ${usdWhole(s.expenses.other)}`
                            : `empty months ${usdWhole(s.expenses.vacancy)}`}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <p className="m-0 text-[13px] leading-[1.6] text-body">
                        {bandNote(r.key, scenarios!, a, data.mashvisor?.str?.occupancyPct)}
                      </p>
                      {r.key === "market" && scenarios!.marketRentSource === "FMR" && (
                        <p className="m-0 text-[11.5px] leading-[1.6] text-label">
                          Rent here is the area-wide HUD Fair Market Rent, not an
                          estimate for this specific property. In cheaper
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
                            above what local units actually rent for. This is the
                            conservative estimate; verify with local comps.
                          </p>
                        )}
                      {s8AboveMarket && (
                        <p className="m-0 rounded-[8px] border border-[#f0dba8] border-l-4 border-l-warn bg-accent-tint px-3 py-2 text-[12.5px] leading-[1.6] text-warn-ink">
                          <b className="font-bold">
                            Heads up: this assumes {usdWhole(s.monthlyRent)}/mo —
                            above the estimated market rent of{" "}
                            {usdWhole(scenarios!.market!.monthlyRent)}/mo.
                          </b>{" "}
                          Housing authorities run a &ldquo;rent
                          reasonableness&rdquo; check and won&apos;t approve rent
                          above comparable unassisted units. Call{" "}
                          {cityLabel ? `the ${cityLabel} housing authority` : "the local housing authority"}{" "}
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
                          ), or lower the payment standard % for the conservative
                          case.
                        </p>
                      )}
                      {r.key === "s8" && (
                        <details className="text-[12.5px]">
                          <summary className="cursor-pointer text-label">
                            How the Section 8 numbers work
                          </summary>
                          <div className="mt-2 flex flex-col gap-2 text-[12px] leading-[1.6] text-body">
                            <p>
                              HUD publishes a <b>Fair Market Rent (FMR)</b> for
                              every area — the 40th-percentile gross rent, i.e.
                              what the cheaper 40% of decent units rent for
                              (ZIP-level &ldquo;Small Area&rdquo; FMR where
                              available). The local housing authority (PHA) sets
                              a <b>payment standard</b> between 90% and 120% of
                              FMR — this strategy assumes{" "}
                              <b>{a.paymentStandardPct}%</b>. The voucher covers
                              the gap between the tenant&apos;s ~30% income
                              contribution and the approved rent, paid directly
                              to you.
                            </p>
                            <p>
                              Empty months default to 2% (vs 5% market) because
                              the voucher portion keeps paying while a tenant
                              stays, and demand for voucher-ready units is deep.
                              Offsets: annual PHA inspections, and initial
                              lease-up takes longer.
                            </p>
                            <p>
                              <b>The number to verify:</b> the PHA won&apos;t
                              approve rent above comparable unassisted units
                              nearby (&ldquo;rent reasonableness&rdquo;). Call{" "}
                              {cityLabel ? `the ${cityLabel} housing authority` : "the local housing authority"}{" "}
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
                <div className="overflow-x-auto">
                  <div className="grid min-w-[560px] grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
                    <span className="border-b border-rule py-[10px]" />
                    {(["Traditional", "Section 8", "Short-term"] as const).map((h, i) => (
                      <span
                        key={h}
                        className={`border-b border-rule py-[10px] text-right text-[12.5px] font-semibold ${i === 2 ? "pl-3" : "px-3"}`}
                      >
                        {h}
                      </span>
                    ))}
                    {(() => {
                      const a = assumptionsFull;
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
                            className={`py-[9px] text-right text-[13px] tabular-nums ${i === 2 ? "pl-3" : "px-3"} ${
                              opts?.emphasis
                                ? "border-b border-ink py-3 text-[15px] font-bold"
                                : opts?.last
                                  ? ""
                                  : "border-b border-rule"
                            }`}
                          >
                            {s ? fn(s, i === 2) : <span className="text-label">—</span>}
                          </span>
                        ));
                      const label = (
                        text: string,
                        opts?: { title?: string; last?: boolean }
                      ) => (
                        <span
                          title={opts?.title}
                          className={`py-[9px] text-[13px] text-body ${opts?.title ? "cursor-help" : ""} ${opts?.last ? "" : "border-b border-rule"}`}
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
                            usdWhole(s.expenses.taxes + s.expenses.insurance + s.expenses.maintenance)
                          )}
                          {label("CapEx reserve", {
                            title: CAPEX_TIP,
                          })}
                          {cells((s) => usdWhole(s.expenses.capex))}
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
                          <span className="border-y border-ink py-3 text-[13.5px] font-bold">
                            Cash flow after the mortgage
                          </span>
                          {cols.map((s, i) => (
                            <span
                              key={i}
                              className={`border-y border-ink py-3 text-right text-[15px] font-bold tabular-nums ${i === 2 ? "pl-3" : "px-3"} ${s ? cfClass(s.monthlyCashFlow) : "text-label"}`}
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
                          {label("Debt coverage (DSCR)", {
                            title:
                              "Yearly income after operating expenses divided by the yearly mortgage payment. Above 1.25 is what most lenders want to see.",
                          })}
                          {cells((s) => {
                            const d = dscrOf(s);
                            return Number.isFinite(d) ? d.toFixed(2) + "x" : "—";
                          })}
                          {label("Net income, yearly", {
                            title:
                              "Net operating income: a year of rent minus operating expenses, before any mortgage payment.",
                          })}
                          {cells((s) => usdWhole(s.noi))}
                          {label("Gross rent multiple", {
                            title:
                              "Purchase price divided by one year of rent. Lower is cheaper.",
                            last: true,
                          })}
                          {cells((s) => s.grm.toFixed(1), { last: true })}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </section>
            )}

            {active && (
              <section className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-x-10 gap-y-7">
                <div className="flex flex-col">
                  <div className="flex flex-wrap items-baseline justify-between gap-[10px] border-b border-ink pb-[9px]">
                    <h3 className="text-[19px] font-bold tracking-[-.02em]">Show your work</h3>
                    {strategyTabs}
                  </div>
                  <span className="pb-[2px] pt-[10px] text-[11.5px] text-label">
                    Net operating income for the {DISPLAY_LABEL[active.key].toLowerCase()}{" "}
                    strategy, before any mortgage payment.
                  </span>
                  {(() => {
                    const s = active.s;
                    const a = assumptionsFull;
                    const gross = s.monthlyRent + a.otherMonthlyIncome;
                    const rows: [string, string, { bold?: boolean; neg?: boolean; inkRule?: boolean }][] = [
                      ["Gross potential rent", usdWhole(s.monthlyRent * 12), {}],
                      [
                        "Other income",
                        a.otherMonthlyIncome ? "+" + usdWhole(a.otherMonthlyIncome * 12) : usdWhole(0),
                        {},
                      ],
                      [
                        "Empty months and credit loss",
                        "−" + usdWhole(s.expenses.vacancy * 12),
                        { neg: true },
                      ],
                      [
                        "Effective gross income",
                        usdWhole((gross - s.expenses.vacancy) * 12),
                        { bold: true, inkRule: true },
                      ],
                      ["Property taxes", "−" + usdWhole(s.expenses.taxes * 12), { neg: true }],
                      ["Insurance", "−" + usdWhole(s.expenses.insurance * 12), { neg: true }],
                      ["Maintenance", "−" + usdWhole(s.expenses.maintenance * 12), { neg: true }],
                      ["CapEx reserve", "−" + usdWhole(s.expenses.capex * 12), { neg: true }],
                      ["Management", "−" + usdWhole(s.expenses.management * 12), { neg: true }],
                      [
                        active.key === "str" ? "Utilities and supplies" : "Other expenses",
                        s.expenses.other ? "−" + usdWhole(s.expenses.other * 12) : usdWhole(0),
                        { neg: s.expenses.other > 0 },
                      ],
                    ];
                    return (
                      <>
                        {rows.map(([labelText, value, o]) => (
                          <div
                            key={labelText}
                            className={`flex items-baseline justify-between gap-[14px] py-2 ${
                              o.inkRule ? "border-b border-ink" : "border-b border-rule"
                            }`}
                          >
                            <span className={`flex items-center text-[13px] ${o.bold ? "font-bold text-ink" : "text-body"}`}>
                              {labelText}
                              {labelText === "CapEx reserve" && <InfoTip text={CAPEX_TIP} />}
                            </span>
                            <span
                              className={`text-[13.5px] tabular-nums ${o.bold ? "font-bold" : ""} ${o.neg ? "text-negative" : "text-ink"}`}
                            >
                              {value}
                            </span>
                          </div>
                        ))}
                        <div className="flex items-baseline justify-between gap-[14px] border-b border-ink py-[11px]">
                          <span className="text-[13.5px] font-extrabold">Net operating income</span>
                          <span className="text-[17px] font-extrabold tabular-nums">
                            {usdWhole(active.s.noi)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-[14px] border-b border-rule py-2">
                          <span className="text-[13px] text-body">Mortgage, yearly</span>
                          <span className="text-[13.5px] text-negative tabular-nums">
                            −{usdWhole(active.s.monthlyPI * 12)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-[14px] py-[11px]">
                          <span className="text-[13.5px] font-extrabold">Cash flow, yearly</span>
                          <span
                            className={`text-[17px] font-extrabold tabular-nums ${cfClass(active.s.monthlyCashFlow)}`}
                          >
                            {signedUsd(active.s.monthlyCashFlow * 12)}
                          </span>
                        </div>
                      </>
                    );
                  })()}
                </div>

                {confidence && (
                  <div className="flex flex-col">
                    <div className="flex flex-wrap items-baseline justify-between gap-[10px] border-b border-ink pb-[9px]">
                      <h3 className="text-[19px] font-bold tracking-[-.02em]">
                        Where each number came from
                      </h3>
                      <span className="text-[12px] font-bold" style={{ color: confidence.color }}>
                        {confidence.label}
                      </span>
                    </div>
                    <span className="pb-[6px] pt-[10px] text-[11.5px] leading-[1.55] text-label">
                      {confidence.note}
                    </span>
                    {confidence.rows.map((row) => (
                      <div
                        key={row.label}
                        className="flex items-baseline justify-between gap-4 border-b border-rule py-[10px]"
                      >
                        <div className="flex flex-col gap-[1px]">
                          <span className="text-[13px] text-body">{row.label}</span>
                          <span className="text-[11.5px] text-label">{row.source}</span>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-[2px]">
                          <span className="text-[13.5px] font-bold tabular-nums">{row.value}</span>
                          <span
                            className="rounded-[4px] px-[6px] py-[1px] text-[10px] font-bold uppercase tracking-[.05em]"
                            style={{
                              backgroundColor: CONF_PILL[row.conf].bg,
                              color: CONF_PILL[row.conf].fg,
                            }}
                          >
                            {row.conf}
                          </span>
                        </div>
                      </div>
                    ))}
                    {divergePct != null && divergePct > 0 && (
                      <div className="mt-4 rounded-[8px] border border-[#f0dba8] border-l-4 border-l-warn bg-accent-tint px-[14px] py-[10px]">
                        <p className="m-0 text-[13px] leading-[1.6] text-warn-ink">
                          <b className="font-bold">Verify the market rent.</b>{" "}
                          ATTOM&apos;s model says {usdWhole(data.attom!.rentalAvm!)}/mo, HUD
                          says {usdWhole(scenarios!.fmrRent!)}/mo —{" "}
                          {divergePct.toFixed(0)}% apart. Both are estimates; one
                          real comp settles it. Section 8 keys off FMR either way.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {outlook && (outlook.stress || outlook.projection) && (
              <section className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-x-10 gap-y-7">
                {outlook.stress && (
                  <div className="flex flex-col">
                    <SectionHead title="Stress test" caption="Traditional strategy" />
                    <div className="flex flex-col">
                      {outlook.stress.map((row) => (
                        <div
                          key={row.label}
                          className="flex items-baseline justify-between gap-3 border-b border-rule py-[9px]"
                        >
                          <span className="text-[13px] text-body">{row.label}</span>
                          <span className={`text-[13px] font-bold tabular-nums ${cfClass(row.monthlyCashFlow)}`}>
                            {signedUsd(row.monthlyCashFlow)}/mo
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-[12.5px] leading-[1.6] text-body">
                      Rent −10%, empty months +5 points, rate +1 point — each
                      alone, then combined. A deal that only works when every
                      estimate is exactly right isn&apos;t a deal.
                    </p>
                  </div>
                )}
                {outlook.projection && (
                  <div className="flex flex-col">
                    <SectionHead title="5-year hold" caption="Traditional strategy, rents held flat" />
                    <div className="flex flex-col">
                      {(
                        [
                          [`Est. value in 5 yrs (${adv.appreciationPctAnnual}%/yr)`, usdWhole(outlook.projection.futureValue)],
                          ["Loan balance then", usdWhole(outlook.projection.loanBalance)],
                          ["Principal paid down by tenant", usdWhole(outlook.projection.equityPaydown)],
                          ["Cumulative cash flow (60 mo)", usdWhole(outlook.projection.cumulativeCashFlow)],
                          [`Net if sold (${adv.sellingCostPct}% selling costs)`, usdWhole(outlook.projection.netIfSold)],
                          ["Total profit vs cash in", usdWhole(outlook.projection.totalProfit)],
                        ] as const
                      ).map(([labelText, value]) => (
                        <div
                          key={labelText}
                          className="flex items-baseline justify-between gap-3 border-b border-rule py-[9px]"
                        >
                          <span className="text-[13px] text-body">{labelText}</span>
                          <span className="text-[13px] tabular-nums">{value}</span>
                        </div>
                      ))}
                      <div className="flex items-baseline justify-between gap-3 py-[9px]">
                        <span className="flex items-center text-[13.5px] font-bold">
                          Annualized total return
                          <InfoTip text="The compound annual growth rate on your invested cash if the 5-year projection plays out: (sale proceeds + all cash flow) relative to cash invested, annualized." />
                        </span>
                        <span
                          className={`text-[15px] font-bold tabular-nums ${
                            outlook.projection.annualizedReturnPct > 0 ? "text-positive" : "text-negative"
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

            <FidelityCheck
              data={data}
              scenarios={scenarios}
              price={price === "" ? 0 : Number(price)}
              bedrooms={bedrooms === "" ? 3 : Number(bedrooms)}
              mashvisorConfigured={sources?.mashvisor ?? false}
            />

            {savedPins.length > 0 && (
              <section className="flex flex-col gap-[14px]">
                <div className="flex flex-wrap items-baseline justify-between gap-[14px] border-b border-ink pb-[9px]">
                  <h3 className="text-[19px] font-bold tracking-[-.02em]">
                    Pencil Map{" "}
                    <span className="text-[13px] font-medium text-label">
                      {visiblePins.length} of {savedPins.length} in My Pencils
                    </span>
                  </h3>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[11.5px] text-label">Score by</span>
                      {strategyTabs}
                    </div>
                    <div className="flex flex-wrap items-center gap-[11px] text-[11.5px] text-body">
                      {PENCIL_TIERS.map((t) => {
                        const on = tierFilter.has(t.short);
                        return (
                          <button
                            key={t.short}
                            title={`${on ? "Hide" : "Show"} ${t.label} deals`}
                            onClick={() =>
                              setTierFilter((prev) => {
                                const next = new Set(prev);
                                if (next.has(t.short)) next.delete(t.short);
                                else next.add(t.short);
                                return next;
                              })
                            }
                            className={`flex cursor-pointer items-center gap-[5px] ${on ? "" : "opacity-35"}`}
                          >
                            <span className="h-[9px] w-[9px] rounded-full" style={{ background: t.dot }} />
                            {t.short}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <PropertyMap pins={visiblePins} colorBy={pinKey} focusId={focusId} />

                <div className="overflow-x-auto">
                  <div className="grid min-w-[860px] grid-cols-[1.8fr_1fr_0.7fr_1fr_1fr_1fr_0.8fr_1fr_1.3fr_28px]">
                    {["Property", "Asking", "Score", "Market", "Sec. 8", "Airbnb", "Cap", "Investor value", "Verdict", ""].map(
                      (h, i) => (
                        <span
                          key={h || "x"}
                          className={`border-b border-ink py-[9px] text-[10px] font-bold uppercase tracking-[.09em] text-label ${
                            i >= 1 && i <= 7 ? "px-[10px] text-right" : i === 8 ? "pl-[10px]" : ""
                          }`}
                        >
                          {h}
                        </span>
                      )
                    )}
                    {[...visiblePins]
                      .sort((a, b) => {
                        const ma = a[pinKey] ?? a.market ?? a.s8 ?? a.str;
                        const mb = b[pinKey] ?? b.market ?? b.s8 ?? b.str;
                        return (
                          (mb?.score ?? -1) - (ma?.score ?? -1) ||
                          (mb?.monthlyCashFlow ?? 0) - (ma?.monthlyCashFlow ?? 0)
                        );
                      })
                      .map((p) => {
                        const m = p[pinKey] ?? p.market ?? p.s8 ?? p.str;
                        const t = pinTier(m);
                        const cfCell = (metric: PinMetrics | undefined) => (
                          <span
                            className={`cursor-pointer border-b border-rule px-[10px] py-[11px] text-right text-[13px] font-semibold tabular-nums ${
                              metric ? cfClass(metric.monthlyCashFlow) : "text-label"
                            }`}
                            onClick={() => setFocusId(p.id)}
                          >
                            {metric ? signedUsd(metric.monthlyCashFlow) : "—"}
                          </span>
                        );
                        return (
                          <span key={p.id} className="contents">
                            <span
                              onClick={() => setFocusId(p.id)}
                              className="flex cursor-pointer items-center gap-[9px] border-b border-rule py-[11px] text-[13px] font-medium hover:bg-accent-tint"
                            >
                              <span
                                className="h-[9px] w-[9px] shrink-0 rounded-full"
                                style={{ background: t?.dot ?? "#8a8780" }}
                              />
                              <span className="truncate">{p.address}</span>
                            </span>
                            <span
                              onClick={() => setFocusId(p.id)}
                              className="cursor-pointer border-b border-rule px-[10px] py-[11px] text-right text-[13px] text-body tabular-nums"
                            >
                              {usd(p.price)}
                            </span>
                            <span className="border-b border-rule px-[10px] py-[11px] text-right text-[14px] font-extrabold tabular-nums">
                              {m?.score ?? "—"}
                            </span>
                            {cfCell(p.market)}
                            {cfCell(p.s8)}
                            {cfCell(p.str)}
                            <span className="border-b border-rule px-[10px] py-[11px] text-right text-[13px] text-body tabular-nums">
                              {m ? pct1(m.capRatePct) : "—"}
                            </span>
                            <span className="border-b border-rule px-[10px] py-[11px] text-right text-[13px] text-body tabular-nums">
                              {p.investorValue != null ? usdWhole(p.investorValue) : "—"}
                            </span>
                            <span className="flex items-center gap-[6px] border-b border-rule py-[11px] pl-[10px]">
                              {t && <TierBadge tier={t} small />}
                              {m?.almost && (
                                <span
                                  title={m.gapText ? `${m.gapText} away from ${LEGACY_RATING_LABEL[m.almost]}` : `almost ${LEGACY_RATING_LABEL[m.almost]}`}
                                  className="whitespace-nowrap text-[10px]"
                                  style={{ color: RATING_COLORS[m.almost] }}
                                >
                                  almost {LEGACY_RATING_LABEL[m.almost]}
                                </span>
                              )}
                            </span>
                            <span className="flex items-center justify-end border-b border-rule py-[11px]">
                              <button
                                onClick={() => {
                                  setSavedPins((prev) => prev.filter((x) => x.id !== p.id));
                                  if (focusId === p.id) setFocusId(null);
                                }}
                                title="Remove from My Pencils"
                                className="cursor-pointer px-1 text-label hover:text-negative"
                              >
                                ✕
                              </button>
                            </span>
                          </span>
                        );
                      })}
                  </div>
                </div>
              </section>
            )}

            <p className="m-0 max-w-[100ch] border-t border-border pt-4 text-[11.5px] leading-[1.75] text-label">
              The Pencil Score is a weighted reading of monthly cash flow per
              unit (30%), cash-on-cash return (25%), cap rate (15%), debt
              coverage (15%) and asking price against investor value (15%),
              scored against your required return.{" "}
              <b className="font-bold text-body">Rare Pencil</b> 90+ ·{" "}
              <b className="font-bold text-body">Fantastic</b> 80–89 ·{" "}
              <b className="font-bold text-body">Great</b> 70–79 ·{" "}
              <b className="font-bold text-body">Good</b> 60–69 ·{" "}
              <b className="font-bold text-body">Fair</b> 50–59 ·{" "}
              <b className="font-bold text-body">Poor</b> below 50. The
              sharpness badge on each strategy reads cash flow, cash-on-cash and
              cap rate against fixed bars — <b className="font-bold text-body">Razor
              Sharp</b> ≥ $400/mo · ≥12% · ≥8% cap ·{" "}
              <b className="font-bold text-body">Sharp</b> ≥ $250/mo · ≥10% ·{" "}
              <b className="font-bold text-body">Pointed</b> ≥ $150/mo · ≥8% ·{" "}
              <b className="font-bold text-body">Needs Sharpening</b> &gt; $50/mo
              · ≥5% · <b className="font-bold text-body">Broken</b> otherwise —
              with a dashed <b className="font-bold text-body">Almost</b> badge
              when a tier is missed by less than $50/mo, 1.5 points of
              cash-on-cash or 1 point of cap rate. Breaking even is not a goal. Every figure is
              an estimate from public data — HUD Fair Market Rents, FEMA flood
              maps, the Census geocoder, Census county data (taxes, rents,
              vacancy, population), BLS unemployment and the FRED mortgage
              average — plus licensed property-record and short-term-rental data
              providers where configured. PropPencil estimates; it does not
              pretend to know the future. Verify rents with local comparable
              rentals, taxes with the county auditor and insurance with real
              quotes before making an offer. Not professional advice.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
