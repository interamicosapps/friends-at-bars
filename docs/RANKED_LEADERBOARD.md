# Ranked daily leaderboard (Supabase)

Run this SQL in the Supabase SQL Editor before using Ranked mode in the app.

## Table: `ranked_daily_scores`

```sql
CREATE TABLE ranked_daily_scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  game_type TEXT NOT NULL CHECK (game_type IN ('switch-search', 'ride-the-bus', 'boozed')),
  play_date DATE NOT NULL,
  venue_name TEXT NOT NULL,
  words_found INTEGER,
  time_left INTEGER,
  drink_count INTEGER,
  completed BOOLEAN,
  score_points INTEGER,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, game_type, play_date)
);

CREATE INDEX idx_ranked_switch_today
  ON ranked_daily_scores (game_type, play_date, words_found DESC, time_left DESC)
  WHERE game_type = 'switch-search';

CREATE INDEX idx_ranked_ride_today
  ON ranked_daily_scores (game_type, play_date, completed DESC, drink_count ASC, finished_at ASC)
  WHERE game_type = 'ride-the-bus';

CREATE INDEX idx_ranked_boozed_today
  ON ranked_daily_scores (game_type, play_date, score_points DESC, finished_at ASC)
  WHERE game_type = 'boozed';

ALTER TABLE ranked_daily_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ranked_select_all"
  ON ranked_daily_scores FOR SELECT
  USING (true);

CREATE POLICY "ranked_insert_own"
  ON ranked_daily_scores FOR INSERT
  WITH CHECK (true);
```

**Note:** v1 uses open INSERT/SELECT like `live_locations`. Tighten to `user_id = current_setting(...)` when you add Auth.

## Calendar day

Leaderboard “today” uses **America/New_York** (`play_date` as `YYYY-MM-DD`). The app computes this client-side in `getRankedPlayDateEastern()`.

## Scoring

| Game | Sort |
|------|------|
| Switch Search | Higher `words_found`, then higher `time_left` |
| Ride the Bus | `completed` first, then lower `drink_count`, then earlier `finished_at` |
| Boozed | Higher `score_points` (best cash-out that Eastern day), then earlier `finished_at` |

Boozed also uses `boozed_profiles` / `boozed_rounds` — see [`docs/BOOZED_SPEC.md`](BOOZED_SPEC.md) and [`supabase/boozed.sql`](../supabase/boozed.sql).

## Manual QA

1. Run SQL above; confirm Realtime is **not** required.
2. Two browsers/devices → two different `location_user_id` values (incognito helps).
3. At a venue (within 100 m): Ranked → play → score on leaderboard with venue name.
4. Ranked again same day → leaderboard only (no second play).
5. View Ranked off-venue after playing → leaderboard still loads.
6. After Eastern midnight, Ranked allows a new run for that game.
