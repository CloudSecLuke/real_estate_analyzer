import { Client } from "pg";
import { databaseUrl } from "@/lib/dbUrl";
import { IngestError } from "@/lib/data/ingest";
import { normalizeParcelId } from "@/lib/data/matching/propertyMatcher";

// Generic Ohio centroid sweep from the GeOhio Statewide Parcels layer.
// Works for any Ohio county whose canonical_parcel_id normalizes to the
// state's LocalParcelID (Greene: exact match; add per-county key mapping
// here if a future county differs). Reused pattern from the Hamilton
// CAGIS sweep: 1000-row pages, one multi-row statement per page, fetch
// timeout + transient retry + offset resume.

export const SOURCE_ID = "geohio_statewide_parcels";
const PAGE_SIZE = 1000;

interface Feat {
  attributes: { LocalParcelID?: unknown };
  centroid?: { x: number; y: number };
}

async function serviceUrl(client: Client): Promise<string> {
  const r = await client.query(
    "SELECT api_url, enabled FROM data_sources WHERE id = $1", [SOURCE_ID]);
  if (!r.rows[0]?.enabled) throw new IngestError("forbidden", `${SOURCE_ID} disabled`);
  return r.rows[0].api_url;
}

async function fetchPage(base: string, county: string, offset: number): Promise<Feat[]> {
  const params = new URLSearchParams({
    where: `County='${county}'`,
    outFields: "LocalParcelID",
    returnGeometry: "false",
    returnCentroid: "true",
    outSR: "4326",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    orderByFields: "OBJECTID",
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
      // Hosted ArcGIS error payloads are usually transient — retry like a 5xx.
      if (json.error) throw new Error(`arcgis error payload: ${json.error.message ?? "unknown"}`);
      return json.features ?? [];
    } catch (err) {
      if (attempt >= 3 || err instanceof IngestError) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

export async function ingestOhioCentroids(args: {
  county: string; // GeOhio County field value, e.g. "Greene"
  marketId: string;
  maxRecords?: number;
  startOffset?: number;
}): Promise<{ runId: string; pages: number; seen: number; propertiesUpdated: number }> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const base = await serviceUrl(client);
    const run = await client.query(
      `INSERT INTO ingestion_runs (source_id, market_id, metadata)
       VALUES ($1, $2, $3) RETURNING id`,
      [SOURCE_ID, args.marketId, JSON.stringify({ mode: "centroids", county: args.county })]);
    const runId: string = run.rows[0].id;
    let offset = args.startOffset ?? 0, pages = 0, seen = 0, propertiesUpdated = 0;
    const max = args.maxRecords ?? Number.POSITIVE_INFINITY;
    try {
      while (seen < max) {
        const feats = await fetchPage(base, args.county, offset);
        if (feats.length === 0) break;
        pages++;
        const seenIds = new Set<string>();
        const rows: { pid: string; lat: number; lon: number }[] = [];
        for (const f of feats) {
          seen++;
          const raw = String(f.attributes.LocalParcelID ?? "").trim();
          const lat = f.centroid?.y, lon = f.centroid?.x;
          if (!raw || lat == null || lon == null) continue;
          const pid = normalizeParcelId(raw);
          if (seenIds.has(pid)) continue;
          seenIds.add(pid);
          rows.push({ pid, lat, lon });
        }
        if (rows.length > 0) {
          const values = rows.map((_, i) =>
            `($${i * 3 + 1}, $${i * 3 + 2}::double precision, $${i * 3 + 3}::double precision)`).join(",");
          const params = rows.flatMap((r) => [r.pid, r.lat, r.lon]);
          const upd = await client.query(
            `UPDATE properties p SET
               latitude = v.lat, longitude = v.lon,
               geom = ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326),
               updated_at = now()
             FROM (VALUES ${values}) AS v(pid, lat, lon)
             WHERE p.market_id = $${rows.length * 3 + 1}
               AND p.canonical_parcel_id = v.pid
               AND (p.latitude IS DISTINCT FROM v.lat OR p.longitude IS DISTINCT FROM v.lon)`,
            [...params, args.marketId]);
          propertiesUpdated += upd.rowCount ?? 0;
        }
        offset += feats.length;
        if (feats.length < PAGE_SIZE) break;
      }
      await client.query(
        `UPDATE ingestion_runs SET completed_at = now(), status = 'completed',
           records_seen = $2, records_updated = $3, cursor = $4 WHERE id = $1`,
        [runId, seen, propertiesUpdated, String(offset)]);
      await client.query(
        `UPDATE data_sources SET last_successful_ingestion_at = now(),
           last_attempted_ingestion_at = now(), last_error = NULL, updated_at = now()
         WHERE id = $1`, [SOURCE_ID]);
      return { runId, pages, seen, propertiesUpdated };
    } catch (err) {
      await client.query(
        `UPDATE ingestion_runs SET completed_at = now(), status = 'failed',
           records_seen = $2, cursor = $3 WHERE id = $1`,
        [runId, seen, String(offset)]).catch(() => {});
      throw err;
    }
  } finally {
    await client.end();
  }
}
