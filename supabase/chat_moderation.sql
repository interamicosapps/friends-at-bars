-- Chat moderation (step 1.5) — App Store guideline 1.2 server half + CMS queue.
--
-- Client-supplied author / voter / reporter ids remain spoofable until a later
-- auth.uid() (Supabase Anonymous Sign-In) migration. Rate limits and filters
-- still raise the cost of abuse.
--
-- iOS (native LiveAPIs.swift) calls:
--   create_chat_post(p_author_id, p_body, p_geography_id, p_latitude, p_longitude,
--                    p_venue_name?, p_avatar_icon, p_avatar_color, p_parent_id?)
--   set_chat_vote(p_post_id, p_voter_id, p_direction)
--   report_chat_post(p_post_id, p_reporter_id, p_reason?)
--   hide_own_chat_post(p_post_id, p_author_id) — unchanged in this file
-- Grep confirmed: the iOS app never reads chat_reports.
--
-- create_chat_post body is based on supabase/chat_replies.sql (geography + parent_id).
-- Older TEXT-only overloads are not dropped; the app uses the 9-arg form only.
-- Idempotent. Run in the Supabase SQL Editor. Do not run from the app.

-- -----------------------------------------------------------------------------
-- Blocked words
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_blocked_words (
  word text PRIMARY KEY
);

ALTER TABLE public.chat_blocked_words ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_blocked_words_admin_select ON public.chat_blocked_words;
CREATE POLICY chat_blocked_words_admin_select
  ON public.chat_blocked_words FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS chat_blocked_words_admin_insert ON public.chat_blocked_words;
CREATE POLICY chat_blocked_words_admin_insert
  ON public.chat_blocked_words FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS chat_blocked_words_admin_delete ON public.chat_blocked_words;
CREATE POLICY chat_blocked_words_admin_delete
  ON public.chat_blocked_words FOR DELETE
  USING (public.is_admin());

GRANT SELECT, INSERT, DELETE ON public.chat_blocked_words TO authenticated;

-- -----------------------------------------------------------------------------
-- Moderation status on posts
-- -----------------------------------------------------------------------------
ALTER TABLE public.chat_posts
  ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chat_posts_moderation_status_check'
      AND conrelid = 'public.chat_posts'::regclass
  ) THEN
    ALTER TABLE public.chat_posts
      ADD CONSTRAINT chat_posts_moderation_status_check
      CHECK (moderation_status IN ('none', 'reviewed_ok', 'removed'));
  END IF;
END $$;

-- Soft-hide at -4 only when an admin has not already kept the post.
CREATE OR REPLACE FUNCTION public.refresh_chat_post_score()
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
  FROM public.chat_votes
  WHERE post_id = target_id;

  UPDATE public.chat_posts
  SET
    score = new_score,
    is_hidden = CASE
      WHEN new_score <= -4
        AND moderation_status IS DISTINCT FROM 'reviewed_ok'
      THEN true
      ELSE is_hidden
    END
  WHERE id = target_id
  RETURNING is_hidden INTO parent_hidden;

  IF parent_hidden THEN
    UPDATE public.chat_posts
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

-- -----------------------------------------------------------------------------
-- report_chat_post
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_chat_post(
  p_post_id UUID,
  p_reporter_id TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS chat_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  post_row chat_posts;
  report_row chat_reports;
  recent_reports INT;
  distinct_reporters INT;
BEGIN
  IF p_reporter_id IS NULL OR length(trim(p_reporter_id)) = 0 THEN
    RAISE EXCEPTION 'reporter_id required';
  END IF;

  SELECT count(*)
    INTO recent_reports
  FROM public.chat_reports
  WHERE reporter_id = p_reporter_id
    AND created_at > NOW() - INTERVAL '1 hour';

  IF recent_reports >= 10 THEN
    RAISE EXCEPTION 'Slow down — try again later';
  END IF;

  SELECT * INTO post_row FROM public.chat_posts WHERE id = p_post_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found';
  END IF;

  IF post_row.author_id = p_reporter_id THEN
    RAISE EXCEPTION 'Cannot report your own post';
  END IF;

  INSERT INTO public.chat_reports (post_id, reporter_id, reason)
  VALUES (p_post_id, p_reporter_id, NULLIF(trim(COALESCE(p_reason, '')), ''))
  ON CONFLICT (post_id, reporter_id)
  DO UPDATE SET reason = COALESCE(EXCLUDED.reason, chat_reports.reason)
  RETURNING * INTO report_row;

  -- Do not auto-hide a post an admin already kept; only record the report.
  IF post_row.moderation_status IS DISTINCT FROM 'reviewed_ok' THEN
    SELECT count(DISTINCT reporter_id)
      INTO distinct_reporters
    FROM public.chat_reports
    WHERE post_id = p_post_id;

    IF distinct_reporters >= 3 THEN
      UPDATE public.chat_posts
      SET is_hidden = true
      WHERE id = p_post_id
         OR parent_id = p_post_id;
    END IF;
  END IF;

  RETURN report_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_chat_post(UUID, TEXT, TEXT) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- set_chat_vote
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_chat_vote(
  p_post_id UUID,
  p_voter_id TEXT,
  p_direction TEXT
)
RETURNS chat_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  post_row chat_posts;
  existing SMALLINT;
  desired SMALLINT;
  recent_votes INT;
BEGIN
  IF p_voter_id IS NULL OR length(trim(p_voter_id)) = 0 THEN
    RAISE EXCEPTION 'voter_id required';
  END IF;

  IF p_direction NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'direction must be up or down';
  END IF;

  SELECT count(*)
    INTO recent_votes
  FROM public.chat_votes
  WHERE voter_id = p_voter_id
    AND updated_at > NOW() - INTERVAL '1 hour';

  IF recent_votes >= 60 THEN
    RAISE EXCEPTION 'Slow down — try again later';
  END IF;

  desired := CASE WHEN p_direction = 'up' THEN 1 ELSE -1 END;

  SELECT * INTO post_row
  FROM public.chat_posts
  WHERE id = p_post_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found';
  END IF;

  IF post_row.is_hidden OR post_row.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Post is not available';
  END IF;

  IF post_row.author_id = p_voter_id THEN
    RAISE EXCEPTION 'Cannot vote on your own post';
  END IF;

  SELECT vote INTO existing
  FROM public.chat_votes
  WHERE post_id = p_post_id AND voter_id = p_voter_id;

  IF FOUND AND existing = desired THEN
    DELETE FROM public.chat_votes
    WHERE post_id = p_post_id AND voter_id = p_voter_id;
  ELSE
    INSERT INTO public.chat_votes (post_id, voter_id, vote, updated_at)
    VALUES (p_post_id, p_voter_id, desired, NOW())
    ON CONFLICT (post_id, voter_id)
    DO UPDATE SET vote = EXCLUDED.vote, updated_at = NOW();
  END IF;

  SELECT * INTO post_row FROM public.chat_posts WHERE id = p_post_id;
  RETURN post_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_chat_vote(UUID, TEXT, TEXT) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- create_chat_post (same 9-arg signature the iOS app calls)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_chat_post(
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
  recent_posts INT;
  blocked RECORD;
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

  SELECT count(*)
    INTO recent_posts
  FROM public.chat_posts
  WHERE author_id = p_author_id
    AND created_at > NOW() - INTERVAL '1 hour';

  IF recent_posts >= 12 THEN
    RAISE EXCEPTION 'Slow down — try again later';
  END IF;

  FOR blocked IN
    SELECT word
    FROM public.chat_blocked_words
  LOOP
    IF lower(trimmed) ~ (
      '(^|[^[:alnum:]])'
      || regexp_replace(lower(blocked.word), '([\\.^$|()*+?\[\]{}])', '\\\1', 'g')
      || '([^[:alnum:]]|$)'
    ) THEN
      RAISE EXCEPTION 'Post blocked by filter';
    END IF;
  END LOOP;

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
    SELECT * INTO parent_row FROM public.chat_posts WHERE id = p_parent_id;
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

    INSERT INTO public.chat_posts (
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

  INSERT INTO public.chat_posts (
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

GRANT EXECUTE ON FUNCTION public.create_chat_post(
  TEXT, TEXT, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, UUID
) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- Admin moderation RPC
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_post_moderation(
  p_post_id UUID,
  p_status TEXT
)
RETURNS chat_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  post_row chat_posts;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('reviewed_ok', 'removed') THEN
    RAISE EXCEPTION 'status must be reviewed_ok or removed';
  END IF;

  UPDATE public.chat_posts
  SET
    moderation_status = p_status,
    is_hidden = (p_status = 'removed')
  WHERE id = p_post_id
  RETURNING * INTO post_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found';
  END IF;

  IF p_status = 'removed' THEN
    UPDATE public.chat_posts
    SET is_hidden = true
    WHERE parent_id = p_post_id
      AND is_hidden = false;
  ELSIF p_status = 'reviewed_ok' THEN
    -- Un-hide replies that were hidden only because the parent was hidden.
    UPDATE public.chat_posts AS reply
    SET is_hidden = false
    WHERE reply.parent_id = p_post_id
      AND reply.moderation_status IS DISTINCT FROM 'removed'
      AND reply.score > -4
      AND (
        SELECT count(DISTINCT r.reporter_id)
        FROM public.chat_reports AS r
        WHERE r.post_id = reply.id
      ) < 3;
  END IF;

  RETURN post_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_post_moderation(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_post_moderation(UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- Revoke public execute on legacy create_chat_post overloads (do not drop them).
-- Found in supabase/*.sql history:
--   (TEXT, TEXT, TEXT) — early chat_setup drop/create path
--   (TEXT, TEXT, TEXT, TEXT, TEXT) — chat_setup / chat_avatar_snapshot / freshness_18m
--   (TEXT, TEXT, UUID, float8, float8, TEXT, TEXT, TEXT) — pre-parent_id geography form
-- Kept callable:
--   (TEXT, TEXT, UUID, float8, float8, TEXT, TEXT, TEXT, UUID) — iOS app only
-- -----------------------------------------------------------------------------

-- Legacy overload without the word filter or hourly cap; the iOS app only calls the
-- 9-argument version. Do not drop it.
DO $$
BEGIN
  IF to_regprocedure('public.create_chat_post(text,text,text,text,text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.create_chat_post(TEXT, TEXT, TEXT, TEXT, TEXT)
      FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regprocedure('public.create_chat_post(text,text,text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.create_chat_post(TEXT, TEXT, TEXT)
      FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regprocedure(
    'public.create_chat_post(text,text,uuid,double precision,double precision,text,text,text)'
  ) IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.create_chat_post(
      TEXT, TEXT, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT
    ) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- chat_reports: admin-only SELECT
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "chat_reports_select_all" ON public.chat_reports;
DROP POLICY IF EXISTS chat_reports_select_admin ON public.chat_reports;
CREATE POLICY chat_reports_select_admin
  ON public.chat_reports FOR SELECT
  USING (public.is_admin());

REVOKE SELECT ON public.chat_reports FROM anon;
GRANT SELECT ON public.chat_reports TO authenticated;

NOTIFY pgrst, 'reload schema';
