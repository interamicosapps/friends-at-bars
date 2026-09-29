-- =============================================================================
-- Explicit location group for bars that share a building / footprint.
-- Same non-empty value (within a geography) combines Activities cards and map pins.
-- Run in Supabase SQL Editor.
-- =============================================================================

ALTER TABLE catalog_venues
  ADD COLUMN IF NOT EXISTS location_group TEXT;

COMMENT ON COLUMN catalog_venues.location_group IS
  'Optional shared location key. Venues with the same trimmed value in one geography share an Activities card and map pin. Empty means standalone.';

CREATE INDEX IF NOT EXISTS idx_catalog_venues_location_group
  ON catalog_venues (geography_id, location_group)
  WHERE location_group IS NOT NULL AND length(trim(location_group)) > 0;
