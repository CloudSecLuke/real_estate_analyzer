-- 0008_phase5_ops.sql
-- Phase 5 operational fixes: Stripe webhook idempotency table, and drop
-- the never-populated MultiPolygon column (centroid is the geometry we
-- actually use; parcel polygons were never ingested).

BEGIN;

CREATE TABLE IF NOT EXISTS stripe_events (
  id          text PRIMARY KEY,
  type        text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE property_parcels DROP COLUMN IF EXISTS geom;

COMMIT;
