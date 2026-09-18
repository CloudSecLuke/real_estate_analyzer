import type { MarketHealth } from "./types";
import { cachedValue, TTL } from "@/lib/providerCache";

// County trajectory: population + median home value (ACS 5-year, two
// vintages) and unemployment (BLS LAUS, keyless). Cheap Midwest markets
// can cash-flow beautifully while quietly depopulating — this panel is
// the "is the town melting?" check.

const ACS_CURRENT = 2023;
const ACS_PRIOR = 2018;

function pctChange(from: number, to: number): number | undefined {
  return from > 0 ? ((to - from) / from) * 100 : undefined;
}

async function acsRow(
  year: number,
  countyFips: string,
  key: string
): Promise<{ pop?: number; value?: number }> {
  const params = new URLSearchParams({
    get: "B01003_001E,B25077_001E",
    for: `county:${countyFips.slice(2)}`,
    in: `state:${countyFips.slice(0, 2)}`,
    key,
  });
  const res = await fetch(
    `https://api.census.gov/data/${year}/acs/acs5?${params}`
  );
  if (!res.ok) return {};
  const json = await res.json().catch(() => null);
  const row = json?.[1];
  const pop = Number(row?.[0]);
  const value = Number(row?.[1]);
  return {
    pop: Number.isFinite(pop) && pop > 0 ? pop : undefined,
    value: Number.isFinite(value) && value > 0 ? value : undefined,
  };
}

async function blsUnemployment(
  countyFips: string
): Promise<{ pct?: number; asOf?: string }> {
  // LAUS county unemployment rate series; keyless GET, tightly cached
  const series = `LAUCN${countyFips}0000000003`;
  const res = await fetch(
    `https://api.bls.gov/publicAPI/v2/timeseries/data/${series}?latest=true`
  );
  if (!res.ok) return {};
  const json = await res.json().catch(() => null);
  const d = json?.Results?.series?.[0]?.data?.[0];
  const pct = Number(d?.value);
  if (!Number.isFinite(pct)) return {};
  const prelim = Array.isArray(d?.footnotes)
    ? d.footnotes.some((f: { code?: string }) => f?.code === "P")
    : false;
  return {
    pct,
    asOf: `${String(d.periodName).slice(0, 3)} ${d.year}${prelim ? " (prelim.)" : ""}`,
  };
}

async function getMarketHealthUncached(
  countyFips: string,
  countyName: string
): Promise<MarketHealth | null> {
  if (!/^\d{5}$/.test(countyFips)) return null;
  const key = process.env.CENSUS_API_KEY;

  const noAcs: { pop?: number; value?: number } = {};
  const noBls: { pct?: number; asOf?: string } = {};
  const [current, prior, unemployment] = await Promise.all([
    key
      ? acsRow(ACS_CURRENT, countyFips, key).catch(() => noAcs)
      : Promise.resolve(noAcs),
    key
      ? acsRow(ACS_PRIOR, countyFips, key).catch(() => noAcs)
      : Promise.resolve(noAcs),
    blsUnemployment(countyFips).catch(() => noBls),
  ]);

  const health: MarketHealth = {
    countyName,
    population: current.pop,
    populationChangePct5yr:
      current.pop && prior.pop ? pctChange(prior.pop, current.pop) : undefined,
    medianValue: current.value,
    valueChangePct5yr:
      current.value && prior.value
        ? pctChange(prior.value, current.value)
        : undefined,
    unemploymentPct: unemployment.pct,
    unemploymentAsOf: unemployment.asOf,
  };
  const hasAny =
    health.population !== undefined || health.unemploymentPct !== undefined;
  return hasAny ? health : null;
}

export async function getMarketHealth(countyFips: string, countyName: string): Promise<MarketHealth | null> {
  return cachedValue("bls_census", `market:${countyFips}`, TTL.bls, () =>
    getMarketHealthUncached(countyFips, countyName)
  );
}
