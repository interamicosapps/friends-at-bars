-- App RPCs for native v1.0.3 (step 2.1).
-- Additive only: do NOT revoke table privileges. v1.0.2 keeps reading/writing tables directly.
-- SECURITY DEFINER, search_path = public. GRANT EXECUTE to anon, authenticated.
-- Idempotent. Run in the Supabase SQL Editor. Do not run from the app.
--
-- Rate limits: report_presence / record_presence_visit soft-succeed (no exception) when
-- called again within 30s so the iOS pending-write queue does not retry. clear_presence
-- and expire_presence_visit are never rate-limited.

-- -----------------------------------------------------------------------------
-- chat_blocks
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_blocks (
  blocker_id text NOT NULL,
  blocked_author_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_author_id)
);

ALTER TABLE public.chat_blocks ENABLE ROW LEVEL SECURITY;
-- No client policies: only SECURITY DEFINER RPCs touch this table.

CREATE OR REPLACE FUNCTION public.block_author(
  p_blocker_id text,
  p_post_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_author text;
BEGIN
  IF p_blocker_id IS NULL OR length(trim(p_blocker_id)) = 0 THEN
    RAISE EXCEPTION 'blocker_id required';
  END IF;

  SELECT author_id INTO target_author
  FROM public.chat_posts
  WHERE id = p_post_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found';
  END IF;

  IF target_author = p_blocker_id THEN
    RAISE EXCEPTION 'Cannot block yourself';
  END IF;

  INSERT INTO public.chat_blocks (blocker_id, blocked_author_id)
  VALUES (p_blocker_id, target_author)
  ON CONFLICT DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.block_author(text, uuid) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- Chat fetch helpers (no author_id exposed)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_chat_feed(
  p_viewer_id text,
  p_sort text,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  body text,
  venue_name text,
  geography_id uuid,
  score integer,
  is_hidden boolean,
  created_at timestamptz,
  expires_at timestamptz,
  avatar_icon text,
  avatar_color text,
  parent_id uuid,
  reply_count integer,
  moderation_status text,
  is_mine boolean,
  my_vote smallint,
  author_key text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.body,
    p.venue_name,
    p.geography_id,
    p.score,
    p.is_hidden,
    p.created_at,
    p.expires_at,
    p.avatar_icon,
    p.avatar_color,
    p.parent_id,
    p.reply_count,
    p.moderation_status,
    (p.author_id = p_viewer_id) AS is_mine,
    v.vote AS my_vote,
    md5(p.author_id || coalesce(p.parent_id, p.id)::text) AS author_key
  FROM public.chat_posts p
  LEFT JOIN public.chat_votes v
    ON v.post_id = p.id AND v.voter_id = p_viewer_id
  WHERE p.parent_id IS NULL
    AND p.is_hidden = false
    AND p.expires_at > now()
    AND NOT EXISTS (
      SELECT 1
      FROM public.chat_blocks b
      WHERE b.blocker_id = p_viewer_id
        AND b.blocked_author_id = p.author_id
    )
  ORDER BY
    CASE WHEN p_sort = 'popular' THEN p.score ELSE 0 END DESC,
    p.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 50), 100));
$$;

GRANT EXECUTE ON FUNCTION public.fetch_chat_feed(text, text, int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.fetch_chat_replies(
  p_viewer_id text,
  p_parent_id uuid
)
RETURNS TABLE (
  id uuid,
  body text,
  venue_name text,
  geography_id uuid,
  score integer,
  is_hidden boolean,
  created_at timestamptz,
  expires_at timestamptz,
  avatar_icon text,
  avatar_color text,
  parent_id uuid,
  reply_count integer,
  moderation_status text,
  is_mine boolean,
  my_vote smallint,
  author_key text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.body,
    p.venue_name,
    p.geography_id,
    p.score,
    p.is_hidden,
    p.created_at,
    p.expires_at,
    p.avatar_icon,
    p.avatar_color,
    p.parent_id,
    p.reply_count,
    p.moderation_status,
    (p.author_id = p_viewer_id) AS is_mine,
    v.vote AS my_vote,
    md5(p.author_id || coalesce(p.parent_id, p.id)::text) AS author_key
  FROM public.chat_posts p
  LEFT JOIN public.chat_votes v
    ON v.post_id = p.id AND v.voter_id = p_viewer_id
  WHERE p.parent_id = p_parent_id
    AND p.is_hidden = false
    AND p.expires_at > now()
    AND NOT EXISTS (
      SELECT 1
      FROM public.chat_blocks b
      WHERE b.blocker_id = p_viewer_id
        AND b.blocked_author_id = p.author_id
    )
  ORDER BY p.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_chat_replies(text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.fetch_chat_post(
  p_viewer_id text,
  p_post_id uuid
)
RETURNS TABLE (
  id uuid,
  body text,
  venue_name text,
  geography_id uuid,
  score integer,
  is_hidden boolean,
  created_at timestamptz,
  expires_at timestamptz,
  avatar_icon text,
  avatar_color text,
  parent_id uuid,
  reply_count integer,
  moderation_status text,
  is_mine boolean,
  my_vote smallint,
  author_key text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.body,
    p.venue_name,
    p.geography_id,
    p.score,
    p.is_hidden,
    p.created_at,
    p.expires_at,
    p.avatar_icon,
    p.avatar_color,
    p.parent_id,
    p.reply_count,
    p.moderation_status,
    (p.author_id = p_viewer_id) AS is_mine,
    v.vote AS my_vote,
    md5(p.author_id || coalesce(p.parent_id, p.id)::text) AS author_key
  FROM public.chat_posts p
  LEFT JOIN public.chat_votes v
    ON v.post_id = p.id AND v.voter_id = p_viewer_id
  WHERE p.id = p_post_id
    AND p.is_hidden = false
    AND p.expires_at > now()
    AND NOT EXISTS (
      SELECT 1
      FROM public.chat_blocks b
      WHERE b.blocker_id = p_viewer_id
        AND b.blocked_author_id = p.author_id
    );
$$;

GRANT EXECUTE ON FUNCTION public.fetch_chat_post(text, uuid) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- Counts + wait (age windows match AppConfig / LiveAPIs.swift)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_venue_counts(
  p_max_age_seconds int DEFAULT 1080
)
RETURNS TABLE (venue_name text, live int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.venue_name,
    count(*)::int AS live
  FROM public.live_locations l
  WHERE l.is_active = true
    AND l.last_updated > now() - make_interval(secs => greatest(coalesce(p_max_age_seconds, 1080), 0))
  GROUP BY l.venue_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_venue_counts(int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_recent_counts(
  p_window_seconds int DEFAULT 1500
)
RETURNS TABLE (venue_name text, recent int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.venue_name,
    count(DISTINCT v.user_id)::int AS recent
  FROM public.presence_visits v
  WHERE v.mode = 'while_using'
    AND v.last_seen_at > now() - make_interval(secs => greatest(coalesce(p_window_seconds, 1500), 0))
  GROUP BY v.venue_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_recent_counts(int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.fetch_wait_summaries(
  p_geography_id uuid,
  p_viewer_id text
)
RETURNS TABLE (
  venue_name text,
  wait_minutes smallint,
  updated_at timestamptz,
  is_mine boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.venue_name,
    r.wait_minutes,
    r.updated_at,
    (r.author_id = p_viewer_id) AS is_mine
  FROM public.venue_wait_reports r
  WHERE r.geography_id = p_geography_id
    AND coalesce(r.is_mock, false) = false
    AND r.updated_at > now() - interval '45 minutes'
  ORDER BY r.updated_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_wait_summaries(uuid, text) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- Presence writes (never store coordinates; privacy trigger also nulls them)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_presence(
  p_user_id text,
  p_venue_name text,
  p_latitude float8,
  p_longitude float8
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  venue_trimmed text;
  v_lat double precision;
  v_lon double precision;
  v_radius_m double precision;
  v_footprint jsonb;
  location_ok boolean := false;
  edge_m double precision;
  last_at timestamptz;
BEGIN
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RAISE EXCEPTION 'user_id required';
  END IF;

  venue_trimmed := trim(p_venue_name);
  IF venue_trimmed IS NULL OR length(venue_trimmed) = 0 THEN
    RAISE EXCEPTION 'venue_name required';
  END IF;

  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RAISE EXCEPTION 'Location required';
  END IF;

  SELECT last_updated INTO last_at
  FROM public.live_locations
  WHERE user_id = p_user_id
    AND venue_name = venue_trimmed
    AND is_active = true;

  -- Soft success within 30s so the iOS queue does not treat this as a failure.
  IF last_at IS NOT NULL AND last_at > now() - interval '30 seconds' THEN
    RETURN;
  END IF;

  SELECT latitude, longitude, radius_m, footprint
    INTO v_lat, v_lon, v_radius_m, v_footprint
  FROM public.catalog_venues
  WHERE name = venue_trimmed;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venue not found';
  END IF;

  IF v_footprint IS NOT NULL AND jsonb_array_length(v_footprint) >= 4 THEN
    IF point_in_venue_footprint(p_latitude, p_longitude, v_footprint) THEN
      location_ok := true;
    ELSE
      edge_m := distance_m_to_venue_footprint(p_latitude, p_longitude, v_footprint);
      location_ok := edge_m IS NOT NULL AND edge_m <= 15;
    END IF;
  ELSE
    location_ok := haversine_miles(v_lat, v_lon, p_latitude, p_longitude)
      <= (coalesce(v_radius_m, 100) / 1609.344);
  END IF;

  IF NOT location_ok THEN
    RAISE EXCEPTION 'Must be at the bar';
  END IF;

  INSERT INTO public.live_locations (
    user_id,
    venue_name,
    latitude,
    longitude,
    is_active,
    last_updated
  )
  VALUES (
    p_user_id,
    venue_trimmed,
    NULL,
    NULL,
    true,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    venue_name = EXCLUDED.venue_name,
    latitude = NULL,
    longitude = NULL,
    is_active = true,
    last_updated = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_presence(text, text, float8, float8) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.clear_presence(
  p_user_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RAISE EXCEPTION 'user_id required';
  END IF;

  UPDATE public.live_locations
  SET
    is_active = false,
    last_updated = now(),
    latitude = NULL,
    longitude = NULL
  WHERE user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_presence(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_presence_visit(
  p_user_id text,
  p_venue_name text,
  p_latitude float8,
  p_longitude float8
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  venue_trimmed text;
  v_lat double precision;
  v_lon double precision;
  v_radius_m double precision;
  v_footprint jsonb;
  location_ok boolean := false;
  edge_m double precision;
  last_at timestamptz;
BEGIN
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RAISE EXCEPTION 'user_id required';
  END IF;

  venue_trimmed := trim(p_venue_name);
  IF venue_trimmed IS NULL OR length(venue_trimmed) = 0 THEN
    RAISE EXCEPTION 'venue_name required';
  END IF;

  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RAISE EXCEPTION 'Location required';
  END IF;

  SELECT last_seen_at INTO last_at
  FROM public.presence_visits
  WHERE user_id = p_user_id
    AND venue_name = venue_trimmed;

  IF last_at IS NOT NULL AND last_at > now() - interval '30 seconds' THEN
    RETURN;
  END IF;

  SELECT latitude, longitude, radius_m, footprint
    INTO v_lat, v_lon, v_radius_m, v_footprint
  FROM public.catalog_venues
  WHERE name = venue_trimmed;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venue not found';
  END IF;

  IF v_footprint IS NOT NULL AND jsonb_array_length(v_footprint) >= 4 THEN
    IF point_in_venue_footprint(p_latitude, p_longitude, v_footprint) THEN
      location_ok := true;
    ELSE
      edge_m := distance_m_to_venue_footprint(p_latitude, p_longitude, v_footprint);
      location_ok := edge_m IS NOT NULL AND edge_m <= 15;
    END IF;
  ELSE
    location_ok := haversine_miles(v_lat, v_lon, p_latitude, p_longitude)
      <= (coalesce(v_radius_m, 100) / 1609.344);
  END IF;

  IF NOT location_ok THEN
    RAISE EXCEPTION 'Must be at the bar';
  END IF;

  INSERT INTO public.presence_visits (
    user_id,
    venue_name,
    mode,
    last_seen_at
  )
  VALUES (
    p_user_id,
    venue_trimmed,
    'while_using',
    now()
  )
  ON CONFLICT (user_id, venue_name) DO UPDATE SET
    mode = 'while_using',
    last_seen_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_presence_visit(text, text, float8, float8) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.expire_presence_visit(
  p_user_id text,
  p_venue_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  venue_trimmed text;
BEGIN
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RAISE EXCEPTION 'user_id required';
  END IF;

  venue_trimmed := trim(p_venue_name);
  IF venue_trimmed IS NULL OR length(venue_trimmed) = 0 THEN
    RAISE EXCEPTION 'venue_name required';
  END IF;

  UPDATE public.presence_visits
  SET last_seen_at = '1970-01-01T00:00:00Z'::timestamptz
  WHERE user_id = p_user_id
    AND venue_name = venue_trimmed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_presence_visit(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
