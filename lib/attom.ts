import type { AttomData } from "./types";
import { cachedValue, TTL } from "@/lib/providerCache";

// ATTOM Data property API — optional enhancement layer. Free trial key at
// https://api.developer.attomdata.com/ (paid after trial). Without a key,
// or when a lookup fails, the app falls back to HUD FMR rents and
// statewide tax-rate estimates, so this must never be load-bearing.
const BASE = "https://api.gateway.attomdata.com/propertyapi/v1.0.0";

/* eslint-disable @typescript-eslint/no-explicit-any */

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

async function attomFetch(
  path: string,
  address1: string,
  address2: string,
  key: string
): Promise<any | null> {
  const params = new URLSearchParams({ address1, address2 });
  const res = await fetch(`${BASE}/${path}?${params}`, {
    headers: { Accept: "application/json", apikey: key },
  });
  if (res.status === 401) {
    throw new Error(
      "ATTOM API key was rejected (401). Verify the key is activated on your ATTOM developer dashboard."
    );
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    // ATTOM reports "address not in their data" as a 400 SuccessWithoutResult
    const msg: string =
      json?.status?.msg ?? json?.Response?.status?.msg ?? "";
    if (/SuccessWithoutResult/i.test(msg)) return null;
    throw new Error(`ATTOM ${path} returned ${res.status}`);
  }
  return json?.property?.[0] ?? null;
}

function parseAllEvents(p: any): AttomData {
  const building = p?.building ?? {};
  const assessment = p?.assessment ?? {};
  const avm = p?.avm?.amount ?? {};
  const sale = p?.sale ?? {};
  return {
    beds: num(building.rooms?.beds),
    baths: num(building.rooms?.bathstotal ?? building.rooms?.bathsfull),
    sqft: num(
      building.size?.universalsize ??
        building.size?.livingsize ??
        building.size?.bldgsize
    ),
    yearBuilt: num(p?.summary?.yearbuilt),
    propertyType: p?.summary?.propclass ?? p?.summary?.proptype ?? undefined,
    assessedValue: num(assessment.assessed?.assdttlvalue),
    marketValue: num(assessment.market?.mktttlvalue),
    annualTaxAmount: num(assessment.tax?.taxamt),
    taxYear: num(assessment.tax?.taxyear),
    avmValue: num(avm.value),
    avmLow: num(avm.low),
    avmHigh: num(avm.high),
    avmConfidence: num(avm.scr),
    lastSalePrice: num(sale.amount?.saleamt),
    lastSaleDate: sale.salesearchdate ?? sale.saleTransDate ?? undefined,
  };
}

// The rental AVM response shape varies by package; check the documented
// field names first, then AVM-style fallbacks.
function parseRentalAvm(p: any): AttomData {
  const r = p?.rental ?? p?.rentalAvm ?? {};
  return {
    rentalAvm: num(r.estimatedRentalValue ?? r.amount?.value ?? p?.avm?.amount?.value),
    rentalAvmLow: num(r.estimatedMinRentalValue ?? r.amount?.low ?? p?.avm?.amount?.low),
    rentalAvmHigh: num(r.estimatedMaxRentalValue ?? r.amount?.high ?? p?.avm?.amount?.high),
  };
}

function hasData(d: AttomData): boolean {
  return Object.values(d).some((v) => v !== undefined);
}

/**
 * Look up property characteristics, actual tax bill, AVM and rental AVM for
 * a geocoder-matched address ("STREET, CITY, STATE, ZIP"). Returns null when
 * no key is configured or ATTOM has no record; throws only when every
 * request failed (e.g. bad key), so partial data still comes through.
 */
async function getAttomDataUncached(
  matchedAddress: string
): Promise<AttomData | null> {
  const key = process.env.ATTOM_API_KEY;
  if (!key) return null;

  const [street, ...rest] = matchedAddress.split(",");
  const address1 = street?.trim() ?? "";
  const address2 = rest.join(",").trim();
  if (!address1 || !address2) return null;

  // One allevents call covers characteristics + assessment + AVM + sale,
  // keeping per-analysis usage to two calls against the trial allowance.
  const [events, rental] = await Promise.all([
    attomFetch("allevents/detail", address1, address2, key).catch(
      (e: Error) => e
    ),
    attomFetch("valuation/rentalavm", address1, address2, key).catch(
      (e: Error) => e
    ),
  ]);
  if (events instanceof Error && rental instanceof Error) throw events;

  const data: AttomData = {
    ...(events instanceof Error || !events ? {} : parseAllEvents(events)),
    ...(rental instanceof Error || !rental ? {} : parseRentalAvm(rental)),
  };
  return hasData(data) ? data : null;
}

export async function getAttomData(matchedAddress: string): Promise<AttomData | null> {
  return cachedValue("attom", `property:${matchedAddress.toUpperCase()}`, TTL.attomProperty, () =>
    getAttomDataUncached(matchedAddress)
  );
}

/** Rent-only ATTOM call for the Hamilton short-circuit (Phase 4 step 5):
 *  property facts come from the Auditor there, so only valuation/rentalavm
 *  is spent — one call instead of two, and no property/tax lookup. */
async function getAttomRentalAvmUncached(
  matchedAddress: string
): Promise<AttomData | null> {
  const key = process.env.ATTOM_API_KEY;
  if (!key) return null;
  const [street, ...rest] = matchedAddress.split(",");
  const address1 = street?.trim() ?? "";
  const address2 = rest.join(",").trim();
  if (!address1 || !address2) return null;
  const rental = await attomFetch("valuation/rentalavm", address1, address2, key);
  if (!rental) return null;
  const data: AttomData = { ...parseRentalAvm(rental) };
  return data.rentalAvm != null ? data : null;
}

export async function getAttomRentalAvm(matchedAddress: string): Promise<AttomData | null> {
  return cachedValue("attom", `rentalavm:${matchedAddress.toUpperCase()}`, TTL.rentcastRent, () =>
    getAttomRentalAvmUncached(matchedAddress)
  );
}
