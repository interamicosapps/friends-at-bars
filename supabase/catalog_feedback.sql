-- =============================================================================
-- Catalog feedback / tips ("what's missing" reports from the app)
-- Run in Supabase SQL Editor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS catalog_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category TEXT NOT NULL
    CHECK (category IN (
      'missing_bar',
      'missing_deal',
      'outdated_listing',
      'closed_bar',
      'other'
    )),
  message TEXT NOT NULL
    CHECK (char_length(trim(message)) > 0 AND char_length(message) <= 500),
  geography_id UUID REFERENCES catalog_geographies(id) ON DELETE SET NULL,
  venue_name TEXT,
  listing_id UUID,
  listing_title TEXT,
  source_screen TEXT,
  reporter_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'triaged', 'done', 'dismissed')),
  admin_note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_feedback_created
  ON catalog_feedback (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_catalog_feedback_status
  ON catalog_feedback (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_catalog_feedback_reporter_day
  ON catalog_feedback (reporter_id, created_at DESC);

COMMENT ON TABLE catalog_feedback IS
  'In-app tips about missing bars/deals or outdated catalog content for CMS triage.';

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
    'missing_bar', 'missing_deal', 'outdated_listing', 'closed_bar', 'other'
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

ALTER TABLE catalog_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "catalog_feedback_admin_select" ON catalog_feedback;
CREATE POLICY "catalog_feedback_admin_select"
  ON catalog_feedback FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "catalog_feedback_admin_update" ON catalog_feedback;
CREATE POLICY "catalog_feedback_admin_update"
  ON catalog_feedback FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

GRANT SELECT, UPDATE ON catalog_feedback TO authenticated;
GRANT EXECUTE ON FUNCTION submit_catalog_feedback(
  TEXT, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT
) TO anon, authenticated;
