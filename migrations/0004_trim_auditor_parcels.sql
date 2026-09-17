-- 0004_trim_auditor_parcels.sql
-- Space trims sanctioned by docs/hamilton-auditor-exports.md, applied
-- because the first full load hit Neon Free's 512 MB project limit
-- mid-run. owner_name_1 (privacy-adjacent, unused by underwriting) and
-- area_description (redundant with appraisal_area) are dropped.
-- VACUUM FULL runs separately (cannot run inside a transaction).

BEGIN;
ALTER TABLE auditor_parcels DROP COLUMN IF EXISTS owner_name_1;
ALTER TABLE auditor_parcels DROP COLUMN IF EXISTS area_description;
COMMIT;
