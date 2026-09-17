-- 0001_data_foundation.sql
-- Stage 1 foundation, lifted verbatim from lib/data/schema.ts so that DDL
-- runs from `npm run db:migrate` (CI + deploy), never lazily from a request
-- handler. Idempotent. Superseded in part by 0002 (typed auditor tables).

BEGIN;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS markets (
  id text PRIMARY KEY, name text NOT NULL, state text NOT NULL,
  state_fips text NOT NULL, county text NOT NULL, county_fips text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_ingested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS data_sources (
  id text PRIMARY KEY, name text NOT NULL, provider_type text NOT NULL,
  organization text, jurisdiction text, state text, county text,
  source_url text, api_url text,
  access_method text NOT NULL DEFAULT 'research',
  license_name text, license_url text,
  commercial_use_allowed text NOT NULL DEFAULT 'verify',
  redistribution_allowed text NOT NULL DEFAULT 'verify',
  attribution_required text NOT NULL DEFAULT 'verify',
  rate_limit text, update_frequency text,
  last_successful_ingestion_at timestamptz, last_attempted_ingestion_at timestamptz,
  last_error text, enabled boolean NOT NULL DEFAULT false,
  priority int NOT NULL DEFAULT 100, notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES data_sources(id),
  market_id text REFERENCES markets(id),
  started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  records_seen int NOT NULL DEFAULT 0, records_inserted int NOT NULL DEFAULT 0,
  records_updated int NOT NULL DEFAULT 0, records_skipped int NOT NULL DEFAULT 0,
  records_failed int NOT NULL DEFAULT 0, error_count int NOT NULL DEFAULT 0,
  cursor text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ingestion_runs_source_idx ON ingestion_runs (source_id, started_at DESC);

-- Raw layer: kept for PAID provider responses only (where terms permit).
CREATE TABLE IF NOT EXISTS raw_source_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES data_sources(id),
  external_record_id text, record_type text NOT NULL,
  payload jsonb NOT NULL, content_hash text NOT NULL,
  parser_version text, normalizer_version text,
  source_created_at timestamptz, source_updated_at timestamptz,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  ingestion_run_id uuid REFERENCES ingestion_runs(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS raw_records_source_ext_idx
  ON raw_source_records (source_id, record_type, external_record_id) WHERE external_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS raw_records_hash_idx ON raw_source_records (source_id, content_hash);

CREATE TABLE IF NOT EXISTS properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id text NOT NULL REFERENCES markets(id),
  canonical_parcel_id text, normalized_address text, street_address text,
  city text, state text, postal_code text, county_fips text,
  latitude double precision, longitude double precision,
  geom geometry(Point, 4326),
  property_type text, property_subtype text,
  beds numeric, baths numeric, half_baths int,
  living_area_sqft int, lot_size_sqft int, year_built int, stories numeric,
  basement_type text, garage_type text, garage_spaces int,
  heating_type text, cooling_type text,
  owner_name text, owner_occupied boolean, land_use text, zoning text,
  source_confidence real, data_confidence real,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS properties_market_parcel_idx
  ON properties (market_id, canonical_parcel_id) WHERE canonical_parcel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS properties_norm_addr_idx ON properties (market_id, normalized_address);
CREATE INDEX IF NOT EXISTS properties_geom_idx ON properties USING GIST (geom);

-- property_parcels: centroid only. The MultiPolygon column from schema.ts
-- is intentionally omitted (never populated; would be the largest object
-- in the database if it ever were).
CREATE TABLE IF NOT EXISTS property_parcels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid REFERENCES properties(id),
  source_id text NOT NULL REFERENCES data_sources(id),
  source_parcel_id text NOT NULL, normalized_parcel_id text, apn text,
  situs_address text, mailing_address text, owner text, land_use text,
  acreage numeric, centroid geometry(Point, 4326),
  source_updated_at timestamptz, retrieved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_parcel_id)
);
CREATE INDEX IF NOT EXISTS parcels_property_idx ON property_parcels (property_id);
CREATE INDEX IF NOT EXISTS parcels_norm_idx ON property_parcels (normalized_parcel_id);

-- data_points: CONFLICTS and OVERRIDES only (not bulk facts) as of 0002.
CREATE TABLE IF NOT EXISTS data_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  field_name text NOT NULL, value jsonb NOT NULL, value_type text NOT NULL,
  value_class text NOT NULL DEFAULT 'unknown',
  source_id text REFERENCES data_sources(id),
  source_record_id uuid REFERENCES raw_source_records(id),
  observed_at timestamptz, retrieved_at timestamptz NOT NULL DEFAULT now(),
  confidence real NOT NULL DEFAULT 0.5, method text,
  is_current boolean NOT NULL DEFAULT true,
  supersedes_data_point_id uuid REFERENCES data_points(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS data_points_lookup_idx ON data_points (property_id, field_name, is_current);

CREATE TABLE IF NOT EXISTS data_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  field_name text NOT NULL, candidate_values jsonb NOT NULL,
  selected_value jsonb, selection_reason text, selected_source text,
  confidence real, resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS data_conflicts_property_idx ON data_conflicts (property_id, field_name);

CREATE TABLE IF NOT EXISTS user_property_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  property_id uuid NOT NULL REFERENCES properties(id),
  field_name text NOT NULL, previous_value jsonb, new_value jsonb NOT NULL,
  reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS overrides_property_idx
  ON user_property_overrides (property_id, field_name, created_at DESC);

INSERT INTO markets (id, name, state, state_fips, county, county_fips, enabled)
VALUES ('hamilton_county_oh', 'Cincinnati / Hamilton County', 'OH', '39', 'Hamilton', '39061', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO data_sources (id, name, provider_type, access_method, source_url, update_frequency, enabled, notes, organization, jurisdiction, state, county) VALUES
 ('hamilton_county_parcels','Hamilton County Parcels (GIS)','parcel','arcgis_feature_service','https://data-cagisportal.opendata.arcgis.com/','monthly',false,'Centroids + parcel ids only. Use for lat/lon; facts come from hc_auditor_* (0002).','Hamilton County / Cincinnati','Hamilton County, Ohio','OH','Hamilton'),
 ('cincinnati_building_permits','Cincinnati Building Permits (Open Data)','permit','socrata_api','https://data.cincinnati-oh.gov/','daily',false,'Verify license on dataset page before enabling (PROP-40).','Hamilton County / Cincinnati','Hamilton County, Ohio','OH','Hamilton'),
 ('hud_fmr','HUD Fair Market Rents / SAFMR','hud','api','https://www.huduser.gov/portal/dataset/fmr-api.html','annual',true,'lib/hud.ts; token in HUD_API_TOKEN.','HUD','United States','OH','Hamilton'),
 ('user_input','PropPencil user-provided data','user','application','','continuous',true,'Overrides and rental observations; private unless explicitly aggregated.','PropPencil','Hamilton County, Ohio','OH','Hamilton'),
 ('proppencil_derived','PropPencil derived/calculated values','derived','application','','continuous',true,'Engine outputs; always labeled as estimates.','PropPencil','Hamilton County, Ohio','OH','Hamilton')
ON CONFLICT (id) DO NOTHING;
COMMIT;
