-- 0006_parcel_prefix_idx.sql
-- CAGIS AUDPCLID is the 11-digit prefix of the auditor's 13-digit parcel
-- number (last 2 digits are a unit/suffix). The centroid sweep joins on
-- that prefix; index it so each 1000-row page is an index join, not a
-- sequential scan of 322k properties.

BEGIN;
CREATE INDEX IF NOT EXISTS properties_parcel_prefix_idx
  ON properties (market_id, left(canonical_parcel_id, 11));
COMMIT;
