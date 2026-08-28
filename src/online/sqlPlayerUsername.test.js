/**
 * Unique player username SQL contract.
 * Does not connect to Supabase. Run: node src/online/sqlPlayerUsername.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationRel = "supabase/migrations/20260828200000_unique_player_username.sql";
const sql = readFileSync(join(root, migrationRel), "utf8");
const foundation = readFileSync(
  join(root, "supabase/migrations/20260823120000_find_match_friends_foundation.sql"),
  "utf8"
);
const adapter = readFileSync(join(root, "src/online/friends.js"), "utf8");
const cloudAuth = readFileSync(join(root, "src/auth/cloudAuth.js"), "utf8");

function sliceFn(name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.ok(start >= 0, `${name} exists`);
  const bodyEnd = sql.indexOf("$$;", start);
  assert.ok(bodyEnd > start, `${name} body ends`);
  return sql.slice(start, bodyEnd + 3);
}

function mustInclude(pattern, message) {
  assert.match(sql, pattern, message);
}

const normalize = sliceFn("normalize_player_username");
const triggerFn = sliceFn("normalize_profile_username");
const available = sliceFn("is_username_available");
const search = sliceFn("search_players_by_username");
const signup = sliceFn("handle_new_user");

mustInclude(/ADD COLUMN IF NOT EXISTS username text/, "profiles.username column");
mustInclude(/username ~ '\^\[a-z\]\[a-z0-9_\]\{2,19\}\$'/, "username format 3-20 starting with a letter");
mustInclude(/CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique/, "globally unique username");
mustInclude(/WHERE username IS NOT NULL/, "null usernames allowed for existing players");
assert.doesNotMatch(sql, /UPDATE public\.profiles[\s\S]{0,200}username\s*=/, "does not backfill username from display_name");
assert.doesNotMatch(sql, /SET username\s*=\s*display_name/, "does not copy display_name into username");
assert.doesNotMatch(sql, /ALTER TABLE public\.profiles[\s\S]{0,80}username text NOT NULL/, "does not require username on existing rows");

assert.match(normalize, /handle := lower\(btrim/, "usernames are lowercased");
assert.match(normalize, /SET search_path = public/, "normalizer has a fixed search_path");
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.normalize_player_username/, "normalizer is not granted to clients");
assert.match(sql, /REVOKE ALL ON FUNCTION public\.normalize_player_username\(text\) FROM PUBLIC, anon, authenticated/, "normalizer is private");

assert.match(triggerFn, /SECURITY DEFINER/, "username trigger is SECURITY DEFINER so own-row claim can run");
assert.match(triggerFn, /SET search_path = public/, "username trigger has a fixed search_path");
assert.match(triggerFn, /username cannot be cleared/, "claimed username cannot be cleared");
assert.match(triggerFn, /cannot change another user username/, "trigger blocks cross-user username writes");
assert.match(triggerFn, /NEW\.id IS DISTINCT FROM auth\.uid\(\)/, "cross-user guard uses auth.uid()");
assert.match(triggerFn, /NEW\.username := NULL/, "existing NULL username stays allowed on insert/update of empty");
assert.match(sql, /REVOKE ALL ON FUNCTION public\.normalize_profile_username\(\) FROM PUBLIC, anon, authenticated/, "trigger function is not a client RPC");

assert.match(available, /RETURNS boolean/, "availability returns boolean only");
assert.match(available, /SECURITY DEFINER/, "availability is SECURITY DEFINER so anon can check without SELECT");
assert.match(available, /SET search_path = public/, "availability has a fixed search_path");
assert.match(available, /id IS DISTINCT FROM auth\.uid\(\)/, "own current username remains available");
assert.match(available, /public\.normalize_player_username\(p_username\)/, "availability is case-normalized");
assert.doesNotMatch(available, /RETURN QUERY|RETURNS TABLE/, "availability does not return profile rows");
assert.doesNotMatch(available, /email|phone|raw_user_meta/, "availability exposes no identity fields");
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.is_username_available\(text\) TO anon, authenticated/, "anon and authenticated can check availability");

assert.match(search, /SECURITY DEFINER/, "search can call the private normalizer");
assert.match(search, /SET search_path = public/, "search has a fixed search_path");
assert.match(search, /authentication required/, "search rejects anon");
assert.match(search, /p\.id <> caller/, "search excludes the signed-in user");
assert.match(search, /p\.username = handle\) DESC/, "exact username first");
assert.match(search, /p\.username LIKE needle \|\| '%' ESCAPE/, "prefix ranking");
assert.match(search, /ILIKE '%' \|\| needle \|\| '%' ESCAPE/, "partial username match");
assert.match(search, /p\.id,\s*p\.username,\s*p\.display_name,\s*p\.avatar_id,\s*p\.country_code/, "search returns public fields only");
assert.doesNotMatch(search, /email|phone|raw_user_meta|identities|token/, "search does not select private identity");
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.search_players_by_username\(text\) TO anon/, "search is not granted to anon");
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.search_players_by_username\(text\) TO authenticated/, "search is authenticated");
assert.match(sql, /REVOKE ALL ON FUNCTION public\.search_players_by_username\(text\) FROM PUBLIC, anon/, "search revoked from anon");

assert.match(signup, /SECURITY DEFINER/, "signup trigger stays SECURITY DEFINER");
assert.match(signup, /SET search_path = public/, "signup trigger has a fixed search_path");
assert.match(signup, /username is required/, "missing username signup is rejected");
assert.match(signup, /invalid username/, "invalid username signup is rejected");
assert.match(signup, /raw_handle text := COALESCE\(meta->>'username', ''\)/, "signup username comes from metadata.username");
assert.match(signup, /raw_name text := COALESCE\(meta->>'displayName', meta->>'display_name', ''\)/, "display_name stays separate");
assert.match(signup, /ON CONFLICT \(id\) DO NOTHING/, "existing profile id is not overwritten");
assert.match(signup, /avatar_id/, "signup still writes avatar_id");
assert.match(signup, /country_code/, "signup still writes country_code");
assert.doesNotMatch(signup, /NEW\.username := NULL|username,\s*NULL/, "new signups do not insert a null username");
assert.match(sql, /REVOKE ALL ON FUNCTION public\.handle_new_user\(\) FROM PUBLIC, anon, authenticated/, "signup trigger is not a client RPC");

assert.match(foundation, /display_name text NOT NULL/, "display_name remains on profiles");
assert.match(foundation, /profiles_update_own/, "own-row profile RLS remains");
assert.match(foundation, /USING \(id = auth\.uid\(\)\)/, "RLS uses auth.uid()");
assert.match(foundation, /WITH CHECK \(id = auth\.uid\(\)\)/, "RLS WITH CHECK uses auth.uid()");
assert.doesNotMatch(foundation, /username text/, "username is added in a later migration, not the foundation table");
assert.match(sql, /GRANT UPDATE \(username\) ON TABLE public\.profiles TO authenticated/, "own username can be saved");

assert.doesNotMatch(sql, /EXECUTE\s+'|format\s*\(/i, "no dynamic SQL");

assert.match(adapter, /rpc\("search_players_by_username"/, "client search uses the username RPC");
assert.match(adapter, /p_query: needle/, "client lowercases and strips @ before the RPC");
assert.match(adapter, /extraFriends/, "existing friends stay eligible for username search");
assert.match(adapter, /rpc\("unfriend_player"/, "client unfriends through the existing RPC");
assert.doesNotMatch(
  adapter.slice(adapter.indexOf("export async function searchPlayers"), adapter.indexOf("export async function unfriendPlayer")),
  /ilike\("display_name"/,
  "client search does not query display_name"
);
assert.match(adapter, /row\.playerId !== playerId/, "client also drops self from search results");
assert.doesNotMatch(adapter, /PROFILE_PUBLIC_SELECT[\s\S]{0,80}email|phone/, "public profile select has no email/phone");

assert.match(cloudAuth, /username is required|invalid username/, "cloud auth maps DB username exceptions");
assert.match(cloudAuth, /from\("profiles"\)/, "profile claim writes public.profiles");

console.log("  ✓ unique player username SQL contract");
