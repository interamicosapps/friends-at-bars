-- One-level chat replies. Run in the Supabase SQL editor after chat_geography.sql.
-- Replies inherit the parent geography, bar label, and expiry.
-- A parent buried at -4 or deleted takes its replies with it.
-- A reply buried at -4 is hidden on its own.

ALTER TABLE chat_posts
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES chat_posts(id) ON DELETE CASCADE;

ALTER TABLE chat_posts
  ADD COLUMN IF NOT EXISTS reply_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_chat_posts_parent
  ON chat_posts (parent_id, created_at)
  WHERE parent_id IS NOT NULL;

-- Soft-hide at -4, and hide every reply when the parent is buried.
CREATE OR REPLACE FUNCTION refresh_chat_post_score()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_id UUID;
  new_score INTEGER;
  parent_hidden BOOLEAN;
BEGIN
  target_id := COALESCE(NEW.post_id, OLD.post_id);

  SELECT COALESCE(SUM(vote), 0)
  INTO new_score
  FROM chat_votes
  WHERE post_id = target_id;

  UPDATE chat_posts
  SET
    score = new_score,
    is_hidden = CASE
      WHEN new_score <= -4 THEN true
      ELSE is_hidden
    END
  WHERE id = target_id
  RETURNING is_hidden INTO parent_hidden;

  IF parent_hidden THEN
    UPDATE chat_posts
    SET is_hidden = true
    WHERE parent_id = target_id
      AND is_hidden = false;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION hide_own_chat_post(
  p_post_id UUID,
  p_author_id TEXT
)
RETURNS chat_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  post_row chat_posts;
BEGIN
  UPDATE chat_posts
  SET is_hidden = true
  WHERE id = p_post_id
    AND author_id = p_author_id
  RETURNING * INTO post_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found or not yours';
  END IF;

  UPDATE chat_posts
  SET is_hidden = true
  WHERE parent_id = p_post_id
    AND is_hidden = false;

  RETURN post_row;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_parent_reply_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid UUID;
BEGIN
  pid := COALESCE(NEW.parent_id, OLD.parent_id);
  IF pid IS NOT NULL THEN
    UPDATE chat_posts
    SET reply_count = (
      SELECT COUNT(*)::INTEGER
      FROM chat_posts
      WHERE parent_id = pid
        AND is_hidden = false
        AND expires_at > NOW()
    )
    WHERE id = pid;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_posts_reply_count ON chat_posts;
CREATE TRIGGER trg_chat_posts_reply_count
AFTER INSERT OR DELETE OR UPDATE OF is_hidden, parent_id
ON chat_posts
FOR EACH ROW
EXECUTE FUNCTION refresh_parent_reply_count();

DROP FUNCTION IF EXISTS create_chat_post(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_chat_post(TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_chat_post(TEXT, TEXT, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_chat_post(TEXT, TEXT, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION create_chat_post(
  p_author_id TEXT,
  p_body TEXT,
  p_geography_id UUID,
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_venue_name TEXT DEFAULT NULL,
  p_avatar_icon TEXT DEFAULT NULL,
  p_avatar_color TEXT DEFAULT NULL,
  p_parent_id UUID DEFAULT NULL
)
RETURNS chat_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  trimmed TEXT;
  venue_trimmed TEXT;
  location_ok BOOLEAN;
  geo_row catalog_geographies%ROWTYPE;
  parent_row chat_posts%ROWTYPE;
  v_geography UUID;
  v_lat DOUBLE PRECISION;
  v_lon DOUBLE PRECISION;
  v_radius_m INTEGER;
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

  IF p_geography_id IS NULL THEN
    RAISE EXCEPTION 'geography required';
  END IF;

  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RAISE EXCEPTION 'Location required to chat';
  END IF;

  SELECT * INTO geo_row
  FROM catalog_geographies
  WHERE id = p_geography_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Geography not found';
  END IF;

  IF haversine_miles(geo_row.latitude, geo_row.longitude, p_latitude, p_longitude)
      > geo_row.radius_miles THEN
    RAISE EXCEPTION 'Must be located within % region to send chat', geo_row.name;
  END IF;

  IF p_parent_id IS NOT NULL THEN
    SELECT * INTO parent_row FROM chat_posts WHERE id = p_parent_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Chat not found';
    END IF;
    IF parent_row.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'You can only reply to a chat';
    END IF;
    IF parent_row.is_hidden OR parent_row.expires_at <= NOW() THEN
      RAISE EXCEPTION 'Chat is no longer available';
    END IF;
    IF parent_row.geography_id IS DISTINCT FROM p_geography_id THEN
      RAISE EXCEPTION 'Must be located within % region to send chat', geo_row.name;
    END IF;

    INSERT INTO chat_posts (
      author_id,
      body,
      venue_name,
      geography_id,
      avatar_icon,
      avatar_color,
      parent_id,
      expires_at
    )
    VALUES (
      p_author_id,
      trimmed,
      coalesce(parent_row.venue_name, ''),
      parent_row.geography_id,
      NULLIF(trim(p_avatar_icon), ''),
      NULLIF(trim(p_avatar_color), ''),
      parent_row.id,
      parent_row.expires_at
    )
    RETURNING * INTO new_row;

    RETURN new_row;
  END IF;

  venue_trimmed := NULLIF(trim(coalesce(p_venue_name, '')), '');

  IF venue_trimmed IS NOT NULL THEN
    SELECT geography_id, latitude, longitude, radius_m
    INTO v_geography, v_lat, v_lon, v_radius_m
    FROM catalog_venues
    WHERE name = venue_trimmed;

    IF v_geography IS NULL OR v_geography <> p_geography_id THEN
      RAISE EXCEPTION 'Venue not in this geography';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM live_locations
      WHERE user_id = p_author_id
        AND venue_name = venue_trimmed
        AND is_active = true
        AND last_updated > NOW() - INTERVAL '18 minutes'
    )
    INTO location_ok;

    IF NOT location_ok THEN
      location_ok := haversine_miles(v_lat, v_lon, p_latitude, p_longitude)
        <= (v_radius_m / 1609.344);
    END IF;

    IF NOT location_ok THEN
      RAISE EXCEPTION 'Must be at a bar to chat';
    END IF;
  END IF;

  INSERT INTO chat_posts (
    author_id,
    body,
    venue_name,
    geography_id,
    avatar_icon,
    avatar_color
  )
  VALUES (
    p_author_id,
    trimmed,
    coalesce(venue_trimmed, ''),
    p_geography_id,
    NULLIF(trim(p_avatar_icon), ''),
    NULLIF(trim(p_avatar_color), '')
  )
  RETURNING * INTO new_row;

  RETURN new_row;
END;
$$;

GRANT EXECUTE ON FUNCTION create_chat_post(TEXT, TEXT, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, UUID) TO anon, authenticated;
