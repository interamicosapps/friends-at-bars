-- Align chat anti-spoof freshness with native live-location policy:
-- heartbeat 15 minutes, count/chat trust window 18 minutes.
-- Also persists avatar snapshot fields on each post.
-- Run in the Supabase SQL editor (safe to re-run).

ALTER TABLE chat_posts
  ADD COLUMN IF NOT EXISTS avatar_icon TEXT,
  ADD COLUMN IF NOT EXISTS avatar_color TEXT;

DROP FUNCTION IF EXISTS create_chat_post(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_chat_post(TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION create_chat_post(
  p_author_id TEXT,
  p_body TEXT,
  p_venue_name TEXT,
  p_avatar_icon TEXT DEFAULT NULL,
  p_avatar_color TEXT DEFAULT NULL
)
RETURNS chat_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  trimmed TEXT;
  location_ok BOOLEAN;
  new_row chat_posts;
BEGIN
  IF p_author_id IS NULL OR length(trim(p_author_id)) = 0 THEN
    RAISE EXCEPTION 'author_id required';
  END IF;

  trimmed := trim(p_body);
  IF trimmed IS NULL OR length(trimmed) = 0 THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;
  IF char_length(trimmed) > 150 THEN
    RAISE EXCEPTION 'Message must be 150 characters or fewer';
  END IF;

  IF p_venue_name IS NULL OR length(trim(p_venue_name)) = 0 THEN
    RAISE EXCEPTION 'Must be at a bar to chat';
  END IF;

  -- Hourly send cap is paused. Restore by counting this author's posts in the last hour and rejecting at 5.

  SELECT EXISTS (
    SELECT 1
    FROM live_locations
    WHERE user_id = p_author_id
      AND venue_name = trim(p_venue_name)
      AND is_active = true
      AND last_updated > NOW() - INTERVAL '18 minutes'
  )
  INTO location_ok;

  IF NOT location_ok THEN
    RAISE EXCEPTION 'Must be at a bar to chat';
  END IF;

  INSERT INTO chat_posts (author_id, body, venue_name, avatar_icon, avatar_color)
  VALUES (
    p_author_id,
    trimmed,
    trim(p_venue_name),
    NULLIF(trim(p_avatar_icon), ''),
    NULLIF(trim(p_avatar_color), '')
  )
  RETURNING * INTO new_row;

  RETURN new_row;
END;
$$;

GRANT EXECUTE ON FUNCTION create_chat_post(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
