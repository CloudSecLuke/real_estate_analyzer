"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sign-in failed");
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setLoading(false);
    }
  }

  const input =
    "w-full rounded-[2px] border border-input-border bg-field px-[10px] py-[9px] text-[13px] text-ink outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(150,85,42,.1)]";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-4">
      <form
        onSubmit={submit}
        className="flex w-full max-w-sm flex-col gap-4 border border-rule bg-sidebar p-7"
      >
        <div className="border-b-2 border-ink pb-3">
          <h1 className="font-serif text-[23px] font-medium leading-[1.2]">
            Rental Cash Flow Analyzer
          </h1>
          <p className="mt-1 text-[12.5px] leading-[1.6] text-body">
            Sign in to continue.
          </p>
        </div>
        <label className="flex flex-col gap-[5px]">
          <span className="text-[10.5px] font-semibold uppercase tracking-[.11em] text-label">
            Username
          </span>
          <input
            required
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="first.last"
            className={input}
          />
        </label>
        <label className="flex flex-col gap-[5px]">
          <span className="text-[10.5px] font-semibold uppercase tracking-[.11em] text-label">
            Password
          </span>
          <input
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={input}
          />
        </label>
        {error && (
          <div className="border-l-[3px] border-negative bg-accent-tint px-3 py-2 text-[12.5px] text-warn-ink">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="cursor-pointer rounded-[2px] bg-accent px-4 py-[11px] text-[13px] font-semibold text-field hover:bg-accent-hover disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
