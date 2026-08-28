-- Auth metadata non-retention for the 13+ account gate.
-- GoTrue may UPDATE raw_user_meta_data after INSERT with the original signup payload.
-- This trigger drops accountAge/age on that write. It does not re-validate age.
-- Existing Auth rows are not backfilled. public.profiles is unchanged.
-- INSERT 13+ enforcement remains on assert_new_user_min_account_age.

CREATE OR REPLACE FUNCTION public.strip_account_age_from_auth_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.raw_user_meta_data :=
    COALESCE(NEW.raw_user_meta_data, '{}'::jsonb) - 'accountAge' - 'age';
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.strip_account_age_from_auth_metadata() IS
  'BEFORE UPDATE OF auth.users.raw_user_meta_data: drop accountAge and age keys only. Does not require age, does not write profiles, does not backfill existing users.';

DROP TRIGGER IF EXISTS strip_account_age_from_auth_metadata ON auth.users;
CREATE TRIGGER strip_account_age_from_auth_metadata
  BEFORE UPDATE OF raw_user_meta_data ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.strip_account_age_from_auth_metadata();

REVOKE ALL ON FUNCTION public.strip_account_age_from_auth_metadata() FROM PUBLIC, anon, authenticated;
