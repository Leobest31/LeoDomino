-- C2 lock-order prerequisite. Sessions then matches.
--
-- Hosted _forfeit_match_player (20260828220000) and _abort_stale_match /
-- join-timeout abort (20260827200000 / 20260830120000) lock matches first.
-- C2 cleanup locks game_sessions SKIP LOCKED then matches SKIP LOCKED.
-- Applying C2 without this file deadlocks:
--   cleanup holds session, waits for match
--   forfeit/abort holds match, waits for session
--
-- This file copies only the lock-order-safe bodies. Write order for forfeit
-- is unchanged: session match_over THEN matches.finished, then settle RP.
-- Abort still does not settle RP.
--
-- Does NOT change:
--   get_my_active_match (no stale=>NULL footgun)
--   list_friends_in_active_match
--   count_joinable_open_match_requests
--   cleanup_stale_occupied_matches (C2 replaces it)
--   grants / REVOKE on cleanup
--   RP math
--
-- Do NOT apply to hosted Supabase until explicitly approved.
-- Apply AFTER 20260831120000 no-op marker, BEFORE 20260902220000.

BEGIN;

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

  SELECT * INTO session_row
  FROM public.game_sessions
  WHERE match_id = p_match_id
  FOR UPDATE;

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
    IF match_row.status = 'finished' THEN
      PERFORM public.settle_match_global_rp(p_match_id);
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'matchId', match_row.id,
      'status', match_row.status,
      'winnerSeat', COALESCE(session_row.match_winner_seat, winner_seat),
      'forfeitSeat', forfeit_seat
    );
  END IF;

  -- Public terminal row first so both seated clients can observe match_over
  -- before occupancy is released by matches.status = finished.
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

  UPDATE public.matches
  SET
    status = 'finished',
    finished_at = COALESCE(finished_at, now()),
    finish_reason = COALESCE(finish_reason, 'forfeit')
  WHERE id = p_match_id
    AND status IN ('ready', 'playing');

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

COMMENT ON FUNCTION public._forfeit_match_player(uuid, uuid) IS
  'Locks game_sessions then matches. Publishes match_over before matches.finished. Settles Global RP on a real forfeit. Idempotent settle on already-finished.';

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

  PERFORM 1
  FROM public.game_sessions
  WHERE match_id = p_match_id
  FOR UPDATE;

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

COMMENT ON FUNCTION public._abort_stale_match(uuid) IS
  'Locks game_sessions then matches. Shared-disconnect abort: no winner, no RP.';

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

  PERFORM 1
  FROM public.game_sessions
  WHERE match_id = p_match_id
  FOR UPDATE;

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

COMMENT ON FUNCTION public._abort_join_timeout_match(uuid) IS
  'Locks game_sessions then matches. Join-timeout abort: no winner, no RP.';

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

  PERFORM 1
  FROM public.game_sessions
  WHERE match_id = p_match_id
  FOR UPDATE;

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
  'Locks game_sessions then matches. Join-waiting past 3 minutes: abort without RP. No-op once both joined and a session exists.';

COMMIT;
