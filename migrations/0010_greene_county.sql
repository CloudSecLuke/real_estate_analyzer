-- 0010_greene_county.sql
-- Second owned market: Greene County, OH (Dayton/WPAFB corridor —
-- Fairborn, Beavercreek, Xenia). Single-source: the county's open ArcGIS
-- parcels layer carries full facts (incl. bedrooms, living area, total
-- taxes, appraised values, sale + validity, situs city/ZIP), so no bulk
-- xlsx stage and no ZCTA/city joins are needed. License reviewed
-- 2026-09-18: county as-is appraisal disclaimer; no use restriction
-- stated in licenseInfo.

BEGIN;

INSERT INTO markets (id, name, state, state_fips, county, county_fips, enabled)
VALUES ('greene_county_oh', 'Dayton / Greene County (WPAFB)', 'OH', '39', 'Greene', '39057', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO data_sources
  (id, name, provider_type, organization, jurisdiction, state, county,
   source_url, api_url, access_method, license_name,
   commercial_use_allowed, redistribution_allowed, attribution_required,
   update_frequency, enabled, priority, notes)
VALUES
  ('greene_county_parcels',
   'Greene County OH — Open Data Parcels (GIS)', 'property',
   'Greene County Auditor / GIS', 'Greene County, Ohio', 'OH', 'Greene',
   'https://gishub-gimsoh29.opendata.arcgis.com/',
   'https://gis.greenecountyohio.gov/webgis2/rest/services/OpenData/OpenData/MapServer/1',
   'arcgis_feature_service', 'Greene County as-is appraisal disclaimer',
   'no_restriction_stated', 'no_restriction_stated', 'yes', 'monthly', true, 10,
   'Single source for facts + geometry: parcel, owner, situs w/ city+ZIP, beds/baths, living area, year built, style, sale date/price/valid flag, appraised/assessed values, Total_Taxes (annual bill), school district, heat. License reviewed 2026-09-18 (as-is disclaimer). maxRecordCount 2000. Class=RESIDENTIAL filter (63,835 of 77,807 parcels).')
ON CONFLICT (id) DO UPDATE SET api_url = EXCLUDED.api_url, notes = EXCLUDED.notes, updated_at = now();

COMMIT;
