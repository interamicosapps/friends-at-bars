-- =============================================================================
-- While Using presence visits (recent bar traffic, not live attendance)
-- Run in Supabase SQL Editor.
-- Distinct users with last_seen_at inside the app window count as "recent".
-- =============================================================================

CREATE TABLE IF NOT EXISTS presence_visits (
  user_id TEXT NOT NULL,
  venue_name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'while_using'
    CHECK (mode IN ('while_using')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, venue_name)
);

CREATE INDEX IF NOT EXISTS idx_presence_visits_recent
  ON presence_visits (venue_name, last_seen_at DESC)
  WHERE mode = 'while_using';

COMMENT ON TABLE presence_visits IS
  'While Using App bar visits. Distinct users with last_seen_at in the recent window show as "N recent" on Activities. Always users stay on live_locations.';

ALTER TABLE presence_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "presence_visits_select" ON presence_visits;
CREATE POLICY "presence_visits_select"
  ON presence_visits FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "presence_visits_upsert" ON presence_visits;
CREATE POLICY "presence_visits_upsert"
  ON presence_visits FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "presence_visits_update" ON presence_visits;
CREATE POLICY "presence_visits_update"
  ON presence_visits FOR UPDATE
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON presence_visits TO anon, authenticated;
