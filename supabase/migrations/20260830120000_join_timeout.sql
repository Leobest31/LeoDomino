-- Pre-start 3-minute join grace for accepted/reserved matches.
-- Distinct from the 60-second in-match turn timeout and from forfeit.
-- Do NOT apply to hosted Supabase until explicitly approved.
--
-- Reserved / not started: occupancy exists AND at least one seat has
--   joined_at IS NULL (player has not heartbeated at the table).
-- Gameplay started: game_sessions row exists AND both joined_at are set.
-- After the join deadline, abort with finish_reason=join_timeout:
--   no winner, no loser, no RP, no rated W/L. Occupancy released by
--   existing sync_active_match_players on status change.

BEGIN;

ALTER TABLE public.active_match_players
  ADD COLUMN IF NOT EXISTS joined_at timestamptz;

COMMENT ON COLUMN public.active_match_players.joined_at IS
  'First table presence touch. NULL until the seated client heartbeats. Distinct from last_seen_at, which is stamped on occupancy insert.';

-- Existing seats that already heartbeated (last_seen after insert) count as joined.
UPDATE public.active_match_players
SET joined_at = last_seen_at
WHERE joined_at IS NULL
  AND last_seen_at IS NOT NULL
  AND last_seen_at > created_at;

ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_finish_reason_check;
ALTER TABLE public.matches
  ADD CONSTRAINT matches_finish_reason_check
  CHECK (
    finish_reason IS NULL
    OR finish_reason IN ('completed', 'forfeit', 'aborted', 'timeout', 'join_timeout')
  );

-- match_rp_results stays without join_timeout: abort/join_timeout never writes a ledger row.

CREATE OR REPLACE FUNCTION public._abort_join_timeout_match(p_match_id uuid)
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
      'status', match_row.status,
      'finishReason', match_row.finish_reason
    );
  END IF;

  UPDATE public.matches
  SET
    status = 'aborted',
    finish_reason = COALESCE(finish_reason, 'join_timeout')
  WHERE id = p_match_id
    AND status IN ('ready', 'playing');
  GET DIAGNOSTICS updated = ROW_COUNT;

  UPDATE public.game_sessions
  SET
    status = 'match_over',
    phase = 'matchOver',
    match_winner_seat = NULL,
    version = version + 1,
    round_result = jsonb_build_object('reason', 'join_timeout'),
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
    jsonb_build_object('reason', 'join_timeout')
  )
  WHERE match_id = p_match_id;

  -- Join timeout must never settle Global RP. No winner, no ledger row.

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', updated = 0,
    'matchId', p_match_id,
    'status', 'aborted',
    'finishReason', 'join_timeout',
    'winner', NULL,
    'loser', NULL,
    'rpChange', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_join_timeout(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  match_row public.matches%ROWTYPE;
  request_row public.match_requests%ROWTYPE;
  joined_a timestamptz;
  joined_b timestamptz;
  session_exists boolean;
  deadline timestamptz;
  started boolean;
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
      'status', match_row.status,
      'finishReason', match_row.finish_reason
    );
  END IF;

  SELECT * INTO request_row
  FROM public.match_requests
  WHERE id = match_row.request_id;

  SELECT joined_at INTO joined_a
  FROM public.active_match_players
  WHERE player_id = match_row.player_a AND match_id = match_row.id;

  SELECT joined_at INTO joined_b
  FROM public.active_match_players
  WHERE player_id = match_row.player_b AND match_id = match_row.id;

  SELECT EXISTS (
    SELECT 1 FROM public.game_sessions s WHERE s.match_id = match_row.id
  ) INTO session_exists;

  -- Started gameplay: session installed AND both reserved players have entered.
  started := session_exists AND joined_a IS NOT NULL AND joined_b IS NOT NULL;
  IF started THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'reason', 'started',
      'matchId', match_row.id,
      'status', match_row.status
    );
  END IF;

  deadline := COALESCE(request_row.accepted_at, match_row.created_at) + interval '3 minutes';
  IF now() < deadline THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'reason', 'too_early',
      'matchId', match_row.id,
      'joinDeadlineAt', deadline
    );
  END IF;

  RETURN public._abort_join_timeout_match(p_match_id);
END;
$$;

COMMENT ON FUNCTION public.resolve_join_timeout(uuid) IS
  'Aborts a reserved match after the 3-minute join grace if either player never entered. No winner, no RP. Idempotent. No-op once gameplay has started (both joined + session).';

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
  joined_a timestamptz;
  joined_b timestamptz;
  stale_a boolean;
  stale_b boolean;
  waiting boolean;
  n integer := 0;
  result jsonb;
  grace constant interval := interval '5 minutes';
BEGIN
  FOR rec IN
    SELECT m.id, m.player_a, m.player_b
    FROM public.matches m
    WHERE m.status IN ('ready', 'playing')
      AND EXISTS (
        SELECT 1 FROM public.active_match_players a WHERE a.match_id = m.id
      )
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT last_seen_at, joined_at INTO seen_a, joined_a
    FROM public.active_match_players
    WHERE player_id = rec.player_a AND match_id = rec.id;

    SELECT last_seen_at, joined_at INTO seen_b, joined_b
    FROM public.active_match_players
    WHERE player_id = rec.player_b AND match_id = rec.id;

    waiting := joined_a IS NULL OR joined_b IS NULL;

    IF waiting THEN
      -- Pre-start: never forfeit. Join timeout aborts both seats without RP.
      result := public.resolve_join_timeout(rec.id);
      IF COALESCE((result->>'ok')::boolean, false)
         AND NOT COALESCE((result->>'idempotent')::boolean, false) THEN
        n := n + 1;
      END IF;
      CONTINUE;
    END IF;

    -- Both players have entered: existing 5-minute presence TTL.
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
  'Join-waiting matches: 3-minute abort without RP. After both players have joined: 5-minute presence TTL (both stale → aborted, one stale → forfeit). Idempotent.';

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
  SET
    last_seen_at = now(),
    joined_at = COALESCE(joined_at, now())
  WHERE player_id = caller
    AND match_id = p_match_id;
  GET DIAGNOSTICS touched = ROW_COUNT;

  cleaned := public.cleanup_stale_occupied_matches();

  RETURN jsonb_build_object(
    'ok', true,
    'touched', touched > 0,
    'cleaned', cleaned,
    'joined', true
  );
END;
$$;

COMMENT ON FUNCTION public.touch_my_match_presence(uuid) IS
  'Seated player heartbeat. First touch stamps joined_at. Then runs occupancy cleanup.';

CREATE OR REPLACE FUNCTION public.get_my_active_match()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  match_row public.matches%ROWTYPE;
  request_row public.match_requests%ROWTYPE;
  session_exists boolean;
  joined_a timestamptz;
  joined_b timestamptz;
  deadline timestamptz;
  started boolean;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  PERFORM public.cleanup_stale_occupied_matches();

  SELECT m.* INTO match_row
  FROM public.matches m
  WHERE m.status IN ('ready', 'playing')
    AND (m.player_a = caller OR m.player_b = caller)
  ORDER BY m.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO request_row FROM public.match_requests WHERE id = match_row.request_id;
  SELECT EXISTS(SELECT 1 FROM public.game_sessions s WHERE s.match_id = match_row.id) INTO session_exists;

  SELECT joined_at INTO joined_a
  FROM public.active_match_players
  WHERE player_id = match_row.player_a AND match_id = match_row.id;
  SELECT joined_at INTO joined_b
  FROM public.active_match_players
  WHERE player_id = match_row.player_b AND match_id = match_row.id;

  deadline := COALESCE(request_row.accepted_at, match_row.created_at) + interval '3 minutes';
  started := session_exists AND joined_a IS NOT NULL AND joined_b IS NOT NULL;

  RETURN jsonb_build_object(
    'match_id', match_row.id,
    'id', match_row.id,
    'request_id', match_row.request_id,
    'status', match_row.status,
    'ruleset_id', match_row.ruleset_id,
    'rated', match_row.rated,
    'player_a', match_row.player_a,
    'player_b', match_row.player_b,
    'created_at', match_row.created_at,
    'accepted_at', request_row.accepted_at,
    'join_deadline_at', deadline,
    'has_game_session', session_exists,
    'gameplay_started', started,
    'waiting_to_join', NOT started,
    'self_joined', CASE WHEN caller = match_row.player_a THEN joined_a IS NOT NULL ELSE joined_b IS NOT NULL END,
    'opponent_joined', CASE WHEN caller = match_row.player_a THEN joined_b IS NOT NULL ELSE joined_a IS NOT NULL END,
    'expired', (NOT started) AND now() >= deadline
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_active_match() IS
  'Signed-in player reserved/active match. auth.uid() only. Public lobby fields — no hands or secrets.';

REVOKE ALL ON FUNCTION public._abort_join_timeout_match(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_join_timeout(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_active_match() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.resolve_join_timeout(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_active_match() TO authenticated;

COMMIT;
