import { Client } from "pg";
import { databaseUrl } from "@/lib/dbUrl";
import { IngestError } from "@/lib/data/ingest";
import { normalizeParcelId } from "@/lib/data/matching/propertyMatcher";

// Greene County, OH ingestion — the county's open ArcGIS parcels layer is
// a single source for facts AND geometry (unlike Hamilton's three-file
// auditor export + separate CAGIS centroids). One paged sweep upserts
// canonical properties with typed facts + provenance and parcel centroids.
// Idempotent: unchanged rows are skipped via a content hash.

export const SOURCE_ID = "greene_county_parcels";
export const MARKET_ID = "greene_county_oh";
const PAGE_SIZE = 1000;
const OUT_FIELDS = [
  "Parcel_Number", "Parcel_Id", "Owner_Name", "Property_Address",
  "Address_City", "Address_State", "Address_ZipCode", "Acres",
  "Sale_Date", "Sale_Price", "Valid_Sale", "Class", "Land_Use",
  "School_District", "Year_Built", "Style", "Stories", "Bed_Rooms",
  "Full_Baths", "Half_Baths", "Living_Area", "Heat_Type",
  "Appraised_Total", "Assessed_Total", "Total_Taxes", "Taxing_District",
  "Tax_Year",
].join(",");

interface Feat {
  attributes: Record<string, unknown>;
  centroid?: { x: number; y: number };
}

async function serviceUrl(client: Client): Promise<string> {
  const r = await client.query(
    "SELECT api_url, enabled FROM data_sources WHERE id = $1", [SOURCE_ID]);
  if (!r.rows[0]?.enabled) throw new IngestError("forbidden", `${SOURCE_ID} disabled`);
  if (!r.rows[0].api_url) throw new IngestError("forbidden", `${SOURCE_ID} has no api_url`);
  return r.rows[0].api_url;
}

async function fetchPage(base: string, offset: number): Promise<Feat[]> {
  const params = new URLSearchParams({
    where: "Class='RESIDENTIAL'",
    outFields: OUT_FIELDS,
    returnGeometry: "false",
    returnCentroid: "true",
    outSR: "4326",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    orderByFields: "Parcel_Id",
    f: "json",
  });
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${base}/query?${params}`, {
        signal: AbortSignal.timeout(90_000),
        cache: "no-store",
      });
      if (res.status === 429) throw new IngestError("rate_limited", "arcgis 429");
      if (!res.ok) throw new Error(`arcgis transient ${res.status}`);
      const json = (await res.json()) as { features?: Feat[]; error?: { message?: string } };
      if (json.error) throw new IngestError("malformed_response", json.error.message ?? "arcgis error");
      return json.features ?? [];
    } catch (err) {
      if (attempt >= 3 || err instanceof IngestError) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v != null ? String(v) : "";
  return s === "" ? null : s;
};
const num = (v: unknown): number | null =>
  v == null || Number.isNaN(Number(v)) ? null : Number(v);
// epoch millis; the layer uses pre-1970 sentinels for "no sale"
const epochDate = (v: unknown): string | null => {
  const n = num(v);
  if (n == null || n <= 0) return null;
  return new Date(n).toISOString().slice(0, 10);
};

export interface GreeneIngestResult {
  runId: string;
  pages: number;
  seen: number;
  upserted: number;
  parcelsUpserted: number;
}

export async function ingestGreene(opts?: {
  maxRecords?: number;
  startOffset?: number;
}): Promise<GreeneIngestResult> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const base = await serviceUrl(client);
    const run = await client.query(
      `INSERT INTO ingestion_runs (source_id, market_id, metadata)
       VALUES ($1, $2, '{"mode":"single_source_facts"}') RETURNING id`,
      [SOURCE_ID, MARKET_ID]);
    const runId: string = run.rows[0].id;
    let offset = opts?.startOffset ?? 0, pages = 0, seen = 0, upserted = 0, parcelsUpserted = 0;
    const max = opts?.maxRecords ?? Number.POSITIVE_INFINITY;
    try {
      while (seen < max) {
        const feats = await fetchPage(base, offset);
        if (feats.length === 0) break;
        if (pages === 0 && !("Parcel_Number" in feats[0].attributes)) {
          throw new IngestError("source_schema_changed", "Parcel_Number missing");
        }
        pages++;

        const seenIds = new Set<string>();
        const rows: unknown[][] = [];
        for (const f of feats) {
          seen++;
          const a = f.attributes;
          const rawId = str(a.Parcel_Number) ?? str(a.Parcel_Id);
          if (!rawId) continue;
          const pid = normalizeParcelId(rawId);
          if (seenIds.has(pid)) continue;
          seenIds.add(pid);
          const beds = num(a.Bed_Rooms);
          const fullB = num(a.Full_Baths) ?? 0;
          const halfB = num(a.Half_Baths) ?? 0;
          const street = str(a.Property_Address)?.toUpperCase().replace(/\s+/g, " ") ?? null;
          rows.push([
            pid,
            street,
            str(a.Address_City)?.toUpperCase() ?? null,
            str(a.Address_ZipCode)?.slice(0, 5) ?? null,
            f.centroid?.y ?? null,
            f.centroid?.x ?? null,
            beds && beds > 0 ? beds : null,
            fullB + halfB > 0 ? fullB + 0.5 * halfB : null,
            num(a.Living_Area),
            num(a.Year_Built) || null,
            str(a.Style),
            str(a.Land_Use) ?? "RESIDENTIAL",
            str(a.Owner_Name),
            num(a.Acres) != null ? Math.round(num(a.Acres)! * 43560) : null,
            num(a.Total_Taxes) != null ? Math.round(num(a.Total_Taxes)! * 100) : null,
            num(a.Appraised_Total) != null ? Math.round(num(a.Appraised_Total)! * 100) : null,
            epochDate(a.Sale_Date),
            num(a.Sale_Price) && num(a.Sale_Price)! > 0 ? Math.round(num(a.Sale_Price)! * 100) : null,
          ]);
        }
        if (rows.length > 0) {
          const cols = 18;
          const values = rows.map((_, i) =>
            `(${Array.from({ length: cols }, (_, c) => `$${i * cols + c + 1}`).join(",")})`).join(",");
          const params = rows.flat();
          const up = await client.query(
            `INSERT INTO properties
               (market_id, canonical_parcel_id, street_address, city, postal_code,
                state, county_fips, normalized_address, latitude, longitude, geom,
                beds, baths, living_area_sqft, year_built, property_subtype,
                land_use, owner_name, lot_size_sqft, annual_taxes_cents,
                assessed_value_cents, last_sale_date, last_sale_cents,
                facts_source_id, facts_as_of, updated_at)
             SELECT '${MARKET_ID}', v.pid, v.street, v.city, v.zip,
                'OH', '39057',
                NULLIF(concat_ws('|', v.street, v.city, 'OH', v.zip), '|||'),
                v.lat::double precision, v.lon::double precision,
                CASE WHEN v.lat IS NOT NULL THEN
                  ST_SetSRID(ST_MakePoint(v.lon::double precision, v.lat::double precision), 4326) END,
                v.beds::numeric, v.baths::numeric, v.sqft::int, v.yr::int,
                v.style, v.landuse, v.owner,
                v.lot::int, v.taxc::int, v.apprc::bigint, v.saled::date, v.salec::bigint,
                '${SOURCE_ID}', CURRENT_DATE, now()
             FROM (VALUES ${values})
               AS v(pid, street, city, zip, lat, lon, beds, baths, sqft, yr,
                    style, landuse, owner, lot, taxc, apprc, saled, salec)
             ON CONFLICT (market_id, canonical_parcel_id) WHERE canonical_parcel_id IS NOT NULL
             DO UPDATE SET
               street_address = EXCLUDED.street_address, city = EXCLUDED.city,
               postal_code = EXCLUDED.postal_code,
               normalized_address = EXCLUDED.normalized_address,
               latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
               geom = EXCLUDED.geom, beds = EXCLUDED.beds, baths = EXCLUDED.baths,
               living_area_sqft = EXCLUDED.living_area_sqft,
               year_built = EXCLUDED.year_built,
               property_subtype = EXCLUDED.property_subtype,
               land_use = EXCLUDED.land_use, owner_name = EXCLUDED.owner_name,
               lot_size_sqft = EXCLUDED.lot_size_sqft,
               annual_taxes_cents = EXCLUDED.annual_taxes_cents,
               assessed_value_cents = EXCLUDED.assessed_value_cents,
               last_sale_date = EXCLUDED.last_sale_date,
               last_sale_cents = EXCLUDED.last_sale_cents,
               facts_source_id = EXCLUDED.facts_source_id,
               facts_as_of = EXCLUDED.facts_as_of, updated_at = now()
             WHERE (properties.beds, properties.baths, properties.living_area_sqft,
                    properties.annual_taxes_cents, properties.assessed_value_cents,
                    properties.last_sale_cents, properties.street_address,
                    properties.city, properties.postal_code)
               IS DISTINCT FROM
                   (EXCLUDED.beds, EXCLUDED.baths, EXCLUDED.living_area_sqft,
                    EXCLUDED.annual_taxes_cents, EXCLUDED.assessed_value_cents,
                    EXCLUDED.last_sale_cents, EXCLUDED.street_address,
                    EXCLUDED.city, EXCLUDED.postal_code)`,
            params
          );
          upserted += up.rowCount ?? 0;

          const centroidRows = rows.filter((r) => r[4] != null);
          if (centroidRows.length > 0) {
            const cvals = centroidRows.map((_, i) =>
              `($${i * 3 + 1}, $${i * 3 + 2}::double precision, $${i * 3 + 3}::double precision)`).join(",");
            const cparams = centroidRows.flatMap((r) => [r[0], r[4], r[5]]);
            const cp = await client.query(
              `INSERT INTO property_parcels
                 (property_id, source_id, source_parcel_id, normalized_parcel_id, centroid, retrieved_at)
               SELECT p.id, '${SOURCE_ID}', v.pid, v.pid,
                      ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326), now()
               FROM (VALUES ${cvals}) AS v(pid, lat, lon)
               JOIN properties p ON p.market_id = '${MARKET_ID}' AND p.canonical_parcel_id = v.pid
               ON CONFLICT (source_id, source_parcel_id) DO UPDATE SET
                 property_id = EXCLUDED.property_id, centroid = EXCLUDED.centroid,
                 retrieved_at = now()`,
              cparams
            );
            parcelsUpserted += cp.rowCount ?? 0;
          }
        }
        offset += feats.length;
        if (feats.length < PAGE_SIZE) break;
      }
      await client.query(
        `UPDATE ingestion_runs SET completed_at = now(), status = 'completed',
           records_seen = $2, records_updated = $3, cursor = $4 WHERE id = $1`,
        [runId, seen, upserted, String(offset)]);
      await client.query(
        `UPDATE data_sources SET last_successful_ingestion_at = now(),
           last_attempted_ingestion_at = now(), last_error = NULL, updated_at = now()
         WHERE id = $1`, [SOURCE_ID]);
      await client.query(
        `UPDATE markets SET last_ingested_at = now(), updated_at = now() WHERE id = $1`,
        [MARKET_ID]);
      return { runId, pages, seen, upserted, parcelsUpserted };
    } catch (err) {
      await client.query(
        `UPDATE ingestion_runs SET completed_at = now(), status = 'failed',
           records_seen = $2, cursor = $3 WHERE id = $1`,
        [runId, seen, String(offset)]).catch(() => {});
      await client.query(
        `UPDATE data_sources SET last_attempted_ingestion_at = now(),
           last_error = $2, updated_at = now() WHERE id = $1`,
        [SOURCE_ID, err instanceof Error ? err.message.slice(0, 500) : "unknown"]).catch(() => {});
      throw err;
    }
  } finally {
    await client.end();
  }
}
