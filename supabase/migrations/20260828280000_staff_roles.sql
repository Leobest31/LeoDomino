-- Staff authorization foundation for the future Admin Dashboard.
-- Does not grant dashboard modules, RP access, match spectating, or sanctions.
-- Does not assign an owner. staff_roles stays empty until an approved user_id is inserted as postgres.
-- Players cannot self-promote via signup metadata, localStorage, or table DML.

CREATE TABLE public.staff_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_roles_role_check CHECK (role IN ('owner', 'admin', 'moderator'))
);

COMMENT ON TABLE public.staff_roles IS
  'Private staff roster. Not client-readable or writable. Empty until an approved owner is inserted by postgres. Hierarchy: owner > admin > moderator.';

COMMENT ON COLUMN public.staff_roles.user_id IS
  'Auth user UUID. Same as profiles.id.';

COMMENT ON COLUMN public.staff_roles.role IS
  'owner, admin, or moderator. Clients cannot write this column.';

DROP TRIGGER IF EXISTS staff_roles_set_updated_at ON public.staff_roles;
CREATE TRIGGER staff_roles_set_updated_at
  BEFORE UPDATE ON public.staff_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.staff_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_roles FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.staff_roles FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_staff(required_role text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  held text;
  held_rank integer;
  need_rank integer;
  wanted text;
BEGIN
  IF caller IS NULL THEN
    RETURN false;
  END IF;

  SELECT r.role INTO held
  FROM public.staff_roles r
  WHERE r.user_id = caller;

  IF held IS NULL THEN
    RETURN false;
  END IF;

  wanted := lower(btrim(COALESCE(required_role, '')));
  IF wanted = '' THEN
    RETURN true;
  END IF;

  held_rank := CASE held
    WHEN 'owner' THEN 3
    WHEN 'admin' THEN 2
    WHEN 'moderator' THEN 1
    ELSE 0
  END;

  need_rank := CASE wanted
    WHEN 'owner' THEN 3
    WHEN 'admin' THEN 2
    WHEN 'moderator' THEN 1
    ELSE NULL
  END;

  IF need_rank IS NULL THEN
    RETURN false;
  END IF;

  RETURN held_rank >= need_rank;
END;
$$;

COMMENT ON FUNCTION public.is_staff(text) IS
  'True when auth.uid() holds a staff_roles row. Optional required_role uses owner>admin>moderator. Not granted to clients.';

CREATE OR REPLACE FUNCTION public.am_i_staff()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  held text;
BEGIN
  IF caller IS NULL THEN
    RETURN jsonb_build_object('is_staff', false, 'role', NULL);
  END IF;

  SELECT r.role INTO held
  FROM public.staff_roles r
  WHERE r.user_id = caller;

  IF held IS NULL THEN
    RETURN jsonb_build_object('is_staff', false, 'role', NULL);
  END IF;

  RETURN jsonb_build_object('is_staff', true, 'role', held);
END;
$$;

COMMENT ON FUNCTION public.am_i_staff() IS
  'Probe for the signed-in caller only. Returns is_staff and role. Never lists other staff.';

REVOKE ALL ON FUNCTION public.is_staff(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.am_i_staff() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.am_i_staff() TO authenticated;
