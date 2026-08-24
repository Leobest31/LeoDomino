-- LeoDomino V1 — Find Match + friends backend foundation
-- Apply in the Supabase SQL editor or via CLI. Not executed by the app client.
-- Auth remains on auth.users. public.profiles is a public-safe projection of identity.
-- user_metadata continues to work until a later client slice reads/writes profiles.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.uuid_pair_low(a uuid, b uuid)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE WHEN a < b THEN a ELSE b END;
$$;

CREATE OR REPLACE FUNCTION public.uuid_pair_high(a uuid, b uuid)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE WHEN a < b THEN b ELSE a END;
$$;

-- ---------------------------------------------------------------------------
-- A. profiles
-- ---------------------------------------------------------------------------

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT 'Player',
  avatar_id text NOT NULL DEFAULT 'marcus',
  country_code text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_display_name_len CHECK (
    char_length(display_name) BETWEEN 1 AND 40
  ),
  CONSTRAINT profiles_avatar_id_len CHECK (
    char_length(avatar_id) BETWEEN 1 AND 64
  ),
  CONSTRAINT profiles_country_code_fmt CHECK (
    country_code = '' OR country_code ~ '^[A-Z]{2}$'
  )
);

COMMENT ON TABLE public.profiles IS
  'Public-safe player identity. PK equals auth.users.id. No passwords, tokens, or emails.';
COMMENT ON COLUMN public.profiles.id IS
  'Authoritative player id. Same UUID as auth.users.id. Use as Realtime Presence key later.';

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.prevent_profile_id_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'profiles.id is immutable' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_id_immutable
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_id_change();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  raw_name text := COALESCE(meta->>'username', meta->>'displayName', meta->>'display_name', '');
  raw_avatar text := COALESCE(meta->>'avatarId', meta->>'avatar_id', 'marcus');
  raw_country text := upper(COALESCE(meta->>'countryCode', meta->>'country_code', ''));
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_id, country_code)
  VALUES (
    NEW.id,
    CASE
      WHEN char_length(btrim(raw_name)) BETWEEN 1 AND 40 THEN btrim(raw_name)
      ELSE 'Player'
    END,
    CASE
      WHEN char_length(raw_avatar) BETWEEN 1 AND 64 THEN raw_avatar
      ELSE 'marcus'
    END,
    CASE
      WHEN raw_country ~ '^[A-Z]{2}$' THEN raw_country
      ELSE ''
    END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- One-shot backfill for users created before this migration. Not granted to clients.
CREATE OR REPLACE FUNCTION public.backfill_profiles_from_auth()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted integer;
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_id, country_code, created_at)
  SELECT
    u.id,
    CASE
      WHEN char_length(btrim(COALESCE(u.raw_user_meta_data->>'username', u.raw_user_meta_data->>'displayName', ''))) BETWEEN 1 AND 40
        THEN btrim(COALESCE(u.raw_user_meta_data->>'username', u.raw_user_meta_data->>'displayName', ''))
      ELSE 'Player'
    END,
    COALESCE(NULLIF(u.raw_user_meta_data->>'avatarId', ''), 'marcus'),
    CASE
      WHEN upper(COALESCE(u.raw_user_meta_data->>'countryCode', '')) ~ '^[A-Z]{2}$'
        THEN upper(u.raw_user_meta_data->>'countryCode')
      ELSE ''
    END,
    COALESCE(u.created_at, now())
  FROM auth.users u
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

SELECT public.backfill_profiles_from_auth();

-- ---------------------------------------------------------------------------
-- B. match_requests
-- ---------------------------------------------------------------------------

CREATE TABLE public.match_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  ruleset_id text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  acceptor_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  accepted_at timestamptz,
  match_id uuid,
  CONSTRAINT match_requests_ruleset_check CHECK (ruleset_id IN ('legacy', 'haitian', 'american')),
  CONSTRAINT match_requests_status_check CHECK (status IN ('open', 'accepted', 'cancelled', 'expired')),
  CONSTRAINT match_requests_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT match_requests_open_shape CHECK (
    (status = 'open' AND acceptor_id IS NULL AND accepted_at IS NULL AND match_id IS NULL)
    OR status <> 'open'
  ),
  CONSTRAINT match_requests_accepted_shape CHECK (
    (status <> 'accepted')
    OR (acceptor_id IS NOT NULL AND accepted_at IS NOT NULL AND match_id IS NOT NULL AND acceptor_id <> creator_id)
  )
);

COMMENT ON TABLE public.match_requests IS
  'Public Find Match requests. ruleset_id is locked by the creator (legacy/haitian/american). Join profiles for display name/avatar.';
COMMENT ON COLUMN public.match_requests.ruleset_id IS
  'Engine id: Classic=legacy, Haitian=haitian, American=american. Immutable after insert.';

CREATE UNIQUE INDEX match_requests_one_open_per_creator
  ON public.match_requests (creator_id)
  WHERE status = 'open';

CREATE INDEX match_requests_open_created_idx
  ON public.match_requests (created_at DESC)
  WHERE status = 'open';

CREATE INDEX match_requests_creator_idx ON public.match_requests (creator_id);
CREATE INDEX match_requests_acceptor_idx ON public.match_requests (acceptor_id);

CREATE OR REPLACE FUNCTION public.match_requests_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  NEW.creator_id := auth.uid();
  NEW.status := 'open';
  NEW.acceptor_id := NULL;
  NEW.accepted_at := NULL;
  NEW.match_id := NULL;
  NEW.created_at := now();
  NEW.expires_at := now() + interval '10 minutes';
  IF NEW.ruleset_id IS NULL OR NEW.ruleset_id NOT IN ('legacy', 'haitian', 'american') THEN
    RAISE EXCEPTION 'invalid ruleset_id' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER match_requests_before_insert
  BEFORE INSERT ON public.match_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.match_requests_before_insert();

CREATE OR REPLACE FUNCTION public.match_requests_protect_immutable()
RETURNS trigger
LANGUAGE plpgsql
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
  RETURN NEW;
END;
$$;

CREATE TRIGGER match_requests_protect_immutable
  BEFORE UPDATE ON public.match_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.match_requests_protect_immutable();

-- ---------------------------------------------------------------------------
-- C. matches
-- ---------------------------------------------------------------------------

CREATE TABLE public.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES public.match_requests (id) ON DELETE RESTRICT,
  ruleset_id text NOT NULL,
  player_a uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  player_b uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ready',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matches_ruleset_check CHECK (ruleset_id IN ('legacy', 'haitian', 'american')),
  CONSTRAINT matches_status_check CHECK (status IN ('ready', 'playing', 'finished', 'aborted')),
  CONSTRAINT matches_two_distinct_players CHECK (player_a <> player_b)
);

COMMENT ON TABLE public.matches IS
  '1v1 online match created only by accept_match_request. ruleset_id copied from the request. Presence later: status playing => In Match.';
COMMENT ON COLUMN public.matches.player_a IS 'Creator of the Find Match request.';
COMMENT ON COLUMN public.matches.player_b IS 'Accepting player. Never the creator.';

CREATE INDEX matches_player_a_idx ON public.matches (player_a);
CREATE INDEX matches_player_b_idx ON public.matches (player_b);

ALTER TABLE public.match_requests
  ADD CONSTRAINT match_requests_match_id_fkey
  FOREIGN KEY (match_id) REFERENCES public.matches (id) DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION public.matches_protect_ruleset()
RETURNS trigger
LANGUAGE plpgsql
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
  RETURN NEW;
END;
$$;

CREATE TRIGGER matches_protect_ruleset
  BEFORE UPDATE ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.matches_protect_ruleset();

-- ---------------------------------------------------------------------------
-- F / G. Find Match RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accept_match_request(p_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  request public.match_requests%ROWTYPE;
  new_match_id uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request id required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO request
  FROM public.match_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match request not found' USING ERRCODE = 'P0002';
  END IF;
  IF request.creator_id = caller THEN
    RAISE EXCEPTION 'cannot accept own match request' USING ERRCODE = '42501';
  END IF;
  IF request.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'match request is not open' USING ERRCODE = '22023';
  END IF;
  IF request.expires_at <= now() THEN
    UPDATE public.match_requests
    SET status = 'expired'
    WHERE id = request.id AND status = 'open';
    RAISE EXCEPTION 'match request expired' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.matches (request_id, ruleset_id, player_a, player_b, status)
  VALUES (request.id, request.ruleset_id, request.creator_id, caller, 'ready')
  RETURNING id INTO new_match_id;

  UPDATE public.match_requests
  SET
    status = 'accepted',
    acceptor_id = caller,
    accepted_at = now(),
    match_id = new_match_id
  WHERE id = request.id
    AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match request is not open' USING ERRCODE = '22023';
  END IF;

  RETURN new_match_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_match_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  updated integer;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  UPDATE public.match_requests
  SET status = 'cancelled'
  WHERE id = p_request_id
    AND creator_id = caller
    AND status = 'open';

  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated = 0 THEN
    RAISE EXCEPTION 'cannot cancel match request' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- H. friend_requests + friendships
-- ---------------------------------------------------------------------------

CREATE TABLE public.friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT friend_requests_status_check CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  CONSTRAINT friend_requests_not_self CHECK (sender_id <> receiver_id),
  CONSTRAINT friend_requests_pending_shape CHECK (
    (status = 'pending' AND responded_at IS NULL) OR status <> 'pending'
  )
);

COMMENT ON TABLE public.friend_requests IS
  'Directed friend invites. Separate from match_requests and matches. Does not affect gameplay.';

CREATE UNIQUE INDEX friend_requests_one_pending_pair
  ON public.friend_requests (
    public.uuid_pair_low(sender_id, receiver_id),
    public.uuid_pair_high(sender_id, receiver_id)
  )
  WHERE status = 'pending';

CREATE INDEX friend_requests_receiver_pending_idx
  ON public.friend_requests (receiver_id, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX friend_requests_sender_idx ON public.friend_requests (sender_id);

CREATE TABLE public.friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  user_b uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friendships_ordered_pair CHECK (user_a < user_b),
  CONSTRAINT friendships_unique_pair UNIQUE (user_a, user_b)
);

COMMENT ON TABLE public.friendships IS
  'Accepted unordered friend pairs (user_a < user_b). Insert only via respond_to_friend_request.';

CREATE INDEX friendships_user_b_idx ON public.friendships (user_b);

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
  IF p_receiver_id IS NULL THEN
    RAISE EXCEPTION 'receiver id required' USING ERRCODE = '22023';
  END IF;
  IF p_receiver_id = caller THEN
    RAISE EXCEPTION 'cannot send a friend request to yourself' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_receiver_id) THEN
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

CREATE OR REPLACE FUNCTION public.cancel_friend_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  updated integer;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  UPDATE public.friend_requests
  SET status = 'cancelled', responded_at = now()
  WHERE id = p_request_id
    AND sender_id = caller
    AND status = 'pending';

  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated = 0 THEN
    RAISE EXCEPTION 'cannot cancel friend request' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_friend_request(p_request_id uuid, p_action text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  request public.friend_requests%ROWTYPE;
  action text := lower(btrim(COALESCE(p_action, '')));
  low_id uuid;
  high_id uuid;
  new_friendship_id uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF action NOT IN ('accept', 'decline') THEN
    RAISE EXCEPTION 'action must be accept or decline' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO request
  FROM public.friend_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'friend request not found' USING ERRCODE = 'P0002';
  END IF;
  IF request.receiver_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'only the receiver may respond' USING ERRCODE = '42501';
  END IF;
  IF request.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'friend request is not pending' USING ERRCODE = '22023';
  END IF;

  IF action = 'decline' THEN
    UPDATE public.friend_requests
    SET status = 'declined', responded_at = now()
    WHERE id = request.id AND status = 'pending';
    RETURN NULL;
  END IF;

  low_id := public.uuid_pair_low(request.sender_id, request.receiver_id);
  high_id := public.uuid_pair_high(request.sender_id, request.receiver_id);

  INSERT INTO public.friendships (user_a, user_b)
  VALUES (low_id, high_id)
  RETURNING id INTO new_friendship_id;

  UPDATE public.friend_requests
  SET status = 'accepted', responded_at = now()
  WHERE id = request.id AND status = 'pending';

  RETURN new_friendship_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- K. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_authenticated
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY match_requests_select_relevant
  ON public.match_requests
  FOR SELECT
  TO authenticated
  USING (
    status = 'open'
    OR creator_id = auth.uid()
    OR acceptor_id = auth.uid()
  );

CREATE POLICY match_requests_insert_self
  ON public.match_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (creator_id = auth.uid() AND status = 'open');

CREATE POLICY matches_select_participants
  ON public.matches
  FOR SELECT
  TO authenticated
  USING (player_a = auth.uid() OR player_b = auth.uid());

CREATE POLICY friend_requests_select_parties
  ON public.friend_requests
  FOR SELECT
  TO authenticated
  USING (sender_id = auth.uid() OR receiver_id = auth.uid());

CREATE POLICY friendships_select_members
  ON public.friendships
  FOR SELECT
  TO authenticated
  USING (user_a = auth.uid() OR user_b = auth.uid());

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.match_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.matches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.friend_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.friendships FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (display_name, avatar_id, country_code) ON TABLE public.profiles TO authenticated;
GRANT SELECT ON TABLE public.match_requests TO authenticated;
GRANT INSERT (ruleset_id) ON TABLE public.match_requests TO authenticated;
GRANT SELECT ON TABLE public.matches TO authenticated;
GRANT SELECT ON TABLE public.friend_requests TO authenticated;
GRANT SELECT ON TABLE public.friendships TO authenticated;

REVOKE ALL ON FUNCTION public.backfill_profiles_from_auth() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_match_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_match_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.send_friend_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_friend_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_to_friend_request(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.accept_match_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_match_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_friend_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_friend_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_friend_request(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- L. Realtime publication (hosted Supabase)
-- ---------------------------------------------------------------------------

ALTER TABLE public.match_requests REPLICA IDENTITY FULL;
ALTER TABLE public.friend_requests REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'match_requests'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.match_requests;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'friend_requests'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_requests;
    END IF;
  END IF;
END $$;

COMMIT;
