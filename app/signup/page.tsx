"use client";

import { useState } from "react";
import Link from "next/link";
import { AppMarkInverted } from "@/components/PencilMark";

const INPUT =
  "w-full rounded-[7px] border border-input-border bg-card px-[13px] py-3 text-[14.5px] text-ink outline-none focus:border-ink focus:shadow-[0_0_0_3px_rgba(244,197,66,.45)]";

export default function SignupPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, email: email || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sign-up failed");
      window.location.href = "/app";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed");
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
            Your first pencil is free.
          </h1>
          <p className="text-[16.5px] leading-[1.6] text-on-dark-dim [text-wrap:pretty]">
            Create an account and pencil one property on us — the full
            analysis: Pencil Score, investor value, all three strategies, the
            risks and the walk-away price. After that, the Investor plan is
            $19 a month for 100 pencils.
          </p>
          <ul className="flex flex-col gap-2 text-[14px] text-on-dark-dim">
            <li className="flex gap-2">
              <span className="font-extrabold text-[#7ddba8]">✓</span> One free
              full analysis, no card required
            </li>
            <li className="flex gap-2">
              <span className="font-extrabold text-[#7ddba8]">✓</span> Saved
              pencils, your assumptions and your required return, synced
            </li>
            <li className="flex gap-2">
              <span className="font-extrabold text-[#7ddba8]">✓</span> Cancel
              the paid plan any time — your data stays
            </li>
          </ul>
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
              Create your account
            </h2>
            <p className="text-[14px] text-label">
              Pick a username and you&apos;re penciling in under a minute.
            </p>
          </div>

          {error && (
            <div className="flex gap-[11px] rounded-[8px] border border-[#e6c4bf] border-l-4 border-l-negative bg-[#f7ece9] px-[14px] py-3">
              <p className="text-[13px] leading-[1.55] text-[#7a1f17]">
                <b className="font-bold">{error}</b>
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
              <span className="text-[11px] font-bold uppercase tracking-[.1em] text-label">
                Email <span className="font-medium normal-case">(optional, for receipts)</span>
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
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
                minLength={8}
                type={reveal ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                className={INPUT}
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="mt-[2px] w-full cursor-pointer rounded-[7px] bg-pencil px-4 py-[13px] text-[15px] font-extrabold tracking-[-.01em] text-ink hover:bg-pencil-dark disabled:opacity-60"
            >
              {loading ? "Creating account…" : "Create account & pencil free"}
            </button>
          </form>

          <p className="text-center text-[13px] leading-[1.6] text-label">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-semibold text-accent hover:text-link-hover"
            >
              Sign in
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
