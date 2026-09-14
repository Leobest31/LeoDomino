-- Public Find Match waiting heartbeat grace for mobile discovery.
-- Does NOT change LeoPips debit/payout, style matching, or friend invites.
--
-- Before: 30s heartbeat miss permanently expired public opens and hid them
-- from list_joinable / accept.
-- After:
--   * joinable / accept freshness = 5 minutes
--   * permanent heartbeat expire = 5 minutes (still respects expires_at)
--   * touch refreshes the caller first, then expires others

BEGIN;

CREATE OR REPLACE FUNCTION public.expire_stale_open_match_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
  n_heartbeat integer;
BEGIN
  UPDATE public.match_requests
  SET status = 'expired'
  WHERE status = 'open'
    AND expires_at <= now();
  GET DIAGNOSTICS n = ROW_COUNT;

  -- Permanent heartbeat expire only after a mobile-safe grace (5 minutes).
  -- Temporary gaps must not kill a still-valid waiting request.
  UPDATE public.match_requests
  SET status = 'expired'
  WHERE status = 'open'
    AND COALESCE(visibility, 'public') = 'public'
    AND (
      waiting_heartbeat_at IS NULL
      OR waiting_heartbeat_at < now() - interval '5 minutes'
    );
  GET DIAGNOSTICS n_heartbeat = ROW_COUNT;

  RETURN n + n_heartbeat;
END;
$$;

COMMENT ON FUNCTION public.expire_stale_open_match_requests() IS
  'Expires OPEN rows past expires_at, and public waiting rows whose heartbeat is older than 5 minutes (or NULL). Friend OPEN invites are not heartbeat-expired.';

CREATE OR REPLACE FUNCTION public.touch_my_open_public_request()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  n integer;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  -- Caller-scoped refresh first so a slightly late beat cannot be killed by
  -- expire_stale before it lands. Never extends past expires_at.
  UPDATE public.match_requests
  SET waiting_heartbeat_at = now()
  WHERE creator_id = caller
    AND status = 'open'
    AND COALESCE(visibility, 'public') = 'public'
    AND expires_at > now();
  GET DIAGNOSTICS n = ROW_COUNT;

  PERFORM public.expire_stale_open_match_requests();

  RETURN n > 0;
END;
$$;

COMMENT ON FUNCTION public.touch_my_open_public_request() IS
  'Authenticated Find Match waiting heartbeat. Refreshes the caller''s open public request (auth.uid only) before expiring other stale public waits. Does not resurrect expired rows or extend past expires_at.';

REVOKE ALL ON FUNCTION public.touch_my_open_public_request() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_my_open_public_request() TO authenticated;

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
      AND r.waiting_heartbeat_at IS NOT NULL
      AND r.waiting_heartbeat_at >= now() - interval '5 minutes'
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
  'Read-only public OPEN request count excluding the caller, live occupancy, pair-limited ranked opponents, and public waits with heartbeat older than 5 minutes. Does not run cleanup.';

CREATE OR REPLACE FUNCTION public.list_joinable_open_match_requests(
  p_ruleset_id text,
  p_stake_pips integer
)
RETURNS TABLE (
  id uuid,
  creator_id uuid,
  ruleset_id text,
  stake_pips integer,
  status text,
  created_at timestamptz,
  expires_at timestamptz,
  match_id uuid,
  acceptor_id uuid,
  visibility text,
  invitee_id uuid,
  waiting_heartbeat_at timestamptz,
  display_name text,
  avatar_id text,
  country_code text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RETURN;
  END IF;
  IF p_ruleset_id IS NULL OR p_ruleset_id NOT IN ('legacy', 'haitian', 'american') THEN
    RETURN;
  END IF;
  IF p_stake_pips IS NULL OR p_stake_pips NOT IN (20, 50, 100, 150) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.creator_id,
    r.ruleset_id,
    r.stake_pips,
    r.status,
    r.created_at,
    r.expires_at,
    r.match_id,
    r.acceptor_id,
    r.visibility,
    r.invitee_id,
    r.waiting_heartbeat_at,
    COALESCE(p.display_name, 'Player'),
    COALESCE(p.avatar_id, 'marcus'),
    COALESCE(p.country_code, '')
  FROM public.match_requests r
  LEFT JOIN public.profiles p ON p.id = r.creator_id
  WHERE r.status = 'open'
    AND COALESCE(r.visibility, 'public') = 'public'
    AND r.expires_at > now()
    AND r.waiting_heartbeat_at IS NOT NULL
    AND r.waiting_heartbeat_at >= now() - interval '5 minutes'
    AND r.creator_id <> caller
    AND r.ruleset_id = p_ruleset_id
    AND r.stake_pips = p_stake_pips
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
  ORDER BY r.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.list_joinable_open_match_requests(text, integer) IS
  'Read-only exact LeoPips lobby list: public OPEN + heartbeat within 5 minutes + exact ruleset_id + exact stake_pips. NULL stake never matches. Does not run cleanup.';

REVOKE ALL ON FUNCTION public.list_joinable_open_match_requests(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_joinable_open_match_requests(text, integer) TO authenticated;

-- Accept: only the public heartbeat freshness window changes (30s → 5 minutes).
CREATE OR REPLACE FUNCTION public.accept_match_request(
  p_request_id uuid,
  p_ruleset_id text DEFAULT NULL,
  p_stake_pips integer DEFAULT NULL
)
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

  IF COALESCE(request.visibility, 'public') IS DISTINCT FROM 'friend'
     AND (
       request.waiting_heartbeat_at IS NULL
       OR request.waiting_heartbeat_at < now() - interval '5 minutes'
     ) THEN
    UPDATE public.match_requests
    SET status = 'expired'
    WHERE id = request.id AND status = 'open';
    RAISE EXCEPTION 'CREATOR_UNAVAILABLE' USING ERRCODE = 'P0005';
  END IF;

  IF COALESCE(request.visibility, 'public') IS DISTINCT FROM 'friend' THEN
    IF request.stake_pips IS NOT NULL THEN
      IF p_ruleset_id IS NULL OR p_stake_pips IS NULL THEN
        RAISE EXCEPTION 'LOBBY_REQUIRED' USING ERRCODE = 'P0006';
      END IF;
      IF p_ruleset_id IS DISTINCT FROM request.ruleset_id
         OR p_stake_pips IS DISTINCT FROM request.stake_pips THEN
        RAISE EXCEPTION 'LOBBY_MISMATCH' USING ERRCODE = 'P0006';
      END IF;
    ELSE
      IF p_stake_pips IS NOT NULL THEN
        RAISE EXCEPTION 'REQUEST_UNAVAILABLE' USING ERRCODE = 'P0002';
      END IF;
      IF p_ruleset_id IS NOT NULL AND p_ruleset_id IS DISTINCT FROM request.ruleset_id THEN
        RAISE EXCEPTION 'LOBBY_MISMATCH' USING ERRCODE = 'P0006';
      END IF;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.matches (
      request_id, ruleset_id, stake_pips, player_a, player_b, status, match_kind, rated
    )
    VALUES (
      request.id,
      request.ruleset_id,
      request.stake_pips,
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

COMMENT ON FUNCTION public.accept_match_request(uuid, text, integer) IS
  'Accept a Find Match or friend request. Public creators must have heartbeat within 5 minutes. Public staked rows require expected ruleset+stake. Does not debit LeoPips.';

REVOKE ALL ON FUNCTION public.accept_match_request(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_match_request(uuid, text, integer) TO authenticated;

COMMIT;
