-- 0005_centroids_only_source.sql
-- CAGIS parcels source now supplies centroids only (facts come from the
-- Auditor bulk exports, 0002). Updates the pre-existing registry row that
-- 0001's ON CONFLICT DO NOTHING could not touch, and removes the raw
-- payloads the old per-record crawl stored (government bulk sources do not
-- retain raw rows in Postgres; harmless no-op on fresh databases).

BEGIN;
UPDATE data_sources SET
  enabled = true,
  access_method = 'arcgis_feature_service',
  notes = 'Centroids + parcel ids only (lat/lon for properties + property_parcels.centroid). Property FACTS come from hc_auditor_* (0002). License reviewed 2026-09-15: as-is warranty disclaimer, no use restriction stated. Attribution: CAGIS Open Data / Hamilton County.',
  updated_at = now()
WHERE id = 'hamilton_county_parcels';

DELETE FROM data_points
  WHERE source_id = 'hamilton_county_parcels';
DELETE FROM raw_source_records
  WHERE source_id = 'hamilton_county_parcels';
COMMIT;
