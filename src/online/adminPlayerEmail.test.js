/**
 * Admin player email SQL + client contract. No network.
 * Run: node src/online/adminPlayerEmail.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";
import { ADMIN_ERROR, AdminError } from "./adminDashboard.js";
import { fetchAdminPlayerEmail } from "./adminV1.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20260905140000_admin_get_player_email.sql"),
  "utf8"
);
const source = readFileSync(join(root, "src/online/adminV1.js"), "utf8");
const pageLive = readFileSync(
  join(process.env.TEMP || "", "leodomino-testers-admin-align/src/pages/AdminPage.jsx"),
  "utf8"
);

assert.match(sql, /CREATE OR REPLACE FUNCTION public\.admin_get_player_email\(p_player_id uuid\)/);
assert.match(sql, /SECURITY DEFINER/);
assert.match(sql, /SET search_path = public/);
assert.match(sql, /is_staff\('moderator'\)/);
assert.match(sql, /FROM auth\.users/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.admin_get_player_email\(uuid\) TO authenticated/);
assert.doesNotMatch(sql, /GRANT SELECT ON .*auth\.users/i);
assert.doesNotMatch(sql, /ALTER TABLE public\.profiles.*email|ADD COLUMN.*email/i);
assert.doesNotMatch(sql, /service_role key|SERVICE_ROLE/);

assert.match(source, /fetchAdminPlayerEmail/);
assert.match(source, /admin_get_player_email/);
assert.doesNotMatch(source, /dropPrivateKeys\(.*email/);

{
  const calls = [];
  const client = {
    rpc: async (name, payload) => {
      calls.push({ name, payload });
      return { data: { player_id: payload.p_player_id, email: "a@example.com" }, error: null };
    },
  };
  const out = await fetchAdminPlayerEmail("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", client);
  assert.equal(calls[0].name, "admin_get_player_email");
  assert.equal(out.email, "a@example.com");
}

{
  const client = {
    rpc: async () => ({ data: { player_id: "x", email: null }, error: null }),
  };
  const out = await fetchAdminPlayerEmail("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", client);
  assert.equal(out.email, null);
}

{
  await assert.rejects(
    () => fetchAdminPlayerEmail("", { rpc: async () => ({ data: null, error: null }) }),
    (error) => error instanceof AdminError && error.code === ADMIN_ERROR.GENERIC
  );
}

if (pageLive && pageLive.length) {
  assert.match(pageLive, /fetchAdminPlayerEmail/);
  assert.match(pageLive, /data-admin-player-email/);
  assert.match(pageLive, /admin\.email/);
}

console.log("  ✓ admin player email contract");
