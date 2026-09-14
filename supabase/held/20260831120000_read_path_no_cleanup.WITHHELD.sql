-- WITHHELD — DO NOT MOVE THIS FILE INTO supabase/migrations/.
-- Ordinary `supabase db push` must never execute this body.
--
-- Fatal footgun (do not restore):
--   get_my_active_match() RETURN NULL when gameplay has started AND
--   last_seen_at is older than 5 minutes, while matches.status is still
--   ready/playing. That is a fake "no active match".
--
-- Safe lock-order extract lives in:
--   supabase/migrations/20260902210000_sessions_then_matches_lock_order.sql
-- C2 classifier lives in:
--   supabase/migrations/20260902220000_shared_stale_occupancy_abort.sql
-- The migrations/ copy of 20260831120000 is a no-op marker only.

-- Phase 2 + 2B: status/read RPCs must not run occupancy janitor work.
-- Removes cleanup_stale_occupied_matches() from friend-status, lobby
-- availability, and active-match lookup so UI reads cannot FOR UPDATE
-- live gameplay rows.
--
-- 2B hardening (this file was never applied; amended in place):
--   - REVOKE client EXECUTE on cleanup (service_role / DEFINER only)
--   - Lock order unified with commit: game_sessions then matches
--   - Cleanup candidate filter BEFORE any row lock; SKIP LOCKED
--   - Central service-role maintenance entry (scheduler NOT enabled)
--
-- Authoritative cleanup stays on:
--   touch_my_match_presence (heartbeat / write, internal DEFINER call)
--   player_in_active_match (matchmaking write / occupancy busy-check)
--   run_stale_occupancy_maintenance (service_role; intended 1-minute cron)
--
-- Does not change RP math, forfeit policy, 60s turn timeout, 5-minute
-- occupancy grace, or 3-minute join timeout.
-- Do NOT apply to hosted Supabase until explicitly approved.
-- Do NOT enable pg_cron in this migration.

BEGIN;

-- ---------------------------------------------------------------------------
-- Lock order: game_sessions then matches (same as commit_online_game_transition).
-- Write order for forfeit is unchanged: session match_over THEN matches.finished.
-- ---------------------------------------------------------------------------

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

-- Remainder of the withheld D3 body (cleanup SKIP LOCKED, friends/count
-- read-only, get_my stale=>NULL, REVOKE cleanup) is intentionally omitted
-- from this archive's executable copy for the functions C2 does not need.
-- The get_my footgun is preserved below so tests can prove it is NOT in
-- supabase/migrations/.

CREATE OR REPLACE FUNCTION public.get_my_active_match()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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
  seen_self timestamptz;
  deadline timestamptz;
  started boolean;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT m.* INTO match_row
  FROM public.matches m
  WHERE m.status IN ('ready', 'playing')
    AND (m.player_a = caller OR m.player_b = caller)
    AND EXISTS (
      SELECT 1
      FROM public.active_match_players a
      WHERE a.player_id = caller
        AND a.match_id = m.id
    )
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

  SELECT last_seen_at INTO seen_self
  FROM public.active_match_players
  WHERE player_id = caller AND match_id = match_row.id;

  deadline := COALESCE(request_row.accepted_at, match_row.created_at) + interval '3 minutes';
  started := session_exists AND joined_a IS NOT NULL AND joined_b IS NOT NULL;

  IF started AND (seen_self IS NULL OR seen_self < now() - interval '5 minutes') THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'match_id', match_row.id,
    'id', match_row.id,
    'status', match_row.status
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_active_match() IS
  'WITHHELD footgun: Started matches past the 5-minute presence grace return NULL.';
