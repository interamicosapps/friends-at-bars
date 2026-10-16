-- =============================================================================
-- Mock venue wait-time bucket counts (CMS → test app Test Mode)
-- Buckets: 5, 10, 15, 30, 45 (displayed as 45+)
-- Run in Supabase SQL Editor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mock_venue_wait (
  venue_id UUID PRIMARY KEY REFERENCES catalog_venues(id) ON DELETE CASCADE,
  venue_name TEXT NOT NULL,
  count_5 INTEGER NOT NULL DEFAULT 0 CHECK (count_5 >= 0),
  count_10 INTEGER NOT NULL DEFAULT 0 CHECK (count_10 >= 0),
  count_15 INTEGER NOT NULL DEFAULT 0 CHECK (count_15 >= 0),
  count_30 INTEGER NOT NULL DEFAULT 0 CHECK (count_30 >= 0),
  count_45 INTEGER NOT NULL DEFAULT 0 CHECK (count_45 >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mock_venue_wait_name
  ON mock_venue_wait (venue_name);

COMMENT ON TABLE mock_venue_wait IS
  'CMS-managed mock wait-time report counts per bucket for the test app when Test Mode mock data is on.';

CREATE OR REPLACE FUNCTION mock_venue_wait_sync_name()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE mock_venue_wait
  SET venue_name = NEW.name,
      updated_at = NOW()
  WHERE venue_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mock_wait_sync_name ON catalog_venues;
CREATE TRIGGER trg_mock_wait_sync_name
AFTER UPDATE OF name ON catalog_venues
FOR EACH ROW
WHEN (OLD.name IS DISTINCT FROM NEW.name)
EXECUTE FUNCTION mock_venue_wait_sync_name();

INSERT INTO mock_venue_wait (venue_id, venue_name)
SELECT v.id, v.name
FROM catalog_venues v
ON CONFLICT (venue_id) DO UPDATE
SET venue_name = EXCLUDED.venue_name;

CREATE OR REPLACE FUNCTION mock_venue_wait_ensure_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO mock_venue_wait (venue_id, venue_name)
  VALUES (NEW.id, NEW.name)
  ON CONFLICT (venue_id) DO UPDATE
  SET venue_name = EXCLUDED.venue_name;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mock_wait_ensure_row ON catalog_venues;
CREATE TRIGGER trg_mock_wait_ensure_row
AFTER INSERT ON catalog_venues
FOR EACH ROW
EXECUTE FUNCTION mock_venue_wait_ensure_row();

ALTER TABLE mock_venue_wait ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mock_wait_select" ON mock_venue_wait;
CREATE POLICY "mock_wait_select"
  ON mock_venue_wait FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "mock_wait_admin_write" ON mock_venue_wait;
CREATE POLICY "mock_wait_admin_write"
  ON mock_venue_wait FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

GRANT SELECT ON mock_venue_wait TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON mock_venue_wait TO authenticated;
