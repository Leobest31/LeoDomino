-- Admin LeoPips read-only operations.
-- Staff-only SECURITY DEFINER readers. Does not widen table RLS or GRANT table access.
-- Does not mutate wallets, ledger, matches, requests, referrals, occupancy, or settlement.
-- Does not edit 20260903120000 / 20260903140000 / 20260903150000 / 20260903160000.
-- Ledger reasons are the authoritative CHECK set only:
--   initial_grant, match_stake, match_payout, timeout_penalty, referral_reward,
--   admin_adjustment, correction (pre-start refunds use correction + refund_stake: keys).
-- There is no refund/void reason string.

-- ---------------------------------------------------------------------------
-- Compatible live-match JSON extension: same (integer, integer) signature.
-- Adds stake_pips only. Occupancy set is still active_match_players.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_live_matches(
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
  stale_before timestamptz;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
  safe_offset := GREATEST(COALESCE(p_offset, 0), 0);
  stale_before := now() - interval '5 minutes';

  SELECT COUNT(DISTINCT amp.match_id)::integer INTO total_count
  FROM public.active_match_players amp;

  SELECT COALESCE(jsonb_agg(item ORDER BY last_activity DESC, match_id DESC), '[]'::jsonb)
  INTO rows
  FROM (
    SELECT
      jsonb_build_object(
        'match_id', m.id,
        'ruleset_id', m.ruleset_id,
        'rated', m.rated,
        'match_kind', m.match_kind,
        'stake_pips', m.stake_pips,
        'match_status', m.status,
        'created_at', m.created_at,
        'admin_status', CASE
          WHEN occ_a.last_seen_at IS NULL
            OR occ_a.last_seen_at < stale_before
            OR occ_b.last_seen_at IS NULL
            OR occ_b.last_seen_at < stale_before
          THEN 'disconnected'
          WHEN m.status = 'ready' THEN 'waiting'
          WHEN m.status = 'playing' THEN 'live'
          ELSE m.status
        END,
        'player_a', jsonb_build_object(
          'player_id', m.player_a,
          'display_name', pa.display_name,
          'username', pa.username,
          'avatar_id', pa.avatar_id,
          'rp', COALESCE(ra.rp, 1000),
          'last_seen_at', occ_a.last_seen_at,
          'stale', (occ_a.last_seen_at IS NULL OR occ_a.last_seen_at < stale_before)
        ),
        'player_b', jsonb_build_object(
          'player_id', m.player_b,
          'display_name', pb.display_name,
          'username', pb.username,
          'avatar_id', pb.avatar_id,
          'rp', COALESCE(rb.rp, 1000),
          'last_seen_at', occ_b.last_seen_at,
          'stale', (occ_b.last_seen_at IS NULL OR occ_b.last_seen_at < stale_before)
        ),
        'score_a', CASE WHEN gs.match_id IS NULL THEN NULL ELSE (gs.scores->>0)::integer END,
        'score_b', CASE WHEN gs.match_id IS NULL THEN NULL ELSE (gs.scores->>1)::integer END,
        'round', gs.round,
        'current_seat', gs.current_seat,
        'current_player_id', CASE gs.current_seat
          WHEN 0 THEN m.player_a
          WHEN 1 THEN m.player_b
          ELSE NULL
        END,
        'session_status', gs.status,
        'phase', gs.phase,
        'session_updated_at', gs.updated_at,
        'hand_count_a', CASE WHEN gs.match_id IS NULL THEN NULL ELSE (gs.hand_counts->>0)::integer END,
        'hand_count_b', CASE WHEN gs.match_id IS NULL THEN NULL ELSE (gs.hand_counts->>1)::integer END,
        'reserve_count', gs.reserve_count,
        'version', gs.version
      ) AS item,
      COALESCE(gs.updated_at, m.created_at) AS last_activity,
      m.id AS match_id
    FROM (
      SELECT DISTINCT match_id
      FROM public.active_match_players
    ) live
    INNER JOIN public.matches m ON m.id = live.match_id
    LEFT JOIN public.game_sessions gs ON gs.match_id = m.id
    LEFT JOIN public.profiles pa ON pa.id = m.player_a
    LEFT JOIN public.profiles pb ON pb.id = m.player_b
    LEFT JOIN public.player_global_ratings ra ON ra.player_id = m.player_a
    LEFT JOIN public.player_global_ratings rb ON rb.player_id = m.player_b
    LEFT JOIN public.active_match_players occ_a
      ON occ_a.match_id = m.id AND occ_a.player_id = m.player_a
    LEFT JOIN public.active_match_players occ_b
      ON occ_b.match_id = m.id AND occ_b.player_id = m.player_b
    ORDER BY COALESCE(gs.updated_at, m.created_at) DESC, m.id DESC
    LIMIT safe_limit
    OFFSET safe_offset
  ) listed;

  RETURN jsonb_build_object(
    'matches', rows,
    'total', total_count,
    'limit', safe_limit,
    'offset', safe_offset
  );
END;
$$;

COMMENT ON FUNCTION public.admin_list_live_matches(integer, integer) IS
  'Staff-only paginated live match directory from active_match_players. Same occupancy contract as before, plus stored stake_pips (NULL stays NULL).';

REVOKE ALL ON FUNCTION public.admin_list_live_matches(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_live_matches(integer, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- Match history
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_matches(
  p_search text DEFAULT NULL,
  p_ruleset_id text DEFAULT NULL,
  p_match_kind text DEFAULT NULL,
  p_stake_filter text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_finish_reason text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
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
  search_id uuid;
  safe_limit integer;
  safe_offset integer;
  total_count integer;
  rows jsonb;
  stake_filter text;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  wanted := btrim(COALESCE(p_search, ''));
  IF char_length(wanted) > 64 THEN
    wanted := left(wanted, 64);
  END IF;
  pattern := '%' || replace(replace(replace(wanted, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  IF wanted ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    search_id := wanted::uuid;
  ELSE
    search_id := NULL;
  END IF;

  stake_filter := lower(btrim(COALESCE(p_stake_filter, '')));
  IF stake_filter IN ('', 'all') THEN
    stake_filter := NULL;
  END IF;

  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
  safe_offset := GREATEST(COALESCE(p_offset, 0), 0);

  SELECT COUNT(*)::integer INTO total_count
  FROM public.matches m
  LEFT JOIN public.profiles pa ON pa.id = m.player_a
  LEFT JOIN public.profiles pb ON pb.id = m.player_b
  WHERE (search_id IS NULL OR m.id = search_id)
    AND (
      wanted = ''
      OR search_id IS NOT NULL
      OR pa.username ILIKE pattern ESCAPE '\'
      OR pa.display_name ILIKE pattern ESCAPE '\'
      OR pb.username ILIKE pattern ESCAPE '\'
      OR pb.display_name ILIKE pattern ESCAPE '\'
    )
    AND (p_ruleset_id IS NULL OR p_ruleset_id = '' OR m.ruleset_id = p_ruleset_id)
    AND (p_match_kind IS NULL OR p_match_kind = '' OR m.match_kind = p_match_kind)
    AND (
      stake_filter IS NULL
      OR (stake_filter = 'none' AND m.stake_pips IS NULL)
      OR (stake_filter IN ('20', '50', '100', '150') AND m.stake_pips = stake_filter::integer)
    )
    AND (p_status IS NULL OR p_status = '' OR m.status = p_status)
    AND (p_finish_reason IS NULL OR p_finish_reason = '' OR m.finish_reason = p_finish_reason)
    AND (p_from IS NULL OR m.created_at >= p_from)
    AND (p_to IS NULL OR m.created_at < p_to);

  SELECT COALESCE(jsonb_agg(item ORDER BY sort_at DESC, match_id DESC), '[]'::jsonb)
  INTO rows
  FROM (
    SELECT
      jsonb_build_object(
        'match_id', m.id,
        'player_a', jsonb_build_object(
          'player_id', m.player_a,
          'display_name', pa.display_name,
          'username', pa.username
        ),
        'player_b', jsonb_build_object(
          'player_id', m.player_b,
          'display_name', pb.display_name,
          'username', pb.username
        ),
        'ruleset_id', m.ruleset_id,
        'match_kind', m.match_kind,
        'stake_pips', m.stake_pips,
        'created_at', m.created_at,
        'finished_at', m.finished_at,
        'duration_seconds', CASE
          WHEN m.finished_at IS NULL THEN NULL
          ELSE GREATEST(EXTRACT(EPOCH FROM (m.finished_at - m.created_at))::integer, 0)
        END,
        'status', m.status,
        'finish_reason', m.finish_reason,
        'winner_player_id', CASE gs.match_winner_seat
          WHEN 0 THEN m.player_a
          WHEN 1 THEN m.player_b
          ELSE NULL
        END,
        'loser_player_id', CASE gs.match_winner_seat
          WHEN 0 THEN m.player_b
          WHEN 1 THEN m.player_a
          ELSE NULL
        END,
        'winner_seat', gs.match_winner_seat
      ) AS item,
      COALESCE(m.finished_at, m.created_at) AS sort_at,
      m.id AS match_id
    FROM public.matches m
    LEFT JOIN public.profiles pa ON pa.id = m.player_a
    LEFT JOIN public.profiles pb ON pb.id = m.player_b
    LEFT JOIN public.game_sessions gs ON gs.match_id = m.id
    WHERE (search_id IS NULL OR m.id = search_id)
      AND (
        wanted = ''
        OR search_id IS NOT NULL
        OR pa.username ILIKE pattern ESCAPE '\'
        OR pa.display_name ILIKE pattern ESCAPE '\'
        OR pb.username ILIKE pattern ESCAPE '\'
        OR pb.display_name ILIKE pattern ESCAPE '\'
      )
      AND (p_ruleset_id IS NULL OR p_ruleset_id = '' OR m.ruleset_id = p_ruleset_id)
      AND (p_match_kind IS NULL OR p_match_kind = '' OR m.match_kind = p_match_kind)
      AND (
        stake_filter IS NULL
        OR (stake_filter = 'none' AND m.stake_pips IS NULL)
        OR (stake_filter IN ('20', '50', '100', '150') AND m.stake_pips = stake_filter::integer)
      )
      AND (p_status IS NULL OR p_status = '' OR m.status = p_status)
      AND (p_finish_reason IS NULL OR p_finish_reason = '' OR m.finish_reason = p_finish_reason)
      AND (p_from IS NULL OR m.created_at >= p_from)
      AND (p_to IS NULL OR m.created_at < p_to)
    ORDER BY COALESCE(m.finished_at, m.created_at) DESC, m.id DESC
    LIMIT safe_limit
    OFFSET safe_offset
  ) listed;

  RETURN jsonb_build_object(
    'matches', rows,
    'total', total_count,
    'limit', safe_limit,
    'offset', safe_offset
  );
END;
$$;

COMMENT ON FUNCTION public.admin_list_matches(text, text, text, text, text, text, timestamptz, timestamptz, integer, integer) IS
  'Staff-only paginated match history. Newest first. NULL stake_pips stays NULL. No mutations.';

-- ---------------------------------------------------------------------------
-- One-match LeoPips ledger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_match_leopips(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  match_id uuid;
  stake integer;
  player_a uuid;
  player_b uuid;
  match_status text;
  finish_reason text;
  created_at timestamptz;
  finished_at timestamptz;
  match_kind text;
  ruleset_id text;
  winner_id uuid;
  ledger jsonb;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'match required' USING ERRCODE = '22023';
  END IF;

  SELECT
    m.id,
    m.stake_pips,
    m.player_a,
    m.player_b,
    m.status,
    m.finish_reason,
    m.created_at,
    m.finished_at,
    m.match_kind,
    m.ruleset_id
  INTO
    match_id,
    stake,
    player_a,
    player_b,
    match_status,
    finish_reason,
    created_at,
    finished_at,
    match_kind,
    ruleset_id
  FROM public.matches m
  WHERE m.id = p_match_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'match_id', p_match_id);
  END IF;

  SELECT CASE gs.match_winner_seat
    WHEN 0 THEN player_a
    WHEN 1 THEN player_b
    ELSE NULL
  END
  INTO winner_id
  FROM public.game_sessions gs
  WHERE gs.match_id = p_match_id;

  SELECT COALESCE(jsonb_agg(item ORDER BY created_at ASC, id ASC), '[]'::jsonb)
  INTO ledger
  FROM (
    SELECT
      jsonb_build_object(
        'id', l.id,
        'player_id', l.player_id,
        'username', p.username,
        'display_name', p.display_name,
        'amount', l.amount,
        'reason', l.reason,
        'idempotency_key', l.idempotency_key,
        'balance_after', l.balance_after,
        'created_at', l.created_at,
        'referral_id', l.referral_id
      ) AS item,
      l.created_at,
      l.id
    FROM public.leopips_ledger l
    LEFT JOIN public.profiles p ON p.id = l.player_id
    WHERE l.match_id = p_match_id
    ORDER BY l.created_at ASC, l.id ASC
    LIMIT 200
  ) listed;

  RETURN jsonb_build_object(
    'found', true,
    'match_id', match_id,
    'stake_pips', stake,
    'expected_pot', CASE
      WHEN stake IN (20, 50, 100, 150) THEN stake * 2
      ELSE NULL
    END,
    'player_a', player_a,
    'player_b', player_b,
    'winner_player_id', winner_id,
    'status', match_status,
    'finish_reason', finish_reason,
    'created_at', created_at,
    'finished_at', finished_at,
    'match_kind', match_kind,
    'ruleset_id', ruleset_id,
    'ledger', ledger
  );
END;
$$;

COMMENT ON FUNCTION public.admin_get_match_leopips(uuid) IS
  'Staff-only one-match LeoPips ledger. Does not fabricate missing rows or trigger settlement.';

-- ---------------------------------------------------------------------------
-- Wallet / ledger overview
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_leopips_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  wallets jsonb;
  ledger jsonb;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'total_wallets', COUNT(*)::integer,
    'total_balance', COALESCE(SUM(w.balance), 0)::bigint,
    'positive_wallets', COUNT(*) FILTER (WHERE w.balance > 0)::integer,
    'zero_wallets', COUNT(*) FILTER (WHERE w.balance = 0)::integer,
    'negative_wallets', COUNT(*) FILTER (WHERE w.balance < 0)::integer,
    'min_balance', MIN(w.balance),
    'max_balance', MAX(w.balance)
  )
  INTO wallets
  FROM public.player_leopips_wallets w;

  SELECT COALESCE(jsonb_object_agg(reason, stats), '{}'::jsonb)
  INTO ledger
  FROM (
    SELECT
      l.reason,
      jsonb_build_object(
        'reason', l.reason,
        'count', COUNT(*)::integer,
        'total_amount', COALESCE(SUM(l.amount), 0)::bigint
      ) AS stats
    FROM public.leopips_ledger l
    GROUP BY l.reason
  ) grouped;

  RETURN jsonb_build_object(
    'wallets', wallets,
    'ledger', ledger
  );
END;
$$;

COMMENT ON FUNCTION public.admin_get_leopips_overview() IS
  'Staff-only LeoPips circulation and ledger totals by authoritative reason. Read only.';

-- ---------------------------------------------------------------------------
-- Negative balances
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_negative_leopips(
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

  SELECT COUNT(*)::integer INTO total_count
  FROM public.player_leopips_wallets w
  WHERE w.balance < 0;

  SELECT COALESCE(jsonb_agg(item ORDER BY balance ASC, player_id ASC), '[]'::jsonb)
  INTO rows
  FROM (
    SELECT
      jsonb_build_object(
        'player_id', w.player_id,
        'username', p.username,
        'display_name', p.display_name,
        'balance', w.balance,
        'latest_amount', latest.amount,
        'latest_reason', latest.reason,
        'latest_idempotency_key', latest.idempotency_key,
        'latest_created_at', latest.created_at,
        'timeout_penalty_latest', latest.reason = 'timeout_penalty'
      ) AS item,
      w.balance,
      w.player_id
    FROM public.player_leopips_wallets w
    LEFT JOIN public.profiles p ON p.id = w.player_id
    LEFT JOIN LATERAL (
      SELECT l.amount, l.reason, l.idempotency_key, l.created_at
      FROM public.leopips_ledger l
      WHERE l.player_id = w.player_id
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT 1
    ) latest ON true
    WHERE w.balance < 0
    ORDER BY w.balance ASC, w.player_id ASC
    LIMIT safe_limit
    OFFSET safe_offset
  ) listed;

  RETURN jsonb_build_object(
    'wallets', rows,
    'total', total_count,
    'limit', safe_limit,
    'offset', safe_offset,
    'note', 'Negative balance is valid when produced by authoritative timeout_penalty -5.'
  );
END;
$$;

COMMENT ON FUNCTION public.admin_list_negative_leopips(integer, integer) IS
  'Staff-only negative LeoPips wallets. Timeout-penalty debt is not labeled fraudulent.';

-- ---------------------------------------------------------------------------
-- Stake activity
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_leopips_stake_activity(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  range_from timestamptz;
  range_to timestamptz;
  totals jsonb;
  by_style jsonb;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  range_from := COALESCE(p_from, now() - interval '7 days');
  range_to := COALESCE(p_to, now());

  SELECT jsonb_build_object(
    '20', COUNT(*) FILTER (WHERE m.stake_pips = 20)::integer,
    '50', COUNT(*) FILTER (WHERE m.stake_pips = 50)::integer,
    '100', COUNT(*) FILTER (WHERE m.stake_pips = 100)::integer,
    '150', COUNT(*) FILTER (WHERE m.stake_pips = 150)::integer,
    'null_stake', COUNT(*) FILTER (WHERE m.stake_pips IS NULL)::integer
  )
  INTO totals
  FROM public.matches m
  WHERE m.created_at >= range_from
    AND m.created_at < range_to;

  SELECT COALESCE(jsonb_agg(item ORDER BY ruleset_id), '[]'::jsonb)
  INTO by_style
  FROM (
    SELECT jsonb_build_object(
      'ruleset_id', m.ruleset_id,
      '20', COUNT(*) FILTER (WHERE m.stake_pips = 20)::integer,
      '50', COUNT(*) FILTER (WHERE m.stake_pips = 50)::integer,
      '100', COUNT(*) FILTER (WHERE m.stake_pips = 100)::integer,
      '150', COUNT(*) FILTER (WHERE m.stake_pips = 150)::integer
    ) AS item,
    m.ruleset_id
    FROM public.matches m
    WHERE m.created_at >= range_from
      AND m.created_at < range_to
      AND m.stake_pips IN (20, 50, 100, 150)
    GROUP BY m.ruleset_id
  ) listed;

  RETURN jsonb_build_object(
    'from', range_from,
    'to', range_to,
    'totals', totals,
    'by_style', by_style
  );
END;
$$;

COMMENT ON FUNCTION public.admin_list_leopips_stake_activity(timestamptz, timestamptz) IS
  'Staff-only stored-stake counts. NULL stake is counted separately and never coerced to 20.';

-- ---------------------------------------------------------------------------
-- LeoPips +100 referrals (not Invite & Win cash)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_leopips_referrals(
  p_search text DEFAULT NULL,
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
  summary jsonb;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  wanted := btrim(COALESCE(p_search, ''));
  IF char_length(wanted) > 64 THEN
    wanted := left(wanted, 64);
  END IF;
  pattern := '%' || replace(replace(replace(wanted, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
  safe_offset := GREATEST(COALESCE(p_offset, 0), 0);

  SELECT COUNT(*)::integer INTO total_count
  FROM public.referrals r
  LEFT JOIN public.profiles inviter ON inviter.id = r.referrer_id
  LEFT JOIN public.profiles referred ON referred.id = r.referred_id
  WHERE wanted = ''
     OR inviter.username ILIKE pattern ESCAPE '\'
     OR inviter.display_name ILIKE pattern ESCAPE '\'
     OR referred.username ILIKE pattern ESCAPE '\'
     OR referred.display_name ILIKE pattern ESCAPE '\';

  SELECT COALESCE(jsonb_agg(item ORDER BY created_at DESC, referral_id DESC), '[]'::jsonb)
  INTO rows
  FROM (
    SELECT
      jsonb_build_object(
        'referral_id', r.id,
        'inviter', jsonb_build_object(
          'player_id', r.referrer_id,
          'username', inviter.username,
          'display_name', inviter.display_name
        ),
        'referred', jsonb_build_object(
          'player_id', r.referred_id,
          'username', referred.username,
          'display_name', referred.display_name
        ),
        'created_at', r.created_at,
        'attributed_at', r.attributed_at,
        'validation_status', r.status,
        'qualifying_count', progress.qualified_count,
        'progress', LEAST(progress.qualified_count, 3),
        'required', 3,
        'eligible', (r.status IS DISTINCT FROM 'rejected' AND progress.qualified_count >= 3),
        'rewarded', reward.id IS NOT NULL,
        'reward_amount', reward.amount,
        'reward_created_at', reward.created_at,
        'reward_idempotency_key', reward.idempotency_key
      ) AS item,
      r.created_at,
      r.id AS referral_id
    FROM public.referrals r
    LEFT JOIN public.profiles inviter ON inviter.id = r.referrer_id
    LEFT JOIN public.profiles referred ON referred.id = r.referred_id
    LEFT JOIN LATERAL (
      SELECT public._leopips_count_qualifying_referral_matches(r.referred_id, r.attributed_at) AS qualified_count
    ) progress ON true
    LEFT JOIN LATERAL (
      SELECT l.id, l.amount, l.created_at, l.idempotency_key
      FROM public.leopips_ledger l
      WHERE l.referral_id = r.id
        AND l.reason = 'referral_reward'
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT 1
    ) reward ON true
    WHERE wanted = ''
       OR inviter.username ILIKE pattern ESCAPE '\'
       OR inviter.display_name ILIKE pattern ESCAPE '\'
       OR referred.username ILIKE pattern ESCAPE '\'
       OR referred.display_name ILIKE pattern ESCAPE '\'
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT safe_limit
    OFFSET safe_offset
  ) listed;

  SELECT jsonb_build_object(
    'total_referrals', COUNT(*)::integer,
    'pending', COUNT(*) FILTER (WHERE r.status = 'pending')::integer,
    'validated', COUNT(*) FILTER (WHERE r.status = 'validated')::integer,
    'rejected', COUNT(*) FILTER (WHERE r.status = 'rejected')::integer,
    'rewarded', (
      SELECT COUNT(*)::integer
      FROM public.leopips_ledger l
      WHERE l.reason = 'referral_reward'
    )
  )
  INTO summary
  FROM public.referrals r;

  RETURN jsonb_build_object(
    'referrals', rows,
    'summary', summary,
    'total', total_count,
    'limit', safe_limit,
    'offset', safe_offset,
    'rule', 'LeoPips +100 once after 3 public completed online matches via _leopips_count_qualifying_referral_matches. Friend matches excluded.'
  );
END;
$$;

COMMENT ON FUNCTION public.admin_list_leopips_referrals(text, integer, integer) IS
  'Staff-only LeoPips +100 referral monitor. Reuses _leopips_count_qualifying_referral_matches. Does not award.';

-- ---------------------------------------------------------------------------
-- Timeout penalties
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_timeout_penalties(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
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
  range_from timestamptz;
  range_to timestamptz;
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

  range_from := COALESCE(p_from, now() - interval '30 days');
  range_to := COALESCE(p_to, now());
  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
  safe_offset := GREATEST(COALESCE(p_offset, 0), 0);

  SELECT COUNT(*)::integer INTO total_count
  FROM public.leopips_ledger l
  WHERE l.reason = 'timeout_penalty'
    AND l.created_at >= range_from
    AND l.created_at < range_to;

  SELECT COALESCE(jsonb_agg(item ORDER BY created_at DESC, id DESC), '[]'::jsonb)
  INTO rows
  FROM (
    SELECT
      jsonb_build_object(
        'match_id', l.match_id,
        'player_id', l.player_id,
        'username', p.username,
        'display_name', p.display_name,
        'amount', l.amount,
        'strike', strike.n,
        'idempotency_key', l.idempotency_key,
        'created_at', l.created_at,
        'balance_after', l.balance_after,
        'current_balance', w.balance,
        'anomaly_unexpected_amount', l.amount IS DISTINCT FROM -5,
        'anomaly_strike_3', strike.n = 3,
        'anomaly_duplicate_strike', dup.n > 1
      ) AS item,
      l.created_at,
      l.id
    FROM public.leopips_ledger l
    LEFT JOIN public.profiles p ON p.id = l.player_id
    LEFT JOIN public.player_leopips_wallets w ON w.player_id = l.player_id
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN l.idempotency_key ~ '^timeout_penalty:[0-9a-f-]+:[0-9]+$'
        THEN split_part(l.idempotency_key, ':', 3)::integer
        ELSE NULL
      END AS n
    ) strike
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::integer AS n
      FROM public.leopips_ledger d
      WHERE d.reason = 'timeout_penalty'
        AND d.match_id = l.match_id
        AND d.player_id = l.player_id
        AND d.idempotency_key = l.idempotency_key
    ) dup ON true
    WHERE l.reason = 'timeout_penalty'
      AND l.created_at >= range_from
      AND l.created_at < range_to
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT safe_limit
    OFFSET safe_offset
  ) listed;

  RETURN jsonb_build_object(
    'penalties', rows,
    'total', total_count,
    'limit', safe_limit,
    'offset', safe_offset,
    'from', range_from,
    'to', range_to,
    'contract', 'strike 1 = -5, strike 2 = -5, no strike 3 wallet penalty'
  );
END;
$$;

COMMENT ON FUNCTION public.admin_list_timeout_penalties(timestamptz, timestamptz, integer, integer) IS
  'Staff-only timeout_penalty ledger. Flags :3, amount <> -5, and duplicate keys. Does not repair.';

-- ---------------------------------------------------------------------------
-- Bounded anomalies
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_leopips_anomalies(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  range_from timestamptz;
  range_to timestamptz;
  safe_limit integer;
  rows jsonb;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  range_from := COALESCE(p_from, now() - interval '7 days');
  range_to := COALESCE(p_to, now());
  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);

  SELECT COALESCE(jsonb_agg(item ORDER BY created_at DESC), '[]'::jsonb)
  INTO rows
  FROM (
    SELECT item, created_at
    FROM (
      SELECT jsonb_build_object(
        'anomaly_type', 'missing_stake_debit',
        'match_id', m.id,
        'player_id', NULL,
        'stake_pips', m.stake_pips,
        'status', m.status,
        'finish_reason', m.finish_reason,
        'ledger_key', NULL,
        'ledger_amount', NULL,
        'created_at', m.created_at
      ) AS item,
      m.created_at
      FROM public.matches m
      WHERE m.created_at >= range_from
        AND m.created_at < range_to
        AND m.stake_pips IN (20, 50, 100, 150)
        AND (
          m.status = 'playing'
          OR m.finish_reason IN ('completed', 'forfeit', 'timeout')
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.leopips_ledger l
          WHERE l.match_id = m.id AND l.reason = 'match_stake'
        )

      UNION ALL

      SELECT jsonb_build_object(
        'anomaly_type', 'missing_payout',
        'match_id', m.id,
        'player_id', NULL,
        'stake_pips', m.stake_pips,
        'status', m.status,
        'finish_reason', m.finish_reason,
        'ledger_key', NULL,
        'ledger_amount', NULL,
        'created_at', COALESCE(m.finished_at, m.created_at)
      ),
      COALESCE(m.finished_at, m.created_at)
      FROM public.matches m
      WHERE m.created_at >= range_from
        AND m.created_at < range_to
        AND m.stake_pips IN (20, 50, 100, 150)
        AND m.finish_reason IN ('completed', 'forfeit', 'timeout')
        AND NOT EXISTS (
          SELECT 1 FROM public.leopips_ledger l
          WHERE l.match_id = m.id AND l.reason = 'match_payout'
        )

      UNION ALL

      SELECT jsonb_build_object(
        'anomaly_type', 'missing_refund',
        'match_id', m.id,
        'player_id', NULL,
        'stake_pips', m.stake_pips,
        'status', m.status,
        'finish_reason', m.finish_reason,
        'ledger_key', NULL,
        'ledger_amount', NULL,
        'created_at', COALESCE(m.finished_at, m.created_at)
      ),
      COALESCE(m.finished_at, m.created_at)
      FROM public.matches m
      WHERE m.created_at >= range_from
        AND m.created_at < range_to
        AND m.stake_pips IN (20, 50, 100, 150)
        AND m.finish_reason IN ('join_timeout', 'abandoned')
        AND EXISTS (
          SELECT 1 FROM public.leopips_ledger l
          WHERE l.match_id = m.id AND l.reason = 'match_stake'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.leopips_ledger l
          WHERE l.match_id = m.id
            AND l.reason = 'correction'
            AND l.idempotency_key LIKE 'refund_stake:%'
        )

      UNION ALL

      SELECT jsonb_build_object(
        'anomaly_type', 'duplicate_payout',
        'match_id', l.match_id,
        'player_id', NULL,
        'stake_pips', m.stake_pips,
        'status', m.status,
        'finish_reason', m.finish_reason,
        'ledger_key', NULL,
        'ledger_amount', NULL,
        'created_at', MAX(l.created_at)
      ),
      MAX(l.created_at)
      FROM public.leopips_ledger l
      JOIN public.matches m ON m.id = l.match_id
      WHERE l.reason = 'match_payout'
        AND l.created_at >= range_from
        AND l.created_at < range_to
      GROUP BY l.match_id, m.stake_pips, m.status, m.finish_reason
      HAVING COUNT(*) > 1

      UNION ALL

      SELECT jsonb_build_object(
        'anomaly_type', 'duplicate_stake_debit',
        'match_id', l.match_id,
        'player_id', l.player_id,
        'stake_pips', m.stake_pips,
        'status', m.status,
        'finish_reason', m.finish_reason,
        'ledger_key', NULL,
        'ledger_amount', NULL,
        'created_at', MAX(l.created_at)
      ),
      MAX(l.created_at)
      FROM public.leopips_ledger l
      JOIN public.matches m ON m.id = l.match_id
      WHERE l.reason = 'match_stake'
        AND l.created_at >= range_from
        AND l.created_at < range_to
      GROUP BY l.match_id, l.player_id, m.stake_pips, m.status, m.finish_reason
      HAVING COUNT(*) > 1

      UNION ALL

      SELECT jsonb_build_object(
        'anomaly_type', 'invalid_timeout_penalty',
        'match_id', l.match_id,
        'player_id', l.player_id,
        'stake_pips', m.stake_pips,
        'status', m.status,
        'finish_reason', m.finish_reason,
        'ledger_key', l.idempotency_key,
        'ledger_amount', l.amount,
        'created_at', l.created_at
      ),
      l.created_at
      FROM public.leopips_ledger l
      LEFT JOIN public.matches m ON m.id = l.match_id
      WHERE l.reason = 'timeout_penalty'
        AND l.created_at >= range_from
        AND l.created_at < range_to
        AND (
          l.amount IS DISTINCT FROM -5
          OR l.idempotency_key LIKE '%:3'
          OR l.idempotency_key !~ '^timeout_penalty:[0-9a-f-]+:[12]$'
        )

      UNION ALL

      SELECT jsonb_build_object(
        'anomaly_type', 'payout_inconsistent_with_stake',
        'match_id', l.match_id,
        'player_id', l.player_id,
        'stake_pips', m.stake_pips,
        'status', m.status,
        'finish_reason', m.finish_reason,
        'ledger_key', l.idempotency_key,
        'ledger_amount', l.amount,
        'created_at', l.created_at
      ),
      l.created_at
      FROM public.leopips_ledger l
      JOIN public.matches m ON m.id = l.match_id
      WHERE l.reason = 'match_payout'
        AND l.created_at >= range_from
        AND l.created_at < range_to
        AND m.stake_pips IN (20, 50, 100, 150)
        AND l.amount IS DISTINCT FROM (m.stake_pips * 2)

      UNION ALL

      SELECT jsonb_build_object(
        'anomaly_type', 'unstaked_or_friend_ledger',
        'match_id', l.match_id,
        'player_id', l.player_id,
        'stake_pips', m.stake_pips,
        'status', m.status,
        'finish_reason', m.finish_reason,
        'ledger_key', l.idempotency_key,
        'ledger_amount', l.amount,
        'created_at', l.created_at
      ),
      l.created_at
      FROM public.leopips_ledger l
      JOIN public.matches m ON m.id = l.match_id
      WHERE l.created_at >= range_from
        AND l.created_at < range_to
        AND l.reason IN ('match_stake', 'match_payout')
        AND (m.stake_pips IS NULL OR m.match_kind = 'friend')

      UNION ALL

      SELECT jsonb_build_object(
        'anomaly_type', 'public_null_or_invalid_stake',
        'match_id', m.id,
        'player_id', NULL,
        'stake_pips', m.stake_pips,
        'status', m.status,
        'finish_reason', m.finish_reason,
        'ledger_key', NULL,
        'ledger_amount', NULL,
        'created_at', m.created_at
      ),
      m.created_at
      FROM public.matches m
      WHERE m.created_at >= range_from
        AND m.created_at < range_to
        AND COALESCE(m.match_kind, 'public') = 'public'
        AND (
          m.stake_pips IS NULL
          OR m.stake_pips NOT IN (20, 50, 100, 150)
        )
        AND m.status IN ('ready', 'playing', 'finished')
    ) detected
    ORDER BY created_at DESC
    LIMIT safe_limit
  ) limited;

  RETURN jsonb_build_object(
    'anomalies', rows,
    'limit', safe_limit,
    'from', range_from,
    'to', range_to
  );
END;
$$;

COMMENT ON FUNCTION public.admin_list_leopips_anomalies(timestamptz, timestamptz, integer) IS
  'Staff-only bounded LeoPips settlement diagnostics. Default last 7 days, max 100 rows. Does not repair.';

-- ---------------------------------------------------------------------------
-- Open lobby / matchmaking health
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_open_match_requests(
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

  SELECT COUNT(*)::integer INTO total_count
  FROM public.match_requests r
  WHERE r.status = 'open';

  SELECT COALESCE(jsonb_agg(item ORDER BY created_at DESC, request_id DESC), '[]'::jsonb)
  INTO rows
  FROM (
    SELECT
      jsonb_build_object(
        'request_id', r.id,
        'creator', jsonb_build_object(
          'player_id', r.creator_id,
          'username', p.username,
          'display_name', p.display_name
        ),
        'visibility', r.visibility,
        'ruleset_id', r.ruleset_id,
        'stake_pips', r.stake_pips,
        'status', r.status,
        'created_at', r.created_at,
        'expires_at', r.expires_at,
        'age_seconds', GREATEST(EXTRACT(EPOCH FROM (now() - r.created_at))::integer, 0),
        'flag_public_null_stake', (COALESCE(r.visibility, 'public') = 'public' AND r.stake_pips IS NULL),
        'flag_invalid_stake', (r.stake_pips IS NOT NULL AND r.stake_pips NOT IN (20, 50, 100, 150)),
        'flag_invalid_style', (r.ruleset_id IS NULL OR r.ruleset_id NOT IN ('legacy', 'haitian', 'american')),
        'flag_stale', (r.expires_at < now() OR r.created_at < now() - interval '10 minutes'),
        'flag_friend_as_public', (COALESCE(r.visibility, 'public') = 'public' AND r.invitee_id IS NOT NULL),
        'exact_style_stake_bucket', CASE
          WHEN COALESCE(r.visibility, 'public') = 'public'
            AND r.stake_pips IN (20, 50, 100, 150)
            AND r.ruleset_id IN ('legacy', 'haitian', 'american')
          THEN r.ruleset_id || ':' || r.stake_pips::text
          ELSE NULL
        END
      ) AS item,
      r.created_at,
      r.id AS request_id
    FROM public.match_requests r
    LEFT JOIN public.profiles p ON p.id = r.creator_id
    WHERE r.status = 'open'
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT safe_limit
    OFFSET safe_offset
  ) listed;

  RETURN jsonb_build_object(
    'requests', rows,
    'total', total_count,
    'limit', safe_limit,
    'offset', safe_offset,
    'rule', 'Public LeoPips matching is exact style + exact stake (20/50/100/150).'
  );
END;
$$;

COMMENT ON FUNCTION public.admin_list_open_match_requests(integer, integer) IS
  'Staff-only open match_requests. Observational flags only. Does not change matchmaking.';

-- ---------------------------------------------------------------------------
-- Player LeoPips detail
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_player_leopips(p_player_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  wallet jsonb;
  ledger jsonb;
  matches jsonb;
  referral jsonb;
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

  SELECT jsonb_build_object(
    'player_id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'balance', w.balance,
    'wallet_updated_at', w.updated_at
  )
  INTO wallet
  FROM public.profiles p
  LEFT JOIN public.player_leopips_wallets w ON w.player_id = p.id
  WHERE p.id = p_player_id;

  IF wallet IS NULL THEN
    RETURN jsonb_build_object('found', false, 'player_id', p_player_id);
  END IF;

  SELECT COALESCE(jsonb_agg(item ORDER BY created_at DESC, id DESC), '[]'::jsonb)
  INTO ledger
  FROM (
    SELECT
      jsonb_build_object(
        'id', l.id,
        'amount', l.amount,
        'reason', l.reason,
        'match_id', l.match_id,
        'referral_id', l.referral_id,
        'idempotency_key', l.idempotency_key,
        'balance_after', l.balance_after,
        'created_at', l.created_at
      ) AS item,
      l.created_at,
      l.id
    FROM public.leopips_ledger l
    WHERE l.player_id = p_player_id
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT 25
  ) listed;

  SELECT COALESCE(jsonb_agg(item ORDER BY created_at DESC, match_id DESC), '[]'::jsonb)
  INTO matches
  FROM (
    SELECT
      jsonb_build_object(
        'match_id', m.id,
        'ruleset_id', m.ruleset_id,
        'match_kind', m.match_kind,
        'stake_pips', m.stake_pips,
        'status', m.status,
        'finish_reason', m.finish_reason,
        'created_at', m.created_at,
        'finished_at', m.finished_at
      ) AS item,
      m.created_at,
      m.id AS match_id
    FROM public.matches m
    WHERE (m.player_a = p_player_id OR m.player_b = p_player_id)
      AND m.stake_pips IN (20, 50, 100, 150)
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 10
  ) listed;

  SELECT jsonb_build_object(
    'as_referred', CASE
      WHEN r.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'referral_id', r.id,
        'inviter_id', r.referrer_id,
        'validation_status', r.status,
        'qualifying_count', public._leopips_count_qualifying_referral_matches(r.referred_id, r.attributed_at),
        'rewarded', EXISTS (
          SELECT 1 FROM public.leopips_ledger l
          WHERE l.referral_id = r.id AND l.reason = 'referral_reward'
        )
      )
    END,
    'rewards_earned', (
      SELECT COALESCE(jsonb_agg(item ORDER BY created_at DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'referral_id', l.referral_id,
          'amount', l.amount,
          'created_at', l.created_at,
          'idempotency_key', l.idempotency_key
        ) AS item,
        l.created_at
        FROM public.leopips_ledger l
        WHERE l.player_id = p_player_id
          AND l.reason = 'referral_reward'
        ORDER BY l.created_at DESC
        LIMIT 10
      ) earned
    )
  )
  INTO referral
  FROM (SELECT 1) dummy
  LEFT JOIN public.referrals r ON r.referred_id = p_player_id;

  RETURN jsonb_build_object(
    'found', true,
    'player', wallet,
    'ledger', ledger,
    'recent_staked_matches', matches,
    'referral', referral
  );
END;
$$;

COMMENT ON FUNCTION public.admin_get_player_leopips(uuid) IS
  'Staff-only player LeoPips wallet, 25 recent ledger rows, 10 recent staked matches, referral +100 status. No auth secrets.';

REVOKE ALL ON FUNCTION public.admin_list_matches(text, text, text, text, text, text, timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_match_leopips(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_leopips_overview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_negative_leopips(integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_leopips_stake_activity(timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_leopips_referrals(text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_timeout_penalties(timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_leopips_anomalies(timestamptz, timestamptz, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_open_match_requests(integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_player_leopips(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_list_matches(text, text, text, text, text, text, timestamptz, timestamptz, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_match_leopips(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_leopips_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_negative_leopips(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_leopips_stake_activity(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_leopips_referrals(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_timeout_penalties(timestamptz, timestamptz, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_leopips_anomalies(timestamptz, timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_open_match_requests(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_player_leopips(uuid) TO authenticated;
