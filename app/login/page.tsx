"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppMarkInverted } from "@/components/PencilMark";
import { tierForLegacyRating, tierForScore } from "@/lib/pencilScore";
import type { HistoryEntry, PinMetrics, SavedPin } from "@/lib/types";

const signed = (n: number) =>
  (n >= 0 ? "+" : "−") + "$" + Math.abs(Math.round(n)).toLocaleString("en-US");
const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

interface LastPenciled {
  address: string;
  score: number | null;
  tierLabel: string;
  tierBg: string;
  tierFg: string;
  cashFlow: number;
  maxBuy: number | null;
  coc: number;
}

// The "Last penciled" card is populated from this browser's most recent
// analysis (localStorage), and hidden entirely for a first-time visitor —
// never placeholder numbers.
function readLastPenciled(): LastPenciled | null {
  try {
    const hist: HistoryEntry[] = JSON.parse(
      localStorage.getItem("rea_history_v1") ?? "[]"
    );
    const pins: SavedPin[] = JSON.parse(
      localStorage.getItem("rea_saved_pins_v1") ?? "[]"
    );
    const last = hist[0];
    if (!last) return null;
    const pin = pins.find(
      (p) => p.address.toLowerCase() === last.address.toLowerCase()
    );
    if (!pin) return null;
    const metrics = [pin.market, pin.s8, pin.str].filter(
      (m): m is PinMetrics => Boolean(m)
    );
    if (metrics.length === 0) return null;
    const best = metrics.reduce((a, b) =>
      b.monthlyCashFlow > a.monthlyCashFlow ? b : a
    );
    const tier =
      best.score != null
        ? tierForScore(best.score)
        : tierForLegacyRating(best.rating);
    return {
      address: pin.address,
      score: best.score ?? null,
      tierLabel: tier.label,
      tierBg: tier.bg,
      tierFg: tier.fg,
      cashFlow: best.monthlyCashFlow,
      maxBuy: pin.investorValue ?? null,
      coc: best.cashOnCashPct,
    };
  } catch {
    return null;
  }
}

const INPUT =
  "w-full rounded-[7px] border border-input-border bg-card px-[13px] py-3 text-[14.5px] text-ink outline-none focus:border-ink focus:shadow-[0_0_0_3px_rgba(244,197,66,.45)]";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [last, setLast] = useState<LastPenciled | null>(null);
  const [nextUrl, setNextUrl] = useState("/app");

  useEffect(() => {
    setLast(readLastPenciled());
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    if (next && next.startsWith("/")) setNextUrl(next);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, remember }),
      });
      if (res.status === 429) {
        const json = await res.json().catch(() => null);
        throw new Error(
          json?.error ?? "Too many attempts — wait a minute and try again."
        );
      }
      if (!res.ok) throw new Error("bad_credentials");
      window.location.href = nextUrl;
    } catch (err) {
      // "" → the default wrong-password copy; any other string → verbatim
      setError(
        err instanceof Error && err.message !== "bad_credentials"
          ? err.message
          : ""
      );
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-[repeat(auto-fit,minmax(400px,1fr))] max-[420px]:grid-cols-1">
      <section className="flex min-h-full flex-col justify-between gap-12 bg-ink-panel px-12 py-11 max-md:px-6">
        <Link href="/" className="flex items-center gap-[11px] self-start">
          <AppMarkInverted />
          <span className="flex flex-col gap-[3px]">
            <span className="text-[19px] font-extrabold leading-none tracking-[-.032em] text-on-dark">
              PropPencil
            </span>
            <span className="block h-[3px] w-[70px] rounded-[2px] bg-pencil" />
          </span>
        </Link>

        <div className="flex max-w-[46ch] flex-col gap-5">
          <h1 className="text-[52px] font-extrabold leading-none tracking-[-.045em] text-on-dark max-md:text-[38px]">
            Does it pencil?
          </h1>
          <p className="text-[16.5px] leading-[1.6] text-on-dark-dim [text-wrap:pretty]">
            Sign in to pick up where you left off — your saved properties,
            your assumptions, and the return you require.
          </p>

          {last && (
            <div className="mt-[6px] flex flex-col gap-px overflow-hidden rounded-[10px] border border-[#2e2e2b] bg-[#2e2e2b]">
              <div className="flex items-center justify-between gap-4 bg-[#1f1f1d] px-[18px] py-4">
                <div className="flex min-w-0 flex-col gap-[2px]">
                  <span className="text-[10.5px] font-bold uppercase tracking-[.12em] text-disabled">
                    Last penciled
                  </span>
                  <span className="truncate text-[14px] font-semibold text-on-dark">
                    {last.address}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-[9px]">
                  {last.score != null && (
                    <span className="text-[26px] font-extrabold tracking-[-.035em] text-on-dark tabular-nums">
                      {last.score}
                    </span>
                  )}
                  <span
                    className="whitespace-nowrap rounded-[5px] px-[9px] py-[3px] text-[10px] font-bold uppercase tracking-[.05em]"
                    style={{ backgroundColor: last.tierBg, color: last.tierFg }}
                  >
                    {last.tierLabel}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-5 bg-[#1f1f1d] px-[18px] py-[14px]">
                <div className="flex flex-col gap-[2px]">
                  <span className="text-[10px] font-bold uppercase tracking-[.1em] text-disabled">
                    Cash flow
                  </span>
                  <span className="text-[15px] font-bold text-[#7ddba8] tabular-nums">
                    {signed(last.cashFlow)}/mo
                  </span>
                </div>
                {last.maxBuy != null && (
                  <div className="flex flex-col gap-[2px]">
                    <span className="text-[10px] font-bold uppercase tracking-[.1em] text-disabled">
                      Max buy price
                    </span>
                    <span className="text-[15px] font-bold text-pencil tabular-nums">
                      {usd(last.maxBuy)}
                    </span>
                  </div>
                )}
                <div className="flex flex-col gap-[2px]">
                  <span className="text-[10px] font-bold uppercase tracking-[.1em] text-disabled">
                    Cash-on-cash
                  </span>
                  <span className="text-[15px] font-bold text-on-dark tabular-nums">
                    {last.coc.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        <p className="max-w-[60ch] text-[12px] leading-[1.65] text-disabled">
          PropPencil estimates from public data. Verify rents, taxes and
          insurance before making an offer. Not professional advice.
        </p>
      </section>

      <section className="flex items-center justify-center px-8 py-12 max-md:px-5">
        <div className="flex w-full max-w-[392px] flex-col gap-[22px]">
          <div className="flex flex-col gap-[7px]">
            <h2 className="text-[29px] font-extrabold leading-[1.1] tracking-[-.032em]">
              Welcome back
            </h2>
            <p className="text-[14px] text-label">Sign in to continue.</p>
          </div>

          {error !== null && (
            <div className="flex gap-[11px] rounded-[8px] border border-[#e6c4bf] border-l-4 border-l-negative bg-[#f7ece9] px-[14px] py-3">
              <p className="text-[13px] leading-[1.55] text-[#7a1f17]">
                {error ? (
                  <b className="font-bold">{error}</b>
                ) : (
                  <>
                    <b className="font-bold">
                      That username and password do not match.
                    </b>{" "}
                    Check for a stray capital, or reset your password below.
                  </>
                )}
              </p>
            </div>
          )}

          <form onSubmit={submit} className="flex flex-col gap-[15px]">
            <label className="flex flex-col gap-[6px]">
              <span className="text-[11px] font-bold uppercase tracking-[.1em] text-label">
                Username
              </span>
              <input
                required
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder="first.last"
                className={INPUT}
              />
            </label>

            <label className="flex flex-col gap-[6px]">
              <span className="flex items-baseline justify-between gap-[10px]">
                <span className="text-[11px] font-bold uppercase tracking-[.1em] text-label">
                  Password
                </span>
                <button
                  type="button"
                  onClick={() => setReveal((r) => !r)}
                  className="cursor-pointer text-[11.5px] font-semibold text-accent hover:text-link-hover"
                >
                  {reveal ? "Hide" : "Show"}
                </button>
              </span>
              <input
                required
                type={reveal ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className={INPUT}
              />
            </label>

            <div className="flex flex-wrap items-center justify-between gap-[10px]">
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-body">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-[15px] w-[15px] cursor-pointer accent-ink"
                />
                <span>Keep me signed in</span>
              </label>
              <Link
                href="/forgot"
                className="text-[13px] font-semibold text-accent hover:text-link-hover"
              >
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-[2px] w-full cursor-pointer rounded-[7px] bg-pencil px-4 py-[13px] text-[15px] font-extrabold tracking-[-.01em] text-ink hover:bg-pencil-dark disabled:opacity-60"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-bold uppercase tracking-[.1em] text-label">
              Or
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <Link
            href="/signup"
            className="w-full cursor-pointer rounded-[7px] border border-input-border bg-card px-4 py-3 text-center text-[14px] font-semibold text-ink hover:border-ink"
          >
            Create a free account — your first pencil is on us
          </Link>

          <p className="text-center text-[13px] leading-[1.6] text-label">
            New here?{" "}
            <Link
              href="/signup"
              className="font-semibold text-accent hover:text-link-hover"
            >
              Create an account
            </Link>{" "}
            to save properties and set your required return.
          </p>
        </div>
      </section>
    </div>
  );
}
