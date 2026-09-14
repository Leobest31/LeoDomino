-- WITHHELD — DO NOT MOVE THIS FILE INTO supabase/migrations/.
-- Ordinary `supabase db push` must never execute this body.
-- Do NOT apply to hosted Supabase. Do not deploy Edge. Do not deploy testers.
-- Do NOT run migration repair. Do NOT touch 20260903120000.
--
-- Local review only: LeoPips public Find Match buckets
--   exact ruleset_id + exact stake_pips (20 / 50 / 100 / 150).
--
-- STAGE 1 (this transaction) is additive / backward compatible:
--   - Adds nullable stake_pips. Never COALESCE to 20.
--   - Public INSERT may still omit stake_pips (current clients keep working).
--   - If a public stake is supplied, it must be 20/50/100/150.
--   - Friend invites stay NULL. send_friend_match_invite is not replaced.
--   - New list RPC is exact-bucket only (NULL never matches).
--   - accept_match_request gains optional expected lobby args.
--     Staked public rows require those args and copy request values.
--     Legacy public NULL rows remain accept-able by the old 1-arg client.
--   - count_joinable_open_match_requests() signature is unchanged (Home lamp).
--   - No debit, payout, timeout penalty, referral credit, or XP/Level.
--
-- STAGE 2 is documented at the bottom and is NOT executed here.
-- Apply Stage 2 only after the new client is deployed (see owner rollout).
--
-- Do NOT apply to hosted Supabase until explicitly approved.

BEGIN;

-- ---------------------------------------------------------------------------
-- A / B. Nullable stake columns. NULL ≠ 20.
-- ---------------------------------------------------------------------------

ALTER TABLE public.match_requests
  ADD COLUMN IF NOT EXISTS stake_pips integer;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS stake_pips integer;

ALTER TABLE public.match_requests
  DROP CONSTRAINT IF EXISTS match_requests_stake_pips_check;
ALTER TABLE public.match_requests
  ADD CONSTRAINT match_requests_stake_pips_check
  CHECK (stake_pips IS NULL OR stake_pips IN (20, 50, 100, 150));

ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_stake_pips_check;
ALTER TABLE public.matches
  ADD CONSTRAINT matches_stake_pips_check
  CHECK (stake_pips IS NULL OR stake_pips IN (20, 50, 100, 150));

COMMENT ON COLUMN public.match_requests.stake_pips IS
  'Public LeoPips lobby stake. NULL = friend invite or pre-LeoPips public row. Never treat NULL as 20. Immutable after insert.';
COMMENT ON COLUMN public.matches.stake_pips IS
  'Copied from match_requests.stake_pips at accept. Never taken from the acceptor payload. Immutable after insert.';

-- ---------------------------------------------------------------------------
-- C. Immutability
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.match_requests_protect_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.ruleset_id IS DISTINCT FROM OLD.ruleset_id THEN
    RAISE EXCEPTION 'match_requests.ruleset_id is immutable' USING ERRCODE = '22023';
  END IF;
  IF NEW.creator_id IS DISTINCT FROM OLD.creator_id THEN
    RAISE EXCEPTION 'match_requests.creator_id is immutable' USING ERRCODE = '22023';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'match_requests.created_at is immutable' USING ERRCODE = '22023';
  END IF;
  IF NEW.stake_pips IS DISTINCT FROM OLD.stake_pips THEN
    RAISE EXCEPTION 'match_requests.stake_pips is immutable' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.matches_protect_ruleset()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.ruleset_id IS DISTINCT FROM OLD.ruleset_id THEN
    RAISE EXCEPTION 'matches.ruleset_id is immutable' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.request_id IS DISTINCT FROM OLD.request_id THEN
    RAISE EXCEPTION 'matches.request_id is immutable' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.player_a IS DISTINCT FROM OLD.player_a OR NEW.player_b IS DISTINCT FROM OLD.player_b) THEN
    RAISE EXCEPTION 'match seats are immutable' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.match_kind IS DISTINCT FROM OLD.match_kind THEN
    RAISE EXCEPTION 'matches.match_kind is immutable' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.rated IS DISTINCT FROM OLD.rated THEN
    RAISE EXCEPTION 'matches.rated is immutable' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.stake_pips IS DISTINCT FROM OLD.stake_pips THEN
    RAISE EXCEPTION 'matches.stake_pips is immutable' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.finished_at IS NOT NULL AND NEW.finished_at IS DISTINCT FROM OLD.finished_at THEN
    RAISE EXCEPTION 'matches.finished_at is immutable' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.finish_reason IS NOT NULL AND NEW.finish_reason IS DISTINCT FROM OLD.finish_reason THEN
    RAISE EXCEPTION 'matches.finish_reason is immutable' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- D. Open public LeoPips lobby lookup
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS match_requests_open_public_lobby_idx
  ON public.match_requests (ruleset_id, stake_pips, created_at DESC)
  WHERE status = 'open'
    AND COALESCE(visibility, 'public') = 'public'
    AND stake_pips IS NOT NULL;

-- ---------------------------------------------------------------------------
-- E. Public create: validate supplied stake; do not default NULL to 20.
--    Friend create: force NULL. send_friend_match_invite is unchanged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.match_requests_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  low_id uuid;
  high_id uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles WHERE id = caller AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.match_requests
  SET status = 'expired'
  WHERE creator_id = caller
    AND status = 'open'
    AND expires_at <= now();

  PERFORM public.expire_stale_open_match_requests();

  NEW.creator_id := caller;
  NEW.status := 'open';
  NEW.acceptor_id := NULL;
  NEW.accepted_at := NULL;
  NEW.match_id := NULL;
  NEW.created_at := now();
  NEW.expires_at := now() + interval '10 minutes';
  IF NEW.visibility IS NULL OR NEW.visibility = '' THEN
    NEW.visibility := 'public';
  END IF;
  IF NEW.ruleset_id IS NULL OR NEW.ruleset_id NOT IN ('legacy', 'haitian', 'american') THEN
    RAISE EXCEPTION 'invalid ruleset_id' USING ERRCODE = '22023';
  END IF;
  IF NEW.visibility = 'public' THEN
    NEW.invitee_id := NULL;
    NEW.waiting_heartbeat_at := now();
    -- Stage 1: NULL remains legal so current clients can still INSERT (ruleset_id).
    -- Never assign 20. Never COALESCE(stake_pips, 20).
    IF NEW.stake_pips IS NOT NULL AND NEW.stake_pips NOT IN (20, 50, 100, 150) THEN
      RAISE EXCEPTION 'invalid stake_pips' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.visibility = 'friend' THEN
    NEW.stake_pips := NULL;
    NEW.waiting_heartbeat_at := NULL;
    IF NEW.invitee_id IS NULL THEN
      RAISE EXCEPTION 'invitee required' USING ERRCODE = '22023';
    END IF;
    IF NEW.invitee_id = caller THEN
      RAISE EXCEPTION 'cannot invite yourself' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.profiles WHERE id = NEW.invitee_id AND deleted_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'player not found' USING ERRCODE = 'P0002';
    END IF;
    low_id := public.uuid_pair_low(caller, NEW.invitee_id);
    high_id := public.uuid_pair_high(caller, NEW.invitee_id);
    IF NOT EXISTS (
      SELECT 1 FROM public.friendships
      WHERE user_a = low_id AND user_b = high_id
    ) THEN
      RAISE EXCEPTION 'not friends' USING ERRCODE = '42501';
    END IF;
    IF public.player_in_active_match(NEW.invitee_id) THEN
      RAISE EXCEPTION 'PLAYER_BUSY' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid visibility' USING ERRCODE = '22023';
  END IF;
  IF public.player_in_active_match(NEW.creator_id) THEN
    RAISE EXCEPTION 'PLAYER_BUSY' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

GRANT INSERT (ruleset_id, stake_pips) ON TABLE public.match_requests TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Exact-bucket list. Home lamp count is intentionally NOT parameterized.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_joinable_open_match_requests(
  p_ruleset_id text,
  p_stake_pips integer
)
RETURNS TABLE (
  id uuid,
  creator_id uuid,
  ruleset_id text,
  stake_pips integer,
  status text,
  created_at timestamptz,
  expires_at timestamptz,
  match_id uuid,
  acceptor_id uuid,
  visibility text,
  invitee_id uuid,
  waiting_heartbeat_at timestamptz,
  display_name text,
  avatar_id text,
  country_code text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RETURN;
  END IF;
  -- Invalid lobby → empty. NULL stake is never a 20 lobby.
  IF p_ruleset_id IS NULL OR p_ruleset_id NOT IN ('legacy', 'haitian', 'american') THEN
    RETURN;
  END IF;
  IF p_stake_pips IS NULL OR p_stake_pips NOT IN (20, 50, 100, 150) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.creator_id,
    r.ruleset_id,
    r.stake_pips,
    r.status,
    r.created_at,
    r.expires_at,
    r.match_id,
    r.acceptor_id,
    r.visibility,
    r.invitee_id,
    r.waiting_heartbeat_at,
    COALESCE(p.display_name, 'Player'),
    COALESCE(p.avatar_id, 'marcus'),
    COALESCE(p.country_code, '')
  FROM public.match_requests r
  LEFT JOIN public.profiles p ON p.id = r.creator_id
  WHERE r.status = 'open'
    AND COALESCE(r.visibility, 'public') = 'public'
    AND r.expires_at > now()
    AND r.waiting_heartbeat_at IS NOT NULL
    AND r.waiting_heartbeat_at >= now() - interval '30 seconds'
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
  ORDER BY r.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.list_joinable_open_match_requests(text, integer) IS
  'Read-only exact LeoPips lobby list: public OPEN + fresh heartbeat + exact ruleset_id + exact stake_pips. NULL stake never matches. Does not run cleanup. Does not change Home count_joinable_open_match_requests().';

REVOKE ALL ON FUNCTION public.list_joinable_open_match_requests(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_joinable_open_match_requests(text, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Accept: copy request style + stake. Expected lobby required for staked
--    public rows. Friend path unchanged (NULL stake, pair/heartbeat exempt).
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.accept_match_request(uuid);

CREATE FUNCTION public.accept_match_request(
  p_request_id uuid,
  p_ruleset_id text DEFAULT NULL,
  p_stake_pips integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  request public.match_requests%ROWTYPE;
  new_match_id uuid;
  first_player uuid;
  second_player uuid;
  low_id uuid;
  high_id uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request id required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO request
  FROM public.match_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_UNAVAILABLE' USING ERRCODE = 'P0002';
  END IF;

  IF request.creator_id = caller THEN
    RAISE EXCEPTION 'cannot accept own match request' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(request.visibility, 'public') = 'friend' THEN
    IF request.invitee_id IS DISTINCT FROM caller THEN
      RAISE EXCEPTION 'only the invitee may accept' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF request.creator_id < caller THEN
    first_player := request.creator_id;
    second_player := caller;
  ELSE
    first_player := caller;
    second_player := request.creator_id;
  END IF;
  PERFORM public._matchmaking_lock_player(first_player);
  PERFORM public._matchmaking_lock_player(second_player);

  SELECT * INTO request
  FROM public.match_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_UNAVAILABLE' USING ERRCODE = 'P0002';
  END IF;
  IF request.creator_id = caller THEN
    RAISE EXCEPTION 'cannot accept own match request' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(request.visibility, 'public') = 'friend'
     AND request.invitee_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'only the invitee may accept' USING ERRCODE = '42501';
  END IF;
  IF request.status = 'accepted' THEN
    RAISE EXCEPTION 'REQUEST_ALREADY_ACCEPTED' USING ERRCODE = 'P0003';
  END IF;
  IF request.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'REQUEST_UNAVAILABLE' USING ERRCODE = 'P0002';
  END IF;
  IF request.expires_at <= now() THEN
    UPDATE public.match_requests
    SET status = 'expired'
    WHERE id = request.id AND status = 'open';
    RAISE EXCEPTION 'match request expired' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(request.visibility, 'public') = 'friend' THEN
    low_id := public.uuid_pair_low(request.creator_id, caller);
    high_id := public.uuid_pair_high(request.creator_id, caller);
    IF NOT EXISTS (
      SELECT 1 FROM public.friendships
      WHERE user_a = low_id AND user_b = high_id
    ) THEN
      UPDATE public.match_requests
      SET status = 'expired'
      WHERE id = request.id AND status = 'open';
      RAISE EXCEPTION 'not friends' USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM 1
  FROM public.match_requests
  WHERE status = 'open'
    AND creator_id IN (request.creator_id, caller)
  FOR UPDATE;

  SELECT * INTO request
  FROM public.match_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF request.status IS DISTINCT FROM 'open' THEN
    IF request.status = 'accepted' THEN
      RAISE EXCEPTION 'REQUEST_ALREADY_ACCEPTED' USING ERRCODE = 'P0003';
    END IF;
    RAISE EXCEPTION 'REQUEST_UNAVAILABLE' USING ERRCODE = 'P0002';
  END IF;

  IF public.player_in_active_match(request.creator_id)
     OR public.player_in_active_match(caller) THEN
    RAISE EXCEPTION 'PLAYER_BUSY' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(request.visibility, 'public') IS DISTINCT FROM 'friend'
     AND public.ranked_find_match_pair_limit_reached(request.creator_id, caller) THEN
    RAISE EXCEPTION 'RANKED_PAIR_LIMIT' USING ERRCODE = 'P0004';
  END IF;

  IF COALESCE(request.visibility, 'public') IS DISTINCT FROM 'friend'
     AND (
       request.waiting_heartbeat_at IS NULL
       OR request.waiting_heartbeat_at < now() - interval '30 seconds'
     ) THEN
    UPDATE public.match_requests
    SET status = 'expired'
    WHERE id = request.id AND status = 'open';
    RAISE EXCEPTION 'CREATOR_UNAVAILABLE' USING ERRCODE = 'P0005';
  END IF;

  -- Public lobby authority. Friend rows skip this block (stake stays NULL).
  IF COALESCE(request.visibility, 'public') IS DISTINCT FROM 'friend' THEN
    IF request.stake_pips IS NOT NULL THEN
      IF p_ruleset_id IS NULL OR p_stake_pips IS NULL THEN
        RAISE EXCEPTION 'LOBBY_REQUIRED' USING ERRCODE = 'P0006';
      END IF;
      IF p_ruleset_id IS DISTINCT FROM request.ruleset_id
         OR p_stake_pips IS DISTINCT FROM request.stake_pips THEN
        RAISE EXCEPTION 'LOBBY_MISMATCH' USING ERRCODE = 'P0006';
      END IF;
    ELSE
      -- Legacy public NULL: not a LeoPips lobby. Never match NULL to 20.
      IF p_stake_pips IS NOT NULL THEN
        RAISE EXCEPTION 'REQUEST_UNAVAILABLE' USING ERRCODE = 'P0002';
      END IF;
      IF p_ruleset_id IS NOT NULL AND p_ruleset_id IS DISTINCT FROM request.ruleset_id THEN
        RAISE EXCEPTION 'LOBBY_MISMATCH' USING ERRCODE = 'P0006';
      END IF;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.matches (
      request_id, ruleset_id, stake_pips, player_a, player_b, status, match_kind, rated
    )
    VALUES (
      request.id,
      request.ruleset_id,
      request.stake_pips,
      request.creator_id,
      caller,
      'ready',
      CASE
        WHEN COALESCE(request.visibility, 'public') = 'friend' THEN 'friend'
        ELSE 'public'
      END,
      COALESCE(request.visibility, 'public') IS DISTINCT FROM 'friend'
        AND NOT EXISTS (
          SELECT 1
          FROM public.friendships
          WHERE user_a = public.uuid_pair_low(request.creator_id, caller)
            AND user_b = public.uuid_pair_high(request.creator_id, caller)
        )
    )
    RETURNING id INTO new_match_id;
  EXCEPTION
    WHEN unique_violation THEN
      IF EXISTS (
        SELECT 1 FROM public.matches WHERE request_id = request.id
      ) THEN
        RAISE EXCEPTION 'REQUEST_ALREADY_ACCEPTED' USING ERRCODE = 'P0003';
      END IF;
      RAISE EXCEPTION 'PLAYER_BUSY' USING ERRCODE = 'P0001';
  END;

  UPDATE public.match_requests
  SET
    status = 'accepted',
    acceptor_id = caller,
    accepted_at = now(),
    match_id = new_match_id
  WHERE id = request.id
    AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_UNAVAILABLE' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.match_requests
  SET status = 'cancelled'
  WHERE status = 'open'
    AND id <> request.id
    AND (
      creator_id IN (request.creator_id, caller)
      OR invitee_id IN (request.creator_id, caller)
    );

  RETURN new_match_id;
END;
$$;

COMMENT ON FUNCTION public.accept_match_request(uuid, text, integer) IS
  'Accept a Find Match or friend request. Public staked rows require expected ruleset+stake and copy request values onto matches. Does not debit LeoPips.';

REVOKE ALL ON FUNCTION public.accept_match_request(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_match_request(uuid, text, integer) TO authenticated;

COMMIT;

-- =============================================================================
-- STAGE 2 — NOT EXECUTED. Later owner-approved apply only, AFTER the new
-- client is deployed and writing stake_pips.
--
-- Do not run this block in the same window as Stage 1 if current clients
-- still INSERT only { ruleset_id }.
--
-- 1) Expire open PUBLIC NULL-stake rows. Friend NULL rows stay.
--
-- UPDATE public.match_requests
-- SET status = 'expired'
-- WHERE status = 'open'
--   AND COALESCE(visibility, 'public') = 'public'
--   AND stake_pips IS NULL;
--
-- 2) In match_requests_before_insert, public branch becomes:
--    IF NEW.stake_pips IS NULL OR NEW.stake_pips NOT IN (20, 50, 100, 150) THEN
--      RAISE EXCEPTION 'invalid stake_pips' USING ERRCODE = '22023';
--    END IF;
--    Still never COALESCE(stake_pips, 20).
--
-- 3) In accept_match_request, public rows always require
--    p_ruleset_id / p_stake_pips and a non-NULL request.stake_pips.
--
-- Still do not call _leopips_debit*, payout, timeout, or referral helpers.
-- =============================================================================
