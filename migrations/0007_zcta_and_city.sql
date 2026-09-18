-- 0007_zcta_and_city.sql
-- Phase 3 DDL: ZCTA polygons for the ZIP spatial join, and the explicit
-- tax-district → city mapping table (populated by scripts/geo-zcta-join.ts
-- from the distinct values actually present in auditor_parcels; unknowns
-- stay NULL city — never guessed).

BEGIN;

CREATE TABLE IF NOT EXISTS zcta_oh (
  zcta5        text PRIMARY KEY,
  geom         geometry(MultiPolygon, 4326) NOT NULL,
  vintage      text NOT NULL,
  source_id    text REFERENCES data_sources(id),
  retrieved_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zcta_oh_geom_idx ON zcta_oh USING GIST (geom);

CREATE TABLE IF NOT EXISTS hc_tax_district_city (
  tax_district_desc text PRIMARY KEY,
  city              text,          -- NULL = unknown/township, not guessed
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMIT;
