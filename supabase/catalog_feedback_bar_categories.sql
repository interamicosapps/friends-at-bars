-- =============================================================================
-- Bar-report categories for an existing catalog_feedback table.
-- Run in the Supabase SQL Editor if catalog_feedback.sql was already applied.
-- =============================================================================

ALTER TABLE catalog_feedback
  DROP CONSTRAINT IF EXISTS catalog_feedback_category_check;

ALTER TABLE catalog_feedback
  ADD CONSTRAINT catalog_feedback_category_check
  CHECK (category IN (
    'missing_bar',
    'missing_deal',
    'outdated_listing',
    'closed_bar',
    'bar_permanently_closed',
    'bar_temporarily_closed',
    'bar_moved',
    'bar_renamed',
    'incorrect_attendance',
    'other'
  ));

CREATE OR REPLACE FUNCTION submit_catalog_feedback(
  p_reporter_id TEXT,
  p_category TEXT,
  p_message TEXT,
  p_geography_id UUID DEFAULT NULL,
  p_venue_name TEXT DEFAULT NULL,
  p_listing_id UUID DEFAULT NULL,
  p_listing_title TEXT DEFAULT NULL,
  p_source_screen TEXT DEFAULT NULL
)
RETURNS catalog_feedback
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean_msg TEXT;
  recent_count INTEGER;
  new_row catalog_feedback;
BEGIN
  IF p_reporter_id IS NULL OR length(trim(p_reporter_id)) = 0 THEN
    RAISE EXCEPTION 'reporter_id required';
  END IF;

  IF p_category IS NULL OR p_category NOT IN (
    'missing_bar', 'missing_deal', 'outdated_listing', 'closed_bar',
    'bar_permanently_closed', 'bar_temporarily_closed', 'bar_moved',
    'bar_renamed', 'incorrect_attendance', 'other'
  ) THEN
    RAISE EXCEPTION 'invalid category';
  END IF;

  clean_msg := trim(COALESCE(p_message, ''));
  IF length(clean_msg) = 0 THEN
    RAISE EXCEPTION 'message required';
  END IF;
  IF length(clean_msg) > 500 THEN
    RAISE EXCEPTION 'message too long';
  END IF;

  SELECT COUNT(*) INTO recent_count
  FROM catalog_feedback
  WHERE reporter_id = p_reporter_id
    AND created_at > NOW() - INTERVAL '24 hours';

  IF recent_count >= 15 THEN
    RAISE EXCEPTION 'Too many tips today — try again tomorrow';
  END IF;

  INSERT INTO catalog_feedback (
    category,
    message,
    geography_id,
    venue_name,
    listing_id,
    listing_title,
    source_screen,
    reporter_id
  )
  VALUES (
    p_category,
    clean_msg,
    p_geography_id,
    NULLIF(trim(COALESCE(p_venue_name, '')), ''),
    p_listing_id,
    NULLIF(trim(COALESCE(p_listing_title, '')), ''),
    NULLIF(trim(COALESCE(p_source_screen, '')), ''),
    p_reporter_id
  )
  RETURNING * INTO new_row;

  RETURN new_row;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_catalog_feedback(
  TEXT, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT
) TO anon, authenticated;
