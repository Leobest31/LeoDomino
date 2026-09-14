-- Timeout pipeline recovery: terminal timeout/auto-play with finish_reason=completed
-- calls _progression_award_player_for_match, which UPDATE … SET level_after = level_after
-- raises 42702 (ambiguous column). Qualifies assignments so timeout commits can finish.
-- Does not change XP math, LeoPips economics, or award eligibility.

BEGIN;

CREATE OR REPLACE FUNCTION public._progression_award_player_for_match(
  p_player uuid,
  p_match_id uuid,
  p_match_kind text,
  p_finish_reason text,
  p_did_win boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prog public.player_progression%ROWTYPE;
  xp integer := 0;
  qualify boolean := false;
  kind text := COALESCE(p_match_kind, 'public');
  inserted_n integer := 0;
  v_level_before integer;
  v_level_after integer;
  v_wins_after integer;
  v_xp_after integer;
  rank_name text;
BEGIN
  IF p_finish_reason IS DISTINCT FROM 'completed' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_completed');
  END IF;

  IF kind = 'friend' THEN
    xp := CASE WHEN p_did_win THEN 10 ELSE 5 END;
    qualify := false;
  ELSE
    xp := CASE WHEN p_did_win THEN 25 ELSE 10 END;
    qualify := p_did_win;
  END IF;

  prog := public._progression_ensure_row(p_player);
  v_level_before := prog.level;

  INSERT INTO public.player_progression_awards (
    player_id,
    match_id,
    match_kind,
    finish_reason,
    did_win,
    xp_awarded,
    qualifying_win_awarded,
    level_before,
    level_after,
    lifetime_xp_after,
    qualifying_wins_after
  )
  VALUES (
    p_player,
    p_match_id,
    kind,
    p_finish_reason,
    p_did_win,
    xp,
    qualify,
    v_level_before,
    v_level_before,
    prog.lifetime_xp,
    prog.qualifying_public_completed_wins
  )
  ON CONFLICT (player_id, match_id) DO NOTHING;

  GET DIAGNOSTICS inserted_n = ROW_COUNT;
  IF inserted_n = 0 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'already_awarded', 'player_id', p_player);
  END IF;

  v_wins_after := prog.qualifying_public_completed_wins + CASE WHEN qualify THEN 1 ELSE 0 END;
  v_xp_after := prog.lifetime_xp + xp;
  v_level_after := public.progression_level_from_wins(v_wins_after);
  rank_name := public.progression_rank_from_level(v_level_after);

  UPDATE public.player_progression
  SET
    lifetime_xp = v_xp_after,
    qualifying_public_completed_wins = v_wins_after,
    level = v_level_after
  WHERE player_id = p_player;

  UPDATE public.player_progression_awards
  SET
    level_after = v_level_after,
    lifetime_xp_after = v_xp_after,
    qualifying_wins_after = v_wins_after
  WHERE player_id = p_player AND match_id = p_match_id;

  IF v_level_after > v_level_before THEN
    INSERT INTO public.player_level_up_events (
      player_id, level, qualifying_wins, match_id, rank
    )
    VALUES (
      p_player, v_level_after, v_wins_after, p_match_id, rank_name
    )
    ON CONFLICT (player_id, level) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'applied', true,
    'player_id', p_player,
    'xp_awarded', xp,
    'qualifying_win_awarded', qualify,
    'level_before', v_level_before,
    'level_after', v_level_after,
    'lifetime_xp_after', v_xp_after,
    'qualifying_wins_after', v_wins_after,
    'rank', rank_name
  );
END;
$$;

COMMENT ON FUNCTION public._progression_award_player_for_match(uuid, uuid, text, text, boolean) IS
  'Idempotent XP/LVL award for one seat on a completed match. Variables are v_-prefixed to avoid PL/pgSQL column ambiguity.';

COMMIT;
