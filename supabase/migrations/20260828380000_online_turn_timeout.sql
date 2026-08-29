-- Authoritative 60s online turn timeout.
-- Adds server deadline + per-seat strike counts on game_sessions.
-- Timeout commits stay on commit_online_game_transition (CAS + FOR UPDATE).
-- Third-strike loss reuses settle_match_global_rp (rated Elo / unrated +0).
-- Does not change Challenge, friend/rated matchmaking, occupancy grace, or the engine.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.game_sessions
  ADD COLUMN IF NOT EXISTS turn_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS timeout_strikes jsonb NOT NULL DEFAULT '[0,0]'::jsonb;

COMMENT ON COLUMN public.game_sessions.turn_deadline_at IS
  'Authoritative turn expiry. Written with now() + 60s when the live seat/phase changes. Null when no live turn.';
COMMENT ON COLUMN public.game_sessions.timeout_strikes IS
  'Per-seat timeout strike counts [seat0, seat1]. Incremented only when the seat had a legal play and the deadline expired. Third strike ends the match by timeout.';

UPDATE public.game_sessions
SET turn_deadline_at = now() + interval '60 seconds'
WHERE status = 'playing'
  AND phase = 'playing'
  AND turn_deadline_at IS NULL;

-- ---------------------------------------------------------------------------
-- Action / finish-reason contracts
-- ---------------------------------------------------------------------------

ALTER TABLE public.game_actions
  DROP CONSTRAINT IF EXISTS game_actions_type_check;
ALTER TABLE public.game_actions
  ADD CONSTRAINT game_actions_type_check
  CHECK (action_type IN ('play', 'draw', 'pass', 'advance_round', 'timeout'));

ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_finish_reason_check;
ALTER TABLE public.matches
  ADD CONSTRAINT matches_finish_reason_check
  CHECK (finish_reason IS NULL OR finish_reason IN ('completed', 'forfeit', 'aborted', 'timeout'));

DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'public.match_rp_results'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%finish_reason%completed%forfeit%'
    AND pg_get_constraintdef(oid) NOT ILIKE '%timeout%'
  LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.match_rp_results DROP CONSTRAINT %I', cname);
  END IF;
END $$;
ALTER TABLE public.match_rp_results
  DROP CONSTRAINT IF EXISTS match_rp_results_finish_reason_check;
ALTER TABLE public.match_rp_results
  ADD CONSTRAINT match_rp_results_finish_reason_check
  CHECK (finish_reason IN ('completed', 'forfeit', 'timeout'));

-- ---------------------------------------------------------------------------
-- Install: stamp the first 60s deadline from server now()
-- ---------------------------------------------------------------------------

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
    v_deadline := now() + interval '60 seconds';
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

-- ---------------------------------------------------------------------------
-- Commit: same 9-arg signature. Deadline/strikes are server-written.
-- Timeout is gated by turn_deadline_at <= now() after FOR UPDATE.
-- Duplicate callers lose the version CAS (40001) or timeout-not-due.
-- ---------------------------------------------------------------------------

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
  IF session_row.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'stale expected_version' USING ERRCODE = '40001';
  END IF;

  IF p_action_type = 'timeout' THEN
    IF session_row.status IS DISTINCT FROM 'playing'
       OR session_row.phase IS DISTINCT FROM 'playing'
       OR session_row.turn_deadline_at IS NULL
       OR session_row.turn_deadline_at > now() THEN
      RAISE EXCEPTION 'timeout not due' USING ERRCODE = 'P0001';
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
      v_next_deadline := now() + interval '60 seconds';
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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale expected_version' USING ERRCODE = '40001';
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
    'version', new_version,
    'turnDeadlineAt', v_next_deadline,
    'timeoutStrikes', v_next_strikes
  );
END;
$$;

COMMENT ON FUNCTION public.commit_online_game_transition(uuid, integer, uuid, integer, text, jsonb, jsonb, jsonb, text) IS
  'Service-role only. Locks the session, CAS on expected_version, writes timeout deadline/strikes from server now(), appends one action, increments version once. Timeout commits require turn_deadline_at <= now().';

-- ---------------------------------------------------------------------------
-- Admin spectator: remaining time is derived from turn_deadline_at + now().
-- Still public board/counts only. No hands, reserve ids, or engine_state.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_live_match_view(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  stale_before timestamptz;
  result jsonb;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'match required' USING ERRCODE = '22023';
  END IF;

  stale_before := now() - interval '5 minutes';

  SELECT jsonb_build_object(
    'match_id', m.id,
    'ruleset_id', m.ruleset_id,
    'rated', m.rated,
    'match_kind', m.match_kind,
    'match_status', m.status,
    'finish_reason', m.finish_reason,
    'created_at', m.created_at,
    'admin_status', CASE
      WHEN m.status = 'finished' AND m.finish_reason = 'forfeit' THEN 'forfeit'
      WHEN m.status = 'finished' THEN 'finished'
      WHEN m.status = 'aborted' THEN 'aborted'
      WHEN occ_a.last_seen_at IS NULL
        OR occ_a.last_seen_at < stale_before
        OR occ_b.last_seen_at IS NULL
        OR occ_b.last_seen_at < stale_before
      THEN 'disconnected'
      WHEN m.status = 'ready' THEN 'waiting'
      WHEN m.status = 'playing' THEN 'live'
      ELSE m.status
    END,
    'player_a', jsonb_build_object(
      'player_id', m.player_a,
      'display_name', pa.display_name,
      'username', pa.username,
      'avatar_id', pa.avatar_id,
      'rp', COALESCE(ra.rp, 1000),
      'last_seen_at', occ_a.last_seen_at,
      'stale', (occ_a.last_seen_at IS NULL OR occ_a.last_seen_at < stale_before)
    ),
    'player_b', jsonb_build_object(
      'player_id', m.player_b,
      'display_name', pb.display_name,
      'username', pb.username,
      'avatar_id', pb.avatar_id,
      'rp', COALESCE(rb.rp, 1000),
      'last_seen_at', occ_b.last_seen_at,
      'stale', (occ_b.last_seen_at IS NULL OR occ_b.last_seen_at < stale_before)
    ),
    'score_a', CASE WHEN gs.match_id IS NULL THEN NULL ELSE (gs.scores->>0)::integer END,
    'score_b', CASE WHEN gs.match_id IS NULL THEN NULL ELSE (gs.scores->>1)::integer END,
    'round', gs.round,
    'current_seat', gs.current_seat,
    'current_player_id', CASE gs.current_seat
      WHEN 0 THEN m.player_a
      WHEN 1 THEN m.player_b
      ELSE NULL
    END,
    'session_status', gs.status,
    'phase', gs.phase,
    'session_updated_at', gs.updated_at,
    'hand_count_a', CASE WHEN gs.match_id IS NULL THEN NULL ELSE (gs.hand_counts->>0)::integer END,
    'hand_count_b', CASE WHEN gs.match_id IS NULL THEN NULL ELSE (gs.hand_counts->>1)::integer END,
    'reserve_count', gs.reserve_count,
    'version', gs.version,
    'board', COALESCE(gs.board, '[]'::jsonb),
    'spinner', gs.spinner,
    'last_play_points', gs.last_play_points,
    'last_play_score_terminals', COALESCE(gs.last_play_score_terminals, '[]'::jsonb),
    'match_winner_seat', gs.match_winner_seat,
    'turn_deadline_at', gs.turn_deadline_at,
    'server_now', now()
  )
  INTO result
  FROM public.matches m
  LEFT JOIN public.game_sessions gs ON gs.match_id = m.id
  LEFT JOIN public.profiles pa ON pa.id = m.player_a
  LEFT JOIN public.profiles pb ON pb.id = m.player_b
  LEFT JOIN public.player_global_ratings ra ON ra.player_id = m.player_a
  LEFT JOIN public.player_global_ratings rb ON rb.player_id = m.player_b
  LEFT JOIN public.active_match_players occ_a
    ON occ_a.match_id = m.id AND occ_a.player_id = m.player_a
  LEFT JOIN public.active_match_players occ_b
    ON occ_b.match_id = m.id AND occ_b.player_id = m.player_b
  WHERE m.id = p_match_id;

  IF result IS NULL THEN
    RAISE EXCEPTION 'match not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN result;
END;
$$;
