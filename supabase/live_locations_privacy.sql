-- live_locations privacy (step 1.1)
-- Safe for the shipped iOS app v1.0.2.
-- The app upserts latitude/longitude, but venue counts only SELECT
-- venue_name, is_active, last_updated, user_id
-- (native/ios/BarFest/BarFest/Services/LiveAPIs.swift venueCounts()).
-- Chat and wait RPCs only check user_id, venue_name, is_active, last_updated.
-- INSERT and UPDATE are left in place so v1.0.2 upserts and deactivates still work.
--
-- The Vite site is not a user product. src/lib/locationService.ts and
-- src/lib/supabaseClient.ts still subscribe to live_locations realtime and
-- will stop receiving events after this script drops the table from the publication.
--
-- Idempotent. Run in the Supabase SQL Editor (dashboard role). Do not run from the app.

ALTER TABLE public.live_locations
  ALTER COLUMN latitude DROP NOT NULL,
  ALTER COLUMN longitude DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.live_locations_strip_coordinates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.latitude := NULL;
  NEW.longitude := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS live_locations_strip_coordinates ON public.live_locations;

CREATE TRIGGER live_locations_strip_coordinates
BEFORE INSERT OR UPDATE ON public.live_locations
FOR EACH ROW
EXECUTE FUNCTION public.live_locations_strip_coordinates();

UPDATE public.live_locations
SET latitude = NULL,
    longitude = NULL;

REVOKE SELECT ON TABLE public.live_locations FROM PUBLIC, anon, authenticated;

GRANT SELECT (venue_name, is_active, last_updated, user_id)
  ON TABLE public.live_locations
  TO anon, authenticated;

-- Native iOS does not subscribe. The Vite site does; that subscription goes quiet.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'live_locations'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.live_locations;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
