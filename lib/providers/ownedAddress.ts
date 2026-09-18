import { sql } from "@/lib/sql";
import type {
  AddressProvider,
  AddressSuggestion,
  ResolvedAddress,
} from "./types";

// Owned typeahead (Phase 5 step 4): serves address autocomplete straight
// from PropPencil's own properties table via the pg_trgm GIN index
// (properties_street_trgm_idx) — free, fast, and exactly the coverage we
// actually have. Replaces Regrid in the default priority; the Regrid
// adapter file remains for opt-in via PROVIDER_PRIORITY_JSON.

const NAME = "owned";

interface Row {
  id: string;
  street_address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  county_fips: string | null;
  latitude: number | null;
  longitude: number | null;
  canonical_parcel_id: string | null;
  sim: number;
}

function display(r: Row): string {
  return [r.street_address, r.city ?? "HAMILTON COUNTY", r.state, r.postal_code]
    .filter(Boolean)
    .join(", ");
}

export const ownedAddressProvider: AddressProvider = {
  name: NAME,
  async autocomplete(query): Promise<AddressSuggestion[]> {
    if (!process.env.DATABASE_URL) return [];
    const q = query.toUpperCase().replace(/\s+/g, " ").trim();
    if (q.length < 3) return [];
    // Prefix ILIKE hits the trgm index; similarity orders the result.
    const rows = (await sql()`
      SELECT id, street_address, city, state, postal_code, county_fips,
             latitude, longitude, canonical_parcel_id,
             similarity(street_address, ${q}) AS sim
      FROM properties
      WHERE market_id = 'hamilton_county_oh'
        AND street_address ILIKE ${"%" + q + "%"}
      ORDER BY sim DESC, street_address ASC
      LIMIT 8
    `) as Row[];
    return rows.map((r) => ({
      provider: NAME,
      providerId: r.id,
      displayAddress: display(r),
      city: r.city ?? undefined,
      state: r.state ?? undefined,
      postalCode: r.postal_code ?? undefined,
      latitude: r.latitude ?? undefined,
      longitude: r.longitude ?? undefined,
      matchScore: r.sim,
    }));
  },
  async resolve(s): Promise<ResolvedAddress> {
    const rows = (await sql()`
      SELECT id, street_address, city, state, postal_code, county_fips,
             latitude, longitude, canonical_parcel_id, 1.0 AS sim
      FROM properties WHERE id = ${s.providerId}::uuid
    `) as Row[];
    const r = rows[0];
    if (!r) throw new Error("owned property not found");
    return {
      streetAddress: r.street_address ?? "",
      city: r.city ?? "",
      state: r.state ?? "OH",
      postalCode: r.postal_code ?? undefined,
      countyFips: r.county_fips ?? undefined,
      latitude: r.latitude ?? undefined,
      longitude: r.longitude ?? undefined,
      provider: NAME,
      providerId: s.providerId,
      parcelId: r.canonical_parcel_id ?? undefined,
      normalizedAddress: display(r).toUpperCase(),
    };
  },
};

export const ownedProviders = { address: ownedAddressProvider };
