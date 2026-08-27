-- Stale occupancy TTL: abandoned matches must not hold seats forever.
-- Heartbeat last_seen_at + opportunistic SECURITY DEFINER cleanup.
-- Does not treat short disconnects/refreshes as an instant forfeit.
-- Grace: 5 minutes without a presence touch.
--   Both seats stale  → abort (finish_reason=aborted), no completed win.
--   One seat stale    → existing forfeit policy (stale player loses).
-- Duplicate cleanup calls are idempotent.

ALTER TABLE public.active_match_players
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

UPDATE public.active_match_players a
SET last_seen_at = COALESCE(
  a.last_seen_at,
  (SELECT s.updated_at FROM public.game_sessions s WHERE s.match_id = a.match_id),
  (SELECT m.created_at FROM public.matches m WHERE m.id = a.match_id),
  a.created_at,
  now()
);

ALTER TABLE public.active_match_players
  ALTER COLUMN last_seen_at SET DEFAULT now();

ALTER TABLE public.active_match_players
  ALTER COLUMN last_seen_at SET NOT NULL;

COMMENT ON COLUMN public.active_match_players.last_seen_at IS
  'Last presence touch from the seated client. Cleanup uses a 5-minute grace so refresh/background/reconnect do not instantly forfeit.';

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

CREATE OR REPLACE FUNCTION public._abort_stale_match(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  match_row public.matches%ROWTYPE;
  updated integer;
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

  IF match_row.status NOT IN ('ready', 'playing') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'matchId', match_row.id,
      'status', match_row.status
    );
  END IF;

  UPDATE public.matches
  SET status = 'aborted'
  WHERE id = p_match_id
    AND status IN ('ready', 'playing');
  GET DIAGNOSTICS updated = ROW_COUNT;

  UPDATE public.game_sessions
  SET
    status = 'match_over',
    phase = 'matchOver',
    match_winner_seat = NULL,
    version = version + 1,
    round_result = jsonb_build_object('reason', 'abandoned'),
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
      'null'::jsonb
    ),
    '{roundResult}',
    jsonb_build_object('reason', 'abandoned')
  )
  WHERE match_id = p_match_id;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', updated = 0,
    'matchId', p_match_id,
    'status', 'aborted'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_stale_occupied_matches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  seen_a timestamptz;
  seen_b timestamptz;
  stale_a boolean;
  stale_b boolean;
  n integer := 0;
  result jsonb;
  grace constant interval := interval '5 minutes';
BEGIN
  FOR rec IN
    SELECT m.id, m.player_a, m.player_b
    FROM public.matches m
    WHERE m.status IN ('ready', 'playing')
      AND EXISTS (
        SELECT 1
        FROM public.active_match_players a
        WHERE a.match_id = m.id
          AND a.last_seen_at < now() - grace
      )
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT last_seen_at INTO seen_a
    FROM public.active_match_players
    WHERE player_id = rec.player_a AND match_id = rec.id;

    SELECT last_seen_at INTO seen_b
    FROM public.active_match_players
    WHERE player_id = rec.player_b AND match_id = rec.id;

    IF seen_a IS NULL AND seen_b IS NULL THEN
      CONTINUE;
    END IF;

    stale_a := seen_a IS NULL OR seen_a < now() - grace;
    stale_b := seen_b IS NULL OR seen_b < now() - grace;

    IF NOT stale_a AND NOT stale_b THEN
      CONTINUE;
    ELSIF stale_a AND stale_b THEN
      result := public._abort_stale_match(rec.id);
    ELSIF stale_a THEN
      result := public._forfeit_match_player(rec.id, rec.player_a);
    ELSE
      result := public._forfeit_match_player(rec.id, rec.player_b);
    END IF;

    IF COALESCE((result->>'ok')::boolean, false)
       AND NOT COALESCE((result->>'idempotent')::boolean, false) THEN
      n := n + 1;
    END IF;
  END LOOP;

  RETURN n;
END;
$$;

COMMENT ON FUNCTION public.cleanup_stale_occupied_matches() IS
  'Ends occupied matches after 5 minutes without presence. Both stale → aborted. One stale → forfeit the absent player. Idempotent.';

CREATE OR REPLACE FUNCTION public.touch_my_match_presence(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  touched integer;
  cleaned integer;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'match id required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.active_match_players
  SET last_seen_at = now()
  WHERE player_id = caller
    AND match_id = p_match_id;
  GET DIAGNOSTICS touched = ROW_COUNT;

  cleaned := public.cleanup_stale_occupied_matches();

  RETURN jsonb_build_object(
    'ok', true,
    'touched', touched > 0,
    'cleaned', cleaned
  );
END;
$$;

COMMENT ON FUNCTION public.touch_my_match_presence(uuid) IS
  'Seated player heartbeat. Updates last_seen_at then runs stale occupancy cleanup.';

CREATE OR REPLACE FUNCTION public.player_in_active_match(p_player uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.cleanup_stale_occupied_matches();
  RETURN EXISTS (
    SELECT 1
    FROM public.active_match_players
    WHERE player_id = p_player
  );
END;
$$;

COMMENT ON FUNCTION public.player_in_active_match(uuid) IS
  'True when the player occupies active_match_players after stale occupancy cleanup.';

CREATE OR REPLACE FUNCTION public.list_friends_in_active_match()
RETURNS TABLE (player_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.cleanup_stale_occupied_matches();
  RETURN QUERY
  SELECT a.player_id
  FROM public.active_match_players a
  WHERE auth.uid() IS NOT NULL
    AND a.player_id <> auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.friendships f
      WHERE (f.user_a = auth.uid() AND f.user_b = a.player_id)
         OR (f.user_b = auth.uid() AND f.user_a = a.player_id)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.count_joinable_open_match_requests()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RETURN 0;
  END IF;
  PERFORM public.cleanup_stale_occupied_matches();
  RETURN (
    SELECT COUNT(*)::integer
    FROM public.match_requests r
    WHERE r.status = 'open'
      AND COALESCE(r.visibility, 'public') = 'public'
      AND r.expires_at > now()
      AND r.creator_id <> caller
      AND NOT EXISTS (
        SELECT 1
        FROM public.active_match_players a
        WHERE a.player_id = r.creator_id
      )
  );
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
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'match id required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.matches
    WHERE id = p_match_id
      AND (player_a = caller OR player_b = caller)
  ) THEN
    RAISE EXCEPTION 'not a seated player' USING ERRCODE = '42501';
  END IF;
  RETURN public._forfeit_match_player(p_match_id, caller);
END;
$$;

REVOKE ALL ON FUNCTION public._forfeit_match_player(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._abort_stale_match(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.player_in_active_match(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_stale_occupied_matches() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.touch_my_match_presence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_occupied_matches() TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_my_match_presence(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_friends_in_active_match() TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_joinable_open_match_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.forfeit_online_match(uuid) TO authenticated;

SELECT public.cleanup_stale_occupied_matches();
