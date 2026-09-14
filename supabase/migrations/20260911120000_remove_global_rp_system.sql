-- Remove the Global RP system entirely (forward-only, not applied this turn).
--
-- USER DECISION: Global RP is retired and must not survive as an active or
-- historical production subsystem. player_global_ratings and
-- match_rp_results are dropped along with their data. No archive/export.
--
-- This migration:
--   (A) CREATE OR REPLACES every live function that calls
--       settle_match_global_rp(...) or reads player_global_ratings /
--       match_rp_results, so nothing references those tables before they
--       are dropped. Every other line of behavior is preserved exactly as
--       captured from the live database — nothing is restored from an
--       older historical function body.
--   (B) Drops the two Global RP triggers.
--   (C) Drops the Global RP functions/RPCs by their exact live signatures.
--   (D) Drops match_rp_results and player_global_ratings (data loss
--       explicitly approved by the product owner).
--   (E) No RP-specific grants, policies, views, or sequences survive step
--       (D): both tables own their own policies (auto-dropped with the
--       table, not via CASCADE to unrelated objects), no view anywhere
--       references either table, and neither table owns a standalone
--       sequence. Verified read-only against the live database before
--       writing this migration — no CASCADE is used anywhere below.
--
-- admin_list_player_rankings additionally changes signature (drops the
-- p_ruleset_id parameter — the per-ruleset breakdown was computed
-- entirely from match_rp_results and has no other data source) and its
-- wins/losses/matches_played/rp fields and ORDER BY are replaced with the
-- explicit non-RP ranking the product owner specified: LeoPips wallet
-- balance DESC, level DESC, lifetime XP DESC,
-- qualifying_public_completed_wins DESC, then name/id. This is a genuine
-- signature change, so the old 4-arg overload is dropped explicitly
-- rather than relying on CREATE OR REPLACE (which would only add a new
-- overload and leave the old one dangling).

BEGIN;

-- ---------------------------------------------------------------------
-- (A1) commit_online_game_transition — remove the settle_match_global_rp
-- call from the 'finished' branch. Every other line unchanged.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_online_game_transition(p_match_id uuid, p_expected_version integer, p_actor uuid, p_seat integer, p_action_type text, p_payload jsonb, p_public jsonb, p_engine_state jsonb, p_match_status text)
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

-- ---------------------------------------------------------------------
-- (A2) _forfeit_match_player — remove both settle_match_global_rp calls
-- (idempotent early-return branch and the main finish branch). LeoPips
-- settlement (_leopips_settle_finished_match) is untouched in both spots.
-- ---------------------------------------------------------------------
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
      PERFORM public._leopips_settle_finished_match(p_match_id);
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

  PERFORM public._leopips_settle_finished_match(p_match_id);

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

-- ---------------------------------------------------------------------
-- (A3) admin_get_user — drop the player_global_ratings join and its
-- rp/wins/losses/matches_played fields, and drop the recent_rated_matches
-- block (sourced entirely from match_rp_results). Everything else
-- (friend_count, presence, in_active_match, staff gate) unchanged.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_user(p_player_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  player_row jsonb;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  IF p_player_id IS NULL THEN
    RAISE EXCEPTION 'player required' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'player_id', p.id,
    'display_name', p.display_name,
    'username', p.username,
    'country_code', p.country_code,
    'avatar_id', p.avatar_id,
    'created_at', p.created_at,
    'deleted_at', p.deleted_at,
    'in_active_match', EXISTS (
      SELECT 1 FROM public.active_match_players amp WHERE amp.player_id = p.id
    ),
    'match_last_seen_at', (
      SELECT amp.last_seen_at
      FROM public.active_match_players amp
      WHERE amp.player_id = p.id
      LIMIT 1
    ),
    'presence_last_seen_at', (
      SELECT pr.last_seen_at
      FROM public.player_presence pr
      WHERE pr.player_id = p.id
    ),
    'friend_count', (
      SELECT COUNT(*)::integer
      FROM public.friendships f
      WHERE f.user_a = p.id OR f.user_b = p.id
    )
  )
  INTO player_row
  FROM public.profiles p
  WHERE p.id = p_player_id;

  IF player_row IS NULL THEN
    RAISE EXCEPTION 'player not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'player', player_row
  );
END;
$$;

-- ---------------------------------------------------------------------
-- (A4) admin_list_users — drop the player_global_ratings join and its
-- rp/wins/losses/matches_played fields. Search/pagination unchanged.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_users(p_search text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  wanted text;
  pattern text;
  safe_limit integer;
  safe_offset integer;
  total_count integer;
  rows jsonb;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  wanted := btrim(COALESCE(p_search, ''));
  IF char_length(wanted) > 64 THEN
    wanted := left(wanted, 64);
  END IF;

  pattern := '%' || replace(replace(replace(wanted, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
  safe_offset := GREATEST(COALESCE(p_offset, 0), 0);

  SELECT COUNT(*)::integer INTO total_count
  FROM public.profiles p
  WHERE wanted = ''
     OR p.username ILIKE pattern ESCAPE '\'
     OR p.display_name ILIKE pattern ESCAPE '\';

  SELECT COALESCE(jsonb_agg(item ORDER BY created_at DESC, player_id DESC), '[]'::jsonb)
  INTO rows
  FROM (
    SELECT
      jsonb_build_object(
        'player_id', p.id,
        'display_name', p.display_name,
        'username', p.username,
        'country_code', p.country_code,
        'avatar_id', p.avatar_id,
        'created_at', p.created_at,
        'deleted_at', p.deleted_at,
        'in_active_match', EXISTS (
          SELECT 1
          FROM public.active_match_players amp
          WHERE amp.player_id = p.id
        ),
        'match_last_seen_at', (
          SELECT amp.last_seen_at
          FROM public.active_match_players amp
          WHERE amp.player_id = p.id
          LIMIT 1
        ),
        'presence_last_seen_at', (
          SELECT pr.last_seen_at
          FROM public.player_presence pr
          WHERE pr.player_id = p.id
        )
      ) AS item,
      p.created_at,
      p.id AS player_id
    FROM public.profiles p
    WHERE wanted = ''
       OR p.username ILIKE pattern ESCAPE '\'
       OR p.display_name ILIKE pattern ESCAPE '\'
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT safe_limit
    OFFSET safe_offset
  ) listed;

  RETURN jsonb_build_object(
    'users', rows,
    'total', total_count,
    'limit', safe_limit,
    'offset', safe_offset
  );
END;
$$;

-- ---------------------------------------------------------------------
-- (A5) admin_list_live_matches — drop both player_global_ratings joins
-- (ra/rb) and the rp field on player_a/player_b. Everything else
-- (admin_status, session fields, occupancy staleness) unchanged.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_live_matches(p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  safe_limit integer;
  safe_offset integer;
  total_count integer;
  rows jsonb;
  stale_before timestamptz;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
  safe_offset := GREATEST(COALESCE(p_offset, 0), 0);
  stale_before := now() - interval '5 minutes';

  SELECT COUNT(DISTINCT amp.match_id)::integer INTO total_count
  FROM public.active_match_players amp;

  SELECT COALESCE(jsonb_agg(item ORDER BY last_activity DESC, match_id DESC), '[]'::jsonb)
  INTO rows
  FROM (
    SELECT
      jsonb_build_object(
        'match_id', m.id,
        'ruleset_id', m.ruleset_id,
        'rated', m.rated,
        'match_kind', m.match_kind,
        'stake_pips', m.stake_pips,
        'match_status', m.status,
        'created_at', m.created_at,
        'admin_status', CASE
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
          'last_seen_at', occ_a.last_seen_at,
          'stale', (occ_a.last_seen_at IS NULL OR occ_a.last_seen_at < stale_before)
        ),
        'player_b', jsonb_build_object(
          'player_id', m.player_b,
          'display_name', pb.display_name,
          'username', pb.username,
          'avatar_id', pb.avatar_id,
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
        'version', gs.version
      ) AS item,
      COALESCE(gs.updated_at, m.created_at) AS last_activity,
      m.id AS match_id
    FROM (
      SELECT DISTINCT match_id
      FROM public.active_match_players
    ) live
    INNER JOIN public.matches m ON m.id = live.match_id
    LEFT JOIN public.game_sessions gs ON gs.match_id = m.id
    LEFT JOIN public.profiles pa ON pa.id = m.player_a
    LEFT JOIN public.profiles pb ON pb.id = m.player_b
    LEFT JOIN public.active_match_players occ_a
      ON occ_a.match_id = m.id AND occ_a.player_id = m.player_a
    LEFT JOIN public.active_match_players occ_b
      ON occ_b.match_id = m.id AND occ_b.player_id = m.player_b
    ORDER BY COALESCE(gs.updated_at, m.created_at) DESC, m.id DESC
    LIMIT safe_limit
    OFFSET safe_offset
  ) listed;

  RETURN jsonb_build_object(
    'matches', rows,
    'total', total_count,
    'limit', safe_limit,
    'offset', safe_offset
  );
END;
$$;

-- ---------------------------------------------------------------------
-- (A6) admin_get_live_match_view — drop both player_global_ratings joins
-- (ra/rb) and the rp field on player_a/player_b. Everything else
-- (board, spinner, terminals, turn_deadline_at) unchanged.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_live_match_view(p_match_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
      'last_seen_at', occ_a.last_seen_at,
      'stale', (occ_a.last_seen_at IS NULL OR occ_a.last_seen_at < stale_before)
    ),
    'player_b', jsonb_build_object(
      'player_id', m.player_b,
      'display_name', pb.display_name,
      'username', pb.username,
      'avatar_id', pb.avatar_id,
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

-- ---------------------------------------------------------------------
-- (A7) admin_list_player_rankings — signature change (p_ruleset_id
-- removed: the per-ruleset breakdown was computed entirely from
-- match_rp_results and has no other data source). Explicit DROP of the
-- old 4-arg overload, then CREATE of the new 3-arg function, per the
-- product owner's exact replacement ranking spec:
--   wins/losses/matches_played (Global-RP-sourced) removed outright;
--   qualifying_public_completed_wins (player_progression) is the only
--   win counter retained, and is not relabeled as "all wins";
--   order: LeoPips wallet balance DESC, level DESC, lifetime XP DESC,
--   qualifying_public_completed_wins DESC, then name/id.
-- Search/staff-gate/pagination behavior otherwise unchanged.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_list_player_rankings(text, text, integer, integer);

CREATE FUNCTION public.admin_list_player_rankings(p_search text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  wanted text;
  pattern text;
  safe_limit integer;
  safe_offset integer;
  total_count integer;
  rows jsonb;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  wanted := btrim(COALESCE(p_search, ''));
  IF char_length(wanted) > 64 THEN
    wanted := left(wanted, 64);
  END IF;
  pattern := '%' || replace(replace(replace(wanted, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
  safe_offset := GREATEST(COALESCE(p_offset, 0), 0);

  SELECT COUNT(*)::integer INTO total_count
  FROM public.profiles p
  WHERE p.deleted_at IS NULL
    AND (
      wanted = ''
      OR p.username ILIKE pattern ESCAPE '\'
      OR p.display_name ILIKE pattern ESCAPE '\'
    );

  SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'rank')::integer), '[]'::jsonb)
  INTO rows
  FROM (
    SELECT jsonb_build_object(
      'player_id', ranked.player_id,
      'display_name', ranked.display_name,
      'username', ranked.username,
      'avatar_id', ranked.avatar_id,
      'level', ranked.level,
      'xp', ranked.xp,
      'qualifying_public_completed_wins', ranked.qualifying_wins,
      'progression_rank', ranked.progression_rank,
      'leopips_balance', ranked.leopips_balance,
      'rank', ranked.rank
    ) AS item
    FROM (
      SELECT
        p.id AS player_id,
        p.display_name,
        p.username,
        p.avatar_id,
        w.balance AS leopips_balance,
        COALESCE(pr.level, 0) AS level,
        COALESCE(pr.lifetime_xp, 0) AS xp,
        COALESCE(pr.qualifying_public_completed_wins, 0) AS qualifying_wins,
        public.progression_rank_from_level(COALESCE(pr.level, 0)) AS progression_rank,
        ROW_NUMBER() OVER (
          ORDER BY
            COALESCE(w.balance, 0) DESC,
            COALESCE(pr.level, 0) DESC,
            COALESCE(pr.lifetime_xp, 0) DESC,
            COALESCE(pr.qualifying_public_completed_wins, 0) DESC,
            lower(COALESCE(p.username, '')),
            lower(COALESCE(p.display_name, '')),
            p.id
        ) AS rank
      FROM public.profiles p
      LEFT JOIN public.player_leopips_wallets w ON w.player_id = p.id
      LEFT JOIN public.player_progression pr ON pr.player_id = p.id
      WHERE p.deleted_at IS NULL
        AND (
          wanted = ''
          OR p.username ILIKE pattern ESCAPE '\'
          OR p.display_name ILIKE pattern ESCAPE '\'
        )
    ) ranked
    ORDER BY ranked.rank
    LIMIT safe_limit
    OFFSET safe_offset
  ) listed;

  RETURN jsonb_build_object(
    'players', COALESCE(rows, '[]'::jsonb),
    'total', COALESCE(total_count, 0),
    'limit', safe_limit,
    'offset', safe_offset,
    'order', jsonb_build_array('leopipsBalance', 'level', 'xp', 'qualifyingWins', 'name'),
    'level_xp_available', true
  );
END;
$$;

COMMENT ON FUNCTION public.admin_list_player_rankings(text, integer, integer) IS
  'Staff-only ranking. Order: LeoPips wallet balance DESC, level DESC, lifetime XP DESC, qualifying_public_completed_wins DESC, then name/id. Global RP has been removed — this function never references player_global_ratings or match_rp_results.';

GRANT EXECUTE ON FUNCTION public.admin_list_player_rankings(text, integer, integer) TO authenticated;

-- ---------------------------------------------------------------------
-- (B) Drop the Global RP triggers.
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS profiles_insert_global_rating ON public.profiles;
DROP TRIGGER IF EXISTS match_rp_results_protect_immutable ON public.match_rp_results;

-- ---------------------------------------------------------------------
-- (C) Drop the Global RP functions/RPCs by their exact live signatures.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.settle_match_global_rp(uuid);
DROP FUNCTION IF EXISTS public.get_my_global_rating();
DROP FUNCTION IF EXISTS public.get_match_rp_result(uuid);
DROP FUNCTION IF EXISTS public.admin_list_player_rp_history(uuid, integer, integer);
DROP FUNCTION IF EXISTS public.admin_list_top_rp(integer, integer);
DROP FUNCTION IF EXISTS public.profiles_insert_global_rating();
DROP FUNCTION IF EXISTS public.match_rp_results_protect_immutable();
DROP FUNCTION IF EXISTS public._global_rp_elo_delta(integer, integer, numeric);
DROP FUNCTION IF EXISTS public._global_rp_expected_score(integer, integer);

-- ---------------------------------------------------------------------
-- (D) Drop the Global RP tables. Their own RLS policies
-- (player_global_ratings_select_own, match_rp_results_select_participants)
-- are dropped automatically with the table — verified read-only that no
-- foreign key, view, or sequence outside these two tables depends on
-- either one, so no CASCADE is required or used.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS public.match_rp_results;
DROP TABLE IF EXISTS public.player_global_ratings;

COMMIT;
