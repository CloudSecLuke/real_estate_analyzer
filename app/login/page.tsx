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

  return (
    <main className="min-h-dvh flex items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 flex flex-col gap-4"
      >
        <div>
          <h1 className="text-xl font-bold">Real Estate Cash Flow Analyzer</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Sign in to continue.
          </p>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">Username</span>
          <input
            required
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="first.last"
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">Password</span>
          <input
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5"
          />
        </label>
        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2 text-sm">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold px-4 py-2"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
