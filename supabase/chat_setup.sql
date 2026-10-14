-- =============================================================================
-- Campus Chat (Yik Yakâ€“style) for Bar Fest
-- =============================================================================

-- Posts
CREATE TABLE IF NOT EXISTS chat_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 150),
  venue_name TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  avatar_icon TEXT,
  avatar_color TEXT
);

CREATE INDEX IF NOT EXISTS idx_chat_posts_feed_recent
  ON chat_posts (created_at DESC)
  WHERE is_hidden = false;

CREATE INDEX IF NOT EXISTS idx_chat_posts_feed_popular
  ON chat_posts (score DESC, created_at DESC)
  WHERE is_hidden = false;

CREATE INDEX IF NOT EXISTS idx_chat_posts_author_created
  ON chat_posts (author_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_posts_expires
  ON chat_posts (expires_at);

-- Votes: +1 or -1; deleting the row clears the vote
CREATE TABLE IF NOT EXISTS chat_votes (
  post_id UUID NOT NULL REFERENCES chat_posts(id) ON DELETE CASCADE,
  voter_id TEXT NOT NULL,
  vote SMALLINT NOT NULL CHECK (vote IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, voter_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_votes_voter
  ON chat_votes (voter_id);

-- Reports
CREATE TABLE IF NOT EXISTS chat_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES chat_posts(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, reporter_id)
);

-- -----------------------------------------------------------------------------
-- Score refresh + soft-hide at -4 (sticky once hidden)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_chat_post_score()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_id UUID;
  new_score INTEGER;
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
  WHERE id = target_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_votes_refresh_score ON chat_votes;
CREATE TRIGGER trg_chat_votes_refresh_score
AFTER INSERT OR UPDATE OR DELETE ON chat_votes
FOR EACH ROW
EXECUTE FUNCTION refresh_chat_post_score();

-- -----------------------------------------------------------------------------
-- Create post (rate limit + live_locations anti-spoof check)
-- Requires an active live_locations row for author at venue_name,
-- updated within the last 18 minutes (native heartbeat 15m + grace; matches AppConfig.liveLocationChatFreshnessSeconds).
-- Avatar icon/color are snapshotted onto the row at send time.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- Vote: direction 'up' | 'down'. Same direction again clears the vote.
-- Cannot vote on own post. Cannot vote on hidden/expired posts.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_chat_vote(
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
BEGIN
  IF p_voter_id IS NULL OR length(trim(p_voter_id)) = 0 THEN
    RAISE EXCEPTION 'voter_id required';
  END IF;

  IF p_direction NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'direction must be up or down';
  END IF;

  desired := CASE WHEN p_direction = 'up' THEN 1 ELSE -1 END;

  SELECT * INTO post_row
  FROM chat_posts
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
  FROM chat_votes
  WHERE post_id = p_post_id AND voter_id = p_voter_id;

  IF FOUND AND existing = desired THEN
    DELETE FROM chat_votes
    WHERE post_id = p_post_id AND voter_id = p_voter_id;
  ELSE
    INSERT INTO chat_votes (post_id, voter_id, vote, updated_at)
    VALUES (p_post_id, p_voter_id, desired, NOW())
    ON CONFLICT (post_id, voter_id)
    DO UPDATE SET vote = EXCLUDED.vote, updated_at = NOW();
  END IF;

  SELECT * INTO post_row FROM chat_posts WHERE id = p_post_id;
  RETURN post_row;
END;
$$;

-- Soft-delete own post (hide, same as community -4)
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

  RETURN post_row;
END;
$$;

-- Report a post (one report per user per post)
CREATE OR REPLACE FUNCTION report_chat_post(
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
BEGIN
  IF p_reporter_id IS NULL OR length(trim(p_reporter_id)) = 0 THEN
    RAISE EXCEPTION 'reporter_id required';
  END IF;

  SELECT * INTO post_row FROM chat_posts WHERE id = p_post_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found';
  END IF;

  IF post_row.author_id = p_reporter_id THEN
    RAISE EXCEPTION 'Cannot report your own post';
  END IF;

  INSERT INTO chat_reports (post_id, reporter_id, reason)
  VALUES (p_post_id, p_reporter_id, NULLIF(trim(COALESCE(p_reason, '')), ''))
  ON CONFLICT (post_id, reporter_id)
  DO UPDATE SET reason = COALESCE(EXCLUDED.reason, chat_reports.reason)
  RETURNING * INTO report_row;

  RETURN report_row;
END;
$$;

-- Hard-delete expired posts (run on a schedule)
CREATE OR REPLACE FUNCTION cleanup_expired_chat_posts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM chat_posts
  WHERE expires_at <= NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- -----------------------------------------------------------------------------
-- RLS: public read; writes go through SECURITY DEFINER RPCs only
-- (no INSERT/UPDATE/DELETE policies => direct client writes denied)
-- Feed queries still filter is_hidden / expires_at in the app + RPC checks.
-- Tighten with Supabase Auth later.
-- -----------------------------------------------------------------------------
ALTER TABLE chat_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_posts_select_all" ON chat_posts;
CREATE POLICY "chat_posts_select_all"
  ON chat_posts FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "chat_votes_select_all" ON chat_votes;
CREATE POLICY "chat_votes_select_all"
  ON chat_votes FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "chat_reports_select_all" ON chat_reports;
CREATE POLICY "chat_reports_select_all"
  ON chat_reports FOR SELECT
  USING (true);

-- Grant RPC execution to the public client role
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON chat_posts TO anon, authenticated;
GRANT SELECT ON chat_votes TO anon, authenticated;
GRANT SELECT ON chat_reports TO anon, authenticated;

GRANT EXECUTE ON FUNCTION create_chat_post(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_chat_vote(UUID, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION hide_own_chat_post(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION report_chat_post(UUID, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_chat_posts() TO anon, authenticated;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE chat_posts;
