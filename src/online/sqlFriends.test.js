/**
 * Contract test for friends status SQL.
 * Does not connect to Supabase. Run: node src/online/sqlFriends.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const foundation = readFileSync(
  join(root, "supabase/migrations/20260823120000_find_match_friends_foundation.sql"),
  "utf8"
);
const statusSql = readFileSync(
  join(root, "supabase/migrations/20260826140000_friends_status.sql"),
  "utf8"
);
const occupancy = readFileSync(
  join(root, "supabase/migrations/20260826120000_one_active_match.sql"),
  "utf8"
);

assert.match(foundation, /CREATE OR REPLACE FUNCTION public\.send_friend_request/);
assert.match(foundation, /cannot send a friend request to yourself/);
assert.match(foundation, /friend_requests_one_pending_pair/);
assert.match(foundation, /INSERT INTO public\.friendships/);
assert.match(foundation, /SET status = 'declined'/);
assert.match(foundation, /CREATE OR REPLACE FUNCTION public\.cancel_friend_request/);
assert.match(foundation, /only the receiver may respond/);
assert.match(foundation, /REVOKE ALL ON TABLE public\.friendships/);
assert.match(foundation, /GRANT SELECT ON TABLE public\.friendships TO authenticated/);
assert.doesNotMatch(foundation, /GRANT INSERT ON TABLE public\.friendships/);
assert.match(foundation, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.friend_requests/);

const declineBranch = foundation.slice(
  foundation.indexOf("IF action = 'decline'"),
  foundation.indexOf("INSERT INTO public.friendships")
);
assert.match(declineBranch, /SET status = 'declined'/);
assert.doesNotMatch(declineBranch, /INSERT INTO public\.friendships/);

assert.match(statusSql, /CREATE OR REPLACE FUNCTION public\.list_friends_in_active_match\(\)/);
assert.match(statusSql, /SECURITY DEFINER/);
assert.match(statusSql, /FROM public\.active_match_players/);
assert.match(statusSql, /FROM public\.friendships f/);
assert.match(statusSql, /a\.player_id <> auth\.uid\(\)/);
assert.match(statusSql, /GRANT EXECUTE ON FUNCTION public\.list_friends_in_active_match\(\) TO authenticated/);
assert.doesNotMatch(statusSql, /CREATE OR REPLACE FUNCTION public\.accept_match_request/);
assert.doesNotMatch(statusSql, /GRANT SELECT ON TABLE public\.active_match_players/);
assert.doesNotMatch(occupancy, /GRANT SELECT ON TABLE public\.active_match_players TO authenticated/);

console.log("  ✓ friends SQL contract");
