-- INSERT INTO admin_users (user_id) VALUES ('<YOUR-AUTH-USER-ID>'); -- run this FIRST, before admin_policies.sql

-- CMS allow-list (step 1.3). Run this file, insert your user, then run admin_policies.sql.
-- Idempotent. Run in the Supabase SQL Editor. Do not run from the app.

CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_users FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE user_id = auth.uid()
  );
$$;

-- anon must be able to execute is_admin(): RLS policies on public catalog tables call it,
-- and Postgres checks EXECUTE before evaluating rows. For anon it returns false (auth.uid() is null).
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;
