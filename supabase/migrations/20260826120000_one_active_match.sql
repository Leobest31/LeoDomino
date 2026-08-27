-- One authenticated player may occupy at most one active online match
-- (matches.status IN ready/playing). Accept is a single transaction:
-- lock both players, re-check the request, create the match, then cancel
-- every other OPEN public request owned by either seat.

-- ---------------------------------------------------------------------------
-- Occupancy (database-level unique: player_id appears once)
-- ---------------------------------------------------------------------------

CREATE TABLE public.active_match_players (
  player_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.matches (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.active_match_players IS
  'Occupancy for live 1v1 seats. PK on player_id enforces one active match per player. Not client-writable.';

CREATE INDEX active_match_players_match_id_idx
  ON public.active_match_players (match_id);

ALTER TABLE public.active_match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_match_players FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.active_match_players FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_active_match_players()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.active_match_players WHERE match_id = OLD.id;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status IN ('ready', 'playing')
     AND NEW.status NOT IN ('ready', 'playing') THEN
    DELETE FROM public.active_match_players WHERE match_id = NEW.id;
    RETURN NEW;
  END IF;

  IF NEW.status IN ('ready', 'playing')
     AND (
       TG_OP = 'INSERT'
       OR (
         TG_OP = 'UPDATE'
         AND OLD.status NOT IN ('ready', 'playing')
       )
     ) THEN
    INSERT INTO public.active_match_players (player_id, match_id)
    VALUES (NEW.player_a, NEW.id), (NEW.player_b, NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER matches_sync_active_players
  AFTER INSERT OR UPDATE OR DELETE ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_active_match_players();

-- Existing live matches (keep the earliest seat if a player already split).
INSERT INTO public.active_match_players (player_id, match_id)
SELECT DISTINCT ON (player_id) player_id, match_id
FROM (
  SELECT player_a AS player_id, id AS match_id, created_at
  FROM public.matches
  WHERE status IN ('ready', 'playing')
  UNION ALL
  SELECT player_b AS player_id, id AS match_id, created_at
  FROM public.matches
  WHERE status IN ('ready', 'playing')
) seats
ORDER BY player_id, created_at ASC;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._matchmaking_lock_player(p_player uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  hex text := replace(p_player::text, '-', '');
BEGIN
  PERFORM pg_advisory_xact_lock(
    ('x' || substr(hex, 1, 8))::bit(32)::int,
    ('x' || substr(hex, 9, 8))::bit(32)::int
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.player_in_active_match(p_player uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.active_match_players
    WHERE player_id = p_player
  )
  OR EXISTS (
    SELECT 1
    FROM public.matches
    WHERE status IN ('ready', 'playing')
      AND (player_a = p_player OR player_b = p_player)
  );
$$;

CREATE OR REPLACE FUNCTION public.match_requests_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  NEW.creator_id := auth.uid();
  NEW.status := 'open';
  NEW.acceptor_id := NULL;
  NEW.accepted_at := NULL;
  NEW.match_id := NULL;
  NEW.created_at := now();
  NEW.expires_at := now() + interval '10 minutes';
  IF NEW.ruleset_id IS NULL OR NEW.ruleset_id NOT IN ('legacy', 'haitian', 'american') THEN
    RAISE EXCEPTION 'invalid ruleset_id' USING ERRCODE = '22023';
  END IF;
  IF public.player_in_active_match(NEW.creator_id) THEN
    RAISE EXCEPTION 'PLAYER_BUSY' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

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

  -- Serialize against a racing accept of either player's other OPEN rows.
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
    AND creator_id IN (request.creator_id, caller);

  RETURN new_match_id;
END;
$$;

REVOKE ALL ON FUNCTION public._matchmaking_lock_player(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.player_in_active_match(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_active_match_players() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_match_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_match_request(uuid) TO authenticated;

-- Informational Home indicator only. Does not accept, lock, or mutate requests.
-- Mirrors accept_match_request joinability: OPEN, unexpired, not own, creator not seated.
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
      AND r.expires_at > now()
      AND r.creator_id <> caller
      AND NOT public.player_in_active_match(r.creator_id)
  );
END;
$$;

COMMENT ON FUNCTION public.count_joinable_open_match_requests() IS
  'Informational count of OPEN public requests the caller could accept. Not used by accept_match_request.';

REVOKE ALL ON FUNCTION public.count_joinable_open_match_requests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_joinable_open_match_requests() TO authenticated;
