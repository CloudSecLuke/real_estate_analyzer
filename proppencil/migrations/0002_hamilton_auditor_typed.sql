-- 0002_hamilton_auditor_typed.sql
--
-- Replaces the EAV-first Stage 1 design for bulk public-record facts with
-- typed, one-row-per-parcel tables loaded from the Hamilton County
-- Auditor's official bulk exports (hamiltoncountyauditor.org/revalue.asp):
--
--   Monthly_tax_information.xlsx  356,599 parcels x 64 cols  (monthly)
--   HistoricSalesExport.xlsx      297,415 rows  x 43 cols  (most recent
--                                 sale per parcel + dwelling characteristics)
--   bldginfo.xlsx                 258,621 rows  x 10 cols  (sqft / year built)
--
-- Design rules (see docs/technical-implementation-spec.md, revised):
--   * Bulk government facts live in typed columns with row-level provenance
--     (source_id, file_as_of, loaded_at). data_points is reserved for
--     conflicts between sources and user overrides — not for every fact.
--   * Raw xlsx files are NOT stored in Postgres. The loader records the
--     file's sha256 + as-of date in ingestion_runs.metadata; keep the file
--     in object storage if you want reprocessability.
--   * Every statement is idempotent. Run via `npm run db:migrate`, never
--     lazily from a request handler.
--
-- Prereqs: 0001 (markets, data_sources, ingestion_runs, properties,
-- property_parcels) from lib/data/schema.ts. PostGIS optional here.

BEGIN;

-- ---------------------------------------------------------------------------
-- Source registry: three auditor exports, one row each, licensing as data
-- ---------------------------------------------------------------------------
INSERT INTO data_sources
  (id, name, provider_type, organization, jurisdiction, state, county,
   source_url, api_url, access_method, license_name,
   commercial_use_allowed, redistribution_allowed, attribution_required,
   update_frequency, enabled, priority, notes)
VALUES
  ('hc_auditor_tax',
   'Hamilton County Auditor — Monthly Tax Information Export', 'property',
   'Hamilton County Auditor', 'Hamilton County, Ohio', 'OH', 'Hamilton',
   'https://hamiltoncountyauditor.org/hamilton/revalue.asp',
   'https://hamiltoncountyauditor.org/download/revalue/Monthly_tax_information.xlsx',
   'bulk_download', 'Ohio Public Records Law (ORC 149.43)',
   'verify', 'verify', 'yes', 'monthly', true, 10,
   'Public record per ORC 149.43. Site states the office "does not endorse use of our data for any commercial purpose" — a non-endorsement, not a license term; confirm with counsel before relying on it. Accuracy not guaranteed (auditor disclaimer). location_city/state/zip columns are EMPTY in the file — ZIP must come from a spatial join or geocoder.'),
  ('hc_auditor_sales',
   'Hamilton County Auditor — Historic Sales Export', 'sales',
   'Hamilton County Auditor', 'Hamilton County, Ohio', 'OH', 'Hamilton',
   'https://hamiltoncountyauditor.org/hamilton/revalue.asp',
   'https://hamiltoncountyauditor.org/download/revalue/HistoricSalesExport.xlsx',
   'bulk_download', 'Ohio Public Records Law (ORC 149.43)',
   'verify', 'verify', 'yes', 'monthly', true, 10,
   'Despite the name this is ONE row per parcel (most recent transfer) plus dwelling characteristics (style, rooms, baths, year built, sqft). A true multi-year history accrues by loading each monthly file and upserting into auditor_sales; prior tax-year exports (2002–2024) can backfill.'),
  ('hc_auditor_bldg',
   'Hamilton County Auditor — Building Information Export', 'property',
   'Hamilton County Auditor', 'Hamilton County, Ohio', 'OH', 'Hamilton',
   'https://hamiltoncountyauditor.org/hamilton/revalue.asp',
   'https://hamiltoncountyauditor.org/download/revalue/bldginfo.xlsx',
   'bulk_download', 'Ohio Public Records Law (ORC 149.43)',
   'verify', 'verify', 'yes', 'monthly', true, 20,
   'Per-parcel square footage by floor, basement/attic sqft, story height, year built. No bedroom count in any auditor file (total_rooms only).')
ON CONFLICT (id) DO UPDATE SET
  api_url = EXCLUDED.api_url, notes = EXCLUDED.notes, updated_at = now();

-- ---------------------------------------------------------------------------
-- auditor_parcels: one row per parcel, replaced wholesale by each monthly
-- load (the tax file IS the current state). Residential + apartment classes
-- only (prop_class_code 4xx/5xx); everything else is not an investment target.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auditor_parcels (
  parcel_number        text PRIMARY KEY,           -- 13-digit auditor id, as-is
  market_id            text NOT NULL REFERENCES markets(id),
  prop_class_code      smallint NOT NULL,
  class_description    text,
  appraisal_area       text,
  area_description     text,
  house_number         int,                        -- leading number only
  house_number_raw     text,                       -- e.g. "6242-6268"
  street_direction     text,
  street_name          text,
  street_suffix        text,
  situs_address        text,                       -- built by the loader
  tax_district         text,
  tax_district_desc    text,                       -- municipality lives here
  school_district_desc text,
  deeded_acreage       numeric(10,4),
  owner_name_1         text,
  mailing_state        text,                       -- absentee-owner signal
  rental_registered    boolean,                    -- Y/N/NULL in the file
  homestead            boolean,
  foreclosure_flag     boolean,
  bor_flag             boolean,
  active               boolean NOT NULL DEFAULT true,
  transfer_date        date,
  sale_amount          integer,                    -- whole dollars, 0 = exempt
  sale_type            text,
  market_land_value    integer,
  market_impr_value    integer,
  total_market_value   integer,
  annual_taxes         numeric(12,2),
  current_re_taxes     numeric(12,2),
  special_assessments  numeric(12,2),
  content_hash         text NOT NULL,              -- md5 of the source row; cheap change detection
  file_as_of           date NOT NULL,
  loaded_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auditor_parcels_situs_idx
  ON auditor_parcels (street_name, house_number);
CREATE INDEX IF NOT EXISTS auditor_parcels_class_idx
  ON auditor_parcels (prop_class_code) WHERE active;

-- ---------------------------------------------------------------------------
-- auditor_dwellings: characteristics from the sales export + bldginfo.
-- One row per parcel with a dwelling record. No bedrooms anywhere in the
-- auditor's data — leave beds NULL, never derive it here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auditor_dwellings (
  parcel_number        text PRIMARY KEY,
  style                text,
  grade                text,
  exterior_wall        text,
  basement             text,
  heating              text,
  air_conditioning     text,
  total_rooms          smallint,
  full_bath            smallint,
  half_bath            smallint,
  fireplaces           smallint,
  garage_type          text,
  garage_capacity      smallint,
  num_stories          numeric(3,1),
  year_built           smallint,
  finished_sqft        int,
  total_finish_area    int,
  first_floor_area     int,
  half_floor_area      int,
  finished_basement    int,
  bsmt_sqft            int,
  attic_sqft           int,
  content_hash         text,
  file_as_of           date NOT NULL,
  loaded_at            timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- auditor_sales: append-only transfer events. Each monthly load upserts the
-- "most recent sale" for every parcel; over time this becomes a real
-- history. instrument_type is kept raw; likely_arms_length is a heuristic
-- (warranty/survivorship/fiduciary/trustee deed with a nonzero price),
-- configurable in code, never hidden.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auditor_sales (
  parcel_number        text NOT NULL,
  date_of_sale         date NOT NULL,
  conveyance_number    int,
  sale_price           integer,
  instrument_type      text,
  transfer_type        text,
  buyer_name           text,
  previous_owner       text,
  use_code_at_sale     smallint,
  likely_arms_length   boolean,
  first_seen_file      date NOT NULL
);
-- Expression unique index (conveyance_number is nullable); the loader's
-- ON CONFLICT must name the same expression.
CREATE UNIQUE INDEX IF NOT EXISTS auditor_sales_uniq_idx
  ON auditor_sales (parcel_number, date_of_sale, COALESCE(conveyance_number, -1));
CREATE INDEX IF NOT EXISTS auditor_sales_date_idx
  ON auditor_sales (date_of_sale DESC) WHERE likely_arms_length;

-- ---------------------------------------------------------------------------
-- provider_cache: the one new table for the request path. Replaces the
-- invisible Next.js Data Cache for HUD/ACS/FEMA/BLS/FRED/RentCast calls,
-- survives deploys, and doubles as cost telemetry. Keep TTLs per provider
-- in code; NEVER accumulate commercial responses past their TTL.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_cache (
  provider     text NOT NULL,
  cache_key    text NOT NULL,
  payload      jsonb NOT NULL,
  cost_cents   int NOT NULL DEFAULT 0,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  PRIMARY KEY (provider, cache_key)
);
CREATE INDEX IF NOT EXISTS provider_cache_expiry_idx ON provider_cache (expires_at);

-- ---------------------------------------------------------------------------
-- analyses: every pencil, persisted. Makes repeat analyses free, makes
-- results reproducible (formula_version), and answers "which markets are
-- people actually analyzing?" with one GROUP BY — the input to any decision
-- about which county to ingest next.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analyses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username         text NOT NULL,
  property_id      uuid REFERENCES properties(id),
  address_input    text NOT NULL,
  matched_address  text,
  county_fips      text,
  state            text,
  inputs           jsonb NOT NULL,        -- assumptions as submitted
  result           jsonb NOT NULL,        -- full AnalyzeResponse snapshot
  formula_version  text NOT NULL,
  provider_calls   jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{provider,cache_hit,cost_cents}]
  provider_cost_cents int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analyses_user_idx   ON analyses (username, created_at DESC);
CREATE INDEX IF NOT EXISTS analyses_county_idx ON analyses (county_fips, created_at DESC);

-- ---------------------------------------------------------------------------
-- rental_observations: the only proprietary rent data you can legally
-- accumulate at zero cost — what users tell you. Private by default;
-- aggregation into market stats only with explicit, anonymized consent.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rental_observations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   uuid NOT NULL REFERENCES properties(id),
  username      text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('actual_lease','asking_rent','user_reported')),
  rent_cents    int NOT NULL CHECK (rent_cents > 0),
  bedrooms      smallint,
  observed_at   date NOT NULL,
  lease_start   date,
  lease_end     date,
  visibility    text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','aggregate_ok')),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rental_obs_property_idx ON rental_observations (property_id, observed_at DESC);

-- ---------------------------------------------------------------------------
-- Canonical properties: pull typed facts up so the app never joins five
-- tables to render a property. Keep provenance at row level.
-- ---------------------------------------------------------------------------
ALTER TABLE properties ADD COLUMN IF NOT EXISTS facts_source_id text REFERENCES data_sources(id);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS facts_as_of date;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS total_rooms smallint;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS annual_taxes_cents int;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS assessed_value_cents bigint;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS last_sale_date date;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS last_sale_cents bigint;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS rental_registered boolean;

-- Trigram index for free typeahead over your own market (replaces Regrid
-- for Hamilton). Requires pg_trgm, available on Neon.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS properties_street_trgm_idx
  ON properties USING GIN (street_address gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Optional cleanup (run deliberately, not as part of this migration):
--   ALTER TABLE property_parcels DROP COLUMN geom;   -- unused MultiPolygon
--   DELETE FROM raw_source_records WHERE source_id = 'hamilton_county_parcels';
-- data_points stays, scoped to conflicts + overrides only.
-- ---------------------------------------------------------------------------

COMMIT;
