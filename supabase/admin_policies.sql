-- CMS admin policies (step 1.3).
-- Run supabase/admin_users.sql first, then:
--   INSERT INTO admin_users (user_id) VALUES ('<YOUR-AUTH-USER-ID>');
-- Then run this file. If you run this before the INSERT, the CMS locks you out.
--
-- Policies changed:
--   catalog_venues_select_active          SELECT  is_active OR is_admin()
--   catalog_venues_admin_write            ALL     is_admin()
--   catalog_listings_select_active        SELECT  is_active OR is_admin()
--   catalog_listings_admin_write          ALL     is_admin()
--   catalog_game_select_active            SELECT  is_active OR is_admin()
--   catalog_game_admin_write              ALL     is_admin()
--   catalog_config_admin_write            ALL     is_admin()
--   catalog_geographies_select            SELECT  is_active OR is_admin()
--   catalog_geographies_admin_write       ALL     is_admin()
--   catalog_areas_select                  SELECT  is_active OR is_admin()
--   catalog_areas_admin_write             ALL     is_admin()
--   catalog_games_admin_write             ALL     is_admin()
--   mock_attendance_admin_write           ALL     is_admin()
--   mock_wait_admin_write                 ALL     is_admin()
--   catalog_feedback_admin_select         SELECT  is_admin()  (admin read, not a public catalog read)
--   catalog_feedback_admin_update         UPDATE  is_admin()
--
-- Searched supabase/*.sql for auth.uid() IS NOT NULL: none found. None converted.
-- Left unchanged on purpose:
--   catalog_config_select, catalog_games_select, mock_attendance_select, mock_wait_select
--     (public SELECT using true)
--   chat_posts_select_all, chat_votes_select_all, chat_reports_select_all
--   boozed_profiles_select, boozed_rounds_select
--   venue_wait_reports_select
--   presence_visits_select, presence_visits_upsert, presence_visits_update
--   live_locations policies (not in this step)
--
-- Idempotent. Run in the Supabase SQL Editor.

DROP POLICY IF EXISTS "catalog_venues_select_active" ON catalog_venues;
CREATE POLICY "catalog_venues_select_active"
  ON catalog_venues FOR SELECT
  USING (is_active = true OR public.is_admin());

DROP POLICY IF EXISTS "catalog_venues_admin_write" ON catalog_venues;
CREATE POLICY "catalog_venues_admin_write"
  ON catalog_venues FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "catalog_listings_select_active" ON catalog_listings;
CREATE POLICY "catalog_listings_select_active"
  ON catalog_listings FOR SELECT
  USING (is_active = true OR public.is_admin());

DROP POLICY IF EXISTS "catalog_listings_admin_write" ON catalog_listings;
CREATE POLICY "catalog_listings_admin_write"
  ON catalog_listings FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "catalog_game_select_active" ON catalog_game_content;
CREATE POLICY "catalog_game_select_active"
  ON catalog_game_content FOR SELECT
  USING (is_active = true OR public.is_admin());

DROP POLICY IF EXISTS "catalog_game_admin_write" ON catalog_game_content;
CREATE POLICY "catalog_game_admin_write"
  ON catalog_game_content FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "catalog_config_admin_write" ON catalog_app_config;
CREATE POLICY "catalog_config_admin_write"
  ON catalog_app_config FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "catalog_geographies_select" ON catalog_geographies;
CREATE POLICY "catalog_geographies_select"
  ON catalog_geographies FOR SELECT
  USING (is_active = true OR public.is_admin());

DROP POLICY IF EXISTS "catalog_geographies_admin_write" ON catalog_geographies;
CREATE POLICY "catalog_geographies_admin_write"
  ON catalog_geographies FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "catalog_areas_select" ON catalog_areas;
CREATE POLICY "catalog_areas_select"
  ON catalog_areas FOR SELECT
  USING (is_active = true OR public.is_admin());

DROP POLICY IF EXISTS "catalog_areas_admin_write" ON catalog_areas;
CREATE POLICY "catalog_areas_admin_write"
  ON catalog_areas FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS catalog_games_admin_write ON catalog_games;
CREATE POLICY catalog_games_admin_write
  ON catalog_games FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "mock_attendance_admin_write" ON mock_venue_attendance;
CREATE POLICY "mock_attendance_admin_write"
  ON mock_venue_attendance FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "mock_wait_admin_write" ON mock_venue_wait;
CREATE POLICY "mock_wait_admin_write"
  ON mock_venue_wait FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "catalog_feedback_admin_select" ON catalog_feedback;
CREATE POLICY "catalog_feedback_admin_select"
  ON catalog_feedback FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "catalog_feedback_admin_update" ON catalog_feedback;
CREATE POLICY "catalog_feedback_admin_update"
  ON catalog_feedback FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
