-- =============================================================================
-- Mock venue attendance (CMS-editable headcounts for Test Mode / mock data)
-- Run in Supabase SQL Editor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mock_venue_attendance (
  venue_id UUID PRIMARY KEY REFERENCES catalog_venues(id) ON DELETE CASCADE,
  venue_name TEXT NOT NULL,
  attendance INTEGER NOT NULL DEFAULT 0 CHECK (attendance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mock_venue_attendance_name
  ON mock_venue_attendance (venue_name);

COMMENT ON TABLE mock_venue_attendance IS
  'CMS-managed mock live headcounts used by the test app when Test Mode mock data is on.';

-- Keep venue_name in sync if a venue is renamed.
CREATE OR REPLACE FUNCTION mock_venue_attendance_sync_name()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE mock_venue_attendance
  SET venue_name = NEW.name,
      updated_at = NOW()
  WHERE venue_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mock_attendance_sync_name ON catalog_venues;
CREATE TRIGGER trg_mock_attendance_sync_name
AFTER UPDATE OF name ON catalog_venues
FOR EACH ROW
WHEN (OLD.name IS DISTINCT FROM NEW.name)
EXECUTE FUNCTION mock_venue_attendance_sync_name();

-- Seed / backfill one row per venue (0 attendance if new).
INSERT INTO mock_venue_attendance (venue_id, venue_name, attendance)
SELECT v.id, v.name, 0
FROM catalog_venues v
ON CONFLICT (venue_id) DO UPDATE
SET venue_name = EXCLUDED.venue_name;

CREATE OR REPLACE FUNCTION mock_venue_attendance_ensure_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO mock_venue_attendance (venue_id, venue_name, attendance)
  VALUES (NEW.id, NEW.name, 0)
  ON CONFLICT (venue_id) DO UPDATE
  SET venue_name = EXCLUDED.venue_name;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mock_attendance_ensure_row ON catalog_venues;
CREATE TRIGGER trg_mock_attendance_ensure_row
AFTER INSERT ON catalog_venues
FOR EACH ROW
EXECUTE FUNCTION mock_venue_attendance_ensure_row();

ALTER TABLE mock_venue_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mock_attendance_select" ON mock_venue_attendance;
CREATE POLICY "mock_attendance_select"
  ON mock_venue_attendance FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "mock_attendance_admin_write" ON mock_venue_attendance;
CREATE POLICY "mock_attendance_admin_write"
  ON mock_venue_attendance FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

GRANT SELECT ON mock_venue_attendance TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON mock_venue_attendance TO authenticated;
