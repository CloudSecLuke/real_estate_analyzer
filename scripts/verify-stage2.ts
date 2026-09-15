// Stage 2 integration verification (PROP-38): every match level against
// the dev DB, ambiguity surfacing, and idempotent creation. Cleans up.
// Usage: npm run db:verify:stage2
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)="?([^"]*)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

import { dataSql, ensureDataSchema } from "../lib/data/schema";
import { resolveProperty, normalizeParcelId } from "../lib/data/matching/propertyMatcher";

const MARKET = "hamilton_county_oh";

async function main() {
  function ok(cond: boolean, label: string) {
    if (!cond) throw new Error(`FAIL: ${label}`);
    console.log(`ok - ${label}`);
  }

  await ensureDataSchema();
  const sql = dataSql();
  // clean slate for the verify namespace
  await sql`DELETE FROM properties WHERE canonical_parcel_id LIKE 'VERIFY%' OR street_address LIKE '%VERIFY%'`;

  // create
  const created = await resolveProperty({
    marketId: MARKET,
    parcelId: "VERIFY-001-0042",
    address: "4242 Verifyton Ave, Cincinnati, OH 45211",
    latitude: 39.151,
    longitude: -84.601,
    createIfMissing: true,
  });
  ok(created.status === "created" && Boolean(created.propertyId), "creates canonical property");

  // idempotent create: same parcel → same property (§111 no-dupes)
  const again = await resolveProperty({
    marketId: MARKET,
    parcelId: "verify 001.0042",
    createIfMissing: true,
  });
  ok(again.status === "matched" && again.propertyId === created.propertyId && again.method === "parcel_exact",
    "level 1: parcel-exact match, punctuation-insensitive, no duplicate");
  ok(normalizeParcelId("verify 001.0042") === "VERIFY0010042", "parcel id normalization");

  // level 2: address + zip
  const byZip = await resolveProperty({
    marketId: MARKET,
    address: "4242 Verifyton Avenue, Cincinnati OH 45211",
  });
  ok(byZip.status === "matched" && byZip.propertyId === created.propertyId && byZip.method === "address_zip_exact",
    "level 2: normalized address + ZIP match across written variants");

  // level 3: address + city/state (no zip supplied)
  const byCity = await resolveProperty({
    marketId: MARKET,
    address: "4242 Verifyton Ave, Cincinnati, Ohio",
  });
  ok(byCity.status === "matched" && byCity.propertyId === created.propertyId && byCity.method === "address_city_exact",
    "level 3: address + city/state match without ZIP");

  // level 4: geospatial rooftop match
  const byGeo = await resolveProperty({
    marketId: MARKET,
    latitude: 39.15101,
    longitude: -84.60099,
  });
  ok(byGeo.status === "matched" && byGeo.propertyId === created.propertyId && byGeo.method === "geospatial",
    "level 4: PostGIS rooftop-distance match (~1m away)");

  // level 5: fuzzy — suffix missing, minor token noise
  const fuzzy = await resolveProperty({
    marketId: MARKET,
    address: "4242 Verifyton, Cincinnati, OH 45211",
  });
  ok(
    (fuzzy.status === "matched" && fuzzy.propertyId === created.propertyId) ||
      (fuzzy.status === "ambiguous" && fuzzy.candidates?.[0]?.propertyId === created.propertyId),
    `level 5: fuzzy resolves or surfaces the right candidate (${fuzzy.status})`
  );

  // ambiguity: two neighbors metres apart, geo lookup between them →
  // candidates. Inserted directly — resolveProperty would (correctly)
  // rooftop-match the neighbor to the existing property.
  await sql`
    INSERT INTO properties (market_id, canonical_parcel_id, normalized_address, street_address, city, state, postal_code, latitude, longitude, geom)
    VALUES (${MARKET}, 'VERIFY0020001', '4244 VERIFYTON AVE|CINCINNATI|OH|45211', '4244 VERIFYTON AVE', 'CINCINNATI', 'OH', '45211', 39.15102, -84.60103, 'SRID=4326;POINT(-84.60103 39.15102)')
  `;
  const between = await resolveProperty({
    marketId: MARKET,
    latitude: 39.151015,
    longitude: -84.60101,
  });
  ok(between.status === "ambiguous" && (between.candidates?.length ?? 0) >= 2,
    "ambiguity surfaced: two rooftop-distance candidates, no silent pick");

  // unknown → not_found without createIfMissing (never a weak guess)
  const missing = await resolveProperty({
    marketId: MARKET,
    address: "9999 Nonexistent Blvd, Cincinnati, OH 45299",
  });
  ok(missing.status === "not_found", "unknown address → not_found, nothing invented");

  await sql`DELETE FROM properties WHERE canonical_parcel_id LIKE 'VERIFY%'`;
  console.log("\nStage 2 verification passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
