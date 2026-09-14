-- Atomic public Find Match: prefer accept over create in one lobby lock.
-- Fixes simultaneous dual-OPEN (same ruleset + stake) waiting forever.
-- Does NOT debit LeoPips. Does NOT change friend invites or NULL-stake inserts.
-- Does NOT apply automatically — local candidate until owner approves hosted apply.

BEGIN;

CREATE OR REPLACE FUNCTION public.join_or_create_public_match_request(
  p_ruleset_id text,
  p_stake_pips integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  peer_id uuid;
  own_id uuid;
  own_row public.match_requests%ROWTYPE;
  new_match_id uuid;
  created_id uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_ruleset_id IS NULL OR p_ruleset_id NOT IN ('legacy', 'haitian', 'american') THEN
    RAISE EXCEPTION 'invalid ruleset_id' USING ERRCODE = '22023';
  END IF;
  IF p_stake_pips IS NULL OR p_stake_pips NOT IN (20, 50, 100, 150) THEN
    RAISE EXCEPTION 'invalid stake_pips' USING ERRCODE = '22023';
  END IF;

  -- Serialize compatible Find Match attempts in this style+stake bucket.
  PERFORM pg_advisory_xact_lock(
    hashtext('leo:public_lobby:' || p_ruleset_id || ':' || p_stake_pips::text)
  );

  PERFORM public.expire_stale_open_match_requests();
  PERFORM public._matchmaking_lock_player(caller);

  IF public.player_in_active_match(caller) THEN
    RAISE EXCEPTION 'PLAYER_BUSY' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent: already accepted into a live public match in this lobby.
  SELECT r.* INTO own_row
  FROM public.match_requests r
  JOIN public.matches m ON m.id = r.match_id
  WHERE r.creator_id = caller
    AND r.status = 'accepted'
    AND COALESCE(r.visibility, 'public') = 'public'
    AND r.ruleset_id = p_ruleset_id
    AND r.stake_pips = p_stake_pips
    AND m.status IN ('ready', 'playing')
  ORDER BY r.accepted_at DESC NULLS LAST
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'accepted',
      'request_id', own_row.id,
      'match_id', own_row.match_id
    );
  END IF;

  -- Prefer accepting the oldest joinable peer (same filters as list_joinable).
  SELECT r.id INTO peer_id
  FROM public.match_requests r
  WHERE r.status = 'open'
    AND COALESCE(r.visibility, 'public') = 'public'
    AND r.expires_at > now()
    AND r.waiting_heartbeat_at IS NOT NULL
    AND r.waiting_heartbeat_at >= now() - interval '5 minutes'
    AND r.creator_id <> caller
    AND r.ruleset_id = p_ruleset_id
    AND r.stake_pips = p_stake_pips
    AND NOT public.ranked_find_match_pair_limit_reached(r.creator_id, caller)
    AND NOT EXISTS (
      SELECT 1
      FROM public.active_match_players a
      JOIN public.matches m ON m.id = a.match_id
      WHERE a.player_id = r.creator_id
        AND m.status IN ('ready', 'playing')
        AND (
          a.last_seen_at >= now() - interval '5 minutes'
          OR (
            a.joined_at IS NULL
            AND COALESCE(
              (SELECT req.accepted_at FROM public.match_requests req WHERE req.id = m.request_id),
              m.created_at
            ) + interval '3 minutes' > now()
          )
        )
    )
  ORDER BY r.created_at ASC
  LIMIT 1;

  IF peer_id IS NOT NULL THEN
    new_match_id := public.accept_match_request(peer_id, p_ruleset_id, p_stake_pips);
    RETURN jsonb_build_object(
      'outcome', 'accepted',
      'request_id', peer_id,
      'match_id', new_match_id
    );
  END IF;

  -- No peer: keep or create own OPEN in this lobby.
  SELECT r.id INTO own_id
  FROM public.match_requests r
  WHERE r.creator_id = caller
    AND r.status = 'open'
    AND COALESCE(r.visibility, 'public') = 'public'
    AND r.ruleset_id = p_ruleset_id
    AND r.stake_pips = p_stake_pips
    AND r.expires_at > now()
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF own_id IS NOT NULL THEN
    UPDATE public.match_requests
    SET waiting_heartbeat_at = now()
    WHERE id = own_id
      AND status = 'open'
      AND expires_at > now();
    RETURN jsonb_build_object(
      'outcome', 'already_open',
      'request_id', own_id,
      'match_id', NULL
    );
  END IF;

  INSERT INTO public.match_requests (ruleset_id, stake_pips, visibility)
  VALUES (p_ruleset_id, p_stake_pips, 'public')
  RETURNING id INTO created_id;

  RETURN jsonb_build_object(
    'outcome', 'created',
    'request_id', created_id,
    'match_id', NULL
  );
END;
$$;

COMMENT ON FUNCTION public.join_or_create_public_match_request(text, integer) IS
  'Atomic public Find Match for an exact ruleset+stake lobby: accept oldest joinable peer under a lobby advisory lock, else reuse/create own OPEN. Never self-matches. Does not debit LeoPips. Friend/private/NULL stake excluded.';

REVOKE ALL ON FUNCTION public.join_or_create_public_match_request(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_or_create_public_match_request(text, integer) TO authenticated;

COMMIT;
