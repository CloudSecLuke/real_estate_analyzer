"use client";

import { useState } from "react";
import Link from "next/link";
import { AppMark } from "@/components/PencilMark";

const INPUT =
  "w-full rounded-[7px] border border-input-border bg-card px-[13px] py-3 text-[14.5px] text-ink outline-none focus:border-ink focus:shadow-[0_0_0_3px_rgba(244,197,66,.45)]";

export default function ForgotPage() {
  const [username, setUsername] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      setSent(json.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

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
            Reset your password
          </h1>
          <p className="text-[14px] leading-[1.6] text-label">
            Enter your username and we&apos;ll email a reset link to the
            address on your account.
          </p>
        </div>

        {sent ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-[8px] border border-border border-l-4 border-l-pencil bg-card px-4 py-[14px]">
              <p className="text-[13.5px] leading-[1.6] text-ink">{sent}</p>
            </div>
            <Link
              href="/login"
              className="text-center text-[13px] font-semibold text-accent hover:text-link-hover"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            {error && (
              <div className="rounded-[8px] border border-[#e6c4bf] border-l-4 border-l-negative bg-[#f7ece9] px-[14px] py-3">
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
              <button
                type="submit"
                disabled={loading}
                className="w-full cursor-pointer rounded-[7px] bg-pencil px-4 py-[13px] text-[15px] font-extrabold tracking-[-.01em] text-ink hover:bg-pencil-dark disabled:opacity-60"
              >
                {loading ? "Sending…" : "Email me a reset link"}
              </button>
            </form>
            <p className="text-center text-[13px] leading-[1.6] text-label">
              Remembered it?{" "}
              <Link
                href="/login"
                className="font-semibold text-accent hover:text-link-hover"
              >
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
