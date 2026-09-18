// Hamilton County Auditor bulk-export loader (replaces the per-record
// ArcGIS crawl for property FACTS; keep the ArcGIS provider for centroids).
//
//   npm run data:ingest:hc-auditor                 # download + load all three
//   npm run data:ingest:hc-auditor -- --dir ./hc   # use already-downloaded xlsx
//   npm run data:ingest:hc-auditor -- --only tax   # tax | sales | bldg
//
// Strategy: stream each xlsx row-by-row (exceljs streaming reader, ~constant
// memory) straight into a TEMP staging table via COPY, then do ONE set-based
// upsert per target table. No per-row round trips, real transactions, and the
// whole county loads in minutes on Neon's free tier. Raw files are not stored
// in Postgres — the run records sha256 + as-of date; keep the xlsx in object
// storage if you want reprocessability.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { Client } from "pg";
import { from as copyFrom } from "pg-copy-streams";

// ---- env (same convention as ingest-hamilton.ts) ---------------------------
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)="?([^"]*)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
import { databaseUrl } from "../lib/dbUrl";

const MARKET_ID = "hamilton_county_oh";
const BASE = "https://hamiltoncountyauditor.org/download/revalue";
const FILES = {
  tax:   { name: "Monthly_tax_information.xlsx", source: "hc_auditor_tax" },
  sales: { name: "HistoricSalesExport.xlsx",     source: "hc_auditor_sales" },
  bldg:  { name: "bldginfo.xlsx",                source: "hc_auditor_bldg" },
} as const;
type Kind = keyof typeof FILES;

// Residential + apartment classes only (4xx / 5xx). Everything else is not
// an investment target and is ~9% of rows.
const INVESTABLE = (code: number) => code >= 400 && code < 600;

// Deed types that, with a nonzero price, we treat as likely arms-length.
// "(EX)" = conveyance-fee exempt (related party, gift, estate, etc.).
// Configurable heuristic — surfaced to the user, never hidden.
const ARMS_LENGTH_PREFIX = ["WD", "SV", "LW", "FD", "TD"];

// ---- helpers ---------------------------------------------------------------
function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const cell = (v: ExcelJS.CellValue): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && "result" in v) return cell((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
  const s = String(v).trim();
  return s === "" ? null : s;
};
const yn = (v: string | null) => (v === "Y" || v === "YES" ? "t" : v === "N" || v === "NO" ? "f" : null);
const num = (v: string | null) => (v == null || Number.isNaN(Number(v)) ? null : String(Number(v)));
// "6242-6268", "3225-3227" occur for multi-building parcels: keep the low number.
const houseNo = (v: string | null) => { const m = v?.match(/^\s*(\d{1,7})/); return m ? m[1] : null; };
const int = (v: string | null) => (v == null || Number.isNaN(Number(v)) ? null : String(Math.round(Number(v))));
// exceljs streaming reader yields Excel serials for date cells; both forms occur.
const date = (v: string | null): string | null => {
  if (v == null) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const n = Number(v);
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null; // 1954..2119
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
};
const withHash = (cols: (string | null)[]) => {
  const line = cols.map(esc).join("\t");
  return line + "\t" + createHash("md5").update(line).digest("hex");
};
const esc = (v: string | null) => (v == null ? "\\N" : v.replace(/\\/g, "\\\\").replace(/\t/g, " ").replace(/\n/g, " "));

async function download(kind: Kind, dir: string): Promise<string> {
  const path = join(dir, FILES[kind].name);
  if (existsSync(path)) return path;
  mkdirSync(dir, { recursive: true });
  process.stdout.write(`downloading ${FILES[kind].name} ... `);
  const res = await fetch(`${BASE}/${FILES[kind].name}`);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
  console.log(`${Math.round(statSync(path).size / 1e6)} MB`);
  return path;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Stream xlsx rows into a COPY. `map` returns the tab-separated line or
 *  null to skip. Returns {seen, kept}. */
async function copyXlsx(
  client: Client,
  path: string,
  table: string,
  map: (h: Record<string, string | null>) => string | null
): Promise<{ seen: number; kept: number }> {
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(createReadStream(path), {});
  let header: string[] = [];
  let seen = 0, kept = 0;
  async function* lines() {
    for await (const ws of wb) {
      for await (const row of ws) {
        const vals = (row.values as ExcelJS.CellValue[]).slice(1); // 1-indexed
        if (row.number === 1) { header = vals.map((v) => String(v)); continue; }
        seen++;
        const h: Record<string, string | null> = {};
        header.forEach((k, i) => (h[k] = cell(vals[i])));
        const line = map(h);
        if (line) { kept++; yield line + "\n"; }
      }
      break; // first sheet only
    }
  }
  await pipeline(Readable.from(lines()), client.query(copyFrom(`COPY ${table} FROM STDIN`)));
  return { seen, kept };
}

async function startRun(client: Client, source: string, meta: object): Promise<string> {
  const r = await client.query<{ id: string }>(
    `INSERT INTO ingestion_runs (source_id, market_id, metadata) VALUES ($1,$2,$3) RETURNING id`,
    [source, MARKET_ID, JSON.stringify(meta)]
  );
  await client.query(`UPDATE data_sources SET last_attempted_ingestion_at = now() WHERE id = $1`, [source]);
  return r.rows[0].id;
}
async function finishRun(client: Client, id: string, source: string, status: string,
  counts: { seen: number; inserted: number; updated: number; skipped: number }, error?: string) {
  await client.query(
    `UPDATE ingestion_runs SET completed_at = now(), status = $2, records_seen = $3,
       records_inserted = $4, records_updated = $5, records_skipped = $6 WHERE id = $1`,
    [id, status, counts.seen, counts.inserted, counts.updated, counts.skipped]
  );
  await client.query(
    status === "completed"
      ? `UPDATE data_sources SET last_successful_ingestion_at = now(), last_error = NULL WHERE id = $1`
      : `UPDATE data_sources SET last_error = $2 WHERE id = $1`,
    status === "completed" ? [source] : [source, error ?? "unknown"]
  );
}

// ---- loaders ---------------------------------------------------------------
async function loadTax(client: Client, path: string, asOf: string) {
  const src = FILES.tax.source;
  const run = await startRun(client, src, { file: FILES.tax.name, sha256: sha256(path), as_of: asOf });
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TEMP TABLE stg_tax (
      parcel_number text, prop_class_code smallint, class_description text,
      appraisal_area text, area_description text, house_number int, house_number_raw text,
      street_direction text, street_name text, street_suffix text,
      tax_district text, tax_district_desc text, school_district_desc text,
      deeded_acreage numeric, owner_name_1 text, mailing_state text,
      rental_registered boolean, homestead boolean, foreclosure_flag boolean,
      bor_flag boolean, active boolean, transfer_date date, sale_amount int,
      sale_type text, market_land_value int, market_impr_value int,
      total_market_value int, annual_taxes numeric, current_re_taxes numeric,
      special_assessments numeric, content_hash text) ON COMMIT DROP`);
    const { seen, kept } = await copyXlsx(client, path, "stg_tax", (h) => {
      const code = Number(h.prop_class_code);
      if (!h.parcel_number || !Number.isFinite(code) || !INVESTABLE(code)) return null;
      return withHash([
        h.parcel_number, String(code), h.class_description, h.appraisal_area, h.area_description,
        houseNo(h.location_house_number), h.location_house_number, h.location_street_direction, h.location_street_name,
        h.location_street_suffix, h.tax_district, h.tax_district_desc, h.school_district_desc,
        num(h.deeded_acreage), h.owner_name_1, h.mailing_state,
        yn(h.rental_registration_flag), yn(h.homestead_flag), yn(h.foreclosure_flag),
        yn(h.bor_flag), yn(h.active_flag) ?? "t", date(h.transfer_date), int(h.sale_amount),
        h.sale_type, int(h.market_land_value), int(h.market_impr_value),
        int(h.total_market_value), num(h.annual_taxes), num(h.current_RE_taxes_only),
        num(h.current_special_assessments),
      ]);
    });
    const up = await client.query(`
      INSERT INTO auditor_parcels
        (parcel_number, market_id, prop_class_code, class_description, appraisal_area,
         house_number, house_number_raw, street_direction, street_name, street_suffix,
         situs_address, tax_district, tax_district_desc, school_district_desc,
         deeded_acreage, mailing_state, rental_registered, homestead,
         foreclosure_flag, bor_flag, active, transfer_date, sale_amount, sale_type,
         market_land_value, market_impr_value, total_market_value, annual_taxes,
         current_re_taxes, special_assessments, content_hash, file_as_of, loaded_at)
      SELECT parcel_number, $1, prop_class_code, class_description, appraisal_area,
         house_number, house_number_raw, street_direction, street_name, street_suffix,
         NULLIF(concat_ws(' ', house_number_raw, street_direction, street_name, street_suffix), ''),
         tax_district, tax_district_desc, school_district_desc,
         deeded_acreage, mailing_state, rental_registered, homestead,
         foreclosure_flag, bor_flag, active, transfer_date, sale_amount, sale_type,
         market_land_value, market_impr_value, total_market_value, annual_taxes,
         current_re_taxes, special_assessments, content_hash, $2::date, now()
      FROM stg_tax
      ON CONFLICT (parcel_number) DO UPDATE SET
        prop_class_code = EXCLUDED.prop_class_code, class_description = EXCLUDED.class_description,
        appraisal_area = EXCLUDED.appraisal_area,
        house_number = EXCLUDED.house_number, house_number_raw = EXCLUDED.house_number_raw, street_direction = EXCLUDED.street_direction,
        street_name = EXCLUDED.street_name, street_suffix = EXCLUDED.street_suffix,
        situs_address = EXCLUDED.situs_address, tax_district = EXCLUDED.tax_district,
        tax_district_desc = EXCLUDED.tax_district_desc, school_district_desc = EXCLUDED.school_district_desc,
        deeded_acreage = EXCLUDED.deeded_acreage,
        mailing_state = EXCLUDED.mailing_state, rental_registered = EXCLUDED.rental_registered,
        homestead = EXCLUDED.homestead, foreclosure_flag = EXCLUDED.foreclosure_flag,
        bor_flag = EXCLUDED.bor_flag, active = EXCLUDED.active, transfer_date = EXCLUDED.transfer_date,
        sale_amount = EXCLUDED.sale_amount, sale_type = EXCLUDED.sale_type,
        market_land_value = EXCLUDED.market_land_value, market_impr_value = EXCLUDED.market_impr_value,
        total_market_value = EXCLUDED.total_market_value, annual_taxes = EXCLUDED.annual_taxes,
        current_re_taxes = EXCLUDED.current_re_taxes, special_assessments = EXCLUDED.special_assessments,
        content_hash = EXCLUDED.content_hash, file_as_of = EXCLUDED.file_as_of, loaded_at = now()
      WHERE auditor_parcels.content_hash <> EXCLUDED.content_hash`, [MARKET_ID, asOf]);
    // Parcels that vanished from the file (retired/consolidated) → inactive.
    const gone = await client.query(
      `UPDATE auditor_parcels a SET active = false WHERE a.market_id = $1 AND a.active
         AND NOT EXISTS (SELECT 1 FROM stg_tax s WHERE s.parcel_number = a.parcel_number)`,
      [MARKET_ID]);

    // Canonical properties: one set-based upsert keyed on parcel id.
    // The 5-level address matcher is for USER input, not bulk loads.
    await client.query(`
      INSERT INTO properties (market_id, canonical_parcel_id, street_address, state, county_fips,
        property_type, land_use, owner_name, lot_size_sqft, annual_taxes_cents,
        assessed_value_cents, last_sale_date, last_sale_cents, rental_registered,
        facts_source_id, facts_as_of, updated_at)
      SELECT $1, p.parcel_number, p.situs_address, 'OH', '39061',
        CASE WHEN p.prop_class_code = 510 THEN 'single_family'
             WHEN p.prop_class_code = 520 THEN 'duplex'
             WHEN p.prop_class_code = 530 THEN 'triplex'
             WHEN p.prop_class_code IN (550,555) THEN 'condo'
             WHEN p.prop_class_code BETWEEN 401 AND 403 THEN 'multifamily'
             WHEN p.prop_class_code = 500 THEN 'vacant_land' ELSE 'other' END,
        p.class_description, s.owner_name_1, round(p.deeded_acreage * 43560),
        round(p.current_re_taxes * 100), p.total_market_value::bigint * 100,
        p.transfer_date, NULLIF(p.sale_amount,0)::bigint * 100, p.rental_registered,
        $2, $3::date, now()
      FROM auditor_parcels p JOIN stg_tax s ON s.parcel_number = p.parcel_number
      WHERE p.market_id = $1 AND p.active
      ON CONFLICT (market_id, canonical_parcel_id) WHERE canonical_parcel_id IS NOT NULL
      DO UPDATE SET street_address = EXCLUDED.street_address, property_type = EXCLUDED.property_type,
        land_use = EXCLUDED.land_use, owner_name = EXCLUDED.owner_name,
        lot_size_sqft = EXCLUDED.lot_size_sqft, annual_taxes_cents = EXCLUDED.annual_taxes_cents,
        assessed_value_cents = EXCLUDED.assessed_value_cents, last_sale_date = EXCLUDED.last_sale_date,
        last_sale_cents = EXCLUDED.last_sale_cents, rental_registered = EXCLUDED.rental_registered,
        facts_source_id = EXCLUDED.facts_source_id, facts_as_of = EXCLUDED.facts_as_of, updated_at = now()`,
      [MARKET_ID, src, asOf]);
    await client.query("COMMIT");
    await finishRun(client, run, src, "completed",
      { seen, inserted: 0, updated: up.rowCount ?? 0, skipped: seen - kept });
    console.log(`tax: seen ${seen}, investable ${kept}, upserted ${up.rowCount}, retired ${gone.rowCount}`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    await finishRun(client, run, src, "failed", { seen: 0, inserted: 0, updated: 0, skipped: 0 }, String(e));
    throw e;
  }
}

async function loadSales(client: Client, path: string, asOf: string) {
  const src = FILES.sales.source;
  const run = await startRun(client, src, { file: FILES.sales.name, sha256: sha256(path), as_of: asOf });
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TEMP TABLE stg_sales (
      parcel_number text, use_code smallint, conveyance_number int, buyer text,
      previous_owner text, date_of_sale date, instrument_type text, transfer_type text,
      sale_price int, style text, grade text, exterior_wall text, basement text,
      heating text, air_conditioning text, total_rooms smallint, full_bath smallint,
      half_bath smallint, fireplaces smallint, garage_type text, garage_capacity smallint,
      num_stories numeric, year_built smallint, finished_sqft int, total_finish_area int,
      first_floor_area int, half_floor_area int, finished_basement int, content_hash text) ON COMMIT DROP`);
    const { seen, kept } = await copyXlsx(client, path, "stg_sales", (h) => {
      if (!h.parcel_number) return null;
      return withHash([
        h.parcel_number, int(h.use_code), int(h.conveyance_number), h.owner_name_1,
        h.previous_owner, date(h.date_of_sale), h.instrument_type, h.transfer_type, int(h.sale_price),
        h.style, h.grade, h.exterior_wall_type, h.basement, h.heating, h.air_conditioning,
        int(h.total_rooms), int(h.full_bath), int(h.half_bath), int(h.fireplaces),
        h.garage_type, int(h.garage_capacity), num(h.num_stories), int(h.year_built),
        int(h.finished_sq_ft), int(h.total_finish_area), int(h.first_floor_area),
        int(h.half_floor_area), int(h.finished_basement),
      ]);
    });
    // dwelling characteristics (one row per parcel; bldginfo fills sqft gaps)
    const dw = await client.query(`
      INSERT INTO auditor_dwellings (parcel_number, style, grade, exterior_wall, basement,
        heating, air_conditioning, total_rooms, full_bath, half_bath, fireplaces, garage_type,
        garage_capacity, num_stories, year_built, finished_sqft, total_finish_area,
        first_floor_area, half_floor_area, finished_basement, content_hash, file_as_of, loaded_at)
      SELECT DISTINCT ON (parcel_number) parcel_number, style, grade, exterior_wall, basement,
        heating, air_conditioning, total_rooms, full_bath, half_bath, fireplaces, garage_type,
        garage_capacity, num_stories, NULLIF(year_built,0), NULLIF(finished_sqft,0),
        NULLIF(total_finish_area,0), NULLIF(first_floor_area,0), half_floor_area,
        finished_basement, content_hash, $1::date, now()
      FROM stg_sales ORDER BY parcel_number, date_of_sale DESC NULLS LAST
      ON CONFLICT (parcel_number) DO UPDATE SET
        style = EXCLUDED.style, grade = EXCLUDED.grade, exterior_wall = EXCLUDED.exterior_wall,
        basement = EXCLUDED.basement, heating = EXCLUDED.heating,
        air_conditioning = EXCLUDED.air_conditioning, total_rooms = EXCLUDED.total_rooms,
        full_bath = EXCLUDED.full_bath, half_bath = EXCLUDED.half_bath,
        fireplaces = EXCLUDED.fireplaces, garage_type = EXCLUDED.garage_type,
        garage_capacity = EXCLUDED.garage_capacity, num_stories = EXCLUDED.num_stories,
        year_built = COALESCE(EXCLUDED.year_built, auditor_dwellings.year_built),
        finished_sqft = COALESCE(EXCLUDED.finished_sqft, auditor_dwellings.finished_sqft),
        total_finish_area = COALESCE(EXCLUDED.total_finish_area, auditor_dwellings.total_finish_area),
        first_floor_area = COALESCE(EXCLUDED.first_floor_area, auditor_dwellings.first_floor_area),
        half_floor_area = EXCLUDED.half_floor_area, finished_basement = EXCLUDED.finished_basement,
        content_hash = EXCLUDED.content_hash, file_as_of = EXCLUDED.file_as_of, loaded_at = now()
      WHERE auditor_dwellings.content_hash IS DISTINCT FROM EXCLUDED.content_hash`, [asOf]);
    // sales events (append-only; history accrues across monthly loads)
    const sl = await client.query(`
      INSERT INTO auditor_sales (parcel_number, date_of_sale, conveyance_number, sale_price,
        instrument_type, transfer_type, buyer_name, previous_owner, use_code_at_sale,
        likely_arms_length, first_seen_file)
      SELECT parcel_number, date_of_sale, conveyance_number, sale_price, instrument_type,
        transfer_type, buyer, previous_owner, use_code,
        (COALESCE(sale_price,0) > 0 AND split_part(instrument_type,' ',1) = ANY($2::text[])),
        $1::date
      FROM stg_sales WHERE date_of_sale IS NOT NULL
      ON CONFLICT (parcel_number, date_of_sale, COALESCE(conveyance_number, -1)) DO NOTHING`,
      [asOf, ARMS_LENGTH_PREFIX]);
    // lift characteristics onto canonical properties
    await client.query(`
      UPDATE properties pr SET
        baths = d.full_bath, half_baths = d.half_bath, total_rooms = d.total_rooms,
        living_area_sqft = COALESCE(d.finished_sqft, d.total_finish_area),
        year_built = d.year_built, stories = d.num_stories, basement_type = d.basement,
        garage_type = d.garage_type, garage_spaces = d.garage_capacity,
        heating_type = d.heating, cooling_type = d.air_conditioning, updated_at = now()
      FROM auditor_dwellings d
      WHERE pr.market_id = $1 AND pr.canonical_parcel_id = d.parcel_number`, [MARKET_ID]);
    await client.query("COMMIT");
    await finishRun(client, run, src, "completed",
      { seen, inserted: sl.rowCount ?? 0, updated: dw.rowCount ?? 0, skipped: seen - kept });
    console.log(`sales: seen ${seen}, dwellings upserted ${dw.rowCount}, new sale events ${sl.rowCount}`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    await finishRun(client, run, src, "failed", { seen: 0, inserted: 0, updated: 0, skipped: 0 }, String(e));
    throw e;
  }
}

async function loadBldg(client: Client, path: string, asOf: string) {
  const src = FILES.bldg.source;
  const run = await startRun(client, src, { file: FILES.bldg.name, sha256: sha256(path), as_of: asOf });
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TEMP TABLE stg_bldg (parcel_number text, attic_sqft int,
      bsmt_sqft int, live_fsqft int, sqft int, sqft_flr1 int, sqft_flr2 int, sqft_flrh int,
      storyht numeric, yearbuilt smallint) ON COMMIT DROP`);
    const { seen, kept } = await copyXlsx(client, path, "stg_bldg", (h) =>
      !h.PARCELID ? null : [h.PARCELID, int(h.ATTIC_SQFT), int(h.BSMT_SQFT), int(h.LIVE_FSQFT),
        int(h.SQFT), int(h.SQFT_FLR1), int(h.SQFT_FLR2), int(h.SQFT_FLRH), num(h.STORYHT),
        int(h.YEARBUILT)].map(esc).join("\t"));
    const up = await client.query(`
      INSERT INTO auditor_dwellings (parcel_number, attic_sqft, bsmt_sqft, finished_sqft,
        first_floor_area, num_stories, year_built, file_as_of, loaded_at)
      SELECT DISTINCT ON (parcel_number) parcel_number, attic_sqft, bsmt_sqft,
        NULLIF(live_fsqft,0), NULLIF(sqft_flr1,0), storyht, NULLIF(yearbuilt,0), $1::date, now()
      FROM stg_bldg ORDER BY parcel_number, live_fsqft DESC NULLS LAST
      ON CONFLICT (parcel_number) DO UPDATE SET
        attic_sqft = EXCLUDED.attic_sqft, bsmt_sqft = EXCLUDED.bsmt_sqft,
        finished_sqft = COALESCE(auditor_dwellings.finished_sqft, EXCLUDED.finished_sqft),
        first_floor_area = COALESCE(auditor_dwellings.first_floor_area, EXCLUDED.first_floor_area),
        num_stories = COALESCE(auditor_dwellings.num_stories, EXCLUDED.num_stories),
        year_built = COALESCE(auditor_dwellings.year_built, EXCLUDED.year_built),
        loaded_at = now()
      WHERE auditor_dwellings.attic_sqft IS DISTINCT FROM EXCLUDED.attic_sqft
         OR auditor_dwellings.bsmt_sqft IS DISTINCT FROM EXCLUDED.bsmt_sqft
         OR (auditor_dwellings.finished_sqft IS NULL AND EXCLUDED.finished_sqft IS NOT NULL)
         OR (auditor_dwellings.year_built IS NULL AND EXCLUDED.year_built IS NOT NULL)`, [asOf]);
    await client.query(`
      UPDATE properties pr SET
        living_area_sqft = COALESCE(pr.living_area_sqft, d.finished_sqft),
        year_built = COALESCE(pr.year_built, d.year_built), updated_at = now()
      FROM auditor_dwellings d
      WHERE pr.market_id = $1 AND pr.canonical_parcel_id = d.parcel_number
        AND (pr.living_area_sqft IS NULL OR pr.year_built IS NULL)`, [MARKET_ID]);
    await client.query("COMMIT");
    await finishRun(client, run, src, "completed",
      { seen, inserted: 0, updated: up.rowCount ?? 0, skipped: seen - kept });
    console.log(`bldg: seen ${seen}, dwellings upserted ${up.rowCount}`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    await finishRun(client, run, src, "failed", { seen: 0, inserted: 0, updated: 0, skipped: 0 }, String(e));
    throw e;
  }
}

// ---- main ------------------------------------------------------------------
async function main() {
  const dir = argVal("--dir") ?? ".cache/hc-auditor";
  const only = argVal("--only") as Kind | undefined;
  // The revalue.asp page shows "File current as of MM/DD/YYYY"; pass it in
  // or default to today. It is stored on every row as file_as_of.
  const asOf = argVal("--as-of") ?? new Date().toISOString().slice(0, 10);
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  const t0 = Date.now();
  const kinds: Kind[] = only ? [only] : ["tax", "sales", "bldg"];
  for (const k of kinds) {
    const path = await download(k, dir);
    const t = Date.now();
    if (k === "tax") await loadTax(client, path, asOf);
    if (k === "sales") await loadSales(client, path, asOf);
    if (k === "bldg") await loadBldg(client, path, asOf);
    console.log(`  ${k} took ${Math.round((Date.now() - t) / 1000)}s`);
  }
  await client.query(`UPDATE markets SET last_ingested_at = now(), updated_at = now() WHERE id = $1`, [MARKET_ID]);
  await client.end();
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s`);
}
main().catch((e) => { console.error(e); process.exit(1); });
