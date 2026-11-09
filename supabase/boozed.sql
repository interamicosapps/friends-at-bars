-- =============================================================================
-- Boozed (Mines / push-your-luck) — tables + RPCs
-- Bombs never leave the server while status = 'active'.
-- Run in the Supabase SQL editor (safe to re-run).
-- Identity: anonymous p_user_id TEXT (same pattern as chat / wait reports).
-- =============================================================================

-- Extend ranked daily scores for boozed
ALTER TABLE IF EXISTS ranked_daily_scores
  DROP CONSTRAINT IF EXISTS ranked_daily_scores_game_type_check;

ALTER TABLE IF EXISTS ranked_daily_scores
  ADD CONSTRAINT ranked_daily_scores_game_type_check
  CHECK (game_type IN ('switch-search', 'ride-the-bus', 'boozed'));

ALTER TABLE IF EXISTS ranked_daily_scores
  ADD COLUMN IF NOT EXISTS score_points INTEGER;

CREATE INDEX IF NOT EXISTS idx_ranked_boozed_today
  ON ranked_daily_scores (game_type, play_date, score_points DESC, finished_at ASC)
  WHERE game_type = 'boozed';

-- Profiles
CREATE TABLE IF NOT EXISTS boozed_profiles (
  user_id TEXT PRIMARY KEY,
  tab_score INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best_multiplier NUMERIC(12, 6) NOT NULL DEFAULT 1,
  rounds_played INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE boozed_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS boozed_profiles_select ON boozed_profiles;
CREATE POLICY boozed_profiles_select ON boozed_profiles
  FOR SELECT TO anon, authenticated
  USING (true);

-- Rounds (writes via SECURITY DEFINER RPCs only)
CREATE TABLE IF NOT EXISTS boozed_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  proof SMALLINT NOT NULL CHECK (proof IN (80, 100, 120, 151)),
  shots SMALLINT NOT NULL,
  bomb_positions INTEGER[] NOT NULL,
  item_assignments JSONB NOT NULL,
  revealed_tiles INTEGER[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cashed', 'blown', 'cleared')),
  safe_count INTEGER NOT NULL DEFAULT 0,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  multiplier_at_end NUMERIC(12, 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_boozed_rounds_user_active
  ON boozed_rounds (user_id, status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_boozed_rounds_user_created
  ON boozed_rounds (user_id, created_at DESC);

ALTER TABLE boozed_rounds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS boozed_rounds_select ON boozed_rounds;
CREATE POLICY boozed_rounds_select ON boozed_rounds
  FOR SELECT TO anon, authenticated
  USING (true);

-- Config helpers
CREATE OR REPLACE FUNCTION boozed_shots_for_proof(p_proof INTEGER)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_proof
    WHEN 80 THEN 3
    WHEN 100 THEN 5
    WHEN 120 THEN 8
    WHEN 151 THEN 12
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION boozed_multiplier(p_k INTEGER, p_m INTEGER)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result NUMERIC := 1;
  i INTEGER;
BEGIN
  IF p_k IS NULL OR p_k <= 0 THEN
    RETURN 1;
  END IF;
  FOR i IN 0..(p_k - 1) LOOP
    result := result * (25 - i)::NUMERIC / (25 - p_m - i)::NUMERIC;
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION boozed_expire_stale_rounds(p_user_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE boozed_rounds
  SET status = 'blown',
      ended_at = NOW(),
      points_awarded = 0
  WHERE user_id = p_user_id
    AND status = 'active'
    AND created_at < NOW() - INTERVAL '24 hours';

  IF FOUND THEN
    INSERT INTO boozed_profiles (user_id, streak, rounds_played, updated_at)
    VALUES (p_user_id, 0, 0, NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET streak = 0,
          updated_at = NOW();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION boozed_ensure_profile(p_user_id TEXT)
RETURNS boozed_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row boozed_profiles;
BEGIN
  INSERT INTO boozed_profiles (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO row FROM boozed_profiles WHERE user_id = p_user_id;
  RETURN row;
END;
$$;

CREATE OR REPLACE FUNCTION boozed_public_board(p_assignments JSONB, p_revealed INTEGER[])
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  out_arr JSONB := '[]'::JSONB;
  i INTEGER;
  cell JSONB;
  revealed BOOLEAN;
BEGIN
  FOR i IN 0..24 LOOP
    cell := p_assignments -> i;
    revealed := p_revealed @> ARRAY[i];
    IF revealed THEN
      out_arr := out_arr || jsonb_build_array(jsonb_build_object(
        'tile', i,
        'type', cell ->> 't',
        'item', cell ->> 'n',
        'revealed', true
      ));
    ELSE
      out_arr := out_arr || jsonb_build_array(jsonb_build_object(
        'tile', i,
        'revealed', false
      ));
    END IF;
  END LOOP;
  RETURN out_arr;
END;
$$;

CREATE OR REPLACE FUNCTION boozed_full_board(p_assignments JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  out_arr JSONB := '[]'::JSONB;
  i INTEGER;
  cell JSONB;
BEGIN
  FOR i IN 0..24 LOOP
    cell := p_assignments -> i;
    out_arr := out_arr || jsonb_build_array(jsonb_build_object(
      'tile', i,
      'type', cell ->> 't',
      'item', cell ->> 'n',
      'revealed', true
    ));
  END LOOP;
  RETURN out_arr;
END;
$$;

-- SAFE / SHOT name pools (config)
CREATE OR REPLACE FUNCTION boozed_build_assignments(p_bombs INTEGER[])
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  safes TEXT[] := ARRAY[
    'Water','Pretzels','Seltzer','Nachos','Lime wedge','Fries','Light beer','Ginger ale',
    'Wings','Club soda','Orange juice','Popcorn','Cola','Slider','Pickle spear','Peanuts',
    'Iced tea','Tater tots','Mozz sticks','Cranberry','Tonic','Chips + salsa','Soft pretzel',
    'Mocktail','Garlic bread'
  ];
  shots TEXT[] := ARRAY[
    'Everclear','Bacardi 151','Absinthe','Fireball','Rumple Minze','Malort','Jager shot',
    'Cheap tequila','Moonshine','Goldschlager','Sambuca','Overproof rum'
  ];
  assignments JSONB := '[]'::JSONB;
  i INTEGER;
  safe_idx INTEGER := 1;
  shot_idx INTEGER := 1;
  name TEXT;
  kind TEXT;
  shuffled_safes TEXT[];
  shuffled_shots TEXT[];
BEGIN
  -- Fisher–Yates-ish via ORDER BY random()
  SELECT array_agg(s ORDER BY random()) INTO shuffled_safes FROM unnest(safes) AS s;
  SELECT array_agg(s ORDER BY random()) INTO shuffled_shots FROM unnest(shots) AS s;

  FOR i IN 0..24 LOOP
    IF p_bombs @> ARRAY[i] THEN
      kind := 'shot';
      name := shuffled_shots[shot_idx];
      shot_idx := shot_idx + 1;
      IF shot_idx > coalesce(array_length(shuffled_shots, 1), 0) THEN
        shot_idx := 1;
      END IF;
    ELSE
      kind := 'safe';
      name := shuffled_safes[safe_idx];
      safe_idx := safe_idx + 1;
      IF safe_idx > coalesce(array_length(shuffled_safes, 1), 0) THEN
        safe_idx := 1;
      END IF;
    END IF;
    assignments := assignments || jsonb_build_array(jsonb_build_object('t', kind, 'n', name));
  END LOOP;
  RETURN assignments;
END;
$$;

CREATE OR REPLACE FUNCTION boozed_pick_bombs(p_m INTEGER)
RETURNS INTEGER[]
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  picks INTEGER[];
BEGIN
  SELECT array_agg(x ORDER BY random()) INTO picks
  FROM (
    SELECT generate_series(0, 24) AS x
    ORDER BY random()
    LIMIT p_m
  ) q;
  RETURN picks;
END;
$$;

CREATE OR REPLACE FUNCTION boozed_apply_cashout_stats(
  p_user_id TEXT,
  p_points INTEGER,
  p_multiplier NUMERIC,
  p_play_date DATE DEFAULT ((NOW() AT TIME ZONE 'America/New_York')::DATE)
)
RETURNS boozed_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prof boozed_profiles;
BEGIN
  INSERT INTO boozed_profiles (user_id, tab_score, streak, best_multiplier, rounds_played, updated_at)
  VALUES (
    p_user_id,
    p_points,
    1,
    GREATEST(1::NUMERIC, p_multiplier),
    1,
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    tab_score = boozed_profiles.tab_score + EXCLUDED.tab_score,
    streak = boozed_profiles.streak + 1,
    best_multiplier = GREATEST(boozed_profiles.best_multiplier, EXCLUDED.best_multiplier),
    rounds_played = boozed_profiles.rounds_played + 1,
    updated_at = NOW();

  INSERT INTO ranked_daily_scores (
    user_id, game_type, play_date, venue_name, score_points, finished_at
  ) VALUES (
    p_user_id, 'boozed', p_play_date, 'Casual', p_points, NOW()
  )
  ON CONFLICT (user_id, game_type, play_date) DO UPDATE SET
    score_points = GREATEST(COALESCE(ranked_daily_scores.score_points, 0), EXCLUDED.score_points),
    finished_at = CASE
      WHEN EXCLUDED.score_points > COALESCE(ranked_daily_scores.score_points, 0) THEN EXCLUDED.finished_at
      ELSE ranked_daily_scores.finished_at
    END,
    venue_name = ranked_daily_scores.venue_name;

  SELECT * INTO prof FROM boozed_profiles WHERE user_id = p_user_id;
  RETURN prof;
END;
$$;

CREATE OR REPLACE FUNCTION boozed_apply_blow_stats(p_user_id TEXT)
RETURNS boozed_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prof boozed_profiles;
BEGIN
  INSERT INTO boozed_profiles (user_id, streak, rounds_played, updated_at)
  VALUES (p_user_id, 0, 1, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    streak = 0,
    rounds_played = boozed_profiles.rounds_played + 1,
    updated_at = NOW();

  SELECT * INTO prof FROM boozed_profiles WHERE user_id = p_user_id;
  RETURN prof;
END;
$$;

-- ---------- RPCs ----------

DROP FUNCTION IF EXISTS boozed_start(TEXT, INTEGER);
CREATE OR REPLACE FUNCTION boozed_start(p_user_id TEXT, p_proof INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m INTEGER;
  bombs INTEGER[];
  assignments JSONB;
  new_id UUID;
BEGIN
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RAISE EXCEPTION 'user_id required';
  END IF;

  m := boozed_shots_for_proof(p_proof);
  IF m IS NULL THEN
    RAISE EXCEPTION 'invalid proof';
  END IF;

  PERFORM boozed_expire_stale_rounds(p_user_id);
  PERFORM boozed_ensure_profile(p_user_id);

  IF EXISTS (
    SELECT 1 FROM boozed_rounds
    WHERE user_id = p_user_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'active round exists';
  END IF;

  bombs := boozed_pick_bombs(m);
  assignments := boozed_build_assignments(bombs);

  INSERT INTO boozed_rounds (user_id, proof, shots, bomb_positions, item_assignments)
  VALUES (p_user_id, p_proof, m, bombs, assignments)
  RETURNING id INTO new_id;

  RETURN jsonb_build_object(
    'roundId', new_id,
    'proof', p_proof,
    'shots', m,
    'tiles', 25,
    'safeCount', 0,
    'multiplier', 1,
    'nextMultiplier', boozed_multiplier(1, m),
    'nextShotChance', m::NUMERIC / 25
  );
END;
$$;

DROP FUNCTION IF EXISTS boozed_reveal(TEXT, UUID, INTEGER);
CREATE OR REPLACE FUNCTION boozed_reveal(p_user_id TEXT, p_round_id UUID, p_tile INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r boozed_rounds;
  cell JSONB;
  new_k INTEGER;
  mult NUMERIC;
  next_mult NUMERIC;
  safes_left INTEGER;
  prof boozed_profiles;
BEGIN
  IF p_tile < 0 OR p_tile > 24 THEN
    RAISE EXCEPTION 'tile out of range';
  END IF;

  PERFORM boozed_expire_stale_rounds(p_user_id);

  SELECT * INTO r FROM boozed_rounds
  WHERE id = p_round_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'round not found';
  END IF;
  IF r.status <> 'active' THEN
    RAISE EXCEPTION 'round not active';
  END IF;

  -- Idempotent: already revealed
  IF r.revealed_tiles @> ARRAY[p_tile] THEN
    cell := r.item_assignments -> p_tile;
    mult := boozed_multiplier(r.safe_count, r.shots);
    RETURN jsonb_build_object(
      'result', CASE WHEN (cell ->> 't') = 'shot' THEN 'shot' ELSE 'safe' END,
      'item', cell ->> 'n',
      'tile', p_tile,
      'k', r.safe_count,
      'multiplier', mult,
      'nextMultiplier', boozed_multiplier(r.safe_count + 1, r.shots),
      'nextShotChance', CASE WHEN (25 - r.safe_count) > 0
        THEN r.shots::NUMERIC / (25 - r.safe_count) ELSE 0 END,
      'boardCleared', false,
      'idempotent', true
    );
  END IF;

  cell := r.item_assignments -> p_tile;

  IF r.bomb_positions @> ARRAY[p_tile] THEN
    UPDATE boozed_rounds SET
      revealed_tiles = array_append(r.revealed_tiles, p_tile),
      status = 'blown',
      points_awarded = 0,
      multiplier_at_end = boozed_multiplier(r.safe_count, r.shots),
      ended_at = NOW()
    WHERE id = r.id;

    prof := boozed_apply_blow_stats(p_user_id);

    RETURN jsonb_build_object(
      'result', 'shot',
      'item', cell ->> 'n',
      'tile', p_tile,
      'k', r.safe_count,
      'multiplier', boozed_multiplier(r.safe_count, r.shots),
      'points', 0,
      'tabScore', prof.tab_score,
      'streak', prof.streak,
      'bestMultiplier', prof.best_multiplier,
      'board', boozed_full_board(r.item_assignments)
    );
  END IF;

  new_k := r.safe_count + 1;
  mult := boozed_multiplier(new_k, r.shots);
  safes_left := 25 - r.shots - new_k;

  IF safes_left <= 0 THEN
    -- Board cleared → auto cash out
    UPDATE boozed_rounds SET
      revealed_tiles = array_append(r.revealed_tiles, p_tile),
      safe_count = new_k,
      status = 'cleared',
      points_awarded = floor(100 * mult)::INTEGER,
      multiplier_at_end = mult,
      ended_at = NOW()
    WHERE id = r.id;

    prof := boozed_apply_cashout_stats(
      p_user_id,
      floor(100 * mult)::INTEGER,
      mult
    );

    RETURN jsonb_build_object(
      'result', 'safe',
      'item', cell ->> 'n',
      'tile', p_tile,
      'k', new_k,
      'multiplier', mult,
      'boardCleared', true,
      'points', floor(100 * mult)::INTEGER,
      'tabScore', prof.tab_score,
      'streak', prof.streak,
      'bestMultiplier', prof.best_multiplier,
      'board', boozed_full_board(r.item_assignments)
    );
  END IF;

  UPDATE boozed_rounds SET
    revealed_tiles = array_append(r.revealed_tiles, p_tile),
    safe_count = new_k
  WHERE id = r.id;

  next_mult := boozed_multiplier(new_k + 1, r.shots);

  RETURN jsonb_build_object(
    'result', 'safe',
    'item', cell ->> 'n',
    'tile', p_tile,
    'k', new_k,
    'multiplier', mult,
    'nextMultiplier', next_mult,
    'nextShotChance', r.shots::NUMERIC / (25 - new_k),
    'boardCleared', false,
    'pointsIfCashout', floor(100 * mult)::INTEGER
  );
END;
$$;

DROP FUNCTION IF EXISTS boozed_cashout(TEXT, UUID);
CREATE OR REPLACE FUNCTION boozed_cashout(p_user_id TEXT, p_round_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r boozed_rounds;
  mult NUMERIC;
  pts INTEGER;
  prof boozed_profiles;
BEGIN
  PERFORM boozed_expire_stale_rounds(p_user_id);

  SELECT * INTO r FROM boozed_rounds
  WHERE id = p_round_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'round not found';
  END IF;
  IF r.status <> 'active' THEN
    RAISE EXCEPTION 'round not active';
  END IF;
  IF r.safe_count < 1 THEN
    RAISE EXCEPTION 'cashout requires at least one safe reveal';
  END IF;

  mult := boozed_multiplier(r.safe_count, r.shots);
  pts := floor(100 * mult)::INTEGER;

  UPDATE boozed_rounds SET
    status = 'cashed',
    points_awarded = pts,
    multiplier_at_end = mult,
    ended_at = NOW()
  WHERE id = r.id;

  prof := boozed_apply_cashout_stats(p_user_id, pts, mult);

  RETURN jsonb_build_object(
    'points', pts,
    'multiplier', mult,
    'tabScore', prof.tab_score,
    'streak', prof.streak,
    'bestMultiplier', prof.best_multiplier,
    'board', boozed_full_board(r.item_assignments)
  );
END;
$$;

DROP FUNCTION IF EXISTS boozed_me(TEXT);
CREATE OR REPLACE FUNCTION boozed_me(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prof boozed_profiles;
  r boozed_rounds;
  active JSONB := NULL;
  mult NUMERIC;
BEGIN
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RAISE EXCEPTION 'user_id required';
  END IF;

  PERFORM boozed_expire_stale_rounds(p_user_id);
  prof := boozed_ensure_profile(p_user_id);

  SELECT * INTO r FROM boozed_rounds
  WHERE user_id = p_user_id AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    mult := boozed_multiplier(r.safe_count, r.shots);
    active := jsonb_build_object(
      'roundId', r.id,
      'proof', r.proof,
      'shots', r.shots,
      'safeCount', r.safe_count,
      'multiplier', mult,
      'nextMultiplier', boozed_multiplier(r.safe_count + 1, r.shots),
      'nextShotChance', CASE WHEN (25 - r.safe_count) > 0
        THEN r.shots::NUMERIC / (25 - r.safe_count) ELSE 0 END,
      'pointsIfCashout', CASE WHEN r.safe_count >= 1 THEN floor(100 * mult)::INTEGER ELSE 0 END,
      'board', boozed_public_board(r.item_assignments, r.revealed_tiles)
    );
  END IF;

  RETURN jsonb_build_object(
    'tabScore', prof.tab_score,
    'streak', prof.streak,
    'bestMultiplier', prof.best_multiplier,
    'roundsPlayed', prof.rounds_played,
    'activeRound', active
  );
END;
$$;

GRANT EXECUTE ON FUNCTION boozed_start(TEXT, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION boozed_reveal(TEXT, UUID, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION boozed_cashout(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION boozed_me(TEXT) TO anon, authenticated;
