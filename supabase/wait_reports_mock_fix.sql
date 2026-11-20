-- Block mock wait reports from the live table, and cap real reports (step 1.2).
-- Signature matches supabase/catalog_venues_footprint.sql (footprint gate),
-- which replaced the radius-only body in supabase/venue_wait_reports.sql.
-- Same arguments and GRANTs, so the shipped iOS app keeps working.
-- Idempotent. Run in the Supabase SQL Editor. Do not run from the app.

CREATE OR REPLACE FUNCTION submit_venue_wait_report(
  p_author_id TEXT,
  p_venue_name TEXT,
  p_wait_minutes SMALLINT,
  p_latitude DOUBLE PRECISION DEFAULT NULL,
  p_longitude DOUBLE PRECISION DEFAULT NULL,
  p_is_mock BOOLEAN DEFAULT false
)
RETURNS venue_wait_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  venue_trimmed TEXT;
  v_geography UUID;
  v_lat DOUBLE PRECISION;
  v_lon DOUBLE PRECISION;
  v_radius_m DOUBLE PRECISION;
  v_footprint jsonb;
  location_ok BOOLEAN;
  edge_m DOUBLE PRECISION;
  recent_reports INT;
  new_row venue_wait_reports;
BEGIN
  IF p_author_id IS NULL OR length(trim(p_author_id)) = 0 THEN
    RAISE EXCEPTION 'author_id required';
  END IF;

  venue_trimmed := trim(p_venue_name);
  IF venue_trimmed IS NULL OR length(venue_trimmed) = 0 THEN
    RAISE EXCEPTION 'venue_name required';
  END IF;

  IF p_wait_minutes IS NULL OR p_wait_minutes NOT IN (5, 10, 15, 30, 45) THEN
    RAISE EXCEPTION 'wait_minutes must be 5, 10, 15, 30, or 45';
  END IF;

  IF coalesce(p_is_mock, false) THEN
    RAISE EXCEPTION 'mock reports disabled';
  END IF;

  SELECT count(*)
    INTO recent_reports
  FROM venue_wait_reports
  WHERE author_id = p_author_id
    AND updated_at > NOW() - INTERVAL '1 hour';

  IF recent_reports >= 6 THEN
    RAISE EXCEPTION 'Slow down — try again later';
  END IF;

  SELECT geography_id, latitude, longitude, radius_m, footprint
    INTO v_geography, v_lat, v_lon, v_radius_m, v_footprint
  FROM catalog_venues
  WHERE name = venue_trimmed;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venue not found';
  END IF;

  IF v_geography IS NULL THEN
    RAISE EXCEPTION 'Venue not found';
  END IF;

  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RAISE EXCEPTION 'Location required to report wait time';
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
    IF v_footprint IS NOT NULL AND jsonb_array_length(v_footprint) >= 4 THEN
      edge_m := distance_m_to_venue_footprint(p_latitude, p_longitude, v_footprint);
      location_ok := edge_m IS NOT NULL AND edge_m <= 15;
    ELSE
      location_ok := haversine_miles(v_lat, v_lon, p_latitude, p_longitude)
        <= (coalesce(v_radius_m, 100) / 1609.344);
    END IF;
  END IF;

  IF NOT location_ok THEN
    RAISE EXCEPTION 'Must be at the bar to report wait time';
  END IF;

  INSERT INTO venue_wait_reports (
    author_id,
    venue_name,
    wait_minutes,
    geography_id,
    is_mock,
    created_at,
    updated_at
  )
  VALUES (
    p_author_id,
    venue_trimmed,
    p_wait_minutes,
    v_geography,
    false,
    NOW(),
    NOW()
  )
  ON CONFLICT (author_id, venue_name)
  DO UPDATE SET
    wait_minutes = EXCLUDED.wait_minutes,
    geography_id = EXCLUDED.geography_id,
    is_mock = false,
    updated_at = NOW()
  RETURNING * INTO new_row;

  RETURN new_row;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_venue_wait_report(TEXT, TEXT, SMALLINT, DOUBLE PRECISION, DOUBLE PRECISION, BOOLEAN)
  TO anon, authenticated;

DELETE FROM venue_wait_reports WHERE is_mock = true;
