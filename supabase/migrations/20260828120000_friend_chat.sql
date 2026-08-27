-- V1 friends-only persistent Live Chat.
-- Conversation identity is the canonical pair (user_a < user_b), independent of
-- friendships.id, so unfriend/re-friend reuses the same thread.
-- Clients never submit sender_id, conversation authority, or unread counters.
-- Blocking is not implemented; insert that check in _can_friend_message later.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

CREATE TABLE public.friend_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  CONSTRAINT friend_conversations_ordered_pair CHECK (user_a < user_b),
  CONSTRAINT friend_conversations_unique_pair UNIQUE (user_a, user_b)
);

COMMENT ON TABLE public.friend_conversations IS
  'One persistent text conversation per canonical player pair. Survives unfriend/re-friend. Not keyed by friendships.id or matchId.';

CREATE INDEX friend_conversations_last_message_idx
  ON public.friend_conversations (last_message_at DESC NULLS LAST);

CREATE TABLE public.friend_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.friend_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friend_messages_body_len CHECK (char_length(body) BETWEEN 1 AND 1000),
  CONSTRAINT friend_messages_body_trimmed CHECK (body = btrim(body))
);

COMMENT ON TABLE public.friend_messages IS
  'Append-only friends-only text messages. Sender is always auth.uid() at insert. No client edit/delete.';

CREATE INDEX friend_messages_conversation_created_idx
  ON public.friend_messages (conversation_id, created_at DESC, id DESC);

CREATE INDEX friend_messages_sender_recent_idx
  ON public.friend_messages (sender_id, created_at DESC);

CREATE TABLE public.friend_conversation_reads (
  conversation_id uuid NOT NULL REFERENCES public.friend_conversations(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_read_message_id uuid REFERENCES public.friend_messages(id) ON DELETE SET NULL,
  last_read_at timestamptz,
  PRIMARY KEY (conversation_id, player_id)
);

COMMENT ON TABLE public.friend_conversation_reads IS
  'Per-participant read cursor. Unread counts are computed, never client-written.';

-- ---------------------------------------------------------------------------
-- Authorization + conversation helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._can_friend_message(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_a IS NOT NULL
    AND p_b IS NOT NULL
    AND p_a IS DISTINCT FROM p_b
    AND EXISTS (
      SELECT 1
      FROM public.friendships
      WHERE user_a = public.uuid_pair_low(p_a, p_b)
        AND user_b = public.uuid_pair_high(p_a, p_b)
    );
$$;

COMMENT ON FUNCTION public._can_friend_message(uuid, uuid) IS
  'V1: accepted friendship only. Add blocked-user checks here later without changing send_friend_message.';

CREATE OR REPLACE FUNCTION public._friend_message_contains_link(p_body text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = public
AS $$
  SELECT
    p_body ~* 'https?://'
    OR p_body ~* 'www\.'
    OR p_body ~* '://'
    OR p_body ~* '\m[a-z0-9][a-z0-9-]*\.(com|net|org|io|app|gg|co)(/|\M)';
$$;

CREATE OR REPLACE FUNCTION public._ensure_friend_conversation(p_user_a uuid, p_user_b uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  low_id uuid;
  high_id uuid;
  conv_id uuid;
BEGIN
  IF p_user_a IS NULL OR p_user_b IS NULL OR p_user_a = p_user_b THEN
    RAISE EXCEPTION 'conversation pair required' USING ERRCODE = '22023';
  END IF;

  low_id := public.uuid_pair_low(p_user_a, p_user_b);
  high_id := public.uuid_pair_high(p_user_a, p_user_b);

  INSERT INTO public.friend_conversations (user_a, user_b)
  VALUES (low_id, high_id)
  ON CONFLICT (user_a, user_b) DO NOTHING;

  SELECT c.id
  INTO conv_id
  FROM public.friend_conversations c
  WHERE c.user_a = low_id AND c.user_b = high_id;

  INSERT INTO public.friend_conversation_reads (conversation_id, player_id)
  VALUES (conv_id, low_id), (conv_id, high_id)
  ON CONFLICT (conversation_id, player_id) DO NOTHING;

  RETURN conv_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.friendships_ensure_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._ensure_friend_conversation(NEW.user_a, NEW.user_b);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friendships_ensure_conversation ON public.friendships;
CREATE TRIGGER friendships_ensure_conversation
  AFTER INSERT ON public.friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.friendships_ensure_conversation();

-- Existing-friend backfill
INSERT INTO public.friend_conversations (user_a, user_b)
SELECT f.user_a, f.user_b
FROM public.friendships f
ON CONFLICT (user_a, user_b) DO NOTHING;

INSERT INTO public.friend_conversation_reads (conversation_id, player_id)
SELECT c.id, c.user_a
FROM public.friend_conversations c
ON CONFLICT (conversation_id, player_id) DO NOTHING;

INSERT INTO public.friend_conversation_reads (conversation_id, player_id)
SELECT c.id, c.user_b
FROM public.friend_conversations c
ON CONFLICT (conversation_id, player_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Immutability / insert identity
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.friend_messages_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  NEW.sender_id := auth.uid();
  NEW.body := btrim(NEW.body);
  IF NEW.body IS NULL OR char_length(NEW.body) < 1 THEN
    RAISE EXCEPTION 'message is empty' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.friend_conversations c
    WHERE c.id = NEW.conversation_id
      AND (c.user_a = NEW.sender_id OR c.user_b = NEW.sender_id)
  ) THEN
    RAISE EXCEPTION 'sender is not a conversation participant' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friend_messages_before_insert ON public.friend_messages;
CREATE TRIGGER friend_messages_before_insert
  BEFORE INSERT ON public.friend_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.friend_messages_before_insert();

CREATE OR REPLACE FUNCTION public.friend_messages_protect_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'friend_messages is immutable' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'DELETE' AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'friend_messages is immutable' USING ERRCODE = '22023';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS friend_messages_protect_immutable ON public.friend_messages;
CREATE TRIGGER friend_messages_protect_immutable
  BEFORE UPDATE OR DELETE ON public.friend_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.friend_messages_protect_immutable();

CREATE OR REPLACE FUNCTION public.friend_conversations_protect_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'friend_conversations.id is immutable' USING ERRCODE = '22023';
  END IF;
  IF NEW.user_a IS DISTINCT FROM OLD.user_a OR NEW.user_b IS DISTINCT FROM OLD.user_b THEN
    RAISE EXCEPTION 'friend_conversations pair is immutable' USING ERRCODE = '22023';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'friend_conversations.created_at is immutable' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friend_conversations_protect_identity ON public.friend_conversations;
CREATE TRIGGER friend_conversations_protect_identity
  BEFORE UPDATE ON public.friend_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.friend_conversations_protect_identity();

-- ---------------------------------------------------------------------------
-- Client RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.send_friend_message(p_friend_id uuid, p_body text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  body_text text;
  conv_id uuid;
  recent_count integer;
  prev_body text;
  prev_at timestamptz;
  inserted public.friend_messages%ROWTYPE;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_friend_id IS NULL THEN
    RAISE EXCEPTION 'friend id required' USING ERRCODE = '22023';
  END IF;
  IF p_friend_id = caller THEN
    RAISE EXCEPTION 'cannot message yourself' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_friend_id) THEN
    RAISE EXCEPTION 'player not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._can_friend_message(caller, p_friend_id) THEN
    RAISE EXCEPTION 'not friends' USING ERRCODE = '42501';
  END IF;

  body_text := btrim(COALESCE(p_body, ''));
  IF char_length(body_text) < 1 THEN
    RAISE EXCEPTION 'message is empty' USING ERRCODE = '22023';
  END IF;
  IF char_length(body_text) > 1000 THEN
    RAISE EXCEPTION 'message is too long' USING ERRCODE = '22023';
  END IF;
  IF body_text ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'message contains invalid characters' USING ERRCODE = '22023';
  END IF;
  IF public._friend_message_contains_link(body_text) THEN
    RAISE EXCEPTION 'links are not allowed' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('leo-friend-chat:' || caller::text));

  conv_id := public._ensure_friend_conversation(caller, p_friend_id);

  SELECT COUNT(*)::integer
  INTO recent_count
  FROM public.friend_messages
  WHERE sender_id = caller
    AND created_at > now() - interval '5 seconds';

  IF recent_count >= 5 THEN
    RAISE EXCEPTION 'too many messages' USING ERRCODE = '22023';
  END IF;

  SELECT m.body, m.created_at
  INTO prev_body, prev_at
  FROM public.friend_messages m
  WHERE m.conversation_id = conv_id
    AND m.sender_id = caller
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT 1;

  IF prev_at IS NOT NULL
     AND prev_body = body_text
     AND prev_at > now() - interval '5 seconds' THEN
    RAISE EXCEPTION 'repeated message' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.friend_messages (conversation_id, sender_id, body)
  VALUES (conv_id, caller, body_text)
  RETURNING * INTO inserted;

  UPDATE public.friend_conversations
  SET last_message_at = inserted.created_at
  WHERE id = conv_id;

  RETURN jsonb_build_object(
    'id', inserted.id,
    'conversation_id', inserted.conversation_id,
    'sender_id', inserted.sender_id,
    'body', inserted.body,
    'created_at', inserted.created_at
  );
END;
$$;

COMMENT ON FUNCTION public.send_friend_message(uuid, text) IS
  'Persist a friends-only text message. Sender is auth.uid(). Recipient does not need to be online.';

CREATE OR REPLACE FUNCTION public.list_my_friend_conversations()
RETURNS TABLE (
  conversation_id uuid,
  other_player_id uuid,
  display_name text,
  avatar_id text,
  country_code text,
  last_message_preview text,
  last_message_at timestamptz,
  unread_count integer,
  is_friend boolean
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
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    p.id,
    p.display_name,
    p.avatar_id,
    p.country_code,
    lm.body,
    c.last_message_at,
    (
      SELECT COUNT(*)::integer
      FROM public.friend_messages m
      LEFT JOIN public.friend_conversation_reads r
        ON r.conversation_id = c.id AND r.player_id = caller
      LEFT JOIN public.friend_messages lr ON lr.id = r.last_read_message_id
      WHERE m.conversation_id = c.id
        AND m.sender_id <> caller
        AND (
          r.last_read_message_id IS NULL
          OR m.created_at > lr.created_at
          OR (m.created_at = lr.created_at AND m.id > lr.id)
        )
    ),
    EXISTS (
      SELECT 1
      FROM public.friendships f
      WHERE f.user_a = c.user_a AND f.user_b = c.user_b
    )
  FROM public.friend_conversations c
  JOIN public.profiles p
    ON p.id = CASE WHEN c.user_a = caller THEN c.user_b ELSE c.user_a END
  LEFT JOIN LATERAL (
    SELECT m.body
    FROM public.friend_messages m
    WHERE m.conversation_id = c.id
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ) lm ON true
  WHERE c.user_a = caller OR c.user_b = caller
  ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_friend_messages(
  p_conversation_id uuid,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  conv public.friend_conversations%ROWTYPE;
  before_created_at timestamptz := p_before_created_at;
  before_id uuid := p_before_id;
  effective_limit integer;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'conversation id required' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO conv
  FROM public.friend_conversations
  WHERE public.friend_conversations.id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'P0002';
  END IF;
  IF conv.user_a <> caller AND conv.user_b <> caller THEN
    RAISE EXCEPTION 'not a conversation participant' USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 THEN
    effective_limit := 50;
  ELSE
    effective_limit := LEAST(p_limit, 50);
  END IF;

  IF before_id IS NOT NULL AND before_created_at IS NULL THEN
    SELECT m.created_at
    INTO before_created_at
    FROM public.friend_messages m
    WHERE m.id = before_id
      AND m.conversation_id = p_conversation_id;
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.conversation_id,
    m.sender_id,
    m.body,
    m.created_at
  FROM public.friend_messages m
  WHERE m.conversation_id = p_conversation_id
    AND (
      before_created_at IS NULL
      OR m.created_at < before_created_at
      OR (
        m.created_at = before_created_at
        AND (before_id IS NULL OR m.id < before_id)
      )
    )
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT effective_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_friend_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  conv public.friend_conversations%ROWTYPE;
  latest_id uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'conversation id required' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO conv
  FROM public.friend_conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'P0002';
  END IF;
  IF conv.user_a <> caller AND conv.user_b <> caller THEN
    RAISE EXCEPTION 'not a conversation participant' USING ERRCODE = '42501';
  END IF;

  SELECT m.id
  INTO latest_id
  FROM public.friend_messages m
  WHERE m.conversation_id = p_conversation_id
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT 1;

  INSERT INTO public.friend_conversation_reads (
    conversation_id,
    player_id,
    last_read_message_id,
    last_read_at
  )
  VALUES (p_conversation_id, caller, latest_id, now())
  ON CONFLICT (conversation_id, player_id)
  DO UPDATE SET
    last_read_message_id = EXCLUDED.last_read_message_id,
    last_read_at = EXCLUDED.last_read_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_unread_message_count()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  unread integer;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT COUNT(*)::integer
  INTO unread
  FROM public.friend_conversations c
  JOIN public.friend_messages m ON m.conversation_id = c.id
  LEFT JOIN public.friend_conversation_reads r
    ON r.conversation_id = c.id AND r.player_id = caller
  LEFT JOIN public.friend_messages lr ON lr.id = r.last_read_message_id
  WHERE (c.user_a = caller OR c.user_b = caller)
    AND m.sender_id <> caller
    AND (
      r.last_read_message_id IS NULL
      OR m.created_at > lr.created_at
      OR (m.created_at = lr.created_at AND m.id > lr.id)
    );

  RETURN COALESCE(unread, 0);
END;
$$;

COMMENT ON FUNCTION public.get_my_unread_message_count() IS
  'Total inbound unread friend-chat messages for the signed-in player. Foundation for the later notification bell.';

CREATE OR REPLACE FUNCTION public.unfriend_player(p_friend_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  low_id uuid;
  high_id uuid;
  updated integer;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_friend_id IS NULL THEN
    RAISE EXCEPTION 'friend id required' USING ERRCODE = '22023';
  END IF;
  IF p_friend_id = caller THEN
    RAISE EXCEPTION 'cannot unfriend yourself' USING ERRCODE = '22023';
  END IF;

  low_id := public.uuid_pair_low(caller, p_friend_id);
  high_id := public.uuid_pair_high(caller, p_friend_id);

  DELETE FROM public.friendships
  WHERE user_a = low_id AND user_b = high_id;

  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated = 0 THEN
    RAISE EXCEPTION 'not friends' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.unfriend_player(uuid) IS
  'Removes the canonical friendships row only. Historical conversation and messages remain readable. New sends stop immediately.';

-- ---------------------------------------------------------------------------
-- RLS / grants
-- ---------------------------------------------------------------------------

ALTER TABLE public.friend_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_conversation_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS friend_conversations_select_participants ON public.friend_conversations;
CREATE POLICY friend_conversations_select_participants
  ON public.friend_conversations
  FOR SELECT
  TO authenticated
  USING (user_a = (SELECT auth.uid()) OR user_b = (SELECT auth.uid()));

DROP POLICY IF EXISTS friend_messages_select_participants ON public.friend_messages;
CREATE POLICY friend_messages_select_participants
  ON public.friend_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.friend_conversations c
      WHERE c.id = conversation_id
        AND (c.user_a = (SELECT auth.uid()) OR c.user_b = (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS friend_conversation_reads_select_own ON public.friend_conversation_reads;
CREATE POLICY friend_conversation_reads_select_own
  ON public.friend_conversation_reads
  FOR SELECT
  TO authenticated
  USING (player_id = (SELECT auth.uid()));

REVOKE ALL ON TABLE public.friend_conversations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.friend_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.friend_conversation_reads FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.friend_conversations TO authenticated;
GRANT SELECT ON TABLE public.friend_messages TO authenticated;
GRANT SELECT ON TABLE public.friend_conversation_reads TO authenticated;

REVOKE ALL ON FUNCTION public._can_friend_message(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._friend_message_contains_link(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ensure_friend_conversation(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.friendships_ensure_conversation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.friend_messages_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.friend_messages_protect_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.friend_conversations_protect_identity() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.send_friend_message(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_friend_message(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.send_friend_message(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.send_friend_message(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.list_my_friend_conversations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_my_friend_conversations() FROM anon;
GRANT EXECUTE ON FUNCTION public.list_my_friend_conversations() TO authenticated;

REVOKE ALL ON FUNCTION public.list_friend_messages(uuid, timestamptz, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_friend_messages(uuid, timestamptz, uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_friend_messages(uuid, timestamptz, uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_friend_conversation_read(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_friend_conversation_read(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_friend_conversation_read(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_my_unread_message_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_unread_message_count() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_unread_message_count() TO authenticated;

REVOKE ALL ON FUNCTION public.unfriend_player(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unfriend_player(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.unfriend_player(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.unfriend_player(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Realtime publication (messages only)
-- ---------------------------------------------------------------------------

ALTER TABLE public.friend_messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'friend_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_messages;
    END IF;
  END IF;
END $$;
