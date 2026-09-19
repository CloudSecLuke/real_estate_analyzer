-- 0011_geohio_source.sql
-- Ohio Statewide Parcels (GeOhio/OGRIP): standardized parcel identity +
-- geometry for every Ohio county, produced from county records by the
-- state. Used for centroids wherever a county's own endpoint suppresses
-- geometry (Greene does) — and as the geometry path for future Ohio
-- counties (Montgomery next). State of Ohio public data.

BEGIN;
INSERT INTO data_sources
  (id, name, provider_type, organization, jurisdiction, state,
   source_url, api_url, access_method, license_name,
   commercial_use_allowed, redistribution_allowed, attribution_required,
   update_frequency, enabled, priority, notes)
VALUES
  ('geohio_statewide_parcels',
   'Ohio Statewide Parcels (GeOhio/OGRIP)', 'parcel',
   'State of Ohio (DAS/OGRIP)', 'Ohio', 'OH',
   'https://ohioparcels-geohio.hub.arcgis.com/',
   'https://services2.arcgis.com/MlJ0G8iWUyC7jAmu/arcgis/rest/services/OhioStatewidePacels_full_view/FeatureServer/0',
   'arcgis_feature_service', 'State of Ohio public data',
   'no_restriction_stated', 'no_restriction_stated', 'yes', 'quarterly', true, 20,
   'Identity + geometry only (LocalParcelID/StateParcelID/situs/land area; no valuations). Centroid source for counties whose own GIS suppresses geometry. LocalParcelID matches county parcel ids after normalization. License noted 2026-09-19: state-published open data; verify per-dataset terms if redistribution beyond centroids is ever wanted.')
ON CONFLICT (id) DO UPDATE SET api_url = EXCLUDED.api_url, notes = EXCLUDED.notes, updated_at = now();
COMMIT;
