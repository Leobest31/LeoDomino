-- Public read-only Challenge schedule for signed-in Home.
-- Does NOT apply status from the clock. Does NOT enable CP earning.
-- Does NOT grant table SELECT. Does NOT add Realtime. No player writer.

REVOKE ALL ON TABLE public.challenge_config FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_challenge_schedule()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_build_object(
        'status', c.status,
        'starts_at', c.starts_at,
        'ends_at', c.ends_at,
        'qualification_cp', c.qualification_cp,
        'first_prize_usd', c.first_prize_usd,
        'second_prize_usd', c.second_prize_usd,
        'cp_earning_enabled', false
      )
      FROM public.challenge_config c
      WHERE c.id = 1
    ),
    jsonb_build_object(
      'status', 'coming_soon',
      'starts_at', NULL,
      'ends_at', NULL,
      'qualification_cp', 5000,
      'first_prize_usd', 300,
      'second_prize_usd', 200,
      'cp_earning_enabled', false
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_public_challenge_schedule() IS
  'Authenticated Home Challenge schedule. Public metadata only. CP earning is always reported false. Does not auto-live.';

REVOKE ALL ON FUNCTION public.get_public_challenge_schedule() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_challenge_schedule() TO authenticated;
