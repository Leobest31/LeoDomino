-- Account deletion: tombstone profiles, release usernames, delete Auth separately.
-- CREATE in the repo. Do NOT apply via db push (would also apply review-only 28210000).
-- Does not change Elo math, rated classification, or historical match/RP rows.
-- Deleted players stay as "Deleted player" stubs for FK integrity and are excluded
-- from current Global Ranking.

-- ---------------------------------------------------------------------------
-- A. Tombstone column + stop auth.users CASCADE from wiping match history
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.profiles.deleted_at IS
  'Set when the player requested account deletion. Row is kept as an anonymized stub.';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- Username may be cleared only as part of tombstone (same UPDATE sets deleted_at).
CREATE OR REPLACE FUNCTION public.normalize_profile_username()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  handle text;
BEGIN
  IF TG_OP = 'UPDATE' AND auth.uid() IS NOT NULL AND NEW.id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'cannot change another user username' USING ERRCODE = '42501';
  END IF;

  IF NEW.username IS NULL OR btrim(NEW.username) = '' THEN
    IF TG_OP = 'UPDATE'
       AND OLD.username IS NOT NULL
       AND NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION 'username cannot be cleared' USING ERRCODE = '22023';
    END IF;
    NEW.username := NULL;
    RETURN NEW;
  END IF;

  handle := public.normalize_player_username(NEW.username);
  IF handle IS NULL THEN
    RAISE EXCEPTION 'invalid username' USING ERRCODE = '22023';
  END IF;
  NEW.username := handle;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.profiles_protect_deleted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL THEN
    NEW.deleted_at := OLD.deleted_at;
    NEW.username := NULL;
    NEW.display_name := 'Deleted player';
    NEW.country_code := '';
  END IF;
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF NEW.id IS DISTINCT FROM auth.uid() AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'cannot delete another user' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_deleted ON public.profiles;
CREATE TRIGGER profiles_protect_deleted
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_protect_deleted();

-- ---------------------------------------------------------------------------
-- B. Current ranking excludes tombstones (settlement SQL unchanged)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_global_rating()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  rating public.player_global_ratings%ROWTYPE;
  rank integer;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles WHERE id = caller AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.player_global_ratings (player_id)
  VALUES (caller)
  ON CONFLICT (player_id) DO NOTHING;

  SELECT * INTO rating
  FROM public.player_global_ratings
  WHERE player_id = caller;

  SELECT 1 + COUNT(*)::integer
  INTO rank
  FROM public.player_global_ratings r
  INNER JOIN public.profiles p ON p.id = r.player_id
  WHERE r.rp > rating.rp
    AND p.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'rp', rating.rp,
    'matches_played', rating.matches_played,
    'wins', rating.wins,
    'losses', rating.losses,
    'win_rate', CASE
      WHEN rating.matches_played = 0 THEN 0
      ELSE ROUND(rating.wins::numeric / rating.matches_played::numeric, 4)
    END,
    'global_rank', rank
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_global_rating() IS
  'Signed-in player Global RP. global_rank counts only profiles.deleted_at IS NULL. Does not rewrite Elo.';

REVOKE ALL ON FUNCTION public.get_my_global_rating() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_global_rating() TO authenticated;

-- ---------------------------------------------------------------------------
-- C. Tombstoned accounts cannot start social/matchmaking activity
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.search_players_by_username(p_query text)
RETURNS TABLE (
  id uuid,
  username text,
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
  handle text;
  needle text;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  handle := public.normalize_player_username(p_query);
  needle := lower(btrim(COALESCE(p_query, '')));
  IF left(needle, 1) = '@' THEN
    needle := substring(needle from 2);
  END IF;
  needle := btrim(needle);

  IF char_length(needle) < 2 OR char_length(needle) > 20 THEN
    RETURN;
  END IF;

  needle := replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_');

  RETURN QUERY
  SELECT
    p.id,
    p.username,
    p.display_name,
    p.avatar_id,
    p.country_code
  FROM public.profiles p
  WHERE p.username IS NOT NULL
    AND p.deleted_at IS NULL
    AND p.id <> caller
    AND p.username ILIKE '%' || needle || '%' ESCAPE '\'
  ORDER BY
    (handle IS NOT NULL AND p.username = handle) DESC,
    (p.username LIKE needle || '%' ESCAPE '\') DESC,
    p.username ASC
  LIMIT 12;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_username_available(p_username text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  handle text := public.normalize_player_username(p_username);
BEGIN
  IF handle IS NULL THEN
    RETURN false;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE username = handle
      AND deleted_at IS NULL
      AND id IS DISTINCT FROM auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.send_friend_request(p_receiver_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  new_id uuid;
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
  IF p_receiver_id IS NULL THEN
    RAISE EXCEPTION 'receiver id required' USING ERRCODE = '22023';
  END IF;
  IF p_receiver_id = caller THEN
    RAISE EXCEPTION 'cannot send a friend request to yourself' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_receiver_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'player not found' USING ERRCODE = 'P0002';
  END IF;

  low_id := public.uuid_pair_low(caller, p_receiver_id);
  high_id := public.uuid_pair_high(caller, p_receiver_id);

  IF EXISTS (
    SELECT 1 FROM public.friendships
    WHERE user_a = low_id AND user_b = high_id
  ) THEN
    RAISE EXCEPTION 'friendship already exists' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.friend_requests (sender_id, receiver_id, status)
  VALUES (caller, p_receiver_id, 'pending')
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_friend_match_invite(p_invitee_id uuid, p_ruleset_id text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  new_id uuid;
  first_player uuid;
  second_player uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles WHERE id = caller AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETED' USING ERRCODE = 'P0001';
  END IF;
  IF p_invitee_id IS NULL THEN
    RAISE EXCEPTION 'invitee required' USING ERRCODE = '22023';
  END IF;
  IF p_invitee_id = caller THEN
    RAISE EXCEPTION 'cannot invite yourself' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_invitee_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'player not found' USING ERRCODE = 'P0002';
  END IF;

  IF caller < p_invitee_id THEN
    first_player := caller;
    second_player := p_invitee_id;
  ELSE
    first_player := p_invitee_id;
    second_player := caller;
  END IF;
  PERFORM public._matchmaking_lock_player(first_player);
  PERFORM public._matchmaking_lock_player(second_player);

  IF public.player_in_active_match(caller)
     OR public.player_in_active_match(p_invitee_id) THEN
    RAISE EXCEPTION 'PLAYER_BUSY' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.match_requests (ruleset_id, visibility, invitee_id)
  VALUES (p_ruleset_id, 'friend', p_invitee_id)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

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
  ELSIF NEW.visibility = 'friend' THEN
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

CREATE OR REPLACE FUNCTION public.matches_reject_deleted_players()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id IN (NEW.player_a, NEW.player_b)
      AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matches_reject_deleted_players ON public.matches;
CREATE TRIGGER matches_reject_deleted_players
  BEFORE INSERT ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.matches_reject_deleted_players();

-- ---------------------------------------------------------------------------
-- D. Self-delete RPC — auth.uid() only, no client user id
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prepare_my_account_deletion()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(caller::text));

  IF EXISTS (
    SELECT 1
    FROM public.matches
    WHERE (player_a = caller OR player_b = caller)
      AND status IN ('ready', 'playing')
  ) THEN
    RAISE EXCEPTION 'MATCH_ACTIVE' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles WHERE id = caller AND deleted_at IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('ok', true, 'already_tombstoned', true);
  END IF;

  DELETE FROM public.active_match_players WHERE player_id = caller;

  UPDATE public.match_requests
  SET status = 'cancelled'
  WHERE status = 'open'
    AND (creator_id = caller OR invitee_id = caller);

  DELETE FROM public.friendships
  WHERE user_a = caller OR user_b = caller;

  DELETE FROM public.friend_requests
  WHERE sender_id = caller OR receiver_id = caller;

  DELETE FROM public.friend_conversation_reads
  WHERE player_id = caller;

  DELETE FROM public.player_referral_codes
  WHERE player_id = caller;

  UPDATE public.profiles
  SET
    username = NULL,
    display_name = 'Deleted player',
    avatar_id = 'marcus',
    country_code = '',
    deleted_at = now()
  WHERE id = caller;

  RETURN jsonb_build_object('ok', true, 'already_tombstoned', false);
END;
$$;

COMMENT ON FUNCTION public.prepare_my_account_deletion() IS
  'Tombstone the signed-in player. Blocks ready/playing matches. Does not delete Auth, matches, RP, or chat history.';

REVOKE ALL ON FUNCTION public.prepare_my_account_deletion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_my_account_deletion() TO authenticated;

-- ---------------------------------------------------------------------------
-- E. Tombstoned JWT cannot recreate social/referral activity
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_caller_not_deleted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friend_messages_reject_deleted ON public.friend_messages;
CREATE TRIGGER friend_messages_reject_deleted
  BEFORE INSERT ON public.friend_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_caller_not_deleted();

DROP TRIGGER IF EXISTS friend_requests_reject_deleted ON public.friend_requests;
CREATE TRIGGER friend_requests_reject_deleted
  BEFORE INSERT ON public.friend_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_caller_not_deleted();

DROP TRIGGER IF EXISTS friendships_reject_deleted ON public.friendships;
CREATE TRIGGER friendships_reject_deleted
  BEFORE INSERT ON public.friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_caller_not_deleted();

DROP TRIGGER IF EXISTS player_referral_codes_reject_deleted ON public.player_referral_codes;
CREATE TRIGGER player_referral_codes_reject_deleted
  BEFORE INSERT ON public.player_referral_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_caller_not_deleted();

DROP TRIGGER IF EXISTS referrals_reject_deleted ON public.referrals;
CREATE TRIGGER referrals_reject_deleted
  BEFORE INSERT ON public.referrals
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_caller_not_deleted();

REVOKE ALL ON FUNCTION public.profiles_protect_deleted() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.matches_reject_deleted_players() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_caller_not_deleted() FROM PUBLIC, anon, authenticated;
