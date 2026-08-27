-- LeoDomino V1/V2 — Invite & Win referral competition foundation.
-- Separate from Challenge CP, League LP, LeoCoins, Find Match, and gameplay.
-- Forward-only. Does not rewrite previously applied migrations.
-- Does not auto-pay or finalize a winner.

-- ---------------------------------------------------------------------------
-- 0. Authoritative online match completion + origin
--    Clients have SELECT-only on matches. These columns are written only by
--    SECURITY DEFINER RPCs below (accept / commit / forfeit).
-- ---------------------------------------------------------------------------

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS finish_reason text,
  ADD COLUMN IF NOT EXISTS match_kind text;

COMMENT ON COLUMN public.matches.finished_at IS
  'Server time when the online match reached a terminal outcome. Not client-supplied.';
COMMENT ON COLUMN public.matches.finish_reason IS
  'completed | forfeit | aborted. Set only by backend RPCs. Not taken from client payloads.';
COMMENT ON COLUMN public.matches.match_kind IS
  'public = Find Match. friend = Play With Friend / private. Copied from match_requests.visibility at accept.';

UPDATE public.matches AS m
SET match_kind = CASE
  WHEN COALESCE(r.visibility, 'public') = 'friend' THEN 'friend'
  ELSE 'public'
END
FROM public.match_requests AS r
WHERE r.id = m.request_id
  AND m.match_kind IS NULL;

UPDATE public.matches
SET match_kind = 'public'
WHERE match_kind IS NULL;

ALTER TABLE public.matches
  ALTER COLUMN match_kind SET DEFAULT 'public',
  ALTER COLUMN match_kind SET NOT NULL;

ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_match_kind_check,
  DROP CONSTRAINT IF EXISTS matches_finish_reason_check,
  DROP CONSTRAINT IF EXISTS matches_finish_shape_check;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_match_kind_check
    CHECK (match_kind IN ('public', 'friend')),
  ADD CONSTRAINT matches_finish_reason_check
    CHECK (finish_reason IS NULL OR finish_reason IN ('completed', 'forfeit', 'aborted')),
  ADD CONSTRAINT matches_finish_shape_check
    CHECK (
      (finished_at IS NULL AND finish_reason IS NULL)
      OR (finished_at IS NOT NULL AND finish_reason IS NOT NULL)
    );

CREATE OR REPLACE FUNCTION public.matches_protect_ruleset()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.ruleset_id IS DISTINCT FROM OLD.ruleset_id THEN
    RAISE EXCEPTION 'matches.ruleset_id is immutable' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.request_id IS DISTINCT FROM OLD.request_id THEN
    RAISE EXCEPTION 'matches.request_id is immutable' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.player_a IS DISTINCT FROM OLD.player_a OR NEW.player_b IS DISTINCT FROM OLD.player_b) THEN
    RAISE EXCEPTION 'match seats are immutable' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.match_kind IS DISTINCT FROM OLD.match_kind THEN
    RAISE EXCEPTION 'matches.match_kind is immutable' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.finished_at IS NOT NULL AND NEW.finished_at IS DISTINCT FROM OLD.finished_at THEN
    RAISE EXCEPTION 'matches.finished_at is immutable' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.finish_reason IS NOT NULL AND NEW.finish_reason IS DISTINCT FROM OLD.finish_reason THEN
    RAISE EXCEPTION 'matches.finish_reason is immutable' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.matches_stamp_terminal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'aborted' AND OLD.status IS DISTINCT FROM 'aborted' THEN
    NEW.finished_at := COALESCE(NEW.finished_at, now());
    NEW.finish_reason := COALESCE(NEW.finish_reason, 'aborted');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matches_stamp_terminal ON public.matches;
CREATE TRIGGER matches_stamp_terminal
  BEFORE UPDATE ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.matches_stamp_terminal();

REVOKE ALL ON FUNCTION public.matches_stamp_terminal() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.accept_match_request(p_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  request public.match_requests%ROWTYPE;
  new_match_id uuid;
  first_player uuid;
  second_player uuid;
  low_id uuid;
  high_id uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request id required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO request
  FROM public.match_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_UNAVAILABLE' USING ERRCODE = 'P0002';
  END IF;

  IF request.creator_id = caller THEN
    RAISE EXCEPTION 'cannot accept own match request' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(request.visibility, 'public') = 'friend' THEN
    IF request.invitee_id IS DISTINCT FROM caller THEN
      RAISE EXCEPTION 'only the invitee may accept' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF request.creator_id < caller THEN
    first_player := request.creator_id;
    second_player := caller;
  ELSE
    first_player := caller;
    second_player := request.creator_id;
  END IF;
  PERFORM public._matchmaking_lock_player(first_player);
  PERFORM public._matchmaking_lock_player(second_player);

  SELECT * INTO request
  FROM public.match_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_UNAVAILABLE' USING ERRCODE = 'P0002';
  END IF;
  IF request.creator_id = caller THEN
    RAISE EXCEPTION 'cannot accept own match request' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(request.visibility, 'public') = 'friend'
     AND request.invitee_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'only the invitee may accept' USING ERRCODE = '42501';
  END IF;
  IF request.status = 'accepted' THEN
    RAISE EXCEPTION 'REQUEST_ALREADY_ACCEPTED' USING ERRCODE = 'P0003';
  END IF;
  IF request.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'REQUEST_UNAVAILABLE' USING ERRCODE = 'P0002';
  END IF;
  IF request.expires_at <= now() THEN
    UPDATE public.match_requests
    SET status = 'expired'
    WHERE id = request.id AND status = 'open';
    RAISE EXCEPTION 'match request expired' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(request.visibility, 'public') = 'friend' THEN
    low_id := public.uuid_pair_low(request.creator_id, caller);
    high_id := public.uuid_pair_high(request.creator_id, caller);
    IF NOT EXISTS (
      SELECT 1 FROM public.friendships
      WHERE user_a = low_id AND user_b = high_id
    ) THEN
      UPDATE public.match_requests
      SET status = 'expired'
      WHERE id = request.id AND status = 'open';
      RAISE EXCEPTION 'not friends' USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM 1
  FROM public.match_requests
  WHERE status = 'open'
    AND creator_id IN (request.creator_id, caller)
  FOR UPDATE;

  SELECT * INTO request
  FROM public.match_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF request.status IS DISTINCT FROM 'open' THEN
    IF request.status = 'accepted' THEN
      RAISE EXCEPTION 'REQUEST_ALREADY_ACCEPTED' USING ERRCODE = 'P0003';
    END IF;
    RAISE EXCEPTION 'REQUEST_UNAVAILABLE' USING ERRCODE = 'P0002';
  END IF;

  IF public.player_in_active_match(request.creator_id)
     OR public.player_in_active_match(caller) THEN
    RAISE EXCEPTION 'PLAYER_BUSY' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.matches (request_id, ruleset_id, player_a, player_b, status, match_kind)
    VALUES (
      request.id,
      request.ruleset_id,
      request.creator_id,
      caller,
      'ready',
      CASE
        WHEN COALESCE(request.visibility, 'public') = 'friend' THEN 'friend'
        ELSE 'public'
      END
    )
    RETURNING id INTO new_match_id;
  EXCEPTION
    WHEN unique_violation THEN
      IF EXISTS (
        SELECT 1 FROM public.matches WHERE request_id = request.id
      ) THEN
        RAISE EXCEPTION 'REQUEST_ALREADY_ACCEPTED' USING ERRCODE = 'P0003';
      END IF;
      RAISE EXCEPTION 'PLAYER_BUSY' USING ERRCODE = 'P0001';
  END;

  UPDATE public.match_requests
  SET
    status = 'accepted',
    acceptor_id = caller,
    accepted_at = now(),
    match_id = new_match_id
  WHERE id = request.id
    AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_UNAVAILABLE' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.match_requests
  SET status = 'cancelled'
  WHERE status = 'open'
    AND id <> request.id
    AND (
      creator_id IN (request.creator_id, caller)
      OR invitee_id IN (request.creator_id, caller)
    );

  RETURN new_match_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_online_game_transition(
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
  session_row public.game_sessions%ROWTYPE;
  new_version integer;
BEGIN
  PERFORM public.require_service_role();
  IF p_match_id IS NULL OR p_expected_version IS NULL OR p_actor IS NULL OR p_public IS NULL OR p_engine_state IS NULL THEN
    RAISE EXCEPTION 'commit arguments required' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'reserve' OR (p_payload ? 'tileId' AND p_action_type = 'draw') THEN
    RAISE EXCEPTION 'action payload must not include reserve or draw tile ids' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO session_row
  FROM public.game_sessions
  WHERE match_id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'game session not found' USING ERRCODE = 'P0002';
  END IF;
  IF session_row.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'stale expected_version' USING ERRCODE = '40001';
  END IF;

  new_version := p_expected_version + 1;

  UPDATE public.game_sessions
  SET
    status = COALESCE(p_public->>'status', status),
    version = new_version,
    current_seat = COALESCE((p_public->>'currentSeat')::integer, current_seat),
    round = COALESCE((p_public->>'round')::integer, round),
    phase = COALESCE(p_public->>'phase', phase),
    scores = COALESCE(p_public->'scores', scores),
    board = COALESCE(p_public->'board', board),
    spinner = COALESCE(p_public->'spinner', spinner),
    last_play_points = COALESCE((p_public->>'lastPlayPoints')::integer, last_play_points),
    last_play_points_seat = NULLIF(p_public->>'lastPlayPointsSeat', '')::integer,
    last_play_score_terminals = COALESCE(p_public->'lastPlayScoreTerminals', last_play_score_terminals),
    reserve_count = COALESCE((p_public->>'reserveCount')::integer, reserve_count),
    hand_counts = COALESCE(p_public->'handCounts', hand_counts),
    round_result = p_public->'roundResult',
    match_winner_seat = NULLIF(p_public->>'matchWinnerSeat', '')::integer
  WHERE match_id = p_match_id AND version = p_expected_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale expected_version' USING ERRCODE = '40001';
  END IF;

  UPDATE public.game_secrets
  SET engine_state = p_engine_state
  WHERE match_id = p_match_id;

  INSERT INTO public.game_actions (match_id, version, actor_id, seat, action_type, payload)
  VALUES (
    p_match_id,
    new_version,
    p_actor,
    p_seat,
    p_action_type,
    COALESCE(p_payload, '{}'::jsonb)
  );

  IF p_match_status = 'finished' THEN
    UPDATE public.matches
    SET
      status = 'finished',
      finished_at = COALESCE(finished_at, now()),
      finish_reason = COALESCE(finish_reason, 'completed')
    WHERE id = p_match_id
      AND status <> 'aborted';
  ELSIF p_match_status = 'playing' THEN
    UPDATE public.matches
    SET status = 'playing'
    WHERE id = p_match_id AND status = 'ready';
  END IF;

  RETURN jsonb_build_object('version', new_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.forfeit_online_match(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  match_row public.matches%ROWTYPE;
  session_row public.game_sessions%ROWTYPE;
  winner_seat integer;
  forfeit_seat integer;
  result jsonb;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'match id required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO match_row
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match not found' USING ERRCODE = 'P0002';
  END IF;
  IF match_row.player_a <> caller AND match_row.player_b <> caller THEN
    RAISE EXCEPTION 'not a seated player' USING ERRCODE = '42501';
  END IF;

  winner_seat := CASE WHEN match_row.player_a = caller THEN 1 ELSE 0 END;
  forfeit_seat := CASE WHEN match_row.player_a = caller THEN 0 ELSE 1 END;

  IF match_row.status NOT IN ('ready', 'playing') THEN
    SELECT * INTO session_row FROM public.game_sessions WHERE match_id = p_match_id;
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'matchId', match_row.id,
      'status', match_row.status,
      'winnerSeat', COALESCE(session_row.match_winner_seat, winner_seat),
      'forfeitSeat', forfeit_seat
    );
  END IF;

  UPDATE public.matches
  SET
    status = 'finished',
    finished_at = COALESCE(finished_at, now()),
    finish_reason = COALESCE(finish_reason, 'forfeit')
  WHERE id = p_match_id
    AND status IN ('ready', 'playing');

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

  result := jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'matchId', p_match_id,
    'status', 'finished',
    'winnerSeat', winner_seat,
    'forfeitSeat', forfeit_seat
  );
  RETURN result;
END;
$$;

-- ---------------------------------------------------------------------------
-- A. Seasons
-- ---------------------------------------------------------------------------

CREATE TABLE public.referral_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'upcoming',
  prize_amount_usd numeric(10, 2) NOT NULL DEFAULT 500.00,
  prize_currency text NOT NULL DEFAULT 'USD',
  prize_label text NOT NULL DEFAULT 'Invite & Win',
  winner_player_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_seasons_slug_len CHECK (char_length(slug) BETWEEN 1 AND 64),
  CONSTRAINT referral_seasons_name_len CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT referral_seasons_window_check CHECK (ends_at > starts_at),
  CONSTRAINT referral_seasons_status_check CHECK (
    status IN ('upcoming', 'active', 'ended', 'under_review', 'finalized')
  ),
  CONSTRAINT referral_seasons_prize_check CHECK (prize_amount_usd >= 0),
  CONSTRAINT referral_seasons_currency_check CHECK (prize_currency = 'USD'),
  CONSTRAINT referral_seasons_finalized_shape CHECK (
    (status <> 'finalized' AND finalized_at IS NULL)
    OR (status = 'finalized' AND finalized_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.referral_seasons IS
  'Invite & Win seasons. Independent of League/Challenge/LeoCoins. Winner is never auto-paid or auto-finalized.';
COMMENT ON COLUMN public.referral_seasons.prize_amount_usd IS
  'Baseline prize metadata ($500 US). Not a payment instruction.';
COMMENT ON COLUMN public.referral_seasons.winner_player_id IS
  'Set only during later human verification. NULL until then.';

CREATE UNIQUE INDEX referral_seasons_slug_key
  ON public.referral_seasons (slug);

CREATE UNIQUE INDEX referral_seasons_one_active
  ON public.referral_seasons (status)
  WHERE status = 'active';

CREATE INDEX referral_seasons_window_idx
  ON public.referral_seasons (starts_at, ends_at);

CREATE TRIGGER referral_seasons_set_updated_at
  BEFORE UPDATE ON public.referral_seasons
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.referral_seasons_protect_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'referral_seasons.id is immutable' USING ERRCODE = '22023';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'referral_seasons.created_at is immutable' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER referral_seasons_protect_immutable
  BEFORE UPDATE ON public.referral_seasons
  FOR EACH ROW
  EXECUTE FUNCTION public.referral_seasons_protect_immutable();

-- ---------------------------------------------------------------------------
-- B. One unique code per authenticated player
-- ---------------------------------------------------------------------------

CREATE TABLE public.player_referral_codes (
  player_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_referral_codes_format CHECK (code ~ '^[A-HJ-NP-Z2-9]{8}$')
);

COMMENT ON TABLE public.player_referral_codes IS
  'One unique Invite & Win code per player. Issued only by ensure_my_referral_code. Never client-supplied.';
COMMENT ON COLUMN public.player_referral_codes.code IS
  'Uppercase Crockford-style 8-char code. Ambiguous 0/O/1/I omitted.';

CREATE UNIQUE INDEX player_referral_codes_code_key
  ON public.player_referral_codes (code);

CREATE OR REPLACE FUNCTION public.player_referral_codes_protect_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.player_id IS DISTINCT FROM OLD.player_id THEN
    RAISE EXCEPTION 'player_referral_codes.player_id is immutable' USING ERRCODE = '22023';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'player_referral_codes.code is immutable' USING ERRCODE = '22023';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'player_referral_codes.created_at is immutable' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER player_referral_codes_protect_immutable
  BEFORE UPDATE ON public.player_referral_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.player_referral_codes_protect_immutable();

CREATE OR REPLACE FUNCTION public._generate_referral_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  idx integer;
  i integer;
BEGIN
  FOR i IN 1..8 LOOP
    idx := 1 + (get_byte(gen_random_bytes(1), 0) % char_length(alphabet));
    result := result || substr(alphabet, idx, 1);
  END LOOP;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public._generate_referral_code() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- C. Referrals — one new account, one referrer, forever
-- ---------------------------------------------------------------------------

CREATE TABLE public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.referral_seasons (id) ON DELETE RESTRICT,
  referrer_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  referred_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  referral_code text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attributed_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  rejected_at timestamptz,
  rejected_reason text,
  qualifying_match_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referrals_not_self CHECK (referrer_id <> referred_id),
  CONSTRAINT referrals_status_check CHECK (status IN ('pending', 'validated', 'rejected')),
  CONSTRAINT referrals_code_format CHECK (referral_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  CONSTRAINT referrals_count_check CHECK (qualifying_match_count >= 0),
  CONSTRAINT referrals_pending_shape CHECK (
    status <> 'pending'
    OR (validated_at IS NULL AND rejected_at IS NULL)
  ),
  CONSTRAINT referrals_validated_shape CHECK (
    status <> 'validated'
    OR (validated_at IS NOT NULL AND rejected_at IS NULL)
  ),
  CONSTRAINT referrals_rejected_shape CHECK (
    status <> 'rejected'
    OR (rejected_at IS NOT NULL AND validated_at IS NULL)
  )
);

COMMENT ON TABLE public.referrals IS
  'Authoritative Invite & Win attribution. Clicks/shares are not rows. Status is server-managed.';
COMMENT ON COLUMN public.referrals.status IS
  'pending | validated | rejected. Clients cannot write this column.';
COMMENT ON COLUMN public.referrals.qualifying_match_count IS
  'Denormalized DISTINCT public Find Match completed games credited in referral_qualifying_matches.';

CREATE UNIQUE INDEX referrals_one_per_referred
  ON public.referrals (referred_id);

CREATE INDEX referrals_referrer_season_idx
  ON public.referrals (referrer_id, season_id, status);

CREATE INDEX referrals_season_validated_idx
  ON public.referrals (season_id, referrer_id)
  WHERE status = 'validated';

CREATE INDEX referrals_pending_referred_idx
  ON public.referrals (referred_id)
  WHERE status = 'pending';

CREATE TRIGGER referrals_set_updated_at
  BEFORE UPDATE ON public.referrals
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.referrals_protect_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.referrer_id IS DISTINCT FROM OLD.referrer_id THEN
    RAISE EXCEPTION 'referrals.referrer_id is immutable' USING ERRCODE = '22023';
  END IF;
  IF NEW.referred_id IS DISTINCT FROM OLD.referred_id THEN
    RAISE EXCEPTION 'referrals.referred_id is immutable' USING ERRCODE = '22023';
  END IF;
  IF NEW.season_id IS DISTINCT FROM OLD.season_id THEN
    RAISE EXCEPTION 'referrals.season_id is immutable' USING ERRCODE = '22023';
  END IF;
  IF NEW.referral_code IS DISTINCT FROM OLD.referral_code THEN
    RAISE EXCEPTION 'referrals.referral_code is immutable' USING ERRCODE = '22023';
  END IF;
  IF NEW.attributed_at IS DISTINCT FROM OLD.attributed_at THEN
    RAISE EXCEPTION 'referrals.attributed_at is immutable' USING ERRCODE = '22023';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'referrals.created_at is immutable' USING ERRCODE = '22023';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF current_setting('leodomino.referral_evaluate', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'referral status is server-managed' USING ERRCODE = '42501';
    END IF;
    IF OLD.status = 'validated' OR OLD.status = 'rejected' THEN
      RAISE EXCEPTION 'referral status is terminal' USING ERRCODE = '22023';
    END IF;
    IF OLD.status = 'pending' AND NEW.status NOT IN ('validated', 'rejected') THEN
      RAISE EXCEPTION 'invalid referral status transition' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER referrals_protect_lifecycle
  BEFORE UPDATE ON public.referrals
  FOR EACH ROW
  EXECUTE FUNCTION public.referrals_protect_lifecycle();

-- ---------------------------------------------------------------------------
-- D. Qualifying-match ledger (no double-count)
-- ---------------------------------------------------------------------------

CREATE TABLE public.referral_qualifying_matches (
  referral_id uuid NOT NULL REFERENCES public.referrals (id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.matches (id) ON DELETE RESTRICT,
  credited_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (referral_id, match_id)
);

COMMENT ON TABLE public.referral_qualifying_matches IS
  'Ledger of DISTINCT public Find Match completed games credited toward a pending referral. Never client-written.';

CREATE INDEX referral_qualifying_matches_match_idx
  ON public.referral_qualifying_matches (match_id);

CREATE INDEX matches_referral_qualifying_a_idx
  ON public.matches (player_a, finished_at)
  WHERE status = 'finished'
    AND match_kind = 'public'
    AND finish_reason = 'completed';

CREATE INDEX matches_referral_qualifying_b_idx
  ON public.matches (player_b, finished_at)
  WHERE status = 'finished'
    AND match_kind = 'public'
    AND finish_reason = 'completed';

-- ---------------------------------------------------------------------------
-- E. Server helpers — verification, qualification, evaluation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.player_meets_referral_verification(p_player uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id = p_player
      AND (
        u.email_confirmed_at IS NOT NULL
        OR u.phone_confirmed_at IS NOT NULL
      )
  );
$$;

COMMENT ON FUNCTION public.player_meets_referral_verification(uuid) IS
  'Current LeoDomino verification for Invite & Win: confirmed auth email or phone. Extend later for stronger review. Never returns auth contact values.';

REVOKE ALL ON FUNCTION public.player_meets_referral_verification(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._credit_referral_qualifying_matches(p_referral_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total integer := 0;
BEGIN
  INSERT INTO public.referral_qualifying_matches (referral_id, match_id)
  SELECT r.id, m.id
  FROM public.referrals r
  JOIN public.referral_seasons season ON season.id = r.season_id
  JOIN public.matches m
    ON m.player_a = r.referred_id OR m.player_b = r.referred_id
  WHERE r.id = p_referral_id
    AND r.status = 'pending'
    AND m.status = 'finished'
    AND m.match_kind = 'public'
    AND m.finish_reason = 'completed'
    AND m.finished_at IS NOT NULL
    AND m.finished_at >= r.attributed_at
    AND m.finished_at <= season.ends_at
  ON CONFLICT (referral_id, match_id) DO NOTHING;

  SELECT COUNT(*)::integer
  INTO total
  FROM public.referral_qualifying_matches
  WHERE referral_id = p_referral_id;

  UPDATE public.referrals
  SET qualifying_match_count = total
  WHERE id = p_referral_id
    AND status = 'pending';

  RETURN total;
END;
$$;

REVOKE ALL ON FUNCTION public._credit_referral_qualifying_matches(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._evaluate_referral(p_referral_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.referrals%ROWTYPE;
  verified boolean;
BEGIN
  SELECT * INTO row
  FROM public.referrals
  WHERE id = p_referral_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF row.status IS DISTINCT FROM 'pending' THEN
    RETURN row.status;
  END IF;

  PERFORM public._credit_referral_qualifying_matches(p_referral_id);

  SELECT * INTO row
  FROM public.referrals
  WHERE id = p_referral_id;

  verified := public.player_meets_referral_verification(row.referred_id);

  IF row.qualifying_match_count >= 10 AND verified THEN
    PERFORM set_config('leodomino.referral_evaluate', 'on', true);
    UPDATE public.referrals
    SET
      status = 'validated',
      validated_at = now()
    WHERE id = p_referral_id
      AND status = 'pending';
    RETURN 'validated';
  END IF;

  RETURN 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public._evaluate_referral(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_referral_progress_for_player(p_player uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  referral_id uuid;
BEGIN
  IF p_player IS NULL THEN
    RETURN;
  END IF;
  SELECT id INTO referral_id
  FROM public.referrals
  WHERE referred_id = p_player
    AND status = 'pending'
  LIMIT 1;
  IF referral_id IS NOT NULL THEN
    PERFORM public._evaluate_referral(referral_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_referral_progress_for_player(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.referrals_after_match_finished()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'finished' AND (OLD.status IS DISTINCT FROM 'finished') THEN
    PERFORM public.sync_referral_progress_for_player(NEW.player_a);
    PERFORM public.sync_referral_progress_for_player(NEW.player_b);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER referrals_after_match_finished
  AFTER UPDATE OF status ON public.matches
  FOR EACH ROW
  WHEN (
    NEW.status = 'finished'
    AND NEW.match_kind = 'public'
    AND NEW.finish_reason = 'completed'
  )
  EXECUTE FUNCTION public.referrals_after_match_finished();

REVOKE ALL ON FUNCTION public.referrals_after_match_finished() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- F. Authenticated RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_my_referral_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  existing text;
  candidate text;
  attempts integer := 0;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT code INTO existing
  FROM public.player_referral_codes
  WHERE player_id = caller;
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  LOOP
    attempts := attempts + 1;
    IF attempts > 12 THEN
      RAISE EXCEPTION 'could not allocate referral code' USING ERRCODE = '40001';
    END IF;
    candidate := public._generate_referral_code();
    BEGIN
      INSERT INTO public.player_referral_codes (player_id, code)
      VALUES (caller, candidate);
      RETURN candidate;
    EXCEPTION
      WHEN unique_violation THEN
        SELECT code INTO existing
        FROM public.player_referral_codes
        WHERE player_id = caller;
        IF existing IS NOT NULL THEN
          RETURN existing;
        END IF;
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.ensure_my_referral_code() IS
  'Returns the caller''s unique Invite & Win code, creating it if needed. Never accepts a client-supplied code.';

CREATE OR REPLACE FUNCTION public.apply_referral_code(p_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  normalized text;
  code_row public.player_referral_codes%ROWTYPE;
  season_row public.referral_seasons%ROWTYPE;
  profile_created timestamptz;
  new_id uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  normalized := upper(btrim(COALESCE(p_code, '')));
  IF normalized !~ '^[A-HJ-NP-Z2-9]{8}$' THEN
    RAISE EXCEPTION 'invalid referral code' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO code_row
  FROM public.player_referral_codes
  WHERE code = normalized;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'referral code not found' USING ERRCODE = 'P0002';
  END IF;
  IF code_row.player_id = caller THEN
    RAISE EXCEPTION 'cannot refer yourself' USING ERRCODE = '22023';
  END IF;

  SELECT created_at INTO profile_created
  FROM public.profiles
  WHERE id = caller;
  IF profile_created IS NULL THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = 'P0002';
  END IF;
  IF profile_created < now() - interval '7 days' THEN
    RAISE EXCEPTION 'referral window expired' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_id = caller) THEN
    RAISE EXCEPTION 'referrer already locked' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO season_row
  FROM public.referral_seasons
  WHERE status = 'active'
    AND starts_at <= now()
    AND ends_at > now()
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active referral season' USING ERRCODE = 'P0002';
  END IF;

  BEGIN
    INSERT INTO public.referrals (
      season_id,
      referrer_id,
      referred_id,
      referral_code,
      status
    )
    VALUES (
      season_row.id,
      code_row.player_id,
      caller,
      code_row.code,
      'pending'
    )
    RETURNING id INTO new_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'referrer already locked' USING ERRCODE = '22023';
  END;

  RETURN new_id;
END;
$$;

COMMENT ON FUNCTION public.apply_referral_code(text) IS
  'Locks the authenticated new player to one referrer in the active season. Does not validate the referral. Clicks are not stored.';

CREATE OR REPLACE FUNCTION public.refresh_my_referral_progress()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  referral_id uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  SELECT id INTO referral_id
  FROM public.referrals
  WHERE referred_id = caller
    AND status = 'pending';
  IF referral_id IS NULL THEN
    RETURN 'none';
  END IF;
  RETURN public._evaluate_referral(referral_id);
END;
$$;

COMMENT ON FUNCTION public.refresh_my_referral_progress() IS
  'Recomputes the caller''s pending referred-player progress from authoritative matches. Cannot set status directly.';

CREATE OR REPLACE FUNCTION public.referral_validated_count(p_referrer uuid, p_season_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.referrals
  WHERE referrer_id = p_referrer
    AND season_id = p_season_id
    AND status = 'validated';
$$;

COMMENT ON FUNCTION public.referral_validated_count(uuid, uuid) IS
  'Server count of validated referrals. Do not trust a client-supplied count.';

REVOKE ALL ON FUNCTION public.referral_validated_count(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_referral_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  my_code text;
  season_row public.referral_seasons%ROWTYPE;
  as_referred public.referrals%ROWTYPE;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT code INTO my_code
  FROM public.player_referral_codes
  WHERE player_id = caller;

  SELECT * INTO season_row
  FROM public.referral_seasons
  WHERE status = 'active'
  ORDER BY starts_at DESC
  LIMIT 1;

  SELECT * INTO as_referred
  FROM public.referrals
  WHERE referred_id = caller;

  RETURN jsonb_build_object(
    'playerId', caller,
    'code', my_code,
    'season', CASE
      WHEN season_row.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', season_row.id,
        'slug', season_row.slug,
        'name', season_row.name,
        'startsAt', season_row.starts_at,
        'endsAt', season_row.ends_at,
        'status', season_row.status,
        'prizeAmountUsd', season_row.prize_amount_usd,
        'prizeCurrency', season_row.prize_currency,
        'prizeLabel', season_row.prize_label
      )
    END,
    'validatedCount', CASE
      WHEN season_row.id IS NULL THEN 0
      ELSE public.referral_validated_count(caller, season_row.id)
    END,
    'pendingCount', CASE
      WHEN season_row.id IS NULL THEN 0
      ELSE (
        SELECT COUNT(*)::integer
        FROM public.referrals
        WHERE referrer_id = caller
          AND season_id = season_row.id
          AND status = 'pending'
      )
    END,
    'myAttribution', CASE
      WHEN as_referred.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'status', as_referred.status,
        'seasonId', as_referred.season_id,
        'qualifyingMatchCount', as_referred.qualifying_match_count,
        'attributedAt', as_referred.attributed_at,
        'validatedAt', as_referred.validated_at
      )
    END
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_referral_profile() IS
  'Safe summary for the authenticated player. No emails, phones, or other players'' private fields.';

-- ---------------------------------------------------------------------------
-- G. RLS — fail closed. No client writes.
-- ---------------------------------------------------------------------------

ALTER TABLE public.referral_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_qualifying_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY referral_seasons_select_authenticated
  ON public.referral_seasons
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY player_referral_codes_select_own
  ON public.player_referral_codes
  FOR SELECT
  TO authenticated
  USING (player_id = auth.uid());

CREATE POLICY referrals_select_parties
  ON public.referrals
  FOR SELECT
  TO authenticated
  USING (referrer_id = auth.uid() OR referred_id = auth.uid());

CREATE POLICY referral_qualifying_matches_select_parties
  ON public.referral_qualifying_matches
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.referrals r
      WHERE r.id = referral_id
        AND (r.referrer_id = auth.uid() OR r.referred_id = auth.uid())
    )
  );

REVOKE ALL ON TABLE public.referral_seasons FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.player_referral_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.referrals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.referral_qualifying_matches FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.referral_seasons TO authenticated;
GRANT SELECT ON TABLE public.player_referral_codes TO authenticated;
GRANT SELECT ON TABLE public.referrals TO authenticated;
GRANT SELECT ON TABLE public.referral_qualifying_matches TO authenticated;

GRANT ALL ON TABLE public.referral_seasons TO service_role;
GRANT ALL ON TABLE public.player_referral_codes TO service_role;
GRANT ALL ON TABLE public.referrals TO service_role;
GRANT ALL ON TABLE public.referral_qualifying_matches TO service_role;

REVOKE ALL ON FUNCTION public.ensure_my_referral_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_referral_code() TO authenticated;

REVOKE ALL ON FUNCTION public.apply_referral_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_referral_code(text) TO authenticated;

REVOKE ALL ON FUNCTION public.refresh_my_referral_progress() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_my_referral_progress() TO authenticated;

REVOKE ALL ON FUNCTION public.get_my_referral_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_referral_profile() TO authenticated;
