import type { GeocodeResult } from "./types";
import { cachedValue, TTL } from "@/lib/providerCache";

// U.S. Census Bureau geocoder — free, no API key, and returns the county
// FIPS code we need for the HUD FMR lookup in the same call.
// Docs: https://geocoding.geo.census.gov/geocoder/
const CENSUS_URL =
  "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";

async function geocodeAddressUncached(address: string): Promise<GeocodeResult> {
  const params = new URLSearchParams({
    address,
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    layers: "Counties",
    format: "json",
  });
  const res = await fetch(`${CENSUS_URL}?${params}`);
  if (!res.ok) throw new Error(`Census geocoder returned ${res.status}`);
  const json = await res.json();
  const match = json?.result?.addressMatches?.[0];
  if (!match) {
    throw new Error(
      "Address not found. Try the full street address with city, state and ZIP."
    );
  }
  const county = match.geographies?.Counties?.[0];
  if (!county?.GEOID) throw new Error("Could not resolve county for address.");
  return {
    matchedAddress: match.matchedAddress,
    lat: match.coordinates.y,
    lon: match.coordinates.x,
    zip: match.addressComponents?.zip ?? "",
    state: match.addressComponents?.state ?? "",
    countyFips: county.GEOID,
    countyName: county.NAME ?? county.BASENAME ?? "",
  };
}

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  return cachedValue("census_geocoder", `geo:${address.toUpperCase().trim()}`, TTL.address, () =>
    geocodeAddressUncached(address)
  );
}
