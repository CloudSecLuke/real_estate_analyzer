-- 0009_cagis_api_url.sql
-- The CAGIS feature-service endpoint was set out-of-band in dev before
-- migrations became the only DDL/config path; production surfaced the gap
-- (centroid sweep: "no api_url configured"). Endpoint verified 2026-09-15
-- against the live service (Hamilton_County_Parcel_Polygons, maxRecordCount
-- 2000).

BEGIN;
UPDATE data_sources SET
  api_url = 'https://services.arcgis.com/JyZag7oO4NteHGiq/arcgis/rest/services/Open_Data_Feature_Collection/FeatureServer/0',
  updated_at = now()
WHERE id = 'hamilton_county_parcels' AND (api_url IS NULL OR api_url = '');
COMMIT;
