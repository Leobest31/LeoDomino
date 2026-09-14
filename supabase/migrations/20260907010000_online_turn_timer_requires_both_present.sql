-- Turn timer must not start until both seated players have actually joined
-- the table, not merely been assigned seats by matchmaking.
--
-- Root cause: install_online_game and commit_online_game_transition stamped
-- turn_deadline_at = now() + 30s unconditionally whenever status/phase were
-- 'playing'. install runs the instant the FIRST client calls enter (e.g.
-- Player B accepting a public request and entering before Player A has
-- loaded), so the clock started burning against a player who was never
-- shown the table yet -> false -5 LeoPips penalties, false timeout strikes,
-- false timeout wins/losses.
--
-- Fix: a new helper, _online_turn_timer_ready, is true only once BOTH seats'
-- active_match_players.joined_at are set (first-touch presence, already used
-- by the pre-start 3-minute join-timeout grace). install_online_game and the
-- re-arm branch of commit_online_game_transition consult it before ever
-- writing a non-null deadline; touch_my_match_presence opportunistically
-- arms the deadline for the first time, exactly once, the moment the second
-- seat's first heartbeat lands. The existing sweep (list_due_timeout_matches)
-- and the existing timeout-commit gate (turn_deadline_at IS NOT NULL AND <=
-- now()) already ignore a null deadline, so no change is needed there.
--
-- Does not change: CAS/version logic, 30s duration once armed, 3-strike loss
-- rule, LeoPips settlement/stake math, Haitian/American/Classic engines, the
-- 3-minute pre-start join-timeout grace, or the sweep discovery query.

BEGIN;

CREATE OR REPLACE FUNCTION public._online_turn_timer_ready(p_match_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*) >= 2
  FROM public.active_match_players a
  WHERE a.match_id = p_match_id
    AND a.joined_at IS NOT NULL;
$$;

COMMENT ON FUNCTION public._online_turn_timer_ready(uuid) IS
  'True only once both seats occupancy rows show joined_at (first table presence touch). Gates when the 30s turn deadline may first be armed. Internal helper, not a game rule.';

REVOKE ALL ON FUNCTION public._online_turn_timer_ready(uuid)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- install_online_game: only stamp a real deadline once both are present.
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
  stake_gate jsonb;
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

  -- Invariant: staked LeoPips matches cannot install/play without both debits.
  -- Atomic with this function: failure rolls back any session insert in this txn.
  stake_gate := public._leopips_require_both_match_stakes(p_match_id);

  v_phase := COALESCE(p_public->>'phase', 'playing');
  v_status := COALESCE(p_public->>'status', 'playing');
  IF v_status = 'playing' AND v_phase = 'playing' AND public._online_turn_timer_ready(p_match_id) THEN
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
    -- Idempotent re-install: still require stakes (repairs wrapper-miss races going forward).
    stake_gate := public._leopips_require_both_match_stakes(p_match_id);
    SELECT * INTO existing FROM public.game_sessions WHERE match_id = p_match_id;
    RETURN jsonb_build_object(
      'created', false,
      'version', existing.version,
      'turnDeadlineAt', existing.turn_deadline_at,
      'timeoutStrikes', existing.timeout_strikes,
      'leopips', stake_gate
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
    'timeoutStrikes', COALESCE(p_public->'timeoutStrikes', '[0,0]'::jsonb),
    'leopips', stake_gate
  );
END;
$$;

COMMENT ON FUNCTION public.install_online_game(uuid, text, jsonb, jsonb, bigint) IS
  'Service-role only. Installs the game session. turn_deadline_at is stamped only when _online_turn_timer_ready(p_match_id) is true (both seats have joined); otherwise NULL until touch_my_match_presence arms it.';

-- ---------------------------------------------------------------------------
-- commit_online_game_transition: gate only the re-arm branch. Carrying
-- forward an already-armed (or already-null) deadline is untouched, so a
-- reconnect / unrelated field update can never reset or duplicate a timer.
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
  v_rearm boolean;
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
    v_rearm := COALESCE((p_public->>'resetTurnDeadline')::boolean, false)
       OR session_row.current_seat IS DISTINCT FROM v_next_seat
       OR session_row.phase IS DISTINCT FROM 'playing';
    IF v_rearm THEN
      IF public._online_turn_timer_ready(p_match_id) THEN
        v_next_deadline := now() + interval '30 seconds';
      ELSE
        v_next_deadline := NULL;
      END IF;
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

COMMENT ON FUNCTION public.commit_online_game_transition(uuid, integer, uuid, integer, text, jsonb, jsonb, jsonb, text) IS
  'Service-role only. Locks the session, CAS on expected_version, writes timeout deadline/strikes from server now(), appends one action, increments version once. Timeout commits require turn_deadline_at <= now(). A new deadline is only armed on seat/phase change when _online_turn_timer_ready is true; carrying forward the existing deadline (null or set) is otherwise untouched so a reconnect can never reset or duplicate it.';

-- ---------------------------------------------------------------------------
-- touch_my_match_presence: opportunistically arm the deadline for the first
-- time, exactly once, the moment the second seat's first heartbeat lands.
-- The turn_deadline_at IS NULL guard makes this idempotent; the UPDATE's row
-- lock makes concurrent near-simultaneous heartbeats resolve to exactly one
-- winner (the loser's UPDATE re-checks the now-false WHERE and no-ops).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_my_match_presence(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  match_status text;
  player_a uuid;
  player_b uuid;
  seen_a timestamptz;
  seen_b timestamptz;
  joined_a timestamptz;
  joined_b timestamptz;
  action text;
  snapshot_at timestamptz;
  touched integer;
  cleaned integer;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'match id required' USING ERRCODE = '22023';
  END IF;

  SELECT m.status, m.player_a, m.player_b
  INTO match_status, player_a, player_b
  FROM public.matches m
  WHERE m.id = p_match_id;

  snapshot_at := now();

  -- Pre-mutation snapshot of both occupied last_seen_at values.
  -- Classify and abort/forfeit before the occupancy heartbeat stamp.
  IF player_a IS NOT NULL AND player_b IS NOT NULL THEN
    SELECT
      MAX(amp.last_seen_at) FILTER (WHERE amp.player_id = player_a),
      MAX(amp.last_seen_at) FILTER (WHERE amp.player_id = player_b),
      MAX(amp.joined_at) FILTER (WHERE amp.player_id = player_a),
      MAX(amp.joined_at) FILTER (WHERE amp.player_id = player_b)
    INTO seen_a, seen_b, joined_a, joined_b
    FROM public.active_match_players amp
    WHERE amp.match_id = p_match_id;

    action := public._occupancy_presence_action(
      match_status,
      seen_a,
      seen_b,
      joined_a,
      joined_b,
      snapshot_at
    );

    IF action = 'abort' THEN
      PERFORM public._abort_stale_match(p_match_id);
    ELSIF action = 'forfeit_a' THEN
      PERFORM public._forfeit_match_player(p_match_id, player_a);
    ELSIF action = 'forfeit_b' THEN
      PERFORM public._forfeit_match_player(p_match_id, player_b);
    END IF;
  END IF;

  -- Stamp only after the snapshot decision. Abort/forfeit may have already
  -- released occupancy, in which case this updates 0 rows.
  UPDATE public.active_match_players
  SET
    last_seen_at = now(),
    joined_at = COALESCE(joined_at, now())
  WHERE player_id = caller
    AND match_id = p_match_id;
  GET DIAGNOSTICS touched = ROW_COUNT;

  -- Opportunistically arm the 30s turn timer for the first time, exactly
  -- once, the moment the second seat's first heartbeat lands. The
  -- turn_deadline_at IS NULL guard makes this idempotent; the UPDATE's row
  -- lock makes concurrent near-simultaneous heartbeats resolve to exactly
  -- one winner (the loser's UPDATE re-checks the now-false WHERE and no-ops).
  IF touched > 0 THEN
    UPDATE public.game_sessions
    SET turn_deadline_at = now() + interval '30 seconds'
    WHERE match_id = p_match_id
      AND status = 'playing'
      AND phase = 'playing'
      AND turn_deadline_at IS NULL
      AND public._online_turn_timer_ready(p_match_id);
  END IF;

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
  'Seated player heartbeat. Snapshots + classifies/aborts-or-forfeits stale occupancy, then stamps last_seen_at/joined_at, then opportunistically arms turn_deadline_at (once, idempotent) once both seats have joined, then runs occupancy cleanup.';

COMMIT;
