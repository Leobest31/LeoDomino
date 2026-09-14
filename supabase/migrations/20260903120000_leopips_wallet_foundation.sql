-- WITHHELD — DO NOT MOVE THIS FILE INTO supabase/migrations/.
-- Ordinary `supabase db push` must never execute this body.
-- Do NOT apply to hosted Supabase. Do not deploy Edge. Do not grant 1,000 yet.
--
-- Local review only: LeoPips wallet + immutable ledger foundation.
-- Dormant: no matchmaking, no payout, no timeout debit, no referral credit hook.
-- Does not DROP or ALTER Global RP tables/data.
-- Does not rewrite Invite & Win (_evaluate_referral stays 10-match cash validation).
-- Does not create XP / Level tables.
--
-- After a future hosted apply, backfill existing eligible profiles with:
--   SELECT public.reconcile_leopips_initial_grants(200);
-- Repeat until n = 0. Do not grant inside this migration transaction.

BEGIN;

-- ---------------------------------------------------------------------------
-- Constants (enforced in helpers)
--   Initial grant: 1000
--   Allowed stakes: 20, 50, 100, 150
--   Find Match floor: 20
--   Timeout penalty: -5 on strikes 1 and 2 only
--   Referral LeoPips (future, dormant): +100 once per referral_id
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Wallet
-- ---------------------------------------------------------------------------

CREATE TABLE public.player_leopips_wallets (
  player_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.player_leopips_wallets IS
  'Server-authoritative LeoPips balance. Clients never INSERT/UPDATE. Floor 0.';

COMMENT ON COLUMN public.player_leopips_wallets.balance IS
  'Available LeoPips. Never negative. Not derived from XP or Global RP.';

CREATE TRIGGER player_leopips_wallets_set_updated_at
  BEFORE UPDATE ON public.player_leopips_wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Immutable ledger
-- ---------------------------------------------------------------------------

CREATE TABLE public.leopips_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount <> 0),
  reason text NOT NULL CHECK (reason IN (
    'initial_grant',
    'match_stake',
    'match_payout',
    'timeout_penalty',
    'referral_reward',
    'admin_adjustment',
    'correction'
  )),
  match_id uuid REFERENCES public.matches(id) ON DELETE RESTRICT,
  referral_id uuid REFERENCES public.referrals(id) ON DELETE RESTRICT,
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leopips_ledger_player_idempotency UNIQUE (player_id, idempotency_key),
  CONSTRAINT leopips_ledger_initial_grant_shape CHECK (
    reason <> 'initial_grant'
    OR (amount = 1000 AND match_id IS NULL AND referral_id IS NULL)
  ),
  CONSTRAINT leopips_ledger_referral_shape CHECK (
    reason <> 'referral_reward'
    OR (amount = 100 AND referral_id IS NOT NULL AND match_id IS NULL)
  ),
  CONSTRAINT leopips_ledger_match_shape CHECK (
    reason NOT IN ('match_stake', 'match_payout', 'timeout_penalty')
    OR match_id IS NOT NULL
  ),
  CONSTRAINT leopips_ledger_stake_shape CHECK (
    reason <> 'match_stake'
    OR (amount IN (-20, -50, -100, -150))
  ),
  CONSTRAINT leopips_ledger_timeout_shape CHECK (
    reason <> 'timeout_penalty'
    OR amount = -5
  )
);

COMMENT ON TABLE public.leopips_ledger IS
  'Immutable LeoPips transaction log. SECURITY DEFINER writers only. Unique (player_id, idempotency_key).';

COMMENT ON COLUMN public.leopips_ledger.amount IS
  'Signed delta. Credits positive, debits negative. Never 0.';

COMMENT ON COLUMN public.leopips_ledger.idempotency_key IS
  'Caller-supplied unique event id per player. Retries reuse the same key and must not double-apply.';

COMMENT ON COLUMN public.leopips_ledger.balance_after IS
  'Wallet balance immediately after this row. Audit trail; not a second source of truth.';

CREATE UNIQUE INDEX leopips_ledger_initial_grant_once
  ON public.leopips_ledger (player_id)
  WHERE reason = 'initial_grant';

CREATE UNIQUE INDEX leopips_ledger_referral_reward_once
  ON public.leopips_ledger (referral_id)
  WHERE reason = 'referral_reward' AND referral_id IS NOT NULL;

CREATE UNIQUE INDEX leopips_ledger_match_stake_once
  ON public.leopips_ledger (player_id, match_id)
  WHERE reason = 'match_stake' AND match_id IS NOT NULL;

CREATE UNIQUE INDEX leopips_ledger_match_payout_once
  ON public.leopips_ledger (player_id, match_id)
  WHERE reason = 'match_payout' AND match_id IS NOT NULL;

CREATE INDEX leopips_ledger_player_created_idx
  ON public.leopips_ledger (player_id, created_at DESC);

CREATE INDEX leopips_ledger_match_idx
  ON public.leopips_ledger (match_id)
  WHERE match_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.leopips_ledger_protect_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'leopips_ledger is immutable' USING ERRCODE = '22023';
END;
$$;

DROP TRIGGER IF EXISTS leopips_ledger_protect_immutable ON public.leopips_ledger;
CREATE TRIGGER leopips_ledger_protect_immutable
  BEFORE UPDATE OR DELETE ON public.leopips_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.leopips_ledger_protect_immutable();

REVOKE ALL ON FUNCTION public.leopips_ledger_protect_immutable() FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._leopips_is_allowed_stake(p_stake integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT p_stake IN (20, 50, 100, 150);
$$;

REVOKE ALL ON FUNCTION public._leopips_is_allowed_stake(integer) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._leopips_ensure_wallet(p_player uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.player_leopips_wallets (player_id)
  VALUES (p_player)
  ON CONFLICT (player_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public._leopips_ensure_wallet(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Single writer. Locks wallet FOR UPDATE. Idempotent on (player_id, idempotency_key).
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
  'Internal LeoPips writer. Not granted to authenticated or service_role. Nested DEFINER callers only.';

REVOKE ALL ON FUNCTION public._leopips_apply(uuid, integer, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._leopips_ensure_initial_grant(p_player uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public._leopips_apply(
    p_player,
    1000,
    'initial_grant',
    'initial_grant',
    NULL,
    NULL
  );
END;
$$;

COMMENT ON FUNCTION public._leopips_ensure_initial_grant(uuid) IS
  'Idempotent +1000. Unique initial_grant per player. Safe to run twice.';

REVOKE ALL ON FUNCTION public._leopips_ensure_initial_grant(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.profiles_insert_leopips_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._leopips_ensure_initial_grant(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_insert_leopips_wallet ON public.profiles;
CREATE TRIGGER profiles_insert_leopips_wallet
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_insert_leopips_wallet();

REVOKE ALL ON FUNCTION public.profiles_insert_leopips_wallet() FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Bounded reconciliation (NOT run by this migration)
-- Eligible = profiles.deleted_at IS NULL (hosted tombstone from account deletion).
-- Each RPC holds FOR UPDATE only on the current batch, then returns.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reconcile_leopips_initial_grants(p_limit integer DEFAULT 200)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  result jsonb;
  applied integer := 0;
  batch_size integer := COALESCE(p_limit, 200);
BEGIN
  PERFORM public.require_service_role();

  IF batch_size < 1 OR batch_size > 500 THEN
    RAISE EXCEPTION 'batch limit must be between 1 and 500' USING ERRCODE = '22023';
  END IF;

  FOR rec IN
    SELECT p.id
    FROM public.profiles p
    WHERE p.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.leopips_ledger l
        WHERE l.player_id = p.id
          AND l.reason = 'initial_grant'
      )
    ORDER BY p.id
    LIMIT batch_size
  LOOP
    result := public._leopips_ensure_initial_grant(rec.id);
    IF (result->>'applied')::boolean IS TRUE THEN
      applied := applied + 1;
    END IF;
  END LOOP;

  RETURN applied;
END;
$$;

COMMENT ON FUNCTION public.reconcile_leopips_initial_grants(integer) IS
  'DORMANT until hosted apply. Grants +1000 to up to p_limit living profiles missing initial_grant. Idempotent. service_role only.';

REVOKE ALL ON FUNCTION public.reconcile_leopips_initial_grants(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_leopips_initial_grants(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Read RPC (only authenticated client surface)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_leopips_wallet()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  wallet public.player_leopips_wallets%ROWTYPE;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles WHERE id = caller AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETED' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public._leopips_ensure_initial_grant(caller);

  SELECT * INTO wallet
  FROM public.player_leopips_wallets
  WHERE player_id = caller;

  RETURN jsonb_build_object(
    'balance', wallet.balance,
    'can_enter_find_match', wallet.balance >= 20,
    'min_find_match_stake', 20,
    'allowed_stakes', jsonb_build_array(20, 50, 100, 150)
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_leopips_wallet() IS
  'Signed-in player LeoPips. Ensures the one-time 1000 grant. Does not accept a client balance.';

REVOKE ALL ON FUNCTION public.get_my_leopips_wallet() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_leopips_wallet() TO authenticated;

-- ---------------------------------------------------------------------------
-- DORMANT: future stake / timeout / payout / referral writers.
-- Not called from accept_match_request, commit, or _evaluate_referral.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._leopips_assert_can_enter_find_match(p_player uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  wallet public.player_leopips_wallets%ROWTYPE;
BEGIN
  PERFORM public._leopips_ensure_initial_grant(p_player);

  SELECT *
  INTO wallet
  FROM public.player_leopips_wallets
  WHERE player_id = p_player
  FOR UPDATE;

  IF wallet.balance < 20 THEN
    RAISE EXCEPTION 'INSUFFICIENT_LEOPIPS' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

COMMENT ON FUNCTION public._leopips_assert_can_enter_find_match(uuid) IS
  'DORMANT. Later LeoPips Find Match entry. Does not debit. Not wired into accept_match_request.';

REVOKE ALL ON FUNCTION public._leopips_assert_can_enter_find_match(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._leopips_debit_match_stake(
  p_player uuid,
  p_match_id uuid,
  p_stake integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._leopips_is_allowed_stake(p_stake) THEN
    RAISE EXCEPTION 'INVALID_LEOPIPS_STAKE' USING ERRCODE = '22023';
  END IF;
  RETURN public._leopips_apply(
    p_player,
    -p_stake,
    'match_stake',
    'match_stake:' || p_match_id::text,
    p_match_id,
    NULL
  );
END;
$$;

COMMENT ON FUNCTION public._leopips_debit_match_stake(uuid, uuid, integer) IS
  'DORMANT internal one-player debit. Called only by the two-player wrapper.';

REVOKE ALL ON FUNCTION public._leopips_debit_match_stake(uuid, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;

-- Locks both wallets in UUID order, then debits both or neither.
CREATE OR REPLACE FUNCTION public._leopips_debit_both_match_stakes(
  p_match_id uuid,
  p_player_a uuid,
  p_player_b uuid,
  p_stake integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  first_id uuid;
  second_id uuid;
  first_wallet public.player_leopips_wallets%ROWTYPE;
  second_wallet public.player_leopips_wallets%ROWTYPE;
  first_staked boolean;
  second_staked boolean;
  first_result jsonb;
  second_result jsonb;
  result_a jsonb;
  result_b jsonb;
BEGIN
  PERFORM public.require_service_role();

  IF p_match_id IS NULL OR p_player_a IS NULL OR p_player_b IS NULL THEN
    RAISE EXCEPTION 'match and both players required' USING ERRCODE = '22023';
  END IF;
  IF p_player_a = p_player_b THEN
    RAISE EXCEPTION 'players must be distinct' USING ERRCODE = '22023';
  END IF;
  IF NOT public._leopips_is_allowed_stake(p_stake) THEN
    RAISE EXCEPTION 'INVALID_LEOPIPS_STAKE' USING ERRCODE = '22023';
  END IF;

  IF p_player_a < p_player_b THEN
    first_id := p_player_a;
    second_id := p_player_b;
  ELSE
    first_id := p_player_b;
    second_id := p_player_a;
  END IF;

  PERFORM public._leopips_ensure_wallet(first_id);
  PERFORM public._leopips_ensure_wallet(second_id);

  SELECT *
  INTO first_wallet
  FROM public.player_leopips_wallets
  WHERE player_id = first_id
  FOR UPDATE;

  SELECT *
  INTO second_wallet
  FROM public.player_leopips_wallets
  WHERE player_id = second_id
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1
    FROM public.leopips_ledger
    WHERE player_id = first_id
      AND match_id = p_match_id
      AND reason = 'match_stake'
  )
  INTO first_staked;

  SELECT EXISTS (
    SELECT 1
    FROM public.leopips_ledger
    WHERE player_id = second_id
      AND match_id = p_match_id
      AND reason = 'match_stake'
  )
  INTO second_staked;

  IF (first_staked IS NOT TRUE AND first_wallet.balance < p_stake)
     OR (second_staked IS NOT TRUE AND second_wallet.balance < p_stake) THEN
    RAISE EXCEPTION 'INSUFFICIENT_LEOPIPS' USING ERRCODE = 'P0001';
  END IF;

  first_result := public._leopips_debit_match_stake(first_id, p_match_id, p_stake);
  second_result := public._leopips_debit_match_stake(second_id, p_match_id, p_stake);

  IF first_id = p_player_a THEN
    result_a := first_result;
    result_b := second_result;
  ELSE
    result_a := second_result;
    result_b := first_result;
  END IF;

  RETURN jsonb_build_object(
    'applied',
      COALESCE((first_result->>'applied')::boolean, false)
      OR COALESCE((second_result->>'applied')::boolean, false),
    'player_a', result_a,
    'player_b', result_b
  );
END;
$$;

COMMENT ON FUNCTION public._leopips_debit_both_match_stakes(uuid, uuid, uuid, integer) IS
  'DORMANT. Atomic two-player stake. UUID lock order. Insufficient => neither debit. Retry is idempotent. Not wired into accept_match_request.';

REVOKE ALL ON FUNCTION public._leopips_debit_both_match_stakes(uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._leopips_debit_both_match_stakes(uuid, uuid, uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public._leopips_timeout_penalty(
  p_player uuid,
  p_match_id uuid,
  p_strike integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_service_role();

  IF p_player IS NULL OR p_match_id IS NULL THEN
    RAISE EXCEPTION 'player and match required' USING ERRCODE = '22023';
  END IF;
  IF p_strike IS DISTINCT FROM 1 AND p_strike IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'timeout penalty only on strike 1 or 2' USING ERRCODE = '22023';
  END IF;

  RETURN public._leopips_apply(
    p_player,
    -5,
    'timeout_penalty',
    'timeout_penalty:' || p_match_id::text || ':' || p_strike::text,
    p_match_id,
    NULL
  );
END;
$$;

COMMENT ON FUNCTION public._leopips_timeout_penalty(uuid, uuid, integer) IS
  'DORMANT. Strike 1 or 2 only, server-side -5. Strike 3 is match loss with no third debit. Not activated.';

REVOKE ALL ON FUNCTION public._leopips_timeout_penalty(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._leopips_timeout_penalty(uuid, uuid, integer) TO service_role;

-- Server-computed payout. Does not take a client amount.
-- normal_win: both already staked S; winner receives pot 2S.
-- abandon_opponent: not finalized (house-retention rule stays product-owned).
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
  IF p_outcome IS DISTINCT FROM 'normal_win' THEN
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
  'DORMANT. Server-computed normal_win payout 2S from the match_stake row. No client amount. Abandon not finalized.';

REVOKE ALL ON FUNCTION public._leopips_credit_match_payout(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._leopips_credit_match_payout(uuid, uuid, text) TO service_role;

-- LeoPips +100 reads public.matches directly. Independent of Invite & Win cash qualification.
-- Cash Invite & Win (_evaluate_referral, 10-match, prize_amount_usd) is untouched.
CREATE OR REPLACE FUNCTION public._leopips_credit_referral_reward(p_referral_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.referrals%ROWTYPE;
  qualified boolean;
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

  SELECT EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.status = 'finished'
      AND m.match_kind = 'public'
      AND m.finish_reason = 'completed'
      AND m.finished_at IS NOT NULL
      AND m.finished_at >= row.attributed_at
      AND (m.player_a = row.referred_id OR m.player_b = row.referred_id)
  )
  INTO qualified;

  IF qualified IS NOT TRUE THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'no_qualifying_match');
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
  'DORMANT. +100 once per referral_id after 1 public completed match by the referred player after attribution. Independent of the cash Invite & Win pipeline. Not triggered.';

REVOKE ALL ON FUNCTION public._leopips_credit_referral_reward(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._leopips_credit_referral_reward(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- RLS: clients may read own rows only. No table writes for any client role.
-- ---------------------------------------------------------------------------

ALTER TABLE public.player_leopips_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leopips_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY player_leopips_wallets_select_own
  ON public.player_leopips_wallets
  FOR SELECT
  TO authenticated
  USING (player_id = (SELECT auth.uid()));

CREATE POLICY leopips_ledger_select_own
  ON public.leopips_ledger
  FOR SELECT
  TO authenticated
  USING (player_id = (SELECT auth.uid()));

REVOKE ALL ON TABLE public.player_leopips_wallets FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.leopips_ledger FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.player_leopips_wallets TO authenticated;
GRANT SELECT ON TABLE public.leopips_ledger TO authenticated;
GRANT SELECT ON TABLE public.player_leopips_wallets TO service_role;
GRANT SELECT ON TABLE public.leopips_ledger TO service_role;

COMMIT;
