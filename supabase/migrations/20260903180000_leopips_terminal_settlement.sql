-- LeoPips terminal settlement: forfeit / one-sided abandon / infrastructure abort.
-- Routes those SQL terminal writers through the existing pot helper.
-- Do NOT apply to hosted Supabase until explicitly approved.
-- Does not edit 20260903120000 / 20260903140000 / 20260903150000 /
-- 20260903160000 / 20260903170000.
-- Does not change matchmaking, stake tiers, timeout strike math, XP/Level,
-- friend rules, or Global RP.

BEGIN;

-- ---------------------------------------------------------------------------
-- Internal pot/refund entry. Same rules as _leopips_on_match_finished.
-- No require_service_role: authenticated forfeit/janitor SECURITY DEFINER
-- callers cannot satisfy auth.role() = service_role. EXECUTE stays revoked
-- from PUBLIC/anon/authenticated/service_role (owner-only, like _leopips_apply).
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
BEGIN
  SELECT * INTO match_row
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'match_not_found');
  END IF;
  IF match_row.stake_pips IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'skipped', true, 'reason', 'friend_or_unstaked');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.leopips_ledger l
    WHERE l.match_id = p_match_id AND l.reason = 'match_stake'
  ) THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'stake_not_debited');
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
      RETURN public._leopips_refund_both_match_stakes(p_match_id);
    END IF;
    RETURN jsonb_build_object('applied', false, 'reason', 'winner_not_authoritative');
  END IF;

  IF match_row.finish_reason IS DISTINCT FROM 'completed'
     AND match_row.finish_reason IS DISTINCT FROM 'forfeit'
     AND match_row.finish_reason IS DISTINCT FROM 'timeout'
     AND match_row.finish_reason IS DISTINCT FROM 'abandon'
     AND match_row.finish_reason IS DISTINCT FROM 'abandoned' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_authoritative_loss', 'finish_reason', match_row.finish_reason);
  END IF;

  outcome := CASE match_row.finish_reason
    WHEN 'forfeit' THEN 'forfeit_win'
    WHEN 'timeout' THEN 'timeout_win'
    WHEN 'abandon' THEN 'abandon_win'
    WHEN 'abandoned' THEN 'abandon_win'
    ELSE 'normal_win'
  END;

  payout := public._leopips_credit_match_payout(winner, p_match_id, outcome);
  PERFORM public._leopips_try_credit_referral_after_match(p_match_id);
  RETURN jsonb_build_object('applied', true, 'payout', payout, 'winner', winner, 'outcome', outcome);
END;
$$;

COMMENT ON FUNCTION public._leopips_settle_finished_match(uuid) IS
  'Internal. Pays 2S from stored stake debit for completed/forfeit/abandon/timeout. No-winner abort refunds. Idempotent match_payout:{match}.';

REVOKE ALL ON FUNCTION public._leopips_settle_finished_match(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Edge wrapper keeps the service-role gate. Body is the shared helper.
CREATE OR REPLACE FUNCTION public._leopips_on_match_finished(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_service_role();
  RETURN public._leopips_settle_finished_match(p_match_id);
END;
$$;

COMMENT ON FUNCTION public._leopips_on_match_finished(uuid) IS
  'Service-role. Delegates to _leopips_settle_finished_match.';

REVOKE ALL ON FUNCTION public._leopips_on_match_finished(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._leopips_on_match_finished(uuid) TO service_role;

-- Payout math stays here. Drop the JWT service-role check so the owner-only
-- settle helper can credit after an authenticated forfeit. EXECUTE remains
-- service_role-only for direct RPC; authenticated cannot call this.
CREATE OR REPLACE FUNCTION public._leopips_credit_match_payout(
  p_player uuid,
  p_match_id uuid,
  p_outcome text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stake integer;
BEGIN
  IF p_player IS NULL OR p_match_id IS NULL THEN
    RAISE EXCEPTION 'player and match required' USING ERRCODE = '22023';
  END IF;
  IF p_outcome NOT IN ('normal_win', 'forfeit_win', 'timeout_win', 'abandon_win') THEN
    RAISE EXCEPTION 'payout outcome not finalized' USING ERRCODE = '22023';
  END IF;

  SELECT -l.amount
  INTO stake
  FROM public.leopips_ledger l
  WHERE l.player_id = p_player
    AND l.match_id = p_match_id
    AND l.reason = 'match_stake';

  IF stake IS NULL THEN
    RAISE EXCEPTION 'match stake not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._leopips_is_allowed_stake(stake) THEN
    RAISE EXCEPTION 'INVALID_LEOPIPS_STAKE' USING ERRCODE = '22023';
  END IF;

  RETURN public._leopips_apply(
    p_player,
    stake * 2,
    'match_payout',
    'match_payout:' || p_match_id::text,
    p_match_id,
    NULL
  );
END;
$$;

COMMENT ON FUNCTION public._leopips_credit_match_payout(uuid, uuid, text) IS
  'Server-computed pot 2S from stored match_stake. No client amount. Idempotent match_payout:{match}.';

REVOKE ALL ON FUNCTION public._leopips_credit_match_payout(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._leopips_credit_match_payout(uuid, uuid, text) TO service_role;

-- Infrastructure abort after a real debit must refund. Session existence is
-- not a veto: both-stale abort can happen after playing start.
CREATE OR REPLACE FUNCTION public._leopips_refund_both_match_stakes(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  match_row public.matches%ROWTYPE;
  rec record;
  result jsonb := '[]'::jsonb;
BEGIN
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'match required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO match_row
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'match_not_found');
  END IF;
  IF match_row.status IS DISTINCT FROM 'aborted' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_prestart_abort');
  END IF;
  IF match_row.finish_reason IN ('completed', 'forfeit', 'timeout') THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'authoritative_loss');
  END IF;
  IF match_row.finish_reason IS NOT NULL
     AND match_row.finish_reason IS DISTINCT FROM 'join_timeout'
     AND match_row.finish_reason IS DISTINCT FROM 'abandoned'
     AND match_row.finish_reason IS DISTINCT FROM 'aborted' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_prestart_abort');
  END IF;

  FOR rec IN
    SELECT l.player_id, -l.amount AS stake
    FROM public.leopips_ledger l
    WHERE l.match_id = p_match_id
      AND l.reason = 'match_stake'
  LOOP
    result := result || jsonb_build_array(public._leopips_apply(
      rec.player_id,
      rec.stake,
      'correction',
      'refund_stake:' || p_match_id::text || ':' || rec.player_id::text,
      p_match_id,
      NULL
    ));
  END LOOP;

  RETURN jsonb_build_object('applied', true, 'results', result);
END;
$$;

COMMENT ON FUNCTION public._leopips_refund_both_match_stakes(uuid) IS
  'Idempotent refund for join_timeout / no-winner infrastructure abort. Never refunds forfeit, timeout loss, or completed pots.';

REVOKE ALL ON FUNCTION public._leopips_refund_both_match_stakes(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Forfeit / one-sided abandonment (C2 forfeit_a / forfeit_b / leave / deletion).
-- Lock order and RP settle unchanged. LeoPips pot in the same transaction.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._forfeit_match_player(p_match_id uuid, p_forfeit_player uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  match_row public.matches%ROWTYPE;
  session_row public.game_sessions%ROWTYPE;
  winner_seat integer;
  forfeit_seat integer;
BEGIN
  IF p_match_id IS NULL OR p_forfeit_player IS NULL THEN
    RAISE EXCEPTION 'match id required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO session_row
  FROM public.game_sessions
  WHERE match_id = p_match_id
  FOR UPDATE;

  SELECT * INTO match_row
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF match_row.player_a <> p_forfeit_player AND match_row.player_b <> p_forfeit_player THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_seated');
  END IF;

  winner_seat := CASE WHEN match_row.player_a = p_forfeit_player THEN 1 ELSE 0 END;
  forfeit_seat := CASE WHEN match_row.player_a = p_forfeit_player THEN 0 ELSE 1 END;

  IF match_row.status NOT IN ('ready', 'playing') THEN
    IF match_row.status = 'finished' THEN
      PERFORM public.settle_match_global_rp(p_match_id);
      PERFORM public._leopips_settle_finished_match(p_match_id);
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'matchId', match_row.id,
      'status', match_row.status,
      'winnerSeat', COALESCE(session_row.match_winner_seat, winner_seat),
      'forfeitSeat', forfeit_seat
    );
  END IF;

  UPDATE public.game_sessions
  SET
    status = 'match_over',
    phase = 'matchOver',
    match_winner_seat = winner_seat,
    version = version + 1,
    round_result = jsonb_build_object(
      'reason', 'forfeit',
      'forfeitSeat', forfeit_seat,
      'winnerIndex', winner_seat
    ),
    updated_at = now()
  WHERE match_id = p_match_id;

  UPDATE public.game_secrets
  SET engine_state = jsonb_set(
    jsonb_set(
      jsonb_set(
        COALESCE(engine_state, '{}'::jsonb),
        '{phase}',
        '"matchOver"'
      ),
      '{matchWinner}',
      to_jsonb(winner_seat)
    ),
    '{roundResult}',
    jsonb_build_object(
      'reason', 'forfeit',
      'forfeitSeat', forfeit_seat,
      'winnerIndex', winner_seat
    )
  )
  WHERE match_id = p_match_id;

  UPDATE public.matches
  SET
    status = 'finished',
    finished_at = COALESCE(finished_at, now()),
    finish_reason = COALESCE(finish_reason, 'forfeit')
  WHERE id = p_match_id
    AND status IN ('ready', 'playing');

  PERFORM public.settle_match_global_rp(p_match_id);
  PERFORM public._leopips_settle_finished_match(p_match_id);

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'matchId', p_match_id,
    'status', 'finished',
    'winnerSeat', winner_seat,
    'forfeitSeat', forfeit_seat
  );
END;
$$;

COMMENT ON FUNCTION public._forfeit_match_player(uuid, uuid) IS
  'Locks game_sessions then matches. Publishes match_over before matches.finished. Settles Global RP and LeoPips pot on a real forfeit. Idempotent on already-finished.';

-- Both-stale / infrastructure abort: no winner, no RP, refund if debit exists.
CREATE OR REPLACE FUNCTION public._abort_stale_match(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  match_row public.matches%ROWTYPE;
  updated integer;
BEGIN
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'match id required' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.game_sessions
  WHERE match_id = p_match_id
  FOR UPDATE;

  SELECT * INTO match_row
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF match_row.status NOT IN ('ready', 'playing') THEN
    IF match_row.status = 'aborted' THEN
      PERFORM public._leopips_settle_finished_match(p_match_id);
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'matchId', match_row.id,
      'status', match_row.status
    );
  END IF;

  UPDATE public.matches
  SET status = 'aborted'
  WHERE id = p_match_id
    AND status IN ('ready', 'playing');
  GET DIAGNOSTICS updated = ROW_COUNT;

  UPDATE public.game_sessions
  SET
    status = 'match_over',
    phase = 'matchOver',
    match_winner_seat = NULL,
    version = version + 1,
    round_result = jsonb_build_object('reason', 'abandoned'),
    updated_at = now()
  WHERE match_id = p_match_id;

  UPDATE public.game_secrets
  SET engine_state = jsonb_set(
    jsonb_set(
      jsonb_set(
        COALESCE(engine_state, '{}'::jsonb),
        '{phase}',
        '"matchOver"'
      ),
      '{matchWinner}',
      'null'::jsonb
    ),
    '{roundResult}',
    jsonb_build_object('reason', 'abandoned')
  )
  WHERE match_id = p_match_id;

  PERFORM public._leopips_settle_finished_match(p_match_id);

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', updated = 0,
    'matchId', p_match_id,
    'status', 'aborted'
  );
END;
$$;

COMMENT ON FUNCTION public._abort_stale_match(uuid) IS
  'Locks game_sessions then matches. Shared-disconnect abort: no winner, no RP. Refunds LeoPips debit if present.';

-- Join-timeout abort: no winner. Trigger still refunds join_timeout; this
-- call is idempotent and covers a debit that never started play.
CREATE OR REPLACE FUNCTION public._abort_join_timeout_match(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  match_row public.matches%ROWTYPE;
  updated integer;
BEGIN
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'match id required' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.game_sessions
  WHERE match_id = p_match_id
  FOR UPDATE;

  SELECT * INTO match_row
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF match_row.status NOT IN ('ready', 'playing') THEN
    IF match_row.status = 'aborted' THEN
      PERFORM public._leopips_settle_finished_match(p_match_id);
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'matchId', match_row.id,
      'status', match_row.status,
      'finishReason', match_row.finish_reason
    );
  END IF;

  UPDATE public.matches
  SET
    status = 'aborted',
    finish_reason = COALESCE(finish_reason, 'join_timeout')
  WHERE id = p_match_id
    AND status IN ('ready', 'playing');
  GET DIAGNOSTICS updated = ROW_COUNT;

  UPDATE public.game_sessions
  SET
    status = 'match_over',
    phase = 'matchOver',
    match_winner_seat = NULL,
    version = version + 1,
    round_result = jsonb_build_object('reason', 'join_timeout'),
    updated_at = now()
  WHERE match_id = p_match_id;

  UPDATE public.game_secrets
  SET engine_state = jsonb_set(
    jsonb_set(
      jsonb_set(
        COALESCE(engine_state, '{}'::jsonb),
        '{phase}',
        '"matchOver"'
      ),
      '{matchWinner}',
      'null'::jsonb
    ),
    '{roundResult}',
    jsonb_build_object('reason', 'join_timeout')
  )
  WHERE match_id = p_match_id;

  PERFORM public._leopips_settle_finished_match(p_match_id);

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', updated = 0,
    'matchId', p_match_id,
    'status', 'aborted',
    'finishReason', 'join_timeout',
    'winner', NULL,
    'loser', NULL,
    'rpChange', false
  );
END;
$$;

COMMENT ON FUNCTION public._abort_join_timeout_match(uuid) IS
  'Locks game_sessions then matches. Join-timeout abort: no winner, no RP. Refunds LeoPips debit if present.';

COMMIT;
