/**
 * Contract test for the Find Match + friends SQL foundation.
 * Does not connect to Supabase. Run: node src/online/sqlFoundation.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationRel = "supabase/migrations/20260823120000_find_match_friends_foundation.sql";
const sql = readFileSync(join(root, migrationRel), "utf8");

function mustInclude(pattern, message) {
  assert.match(sql, pattern, message);
}

mustInclude(/CREATE TABLE public\.profiles/, "profiles table");
mustInclude(/CREATE TABLE public\.match_requests/, "match_requests table");
mustInclude(/CREATE TABLE public\.matches/, "matches table");
mustInclude(/CREATE TABLE public\.friend_requests/, "friend_requests table");
mustInclude(/CREATE TABLE public\.friendships/, "friendships table");

mustInclude(
  /id uuid PRIMARY KEY REFERENCES auth\.users \(id\) ON DELETE CASCADE/,
  "profiles.id is auth.users.id"
);
mustInclude(/display_name text NOT NULL/, "profiles.display_name");
mustInclude(/avatar_id text NOT NULL/, "profiles.avatar_id");
mustInclude(/country_code text NOT NULL/, "profiles.country_code");
mustInclude(/created_at timestamptz NOT NULL DEFAULT now\(\)/, "profiles.created_at");
mustInclude(/updated_at timestamptz NOT NULL DEFAULT now\(\)/, "profiles.updated_at");
mustInclude(/No passwords, tokens, or emails/, "profiles documented as public-safe");

assert.doesNotMatch(sql, /password_hash|refresh_token|id_token|otp_secret/i, "no secret identity columns");

mustInclude(/creator_id uuid NOT NULL REFERENCES public\.profiles/, "match_requests.creator_id");
mustInclude(/expires_at timestamptz NOT NULL/, "match_requests.expires_at");
mustInclude(/acceptor_id uuid REFERENCES public\.profiles/, "match_requests.acceptor_id");
mustInclude(/accepted_at timestamptz/, "match_requests.accepted_at");
mustInclude(
  /match_requests_ruleset_check CHECK \(ruleset_id IN \('legacy', 'haitian', 'american'\)\)/,
  "V1 public styles only"
);
mustInclude(
  /match_requests_status_check CHECK \(status IN \('open', 'accepted', 'cancelled', 'expired'\)\)/,
  "match request statuses"
);
mustInclude(/CREATE UNIQUE INDEX match_requests_one_open_per_creator/, "one open public request per creator");
mustInclude(/match_requests\.ruleset_id is immutable/, "style cannot change after insert");
mustInclude(/NEW\.creator_id := auth\.uid\(\)/, "creator is always the authenticated user");

mustInclude(/request_id uuid NOT NULL UNIQUE REFERENCES public\.match_requests/, "matches.request_id unique");
mustInclude(/player_a uuid NOT NULL REFERENCES public\.profiles/, "matches.player_a");
mustInclude(/player_b uuid NOT NULL REFERENCES public\.profiles/, "matches.player_b");
mustInclude(/matches_two_distinct_players CHECK \(player_a <> player_b\)/, "1v1 distinct seats");
mustInclude(
  /VALUES \(request\.id, request\.ruleset_id, request\.creator_id, caller, 'ready'\)/,
  "accept copies request ruleset"
);

mustInclude(/CREATE OR REPLACE FUNCTION public\.accept_match_request\(p_request_id uuid\)/, "accept_match_request RPC");
mustInclude(/FOR UPDATE/, "accept locks the request row");
mustInclude(/cannot accept own match request/, "self-accept blocked");
mustInclude(/request\.expires_at <= now\(\)/, "expired requests rejected");
mustInclude(/CREATE OR REPLACE FUNCTION public\.cancel_match_request\(p_request_id uuid\)/, "cancel_match_request RPC");
mustInclude(/AND creator_id = caller/, "only creator can cancel");
mustInclude(/AND status = 'open'/, "only open requests can be cancelled");

mustInclude(/sender_id uuid NOT NULL REFERENCES public\.profiles/, "friend_requests.sender_id");
mustInclude(/receiver_id uuid NOT NULL REFERENCES public\.profiles/, "friend_requests.receiver_id");
mustInclude(
  /friend_requests_status_check CHECK \(status IN \('pending', 'accepted', 'declined', 'cancelled'\)\)/,
  "friend request statuses"
);
mustInclude(/friend_requests_not_self CHECK \(sender_id <> receiver_id\)/, "no self-friend request");
mustInclude(/CREATE UNIQUE INDEX friend_requests_one_pending_pair/, "no duplicate pending pair");
mustInclude(/friendships_ordered_pair CHECK \(user_a < user_b\)/, "unordered friendship pair");
mustInclude(/CONSTRAINT friendships_unique_pair UNIQUE \(user_a, user_b\)/, "one friendship per pair");

mustInclude(/CREATE OR REPLACE FUNCTION public\.send_friend_request\(p_receiver_id uuid\)/, "send_friend_request RPC");
mustInclude(/cannot send a friend request to yourself/, "self-friend RPC blocked");
mustInclude(
  /CREATE OR REPLACE FUNCTION public\.respond_to_friend_request\(p_request_id uuid, p_action text\)/,
  "respond RPC"
);
mustInclude(/only the receiver may respond/, "non-receiver cannot accept/decline");
mustInclude(/INSERT INTO public\.friendships/, "accept creates a friendship");
mustInclude(/SET status = 'declined'/, "decline path");
mustInclude(/CREATE OR REPLACE FUNCTION public\.cancel_friend_request\(p_request_id uuid\)/, "sender cancel RPC");
mustInclude(/AND sender_id = caller/, "only sender cancels pending invite");

mustInclude(/ENABLE ROW LEVEL SECURITY/, "RLS enabled");
mustInclude(/profiles_select_authenticated/, "profiles readable by signed-in users");
mustInclude(/profiles_update_own/, "users update only their profile");
mustInclude(/match_requests_select_relevant/, "open/own match requests readable");
mustInclude(/match_requests_insert_self/, "create only as self");
mustInclude(/matches_select_participants/, "matches readable only by seats");
mustInclude(/friend_requests_select_parties/, "friend requests readable by parties");
mustInclude(/friendships_select_members/, "friendships readable by members");
mustInclude(/GRANT INSERT \(ruleset_id\) ON TABLE public\.match_requests/, "clients cannot set creator_id");
mustInclude(/GRANT SELECT ON TABLE public\.matches TO authenticated/, "matches are read-only for clients");
mustInclude(/GRANT SELECT ON TABLE public\.friendships TO authenticated/, "no direct friendship insert grant");
mustInclude(
  /REVOKE ALL ON TABLE public\.friendships FROM PUBLIC, anon, authenticated/,
  "friendship insert revoked"
);

mustInclude(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.match_requests/, "match_requests realtime");
mustInclude(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.friend_requests/, "friend_requests realtime");
mustInclude(/Realtime Presence key later/, "profiles.id reserved for future presence");

mustInclude(/CREATE OR REPLACE FUNCTION public\.handle_new_user\(\)/, "profile created on Auth signup");
mustInclude(/ON auth\.users/, "signup trigger on auth.users");
mustInclude(/CREATE OR REPLACE FUNCTION public\.backfill_profiles_from_auth\(\)/, "existing users can be backfilled");

const home = readFileSync(join(root, "src/pages/HomePage.jsx"), "utf8");
const styles = readFileSync(join(root, "src/pages/GameStylePage.jsx"), "utf8");
const matchHook = readFileSync(join(root, "src/hooks/useMatch.js"), "utf8");
assert.doesNotMatch(home, /match_requests|accept_match_request/, "Home UI unchanged");
assert.doesNotMatch(styles, /match_requests|accept_match_request/, "GameStylePage unchanged");
assert.doesNotMatch(matchHook, /match_requests|accept_match_request/, "useMatch unchanged");

assert.doesNotMatch(
  readFileSync(join(root, "src/auth/cloudAuth.js"), "utf8"),
  /from\("profiles"\)|\.from\('profiles'\)/,
  "Auth still uses user_metadata; profiles migration is gradual"
);

console.log("  ✓ Find Match + friends SQL foundation contract");
