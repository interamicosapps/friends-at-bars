-- Switch Search word pack overlay (schema 2)
-- Bundled base lives in src/data/wordLibrary.json (and native Resources).
-- CMS payload = extras + bans only. Run in Supabase SQL editor.

INSERT INTO catalog_game_content (game_key, pack_key, payload, is_active)
VALUES (
  'switch-search',
  'default',
  '{"schema":2,"extras":{"fourLetter":[],"fiveLetter":[],"sixLetter":[],"sevenLetter":[]},"bans":[]}'::jsonb,
  true
)
ON CONFLICT (game_key, pack_key) DO UPDATE SET
  payload = EXCLUDED.payload,
  is_active = true;
