-- WITHHELD — DO NOT MOVE THIS FILE INTO supabase/migrations/.
-- Ordinary `supabase db push` must never execute this body.
-- Do NOT apply to hosted Supabase. Do not deploy Edge. Do not deploy testers.
-- Do NOT run migration repair. Do NOT touch 20260903120000.
-- Do NOT apply 20260903140000 from this step.
--
-- Local review only: LeoPips settlement hardening (dormant).
--   1. Tombstone / deleted-profile rejection in the single writer `_leopips_apply`.
--   2. Server-authoritative two-player debit from stored match/request stake_pips.
--
-- PRECONDITIONS (not satisfied today — do not apply yet):
--   - 20260903120000 wallet foundation is already applied.
--   - Stage-1 20260903140000 must already exist on hosted so
--     public.matches.stake_pips and public.match_requests.stake_pips exist.
--   - This file references those columns. Applying it before Stage-1 fails CREATE.
--
-- This transaction does NOT:
--   - ALTER match_requests or matches
--   - replace accept_match_request
--   - debit, pay out, timeout, or credit referrals from gameplay
--   - grant +1000
--   - wire Find Match / testers / preview
--
-- Dormant: nothing calls `_leopips_debit_both_stored_match_stakes`.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tombstone protection on the single LeoPips writer.
--    Must run before _leopips_ensure_wallet, ledger INSERT, or balance UPDATE.
--    Living-account initial_grant / settlement path is otherwise unchanged.
-- ---------------------------------------------------------------------------

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
  IF next_balance < 0 THEN
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
  'Internal LeoPips writer. Rejects missing or tombstoned profiles before any wallet/ledger mutation. Not granted to authenticated or service_role.';

REVOKE ALL ON FUNCTION public._leopips_apply(uuid, integer, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Server-authoritative two-player debit.
--    Caller supplies only p_match_id. Stake comes from stored stake_pips.
--    DORMANT. Not wired into accept_match_request.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._leopips_debit_both_stored_match_stakes(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  match_player_a uuid;
  match_player_b uuid;
  match_request_id uuid;
  stake integer;
BEGIN
  PERFORM public.require_service_role();

  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'match required' USING ERRCODE = '22023';
  END IF;

  SELECT m.player_a, m.player_b, m.request_id, m.stake_pips
  INTO match_player_a, match_player_b, match_request_id, stake
  FROM public.matches m
  WHERE m.id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match not found' USING ERRCODE = 'P0002';
  END IF;

  IF stake IS NULL AND match_request_id IS NOT NULL THEN
    SELECT r.stake_pips
    INTO stake
    FROM public.match_requests r
    WHERE r.id = match_request_id
    FOR UPDATE;
  END IF;

  IF stake IS NULL OR NOT public._leopips_is_allowed_stake(stake) THEN
    RAISE EXCEPTION 'INVALID_LEOPIPS_STAKE' USING ERRCODE = '22023';
  END IF;
  IF match_player_a IS NULL OR match_player_b IS NULL THEN
    RAISE EXCEPTION 'match seats required' USING ERRCODE = '22023';
  END IF;
  IF match_player_a = match_player_b THEN
    RAISE EXCEPTION 'players must be distinct' USING ERRCODE = '22023';
  END IF;

  IF (
    SELECT count(*)
    FROM public.profiles p
    WHERE p.id IN (match_player_a, match_player_b)
  ) <> 2 THEN
    RAISE EXCEPTION 'player not found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id IN (match_player_a, match_player_b)
      AND p.deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETED' USING ERRCODE = 'P0001';
  END IF;

  RETURN public._leopips_debit_both_match_stakes(
    p_match_id,
    match_player_a,
    match_player_b,
    stake
  );
END;
$$;

COMMENT ON FUNCTION public._leopips_debit_both_stored_match_stakes(uuid) IS
  'DORMANT. Debits both seats using matches.stake_pips (else request.stake_pips). No caller amount. UUID wallet lock order inside the existing wrapper. Not wired into accept_match_request. Requires Stage-1 stake_pips columns.';

REVOKE ALL ON FUNCTION public._leopips_debit_both_stored_match_stakes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._leopips_debit_both_stored_match_stakes(uuid) TO service_role;

-- Close the p_stake service_role backdoor. Internal DEFINER callers still work.
REVOKE ALL ON FUNCTION public._leopips_debit_both_match_stakes(uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
