-- Fix Invite & Win code generation under SECURITY DEFINER search_path=public.
-- pgcrypto lives in the extensions schema on hosted Supabase, so unqualified
-- gen_random_bytes(1) is not visible and first-time code creation fails for every player.
-- Behavior, alphabet, length, and grants are unchanged. No data backfill.

CREATE OR REPLACE FUNCTION public._generate_referral_code()
RETURNS text
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  idx integer;
  i integer;
BEGIN
  FOR i IN 1..8 LOOP
    idx := 1 + (get_byte(extensions.gen_random_bytes(1), 0) % char_length(alphabet));
    result := result || substr(alphabet, idx, 1);
  END LOOP;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public._generate_referral_code() FROM PUBLIC, anon, authenticated;
