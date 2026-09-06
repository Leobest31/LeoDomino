-- LeoDomino player progression foundation (LVL / XP / Rank).
-- Owner-approved FINAL rules. Do NOT invent alternate XP or Level curves.
--
-- LVL = min(100, floor(qualifying_public_completed_wins / 10))
-- XP: public completed win+25 / loss+10; friend completed win+10 / loss+5
-- Zero XP/Level for forfeit, abandon, timeout, join_timeout, aborted.
-- LVL never from XP, LeoPips, stake, or ledger.
-- NO historical backfill: awards only for matches finished at/after activation.
--
-- Does NOT change LeoPips stake/payout/referral/timeout-penalty amounts.
-- Does not edit prior migration bodies.

BEGIN;

-- ---------------------------------------------------------------------------
-- Activation boundary (no historical backfill)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.progression_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  activated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.progression_settings IS
  'Singleton. Progression awards apply only when matches.finished_at >= activated_at. No historical backfill.';

INSERT INTO public.progression_settings (id, activated_at)
VALUES (1, now())
ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON TABLE public.progression_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.progression_settings TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Authoritative per-player progression state
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.player_progression (
  player_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  lifetime_xp integer NOT NULL DEFAULT 0 CHECK (lifetime_xp >= 0),
  qualifying_public_completed_wins integer NOT NULL DEFAULT 0
    CHECK (qualifying_public_completed_wins >= 0),
  level integer NOT NULL DEFAULT 0 CHECK (level >= 0 AND level <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.player_progression IS
  'Server-authoritative LVL/XP. Level from qualifying public completed wins only. Never from LeoPips.';

COMMENT ON COLUMN public.player_progression.lifetime_xp IS
  'Non-spendable lifetime XP. Does not control Level.';

COMMENT ON COLUMN public.player_progression.qualifying_public_completed_wins IS
  'Genuine public online completed wins only. finish_reason=completed required.';

COMMENT ON COLUMN public.player_progression.level IS
  'min(100, floor(qualifying_public_completed_wins / 10)).';

CREATE TRIGGER player_progression_set_updated_at
  BEFORE UPDATE ON public.player_progression
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.player_progression ENABLE ROW LEVEL SECURITY;

CREATE POLICY player_progression_select_own
  ON public.player_progression
  FOR SELECT
  TO authenticated
  USING (player_id = auth.uid());

REVOKE ALL ON TABLE public.player_progression FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.player_progression TO authenticated;
GRANT SELECT ON TABLE public.player_progression TO service_role;

-- ---------------------------------------------------------------------------
-- Auditable per-match awards (idempotent)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.player_progression_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.matches (id) ON DELETE RESTRICT,
  match_kind text NOT NULL,
  finish_reason text NOT NULL,
  did_win boolean NOT NULL,
  xp_awarded integer NOT NULL CHECK (xp_awarded >= 0),
  qualifying_win_awarded boolean NOT NULL DEFAULT false,
  level_before integer NOT NULL CHECK (level_before >= 0 AND level_before <= 100),
  level_after integer NOT NULL CHECK (level_after >= 0 AND level_after <= 100),
  lifetime_xp_after integer NOT NULL CHECK (lifetime_xp_after >= 0),
  qualifying_wins_after integer NOT NULL CHECK (qualifying_wins_after >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_progression_awards_player_match UNIQUE (player_id, match_id)
);

CREATE INDEX IF NOT EXISTS player_progression_awards_match_idx
  ON public.player_progression_awards (match_id);

CREATE INDEX IF NOT EXISTS player_progression_awards_player_created_idx
  ON public.player_progression_awards (player_id, created_at DESC);

COMMENT ON TABLE public.player_progression_awards IS
  'Immutable progression audit. UNIQUE(player_id, match_id) prevents duplicate XP/Level credit.';

ALTER TABLE public.player_progression_awards ENABLE ROW LEVEL SECURITY;

CREATE POLICY player_progression_awards_select_own
  ON public.player_progression_awards
  FOR SELECT
  TO authenticated
  USING (player_id = auth.uid());

REVOKE ALL ON TABLE public.player_progression_awards FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.player_progression_awards TO authenticated;
GRANT SELECT ON TABLE public.player_progression_awards TO service_role;

-- ---------------------------------------------------------------------------
-- Once-only Level-Up celebration events
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.player_level_up_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  level integer NOT NULL CHECK (level >= 1 AND level <= 100),
  qualifying_wins integer NOT NULL CHECK (qualifying_wins >= 0),
  match_id uuid REFERENCES public.matches (id) ON DELETE SET NULL,
  rank text,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  CONSTRAINT player_level_up_events_player_level UNIQUE (player_id, level)
);

CREATE INDEX IF NOT EXISTS player_level_up_events_pending_idx
  ON public.player_level_up_events (player_id, created_at)
  WHERE consumed_at IS NULL;

COMMENT ON TABLE public.player_level_up_events IS
  'One durable Level-Up celebration per achieved Level. Consume once via authenticated RPC.';

ALTER TABLE public.player_level_up_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY player_level_up_events_select_own
  ON public.player_level_up_events
  FOR SELECT
  TO authenticated
  USING (player_id = auth.uid());

REVOKE ALL ON TABLE public.player_level_up_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.player_level_up_events TO authenticated;
GRANT SELECT ON TABLE public.player_level_up_events TO service_role;

-- ---------------------------------------------------------------------------
-- Pure helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.progression_level_from_wins(p_wins integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LEAST(100, GREATEST(0, FLOOR(GREATEST(COALESCE(p_wins, 0), 0) / 10.0)::integer));
$$;

CREATE OR REPLACE FUNCTION public.progression_rank_from_level(p_level integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_level, 0) <= 0 THEN NULL
    WHEN p_level <= 19 THEN 'BRONZE'
    WHEN p_level <= 49 THEN 'GOLD'
    ELSE 'DIAMOND'
  END;
$$;

CREATE OR REPLACE FUNCTION public._progression_ensure_row(p_player uuid)
RETURNS public.player_progression
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.player_progression%ROWTYPE;
BEGIN
  INSERT INTO public.player_progression (player_id)
  VALUES (p_player)
  ON CONFLICT (player_id) DO NOTHING;

  SELECT * INTO row
  FROM public.player_progression
  WHERE player_id = p_player
  FOR UPDATE;

  RETURN row;
END;
$$;

REVOKE ALL ON FUNCTION public._progression_ensure_row(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._progression_award_player_for_match(
  p_player uuid,
  p_match_id uuid,
  p_match_kind text,
  p_finish_reason text,
  p_did_win boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prog public.player_progression%ROWTYPE;
  xp integer := 0;
  qualify boolean := false;
  kind text := COALESCE(p_match_kind, 'public');
  inserted_n integer := 0;
  level_before integer;
  level_after integer;
  wins_after integer;
  xp_after integer;
  rank_name text;
BEGIN
  IF p_finish_reason IS DISTINCT FROM 'completed' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_completed');
  END IF;

  IF kind = 'friend' THEN
    xp := CASE WHEN p_did_win THEN 10 ELSE 5 END;
    qualify := false;
  ELSE
    -- public (and empty/default treated as public Find Match)
    xp := CASE WHEN p_did_win THEN 25 ELSE 10 END;
    qualify := p_did_win;
  END IF;

  prog := public._progression_ensure_row(p_player);
  level_before := prog.level;

  INSERT INTO public.player_progression_awards (
    player_id,
    match_id,
    match_kind,
    finish_reason,
    did_win,
    xp_awarded,
    qualifying_win_awarded,
    level_before,
    level_after,
    lifetime_xp_after,
    qualifying_wins_after
  )
  VALUES (
    p_player,
    p_match_id,
    kind,
    p_finish_reason,
    p_did_win,
    xp,
    qualify,
    level_before,
    level_before,
    prog.lifetime_xp,
    prog.qualifying_public_completed_wins
  )
  ON CONFLICT (player_id, match_id) DO NOTHING;

  GET DIAGNOSTICS inserted_n = ROW_COUNT;
  IF inserted_n = 0 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'already_awarded', 'player_id', p_player);
  END IF;

  wins_after := prog.qualifying_public_completed_wins + CASE WHEN qualify THEN 1 ELSE 0 END;
  xp_after := prog.lifetime_xp + xp;
  level_after := public.progression_level_from_wins(wins_after);
  rank_name := public.progression_rank_from_level(level_after);

  UPDATE public.player_progression
  SET
    lifetime_xp = xp_after,
    qualifying_public_completed_wins = wins_after,
    level = level_after
  WHERE player_id = p_player;

  UPDATE public.player_progression_awards
  SET
    level_after = level_after,
    lifetime_xp_after = xp_after,
    qualifying_wins_after = wins_after
  WHERE player_id = p_player AND match_id = p_match_id;

  IF level_after > level_before THEN
    INSERT INTO public.player_level_up_events (
      player_id, level, qualifying_wins, match_id, rank
    )
    VALUES (
      p_player, level_after, wins_after, p_match_id, rank_name
    )
    ON CONFLICT (player_id, level) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'applied', true,
    'player_id', p_player,
    'xp_awarded', xp,
    'qualifying_win_awarded', qualify,
    'level_before', level_before,
    'level_after', level_after,
    'lifetime_xp_after', xp_after,
    'qualifying_wins_after', wins_after,
    'rank', rank_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public._progression_award_player_for_match(uuid, uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._progression_award_finished_match(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  match_row public.matches%ROWTYPE;
  activated_at timestamptz;
  winner_seat integer;
  winner uuid;
  loser uuid;
  kind text;
  results jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO match_row FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'match_not_found');
  END IF;

  SELECT s.activated_at INTO activated_at FROM public.progression_settings s WHERE s.id = 1;
  IF activated_at IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_activated');
  END IF;
  IF match_row.finished_at IS NOT NULL AND match_row.finished_at < activated_at THEN
    RETURN jsonb_build_object(
      'applied', false,
      'reason', 'before_activation',
      'finished_at', match_row.finished_at,
      'activated_at', activated_at
    );
  END IF;

  IF match_row.status IS DISTINCT FROM 'finished'
     AND match_row.status IS DISTINCT FROM 'aborted' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_terminal');
  END IF;

  IF match_row.finish_reason IS DISTINCT FROM 'completed' THEN
    RETURN jsonb_build_object(
      'applied', false,
      'reason', 'not_completed',
      'finish_reason', match_row.finish_reason
    );
  END IF;

  SELECT s.match_winner_seat INTO winner_seat
  FROM public.game_sessions s
  WHERE s.match_id = p_match_id;

  winner := CASE winner_seat
    WHEN 0 THEN match_row.player_a
    WHEN 1 THEN match_row.player_b
    ELSE NULL
  END;

  IF winner IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'winner_not_authoritative');
  END IF;

  loser := CASE
    WHEN winner = match_row.player_a THEN match_row.player_b
    ELSE match_row.player_a
  END;

  kind := COALESCE(match_row.match_kind, 'public');

  results := results || jsonb_build_array(
    public._progression_award_player_for_match(
      winner, p_match_id, kind, match_row.finish_reason, true
    )
  );
  IF loser IS NOT NULL THEN
    results := results || jsonb_build_array(
      public._progression_award_player_for_match(
        loser, p_match_id, kind, match_row.finish_reason, false
      )
    );
  END IF;

  RETURN jsonb_build_object('applied', true, 'results', results);
END;
$$;

COMMENT ON FUNCTION public._progression_award_finished_match(uuid) IS
  'Authoritative XP/LVL awards after genuine completed matches. Idempotent. No historical backfill before progression_settings.activated_at.';

REVOKE ALL ON FUNCTION public._progression_award_finished_match(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._progression_award_finished_match(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Hook into LeoPips settle (progression independent of pot early returns)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._leopips_settle_finished_match(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  match_row public.matches%ROWTYPE;
  winner_seat integer;
  winner uuid;
  payout jsonb;
  outcome text;
  referral jsonb := jsonb_build_object('applied', false);
  progression jsonb := jsonb_build_object('applied', false);
  refund jsonb;
BEGIN
  SELECT * INTO match_row
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'match_not_found');
  END IF;

  -- Progression + referral are independent of pot skip.
  progression := public._progression_award_finished_match(p_match_id);
  referral := public._leopips_try_credit_referral_after_match(p_match_id);

  IF match_row.stake_pips IS NULL THEN
    RETURN jsonb_build_object(
      'applied', false,
      'skipped', true,
      'reason', 'friend_or_unstaked',
      'referral', referral,
      'progression', progression
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.leopips_ledger l
    WHERE l.match_id = p_match_id AND l.reason = 'match_stake'
  ) THEN
    RETURN jsonb_build_object(
      'applied', false,
      'reason', 'stake_not_debited',
      'referral', referral,
      'progression', progression
    );
  END IF;

  SELECT s.match_winner_seat INTO winner_seat
  FROM public.game_sessions s
  WHERE s.match_id = p_match_id;
  winner := CASE winner_seat
    WHEN 0 THEN match_row.player_a
    WHEN 1 THEN match_row.player_b
    ELSE NULL
  END;

  IF winner IS NULL THEN
    IF match_row.status = 'aborted' THEN
      refund := public._leopips_refund_both_match_stakes(p_match_id);
      RETURN COALESCE(refund, '{}'::jsonb) || jsonb_build_object(
        'referral', referral,
        'progression', progression
      );
    END IF;
    RETURN jsonb_build_object(
      'applied', false,
      'reason', 'winner_not_authoritative',
      'referral', referral,
      'progression', progression
    );
  END IF;

  IF match_row.finish_reason IS DISTINCT FROM 'completed'
     AND match_row.finish_reason IS DISTINCT FROM 'forfeit'
     AND match_row.finish_reason IS DISTINCT FROM 'timeout'
     AND match_row.finish_reason IS DISTINCT FROM 'abandon'
     AND match_row.finish_reason IS DISTINCT FROM 'abandoned' THEN
    RETURN jsonb_build_object(
      'applied', false,
      'reason', 'not_authoritative_loss',
      'finish_reason', match_row.finish_reason,
      'referral', referral,
      'progression', progression
    );
  END IF;

  outcome := CASE match_row.finish_reason
    WHEN 'forfeit' THEN 'forfeit_win'
    WHEN 'timeout' THEN 'timeout_win'
    WHEN 'abandon' THEN 'abandon_win'
    WHEN 'abandoned' THEN 'abandon_win'
    ELSE 'normal_win'
  END;

  payout := public._leopips_credit_match_payout(winner, p_match_id, outcome);
  RETURN jsonb_build_object(
    'applied', true,
    'payout', payout,
    'winner', winner,
    'outcome', outcome,
    'referral', referral,
    'progression', progression
  );
END;
$$;

COMMENT ON FUNCTION public._leopips_settle_finished_match(uuid) IS
  'Internal. Pays pot when staked; evaluates referral + progression independently of pot skip. Idempotent.';

REVOKE ALL ON FUNCTION public._leopips_settle_finished_match(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Client: consume Level-Up celebration once
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.consume_my_level_up_event(p_level integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  row public.player_level_up_events%ROWTYPE;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_level IS NULL OR p_level < 1 OR p_level > 100 THEN
    RAISE EXCEPTION 'invalid level' USING ERRCODE = '22023';
  END IF;

  UPDATE public.player_level_up_events
  SET consumed_at = now()
  WHERE player_id = caller
    AND level = p_level
    AND consumed_at IS NULL
  RETURNING * INTO row;

  IF NOT FOUND THEN
    SELECT * INTO row
    FROM public.player_level_up_events
    WHERE player_id = caller AND level = p_level;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('consumed', false, 'reason', 'not_found');
    END IF;
    RETURN jsonb_build_object(
      'consumed', false,
      'reason', 'already_consumed',
      'level', row.level,
      'consumed_at', row.consumed_at
    );
  END IF;

  RETURN jsonb_build_object(
    'consumed', true,
    'level', row.level,
    'rank', row.rank,
    'qualifying_wins', row.qualifying_wins,
    'match_id', row.match_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_my_level_up_event(integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_my_level_up_event(integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- Admin rankings: real Level / XP / qualifying wins / rank
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_player_rankings(
  p_search text DEFAULT NULL,
  p_ruleset_id text DEFAULT NULL,
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
  wanted text;
  pattern text;
  safe_limit integer;
  safe_offset integer;
  total_count integer;
  rows jsonb;
  style_id text;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  IF p_ruleset_id IS NOT NULL
     AND p_ruleset_id IS DISTINCT FROM 'legacy'
     AND p_ruleset_id IS DISTINCT FROM 'haitian'
     AND p_ruleset_id IS DISTINCT FROM 'american' THEN
    RAISE EXCEPTION 'unsupported ruleset' USING ERRCODE = '22023';
  END IF;
  style_id := p_ruleset_id;

  wanted := btrim(COALESCE(p_search, ''));
  IF char_length(wanted) > 64 THEN
    wanted := left(wanted, 64);
  END IF;
  pattern := '%' || replace(replace(replace(wanted, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
  safe_offset := GREATEST(COALESCE(p_offset, 0), 0);

  IF style_id IS NULL THEN
    SELECT COUNT(*)::integer INTO total_count
    FROM public.profiles p
    WHERE p.deleted_at IS NULL
      AND (
        wanted = ''
        OR p.username ILIKE pattern ESCAPE '\'
        OR p.display_name ILIKE pattern ESCAPE '\'
      );

    SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'rank')::integer), '[]'::jsonb)
    INTO rows
    FROM (
      SELECT jsonb_build_object(
        'player_id', ranked.player_id,
        'display_name', ranked.display_name,
        'username', ranked.username,
        'avatar_id', ranked.avatar_id,
        'level', ranked.level,
        'xp', ranked.xp,
        'qualifying_public_completed_wins', ranked.qualifying_wins,
        'progression_rank', ranked.progression_rank,
        'leopips_balance', ranked.leopips_balance,
        'wins', ranked.wins,
        'losses', ranked.losses,
        'matches_played', ranked.matches_played,
        'rp', ranked.rp,
        'rank', ranked.rank
      ) AS item
      FROM (
        SELECT
          p.id AS player_id,
          p.display_name,
          p.username,
          p.avatar_id,
          COALESCE(r.wins, 0) AS wins,
          COALESCE(r.losses, 0) AS losses,
          COALESCE(r.matches_played, 0) AS matches_played,
          COALESCE(r.rp, 1000) AS rp,
          w.balance AS leopips_balance,
          COALESCE(pr.level, 0) AS level,
          COALESCE(pr.lifetime_xp, 0) AS xp,
          COALESCE(pr.qualifying_public_completed_wins, 0) AS qualifying_wins,
          public.progression_rank_from_level(COALESCE(pr.level, 0)) AS progression_rank,
          ROW_NUMBER() OVER (
            ORDER BY
              COALESCE(r.wins, 0) DESC,
              lower(COALESCE(p.username, '')),
              lower(COALESCE(p.display_name, '')),
              p.id
          ) AS rank
        FROM public.profiles p
        LEFT JOIN public.player_global_ratings r ON r.player_id = p.id
        LEFT JOIN public.player_leopips_wallets w ON w.player_id = p.id
        LEFT JOIN public.player_progression pr ON pr.player_id = p.id
        WHERE p.deleted_at IS NULL
          AND (
            wanted = ''
            OR p.username ILIKE pattern ESCAPE '\'
            OR p.display_name ILIKE pattern ESCAPE '\'
          )
      ) ranked
      ORDER BY ranked.rank
      LIMIT safe_limit
      OFFSET safe_offset
    ) listed;
  ELSE
    SELECT COUNT(*)::integer INTO total_count
    FROM (
      SELECT mrr.winner_id AS player_id
      FROM public.match_rp_results mrr
      WHERE mrr.rated = true AND mrr.ruleset_id = style_id
      UNION
      SELECT mrr.loser_id AS player_id
      FROM public.match_rp_results mrr
      WHERE mrr.rated = true AND mrr.ruleset_id = style_id
    ) played
    INNER JOIN public.profiles p ON p.id = played.player_id
    WHERE p.deleted_at IS NULL
      AND (
        wanted = ''
        OR p.username ILIKE pattern ESCAPE '\'
        OR p.display_name ILIKE pattern ESCAPE '\'
      );

    SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'rank')::integer), '[]'::jsonb)
    INTO rows
    FROM (
      SELECT jsonb_build_object(
        'player_id', ranked.player_id,
        'display_name', ranked.display_name,
        'username', ranked.username,
        'avatar_id', ranked.avatar_id,
        'level', ranked.level,
        'xp', ranked.xp,
        'qualifying_public_completed_wins', ranked.qualifying_wins,
        'progression_rank', ranked.progression_rank,
        'leopips_balance', ranked.leopips_balance,
        'wins', ranked.wins,
        'losses', ranked.losses,
        'matches_played', ranked.matches_played,
        'rp', ranked.rp,
        'rank', ranked.rank
      ) AS item
      FROM (
        SELECT
          p.id AS player_id,
          p.display_name,
          p.username,
          p.avatar_id,
          COALESCE(stats.wins, 0) AS wins,
          COALESCE(stats.losses, 0) AS losses,
          COALESCE(stats.wins, 0) + COALESCE(stats.losses, 0) AS matches_played,
          COALESCE(r.rp, 1000) AS rp,
          w.balance AS leopips_balance,
          COALESCE(pr.level, 0) AS level,
          COALESCE(pr.lifetime_xp, 0) AS xp,
          COALESCE(pr.qualifying_public_completed_wins, 0) AS qualifying_wins,
          public.progression_rank_from_level(COALESCE(pr.level, 0)) AS progression_rank,
          ROW_NUMBER() OVER (
            ORDER BY
              COALESCE(stats.wins, 0) DESC,
              lower(COALESCE(p.username, '')),
              lower(COALESCE(p.display_name, '')),
              p.id
          ) AS rank
        FROM (
          SELECT
            player_id,
            SUM(is_win)::integer AS wins,
            SUM(1 - is_win)::integer AS losses
          FROM (
            SELECT mrr.winner_id AS player_id, 1 AS is_win
            FROM public.match_rp_results mrr
            WHERE mrr.rated = true
              AND mrr.ruleset_id = style_id
            UNION ALL
            SELECT mrr.loser_id AS player_id, 0 AS is_win
            FROM public.match_rp_results mrr
            WHERE mrr.rated = true
              AND mrr.ruleset_id = style_id
          ) scored
          GROUP BY player_id
        ) stats
        INNER JOIN public.profiles p ON p.id = stats.player_id
        LEFT JOIN public.player_global_ratings r ON r.player_id = p.id
        LEFT JOIN public.player_leopips_wallets w ON w.player_id = p.id
        LEFT JOIN public.player_progression pr ON pr.player_id = p.id
        WHERE p.deleted_at IS NULL
          AND (
            wanted = ''
            OR p.username ILIKE pattern ESCAPE '\'
            OR p.display_name ILIKE pattern ESCAPE '\'
          )
      ) ranked
      ORDER BY ranked.rank
      LIMIT safe_limit
      OFFSET safe_offset
    ) listed;
  END IF;

  RETURN jsonb_build_object(
    'players', COALESCE(rows, '[]'::jsonb),
    'total', COALESCE(total_count, 0),
    'limit', safe_limit,
    'offset', safe_offset,
    'ruleset_id', style_id,
    'order', jsonb_build_array('level', 'xp', 'wins', 'name'),
    'level_xp_available', true
  );
END;
$$;

COMMENT ON FUNCTION public.admin_list_player_rankings(text, text, integer, integer) IS
  'Staff-only ranking. Level/XP from player_progression (authoritative). LeoPips never sorts. Rated wins informational.';

REVOKE ALL ON FUNCTION public.admin_list_player_rankings(text, text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_player_rankings(text, text, integer, integer)
  TO authenticated;

COMMIT;
