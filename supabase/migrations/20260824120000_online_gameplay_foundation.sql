-- LeoDomino V1 — live 1v1 gameplay backend foundation
-- Server-authoritative sessions. matches remains the lobby/seating table.
-- Engine transitions run in the online-game Edge Function (pure JS). This
-- migration stores public/secret state, fail-closed RLS, filtered get_game_view,
-- and transactional install/commit helpers for the service role.
-- Clients must never SELECT game_secrets. Realtime publishes game_sessions only.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. game_sessions (public / safe synchronized state)
-- ---------------------------------------------------------------------------

CREATE TABLE public.game_sessions (
  match_id uuid PRIMARY KEY REFERENCES public.matches (id) ON DELETE CASCADE,
  ruleset_id text NOT NULL,
  status text NOT NULL DEFAULT 'playing',
  version integer NOT NULL DEFAULT 0,
  current_seat integer NOT NULL,
  round integer NOT NULL DEFAULT 1,
  phase text NOT NULL,
  scores jsonb NOT NULL DEFAULT '[0, 0]'::jsonb,
  board jsonb NOT NULL DEFAULT '[]'::jsonb,
  spinner jsonb,
  last_play_points integer NOT NULL DEFAULT 0,
  last_play_points_seat integer,
  last_play_score_terminals jsonb NOT NULL DEFAULT '[]'::jsonb,
  reserve_count integer NOT NULL DEFAULT 0,
  hand_counts jsonb NOT NULL DEFAULT '[0, 0]'::jsonb,
  round_result jsonb,
  match_winner_seat integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_sessions_ruleset_check CHECK (ruleset_id IN ('legacy', 'haitian', 'american')),
  CONSTRAINT game_sessions_status_check CHECK (status IN ('playing', 'round_over', 'match_over')),
  CONSTRAINT game_sessions_version_check CHECK (version >= 0),
  CONSTRAINT game_sessions_seat_check CHECK (current_seat IN (0, 1)),
  CONSTRAINT game_sessions_round_check CHECK (round >= 1),
  CONSTRAINT game_sessions_reserve_count_check CHECK (reserve_count >= 0),
  CONSTRAINT game_sessions_winner_seat_check CHECK (
    match_winner_seat IS NULL OR match_winner_seat IN (0, 1)
  ),
  CONSTRAINT game_sessions_scores_shape CHECK (
    jsonb_typeof(scores) = 'array' AND jsonb_array_length(scores) = 2
  ),
  CONSTRAINT game_sessions_hand_counts_shape CHECK (
    jsonb_typeof(hand_counts) = 'array' AND jsonb_array_length(hand_counts) = 2
  )
);

COMMENT ON TABLE public.game_sessions IS
  'Public-safe live game projection. No hands, reserve tile ids, seed, or full engine state. Realtime: version changes.';
COMMENT ON COLUMN public.game_sessions.ruleset_id IS
  'Copied from matches.ruleset_id at session create. Immutable.';
COMMENT ON COLUMN public.game_sessions.version IS
  'Monotonic action version. Increments exactly once per accepted action.';
COMMENT ON COLUMN public.game_sessions.reserve_count IS
  'Count only. Never store reserve tile ids here.';
COMMENT ON COLUMN public.game_sessions.hand_counts IS
  'Per-seat hand sizes. Never store tile ids here.';

CREATE TRIGGER game_sessions_set_updated_at
  BEFORE UPDATE ON public.game_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.game_sessions_protect_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.match_id IS DISTINCT FROM OLD.match_id THEN
    RAISE EXCEPTION 'game_sessions.match_id is immutable' USING ERRCODE = '22023';
  END IF;
  IF NEW.ruleset_id IS DISTINCT FROM OLD.ruleset_id THEN
    RAISE EXCEPTION 'game_sessions.ruleset_id is immutable' USING ERRCODE = '22023';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'game_sessions.created_at is immutable' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER game_sessions_protect_immutable
  BEFORE UPDATE ON public.game_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.game_sessions_protect_immutable();

-- ---------------------------------------------------------------------------
-- B. game_secrets (authoritative hidden state)
-- ---------------------------------------------------------------------------

CREATE TABLE public.game_secrets (
  match_id uuid PRIMARY KEY REFERENCES public.game_sessions (match_id) ON DELETE CASCADE,
  engine_state jsonb NOT NULL,
  deal_seed bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.game_secrets IS
  'Authoritative secret engine state (hands, ordered reserve, seed). Authenticated clients must never SELECT this table.';
COMMENT ON COLUMN public.game_secrets.engine_state IS
  'Full server engine snapshot. Never expose via Realtime, views, or client grants.';
COMMENT ON COLUMN public.game_secrets.deal_seed IS
  'Server-controlled deal seed. Never client-supplied.';

CREATE TRIGGER game_secrets_set_updated_at
  BEFORE UPDATE ON public.game_secrets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- C. game_actions (append-only audit)
-- ---------------------------------------------------------------------------

CREATE TABLE public.game_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.game_sessions (match_id) ON DELETE CASCADE,
  version integer NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  seat integer NOT NULL,
  action_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_actions_version_check CHECK (version >= 1),
  CONSTRAINT game_actions_seat_check CHECK (seat IN (0, 1)),
  CONSTRAINT game_actions_type_check CHECK (
    action_type IN ('play', 'draw', 'pass', 'advance_round')
  ),
  CONSTRAINT game_actions_match_version_unique UNIQUE (match_id, version)
);

COMMENT ON TABLE public.game_actions IS
  'Append-only accepted-action audit. Payloads are public-safe (no opponent hands, no reserve ids).';

CREATE INDEX game_actions_match_id_idx ON public.game_actions (match_id);

CREATE OR REPLACE FUNCTION public.game_actions_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'game_actions is append-only' USING ERRCODE = '22023';
END;
$$;

CREATE TRIGGER game_actions_append_only
  BEFORE UPDATE OR DELETE ON public.game_actions
  FOR EACH ROW
  EXECUTE FUNCTION public.game_actions_append_only();

-- ---------------------------------------------------------------------------
-- D. Participant helper
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_match_participant(p_match_id uuid, p_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(p_user, '00000000-0000-0000-0000-000000000000'::uuid) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.matches m
      WHERE m.id = p_match_id
        AND (m.player_a = p_user OR m.player_b = p_user)
    );
$$;

COMMENT ON FUNCTION public.is_match_participant(uuid, uuid) IS
  'True when the user occupies player_a or player_b on the match.';

-- ---------------------------------------------------------------------------
-- E. Filtered get_game_view (SQL). Legal moves are added by the Edge Function.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_game_view(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  match_row public.matches%ROWTYPE;
  session_row public.game_sessions%ROWTYPE;
  secret_row public.game_secrets%ROWTYPE;
  viewer_seat integer;
  my_hand jsonb;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'match id required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO match_row FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'match not found' USING ERRCODE = 'P0002';
  END IF;
  IF match_row.player_a <> caller AND match_row.player_b <> caller THEN
    RAISE EXCEPTION 'not a seated player' USING ERRCODE = '42501';
  END IF;

  viewer_seat := CASE WHEN match_row.player_a = caller THEN 0 ELSE 1 END;

  SELECT * INTO session_row FROM public.game_sessions WHERE match_id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game session not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO secret_row FROM public.game_secrets WHERE match_id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game secret not found' USING ERRCODE = 'P0002';
  END IF;

  my_hand := COALESCE(secret_row.engine_state -> 'players' -> viewer_seat -> 'hand', '[]'::jsonb);

  RETURN jsonb_build_object(
    'matchId', session_row.match_id,
    'rulesetId', session_row.ruleset_id,
    'status', session_row.status,
    'version', session_row.version,
    'viewerSeat', viewer_seat,
    'currentSeat', session_row.current_seat,
    'round', session_row.round,
    'phase', session_row.phase,
    'scores', session_row.scores,
    'board', session_row.board,
    'spinner', session_row.spinner,
    'lastPlayPoints', session_row.last_play_points,
    'lastPlayPointsSeat', session_row.last_play_points_seat,
    'lastPlayScoreTerminals', session_row.last_play_score_terminals,
    'reserveCount', session_row.reserve_count,
    'handCounts', session_row.hand_counts,
    'myHand', my_hand,
    'roundResult', session_row.round_result,
    'matchWinnerSeat', session_row.match_winner_seat,
    'updatedAt', session_row.updated_at
  );
END;
$$;

COMMENT ON FUNCTION public.get_game_view(uuid) IS
  'Participant-only filtered view: public board/scores/turn plus the viewer hand. Never returns opponent hand, reserve ids, seed, or engine_state.';

-- ---------------------------------------------------------------------------
-- F. Service-role transactional install / commit (used by Edge Function)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.require_service_role()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
END;
$$;

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
    -- Seed lives in deal_seed + engine_state for the server only.
    NULL;
  END IF;

  INSERT INTO public.game_sessions (
    match_id, ruleset_id, status, version, current_seat, round, phase, scores,
    board, spinner, last_play_points, last_play_points_seat, last_play_score_terminals,
    reserve_count, hand_counts, round_result, match_winner_seat
  )
  VALUES (
    p_match_id,
    p_ruleset_id,
    COALESCE(p_public->>'status', 'playing'),
    COALESCE((p_public->>'version')::integer, 0),
    COALESCE((p_public->>'currentSeat')::integer, 0),
    COALESCE((p_public->>'round')::integer, 1),
    COALESCE(p_public->>'phase', 'playing'),
    COALESCE(p_public->'scores', '[0,0]'::jsonb),
    COALESCE(p_public->'board', '[]'::jsonb),
    p_public->'spinner',
    COALESCE((p_public->>'lastPlayPoints')::integer, 0),
    NULLIF(p_public->>'lastPlayPointsSeat', '')::integer,
    COALESCE(p_public->'lastPlayScoreTerminals', '[]'::jsonb),
    COALESCE((p_public->>'reserveCount')::integer, 0),
    COALESCE(p_public->'handCounts', '[0,0]'::jsonb),
    p_public->'roundResult',
    NULLIF(p_public->>'matchWinnerSeat', '')::integer
  )
  ON CONFLICT (match_id) DO NOTHING
  RETURNING match_id INTO inserted_id;

  IF inserted_id IS NULL THEN
    SELECT * INTO existing FROM public.game_sessions WHERE match_id = p_match_id;
    RETURN jsonb_build_object('created', false, 'version', existing.version);
  END IF;

  INSERT INTO public.game_secrets (match_id, engine_state, deal_seed)
  VALUES (p_match_id, p_engine_state, p_deal_seed);

  IF match_row.status = 'ready' THEN
    UPDATE public.matches SET status = 'playing' WHERE id = p_match_id;
  END IF;

  RETURN jsonb_build_object('created', true, 'version', COALESCE((p_public->>'version')::integer, 0));
END;
$$;

COMMENT ON FUNCTION public.install_online_game(uuid, text, jsonb, jsonb, bigint) IS
  'Service-role only. Creates at most one game session per match (idempotent).';

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

  new_version := p_expected_version + 1;

  UPDATE public.game_sessions
  SET
    status = COALESCE(p_public->>'status', status),
    version = new_version,
    current_seat = COALESCE((p_public->>'currentSeat')::integer, current_seat),
    round = COALESCE((p_public->>'round')::integer, round),
    phase = COALESCE(p_public->>'phase', phase),
    scores = COALESCE(p_public->'scores', scores),
    board = COALESCE(p_public->'board', board),
    spinner = COALESCE(p_public->'spinner', spinner),
    last_play_points = COALESCE((p_public->>'lastPlayPoints')::integer, last_play_points),
    last_play_points_seat = NULLIF(p_public->>'lastPlayPointsSeat', '')::integer,
    last_play_score_terminals = COALESCE(p_public->'lastPlayScoreTerminals', last_play_score_terminals),
    reserve_count = COALESCE((p_public->>'reserveCount')::integer, reserve_count),
    hand_counts = COALESCE(p_public->'handCounts', hand_counts),
    round_result = p_public->'roundResult',
    match_winner_seat = NULLIF(p_public->>'matchWinnerSeat', '')::integer
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
    UPDATE public.matches SET status = 'finished' WHERE id = p_match_id;
  ELSIF p_match_status = 'playing' THEN
    UPDATE public.matches
    SET status = 'playing'
    WHERE id = p_match_id AND status = 'ready';
  END IF;

  RETURN jsonb_build_object('version', new_version);
END;
$$;

COMMENT ON FUNCTION public.commit_online_game_transition(uuid, integer, uuid, integer, text, jsonb, jsonb, jsonb, text) IS
  'Service-role only. Locks the session, CAS on expected_version, updates secret + public projection, appends one action, increments version once.';

-- ---------------------------------------------------------------------------
-- G. RLS — fail closed
-- ---------------------------------------------------------------------------

ALTER TABLE public.game_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_actions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.game_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.game_secrets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.game_actions FORCE ROW LEVEL SECURITY;

CREATE POLICY game_sessions_select_participants
  ON public.game_sessions
  FOR SELECT
  TO authenticated
  USING (public.is_match_participant(match_id, auth.uid()));

-- Intentionally no INSERT/UPDATE/DELETE policies on game_sessions.
-- Intentionally no policies on game_secrets (authenticated cannot read secrets).

CREATE POLICY game_actions_select_participants
  ON public.game_actions
  FOR SELECT
  TO authenticated
  USING (public.is_match_participant(match_id, auth.uid()));

REVOKE ALL ON TABLE public.game_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.game_secrets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.game_actions FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.game_sessions TO authenticated;
GRANT SELECT ON TABLE public.game_actions TO authenticated;
-- No GRANT SELECT on game_secrets to anon or authenticated.

GRANT ALL ON TABLE public.game_sessions TO service_role;
GRANT ALL ON TABLE public.game_secrets TO service_role;
GRANT ALL ON TABLE public.game_actions TO service_role;

REVOKE ALL ON FUNCTION public.require_service_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.install_online_game(uuid, text, jsonb, jsonb, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_online_game_transition(uuid, integer, uuid, integer, text, jsonb, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_game_view(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_match_participant(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_game_view(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_match_participant(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.install_online_game(uuid, text, jsonb, jsonb, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_online_game_transition(uuid, integer, uuid, integer, text, jsonb, jsonb, jsonb, text) TO service_role;

-- ---------------------------------------------------------------------------
-- H. Realtime — public projection only
-- ---------------------------------------------------------------------------

ALTER TABLE public.game_sessions REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'game_sessions'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.game_sessions;
    END IF;
  END IF;
END $$;

COMMIT;
