-- Presence and chat retention (step 1.4).
--
-- pg_cron must be enabled in the Supabase dashboard (Database → Extensions) before this runs.
-- If it is not enabled, CREATE EXTENSION below will fail. Turn it on, then run this file again.
--
-- What this file does and why: server-side cleanup so stale presence and old chat data
-- don't stay in the database forever. The app already filters by age when it reads;
-- this makes the stored data match.
--
-- Checked against the native app before writing:
--   liveLocationHeartbeatMs          = 15 minutes
--   liveLocationCountMaxAgeSeconds   = 18 minutes (heartbeat + 3-minute grace)
--   liveLocationChatFreshnessSeconds = 18 minutes
--   recentWhileUsingWindowSeconds    = 25 minutes
-- LiveAPIs.venueCounts drops live_locations older than 18 minutes.
-- LiveAPIs.recentWhileUsingCounts reads presence_visits only inside 25 minutes.
-- 18 minutes is longer than a normal heartbeat, and 6 hours is longer than both read windows.
--
-- Idempotent. Run in the Supabase SQL Editor. Do not run from the app.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Re-create the chat cleaner from supabase/chat_setup.sql.
-- chat_votes.post_id and chat_reports.post_id both ON DELETE CASCADE, so removing a
-- post removes its votes and reports.
-- Replies use chat_posts.parent_id ON DELETE CASCADE.
-- A top-level post is held until 7 days after expires_at when it has a chat_reports
-- row OR any of its replies does. Replies of a held parent stay until that parent is
-- removed, so a reported reply cannot be dropped early by deleting its parent.
-- An expired reply with no report, whose parent is not held, is still deleted immediately.
-- The app feed already hides rows with expires_at <= now().
CREATE OR REPLACE FUNCTION public.cleanup_expired_chat_posts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.chat_posts AS p
  WHERE p.expires_at <= NOW()
    AND NOT (
      -- This post was reported: keep it for 7 days after it expired.
      (
        EXISTS (
          SELECT 1
          FROM public.chat_reports AS r
          WHERE r.post_id = p.id
        )
        AND p.expires_at >= NOW() - INTERVAL '7 days'
      )
      OR
      -- Top-level post: any reported reply holds the parent for the same 7 days.
      (
        p.parent_id IS NULL
        AND p.expires_at >= NOW() - INTERVAL '7 days'
        AND EXISTS (
          SELECT 1
          FROM public.chat_posts AS child
          JOIN public.chat_reports AS r ON r.post_id = child.id
          WHERE child.parent_id = p.id
        )
      )
      OR
      -- Reply of a parent that is still inside that hold window.
      (
        p.parent_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.chat_posts AS parent
          WHERE parent.id = p.parent_id
            AND parent.expires_at >= NOW() - INTERVAL '7 days'
            AND (
              EXISTS (
                SELECT 1
                FROM public.chat_reports AS r
                WHERE r.post_id = parent.id
              )
              OR EXISTS (
                SELECT 1
                FROM public.chat_posts AS sibling
                JOIN public.chat_reports AS r ON r.post_id = sibling.id
                WHERE sibling.parent_id = parent.id
              )
            )
        )
      )
    );

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- The cron job runs as the role that schedules it (SQL editor / postgres), which can
-- still execute this function. The app and the public key must not.
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_chat_posts() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  existing_job bigint;
BEGIN
  FOR existing_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'barfest_retention'
  LOOP
    PERFORM cron.unschedule(existing_job);
  END LOOP;
END $$;

SELECT cron.schedule(
  'barfest_retention',
  '*/10 * * * *',
  $job$
  -- Matches the 15-minute heartbeat + 3-minute grace already used for counts and the
  -- chat/wait "at the bar" checks. A person still at the bar is reactivated by their next heartbeat.
  -- This UPDATE fires the BEFORE UPDATE trigger from supabase/live_locations_privacy.sql,
  -- which nulls coordinates. That is expected and harmless.
  UPDATE public.live_locations
  SET is_active = false
  WHERE is_active
    AND last_updated < NOW() - INTERVAL '18 minutes';

  -- Privacy: the app never reads presence older than 18 minutes.
  DELETE FROM public.live_locations
  WHERE last_updated < NOW() - INTERVAL '6 hours';

  -- Privacy: the "N recent" window is 25 minutes. Expired visits are set to 1970 by the app
  -- and also get removed here.
  DELETE FROM public.presence_visits
  WHERE last_seen_at < NOW() - INTERVAL '6 hours';

  SELECT public.cleanup_expired_chat_posts();
  $job$
);

-- Verification (run after the first 10-minute tick, or call the statements by hand):
-- select jobname, schedule, active from cron.job where jobname = 'barfest_retention';
-- select status, return_message, start_time from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'barfest_retention') order by start_time desc limit 5;
-- select count(*) from live_locations where is_active and last_updated < now() - interval '18 minutes';  -- expect 0 after the first run
