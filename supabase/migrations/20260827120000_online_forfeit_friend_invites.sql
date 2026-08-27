-- Authoritative online forfeit + private friend-match invitations.
-- Reuses matches, occupancy, accept_match_request, and game_sessions Realtime.
-- Does not rewrite previously applied migrations.

-- ---------------------------------------------------------------------------
-- A. Friend invitations ride match_requests with visibility=friend.
--    Public Find Match stays visibility=public (default).
-- ---------------------------------------------------------------------------

ALTER TABLE public.match_requests
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';

ALTER TABLE public.match_requests
  ADD COLUMN IF NOT EXISTS invitee_id uuid REFERENCES public.profiles (id) ON DELETE CASCADE;

ALTER TABLE public.match_requests
  DROP CONSTRAINT IF EXISTS match_requests_visibility_check;

ALTER TABLE public.match_requests
  ADD CONSTRAINT match_requests_visibility_check
  CHECK (visibility IN ('public', 'friend'));

ALTER TABLE public.match_requests
  DROP CONSTRAINT IF EXISTS match_requests_status_check;

ALTER TABLE public.match_requests
  ADD CONSTRAINT match_requests_status_check
  CHECK (status IN ('open', 'accepted', 'cancelled', 'expired', 'declined'));

ALTER TABLE public.match_requests
  DROP CONSTRAINT IF EXISTS match_requests_friend_shape;

ALTER TABLE public.match_requests
  ADD CONSTRAINT match_requests_friend_shape CHECK (
    (visibility = 'public' AND invitee_id IS NULL)
    OR (
      visibility = 'friend'
      AND invitee_id IS NOT NULL
      AND invitee_id <> creator_id
    )
  );

DROP INDEX IF EXISTS public.match_requests_one_open_per_creator;

CREATE UNIQUE INDEX IF NOT EXISTS match_requests_one_open_public_per_creator
  ON public.match_requests (creator_id)
  WHERE status = 'open' AND visibility = 'public';

CREATE UNIQUE INDEX IF NOT EXISTS match_requests_one_open_friend_pair
  ON public.match_requests (
    public.uuid_pair_low(creator_id, invitee_id),
    public.uuid_pair_high(creator_id, invitee_id)
  )
  WHERE status = 'open' AND visibility = 'friend';

CREATE INDEX IF NOT EXISTS match_requests_invitee_open_idx
  ON public.match_requests (invitee_id, created_at DESC)
  WHERE status = 'open' AND visibility = 'friend';

COMMENT ON COLUMN public.match_requests.visibility IS
  'public = Find Match lobby. friend = private directed invite. Never listed as a public OPEN request.';
COMMENT ON COLUMN public.match_requests.invitee_id IS
  'Recipient of a friend invite. NULL for public Find Match rows.';

-- ---------------------------------------------------------------------------
-- B. Insert trigger: public inserts unchanged; friend inserts validate friendship.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.match_requests_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  low_id uuid;
  high_id uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  UPDATE public.match_requests
  SET status = 'expired'
  WHERE creator_id = caller
    AND status = 'open'
    AND expires_at <= now();

  NEW.creator_id := caller;
  NEW.status := 'open';
  NEW.acceptor_id := NULL;
  NEW.accepted_at := NULL;
  NEW.match_id := NULL;
  NEW.created_at := now();
  NEW.expires_at := now() + interval '10 minutes';
  IF NEW.visibility IS NULL OR NEW.visibility = '' THEN
    NEW.visibility := 'public';
  END IF;
  IF NEW.ruleset_id IS NULL OR NEW.ruleset_id NOT IN ('legacy', 'haitian', 'american') THEN
    RAISE EXCEPTION 'invalid ruleset_id' USING ERRCODE = '22023';
  END IF;
  IF NEW.visibility = 'public' THEN
    NEW.invitee_id := NULL;
  ELSIF NEW.visibility = 'friend' THEN
    IF NEW.invitee_id IS NULL THEN
      RAISE EXCEPTION 'invitee required' USING ERRCODE = '22023';
    END IF;
    IF NEW.invitee_id = caller THEN
      RAISE EXCEPTION 'cannot invite yourself' USING ERRCODE = '22023';
    END IF;
    low_id := public.uuid_pair_low(caller, NEW.invitee_id);
    high_id := public.uuid_pair_high(caller, NEW.invitee_id);
    IF NOT EXISTS (
      SELECT 1 FROM public.friendships
      WHERE user_a = low_id AND user_b = high_id
    ) THEN
      RAISE EXCEPTION 'not friends' USING ERRCODE = '42501';
    END IF;
    IF public.player_in_active_match(NEW.invitee_id) THEN
      RAISE EXCEPTION 'PLAYER_BUSY' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid visibility' USING ERRCODE = '22023';
  END IF;
  IF public.player_in_active_match(NEW.creator_id) THEN
    RAISE EXCEPTION 'PLAYER_BUSY' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- C. Accept: public unchanged; friend invites only the invitee, still friends.
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
    INSERT INTO public.matches (request_id, ruleset_id, player_a, player_b, status)
    VALUES (request.id, request.ruleset_id, request.creator_id, caller, 'ready')
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

CREATE OR REPLACE FUNCTION public.count_joinable_open_match_requests()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RETURN 0;
  END IF;
  RETURN (
    SELECT COUNT(*)::integer
    FROM public.match_requests r
    WHERE r.status = 'open'
      AND COALESCE(r.visibility, 'public') = 'public'
      AND r.expires_at > now()
      AND r.creator_id <> caller
      AND NOT public.player_in_active_match(r.creator_id)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- D. Friend invite RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.send_friend_match_invite(p_invitee_id uuid, p_ruleset_id text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  new_id uuid;
  first_player uuid;
  second_player uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_invitee_id IS NULL THEN
    RAISE EXCEPTION 'invitee required' USING ERRCODE = '22023';
  END IF;
  IF p_invitee_id = caller THEN
    RAISE EXCEPTION 'cannot invite yourself' USING ERRCODE = '22023';
  END IF;

  IF caller < p_invitee_id THEN
    first_player := caller;
    second_player := p_invitee_id;
  ELSE
    first_player := p_invitee_id;
    second_player := caller;
  END IF;
  PERFORM public._matchmaking_lock_player(first_player);
  PERFORM public._matchmaking_lock_player(second_player);

  IF public.player_in_active_match(caller)
     OR public.player_in_active_match(p_invitee_id) THEN
    RAISE EXCEPTION 'PLAYER_BUSY' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.match_requests (ruleset_id, visibility, invitee_id)
  VALUES (p_ruleset_id, 'friend', p_invitee_id)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

COMMENT ON FUNCTION public.send_friend_match_invite(uuid, text) IS
  'Authenticated player invites a current friend to a private 1v1. Not listed in public Find Match.';

CREATE OR REPLACE FUNCTION public.decline_friend_match_invite(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  updated integer;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  UPDATE public.match_requests
  SET status = 'declined'
  WHERE id = p_request_id
    AND visibility = 'friend'
    AND invitee_id = caller
    AND status = 'open';

  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated = 0 THEN
    IF EXISTS (
      SELECT 1
      FROM public.match_requests
      WHERE id = p_request_id
        AND visibility = 'friend'
        AND invitee_id = caller
        AND status = 'declined'
    ) THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'cannot decline invitation' USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.decline_friend_match_invite(uuid) IS
  'Invitee declines a pending friend match invite. No match is created.';

REVOKE ALL ON FUNCTION public.send_friend_match_invite(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_friend_match_invite(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.decline_friend_match_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_friend_match_invite(uuid) TO authenticated;

DROP POLICY IF EXISTS match_requests_select_relevant ON public.match_requests;
CREATE POLICY match_requests_select_relevant
  ON public.match_requests
  FOR SELECT
  TO authenticated
  USING (
    creator_id = auth.uid()
    OR acceptor_id = auth.uid()
    OR invitee_id = auth.uid()
    OR (
      status = 'open'
      AND COALESCE(visibility, 'public') = 'public'
    )
  );

-- ---------------------------------------------------------------------------
-- E. Authoritative forfeit: winner is the opponent of auth.uid().
-- ---------------------------------------------------------------------------

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
  SET status = 'finished'
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

COMMENT ON FUNCTION public.forfeit_online_match(uuid) IS
  'Seated player intentionally forfeits. Opponent is derived as winner. Ends occupancy and the live session. Duplicate calls are idempotent.';

CREATE OR REPLACE FUNCTION public.abort_online_match(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.forfeit_online_match(p_match_id);
END;
$$;

REVOKE ALL ON FUNCTION public.forfeit_online_match(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forfeit_online_match(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.abort_online_match(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abort_online_match(uuid) TO authenticated;
