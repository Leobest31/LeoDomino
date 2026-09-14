-- Incident: repeated live 42702 (ambiguous_column) on
-- POST /rest/v1/rpc/join_or_create_public_match_request, reproduced verbatim
-- via a read-only DO block against the hosted database:
--   ERROR: 42702: column reference "match_id" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- Root cause: cleanup_stale_occupied_matches() declares a PL/pgSQL variable
-- named match_id (uuid) and, later in the same function, runs
--   SELECT 1 INTO session_lock FROM public.game_sessions
--   WHERE match_id = rec.id FOR UPDATE SKIP LOCKED;
-- with match_id left unqualified. public.game_sessions also has a column
-- named match_id, and plpgsql.variable_conflict defaults to 'error' on this
-- database (confirmed via SHOW), so PostgreSQL raises 42702 the moment this
-- statement actually executes.
--
-- cleanup_stale_occupied_matches() is called unconditionally (via
-- player_in_active_match()) from join_or_create_public_match_request(),
-- match_requests_before_insert(), and accept_match_request() — but the
-- ambiguous statement is only *reached* when its outer FOR loop finds at
-- least one 'ready'/'playing' match with a stale or still-joining occupancy
-- row. That is why the failure is intermittent and hits many different
-- users' create attempts rather than every single call.
--
-- Fix: qualify every reference to this table's match_id column with an
-- explicit alias. No other line in this function changes. Function
-- signature, return type, and all matchmaking/occupancy rules are
-- unchanged. Sibling audit of every other function reachable from
-- join_or_create_public_match_request (player_in_active_match,
-- accept_match_request, match_requests_before_insert,
-- resolve_join_timeout, _occupancy_presence_action,
-- ranked_find_match_pair_limit_reached, _forfeit_match_player,
-- _abort_stale_match) found no other declared PL/pgSQL variable that
-- collides with a table column name used unqualified in the same chain.

BEGIN;

CREATE OR REPLACE FUNCTION public.cleanup_stale_occupied_matches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  session_lock integer;
  match_id uuid;
  match_status text;
  seen_a timestamptz;
  seen_b timestamptz;
  joined_a timestamptz;
  joined_b timestamptz;
  action text;
  waiting boolean;
  n integer := 0;
  result jsonb;
  snapshot_at timestamptz;
  grace constant interval := interval '5 minutes';
BEGIN
  -- Snapshot only. No FOR UPDATE here — healthy rows must never be locked.
  FOR rec IN
    SELECT m.id, m.player_a, m.player_b
    FROM public.matches m
    WHERE m.status IN ('ready', 'playing')
      AND EXISTS (
        SELECT 1 FROM public.active_match_players a WHERE a.match_id = m.id
      )
      AND (
        EXISTS (
          SELECT 1
          FROM public.active_match_players a
          WHERE a.match_id = m.id
            AND a.last_seen_at < now() - grace
        )
        OR EXISTS (
          SELECT 1
          FROM public.active_match_players a
          LEFT JOIN public.match_requests r ON r.id = m.request_id
          WHERE a.match_id = m.id
            AND a.joined_at IS NULL
            AND COALESCE(r.accepted_at, m.created_at) + interval '3 minutes' <= now()
        )
      )
  LOOP
    session_lock := NULL;
    match_id := NULL;

    -- Fixed: qualified with gs.match_id — previously a bare "match_id"
    -- reference here collided with this function's own match_id variable
    -- and raised 42702 whenever this line was reached.
    SELECT 1 INTO session_lock
    FROM public.game_sessions gs
    WHERE gs.match_id = rec.id
    FOR UPDATE SKIP LOCKED;

    IF EXISTS (SELECT 1 FROM public.game_sessions s WHERE s.match_id = rec.id)
       AND session_lock IS NULL THEN
      -- commit_online_game_transition holds the session; skip rather than wait.
      CONTINUE;
    END IF;

    SELECT m.id, m.status INTO match_id, match_status
    FROM public.matches m
    WHERE m.id = rec.id
      AND m.status IN ('ready', 'playing')
    FOR UPDATE SKIP LOCKED;

    IF match_id IS NULL THEN
      CONTINUE;
    END IF;

    snapshot_at := now();

    -- One consistent pre-mutation snapshot of both occupied seats.
    SELECT
      MAX(amp.last_seen_at) FILTER (WHERE amp.player_id = rec.player_a),
      MAX(amp.last_seen_at) FILTER (WHERE amp.player_id = rec.player_b),
      MAX(amp.joined_at) FILTER (WHERE amp.player_id = rec.player_a),
      MAX(amp.joined_at) FILTER (WHERE amp.player_id = rec.player_b)
    INTO seen_a, seen_b, joined_a, joined_b
    FROM public.active_match_players amp
    WHERE amp.match_id = rec.id;

    waiting := joined_a IS NULL OR joined_b IS NULL;

    IF waiting THEN
      result := public.resolve_join_timeout(rec.id);
      IF COALESCE((result->>'ok')::boolean, false)
         AND NOT COALESCE((result->>'idempotent')::boolean, false) THEN
        n := n + 1;
      END IF;
      CONTINUE;
    END IF;

    action := public._occupancy_presence_action(
      match_status,
      seen_a,
      seen_b,
      joined_a,
      joined_b,
      snapshot_at
    );

    IF action = 'none' THEN
      CONTINUE;
    ELSIF action = 'abort' THEN
      result := public._abort_stale_match(rec.id);
    ELSIF action = 'forfeit_a' THEN
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
  'Sweeps ready/playing matches with stale or still-joining occupancy and resolves them via resolve_join_timeout / _abort_stale_match / _forfeit_match_player. match_id references to public.game_sessions are alias-qualified (gs.match_id) to avoid colliding with this function''s own match_id variable under plpgsql.variable_conflict = error.';

COMMIT;
