-- Authoritative online turn timeout: 60s → 30s for V1 online rulesets
-- (legacy / haitian / american). Rated public and unrated friend matches.
-- Same 5-arg install and 9-arg commit signatures. Deadline still begins at
-- server now() when the live seat/phase is assigned. Client clocks cannot
-- reset or extend it. Duplicate timeout stays CAS/idempotent.
-- Does not rewrite in-flight session deadlines (next seat/phase change
-- stamps 30s). Does not change join timeout, occupancy grace, splash,
-- matchmaking heartbeat, or disconnect/forfeit.
-- Do NOT apply to hosted Supabase until explicitly approved.

BEGIN;

COMMENT ON COLUMN public.game_sessions.turn_deadline_at IS
  'Authoritative turn expiry. Written with now() + 30s when the live seat/phase changes. Null when no live turn.';

CREATE OR REPLACE FUNCTION public.install_online_game(
  p_match_id uuid,
  p_ruleset_id text,
  p_public jsonb,
  p_engine_state jsonb,
  p_deal_seed bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_id uuid;
  existing public.game_sessions%ROWTYPE;
  match_row public.matches%ROWTYPE;
  v_phase text;
  v_status text;
  v_deadline timestamptz;
BEGIN
  PERFORM public.require_service_role();
  IF p_match_id IS NULL OR p_public IS NULL OR p_engine_state IS NULL OR p_deal_seed IS NULL THEN
    RAISE EXCEPTION 'install arguments required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO match_row FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'match not found' USING ERRCODE = 'P0002';
  END IF;
  IF match_row.ruleset_id IS DISTINCT FROM p_ruleset_id THEN
    RAISE EXCEPTION 'ruleset_id must match matches.ruleset_id' USING ERRCODE = '22023';
  END IF;
  IF p_engine_state ? 'seed' AND (p_engine_state->>'seed') IS NOT NULL THEN
    NULL;
  END IF;

  v_phase := COALESCE(p_public->>'phase', 'playing');
  v_status := COALESCE(p_public->>'status', 'playing');
  IF v_status = 'playing' AND v_phase = 'playing' THEN
    v_deadline := now() + interval '30 seconds';
  ELSE
    v_deadline := NULL;
  END IF;

  INSERT INTO public.game_sessions (
    match_id, ruleset_id, status, version, current_seat, round, phase, scores,
    board, spinner, last_play_points, last_play_points_seat, last_play_score_terminals,
    reserve_count, hand_counts, round_result, match_winner_seat,
    turn_deadline_at, timeout_strikes
  )
  VALUES (
    p_match_id,
    p_ruleset_id,
    v_status,
    COALESCE((p_public->>'version')::integer, 0),
    COALESCE((p_public->>'currentSeat')::integer, 0),
    COALESCE((p_public->>'round')::integer, 1),
    v_phase,
    COALESCE(p_public->'scores', '[0,0]'::jsonb),
    COALESCE(p_public->'board', '[]'::jsonb),
    p_public->'spinner',
    COALESCE((p_public->>'lastPlayPoints')::integer, 0),
    NULLIF(p_public->>'lastPlayPointsSeat', '')::integer,
    COALESCE(p_public->'lastPlayScoreTerminals', '[]'::jsonb),
    COALESCE((p_public->>'reserveCount')::integer, 0),
    COALESCE(p_public->'handCounts', '[0,0]'::jsonb),
    p_public->'roundResult',
    NULLIF(p_public->>'matchWinnerSeat', '')::integer,
    v_deadline,
    COALESCE(p_public->'timeoutStrikes', '[0,0]'::jsonb)
  )
  ON CONFLICT (match_id) DO NOTHING
  RETURNING match_id INTO inserted_id;

  IF inserted_id IS NULL THEN
    SELECT * INTO existing FROM public.game_sessions WHERE match_id = p_match_id;
    RETURN jsonb_build_object(
      'created', false,
      'version', existing.version,
      'turnDeadlineAt', existing.turn_deadline_at,
      'timeoutStrikes', existing.timeout_strikes
    );
  END IF;

  INSERT INTO public.game_secrets (match_id, engine_state, deal_seed)
  VALUES (p_match_id, p_engine_state, p_deal_seed);

  IF match_row.status = 'ready' THEN
    UPDATE public.matches SET status = 'playing' WHERE id = p_match_id;
  END IF;

  RETURN jsonb_build_object(
    'created', true,
    'version', COALESCE((p_public->>'version')::integer, 0),
    'turnDeadlineAt', v_deadline,
    'timeoutStrikes', COALESCE(p_public->'timeoutStrikes', '[0,0]'::jsonb)
  );
END;
$$;

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
  v_next_phase text;
  v_next_status text;
  v_next_seat integer;
  v_next_deadline timestamptz;
  v_next_strikes jsonb;
  v_finish_reason text;
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

  -- Expected CAS miss: return, do not RAISE (no ERROR log, no 40001).
  IF session_row.version IS DISTINCT FROM p_expected_version THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'STALE_VERSION',
      'version', session_row.version
    );
  END IF;

  IF p_action_type = 'timeout' THEN
    IF session_row.status IS DISTINCT FROM 'playing'
       OR session_row.phase IS DISTINCT FROM 'playing'
       OR session_row.turn_deadline_at IS NULL
       OR session_row.turn_deadline_at > now() THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'TIMEOUT_NOT_DUE',
        'version', session_row.version,
        'turn_deadline_at', session_row.turn_deadline_at,
        'turnDeadlineAt', session_row.turn_deadline_at
      );
    END IF;
  END IF;

  new_version := p_expected_version + 1;
  v_next_phase := COALESCE(p_public->>'phase', session_row.phase);
  v_next_status := COALESCE(p_public->>'status', session_row.status);
  v_next_seat := COALESCE((p_public->>'currentSeat')::integer, session_row.current_seat);
  v_next_strikes := COALESCE(p_public->'timeoutStrikes', session_row.timeout_strikes, '[0,0]'::jsonb);
  v_next_deadline := NULL;

  IF v_next_status = 'playing' AND v_next_phase = 'playing' THEN
    IF COALESCE((p_public->>'resetTurnDeadline')::boolean, false)
       OR session_row.current_seat IS DISTINCT FROM v_next_seat
       OR session_row.phase IS DISTINCT FROM 'playing' THEN
      v_next_deadline := now() + interval '30 seconds';
    ELSE
      v_next_deadline := session_row.turn_deadline_at;
    END IF;
  END IF;

  UPDATE public.game_sessions
  SET
    status = v_next_status,
    version = new_version,
    current_seat = v_next_seat,
    round = COALESCE((p_public->>'round')::integer, round),
    phase = v_next_phase,
    scores = COALESCE(p_public->'scores', scores),
    board = COALESCE(p_public->'board', board),
    spinner = COALESCE(p_public->'spinner', spinner),
    last_play_points = COALESCE((p_public->>'lastPlayPoints')::integer, last_play_points),
    last_play_points_seat = NULLIF(p_public->>'lastPlayPointsSeat', '')::integer,
    last_play_score_terminals = COALESCE(p_public->'lastPlayScoreTerminals', last_play_score_terminals),
    reserve_count = COALESCE((p_public->>'reserveCount')::integer, reserve_count),
    hand_counts = COALESCE(p_public->'handCounts', hand_counts),
    round_result = p_public->'roundResult',
    match_winner_seat = NULLIF(p_public->>'matchWinnerSeat', '')::integer,
    turn_deadline_at = v_next_deadline,
    timeout_strikes = v_next_strikes
  WHERE match_id = p_match_id AND version = p_expected_version;

  -- Lost the CAS after FOR UPDATE (should be rare). Still a controlled conflict.
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'STALE_VERSION',
      'version', session_row.version
    );
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
    v_finish_reason := CASE
      WHEN p_public->>'finishReason' IN ('timeout', 'completed', 'forfeit') THEN p_public->>'finishReason'
      ELSE 'completed'
    END;
    UPDATE public.matches
    SET
      status = 'finished',
      finished_at = COALESCE(finished_at, now()),
      finish_reason = COALESCE(finish_reason, v_finish_reason)
    WHERE id = p_match_id
      AND status <> 'aborted';
    PERFORM public.settle_match_global_rp(p_match_id);
  ELSIF p_match_status = 'playing' THEN
    UPDATE public.matches
    SET status = 'playing'
    WHERE id = p_match_id AND status = 'ready';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'version', new_version,
    'turnDeadlineAt', v_next_deadline,
    'timeoutStrikes', v_next_strikes
  );
END;
$$;

COMMENT ON FUNCTION public.install_online_game(uuid, text, jsonb, jsonb, bigint) IS
  'Service-role only. Inserts one game_sessions row. Live playing turns stamp turn_deadline_at = now() + 30 seconds. Conflict returns the existing row without rewriting the deadline.';

COMMENT ON FUNCTION public.commit_online_game_transition(uuid, integer, uuid, integer, text, jsonb, jsonb, jsonb, text) IS
  'Service-role only. Locks the session, CAS on expected_version, writes timeout deadline/strikes from server now(), appends one action, increments version once. Live seat/phase changes stamp now() + 30 seconds. Timeout commits require turn_deadline_at <= now(). Stale version and timeout-not-due return {ok:false,code} without RAISE.';

COMMIT;
