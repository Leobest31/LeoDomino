-- Friends status: In Match from occupancy, without exposing occupancy to clients.
-- Does not change accept_match_request, Find Match, or gameplay.

CREATE OR REPLACE FUNCTION public.list_friends_in_active_match()
RETURNS TABLE (player_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.player_id
  FROM public.active_match_players a
  WHERE auth.uid() IS NOT NULL
    AND a.player_id <> auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.friendships f
      WHERE (f.user_a = auth.uid() AND f.user_b = a.player_id)
         OR (f.user_b = auth.uid() AND f.user_a = a.player_id)
    );
$$;

COMMENT ON FUNCTION public.list_friends_in_active_match() IS
  'Informational In Match status for the caller''s friends only. Not used by gameplay or accept_match_request.';

REVOKE ALL ON FUNCTION public.list_friends_in_active_match() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_friends_in_active_match() TO authenticated;
