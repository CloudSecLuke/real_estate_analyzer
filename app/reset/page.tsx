"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { AppMark } from "@/components/PencilMark";

const INPUT =
  "w-full rounded-[7px] border border-input-border bg-card px-[13px] py-3 text-[14.5px] text-ink outline-none focus:border-ink focus:shadow-[0_0_0_3px_rgba(244,197,66,.45)]";

function ResetForm() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    if (t) setToken(t);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Reset failed.");
      window.location.href = "/app";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed.");
      setLoading(false);
    }
  }

  const missingToken = token === "";

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <div className="flex w-full max-w-[392px] flex-col gap-[22px]">
        <Link href="/" className="flex items-center gap-[10px]">
          <AppMark />
          <span className="text-[17px] font-extrabold tracking-[-.032em] text-ink">
            PropPencil
          </span>
        </Link>

        <div className="flex flex-col gap-[7px]">
          <h1 className="text-[29px] font-extrabold leading-[1.1] tracking-[-.032em]">
            Choose a new password
          </h1>
          <p className="text-[14px] leading-[1.6] text-label">
            {missingToken
              ? "This page needs the link from your reset email."
              : "Set a new password and you'll be signed straight in."}
          </p>
        </div>

        {error && (
          <div className="rounded-[8px] border border-[#e6c4bf] border-l-4 border-l-negative bg-[#f7ece9] px-[14px] py-3">
            <p className="text-[13px] leading-[1.55] text-[#7a1f17]">
              <b className="font-bold">{error}</b>{" "}
              <Link href="/forgot" className="font-semibold text-accent">
                Request a new link
              </Link>
            </p>
          </div>
        )}

        {missingToken ? (
          <Link
            href="/forgot"
            className="w-full rounded-[7px] bg-pencil px-4 py-[13px] text-center text-[15px] font-extrabold tracking-[-.01em] text-ink hover:bg-pencil-dark"
          >
            Request a reset link
          </Link>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-[15px]">
            <label className="flex flex-col gap-[6px]">
              <span className="flex items-baseline justify-between gap-[10px]">
                <span className="text-[11px] font-bold uppercase tracking-[.1em] text-label">
                  New password
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
                autoFocus
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
              className="w-full cursor-pointer rounded-[7px] bg-pencil px-4 py-[13px] text-[15px] font-extrabold tracking-[-.01em] text-ink hover:bg-pencil-dark disabled:opacity-60"
            >
              {loading ? "Saving…" : "Set password & sign in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
