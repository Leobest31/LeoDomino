-- Staff-only Admin player email reader.
-- Resolves email from auth.users inside SECURITY DEFINER.
-- Does not copy email onto public.profiles.
-- Does not grant table SELECT on auth.users.
-- Does not weaken RLS.
-- No service-role secret in the frontend; authenticated staff RPC only.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_get_player_email(p_player_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  v_email text;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  IF p_player_id IS NULL THEN
    RAISE EXCEPTION 'player required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_player_id) THEN
    RAISE EXCEPTION 'player not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT NULLIF(btrim(u.email), '')
  INTO v_email
  FROM auth.users u
  WHERE u.id = p_player_id;

  RETURN jsonb_build_object('email', v_email);
END;
$$;

COMMENT ON FUNCTION public.admin_get_player_email(uuid) IS
  'Staff-only. Returns {email} from auth.users for one player. Never grants table access. Never writes profiles.';

REVOKE ALL ON FUNCTION public.admin_get_player_email(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_player_email(uuid) TO authenticated;

COMMIT;
