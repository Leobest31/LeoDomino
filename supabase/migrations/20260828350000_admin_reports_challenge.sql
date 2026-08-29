-- Admin Dashboard V1: player reports foundation + Challenge/League config.
-- Reports are staff-review only in this pass (no player-facing submit RPC).
-- Challenge defaults to coming_soon with CP earning FORCED OFF.
-- League config is schedule metadata only — no LP table, no fabricated standings.
-- Sanctions (warn/suspend/ban) are NOT implemented; no enforcement hooks.

CREATE TABLE public.player_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles (id),
  reported_id uuid NOT NULL REFERENCES public.profiles (id),
  category text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  assigned_staff_id uuid REFERENCES public.profiles (id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_reports_distinct CHECK (reporter_id <> reported_id),
  CONSTRAINT player_reports_category_check CHECK (
    category IN ('harassment', 'cheating', 'spam', 'other')
  ),
  CONSTRAINT player_reports_status_check CHECK (
    status IN ('open', 'reviewing', 'resolved', 'dismissed')
  ),
  CONSTRAINT player_reports_body_len CHECK (char_length(body) BETWEEN 1 AND 2000)
);

COMMENT ON TABLE public.player_reports IS
  'Staff moderation cases. V1 has no player-facing submit RPC. Status changes require a reason and an audit row.';

CREATE INDEX player_reports_status_created_idx
  ON public.player_reports (status, created_at DESC);

CREATE TRIGGER player_reports_set_updated_at
  BEFORE UPDATE ON public.player_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.player_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_reports FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.player_reports FROM PUBLIC, anon, authenticated;

CREATE TABLE public.challenge_config (
  id integer PRIMARY KEY CHECK (id = 1),
  status text NOT NULL DEFAULT 'coming_soon',
  starts_at timestamptz,
  ends_at timestamptz,
  qualification_cp integer NOT NULL DEFAULT 5000,
  first_prize_usd numeric(10, 2) NOT NULL DEFAULT 300.00,
  second_prize_usd numeric(10, 2) NOT NULL DEFAULT 200.00,
  cp_earning_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT challenge_config_status_check CHECK (
    status IN ('coming_soon', 'scheduled', 'live', 'completed')
  ),
  CONSTRAINT challenge_config_cp_target CHECK (qualification_cp = 5000),
  CONSTRAINT challenge_config_prizes CHECK (
    first_prize_usd = 300.00 AND second_prize_usd = 200.00
  ),
  CONSTRAINT challenge_config_cp_off CHECK (cp_earning_enabled = false),
  CONSTRAINT challenge_config_window CHECK (
    ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at
  )
);

COMMENT ON TABLE public.challenge_config IS
  'Singleton LeoDomino Challenge metadata. CP earning is constrained OFF until a later Challenge gameplay pass.';

CREATE TRIGGER challenge_config_set_updated_at
  BEFORE UPDATE ON public.challenge_config
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.challenge_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_config FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.challenge_config FROM PUBLIC, anon, authenticated;

INSERT INTO public.challenge_config (id, status, qualification_cp, first_prize_usd, second_prize_usd, cp_earning_enabled)
VALUES (1, 'coming_soon', 5000, 300.00, 200.00, false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.league_config (
  id integer PRIMARY KEY CHECK (id = 1),
  status text NOT NULL DEFAULT 'coming_soon',
  season_days integer NOT NULL DEFAULT 60,
  starts_at timestamptz,
  ends_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT league_config_status_check CHECK (
    status IN ('coming_soon', 'scheduled', 'live', 'completed')
  ),
  CONSTRAINT league_config_season_days CHECK (season_days = 60)
);

COMMENT ON TABLE public.league_config IS
  'Singleton League/Seasons metadata. No LP ledger in V1. Leaderboard is always empty until League gameplay exists.';

CREATE TRIGGER league_config_set_updated_at
  BEFORE UPDATE ON public.league_config
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.league_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_config FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.league_config FROM PUBLIC, anon, authenticated;

INSERT INTO public.league_config (id, status, season_days)
VALUES (1, 'coming_soon', 60)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_list_reports(
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

  SELECT COUNT(*)::integer INTO total_count FROM public.player_reports;

  SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'created_at') DESC, item->>'id'), '[]'::jsonb)
  INTO rows
  FROM (
    SELECT jsonb_build_object(
      'id', r.id,
      'reporter', jsonb_build_object(
        'player_id', a.id,
        'display_name', a.display_name,
        'username', a.username,
        'avatar_id', a.avatar_id
      ),
      'reported', jsonb_build_object(
        'player_id', b.id,
        'display_name', b.display_name,
        'username', b.username,
        'avatar_id', b.avatar_id
      ),
      'category', r.category,
      'body', r.body,
      'status', r.status,
      'assigned_staff_id', r.assigned_staff_id,
      'resolved_at', r.resolved_at,
      'created_at', r.created_at
    ) AS item
    FROM public.player_reports r
    INNER JOIN public.profiles a ON a.id = r.reporter_id
    INNER JOIN public.profiles b ON b.id = r.reported_id
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT safe_limit
    OFFSET safe_offset
  ) listed;

  RETURN jsonb_build_object(
    'items', rows,
    'total', total_count,
    'limit', safe_limit,
    'offset', safe_offset
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_reports(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_reports(integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_report_status(
  p_report_id uuid,
  p_status text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  wanted text := lower(btrim(COALESCE(p_status, '')));
  why text := btrim(COALESCE(p_reason, ''));
  updated public.player_reports;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  IF p_report_id IS NULL THEN
    RAISE EXCEPTION 'report required' USING ERRCODE = '22023';
  END IF;

  IF wanted NOT IN ('open', 'reviewing', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'invalid report status' USING ERRCODE = '22023';
  END IF;

  IF char_length(why) < 8 THEN
    RAISE EXCEPTION 'reason required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.player_reports
  SET
    status = wanted,
    resolved_at = CASE
      WHEN wanted IN ('resolved', 'dismissed') THEN now()
      ELSE NULL
    END
  WHERE id = p_report_id
  RETURNING * INTO updated;

  IF updated.id IS NULL THEN
    RAISE EXCEPTION 'report not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public._admin_write_audit(
    'report_status',
    'player_report',
    updated.id::text,
    why,
    jsonb_build_object('status', wanted)
  );

  RETURN jsonb_build_object('ok', true, 'id', updated.id, 'status', updated.status);
END;
$$;

COMMENT ON FUNCTION public.admin_update_report_status(uuid, text, text) IS
  'Staff-only report status change. Reason required. Writes admin_audit_log. Does not ban or suspend.';

REVOKE ALL ON FUNCTION public.admin_update_report_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_report_status(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_challenge()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'status', c.status,
      'starts_at', c.starts_at,
      'ends_at', c.ends_at,
      'qualification_cp', c.qualification_cp,
      'first_prize_usd', c.first_prize_usd,
      'second_prize_usd', c.second_prize_usd,
      'cp_earning_enabled', c.cp_earning_enabled,
      'qualified_players', '[]'::jsonb,
      'updated_at', c.updated_at
    )
    FROM public.challenge_config c
    WHERE c.id = 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_challenge() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_challenge() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_challenge(
  p_status text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  wanted text := lower(btrim(COALESCE(p_status, '')));
  why text := btrim(COALESCE(p_reason, ''));
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_staff('admin') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  IF wanted NOT IN ('coming_soon', 'scheduled', 'live', 'completed') THEN
    RAISE EXCEPTION 'invalid challenge status' USING ERRCODE = '22023';
  END IF;

  IF char_length(why) < 8 THEN
    RAISE EXCEPTION 'reason required' USING ERRCODE = '22023';
  END IF;

  -- Never enable CP earning in this pass.
  UPDATE public.challenge_config
  SET
    status = wanted,
    starts_at = p_starts_at,
    ends_at = p_ends_at,
    cp_earning_enabled = false
  WHERE id = 1;

  PERFORM public._admin_write_audit(
    'challenge_update',
    'challenge_config',
    '1',
    why,
    jsonb_build_object('status', wanted, 'cp_earning_enabled', false)
  );

  RETURN public.admin_get_challenge();
END;
$$;

COMMENT ON FUNCTION public.admin_update_challenge(text, timestamptz, timestamptz, text) IS
  'Admin/owner-only Challenge metadata update. Forces cp_earning_enabled=false. Requires reason + audit.';

REVOKE ALL ON FUNCTION public.admin_update_challenge(text, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_challenge(text, timestamptz, timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_league()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'status', c.status,
      'season_days', c.season_days,
      'starts_at', c.starts_at,
      'ends_at', c.ends_at,
      'leaderboard', '[]'::jsonb,
      'updated_at', c.updated_at
    )
    FROM public.league_config c
    WHERE c.id = 1
  );
END;
$$;

COMMENT ON FUNCTION public.admin_get_league() IS
  'Staff-only League metadata. Leaderboard is always empty until an LP ledger exists. Does not invent standings.';

REVOKE ALL ON FUNCTION public.admin_get_league() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_league() TO authenticated;
