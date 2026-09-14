-- C2: shared-outage / both-stale occupancy must abort, never one-sided forfeit.
--
-- Root cause: touch_my_match_presence stamped last_seen_at = now() for the
-- returning player, THEN called cleanup_stale_occupied_matches(). If both
-- seats were stale past the 5-minute grace, the first reconnecter looked
-- fresh and cleanup forfeited the still-stale opponent (including Global RP).
--
-- Fix: classify both occupied last_seen_at values from one pre-mutation
-- snapshot. Apply abort/forfeit from that snapshot, THEN stamp last_seen_at.
-- Result is identical whether A or B reconnects first.
--
-- Lock order: requires 20260902210000_sessions_then_matches_lock_order.sql
-- (NOT the withheld 20260831120000 D3 body).
--   cleanup: candidate filter (no lock) → game_sessions SKIP LOCKED → matches SKIP LOCKED
--   abort / forfeit: game_sessions then matches (from 20260902210000)
--   commit_online_game_transition: game_sessions FOR UPDATE, then UPDATE matches
-- Touch does not take a new lock order. It classifies, then calls abort/forfeit
-- (sessions then matches, already held if nested), then UPDATEs occupancy.
-- Occupancy is not locked by commit, so the occupancy stamp cannot deadlock
-- with gameplay CAS.
--
-- Does not revoke client EXECUTE on cleanup (D3). Does not remove cleanup from
-- remaining write-path callers. Does not change RP math, 5-minute grace, or
-- 3-minute join timeout.
-- Do NOT apply to hosted Supabase until explicitly approved.

BEGIN;

-- ---------------------------------------------------------------------------
-- One classifier for cleanup and heartbeat. Snapshot in, action out.
-- 'none' | 'abort' | 'forfeit_a' | 'forfeit_b'
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._occupancy_presence_action(
  p_status text,
  p_seen_a timestamptz,
  p_seen_b timestamptz,
  p_joined_a timestamptz,
  p_joined_b timestamptz,
  p_now timestamptz
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  grace constant interval := interval '5 minutes';
  stale_a boolean;
  stale_b boolean;
BEGIN
  -- Terminal matches are never mutated by occupancy cleanup.
  IF p_status IS NULL OR p_status NOT IN ('ready', 'playing') THEN
    RETURN 'none';
  END IF;

  -- Join-waiting is resolve_join_timeout, never a 5-minute forfeit/abort.
  IF p_joined_a IS NULL OR p_joined_b IS NULL THEN
    RETURN 'none';
  END IF;

  IF p_seen_a IS NULL AND p_seen_b IS NULL THEN
    RETURN 'none';
  END IF;

  stale_a := p_seen_a IS NULL OR p_seen_a < p_now - grace;
  stale_b := p_seen_b IS NULL OR p_seen_b < p_now - grace;

  IF NOT stale_a AND NOT stale_b THEN
    RETURN 'none';
  ELSIF stale_a AND stale_b THEN
    -- Shared outage: abort, no winner, no loser, no Global RP.
    RETURN 'abort';
  ELSIF stale_a THEN
    RETURN 'forfeit_a';
  ELSE
    RETURN 'forfeit_b';
  END IF;
END;
$$;

COMMENT ON FUNCTION public._occupancy_presence_action(text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) IS
  'C2 occupancy classifier. One pre-mutation snapshot of both last_seen_at values. neither stale → none; one stale → forfeit that seat; both stale → abort (no winner, no RP). Join-waiting and terminal statuses → none.';

-- ---------------------------------------------------------------------------
-- Cleanup: candidate filter + SKIP LOCKED sessions then matches (commit-compatible).
-- After locks, read BOTH occupancy timestamps in one snapshot, then classify.
-- ---------------------------------------------------------------------------

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

    SELECT 1 INTO session_lock
    FROM public.game_sessions
    WHERE match_id = rec.id
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
  'C2 janitor. Candidate filter before locks. Locks game_sessions then matches with SKIP LOCKED. Classifies both last_seen_at from one snapshot. Join-waiting past 3 minutes: abort without RP. After both joined: neither stale → no-op; one stale → forfeit; both stale → abort (no winner, no RP). Idempotent.';

-- ---------------------------------------------------------------------------
-- Heartbeat: snapshot + classify THIS match before stamping last_seen_at.
-- Then sweep other matches. Order-independent for shared outages.
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
  'Seated player heartbeat. Classifies both occupancy timestamps from a pre-mutation snapshot, applies abort/forfeit, THEN stamps last_seen_at / joined_at. Both-stale shared outage aborts with no winner and no RP regardless of who reconnects first. Then runs occupancy cleanup for other matches.';

REVOKE ALL ON FUNCTION public._occupancy_presence_action(text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;

COMMIT;
