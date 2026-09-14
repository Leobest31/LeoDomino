-- LeoPips terminal pot policy (owner-final).
-- Do NOT apply to hosted Supabase until explicitly approved.
-- Does NOT repair historical matches.
--
-- GENUINE COMPLETED: winner +2S; loser 0; retention 0.
-- FORFEIT / ABANDON / ABANDONED / TIMEOUT-WIN:
--   winner +1.5S; loser 0; LeoDomino retains 0.5S in leopips_match_retentions.
-- Timeout −5 penalties remain separate (timeout_penalty ledger). Not folded into pot.
-- Progression: only genuine completed may award XP/Level (handled by progression helpers).
-- No silent burn. No invented player-visible house wallet.

BEGIN;

-- ---------------------------------------------------------------------------
-- Explicit house retention audit (no player_id / no player-visible wallet).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.leopips_match_retentions (
  match_id uuid PRIMARY KEY REFERENCES public.matches(id) ON DELETE RESTRICT,
  amount integer NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (reason IN (
    'forfeit_half_stake',
    'abandon_half_stake',
    'timeout_half_stake'
  )),
  winner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  -- Loser / abandoner / timeout-loser (not a wallet credit target).
  abandoner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  stake_pips integer NOT NULL CHECK (stake_pips IN (20, 50, 100, 150)),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leopips_match_retentions_idempotency UNIQUE (idempotency_key),
  CONSTRAINT leopips_match_retentions_half_stake CHECK (amount * 2 = stake_pips)
);

COMMENT ON TABLE public.leopips_match_retentions IS
  'Authoritative LeoDomino-retained half-stake on forfeit/abandon/timeout-win. Not a player wallet. No SELECT for authenticated players.';

COMMENT ON COLUMN public.leopips_match_retentions.amount IS
  'Retained LeoPips (= 0.5S). Complements winner match_payout of 1.5S so nets identity vs the two stake debits.';

COMMENT ON COLUMN public.leopips_match_retentions.abandoner_id IS
  'Losing player (forfeit abandoner or timeout loser). Never credited by this settlement path.';

CREATE INDEX IF NOT EXISTS leopips_match_retentions_created_idx
  ON public.leopips_match_retentions (created_at DESC);

ALTER TABLE public.leopips_match_retentions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.leopips_match_retentions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.leopips_match_retentions TO service_role;

-- ---------------------------------------------------------------------------
-- Full pot (2S): genuine completed only.
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
  'Server-computed full pot 2S for normal_win (genuine completed) only. Non-completed terminals use partial settlement.';

REVOKE ALL ON FUNCTION public._leopips_credit_match_payout(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._leopips_credit_match_payout(uuid, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Forfeit / abandon / timeout-win: winner +1.5S; retain 0.5S; loser +0.
-- Timeout −5 penalties are separate ledger rows and are not touched here.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._leopips_credit_forfeit_abandon_partial(
  p_match_id uuid,
  p_winner uuid,
  p_finish_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  match_row public.matches%ROWTYPE;
  stake integer;
  credit integer;
  retained integer;
  loser uuid;
  retention_reason text;
  payout jsonb;
  retention_key text;
  inserted_match uuid;
BEGIN
  IF p_match_id IS NULL OR p_winner IS NULL THEN
    RAISE EXCEPTION 'match and winner required' USING ERRCODE = '22023';
  END IF;
  IF p_finish_reason NOT IN ('forfeit', 'abandon', 'abandoned', 'timeout') THEN
    RAISE EXCEPTION 'non-completed finish_reason required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO match_row
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'match not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_winner IS DISTINCT FROM match_row.player_a
     AND p_winner IS DISTINCT FROM match_row.player_b THEN
    RAISE EXCEPTION 'winner must be a match player' USING ERRCODE = '22023';
  END IF;

  loser := CASE
    WHEN p_winner = match_row.player_a THEN match_row.player_b
    ELSE match_row.player_a
  END;

  SELECT -l.amount
  INTO stake
  FROM public.leopips_ledger l
  WHERE l.player_id = p_winner
    AND l.match_id = p_match_id
    AND l.reason = 'match_stake';

  IF stake IS NULL THEN
    RAISE EXCEPTION 'match stake not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._leopips_is_allowed_stake(stake) THEN
    RAISE EXCEPTION 'INVALID_LEOPIPS_STAKE' USING ERRCODE = '22023';
  END IF;

  -- Allowed stakes are even: 20/50/100/150 → integer 1.5S and 0.5S.
  credit := (stake * 3) / 2;
  retained := stake / 2;
  retention_reason := CASE p_finish_reason
    WHEN 'forfeit' THEN 'forfeit_half_stake'
    WHEN 'timeout' THEN 'timeout_half_stake'
    ELSE 'abandon_half_stake'
  END;
  retention_key := 'match_retention:half_stake:' || p_match_id::text;

  -- Winner terminal credit (idempotent). Never credit loser. Never touch timeout_penalty rows.
  payout := public._leopips_apply(
    p_winner,
    credit,
    'match_payout',
    'match_payout:' || p_match_id::text,
    p_match_id,
    NULL
  );

  IF COALESCE((payout->>'amount')::integer, 0) IS DISTINCT FROM credit THEN
    RAISE EXCEPTION 'partial pot payout amount mismatch'
      USING ERRCODE = 'P0001',
            DETAIL = format('expected %s got %s', credit, payout->>'amount');
  END IF;

  INSERT INTO public.leopips_match_retentions (
    match_id,
    amount,
    reason,
    winner_id,
    abandoner_id,
    stake_pips,
    idempotency_key
  )
  VALUES (
    p_match_id,
    retained,
    retention_reason,
    p_winner,
    loser,
    stake,
    retention_key
  )
  ON CONFLICT (match_id) DO NOTHING
  RETURNING match_id INTO inserted_match;

  IF inserted_match IS NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.leopips_match_retentions r
      WHERE r.match_id = p_match_id
        AND r.amount = retained
        AND r.stake_pips = stake
        AND r.winner_id = p_winner
        AND r.abandoner_id = loser
    ) THEN
      RAISE EXCEPTION 'partial pot retention mismatch on retry' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'applied', true,
    'outcome', 'non_completed_partial',
    'finish_reason', p_finish_reason,
    'winner', p_winner,
    'loser', loser,
    'abandoner', loser,
    'stake', stake,
    'winner_credit', credit,
    'loser_credit', 0,
    'abandoner_credit', 0,
    'retained', retained,
    'payout', payout,
    'retention_key', retention_key,
    'timeout_penalties_untouched', true,
    'accounting', jsonb_build_object(
      'winner_net', credit - stake,
      'loser_net', -stake,
      'retained', retained,
      'identity', (credit - stake) + (-stake) + retained
    )
  );
END;
$$;

COMMENT ON FUNCTION public._leopips_credit_forfeit_abandon_partial(uuid, uuid, text) IS
  'Forfeit/abandon/timeout-win: winner +1.5S; retain 0.5S; loser +0. Idempotent. Does not alter timeout_penalty rows.';

REVOKE ALL ON FUNCTION public._leopips_credit_forfeit_abandon_partial(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Terminal settle
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

  -- Progression + referral independent of pot path
  -- (forfeit/abandon/timeout => 0 XP via progression rules).
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

  IF match_row.finish_reason = 'completed' THEN
    payout := public._leopips_credit_match_payout(winner, p_match_id, 'normal_win');
    RETURN jsonb_build_object(
      'applied', true,
      'payout', payout,
      'winner', winner,
      'outcome', 'normal_win',
      'winner_credit_formula', '2S',
      'retained', 0,
      'referral', referral,
      'progression', progression
    );
  END IF;

  IF match_row.finish_reason IN ('forfeit', 'abandon', 'abandoned', 'timeout') THEN
    payout := public._leopips_credit_forfeit_abandon_partial(
      p_match_id,
      winner,
      match_row.finish_reason
    );
    RETURN jsonb_build_object(
      'applied', true,
      'payout', payout,
      'winner', winner,
      'outcome', 'non_completed_partial',
      'winner_credit_formula', '1.5S',
      'retained_formula', '0.5S',
      'loser_credit', 0,
      'referral', referral,
      'progression', progression
    );
  END IF;

  RETURN jsonb_build_object(
    'applied', false,
    'reason', 'not_authoritative_loss',
    'finish_reason', match_row.finish_reason,
    'referral', referral,
    'progression', progression
  );
END;
$$;

COMMENT ON FUNCTION public._leopips_settle_finished_match(uuid) IS
  'Completed=2S. Forfeit/abandon/timeout=winner 1.5S + retain 0.5S. Timeout penalties separate. Progression/referral independent. Idempotent.';

REVOKE ALL ON FUNCTION public._leopips_settle_finished_match(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Realtime: wallet balance updates reach Home without manual refresh.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'player_leopips_wallets'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.player_leopips_wallets;
    END IF;
  END IF;
END $$;

COMMIT;
