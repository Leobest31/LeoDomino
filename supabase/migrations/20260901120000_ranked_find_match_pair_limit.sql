-- V1 ranked Find Match pair limit: same unordered pair may start at most
-- 3 public rated games in a rolling 24-hour window.
-- Count is matches.created_at at successful accept/create. No game_sessions
-- join. Terminal status / finish_reason / winner / score do not exclude.
-- Enforced in accept_match_request after player advisory locks and
-- PLAYER_BUSY, before INSERT. Friend invites remain unrated and unlimited.
-- RP math unchanged.

BEGIN;

-- ---------------------------------------------------------------------------
-- Qualifying ranked Find Match: public, rated, created in the previous
-- 24 hours. Source of truth: public.matches. A vs B equals B vs A.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ranked_find_match_qualifying_count(p_a uuid, p_b uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_a IS NULL OR p_b IS NULL OR p_a = p_b THEN 0
    ELSE (
      SELECT COUNT(*)::integer
      FROM public.matches m
      WHERE m.rated = true
        AND m.match_kind = 'public'
        AND public.uuid_pair_low(m.player_a, m.player_b) = public.uuid_pair_low(p_a, p_b)
        AND public.uuid_pair_high(m.player_a, m.player_b) = public.uuid_pair_high(p_a, p_b)
        AND m.created_at >= now() - interval '24 hours'
    )
  END;
$$;

COMMENT ON FUNCTION public.ranked_find_match_qualifying_count(uuid, uuid) IS
  'Count of public rated Find Match games this unordered pair accepted/created in the rolling previous 24 hours. Uses matches.created_at. Does not require game_sessions. Does not filter finish_reason, status, winner, or score. Friend/unrated rows are excluded by rated/match_kind. A vs B equals B vs A.';

CREATE OR REPLACE FUNCTION public.ranked_find_match_pair_limit_reached(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_a IS NOT NULL
    AND p_b IS NOT NULL
    AND p_a IS DISTINCT FROM p_b
    AND NOT public._players_are_friends(p_a, p_b)
    AND public.ranked_find_match_qualifying_count(p_a, p_b) >= 3;
$$;

COMMENT ON FUNCTION public.ranked_find_match_pair_limit_reached(uuid, uuid) IS
  'True when a public rated Find Match between these two non-friends would be a 4th accepted/created game in 24 hours. Friends and unrated matches never increment the cap.';

CREATE OR REPLACE FUNCTION public.list_ranked_find_match_blocked_opponents()
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;
  RETURN ARRAY(
    SELECT other_id
    FROM (
      SELECT
        CASE WHEN m.player_a = caller THEN m.player_b ELSE m.player_a END AS other_id
      FROM public.matches m
      WHERE m.rated = true
        AND m.match_kind = 'public'
        AND (m.player_a = caller OR m.player_b = caller)
        AND m.created_at >= now() - interval '24 hours'
    ) pairs
    WHERE NOT public._players_are_friends(caller, other_id)
    GROUP BY other_id
    HAVING COUNT(*) >= 3
  );
END;
$$;

COMMENT ON FUNCTION public.list_ranked_find_match_blocked_opponents() IS
  'Read-only. Opponent ids the caller cannot public-rate-pair with right now. Does not block Find Match with anyone else. Does not run cleanup.';

-- ---------------------------------------------------------------------------
-- Lobby count skips pair-blocked creators so Home/Find Match keep showing
-- other eligible open requests.
-- ---------------------------------------------------------------------------

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
      AND NOT public.ranked_find_match_pair_limit_reached(r.creator_id, caller)
      AND NOT EXISTS (
        SELECT 1
        FROM public.active_match_players a
        JOIN public.matches m ON m.id = a.match_id
        WHERE a.player_id = r.creator_id
          AND m.status IN ('ready', 'playing')
          AND (
            a.last_seen_at >= now() - interval '5 minutes'
            OR (
              a.joined_at IS NULL
              AND COALESCE(
                (SELECT req.accepted_at FROM public.match_requests req WHERE req.id = m.request_id),
                m.created_at
              ) + interval '3 minutes' > now()
            )
          )
      )
  );
END;
$$;

COMMENT ON FUNCTION public.count_joinable_open_match_requests() IS
  'Read-only public OPEN request count excluding the caller, live occupancy, and pair-limited ranked opponents. Does not run cleanup.';

-- ---------------------------------------------------------------------------
-- Authoritative accept: same player locks + PLAYER_BUSY, then pair limit
-- before INSERT. Friend visibility never hits the ranked pair cap.
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

  IF COALESCE(request.visibility, 'public') IS DISTINCT FROM 'friend'
     AND public.ranked_find_match_pair_limit_reached(request.creator_id, caller) THEN
    RAISE EXCEPTION 'RANKED_PAIR_LIMIT' USING ERRCODE = 'P0004';
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

REVOKE ALL ON FUNCTION public.ranked_find_match_qualifying_count(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ranked_find_match_pair_limit_reached(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_ranked_find_match_blocked_opponents() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.count_joinable_open_match_requests() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_match_request(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.ranked_find_match_pair_limit_reached(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_ranked_find_match_blocked_opponents() TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_joinable_open_match_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_match_request(uuid) TO authenticated;

COMMIT;
