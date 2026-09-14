-- LeoPips referral +100 evaluation independent of pot settlement.
-- Do NOT apply to hosted Supabase until explicitly approved.
-- Does not edit prior migration bodies.
-- Does not change stake tiers, pot math, matchmaking, XP/Level, or Invite & Win cash.
--
-- Root cause: `_leopips_settle_finished_match` returned early on
--   stake_pips IS NULL / missing match_stake / other pot skips
-- before calling `_leopips_try_credit_referral_after_match`.
-- Qualifying PUBLIC completed matches could reach 3/3 without a reward attempt.
--
-- Fix: evaluate referral after the match row is locked, before pot early returns.
-- Qualification remains `_leopips_count_qualifying_referral_matches` (3 public completed).
-- Idempotency remains referral_reward:{referral_id} + unique referral_id index.

BEGIN;

-- ---------------------------------------------------------------------------
-- Credit helper: drop JWT service_role gate (same pattern as match payout).
-- EXECUTE stays revoked from anon/authenticated; service_role may call for ops.
-- Owner-only settle / DEFINER chain can credit without a service_role JWT.
-- ---------------------------------------------------------------------------

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
  'Authoritative +100 once per referral_id after 3 public completed online matches. Independent of pot settlement and Invite & Win cash. Idempotent referral_reward:{id}.';

REVOKE ALL ON FUNCTION public._leopips_credit_referral_reward(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._leopips_credit_referral_reward(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Match-scoped try: require finished + completed; still no stake dependency.
-- ---------------------------------------------------------------------------

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
    RETURN jsonb_build_object('applied', false, 'reason', 'match_not_found');
  END IF;
  IF match_row.status IS DISTINCT FROM 'finished' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_finished');
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

COMMENT ON FUNCTION public._leopips_try_credit_referral_after_match(uuid) IS
  'After a finished completed match, attempt +100 for any non-rejected referral whose referred player is in the match. Safe to call when pot settlement skips. Does not award friend/private/forfeit/abandon by itself — count function gates credit.';

REVOKE ALL ON FUNCTION public._leopips_try_credit_referral_after_match(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._leopips_try_credit_referral_after_match(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Settle: referral evaluation before pot early returns.
-- Pot settlement behavior (skip / pay / refund) is unchanged aside from
-- attaching a `referral` field on JSON results.
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
  refund jsonb;
BEGIN
  SELECT * INTO match_row
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'match_not_found');
  END IF;

  -- Pot settlement and referral qualification are separate.
  -- Try referral even when this match has no stake / no match_stake ledger.
  referral := public._leopips_try_credit_referral_after_match(p_match_id);

  IF match_row.stake_pips IS NULL THEN
    RETURN jsonb_build_object(
      'applied', false,
      'skipped', true,
      'reason', 'friend_or_unstaked',
      'referral', referral
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.leopips_ledger l
    WHERE l.match_id = p_match_id AND l.reason = 'match_stake'
  ) THEN
    RETURN jsonb_build_object(
      'applied', false,
      'reason', 'stake_not_debited',
      'referral', referral
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
      RETURN COALESCE(refund, '{}'::jsonb) || jsonb_build_object('referral', referral);
    END IF;
    RETURN jsonb_build_object(
      'applied', false,
      'reason', 'winner_not_authoritative',
      'referral', referral
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
      'referral', referral
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
    'referral', referral
  );
END;
$$;

COMMENT ON FUNCTION public._leopips_settle_finished_match(uuid) IS
  'Internal. Pays pot when staked; evaluates LeoPips referral +100 independently of pot skip. Idempotent match_payout:{match} and referral_reward:{referral}.';

REVOKE ALL ON FUNCTION public._leopips_settle_finished_match(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
