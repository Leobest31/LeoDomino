-- WITHHELD — DO NOT MOVE THIS FILE INTO supabase/migrations/.
-- Ordinary `supabase db push` must never execute this body.
-- Do NOT apply to hosted Supabase. Do not deploy Edge. Do not deploy testers.
-- Do NOT run migration repair. Do NOT touch 1200 / 1400 / 1500 bodies.
--
-- Local activation architecture (dormant until explicitly applied):
--   Debit at playing start via a service_role wrapper around install_online_game.
--   Authoritative loss (completed / forfeit / abandon / third timeout) pays pot 2S.
--   Timeout -5 on strikes 1 and 2 only; may make the wallet negative.
--   Stake debit never uses the negative-balance exception.
--   Pre-start / infrastructure abort refunds if a debit happened and there is no winner.
--   Referral +100 after 3 public completed online matches. Friends do not count.
--
-- Does NOT:
--   replace accept_match_request
--   ALTER match_requests / matches
--   drop RP objects
--   grant authenticated any wallet writer

BEGIN;

-- Timeout penalties may store a negative balance. Other writers still refuse it.
ALTER TABLE public.player_leopips_wallets
  DROP CONSTRAINT IF EXISTS player_leopips_wallets_balance_check;
ALTER TABLE public.leopips_ledger
  DROP CONSTRAINT IF EXISTS leopips_ledger_balance_after_check;

COMMENT ON COLUMN public.player_leopips_wallets.balance IS
  'Available LeoPips. Negative only from authoritative timeout_penalty rows. Stake debit cannot go negative.';
COMMENT ON COLUMN public.leopips_ledger.balance_after IS
  'Balance after this row. Negative permitted only when reason = timeout_penalty.';

CREATE OR REPLACE FUNCTION public._leopips_apply(
  p_player uuid,
  p_amount integer,
  p_reason text,
  p_idempotency_key text,
  p_match_id uuid DEFAULT NULL,
  p_referral_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  wallet public.player_leopips_wallets%ROWTYPE;
  existing public.leopips_ledger%ROWTYPE;
  next_balance integer;
  inserted_id uuid;
  profile_deleted_at timestamptz;
  allow_negative boolean;
BEGIN
  IF p_player IS NULL THEN
    RAISE EXCEPTION 'player id required' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'amount must be a non-zero signed integer' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency key required' USING ERRCODE = '22023';
  END IF;

  SELECT p.deleted_at
  INTO profile_deleted_at
  FROM public.profiles p
  WHERE p.id = p_player;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'player not found' USING ERRCODE = 'P0002';
  END IF;
  IF profile_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'ACCOUNT_DELETED' USING ERRCODE = 'P0001';
  END IF;

  allow_negative := (p_reason = 'timeout_penalty' AND p_amount = -5);
  IF p_reason = 'timeout_penalty' AND p_amount IS DISTINCT FROM -5 THEN
    RAISE EXCEPTION 'timeout penalty amount must be -5' USING ERRCODE = '22023';
  END IF;

  PERFORM public._leopips_ensure_wallet(p_player);

  SELECT *
  INTO wallet
  FROM public.player_leopips_wallets
  WHERE player_id = p_player
  FOR UPDATE;

  SELECT *
  INTO existing
  FROM public.leopips_ledger
  WHERE player_id = p_player
    AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'applied', false,
      'duplicate', true,
      'balance', existing.balance_after,
      'amount', existing.amount,
      'reason', existing.reason,
      'idempotency_key', existing.idempotency_key
    );
  END IF;

  next_balance := wallet.balance + p_amount;
  IF next_balance < 0 AND allow_negative IS NOT TRUE THEN
    RAISE EXCEPTION 'INSUFFICIENT_LEOPIPS' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.leopips_ledger (
    player_id,
    amount,
    reason,
    match_id,
    referral_id,
    balance_after,
    idempotency_key
  )
  VALUES (
    p_player,
    p_amount,
    p_reason,
    p_match_id,
    p_referral_id,
    next_balance,
    p_idempotency_key
  )
  ON CONFLICT (player_id, idempotency_key) DO NOTHING
  RETURNING id INTO inserted_id;

  IF inserted_id IS NULL THEN
    SELECT *
    INTO existing
    FROM public.leopips_ledger
    WHERE player_id = p_player
      AND idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object(
      'applied', false,
      'duplicate', true,
      'balance', existing.balance_after,
      'amount', existing.amount,
      'reason', existing.reason,
      'idempotency_key', existing.idempotency_key
    );
  END IF;

  UPDATE public.player_leopips_wallets
  SET balance = next_balance
  WHERE player_id = p_player;

  RETURN jsonb_build_object(
    'applied', true,
    'duplicate', false,
    'balance', next_balance,
    'amount', p_amount,
    'reason', p_reason,
    'idempotency_key', p_idempotency_key
  );
END;
$$;

COMMENT ON FUNCTION public._leopips_apply(uuid, integer, text, text, uuid, uuid) IS
  'Internal LeoPips writer. Negative balances only for timeout_penalty -5. Stake debit still refuses INSUFFICIENT_LEOPIPS. Tombstone-safe.';

REVOKE ALL ON FUNCTION public._leopips_apply(uuid, integer, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A. Playing-start debit. Friend / NULL stake is a no-op.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._leopips_on_playing_start(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stake integer;
BEGIN
  PERFORM public.require_service_role();
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

  RETURN public._leopips_debit_both_stored_match_stakes(p_match_id);
END;
$$;

COMMENT ON FUNCTION public._leopips_on_playing_start(uuid) IS
  'Service-role only. Debits stored stake at genuine playing start. Friend/NULL stake skipped. Idempotent via match_stake keys.';

REVOKE ALL ON FUNCTION public._leopips_on_playing_start(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._leopips_on_playing_start(uuid) TO service_role;

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
  'Service-role wrapper. Debit and install share one transaction. Missing wrapper must fall back to install_online_game.';

REVOKE ALL ON FUNCTION public._leopips_install_online_game(uuid, text, jsonb, jsonb, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._leopips_install_online_game(uuid, text, jsonb, jsonb, bigint) TO service_role;

-- ---------------------------------------------------------------------------
-- B. Pre-start refund. Only join_timeout after a debit that never started play.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._leopips_refund_both_match_stakes(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  match_row public.matches%ROWTYPE;
  has_session boolean;
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
  IF match_row.finish_reason IS DISTINCT FROM 'join_timeout'
     AND match_row.finish_reason IS DISTINCT FROM 'abandoned' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_prestart_abort');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.game_sessions s WHERE s.match_id = p_match_id
  )
  INTO has_session;
  IF has_session AND match_row.finish_reason IS DISTINCT FROM 'join_timeout'
     AND match_row.finish_reason IS DISTINCT FROM 'abandoned' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'gameplay_started');
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

REVOKE ALL ON FUNCTION public._leopips_refund_both_match_stakes(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._leopips_on_prestart_abort(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public._leopips_refund_both_match_stakes(p_match_id);
END;
$$;

REVOKE ALL ON FUNCTION public._leopips_on_prestart_abort(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.matches_leopips_prestart_abort()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'aborted'
     AND OLD.status IS DISTINCT FROM 'aborted'
     AND NEW.finish_reason IN ('join_timeout', 'abandoned') THEN
    PERFORM public._leopips_on_prestart_abort(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matches_leopips_prestart_abort ON public.matches;
CREATE TRIGGER matches_leopips_prestart_abort
  AFTER UPDATE OF status ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.matches_leopips_prestart_abort();

REVOKE ALL ON FUNCTION public.matches_leopips_prestart_abort() FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- C. Timeout penalty. Strike 3 never debits. Balance may go negative.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._leopips_on_timeout_strike(
  p_match_id uuid,
  p_player uuid,
  p_strike integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stake integer;
BEGIN
  PERFORM public.require_service_role();
  IF p_strike IS DISTINCT FROM 1 AND p_strike IS DISTINCT FROM 2 THEN
    RETURN jsonb_build_object('applied', false, 'skipped', true, 'reason', 'no_third_penalty', 'strike', p_strike);
  END IF;

  SELECT m.stake_pips INTO stake
  FROM public.matches m
  WHERE m.id = p_match_id;
  IF stake IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'skipped', true, 'reason', 'friend_or_unstaked');
  END IF;

  RETURN public._leopips_timeout_penalty(p_player, p_match_id, p_strike);
END;
$$;

COMMENT ON FUNCTION public._leopips_on_timeout_strike(uuid, uuid, integer) IS
  'Service-role. Strike 1/2 only. Never writes timeout_penalty:{match}:3. Applies even when balance < 5.';

REVOKE ALL ON FUNCTION public._leopips_on_timeout_strike(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._leopips_on_timeout_strike(uuid, uuid, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- E. Referral +100 after 3 qualifying public completed online matches.
--    Defined before payout hook so _leopips_on_match_finished can call it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._leopips_count_qualifying_referral_matches(
  p_referred uuid,
  p_attributed_at timestamptz
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT count(*)::integer
    FROM public.matches m
    WHERE m.status = 'finished'
      AND m.finish_reason = 'completed'
      AND COALESCE(m.match_kind, 'public') = 'public'
      AND m.finished_at IS NOT NULL
      AND m.finished_at >= p_attributed_at
      AND (m.player_a = p_referred OR m.player_b = p_referred)
  );
END;
$$;

REVOKE ALL ON FUNCTION public._leopips_count_qualifying_referral_matches(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._leopips_credit_referral_reward(p_referral_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.referrals%ROWTYPE;
  qualified_count integer;
BEGIN
  PERFORM public.require_service_role();

  SELECT * INTO row
  FROM public.referrals
  WHERE id = p_referral_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'referral not found' USING ERRCODE = 'P0002';
  END IF;
  IF row.status = 'rejected' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'rejected');
  END IF;

  qualified_count := public._leopips_count_qualifying_referral_matches(row.referred_id, row.attributed_at);
  IF qualified_count < 3 THEN
    RETURN jsonb_build_object(
      'applied', false,
      'reason', 'below_qualifying_threshold',
      'qualified_count', qualified_count,
      'required', 3
    );
  END IF;

  RETURN public._leopips_apply(
    row.referrer_id,
    100,
    'referral_reward',
    'referral_reward:' || p_referral_id::text,
    NULL,
    p_referral_id
  );
END;
$$;

COMMENT ON FUNCTION public._leopips_credit_referral_reward(uuid) IS
  'DORMANT until hooked. +100 once per referral_id after 3 public completed online matches. Independent of cash Invite & Win.';

REVOKE ALL ON FUNCTION public._leopips_credit_referral_reward(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._leopips_credit_referral_reward(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._leopips_try_credit_referral_after_match(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  match_row public.matches%ROWTYPE;
  rec record;
  results jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO match_row FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('applied', false);
  END IF;
  IF match_row.finish_reason IS DISTINCT FROM 'completed' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_completed');
  END IF;

  FOR rec IN
    SELECT r.id
    FROM public.referrals r
    WHERE r.status IS DISTINCT FROM 'rejected'
      AND r.referred_id IN (match_row.player_a, match_row.player_b)
  LOOP
    results := results || jsonb_build_array(public._leopips_credit_referral_reward(rec.id));
  END LOOP;

  RETURN jsonb_build_object('applied', true, 'results', results);
END;
$$;

REVOKE ALL ON FUNCTION public._leopips_try_credit_referral_after_match(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._leopips_try_credit_referral_after_match(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- D. Authoritative pot: completed / forfeit / abandon / third-timeout loss.
-- ---------------------------------------------------------------------------

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
  PERFORM public.require_service_role();

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
  'Server-computed pot 2S. Outcomes: normal_win / forfeit_win / timeout_win / abandon_win. No client amount.';

REVOKE ALL ON FUNCTION public._leopips_credit_match_payout(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._leopips_credit_match_payout(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public._leopips_on_match_finished(p_match_id uuid)
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
  PERFORM public.require_service_role();

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

COMMENT ON FUNCTION public._leopips_on_match_finished(uuid) IS
  'Service-role. Pays 2S after stored debit for completed/forfeit/abandon/timeout loss. Pre-start/no-winner abort refunds.';

REVOKE ALL ON FUNCTION public._leopips_on_match_finished(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._leopips_on_match_finished(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._leopips_commit_online_game_transition(
  p_match_id uuid,
  p_expected_version integer,
  p_actor uuid,
  p_seat integer,
  p_action_type text,
  p_payload jsonb,
  p_public jsonb,
  p_engine_state jsonb,
  p_match_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  strikes jsonb;
  strike integer;
  timed_out uuid;
  match_row public.matches%ROWTYPE;
BEGIN
  PERFORM public.require_service_role();
  result := public.commit_online_game_transition(
    p_match_id,
    p_expected_version,
    p_actor,
    p_seat,
    p_action_type,
    p_payload,
    p_public,
    p_engine_state,
    p_match_status
  );
  IF COALESCE((result->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN result;
  END IF;

  IF p_action_type = 'timeout' THEN
    strikes := COALESCE(result->'timeoutStrikes', p_public->'timeoutStrikes', '[0,0]'::jsonb);
    strike := COALESCE((strikes ->> p_seat)::integer, 0);
    SELECT * INTO match_row FROM public.matches WHERE id = p_match_id;
    timed_out := CASE p_seat
      WHEN 0 THEN match_row.player_a
      WHEN 1 THEN match_row.player_b
      ELSE NULL
    END;
    IF timed_out IS NOT NULL THEN
      PERFORM public._leopips_on_timeout_strike(p_match_id, timed_out, strike);
    END IF;
  END IF;

  IF p_match_status = 'finished' THEN
    PERFORM public._leopips_on_match_finished(p_match_id);
  END IF;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public._leopips_commit_online_game_transition(uuid, integer, uuid, integer, text, jsonb, jsonb, jsonb, text) IS
  'Service-role wrapper around existing commit. Timeout/payout hooks run only after ok=true. Missing wrapper must fall back.';

REVOKE ALL ON FUNCTION public._leopips_commit_online_game_transition(uuid, integer, uuid, integer, text, jsonb, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._leopips_commit_online_game_transition(uuid, integer, uuid, integer, text, jsonb, jsonb, jsonb, text)
  TO service_role;

COMMIT;
