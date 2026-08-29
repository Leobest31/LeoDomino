-- Admin Dashboard V1: staff audit log.
-- Append-only. No client table grants. Written only by SECURITY DEFINER helpers/RPCs.
-- Does not store secrets, hands, engine_state, or auth metadata.

CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.profiles (id),
  actor_role text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_audit_log_role_check CHECK (actor_role IN ('owner', 'admin', 'moderator')),
  CONSTRAINT admin_audit_log_action_len CHECK (char_length(action) BETWEEN 1 AND 64),
  CONSTRAINT admin_audit_log_target_type_len CHECK (char_length(target_type) BETWEEN 1 AND 64),
  CONSTRAINT admin_audit_log_target_id_len CHECK (target_id IS NULL OR char_length(target_id) BETWEEN 1 AND 80),
  CONSTRAINT admin_audit_log_reason_len CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500),
  CONSTRAINT admin_audit_log_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

COMMENT ON TABLE public.admin_audit_log IS
  'Staff-only append-only audit of Admin Dashboard mutations. Never stores secrets or private gameplay state.';

CREATE INDEX admin_audit_log_created_idx
  ON public.admin_audit_log (created_at DESC, id DESC);

CREATE INDEX admin_audit_log_actor_idx
  ON public.admin_audit_log (actor_id, created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_audit_log FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._admin_write_audit(
  p_action text,
  p_target_type text,
  p_target_id text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  held text;
  new_id uuid;
  safe_meta jsonb := COALESCE(p_metadata, '{}'::jsonb);
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT r.role INTO held
  FROM public.staff_roles r
  WHERE r.user_id = caller;

  IF held IS NULL THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(safe_meta) IS DISTINCT FROM 'object' THEN
    safe_meta := '{}'::jsonb;
  END IF;
  safe_meta := safe_meta - ARRAY[
    'email', 'phone', 'password', 'token', 'access_token', 'refresh_token',
    'game_secrets', 'engine_state', 'deal_seed', 'my_hand', 'myHand',
    'legalMoves', 'raw_user_meta_data', 'user_metadata'
  ];

  INSERT INTO public.admin_audit_log (
    actor_id, actor_role, action, target_type, target_id, reason, metadata
  )
  VALUES (
    caller,
    held,
    left(btrim(COALESCE(p_action, '')), 64),
    left(btrim(COALESCE(p_target_type, '')), 64),
    NULLIF(left(btrim(COALESCE(p_target_id, '')), 80), ''),
    NULLIF(left(btrim(COALESCE(p_reason, '')), 500), ''),
    safe_meta
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

COMMENT ON FUNCTION public._admin_write_audit(text, text, text, text, jsonb) IS
  'Internal staff audit writer. Not granted to clients. Strips secret keys from metadata.';

REVOKE ALL ON FUNCTION public._admin_write_audit(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_audit(
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  safe_limit integer;
  safe_offset integer;
  total_count integer;
  rows jsonb;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
  safe_offset := GREATEST(COALESCE(p_offset, 0), 0);

  SELECT COUNT(*)::integer INTO total_count FROM public.admin_audit_log;

  SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'created_at') DESC, item->>'id'), '[]'::jsonb)
  INTO rows
  FROM (
    SELECT jsonb_build_object(
      'id', a.id,
      'actor_id', a.actor_id,
      'actor_role', a.actor_role,
      'action', a.action,
      'target_type', a.target_type,
      'target_id', a.target_id,
      'reason', a.reason,
      'metadata', a.metadata,
      'created_at', a.created_at
    ) AS item
    FROM public.admin_audit_log a
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT safe_limit
    OFFSET safe_offset
  ) listed;

  RETURN jsonb_build_object(
    'events', rows,
    'total', total_count,
    'limit', safe_limit,
    'offset', safe_offset
  );
END;
$$;

COMMENT ON FUNCTION public.admin_list_audit(integer, integer) IS
  'Staff-only paginated Admin audit log. Newest first.';

REVOKE ALL ON FUNCTION public.admin_list_audit(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_audit(integer, integer) TO authenticated;
