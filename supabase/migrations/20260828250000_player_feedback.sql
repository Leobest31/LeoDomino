-- Player feedback for Settings → Send Feedback.
-- Submissions are insert-only through submit_my_feedback.
-- No player SELECT/UPDATE/DELETE. No Admin Dashboard policies.

CREATE TABLE public.player_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.profiles (id),
  category text NOT NULL,
  body text NOT NULL,
  app_version text,
  platform text,
  build_number text,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_feedback_category_check
    CHECK (category IN ('general', 'bug', 'feature')),
  CONSTRAINT player_feedback_status_check
    CHECK (status IN ('new', 'reviewed', 'resolved')),
  CONSTRAINT player_feedback_body_len
    CHECK (char_length(body) BETWEEN 20 AND 2000),
  CONSTRAINT player_feedback_platform_check
    CHECK (platform IS NULL OR platform IN ('ios', 'android', 'web'))
);

COMMENT ON TABLE public.player_feedback IS
  'In-app player feedback. Written only by submit_my_feedback. Players cannot read rows.';

CREATE INDEX player_feedback_player_created_idx
  ON public.player_feedback (player_id, created_at DESC);

ALTER TABLE public.player_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_feedback FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.player_feedback FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_my_feedback(
  p_category text,
  p_body text,
  p_app_version text DEFAULT NULL,
  p_platform text DEFAULT NULL,
  p_build_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  cleaned text := btrim(COALESCE(p_body, ''));
  category_in text := lower(btrim(COALESCE(p_category, '')));
  platform_in text := lower(btrim(COALESCE(p_platform, '')));
  version_in text := left(btrim(COALESCE(p_app_version, '')), 32);
  build_in text := left(btrim(COALESCE(p_build_number, '')), 32);
  new_id uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF category_in NOT IN ('general', 'bug', 'feature') THEN
    RAISE EXCEPTION 'FEEDBACK_CATEGORY' USING ERRCODE = 'P0001';
  END IF;

  IF char_length(cleaned) < 20 THEN
    RAISE EXCEPTION 'FEEDBACK_BODY_SHORT' USING ERRCODE = 'P0001';
  END IF;

  IF char_length(cleaned) > 2000 THEN
    RAISE EXCEPTION 'FEEDBACK_BODY_LONG' USING ERRCODE = 'P0001';
  END IF;

  IF platform_in NOT IN ('ios', 'android', 'web') THEN
    platform_in := NULL;
  END IF;

  IF version_in = '' THEN
    version_in := NULL;
  END IF;

  IF build_in = '' THEN
    build_in := NULL;
  END IF;

  IF (
    SELECT COUNT(*)
    FROM public.player_feedback
    WHERE player_id = caller
      AND created_at > now() - interval '1 hour'
  ) >= 5 THEN
    RAISE EXCEPTION 'FEEDBACK_RATE_LIMIT' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.player_feedback (
    player_id,
    category,
    body,
    app_version,
    platform,
    build_number,
    status
  )
  VALUES (
    caller,
    category_in,
    cleaned,
    version_in,
    platform_in,
    build_in,
    'new'
  )
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('ok', true, 'id', new_id);
END;
$$;

COMMENT ON FUNCTION public.submit_my_feedback(text, text, text, text, text) IS
  'Authenticated player submits feedback. player_id and status are server-stamped.';

REVOKE ALL ON FUNCTION public.submit_my_feedback(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_my_feedback(text, text, text, text, text) TO authenticated;
