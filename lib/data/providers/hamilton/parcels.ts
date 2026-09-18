import { Client } from "pg";
import { databaseUrl } from "@/lib/dbUrl";
import { IngestError } from "@/lib/data/ingest";
import { normalizeParcelId } from "@/lib/data/matching/propertyMatcher";

// Hamilton County CAGIS parcels — CENTROIDS ONLY (CLAUDE_CODE_BRIEF Phase 2
// step 7). Property FACTS come from the Auditor bulk exports
// (scripts/ingest-hamilton-auditor.ts); this provider exists solely to give
// those properties coordinates: properties.latitude/longitude/geom and
// property_parcels.centroid. CAGIS AUDPCLID (11 digits) is the prefix of
// the auditor's 13-digit parcel number (2-digit unit suffix), so the join
// is on left(canonical_parcel_id, 11) — one centroid serves every unit on
// the parcel. Batches of
// 1000 with ONE multi-row statement per page over pg — no per-record round
// trips, no raw payload storage, no data_points writes.

export const SOURCE_ID = "hamilton_county_parcels";
export const MARKET_ID = "hamilton_county_oh";
const PAGE_SIZE = 1000;

interface ArcgisFeature {
  attributes: { AUDPCLID?: unknown; PARCELID?: unknown };
  centroid?: { x: number; y: number };
}

async function serviceUrl(client: Client): Promise<string> {
  const r = await client.query(
    "SELECT api_url, enabled FROM data_sources WHERE id = $1",
    [SOURCE_ID]
  );
  if (!r.rows[0]?.enabled) {
    throw new IngestError("forbidden", `${SOURCE_ID} is disabled in data_sources`);
  }
  if (!r.rows[0].api_url) {
    throw new IngestError("forbidden", `${SOURCE_ID} has no api_url configured`);
  }
  return r.rows[0].api_url;
}

async function fetchPage(base: string, offset: number): Promise<ArcgisFeature[]> {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "AUDPCLID,PARCELID",
    returnGeometry: "false",
    returnCentroid: "true",
    outSR: "4326",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    f: "json",
  });
  // Native fetch has NO default timeout — a dropped connection hangs the
  // sweep forever (observed at ~page 102). Bounded timeout + one retry.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${base}/query?${params}`, {
        signal: AbortSignal.timeout(90_000),
      });
      if (res.status === 429) throw new IngestError("rate_limited", "arcgis 429");
      if (!res.ok) throw new IngestError("temporary_failure", `arcgis ${res.status}`);
      const json = (await res.json()) as { features?: ArcgisFeature[]; error?: { message?: string } };
      if (json.error) throw new IngestError("malformed_response", json.error.message ?? "arcgis error");
      return json.features ?? [];
    } catch (err) {
      if (attempt >= 3 || err instanceof IngestError) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

export interface CentroidIngestResult {
  runId: string;
  pages: number;
  seen: number;
  propertiesUpdated: number;
  parcelsUpserted: number;
}

/** Sweep the CAGIS layer and attach centroids to canonical properties.
 *  Idempotent; safe to re-run monthly after the auditor load. */
export async function ingestHamiltonCentroids(opts?: {
  maxRecords?: number;
  startOffset?: number;
}): Promise<CentroidIngestResult> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const base = await serviceUrl(client);
    const run = await client.query(
      `INSERT INTO ingestion_runs (source_id, market_id, metadata)
       VALUES ($1, $2, '{"mode":"centroids_only"}') RETURNING id`,
      [SOURCE_ID, MARKET_ID]
    );
    const runId: string = run.rows[0].id;

    let offset = opts?.startOffset ?? 0, pages = 0, seen = 0, propertiesUpdated = 0, parcelsUpserted = 0;
    const max = opts?.maxRecords ?? Number.POSITIVE_INFINITY;
    try {
      while (seen < max) {
        const feats = await fetchPage(base, offset);
        if (feats.length === 0) break;
        if (pages === 0 && feats[0] && !("AUDPCLID" in feats[0].attributes)) {
          throw new IngestError("source_schema_changed", "AUDPCLID missing from ArcGIS response");
        }
        pages++;

        const rows: { pid: string; raw: string; lat: number; lon: number }[] = [];
        const seenIds = new Set<string>();
        for (const f of feats) {
          seen++;
          const raw = String(f.attributes.AUDPCLID ?? f.attributes.PARCELID ?? "").trim();
          const lat = f.centroid?.y, lon = f.centroid?.x;
          if (!raw || lat == null || lon == null) continue;
          const pid = normalizeParcelId(raw);
          if (seenIds.has(pid)) continue; // duplicate source records occur
          seenIds.add(pid);
          rows.push({ pid, raw, lat, lon });
        }
        if (rows.length > 0) {
          // one VALUES list per page for both statements
          const values: string[] = [];
          const params: unknown[] = [];
          rows.forEach((r, i) => {
            const b = i * 4;
            values.push(`($${b + 1}, $${b + 2}, $${b + 3}::double precision, $${b + 4}::double precision)`);
            params.push(r.pid, r.raw, r.lat, r.lon);
          });
          const v = `(VALUES ${values.join(",")}) AS v(pid, raw_id, lat, lon)`;

          const upd = await client.query(
            `UPDATE properties p SET
               latitude = v.lat, longitude = v.lon,
               geom = ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326),
               updated_at = now()
             FROM ${v}
             WHERE p.market_id = '${MARKET_ID}' AND left(p.canonical_parcel_id, 11) = v.pid
               AND (p.latitude IS DISTINCT FROM v.lat OR p.longitude IS DISTINCT FROM v.lon)`,
            params
          );
          propertiesUpdated += upd.rowCount ?? 0;

          const ups = await client.query(
            `INSERT INTO property_parcels
               (property_id, source_id, source_parcel_id, normalized_parcel_id, centroid, retrieved_at)
             SELECT p.id, '${SOURCE_ID}', v.raw_id, v.pid,
                    ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326), now()
             FROM ${v}
             JOIN LATERAL (
               SELECT id FROM properties
               WHERE market_id = '${MARKET_ID}' AND left(canonical_parcel_id, 11) = v.pid
               ORDER BY canonical_parcel_id LIMIT 1
             ) p ON true
             ON CONFLICT (source_id, source_parcel_id) DO UPDATE SET
               property_id = EXCLUDED.property_id,
               normalized_parcel_id = EXCLUDED.normalized_parcel_id,
               centroid = EXCLUDED.centroid,
               retrieved_at = now()`,
            params
          );
          parcelsUpserted += ups.rowCount ?? 0;
        }
        offset += feats.length;
        if (feats.length < PAGE_SIZE) break;
      }

      await client.query(
        `UPDATE ingestion_runs SET completed_at = now(), status = 'completed',
           records_seen = $2, records_updated = $3, cursor = $4 WHERE id = $1`,
        [runId, seen, propertiesUpdated, String(offset)]
      );
      await client.query(
        `UPDATE data_sources SET last_successful_ingestion_at = now(),
           last_attempted_ingestion_at = now(), last_error = NULL, updated_at = now()
         WHERE id = $1`,
        [SOURCE_ID]
      );
      return { runId, pages, seen, propertiesUpdated, parcelsUpserted };
    } catch (err) {
      await client.query(
        `UPDATE ingestion_runs SET completed_at = now(), status = 'failed',
           records_seen = $2, cursor = $3 WHERE id = $1`,
        [runId, seen, String(offset)]
      ).catch(() => {});
      await client.query(
        `UPDATE data_sources SET last_attempted_ingestion_at = now(),
           last_error = $2, updated_at = now() WHERE id = $1`,
        [SOURCE_ID, err instanceof Error ? err.message.slice(0, 500) : "unknown"]
      ).catch(() => {});
      throw err;
    }
  } finally {
    await client.end();
  }
}
