import { neon } from "@neondatabase/serverless";
import { databaseUrl } from "./dbUrl";
import { geocodeAddress } from "./geocode";
import { getFmr } from "./hud";
import { getCountyMedianRent } from "./acs";
import { getMarketHealth } from "./market";
import { getMortgageRate } from "./rates";
import { getAttomData } from "./attom";
import { getMashvisorAnalyze } from "./mashvisor";

// Upstream health checks + key-expiry calendar (PROP-3). Each check is a
// real, cheap call against the same code path the analyzer uses, so a
// revoked key or changed API shape shows up here before a user sees a
// degraded pencil. Run by Vercel cron via /api/health; results are stored
// so the app can warn founders without re-running the (paid) calls.

// Known renewal/expiry dates for paid or expiring credentials. Update
// when a subscription renews or a key is replaced.
export const KEY_DATES: { source: string; label: string; date: string }[] = [
  {
    source: "mashvisor",
    label: "Mashvisor subscription renews (decide: keep or lapse)",
    date: "2026-10-13",
  },
];
export const KEY_DATE_WARN_DAYS = 14;

// The reference property every check runs against — a real address with
// known-good data in every upstream.
const REF = {
  address: "1418 Vine St, Cincinnati, OH 45202",
  countyFips: "39061",
  countyName: "Hamilton County",
  zip: "45202",
  city: "Cincinnati",
  state: "OH",
  street: "1418 Vine St",
  lat: 39.1099,
  lon: -84.5155,
};

export interface HealthResult {
  source: string;
  ok: boolean;
  configured: boolean;
  latencyMs: number;
  detail: string;
}

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function runOne(
  source: string,
  configured: boolean,
  fn: () => Promise<string>
): Promise<HealthResult> {
  const start = Date.now();
  if (!configured) {
    return { source, ok: false, configured, latencyMs: 0, detail: "no key configured" };
  }
  try {
    const detail = await timeout(fn(), 15000);
    return { source, ok: true, configured, latencyMs: Date.now() - start, detail };
  } catch (err) {
    return {
      source,
      ok: false,
      configured,
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? err.message.slice(0, 300) : "failed",
    };
  }
}

export async function runHealthChecks(): Promise<HealthResult[]> {
  const results = await Promise.all([
    runOne("census_geocoder", true, async () => {
      const g = await geocodeAddress(REF.address);
      if (!g?.countyFips) throw new Error("no county in geocode result");
      return `matched, county ${g.countyFips}`;
    }),
    runOne("hud_fmr", Boolean(process.env.HUD_API_TOKEN), async () => {
      const fmr = await getFmr(REF.countyFips, REF.zip);
      const three = fmr?.byBedroom?.[3];
      if (!three) throw new Error("no 3br FMR in response");
      return `3br FMR $${three}`;
    }),
    runOne("census_acs", Boolean(process.env.CENSUS_API_KEY), async () => {
      const acs = await getCountyMedianRent(REF.countyFips, REF.countyName);
      if (!acs) throw new Error("null result (key rejected or shape changed)");
      return "county medians returned";
    }),
    runOne("bls_market", true, async () => {
      const mh = await getMarketHealth(REF.countyFips, REF.countyName);
      if (!mh) throw new Error("null result");
      return "market health returned";
    }),
    runOne("fred_rates", true, async () => {
      const rate = await getMortgageRate();
      if (!rate) throw new Error("null result");
      return `30yr ${rate.pct}% as of ${rate.asOf}`;
    }),
    runOne("attom", Boolean(process.env.ATTOM_API_KEY), async () => {
      const a = await getAttomData(`${REF.street}, ${REF.city}, ${REF.state}, ${REF.zip}`);
      if (!a) throw new Error("null result (no record or key inactive)");
      return "property record returned";
    }),
    runOne("resend_email", Boolean(process.env.RESEND_API_KEY), async () => {
      const { sendEmailDetailed } = await import("./email");
      // delivered@resend.dev is Resend's test sink: exercises the key,
      // sender domain and API without landing in a real inbox.
      const r = await sendEmailDetailed({
        to: "delivered@resend.dev",
        subject: "PropPencil email health check",
        text: "The email pipeline works — this is the periodic health check.",
      });
      if (!r.ok) throw new Error(r.detail);
      return r.detail;
    }),
    runOne("mashvisor", Boolean(process.env.MASHVISOR_API_KEY), async () => {
      const m = await getMashvisorAnalyze({
        state: REF.state,
        city: REF.city,
        zip: REF.zip,
        address: REF.street,
        lat: REF.lat,
        lon: REF.lon,
      });
      if (!m) throw new Error("null result");
      return "STR + listing lookups returned";
    }),
  ]);
  return results;
}

export function upcomingKeyDates(now = new Date()) {
  return KEY_DATES.map((k) => {
    const days = Math.ceil(
      (new Date(k.date + "T00:00:00Z").getTime() - now.getTime()) / 86400000
    );
    return { ...k, daysAway: days };
  }).filter((k) => k.daysAway <= KEY_DATE_WARN_DAYS);
}

// --- storage ---------------------------------------------------------------

type Sql = ReturnType<typeof neon>;
let _sql: Sql | null = null;
let _ready: Promise<void> | null = null;

function getSql(): Sql {
  if (!_sql) _sql = neon(databaseUrl());
  return _sql;
}

function ensureSchema(): Promise<void> {
  if (!_ready) {
    _ready = (async () => {
      await getSql()`
        CREATE TABLE IF NOT EXISTS health_checks (
          source     text PRIMARY KEY,
          ok         boolean NOT NULL,
          configured boolean NOT NULL,
          latency_ms int NOT NULL,
          detail     text NOT NULL,
          checked_at timestamptz NOT NULL DEFAULT now()
        )
      `;
    })();
    _ready.catch(() => {
      _ready = null;
    });
  }
  return _ready;
}

export async function storeHealthResults(results: HealthResult[]): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  await ensureSchema();
  const sql = getSql();
  for (const r of results) {
    await sql`
      INSERT INTO health_checks (source, ok, configured, latency_ms, detail, checked_at)
      VALUES (${r.source}, ${r.ok}, ${r.configured}, ${r.latencyMs}, ${r.detail}, now())
      ON CONFLICT (source) DO UPDATE SET
        ok = EXCLUDED.ok,
        configured = EXCLUDED.configured,
        latency_ms = EXCLUDED.latency_ms,
        detail = EXCLUDED.detail,
        checked_at = EXCLUDED.checked_at
    `;
  }
}

export interface StoredHealth {
  source: string;
  ok: boolean;
  configured: boolean;
  latencyMs: number;
  detail: string;
  checkedAt: string;
}

export async function latestHealthResults(): Promise<StoredHealth[]> {
  if (!process.env.DATABASE_URL) return [];
  await ensureSchema();
  const rows = (await getSql()`
    SELECT source, ok, configured, latency_ms, detail, checked_at
    FROM health_checks ORDER BY source
  `) as Record<string, unknown>[];
  return rows.map((r) => ({
    source: String(r.source),
    ok: Boolean(r.ok),
    configured: Boolean(r.configured),
    latencyMs: Number(r.latency_ms),
    detail: String(r.detail),
    checkedAt: String(r.checked_at),
  }));
}
