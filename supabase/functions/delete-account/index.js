/**
 * Delete the authenticated LeoDomino account.
 * JWT sub is the only target. Password must match that user.
 * Service role is used only after getUser, password check, prepare,
 * and a proven profile tombstone. Body user_id fields are ignored.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  authLookupResult,
  canReturnOk,
  isAlreadyGone,
  isPrepareSuccess,
  isTombstoneVerified,
} from "./guards.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function firstNamedKey(raw) {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return parsed.default || Object.values(parsed)[0] || "";
  } catch {
    return "";
  }
}

function pgMessage(error) {
  const message = String(error?.message || error?.details || error?.hint || error?.msg || error?.code || "");
  return message;
}

function reasonFromRpc(error) {
  const message = pgMessage(error);
  if (/authentication required/i.test(message) || error?.code === "28000") return "AUTH_REQUIRED";
  if (/ACCOUNT_DELETED/i.test(message)) return "ACCOUNT_DELETED";
  return "DELETE_FAILED";
}

function statusFor(reason) {
  if (reason === "AUTH_REQUIRED" || reason === "INVALID_PASSWORD") return 401;
  return 400;
}

function passwordFromBody(body) {
  return typeof body?.password === "string" ? body.password : "";
}

function parseBody(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: String(text).slice(0, 400) };
  }
}

function userHeaders(anonKey, userJwt) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Prefer: "return=representation",
    apikey: anonKey,
    Authorization: "Bearer " + userJwt,
  };
}

/**
 * Same service-key rules as online-game: opaque sb_ keys are not JWTs.
 * Gateway maps apikey → service_role. Never send sb_secret_ as Bearer.
 */
function serviceHeaders(serviceKey) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    apikey: serviceKey,
  };
  const opaqueSecret = String(serviceKey).startsWith("sb_");
  if (!opaqueSecret) headers.Authorization = "Bearer " + serviceKey;
  return headers;
}

async function prepareMyAccountDeletion(supabaseUrl, anonKey, userJwt) {
  const restUrl = String(supabaseUrl).replace(/\/$/, "") + "/rest/v1";
  const res = await fetch(restUrl + "/rpc/prepare_my_account_deletion", {
    method: "POST",
    headers: userHeaders(anonKey, userJwt),
    body: "{}",
  });
  const text = await res.text();
  const parsed = parseBody(text);
  if (!res.ok) {
    const err = new Error(pgMessage(parsed) || text.slice(0, 400) || "PostgREST " + res.status);
    err.code = parsed?.code || String(res.status);
    err.details = parsed?.details;
    err.hint = parsed?.hint;
    return { data: null, error: err };
  }
  const data = Array.isArray(parsed) ? parsed[0] : parsed;
  return { data, error: null };
}

async function readOwnTombstone(supabaseUrl, anonKey, userJwt, userId) {
  const restUrl = String(supabaseUrl).replace(/\/$/, "") + "/rest/v1";
  const res = await fetch(
    restUrl +
      "/profiles?select=deleted_at&id=eq." +
      encodeURIComponent(userId),
    { method: "GET", headers: userHeaders(anonKey, userJwt) }
  );
  const text = await res.text();
  const parsed = parseBody(text);
  if (!res.ok) {
    return { profile: null, error: parsed };
  }
  return { profile: parsed, error: null };
}

async function adminDeleteUser(supabaseUrl, serviceKey, userId) {
  const authUrl = String(supabaseUrl).replace(/\/$/, "") + "/auth/v1";
  const res = await fetch(authUrl + "/admin/users/" + encodeURIComponent(userId), {
    method: "DELETE",
    headers: serviceHeaders(serviceKey),
    body: JSON.stringify({ should_soft_delete: false }),
  });
  const text = await res.text();
  const parsed = parseBody(text);
  if (!res.ok) {
    const err = new Error(pgMessage(parsed) || text.slice(0, 400) || "Auth " + res.status);
    err.code = parsed?.error_code || parsed?.code || String(res.status);
    err.status = res.status;
    return { error: err };
  }
  return { error: null };
}

async function adminLookupUser(supabaseUrl, serviceKey, userId) {
  const authUrl = String(supabaseUrl).replace(/\/$/, "") + "/auth/v1";
  const res = await fetch(authUrl + "/admin/users/" + encodeURIComponent(userId), {
    method: "GET",
    headers: serviceHeaders(serviceKey),
  });
  const text = await res.text();
  const parsed = parseBody(text);
  return authLookupResult(res.status, parsed, userId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return json({ error: { code: "INVALID_BODY", message: "POST required" } }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SUPABASE_SECRET_KEY") ||
    firstNamedKey(Deno.env.get("SUPABASE_SECRET_KEYS"));
  const authHeader = req.headers.get("Authorization") || "";
  const userJwt = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(
      { error: { code: "SERVER_MISCONFIGURED", message: "Hosted function secrets are missing" } },
      500
    );
  }
  if (!userJwt) {
    return json({ error: { code: "AUTH_REQUIRED", message: "Authentication required" } }, 401);
  }

  let requested = {};
  try {
    requested = await req.json();
  } catch {
    requested = {};
  }
  const password = passwordFromBody(requested);

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser(userJwt);
  if (authError || !user?.id) {
    return json({ error: { code: "AUTH_REQUIRED", message: "Authentication required" } }, 401);
  }

  if (!password || !user.email) {
    return json({ error: { code: "INVALID_PASSWORD", message: "INVALID_PASSWORD" } }, 401);
  }
  const { data: reauth, error: reauthError } = await userClient.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (reauthError || reauth?.user?.id !== user.id) {
    return json({ error: { code: "INVALID_PASSWORD", message: "INVALID_PASSWORD" } }, 401);
  }

  const { data: prepared, error: rpcError } = await prepareMyAccountDeletion(
    supabaseUrl,
    anonKey,
    userJwt
  );
  if (rpcError) {
    const reason = reasonFromRpc(rpcError);
    return json({ error: { code: reason, message: reason } }, statusFor(reason));
  }
  if (!isPrepareSuccess(prepared)) {
    return json({ error: { code: "DELETE_FAILED", message: "DELETE_FAILED" } }, 400);
  }

  const { profile, error: profileError } = await readOwnTombstone(
    supabaseUrl,
    anonKey,
    userJwt,
    user.id
  );
  const tombstoneVerified = !profileError && isTombstoneVerified(profile);
  if (!tombstoneVerified) {
    return json({ error: { code: "DELETE_FAILED", message: "DELETE_FAILED" } }, 400);
  }

  const { error: deleteError } = await adminDeleteUser(supabaseUrl, serviceKey, user.id);
  if (deleteError && !isAlreadyGone(deleteError)) {
    return json({ error: { code: "AUTH_DELETE_FAILED", message: "AUTH_DELETE_FAILED" } }, 500);
  }

  const authState = await adminLookupUser(supabaseUrl, serviceKey, user.id);
  if (authState === "exists" || !canReturnOk({ tombstoneVerified, authState })) {
    return json({ error: { code: "AUTH_DELETE_FAILED", message: "AUTH_DELETE_FAILED" } }, 500);
  }

  return json({ ok: true });
});
