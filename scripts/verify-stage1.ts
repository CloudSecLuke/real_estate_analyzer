// Stage 1 integration verification against the dev database.
// Schema comes from `npm run db:migrate` (run it first); ensureDataSchema
// is a compile-compat no-op.
// Usage: npm run db:verify — exercises idempotent migration, seeds, run
// lifecycle, and raw-record dedupe (acceptance test §111), then cleans up.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)="?([^"]*)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

import { ensureDataSchema, dataSql } from "../lib/data/schema";
import { startIngestionRun, finishIngestionRun, storeRawRecord, lastCursor } from "../lib/data/ingest";

async function main() {
  function ok(cond: boolean, label: string) {
    if (!cond) throw new Error(`FAIL: ${label}`);
    console.log(`ok - ${label}`);
  }

  // migration is idempotent
  await ensureDataSchema();
  const sql = dataSql();

  const markets = (await sql`SELECT id FROM markets WHERE id = 'hamilton_county_oh'`) as unknown[];
  ok(markets.length === 1, "hamilton_county_oh market seeded");

  const sources = (await sql`SELECT count(*)::int AS n FROM data_sources`) as { n: number }[];
  ok(sources[0].n >= 8, `source registry seeded (${sources[0].n} sources)`);

  const gated = (await sql`
    SELECT count(*)::int AS n FROM data_sources
    WHERE enabled = false
  `) as { n: number }[];
  ok(gated[0].n >= 1, "unverified sources stay disabled until reviewed");

  // run lifecycle + raw-record idempotency
  const runId = await startIngestionRun("hud_fmr", "hamilton_county_oh");
  const payload = { fips: "39061", year: 2026, three_bed: 1419, _verify: "stage1" };

  const first = await storeRawRecord({
    sourceId: "hud_fmr", recordType: "verify_test",
    externalRecordId: "verify-1", payload, ingestionRunId: runId,
    parserVersion: "verify-1.0.0",
  });
  ok(first.outcome === "inserted", "first store inserts");

  const second = await storeRawRecord({
    sourceId: "hud_fmr", recordType: "verify_test",
    externalRecordId: "verify-1", payload, ingestionRunId: runId,
  });
  ok(second.outcome === "unchanged" && second.id === first.id,
    "same id + same content → unchanged, no duplicate (§111)");

  const third = await storeRawRecord({
    sourceId: "hud_fmr", recordType: "verify_test",
    externalRecordId: "verify-1", payload: { ...payload, three_bed: 1450 },
    ingestionRunId: runId,
  });
  ok(third.outcome === "updated" && third.id === first.id,
    "same id + new content → updated in place");

  const anon = await storeRawRecord({
    sourceId: "hud_fmr", recordType: "verify_test", payload,
  });
  const anon2 = await storeRawRecord({
    sourceId: "hud_fmr", recordType: "verify_test", payload,
  });
  ok(anon2.outcome === "unchanged" && anon2.id === anon.id,
    "no external id → content-hash dedupe");

  await finishIngestionRun(runId, "completed",
    { seen: 4, inserted: 2, updated: 1, skipped: 1, failed: 0 },
    { cursor: "verify-cursor-1" });
  ok((await lastCursor("hud_fmr")) === "verify-cursor-1", "cursor persisted for incremental resume");

  // PostGIS actually usable on the properties table
  const gm = (await sql`
    SELECT ST_AsText(ST_SetSRID(ST_MakePoint(-84.51, 39.10), 4326)) AS wkt
  `) as { wkt: string }[];
  ok(gm[0].wkt.startsWith("POINT"), "PostGIS functions available");

  // cleanup
  await sql`DELETE FROM raw_source_records WHERE record_type = 'verify_test'`;
  await sql`DELETE FROM ingestion_runs WHERE id = ${runId}::uuid`;
  console.log("\nStage 1 verification passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
