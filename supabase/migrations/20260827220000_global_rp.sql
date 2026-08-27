-- Global RP (Elo) foundation.
-- Independent of other score currencies and offline/local play.
-- Clients never submit winner, loser, RP, delta, rated, or K.
-- Settlement is server-authoritative and at most once per match.
--
-- Elo (K=32), PostgreSQL numeric ROUND (half away from zero), floor 0:
--   E = 1 / (1 + 10^((opponentRP - playerRP) / 400))
--   delta = ROUND(32 * (actualResult - expectedScore))
--   newRP = GREATEST(0, oldRP + delta)
-- Vectors:
--   1000 beats 1000 => 1016 / 984
--   1000 beats 1200 => 1024 / 1176
--   1200 beats 1000 => 1208 / 992
--   0 beats 1000 => 32 / 968
--   5000 beats 0 => 5000 / 0
--   0 beats 5000 => 32 / 4968
-- Rank: 1 + number of players with strictly greater RP. Same RP => same rank.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

CREATE TABLE public.player_global_ratings (
  player_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  rp integer NOT NULL DEFAULT 1000 CHECK (rp >= 0),
  matches_played integer NOT NULL DEFAULT 0 CHECK (matches_played >= 0),
  wins integer NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses integer NOT NULL DEFAULT 0 CHECK (losses >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.player_global_ratings IS
  'Authoritative Global RP. Default 1000. Never below 0. Independent of other score currencies.';

COMMENT ON COLUMN public.player_global_ratings.rp IS
  'Global RP. New players start at 1000. GREATEST(0, old + Elo delta).';

INSERT INTO public.player_global_ratings (player_id)
SELECT id FROM public.profiles
ON CONFLICT (player_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.profiles_insert_global_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.player_global_ratings (player_id)
  VALUES (NEW.id)
  ON CONFLICT (player_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_insert_global_rating ON public.profiles;
CREATE TRIGGER profiles_insert_global_rating
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_insert_global_rating();

DROP TRIGGER IF EXISTS player_global_ratings_set_updated_at ON public.player_global_ratings;
CREATE TRIGGER player_global_ratings_set_updated_at
  BEFORE UPDATE ON public.player_global_ratings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.match_rp_results (
  match_id uuid PRIMARY KEY REFERENCES public.matches(id) ON DELETE CASCADE,
  rated boolean NOT NULL,
  ruleset_id text NOT NULL,
  winner_id uuid NOT NULL REFERENCES public.profiles(id),
  loser_id uuid NOT NULL REFERENCES public.profiles(id),
  winner_old_rp integer NOT NULL CHECK (winner_old_rp >= 0),
  winner_new_rp integer NOT NULL CHECK (winner_new_rp >= 0),
  winner_delta integer NOT NULL,
  loser_old_rp integer NOT NULL CHECK (loser_old_rp >= 0),
  loser_new_rp integer NOT NULL CHECK (loser_new_rp >= 0),
  loser_delta integer NOT NULL,
  winner_expected numeric NOT NULL,
  loser_expected numeric NOT NULL,
  k integer NOT NULL DEFAULT 32,
  finish_reason text NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now(),
  CHECK (winner_id <> loser_id),
  CHECK (k = 32),
  CHECK (finish_reason IN ('completed', 'forfeit')),
  CHECK (winner_new_rp = GREATEST(0, winner_old_rp + winner_delta)),
  CHECK (loser_new_rp = GREATEST(0, loser_old_rp + loser_delta)),
  CHECK (
    rated
    OR (
      winner_delta = 0
      AND loser_delta = 0
      AND winner_new_rp = winner_old_rp
      AND loser_new_rp = loser_old_rp
    )
  )
);

COMMENT ON TABLE public.match_rp_results IS
  'Immutable one-row-per-match Global RP ledger. Unrated friend matches store rated=false with +0/-0. Aborted matches have no row.';

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS rated boolean;

UPDATE public.matches m
SET rated = (
  m.match_kind IS DISTINCT FROM 'friend'
  AND NOT EXISTS (
    SELECT 1
    FROM public.friendships f
    WHERE f.user_a = public.uuid_pair_low(m.player_a, m.player_b)
      AND f.user_b = public.uuid_pair_high(m.player_a, m.player_b)
  )
)
WHERE m.rated IS NULL;

ALTER TABLE public.matches
  ALTER COLUMN rated SET DEFAULT false;

ALTER TABLE public.matches
  ALTER COLUMN rated SET NOT NULL;

COMMENT ON COLUMN public.matches.rated IS
  'Frozen at accept. Rated only for non-friend public Find Match. Later friend/unfriend changes cannot flip it.';

-- ---------------------------------------------------------------------------
-- Elo helpers (internal)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._global_rp_expected_score(p_player_rp integer, p_opponent_rp integer)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 1::numeric / (
    1::numeric + POWER(
      10::numeric,
      (p_opponent_rp - p_player_rp)::numeric / 400::numeric
    )
  );
$$;

CREATE OR REPLACE FUNCTION public._global_rp_elo_delta(p_player_rp integer, p_opponent_rp integer, p_scored numeric)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ROUND(
    32::numeric * (p_scored - public._global_rp_expected_score(p_player_rp, p_opponent_rp))
  )::integer;
$$;

CREATE OR REPLACE FUNCTION public._players_are_friends(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.friendships
    WHERE user_a = public.uuid_pair_low(p_a, p_b)
      AND user_b = public.uuid_pair_high(p_a, p_b)
  );
$$;

-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------

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
  IF TG_OP = 'UPDATE' AND NEW.rated IS DISTINCT FROM OLD.rated THEN
    RAISE EXCEPTION 'matches.rated is immutable' USING ERRCODE = '22023';
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

CREATE OR REPLACE FUNCTION public.match_rp_results_protect_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'match_rp_results is immutable' USING ERRCODE = '22023';
END;
$$;

DROP TRIGGER IF EXISTS match_rp_results_protect_immutable ON public.match_rp_results;
CREATE TRIGGER match_rp_results_protect_immutable
  BEFORE UPDATE OR DELETE ON public.match_rp_results
  FOR EACH ROW
  EXECUTE FUNCTION public.match_rp_results_protect_immutable();

-- ---------------------------------------------------------------------------
-- Rated classification at accept (frozen thereafter)
-- Rated only when the request is not a friend invite AND the pair is not
-- already friends. Friends who meet through public Find Match are unrated.
-- ---------------------------------------------------------------------------

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
    INSERT INTO public.matches (request_id, ruleset_id, player_a, player_b, status, match_kind, rated)
    VALUES (
      request.id,
      request.ruleset_id,
      request.creator_id,
      caller,
      'ready',
      CASE
        WHEN COALESCE(request.visibility, 'public') = 'friend' THEN 'friend'
        ELSE 'public'
      END,
      COALESCE(request.visibility, 'public') IS DISTINCT FROM 'friend'
        AND NOT EXISTS (
          SELECT 1
          FROM public.friendships
          WHERE user_a = public.uuid_pair_low(request.creator_id, caller)
            AND user_b = public.uuid_pair_high(request.creator_id, caller)
        )
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

-- ---------------------------------------------------------------------------
-- RP settler (internal only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.settle_match_global_rp(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  match_row public.matches%ROWTYPE;
  session_row public.game_sessions%ROWTYPE;
  existing public.match_rp_results%ROWTYPE;
  winner_id uuid;
  loser_id uuid;
  first_id uuid;
  second_id uuid;
  winner_old integer;
  loser_old integer;
  winner_delta integer;
  loser_delta integer;
  winner_new integer;
  loser_new integer;
  winner_expected numeric;
  loser_expected numeric;
BEGIN
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'match id required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO match_row
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT * INTO existing
  FROM public.match_rp_results
  WHERE match_id = p_match_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'settled', true,
      'matchId', existing.match_id,
      'rated', existing.rated
    );
  END IF;

  IF match_row.status = 'aborted' OR match_row.finish_reason IS NOT DISTINCT FROM 'aborted' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'aborted');
  END IF;

  IF match_row.status IS DISTINCT FROM 'finished' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_terminal');
  END IF;

  SELECT * INTO session_row
  FROM public.game_sessions
  WHERE match_id = p_match_id
  FOR UPDATE;

  IF NOT FOUND OR session_row.match_winner_seat IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_winner');
  END IF;

  IF session_row.match_winner_seat = 0 THEN
    winner_id := match_row.player_a;
    loser_id := match_row.player_b;
  ELSIF session_row.match_winner_seat = 1 THEN
    winner_id := match_row.player_b;
    loser_id := match_row.player_a;
  ELSE
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_winner');
  END IF;

  INSERT INTO public.player_global_ratings (player_id)
  VALUES (winner_id)
  ON CONFLICT (player_id) DO NOTHING;
  INSERT INTO public.player_global_ratings (player_id)
  VALUES (loser_id)
  ON CONFLICT (player_id) DO NOTHING;

  IF winner_id < loser_id THEN
    first_id := winner_id;
    second_id := loser_id;
  ELSE
    first_id := loser_id;
    second_id := winner_id;
  END IF;

  PERFORM 1 FROM public.player_global_ratings WHERE player_id = first_id FOR UPDATE;
  PERFORM 1 FROM public.player_global_ratings WHERE player_id = second_id FOR UPDATE;

  SELECT rp INTO winner_old
  FROM public.player_global_ratings
  WHERE player_id = winner_id;
  SELECT rp INTO loser_old
  FROM public.player_global_ratings
  WHERE player_id = loser_id;

  winner_expected := public._global_rp_expected_score(winner_old, loser_old);
  loser_expected := public._global_rp_expected_score(loser_old, winner_old);

  IF match_row.rated THEN
    winner_delta := public._global_rp_elo_delta(winner_old, loser_old, 1::numeric);
    loser_delta := public._global_rp_elo_delta(loser_old, winner_old, 0::numeric);
    winner_new := GREATEST(0, winner_old + winner_delta);
    loser_new := GREATEST(0, loser_old + loser_delta);

    UPDATE public.player_global_ratings
    SET
      rp = winner_new,
      matches_played = matches_played + 1,
      wins = wins + 1
    WHERE player_id = winner_id;

    UPDATE public.player_global_ratings
    SET
      rp = loser_new,
      matches_played = matches_played + 1,
      losses = losses + 1
    WHERE player_id = loser_id;
  ELSE
    winner_delta := 0;
    loser_delta := 0;
    winner_new := winner_old;
    loser_new := loser_old;
  END IF;

  INSERT INTO public.match_rp_results (
    match_id,
    rated,
    ruleset_id,
    winner_id,
    loser_id,
    winner_old_rp,
    winner_new_rp,
    winner_delta,
    loser_old_rp,
    loser_new_rp,
    loser_delta,
    winner_expected,
    loser_expected,
    k,
    finish_reason
  ) VALUES (
    p_match_id,
    match_row.rated,
    match_row.ruleset_id,
    winner_id,
    loser_id,
    winner_old,
    winner_new,
    winner_delta,
    loser_old,
    loser_new,
    loser_delta,
    winner_expected,
    loser_expected,
    32,
    match_row.finish_reason
  );

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'settled', true,
    'matchId', p_match_id,
    'rated', match_row.rated
  );
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO existing
    FROM public.match_rp_results
    WHERE match_id = p_match_id;
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'settled', true,
      'matchId', p_match_id,
      'rated', existing.rated
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- Authoritative completion hooks
-- ---------------------------------------------------------------------------

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
    PERFORM public.settle_match_global_rp(p_match_id);
  ELSIF p_match_status = 'playing' THEN
    UPDATE public.matches
    SET status = 'playing'
    WHERE id = p_match_id AND status = 'ready';
  END IF;

  RETURN jsonb_build_object('version', new_version);
END;
$$;

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

  PERFORM public.settle_match_global_rp(p_match_id);

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

-- ---------------------------------------------------------------------------
-- Read-only client RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_global_rating()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  rating public.player_global_ratings%ROWTYPE;
  rank integer;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.player_global_ratings (player_id)
  VALUES (caller)
  ON CONFLICT (player_id) DO NOTHING;

  SELECT * INTO rating
  FROM public.player_global_ratings
  WHERE player_id = caller;

  SELECT 1 + COUNT(*)::integer
  INTO rank
  FROM public.player_global_ratings
  WHERE rp > rating.rp;

  RETURN jsonb_build_object(
    'rp', rating.rp,
    'matches_played', rating.matches_played,
    'wins', rating.wins,
    'losses', rating.losses,
    'win_rate', CASE
      WHEN rating.matches_played = 0 THEN 0
      ELSE ROUND(rating.wins::numeric / rating.matches_played::numeric, 4)
    END,
    'global_rank', rank
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_global_rating() IS
  'Signed-in player Global RP. global_rank is 1 + count of players with strictly greater RP. Same RP shares rank.';

CREATE OR REPLACE FUNCTION public.get_match_rp_result(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  caller uuid := auth.uid();
  match_row public.matches%ROWTYPE;
  result_row public.match_rp_results%ROWTYPE;
  viewer_old integer;
  viewer_new integer;
  viewer_delta integer;
  opponent_delta integer;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'match id required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO match_row
  FROM public.matches
  WHERE id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match not found' USING ERRCODE = 'P0002';
  END IF;
  IF match_row.player_a <> caller AND match_row.player_b <> caller THEN
    RAISE EXCEPTION 'not a seated player' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO result_row
  FROM public.match_rp_results
  WHERE match_id = p_match_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'settled', false,
      'match_id', p_match_id,
      'rated', match_row.rated
    );
  END IF;

  IF caller = result_row.winner_id THEN
    viewer_old := result_row.winner_old_rp;
    viewer_new := result_row.winner_new_rp;
    viewer_delta := result_row.winner_delta;
    opponent_delta := result_row.loser_delta;
  ELSE
    viewer_old := result_row.loser_old_rp;
    viewer_new := result_row.loser_new_rp;
    viewer_delta := result_row.loser_delta;
    opponent_delta := result_row.winner_delta;
  END IF;

  RETURN jsonb_build_object(
    'settled', true,
    'rated', result_row.rated,
    'old_rp', viewer_old,
    'new_rp', viewer_new,
    'delta', viewer_delta,
    'opponent_delta', opponent_delta,
    'finish_reason', result_row.finish_reason
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS / grants
-- ---------------------------------------------------------------------------

ALTER TABLE public.player_global_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_rp_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS player_global_ratings_select_own ON public.player_global_ratings;
CREATE POLICY player_global_ratings_select_own
  ON public.player_global_ratings
  FOR SELECT
  TO authenticated
  USING (player_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS match_rp_results_select_participants ON public.match_rp_results;
CREATE POLICY match_rp_results_select_participants
  ON public.match_rp_results
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.matches m
      WHERE m.id = match_id
        AND (m.player_a = (SELECT auth.uid()) OR m.player_b = (SELECT auth.uid()))
    )
  );

REVOKE ALL ON TABLE public.player_global_ratings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.player_global_ratings TO authenticated;

REVOKE ALL ON TABLE public.match_rp_results FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.match_rp_results TO authenticated;

REVOKE ALL ON FUNCTION public.profiles_insert_global_rating() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.match_rp_results_protect_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._global_rp_expected_score(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._global_rp_elo_delta(integer, integer, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._players_are_friends(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_match_global_rp(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.accept_match_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_global_rating() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_match_rp_result(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.commit_online_game_transition(uuid, integer, uuid, integer, text, jsonb, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._forfeit_match_player(uuid, uuid) FROM PUBLIC, anon, authenticated;
