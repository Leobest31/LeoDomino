-- PREPARED — not applied to hosted Postgres.
-- 13+ general account gate at Auth signup.
-- Validates a whole-number age from user_metadata.accountAge, then discards it.
-- Does not store date of birth or numeric age on public.profiles.
-- Existing Auth users / profiles are unchanged (INSERT trigger only).
-- Not cash-promotion 18+ eligibility.

CREATE OR REPLACE FUNCTION public.assert_new_user_min_account_age()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw text := btrim(COALESCE(NEW.raw_user_meta_data->>'accountAge', ''));
  age integer;
BEGIN
  IF raw = '' OR raw !~ '^[1-9][0-9]{0,2}$' THEN
    RAISE EXCEPTION 'ACCOUNT_AGE' USING ERRCODE = 'P0001';
  END IF;

  age := raw::integer;

  IF age < 13 THEN
    RAISE EXCEPTION 'ACCOUNT_AGE_UNDER' USING ERRCODE = 'P0001';
  END IF;

  IF age > 120 THEN
    RAISE EXCEPTION 'ACCOUNT_AGE' USING ERRCODE = 'P0001';
  END IF;

  NEW.raw_user_meta_data :=
    COALESCE(NEW.raw_user_meta_data, '{}'::jsonb) - 'accountAge' - 'age';

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.assert_new_user_min_account_age() IS
  'BEFORE INSERT on auth.users: require whole-number age 13–120, then drop it from metadata. Does not write age onto profiles.';

DROP TRIGGER IF EXISTS assert_new_user_min_account_age ON auth.users;
CREATE TRIGGER assert_new_user_min_account_age
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_new_user_min_account_age();

REVOKE ALL ON FUNCTION public.assert_new_user_min_account_age() FROM PUBLIC, anon, authenticated;
