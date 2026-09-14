-- LeoPips: playing start MUST debit both stakes before session/playing.
-- Closes the gap where Edge fell back to plain install_online_game (zero ledger).
-- Friend / NULL stake continues to skip debit.
-- Does NOT repair historical zero-debit matches.
-- Do NOT apply to hosted Supabase until explicitly approved.

BEGIN;

-- ---------------------------------------------------------------------------
-- Require both match_stake ledger rows (idempotent debit first).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._leopips_require_both_match_stakes(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stake integer;
  debit jsonb;
  stake_rows integer;
BEGIN
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'match required' USING ERRCODE = '22023';
  END IF;

  SELECT m.stake_pips
  INTO stake
  FROM public.matches m
  WHERE m.id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match not found' USING ERRCODE = 'P0002';
  END IF;

  IF stake IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'skipped', true, 'reason', 'friend_or_unstaked');
  END IF;

  IF NOT public._leopips_is_allowed_stake(stake) THEN
    RAISE EXCEPTION 'INVALID_LEOPIPS_STAKE' USING ERRCODE = '22023';
  END IF;

  debit := public._leopips_debit_both_stored_match_stakes(p_match_id);

  SELECT count(*)::integer
  INTO stake_rows
  FROM public.leopips_ledger l
  WHERE l.match_id = p_match_id
    AND l.reason = 'match_stake';

  IF stake_rows IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'LEOPIPS_STAKE_REQUIRED'
      USING ERRCODE = 'P0001',
            DETAIL = format('expected 2 match_stake rows, found %s', COALESCE(stake_rows, 0));
  END IF;

  RETURN COALESCE(debit, '{}'::jsonb) || jsonb_build_object(
    'verified', true,
    'stake_rows', stake_rows
  );
END;
$$;

COMMENT ON FUNCTION public._leopips_require_both_match_stakes(uuid) IS
  'Internal. For staked matches: idempotent dual debit then assert exactly 2 match_stake rows. Friend/NULL skipped. Refuses one-sided or missing stakes.';

REVOKE ALL ON FUNCTION public._leopips_require_both_match_stakes(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Playing-start debit delegates to the same verifier.
CREATE OR REPLACE FUNCTION public._leopips_on_playing_start(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_service_role();
  RETURN public._leopips_require_both_match_stakes(p_match_id);
END;
$$;

COMMENT ON FUNCTION public._leopips_on_playing_start(uuid) IS
  'Service-role only. Requires both staked debits before playing. Friend/NULL stake skipped. Idempotent.';

REVOKE ALL ON FUNCTION public._leopips_on_playing_start(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._leopips_on_playing_start(uuid) TO service_role;

-- Harden install: even plain install_online_game cannot enter playing without stakes.
CREATE OR REPLACE FUNCTION public.install_online_game(
  p_match_id uuid,
  p_ruleset_id text,
  p_public jsonb,
  p_engine_state jsonb,
  p_deal_seed bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_id uuid;
  existing public.game_sessions%ROWTYPE;
  match_row public.matches%ROWTYPE;
  v_phase text;
  v_status text;
  v_deadline timestamptz;
  stake_gate jsonb;
BEGIN
  PERFORM public.require_service_role();
  IF p_match_id IS NULL OR p_public IS NULL OR p_engine_state IS NULL OR p_deal_seed IS NULL THEN
    RAISE EXCEPTION 'install arguments required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO match_row FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'match not found' USING ERRCODE = 'P0002';
  END IF;
  IF match_row.ruleset_id IS DISTINCT FROM p_ruleset_id THEN
    RAISE EXCEPTION 'ruleset_id must match matches.ruleset_id' USING ERRCODE = '22023';
  END IF;
  IF p_engine_state ? 'seed' AND (p_engine_state->>'seed') IS NOT NULL THEN
    NULL;
  END IF;

  -- Invariant: staked LeoPips matches cannot install/play without both debits.
  -- Atomic with this function: failure rolls back any session insert in this txn.
  stake_gate := public._leopips_require_both_match_stakes(p_match_id);

  v_phase := COALESCE(p_public->>'phase', 'playing');
  v_status := COALESCE(p_public->>'status', 'playing');
  IF v_status = 'playing' AND v_phase = 'playing' THEN
    v_deadline := now() + interval '30 seconds';
  ELSE
    v_deadline := NULL;
  END IF;

  INSERT INTO public.game_sessions (
    match_id, ruleset_id, status, version, current_seat, round, phase, scores,
    board, spinner, last_play_points, last_play_points_seat, last_play_score_terminals,
    reserve_count, hand_counts, round_result, match_winner_seat,
    turn_deadline_at, timeout_strikes
  )
  VALUES (
    p_match_id,
    p_ruleset_id,
    v_status,
    COALESCE((p_public->>'version')::integer, 0),
    COALESCE((p_public->>'currentSeat')::integer, 0),
    COALESCE((p_public->>'round')::integer, 1),
    v_phase,
    COALESCE(p_public->'scores', '[0,0]'::jsonb),
    COALESCE(p_public->'board', '[]'::jsonb),
    p_public->'spinner',
    COALESCE((p_public->>'lastPlayPoints')::integer, 0),
    NULLIF(p_public->>'lastPlayPointsSeat', '')::integer,
    COALESCE(p_public->'lastPlayScoreTerminals', '[]'::jsonb),
    COALESCE((p_public->>'reserveCount')::integer, 0),
    COALESCE(p_public->'handCounts', '[0,0]'::jsonb),
    p_public->'roundResult',
    NULLIF(p_public->>'matchWinnerSeat', '')::integer,
    v_deadline,
    COALESCE(p_public->'timeoutStrikes', '[0,0]'::jsonb)
  )
  ON CONFLICT (match_id) DO NOTHING
  RETURNING match_id INTO inserted_id;

  IF inserted_id IS NULL THEN
    -- Idempotent re-install: still require stakes (repairs wrapper-miss races going forward).
    stake_gate := public._leopips_require_both_match_stakes(p_match_id);
    SELECT * INTO existing FROM public.game_sessions WHERE match_id = p_match_id;
    RETURN jsonb_build_object(
      'created', false,
      'version', existing.version,
      'turnDeadlineAt', existing.turn_deadline_at,
      'timeoutStrikes', existing.timeout_strikes,
      'leopips', stake_gate
    );
  END IF;

  INSERT INTO public.game_secrets (match_id, engine_state, deal_seed)
  VALUES (p_match_id, p_engine_state, p_deal_seed);

  IF match_row.status = 'ready' THEN
    UPDATE public.matches SET status = 'playing' WHERE id = p_match_id;
  END IF;

  RETURN jsonb_build_object(
    'created', true,
    'version', COALESCE((p_public->>'version')::integer, 0),
    'turnDeadlineAt', v_deadline,
    'timeoutStrikes', COALESCE(p_public->'timeoutStrikes', '[0,0]'::jsonb),
    'leopips', stake_gate
  );
END;
$$;

COMMENT ON FUNCTION public.install_online_game(uuid, text, jsonb, jsonb, bigint) IS
  'Service-role install. For staked matches, both LeoPips stake debits must succeed in the same transaction before playing. Friend/NULL stake skips debit.';

-- Wrapper still debits first (idempotent) then install (which verifies again).
CREATE OR REPLACE FUNCTION public._leopips_install_online_game(
  p_match_id uuid,
  p_ruleset_id text,
  p_public jsonb,
  p_engine_state jsonb,
  p_deal_seed bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_service_role();
  PERFORM public._leopips_on_playing_start(p_match_id);
  RETURN public.install_online_game(
    p_match_id,
    p_ruleset_id,
    p_public,
    p_engine_state,
    p_deal_seed
  );
END;
$$;

COMMENT ON FUNCTION public._leopips_install_online_game(uuid, text, jsonb, jsonb, bigint) IS
  'Service-role wrapper. Debit+verify then install. Plain install is also stake-gated; Edge must fail closed for staked matches if this RPC is missing.';

REVOKE ALL ON FUNCTION public._leopips_install_online_game(uuid, text, jsonb, jsonb, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._leopips_install_online_game(uuid, text, jsonb, jsonb, bigint)
  TO service_role;

COMMIT;
