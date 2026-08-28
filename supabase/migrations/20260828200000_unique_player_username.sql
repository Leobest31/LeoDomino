-- Unique player username, separate from display_name.
-- CREATE in the repo for review. Do NOT apply to hosted Supabase until approved.
-- Does not copy display_name into username. Duplicate display names stay as-is.
-- Existing profiles may keep username NULL. New auth.users inserts require a valid handle.
-- Search is username-only (exact first, then partial, case-insensitive).
-- Returns no email, phone, or auth identity fields.

-- ---------------------------------------------------------------------------
-- A. username column — nullable so existing rows are not invented handles
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text;

COMMENT ON COLUMN public.profiles.username IS
  'Globally unique player handle. Case-insensitive. Separate from display_name. Null until the player claims one.';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_fmt;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_fmt CHECK (
    username IS NULL OR username ~ '^[a-z][a-z0-9_]{2,19}$'
  );

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique
  ON public.profiles (username)
  WHERE username IS NOT NULL;

-- ---------------------------------------------------------------------------
-- B. normalize + availability (signup may call availability while logged out)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalize_player_username(p_username text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  handle text;
BEGIN
  handle := lower(btrim(COALESCE(p_username, '')));
  IF left(handle, 1) = '@' THEN
    handle := substring(handle from 2);
  END IF;
  handle := btrim(handle);
  IF handle ~ '^[a-z][a-z0-9_]{2,19}$' THEN
    RETURN handle;
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.normalize_player_username(text) IS
  'Canonical unique username: lowercase, optional leading @ stripped, [a-z][a-z0-9_]{2,19}. Not granted to clients.';

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
    IF TG_OP = 'UPDATE' AND OLD.username IS NOT NULL THEN
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

COMMENT ON FUNCTION public.normalize_profile_username() IS
  'Before-insert/update trigger. SECURITY DEFINER so own-row username claim works without granting the normalizer to clients.';

DROP TRIGGER IF EXISTS profiles_normalize_username ON public.profiles;
CREATE TRIGGER profiles_normalize_username
  BEFORE INSERT OR UPDATE OF username ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_profile_username();

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
      AND id IS DISTINCT FROM auth.uid()
  );
END;
$$;

COMMENT ON FUNCTION public.is_username_available(text) IS
  'Boolean-only availability. SECURITY DEFINER so anon signup can check without reading profile rows. Case-normalized. Own current handle counts as available.';

-- ---------------------------------------------------------------------------
-- C. search by username — exact, then prefix, then partial. Never email/phone.
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
    AND p.id <> caller
    AND p.username ILIKE '%' || needle || '%' ESCAPE '\'
  ORDER BY
    (handle IS NOT NULL AND p.username = handle) DESC,
    (p.username LIKE needle || '%' ESCAPE '\') DESC,
    p.username ASC
  LIMIT 12;
END;
$$;

COMMENT ON FUNCTION public.search_players_by_username(text) IS
  'Authenticated username search. SECURITY DEFINER so it can use the private normalizer. Exact, then prefix, then partial. Public profile fields only. Not granted to anon.';

-- ---------------------------------------------------------------------------
-- D. signup trigger — new auth users must present a valid unique username
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  raw_handle text := COALESCE(meta->>'username', '');
  raw_name text := COALESCE(meta->>'displayName', meta->>'display_name', '');
  raw_avatar text := COALESCE(meta->>'avatarId', meta->>'avatar_id', 'marcus');
  raw_country text := upper(COALESCE(meta->>'countryCode', meta->>'country_code', ''));
  handle text;
  visible text := btrim(raw_name);
BEGIN
  IF btrim(raw_handle) = '' THEN
    RAISE EXCEPTION 'username is required' USING ERRCODE = '22023';
  END IF;

  handle := public.normalize_player_username(raw_handle);
  IF handle IS NULL THEN
    RAISE EXCEPTION 'invalid username' USING ERRCODE = '22023';
  END IF;

  IF char_length(visible) NOT BETWEEN 1 AND 40 THEN
    visible := handle;
  END IF;
  IF char_length(visible) NOT BETWEEN 1 AND 40 THEN
    visible := 'Player';
  END IF;

  INSERT INTO public.profiles (id, username, display_name, avatar_id, country_code)
  VALUES (
    NEW.id,
    handle,
    visible,
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

-- ---------------------------------------------------------------------------
-- E. grants — username is readable on profiles SELECT; own-row UPDATE includes it
-- ---------------------------------------------------------------------------

GRANT UPDATE (username) ON TABLE public.profiles TO authenticated;

REVOKE ALL ON FUNCTION public.normalize_player_username(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_profile_username() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_username_available(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_players_by_username(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_players_by_username(text) TO authenticated;
