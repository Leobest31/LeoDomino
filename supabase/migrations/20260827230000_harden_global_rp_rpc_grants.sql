-- Harden Global RP read RPC grants.
-- PostgreSQL grants EXECUTE to PUBLIC by default; both RPCs already reject a
-- null auth.uid(), but execution must be authenticated-only.
-- Does not alter function bodies, tables, RLS, or RP settlement.

REVOKE ALL ON FUNCTION public.get_my_global_rating() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_global_rating() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_global_rating() TO authenticated;

REVOKE ALL ON FUNCTION public.get_match_rp_result(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_match_rp_result(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_match_rp_result(uuid) TO authenticated;
