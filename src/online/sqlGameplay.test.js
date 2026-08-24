/**
 * Contract test for the live 1v1 gameplay SQL foundation.
 * Does not connect to Supabase. Run: node src/online/sqlGameplay.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20260824120000_online_gameplay_foundation.sql"),
  "utf8"
);

function mustInclude(pattern, message) {
  assert.match(sql, pattern, message);
}

mustInclude(/CREATE TABLE public\.game_sessions/, "game_sessions table");
mustInclude(/CREATE TABLE public\.game_secrets/, "game_secrets table");
mustInclude(/CREATE TABLE public\.game_actions/, "game_actions table");
mustInclude(/match_id uuid PRIMARY KEY REFERENCES public\.matches/, "one session per match");
mustInclude(/version integer NOT NULL DEFAULT 0/, "version");
mustInclude(/current_seat integer NOT NULL/, "current seat");
mustInclude(/reserve_count integer NOT NULL/, "reserve count only");
mustInclude(/hand_counts jsonb NOT NULL/, "hand counts only");
mustInclude(/engine_state jsonb NOT NULL/, "secret engine state");
mustInclude(/deal_seed bigint NOT NULL/, "server deal seed");
mustInclude(/UNIQUE \(match_id, version\)/, "one action per version");
mustInclude(/game_actions is append-only/, "actions append-only");
mustInclude(/Authenticated clients must never SELECT this table/, "secrets unreadable");

mustInclude(/ENABLE ROW LEVEL SECURITY/, "RLS enabled");
mustInclude(/FORCE ROW LEVEL SECURITY/, "RLS forced");
mustInclude(/game_sessions_select_participants/, "sessions readable by seats");
mustInclude(/game_actions_select_participants/, "actions readable by seats");
assert.doesNotMatch(sql, /CREATE POLICY[\s\S]*ON public\.game_secrets/, "no secrets policies");
mustInclude(
  /REVOKE ALL ON TABLE public\.game_secrets FROM PUBLIC, anon, authenticated/,
  "secrets revoked"
);
assert.doesNotMatch(sql, /GRANT SELECT ON TABLE public\.game_secrets TO authenticated/, "no secrets select");
mustInclude(/GRANT SELECT ON TABLE public\.game_sessions TO authenticated/, "sessions selectable");

mustInclude(/CREATE OR REPLACE FUNCTION public\.get_game_view\(p_match_id uuid\)/, "get_game_view");
mustInclude(/'myHand', my_hand/, "viewer hand");
mustInclude(/Never returns opponent hand, reserve ids, seed, or engine_state/, "view contract");
mustInclude(/not a seated player/, "non-player rejected");
mustInclude(/authentication required/, "anon rejected");
mustInclude(/engine_state -> 'players' -> viewer_seat -> 'hand'/, "viewer hand from secret");

mustInclude(/CREATE OR REPLACE FUNCTION public\.install_online_game/, "install helper");
mustInclude(/ON CONFLICT \(match_id\) DO NOTHING/, "idempotent install");
mustInclude(/CREATE OR REPLACE FUNCTION public\.commit_online_game_transition/, "commit helper");
mustInclude(/FOR UPDATE/, "row lock");
mustInclude(/stale expected_version/, "CAS stale version");
mustInclude(/new_version := p_expected_version \+ 1/, "version + 1");
mustInclude(/service role required/, "service-role only writes");
mustInclude(/GRANT EXECUTE ON FUNCTION public\.get_game_view\(uuid\) TO authenticated/, "view execute");
mustInclude(
  /REVOKE ALL ON FUNCTION public\.install_online_game\(uuid, text, jsonb, jsonb, bigint\) FROM PUBLIC, anon, authenticated/,
  "install revoked from clients"
);

mustInclude(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.game_sessions/, "sessions realtime");
mustInclude(/REPLICA IDENTITY FULL/, "replica identity");
assert.doesNotMatch(sql, /ADD TABLE public\.game_secrets/, "secrets unpublished");
assert.doesNotMatch(sql, /ADD TABLE public\.game_actions/, "actions unpublished");

const home = readFileSync(join(root, "src/pages/HomePage.jsx"), "utf8");
const findMatch = readFileSync(join(root, "src/pages/FindMatchPage.jsx"), "utf8");
const matchHook = readFileSync(join(root, "src/hooks/useMatch.js"), "utf8");
assert.doesNotMatch(home, /game_sessions|get_game_view|enter_online_match/, "Home unwired");
assert.doesNotMatch(findMatch, /game_sessions|get_game_view|enter_online_match/, "Find Match unwired");
assert.doesNotMatch(matchHook, /game_sessions|get_game_view/, "useMatch still offline");

console.log("  ✓ live 1v1 gameplay SQL foundation contract");
