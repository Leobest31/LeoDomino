-- Public Find Match: an offline creator cannot be accepted.
-- Scope: match_requests.visibility = 'public' only. Friend invites keep
-- persistent open rows (waiting_heartbeat_at stays NULL and is ignored).
-- Creator availability is a server-trusted waiting heartbeat:
--   touch_my_open_public_request() — auth.uid() only, no client player id
--   fresh while waiting_heartbeat_at >= now() - 30 seconds
-- Stale public OPEN rows are not listed, not counted, not accept-ready,
-- and expire on the write path (insert trigger, heartbeat, accept).
-- accept_match_request revalidates after locks, before INSERT.
-- Do NOT apply to hosted Supabase until explicitly approved.

BEGIN;

ALTER TABLE public.match_requests
  ADD COLUMN IF NOT EXISTS waiting_heartbeat_at timestamptz;

COMMENT ON COLUMN public.match_requests.waiting_heartbeat_at IS
  'Public Find Match waiting heartbeat. Creator is accept-ready while this is >= now() - 30 seconds. NULL is not accept-ready. Friend invites leave this NULL.';

-- ---------------------------------------------------------------------------
-- Write-path cleanup: expires_at (all visibilities) + stale public heartbeats.
-- Friend OPEN invites are not expired by heartbeat TTL.
-- ---------------------------------------------------------------------------

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

  UPDATE public.match_requests
  SET status = 'expired'
  WHERE status = 'open'
    AND COALESCE(visibility, 'public') = 'public'
    AND (
      waiting_heartbeat_at IS NULL
      OR waiting_heartbeat_at < now() - interval '30 seconds'
    );
  GET DIAGNOSTICS n_heartbeat = ROW_COUNT;

  RETURN n + n_heartbeat;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_open_match_requests() FROM PUBLIC, anon, authenticated;

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
  IF EXISTS (
    SELECT 1 FROM public.profiles WHERE id = caller AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.match_requests
  SET status = 'expired'
  WHERE creator_id = caller
    AND status = 'open'
    AND expires_at <= now();

  PERFORM public.expire_stale_open_match_requests();

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
    NEW.waiting_heartbeat_at := now();
  ELSIF NEW.visibility = 'friend' THEN
    NEW.waiting_heartbeat_at := NULL;
    IF NEW.invitee_id IS NULL THEN
      RAISE EXCEPTION 'invitee required' USING ERRCODE = '22023';
    END IF;
    IF NEW.invitee_id = caller THEN
      RAISE EXCEPTION 'cannot invite yourself' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.profiles WHERE id = NEW.invitee_id AND deleted_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'player not found' USING ERRCODE = 'P0002';
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
-- Authenticated creator heartbeat. Identity is auth.uid() only.
-- ---------------------------------------------------------------------------

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

  PERFORM public.expire_stale_open_match_requests();

  UPDATE public.match_requests
  SET waiting_heartbeat_at = now()
  WHERE creator_id = caller
    AND status = 'open'
    AND COALESCE(visibility, 'public') = 'public';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

COMMENT ON FUNCTION public.touch_my_open_public_request() IS
  'Authenticated Find Match waiting heartbeat. Updates the caller''s open public request from auth.uid(). Does not take a client player id. Also expires stale public waiting rows.';

REVOKE ALL ON FUNCTION public.touch_my_open_public_request() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_my_open_public_request() TO authenticated;

-- ---------------------------------------------------------------------------
-- Home/Find Match lamp: public OPEN + fresh heartbeat only. Still STABLE.
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
      AND r.waiting_heartbeat_at IS NOT NULL
      AND r.waiting_heartbeat_at >= now() - interval '30 seconds'
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
  'Read-only public OPEN request count excluding the caller, live occupancy, pair-limited ranked opponents, and stale public waiting heartbeats. Does not run cleanup.';

-- ---------------------------------------------------------------------------
-- Authoritative accept: same UUID-order locks + PLAYER_BUSY + pair limit,
-- then public heartbeat revalidation immediately before INSERT.
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

  IF COALESCE(request.visibility, 'public') IS DISTINCT FROM 'friend'
     AND (
       request.waiting_heartbeat_at IS NULL
       OR request.waiting_heartbeat_at < now() - interval '30 seconds'
     ) THEN
    UPDATE public.match_requests
    SET status = 'expired'
    WHERE id = request.id AND status = 'open';
    RAISE EXCEPTION 'CREATOR_UNAVAILABLE' USING ERRCODE = 'P0005';
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

REVOKE ALL ON FUNCTION public.count_joinable_open_match_requests() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_match_request(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.count_joinable_open_match_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_match_request(uuid) TO authenticated;

COMMIT;
