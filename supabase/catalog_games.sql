-- =============================================================================
-- Games hub registry (test / production visibility)
-- Run in Supabase SQL editor (safe to re-run).
-- =============================================================================

CREATE TABLE IF NOT EXISTS catalog_games (
  game_key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled_in_test BOOLEAN NOT NULL DEFAULT true,
  enabled_in_production BOOLEAN NOT NULL DEFAULT false,
  has_details BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_catalog_games_updated ON catalog_games;
CREATE TRIGGER trg_catalog_games_updated
BEFORE UPDATE ON catalog_games
FOR EACH ROW EXECUTE FUNCTION catalog_touch_updated_at();

DROP TRIGGER IF EXISTS trg_bump_version_games ON catalog_games;
CREATE TRIGGER trg_bump_version_games
AFTER INSERT OR UPDATE OR DELETE ON catalog_games
FOR EACH STATEMENT EXECUTE FUNCTION catalog_bump_content_version();

ALTER TABLE catalog_games ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_games_select ON catalog_games;
CREATE POLICY catalog_games_select ON catalog_games
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS catalog_games_admin_write ON catalog_games;
CREATE POLICY catalog_games_admin_write ON catalog_games
  FOR ALL TO authenticated
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

GRANT SELECT ON catalog_games TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON catalog_games TO authenticated;

INSERT INTO catalog_games (
  game_key, title, sort_order, enabled_in_test, enabled_in_production, has_details
) VALUES
  ('switch-search', 'Switch Search', 10, true, true, true),
  ('ride-the-bus', 'Ride The Bus (beta)', 20, true, true, false),
  ('boozed', 'Boozed (beta)', 30, true, true, false),
  ('mega-toe', 'Megatoe', 40, true, false, false)
ON CONFLICT (game_key) DO UPDATE SET
  title = EXCLUDED.title,
  sort_order = EXCLUDED.sort_order,
  has_details = EXCLUDED.has_details;

-- Switch Search pack: extras/bans overlay (bundled base stays in the apps).
-- schema 2 → activeWords = bundledBase ∪ extras − bans
INSERT INTO catalog_game_content (game_key, pack_key, payload, is_active)
VALUES (
  'switch-search',
  'default',
  jsonb_build_object(
    'schema', 2,
    'extras', jsonb_build_object(
      'fourLetter', '[]'::jsonb,
      'fiveLetter', '[]'::jsonb,
      'sixLetter', '[]'::jsonb,
      'sevenLetter', '[]'::jsonb
    ),
    'bans', '[]'::jsonb
  ),
  true
)
ON CONFLICT (game_key, pack_key) DO UPDATE SET
  payload = CASE
    WHEN catalog_game_content.payload ? 'schema' THEN catalog_game_content.payload
    ELSE EXCLUDED.payload
  END,
  is_active = true;
