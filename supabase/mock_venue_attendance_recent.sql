-- =============================================================================
-- Add mock "recent" (While Using) counts for Test Mode.
-- Run in Supabase SQL Editor if mock_venue_attendance already exists.
-- =============================================================================

ALTER TABLE mock_venue_attendance
  ADD COLUMN IF NOT EXISTS recent INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mock_venue_attendance_recent_check'
  ) THEN
    ALTER TABLE mock_venue_attendance
      ADD CONSTRAINT mock_venue_attendance_recent_check CHECK (recent >= 0);
  END IF;
END $$;

COMMENT ON COLUMN mock_venue_attendance.recent IS
  'CMS mock distinct While Using visitors shown as "N recent" in the test app.';

CREATE OR REPLACE FUNCTION mock_venue_attendance_ensure_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO mock_venue_attendance (venue_id, venue_name, attendance, recent)
  VALUES (NEW.id, NEW.name, 0, 0)
  ON CONFLICT (venue_id) DO UPDATE
  SET venue_name = EXCLUDED.venue_name;
  RETURN NEW;
END;
$$;
