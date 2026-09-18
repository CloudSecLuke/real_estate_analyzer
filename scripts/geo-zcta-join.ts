// Phase 3: ZIP + city for Hamilton County properties (the Auditor tax file
// ships location_city/state/zip EMPTY on every row).
//
//   npm run data:geo:zcta
//
// ZIP: Census TIGERweb ZCTA5 polygons (US Census Bureau, public domain)
// intersecting the Hamilton County envelope → zcta_oh → one
// UPDATE ... FROM with ST_Contains against property centroids.
// City: explicit mapping of auditor tax_district_desc municipal prefixes;
// townships and anything unrecognized stay NULL. Do not guess.
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)="?([^"]*)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

import { Client } from "pg";
import { databaseUrl } from "../lib/dbUrl";

const SOURCE_ID = "census_tigerweb_zcta";
const TIGERWEB = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer";
// Hamilton County OH envelope with margin (WGS84).
const ENVELOPE = { xmin: -84.90, ymin: 38.95, xmax: -84.20, ymax: 39.40 };

// Municipal prefix → postal-style city name. Derived from the 109 distinct
// tax_district_desc values in the 2026-08-31 file. Township prefixes are
// deliberately ABSENT (city stays NULL): a township is not a postal city.
const CITY_BY_PREFIX: Record<string, string> = {
  "CINTI CORP": "CINCINNATI",
  "CINTI": "CINCINNATI",
  "CINCINNATI": "CINCINNATI",
  "NORWOOD": "NORWOOD",
  "BLUE ASH": "BLUE ASH",
  "FOREST PARK": "FOREST PARK",
  "FOREST PK": "FOREST PARK",
  "SHARONVILLE": "SHARONVILLE",
  "MONTGOMERY": "MONTGOMERY",
  "N.COLLEGE HILL": "NORTH COLLEGE HILL",
  "READING": "READING",
  "SPRINGDALE": "SPRINGDALE",
  "CHEVIOT": "CHEVIOT",
  "CHEVIOT CORP": "CHEVIOT",
  "WYOMING": "WYOMING",
  "WYOMING CORP": "WYOMING",
  "LOVELAND": "LOVELAND",
  "LOVELAND CORP": "LOVELAND",
  "INDIAN HILL": "INDIAN HILL",
  "DEER PARK": "DEER PARK",
  "MT.HEALTHY": "MOUNT HEALTHY",
  "SILVERTON": "SILVERTON",
  "ST.BERNARD": "SAINT BERNARD",
  "AMBERLEY": "AMBERLEY VILLAGE",
  "GREENHILLS": "GREENHILLS",
  "MARIEMONT": "MARIEMONT",
  "CLEVES": "CLEVES",
  "GOLF MANOR": "GOLF MANOR",
  "LOCKLAND": "LOCKLAND",
  "LINCOLN HTS": "LINCOLN HEIGHTS",
  "NEWTOWN": "NEWTOWN",
  "GLENDALE": "GLENDALE",
  "MADEIRA": "MADEIRA",
  "HARRISON": "HARRISON",
  "HARRISON CP": "HARRISON",
  "HARR CP": "HARRISON",
  "EVENDALE": "EVENDALE",
  "TERRACE PK": "TERRACE PARK",
  "FAIRFAX": "FAIRFAX",
  "ELMWOOD PL": "ELMWOOD PLACE",
  "ADDYSTON": "ADDYSTON",
  "N.BEND": "NORTH BEND",
  "N BEND": "NORTH BEND",
  "ARLINGTON HTS": "ARLINGTON HEIGHTS",
  "MILFORD": "MILFORD",
  "FAIRFIELD": "FAIRFIELD",
};

interface GeoJsonFeature {
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
}

async function findZctaLayer(): Promise<number> {
  const res = await fetch(`${TIGERWEB}?f=json`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`tigerweb metadata ${res.status}`);
  const meta = (await res.json()) as { layers?: { id: number; name: string }[] };
  const layer = meta.layers?.find((l) => /zip code tabulation/i.test(l.name));
  if (!layer) throw new Error("ZCTA layer not found in TIGERweb service");
  return layer.id;
}

async function fetchZctas(layerId: number): Promise<GeoJsonFeature[]> {
  const params = new URLSearchParams({
    where: "1=1",
    geometry: JSON.stringify({ ...ENVELOPE, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
  });
  const res = await fetch(`${TIGERWEB}/${layerId}/query?${params}`, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`tigerweb query ${res.status}`);
  const json = (await res.json()) as { features?: GeoJsonFeature[]; error?: unknown };
  if (json.error) throw new Error(`tigerweb error: ${JSON.stringify(json.error).slice(0, 200)}`);
  return json.features ?? [];
}

function zcta5Of(f: GeoJsonFeature): string | null {
  for (const k of ["ZCTA5", "ZCTA5CE20", "ZCTA5CE10", "GEOID", "BASENAME", "NAME"]) {
    const v = f.properties[k];
    if (typeof v === "string" && /^\d{5}$/.test(v.trim())) return v.trim();
  }
  return null;
}

async function main() {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    // source registry (data, not code — spec rule)
    await client.query(
      `INSERT INTO data_sources (id, name, provider_type, organization, jurisdiction, state,
         source_url, api_url, access_method, license_name, commercial_use_allowed,
         redistribution_allowed, attribution_required, update_frequency, enabled, notes)
       VALUES ($1, 'Census TIGERweb ZCTA5 (2020)', 'gis', 'US Census Bureau', 'United States', 'OH',
         'https://tigerweb.geo.census.gov/', $2, 'arcgis_rest', 'US public domain (17 USC 105)',
         'yes', 'yes', 'no', 'decennial', true,
         'ZCTA5 2020 polygons intersecting the Hamilton County envelope; used solely for the postal_code spatial join. Public domain as a US government work.')
       ON CONFLICT (id) DO UPDATE SET api_url = EXCLUDED.api_url, updated_at = now()`,
      [SOURCE_ID, TIGERWEB]
    );

    const layerId = await findZctaLayer();
    console.log(`TIGERweb ZCTA layer id: ${layerId}`);
    const feats = await fetchZctas(layerId);
    console.log(`fetched ${feats.length} ZCTA polygons in envelope`);

    let loaded = 0;
    for (const f of feats) {
      const z = zcta5Of(f);
      if (!z || !f.geometry) continue;
      await client.query(
        `INSERT INTO zcta_oh (zcta5, geom, vintage, source_id, retrieved_at)
         VALUES ($1, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)), '2020', $3, now())
         ON CONFLICT (zcta5) DO UPDATE SET geom = EXCLUDED.geom, retrieved_at = now()`,
        [z, JSON.stringify(f.geometry), SOURCE_ID]
      );
      loaded++;
    }
    console.log(`zcta_oh upserted: ${loaded}`);

    // ZIP: one set-based spatial UPDATE
    const zip = await client.query(`
      UPDATE properties p SET postal_code = z.zcta5, updated_at = now()
      FROM zcta_oh z
      WHERE p.market_id = 'hamilton_county_oh' AND p.geom IS NOT NULL
        AND ST_Contains(z.geom, p.geom)
        AND p.postal_code IS DISTINCT FROM z.zcta5`);
    console.log(`postal_code set on ${zip.rowCount} properties`);

    // City mapping: every distinct district gets a row; unmapped → NULL.
    const districts = await client.query(
      "SELECT DISTINCT tax_district_desc FROM auditor_parcels WHERE tax_district_desc IS NOT NULL"
    );
    let mapped = 0;
    for (const row of districts.rows as { tax_district_desc: string }[]) {
      const prefix = row.tax_district_desc.split("-")[0].trim();
      const city = CITY_BY_PREFIX[prefix] ?? null;
      if (city) mapped++;
      await client.query(
        `INSERT INTO hc_tax_district_city (tax_district_desc, city, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (tax_district_desc) DO UPDATE SET city = EXCLUDED.city, updated_at = now()`,
        [row.tax_district_desc, city]
      );
    }
    console.log(`districts: ${districts.rowCount} total, ${mapped} mapped to a city, ${(districts.rowCount ?? 0) - mapped} explicitly NULL`);

    const city = await client.query(`
      UPDATE properties p SET city = m.city, updated_at = now()
      FROM auditor_parcels a
      JOIN hc_tax_district_city m ON m.tax_district_desc = a.tax_district_desc
      WHERE p.market_id = 'hamilton_county_oh' AND p.canonical_parcel_id = a.parcel_number
        AND m.city IS NOT NULL AND p.city IS DISTINCT FROM m.city`);
    console.log(`city set on ${city.rowCount} properties`);

    const counts = await client.query(`SELECT
      count(*) FILTER (WHERE postal_code IS NOT NULL) with_zip,
      count(*) FILTER (WHERE city IS NOT NULL) with_city,
      count(*) FILTER (WHERE postal_code IS NOT NULL AND city IS NOT NULL) with_both,
      count(*) total
      FROM properties WHERE market_id = 'hamilton_county_oh'`);
    console.log("final:", JSON.stringify(counts.rows[0]));
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
