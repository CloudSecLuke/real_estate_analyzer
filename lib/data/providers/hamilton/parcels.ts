import { dataSql, ensureDataSchema } from "@/lib/data/schema";
import {
  assertSourceFields,
  finishIngestionRun,
  IngestError,
  startIngestionRun,
  storeRawRecord,
} from "@/lib/data/ingest";
import { resolveProperty, normalizeParcelId } from "@/lib/data/matching/propertyMatcher";

// Hamilton County parcel ingestion (PROP-39; spec §20). Source: the CAGIS
// Open Data "Hamilton County Parcels" ArcGIS feature service — endpoint and
// license live in the data_sources row, not in code. License reviewed
// 2026-09-15: as-is warranty disclaimer, no use restriction found in
// licenseInfo (docs/data-sources.md). One layer carries parcel ids, situs
// address, owner, assessor market values, last sale, acreage.

export const SOURCE_ID = "hamilton_county_parcels";
export const MARKET_ID = "hamilton_county_oh";
const PARSER_VERSION = "hamilton-parcels-1.0.0";
const PAGE_SIZE = 1000;

interface ArcgisFeature {
  attributes: Record<string, unknown>;
  centroid?: { x: number; y: number };
}

async function serviceUrl(): Promise<string> {
  await ensureDataSchema();
  const rows = (await dataSql()`
    SELECT api_url, enabled FROM data_sources WHERE id = ${SOURCE_ID}
  `) as { api_url: string | null; enabled: boolean }[];
  if (!rows[0]?.enabled) {
    throw new IngestError("forbidden", `${SOURCE_ID} is disabled in data_sources`);
  }
  if (!rows[0].api_url) {
    throw new IngestError("forbidden", `${SOURCE_ID} has no api_url configured`);
  }
  return rows[0].api_url;
}

async function fetchPage(base: string, offset: number, limit: number): Promise<ArcgisFeature[]> {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "*",
    returnGeometry: "false",
    returnCentroid: "true",
    outSR: "4326",
    resultOffset: String(offset),
    resultRecordCount: String(limit),
    f: "json",
  });
  const res = await fetch(`${base}/query?${params}`);
  if (res.status === 429) throw new IngestError("rate_limited", "arcgis 429");
  if (!res.ok) throw new IngestError("temporary_failure", `arcgis ${res.status}`);
  const json = (await res.json()) as { features?: ArcgisFeature[]; error?: { message?: string } };
  if (json.error) throw new IngestError("malformed_response", json.error.message ?? "arcgis error");
  return json.features ?? [];
}

function str(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : v != null ? String(v) : "";
  return s === "" ? null : s;
}

function situsAddress(a: Record<string, unknown>): string | null {
  const parts = [str(a.ADDRNO), str(a.LOC_ST_DIR), str(a.ADDRST), str(a.ADDRSF)].filter(Boolean);
  return parts.length >= 2 ? parts.join(" ") : null;
}

export interface HamiltonIngestResult {
  runId: string;
  seen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  failed: number;
  propertiesTouched: number;
}

/** Ingest Hamilton County parcels. `maxRecords` bounds the run (smoke
 *  tests / staged backfills); omit for a full sweep. Safe to re-run. */
export async function ingestHamiltonParcels(opts?: {
  maxRecords?: number;
  startOffset?: number;
}): Promise<HamiltonIngestResult> {
  const base = await serviceUrl();
  const runId = await startIngestionRun(SOURCE_ID, MARKET_ID);
  const sql = dataSql();
  let seen = 0, inserted = 0, updated = 0, unchanged = 0, failed = 0, propertiesTouched = 0;
  let offset = opts?.startOffset ?? 0;
  const max = opts?.maxRecords ?? Number.POSITIVE_INFINITY;

  try {
    while (seen < max) {
      const page = await fetchPage(base, offset, Math.min(PAGE_SIZE, max - seen));
      if (page.length === 0) break;
      // schema-change guard on the first record of each run (spec §105)
      assertSourceFields(page[0].attributes, ["PARCELID", "ADDRST", "OWNNM1"], SOURCE_ID);

      for (const f of page) {
        seen++;
        try {
          const a = f.attributes;
          const parcelId = str(a.AUDPCLID) ?? str(a.PARCELID);
          if (!parcelId) { failed++; continue; }

          const stored = await storeRawRecord({
            sourceId: SOURCE_ID,
            recordType: "parcel",
            externalRecordId: normalizeParcelId(parcelId),
            payload: a,
            ingestionRunId: runId,
            parserVersion: PARSER_VERSION,
          });
          if (stored.outcome === "inserted") inserted++;
          else if (stored.outcome === "updated") updated++;
          else { unchanged++; continue; } // unchanged → nothing downstream to redo

          const situs = situsAddress(a);
          const lat = f.centroid?.y, lon = f.centroid?.x;
          const resolution = await resolveProperty({
            marketId: MARKET_ID,
            parcelId,
            address: situs ? `${situs}, Cincinnati, OH` : undefined,
            latitude: lat,
            longitude: lon,
            createIfMissing: true,
          });
          const propertyId = resolution.propertyId ?? null;
          if (propertyId) propertiesTouched++;

          await sql`
            INSERT INTO property_parcels
              (property_id, source_id, source_parcel_id, normalized_parcel_id, apn,
               situs_address, owner, land_use, acreage, centroid, source_updated_at)
            VALUES
              (${propertyId}, ${SOURCE_ID}, ${parcelId}, ${normalizeParcelId(parcelId)},
               ${str(a.PARCELID)}, ${situs}, ${str(a.OWNNM1)}, ${str(a.CLASS)},
               ${a.ACREDEED != null ? Number(a.ACREDEED) : null},
               ${lat != null && lon != null ? `SRID=4326;POINT(${lon} ${lat})` : null},
               now())
            ON CONFLICT (source_id, source_parcel_id) DO UPDATE SET
              property_id = EXCLUDED.property_id,
              situs_address = EXCLUDED.situs_address,
              owner = EXCLUDED.owner,
              land_use = EXCLUDED.land_use,
              acreage = EXCLUDED.acreage,
              centroid = EXCLUDED.centroid,
              retrieved_at = now()
          `;

          // public-record data points with provenance (spec §12)
          if (propertyId) {
            const points: Array<[string, unknown, string]> = [];
            if (str(a.OWNNM1)) points.push(["owner_name", str(a.OWNNM1), "string"]);
            if (a.MKTLND != null || a.MKTIMP != null) {
              points.push(["assessed_market_value", Number(a.MKTLND ?? 0) + Number(a.MKTIMP ?? 0), "number"]);
            }
            if (a.SALAMT != null && Number(a.SALAMT) > 0) points.push(["last_sale_price", Number(a.SALAMT), "number"]);
            if (str(a.SALDAT)) points.push(["last_sale_date", str(a.SALDAT), "string"]);
            if (a.ACREDEED != null) points.push(["lot_size_acres", Number(a.ACREDEED), "number"]);
            for (const [field, value, vtype] of points) {
              await sql`
                UPDATE data_points SET is_current = false
                WHERE property_id = ${propertyId}::uuid AND field_name = ${field}
                  AND source_id = ${SOURCE_ID} AND is_current = true
              `;
              await sql`
                INSERT INTO data_points
                  (property_id, field_name, value, value_type, value_class,
                   source_id, source_record_id, confidence, method)
                VALUES
                  (${propertyId}::uuid, ${field}, ${JSON.stringify(value)}::jsonb, ${vtype},
                   'verified', ${SOURCE_ID}, ${stored.id}::uuid, 0.92, 'public_record')
              `;
            }
          }
        } catch (err) {
          failed++;
          if (err instanceof IngestError && err.kind === "source_schema_changed") throw err;
          console.error("hamilton_parcel_record_failed", err instanceof Error ? err.message : err);
        }
      }
      offset += page.length;
      if (page.length < PAGE_SIZE) break;
    }

    await finishIngestionRun(runId, failed > 0 ? "partial" : "completed",
      { seen, inserted, updated, skipped: unchanged, failed },
      { cursor: String(offset) });
    return { runId, seen, inserted, updated, unchanged, failed, propertiesTouched };
  } catch (err) {
    await finishIngestionRun(runId, "failed",
      { seen, inserted, updated, skipped: unchanged, failed },
      { cursor: String(offset), error: err instanceof Error ? err.message : "unknown" });
    throw err;
  }
}
