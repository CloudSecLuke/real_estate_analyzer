import { dataSql, ensureDataSchema } from "@/lib/data/schema";
import {
  normalizeAddress,
  streetSimilarity,
  type NormalizedAddress,
} from "@/lib/data/normalization/address";

// Property matching / canonical identity resolution (PROP-38; spec §8, §22,
// §74). Levels, strongest first: parcel exact → address+ZIP → address+
// city/state → geospatial → fuzzy. Weak matches are never silently
// accepted — below the auto-accept threshold the caller gets candidates
// and an "ambiguous" status.

export type MatchMethod =
  | "parcel_exact"
  | "address_zip_exact"
  | "address_city_exact"
  | "geospatial"
  | "fuzzy_address"
  | "created"
  | "none";

export interface MatchCandidate {
  propertyId: string;
  score: number;
  method: MatchMethod;
  address?: string;
}

export interface PropertyResolution {
  status: "matched" | "created" | "ambiguous" | "not_found";
  propertyId?: string;
  score?: number;
  method?: MatchMethod;
  confidence?: "very_high" | "high" | "medium" | "low";
  candidates?: MatchCandidate[];
}

export interface PropertyLookupInput {
  marketId: string;
  parcelId?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  /** Create a canonical property when nothing matches. */
  createIfMissing?: boolean;
}

const AUTO_ACCEPT = 0.95;
const FUZZY_FLOOR = 0.75;

export function confidenceFor(score: number): "very_high" | "high" | "medium" | "low" {
  if (score >= 0.98) return "very_high";
  if (score >= 0.9) return "high";
  if (score >= 0.75) return "medium";
  return "low";
}

/** Normalize parcel ids the same way everywhere: strip punctuation/space,
 *  uppercase. Hamilton County book-page-parcel formats survive intact. */
export function normalizeParcelId(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

interface PropertyRow {
  id: string;
  normalized_address: string | null;
  street_address: string | null;
}

export async function resolveProperty(
  input: PropertyLookupInput
): Promise<PropertyResolution> {
  await ensureDataSchema();
  const sql = dataSql();

  // Level 1 — exact normalized parcel id
  if (input.parcelId) {
    const pid = normalizeParcelId(input.parcelId);
    const rows = (await sql`
      SELECT id FROM properties
      WHERE market_id = ${input.marketId} AND canonical_parcel_id = ${pid}
      LIMIT 1
    `) as { id: string }[];
    if (rows[0]) {
      return {
        status: "matched",
        propertyId: rows[0].id,
        score: 1,
        method: "parcel_exact",
        confidence: "very_high",
      };
    }
  }

  const norm = input.address ? normalizeAddress(input.address) : null;

  // Level 2 — exact street + ZIP
  if (norm?.streetKey && norm.postalCode) {
    const key = `${norm.streetKey}|${norm.postalCode}`;
    const rows = (await sql`
      SELECT id FROM properties
      WHERE market_id = ${input.marketId}
        AND normalized_address LIKE ${norm.streetKey + "|%"}
        AND postal_code = ${norm.postalCode}
      LIMIT 2
    `) as { id: string }[];
    if (rows.length === 1) {
      return {
        status: "matched",
        propertyId: rows[0].id,
        score: 0.99,
        method: "address_zip_exact",
        confidence: "very_high",
      };
    }
    void key;
  }

  // Level 3 — exact street + city/state
  if (norm?.streetKey && norm.city && norm.state) {
    const rows = (await sql`
      SELECT id FROM properties
      WHERE market_id = ${input.marketId}
        AND normalized_address LIKE ${norm.streetKey + "|%"}
        AND city = ${norm.city} AND state = ${norm.state}
      LIMIT 2
    `) as { id: string }[];
    if (rows.length === 1) {
      return {
        status: "matched",
        propertyId: rows[0].id,
        score: 0.96,
        method: "address_city_exact",
        confidence: "high",
      };
    }
  }

  // Level 4 — geospatial proximity (25m: same-rooftop territory)
  if (input.latitude != null && input.longitude != null) {
    const rows = (await sql`
      SELECT id, normalized_address, street_address,
             ST_Distance(geom::geography,
               ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)::geography) AS dist_m
      FROM properties
      WHERE market_id = ${input.marketId} AND geom IS NOT NULL
        AND ST_DWithin(geom::geography,
              ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)::geography, 25)
      ORDER BY dist_m ASC
      LIMIT 3
    `) as (PropertyRow & { dist_m: number })[];
    if (rows.length === 1 && rows[0].dist_m < 15) {
      return {
        status: "matched",
        propertyId: rows[0].id,
        score: 0.95,
        method: "geospatial",
        confidence: "high",
      };
    }
    if (rows.length > 0) {
      // multiple rooftop-distance candidates → never auto-pick
      return {
        status: "ambiguous",
        candidates: rows.map((r) => ({
          propertyId: r.id,
          score: Math.max(0.5, 0.95 - r.dist_m / 100),
          method: "geospatial" as const,
          address: r.street_address ?? undefined,
        })),
      };
    }
  }

  // Level 5 — fuzzy street match within the market (+ZIP narrows)
  if (norm?.streetKey) {
    const rows = (await (norm.postalCode
      ? sql`SELECT id, normalized_address, street_address FROM properties
            WHERE market_id = ${input.marketId} AND postal_code = ${norm.postalCode}
            LIMIT 500`
      : sql`SELECT id, normalized_address, street_address FROM properties
            WHERE market_id = ${input.marketId} AND city = ${norm.city ?? ""}
            LIMIT 500`)) as PropertyRow[];
    const scored = rows
      .map((r) => ({
        row: r,
        score: fuzzyScore(norm, r),
      }))
      .filter((x) => x.score >= FUZZY_FLOOR)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    if (scored[0] && scored[0].score >= AUTO_ACCEPT && (!scored[1] || scored[1].score < FUZZY_FLOOR + 0.1)) {
      return {
        status: "matched",
        propertyId: scored[0].row.id,
        score: scored[0].score,
        method: "fuzzy_address",
        confidence: confidenceFor(scored[0].score),
      };
    }
    if (scored.length > 0) {
      return {
        status: "ambiguous",
        candidates: scored.map((x) => ({
          propertyId: x.row.id,
          score: Math.round(x.score * 1000) / 1000,
          method: "fuzzy_address" as const,
          address: x.row.street_address ?? undefined,
        })),
      };
    }
  }

  if (!input.createIfMissing) return { status: "not_found" };
  return createProperty(input, norm);
}

function fuzzyScore(subject: NormalizedAddress, row: PropertyRow): number {
  const rowStreetKey = row.normalized_address?.split("|")[0] ?? "";
  const rowNorm = {
    ...normalizeAddress(rowStreetKey),
    streetKey: rowStreetKey,
    houseNumber: rowStreetKey.split(" ")[0],
  } as NormalizedAddress;
  return streetSimilarity(subject, rowNorm);
}

async function createProperty(
  input: PropertyLookupInput,
  norm: NormalizedAddress | null
): Promise<PropertyResolution> {
  const sql = dataSql();
  const pid = input.parcelId ? normalizeParcelId(input.parcelId) : null;
  const rows = (await sql`
    INSERT INTO properties
      (market_id, canonical_parcel_id, normalized_address, street_address,
       city, state, postal_code, latitude, longitude, geom)
    VALUES
      (${input.marketId}, ${pid}, ${norm?.key ?? null}, ${norm?.streetKey ?? null},
       ${norm?.city ?? null}, ${norm?.state ?? null}, ${norm?.postalCode ?? null},
       ${input.latitude ?? null}, ${input.longitude ?? null},
       ${input.longitude != null && input.latitude != null
         ? `SRID=4326;POINT(${input.longitude} ${input.latitude})`
         : null})
    ON CONFLICT (market_id, canonical_parcel_id) WHERE canonical_parcel_id IS NOT NULL
    DO UPDATE SET updated_at = now()
    RETURNING id
  `) as { id: string }[];
  return {
    status: "created",
    propertyId: rows[0].id,
    score: 1,
    method: "created",
    confidence: "very_high",
  };
}
