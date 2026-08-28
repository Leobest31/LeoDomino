-- Forfeit terminal-state + RP sync.
-- Publish game_sessions match_over BEFORE matches.status=finished so the
-- remaining opponent still receives Realtime while occupancy is intact.
-- Repeat forfeits on an already-finished match re-run settle (idempotent).
-- Does not change Elo math, rated classification, or friend-match unrated rules.

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
    SELECT * INTO session_row FROM public.game_sessions WHERE match_id = p_match_id;
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

REVOKE ALL ON FUNCTION public._forfeit_match_player(uuid, uuid) FROM PUBLIC, anon, authenticated;
