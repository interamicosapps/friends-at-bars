-- Geography-scoped chat: send from anywhere inside a geography; optional bar label.
-- Run in Supabase SQL Editor after chat_setup.sql and catalog_geographies.sql.

-- Haversine distance in miles (matches app GeographyResolver).
CREATE OR REPLACE FUNCTION haversine_miles(
  lat1 DOUBLE PRECISION,
  lon1 DOUBLE PRECISION,
  lat2 DOUBLE PRECISION,
  lon2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 3958.7613 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2))
      * power(sin(radians(lon2 - lon1) / 2), 2)
  ));
$$;

ALTER TABLE chat_posts
  ADD COLUMN IF NOT EXISTS geography_id UUID REFERENCES catalog_geographies(id) ON DELETE SET NULL;

ALTER TABLE chat_posts
  ALTER COLUMN venue_name DROP NOT NULL;

ALTER TABLE chat_posts
  ALTER COLUMN venue_name SET DEFAULT '';

UPDATE chat_posts p
SET geography_id = v.geography_id
FROM catalog_venues v
WHERE p.geography_id IS NULL
  AND p.venue_name IS NOT NULL
  AND length(trim(p.venue_name)) > 0
  AND v.name = p.venue_name
  AND v.geography_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_posts_geography_feed
  ON chat_posts (geography_id, created_at DESC)
  WHERE is_hidden = false;

ALTER TABLE chat_posts
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES chat_posts(id) ON DELETE CASCADE;

ALTER TABLE chat_posts
  ADD COLUMN IF NOT EXISTS reply_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_chat_posts_parent
  ON chat_posts (parent_id, created_at)
  WHERE parent_id IS NOT NULL;

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

  -- Hourly send cap is paused. Restore by counting this author's posts in the last hour and rejecting at 5.

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
