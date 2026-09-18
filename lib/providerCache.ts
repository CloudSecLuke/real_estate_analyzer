import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "@/lib/sql";

// Server-side provider cache (CLAUDE_CODE_BRIEF Phase 4). Replaces the
// invisible Next.js Data Cache for every external call: survives deploys,
// is inspectable in SQL, and doubles as cost telemetry. Commercial
// responses are NEVER kept past their TTL (vendor terms); the nightly
// cron deletes expired rows.
//
// Policy: only non-null values are cached — a null/undefined result may be
// a transient upstream failure, and caching it would mask recovery for a
// full TTL. Errors propagate uncached.

export interface CachedResult<T> {
  value: T;
  cacheHit: boolean;
  costCents: number;
}

export interface ProviderCall {
  provider: string;
  cacheHit: boolean;
  costCents: number;
}

// Estimated marginal cost per real request, cents. Free/public sources are
// 0. Paid defaults are course estimates; override via env without deploys.
function costCents(provider: string): number {
  const env = process.env[`COST_CENTS_${provider.toUpperCase()}`];
  if (env != null && Number.isFinite(Number(env))) return Number(env);
  const defaults: Record<string, number> = {
    attom: 3, // trial → verify against contract tier when purchased
    mashvisor: 3, // $129/mo ÷ ~10k calls ≈ 1.3¢; padded for renewal math
    rentcast: 5, // free tier 50/mo; paid tiers ≈ $0.05-0.10/call
    regrid: 5,
  };
  return defaults[provider] ?? 0;
}

// Per-request call log so /api/analyze can persist which providers a
// pencil touched and what it cost, without threading a collector through
// every lib signature.
const callLog = new AsyncLocalStorage<ProviderCall[]>();

export function runWithCallLog<T>(fn: () => Promise<T>): Promise<{ result: T; calls: ProviderCall[] }> {
  const calls: ProviderCall[] = [];
  return callLog.run(calls, async () => ({ result: await fn(), calls }));
}

function record(call: ProviderCall): void {
  callLog.getStore()?.push(call);
}

/**
 * Read-through cache. `key` must uniquely identify the request within the
 * provider namespace. On miss, runs `fn`; non-null results are stored with
 * `expires_at = now() + ttl`.
 */
export async function cached<T>(
  provider: string,
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>
): Promise<CachedResult<T>> {
  const dbless = !process.env.DATABASE_URL;
  if (!dbless) {
    try {
      const rows = (await sql()`
        SELECT payload FROM provider_cache
        WHERE provider = ${provider} AND cache_key = ${key} AND expires_at > now()
      `) as { payload: T }[];
      if (rows.length > 0) {
        record({ provider, cacheHit: true, costCents: 0 });
        return { value: rows[0].payload, cacheHit: true, costCents: 0 };
      }
    } catch (err) {
      // cache infrastructure failure must never block the request path
      console.error("provider_cache_read_failed", provider, err instanceof Error ? err.message : err);
    }
  }

  const value = await fn();
  const cost = costCents(provider);
  record({ provider, cacheHit: false, costCents: cost });

  if (!dbless && value !== null && value !== undefined) {
    try {
      await sql()`
        INSERT INTO provider_cache (provider, cache_key, payload, cost_cents, fetched_at, expires_at)
        VALUES (${provider}, ${key}, ${JSON.stringify(value)}::jsonb, ${cost}, now(),
                now() + make_interval(secs => ${ttlSeconds}))
        ON CONFLICT (provider, cache_key) DO UPDATE SET
          payload = EXCLUDED.payload, cost_cents = EXCLUDED.cost_cents,
          fetched_at = now(), expires_at = EXCLUDED.expires_at
      `;
    } catch (err) {
      console.error("provider_cache_write_failed", provider, err instanceof Error ? err.message : err);
    }
  }
  return { value, cacheHit: false, costCents: cost };
}

/** Convenience for call sites that only need the value. */
export async function cachedValue<T>(
  provider: string,
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>
): Promise<T> {
  return (await cached(provider, key, ttlSeconds, fn)).value;
}

// TTLs (seconds). Sources: brief Phase 4 step 2. Paid-provider TTLs must
// not exceed vendor caching terms — ATTOM 90d and RentCast 14d/7d follow
// the brief; re-verify against the signed agreements before any increase
// (docs/provider-architecture.md).
export const TTL = {
  address: 24 * 3600, // Census geocoder — 24h
  hud: 30 * 86400, //    HUD FMR — annual data, 30d
  acs: 30 * 86400, //    Census ACS — annual data, 30d
  fema: 30 * 86400, //   FEMA NFHL — 30d
  bls: 7 * 86400, //     BLS LAUS — monthly series, 7d
  fred: 24 * 3600, //    FRED mortgage rate — daily series, 24h
  attomProperty: 90 * 86400, // ATTOM property/tax — 90d per brief
  rentcastRent: 14 * 86400, //  RentCast rent estimate — 14d per brief
  rentcastComps: 7 * 86400, //  RentCast comps — 7d per brief
  mashvisor: 24 * 3600, //      Mashvisor — 24h per brief
  regrid: 24 * 3600, //         Regrid typeahead (parked provider) — 24h
} as const;
