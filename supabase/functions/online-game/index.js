/**
 * Live 1v1 gameplay Edge Function.
 *
 * Shared engine (do not duplicate rules):
 *   src/online/gameAuthority.js
 *     -> src/game/rules/drawDominoes.js (startMatch, playTile, drawTile, passTurn, …)
 *     -> src/game/rules/constants.js
 *     -> src/game/rules/haitianStart.js
 *     -> src/game/rulesets/index.js
 *   src/online/gameplayHandler.js
 *
 * Secrets stay in Postgres game_secrets and are never returned to clients.
 * JWT is required. Service role is used only after the caller is verified
 * as player_a or player_b.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { GameplayError } from "../../../src/online/gameAuthority.js";
import { handleOnlineGameRequest } from "../../../src/online/gameplayHandler.js";

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

function statusFor(code) {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "NOT_A_PLAYER" || code === "MATCH_NOT_ELIGIBLE") return 403;
  if (code === "STALE_VERSION" || code === "TIMEOUT_NOT_DUE") return 409;
  if (code === "MATCH_NOT_FOUND" || code === "NO_SESSION") return 404;
  return 400;
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

function errorText(error) {
  const message = error?.message;
  if (typeof message === "string" && message && message !== "[object Object]") return message;
  if (message && typeof message === "object") return JSON.stringify(message);
  if (typeof error?.details === "string") return error.details;
  if (typeof error?.hint === "string") return error.hint;
  try {
    return JSON.stringify(error, Object.getOwnPropertyNames(error || {}));
  } catch {
    return String(error);
  }
}

function createPostgrestGameStore(supabaseUrl, { anonKey, userJwt, serviceKey }) {
  const restUrl = String(supabaseUrl).replace(/\/$/, "") + "/rest/v1";
  const opaqueSecret = String(serviceKey).startsWith("sb_");

  function headersFor(role) {
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    if (role === "user") {
      headers.apikey = anonKey;
      headers.Authorization = "Bearer " + userJwt;
      return headers;
    }
    headers.apikey = serviceKey;
    // Legacy service_role keys are JWTs. Opaque sb_secret keys are not;
    // the gateway maps apikey → service_role. Never attach the user JWT.
    if (!opaqueSecret) headers.Authorization = "Bearer " + serviceKey;
    return headers;
  }

  async function rest(path, { method = "GET", body, role } = {}) {
    const res = await fetch(restUrl + path, {
      method,
      headers: headersFor(role),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text.slice(0, 400) };
    }
    if (!res.ok) {
      const err = new Error(errorText(parsed) || text.slice(0, 400) || "PostgREST " + res.status);
      err.code = parsed?.code || String(res.status);
      err.details = parsed?.details;
      err.hint = parsed?.hint;
      throw err;
    }
    return parsed;
  }

  return {
    async loadMatch(matchId) {
      const rows = await rest(
        "/matches?select=id,ruleset_id,player_a,player_b,status&id=eq." + encodeURIComponent(matchId),
        { role: "user" }
      );
      return Array.isArray(rows) ? rows[0] || null : rows;
    },
    async loadSession(matchId) {
      const rows = await rest("/game_sessions?select=*&match_id=eq." + encodeURIComponent(matchId), {
        role: "user",
      });
      const data = Array.isArray(rows) ? rows[0] : rows;
      return data
        ? {
            matchId: data.match_id,
            rulesetId: data.ruleset_id,
            version: data.version,
            status: data.status,
            currentSeat: data.current_seat,
            phase: data.phase,
            turnDeadlineAt: data.turn_deadline_at ?? null,
            timeoutStrikes: data.timeout_strikes ?? [0, 0],
          }
        : null;
    },
    async loadSecret(matchId) {
      const rows = await rest(
        "/game_secrets?select=match_id,engine_state,deal_seed&match_id=eq." +
          encodeURIComponent(matchId),
        { role: "service" }
      );
      const data = Array.isArray(rows) ? rows[0] : rows;
      return data
        ? {
            matchId: data.match_id,
            engineState: data.engine_state,
            seed: data.deal_seed,
          }
        : null;
    },
    async installGame({ matchId, rulesetId, publicRow, engineState, seed, matchStatus }) {
      void matchStatus;
      const data = await rest("/rpc/install_online_game", {
        method: "POST",
        role: "service",
        body: {
          p_match_id: matchId,
          p_ruleset_id: rulesetId,
          p_public: publicRow,
          p_engine_state: engineState,
          p_deal_seed: seed,
        },
      });
      return { created: Boolean(data?.created), version: data?.version ?? 0 };
    },
    async commitTransition({
      matchId,
      expectedVersion,
      publicRow,
      engineState,
      action,
      matchStatus,
    }) {
      try {
        const data = await rest("/rpc/commit_online_game_transition", {
          method: "POST",
          role: "service",
          body: {
            p_match_id: matchId,
            p_expected_version: expectedVersion,
            p_actor: action.actorId,
            p_seat: action.seat,
            p_action_type: action.actionType,
            p_payload: action.payload ?? {},
            p_public: publicRow,
            p_engine_state: engineState,
            p_match_status: matchStatus ?? null,
          },
        });
        return {
          version: data?.version,
          turnDeadlineAt: data?.turnDeadlineAt ?? data?.turn_deadline_at ?? null,
          timeoutStrikes: data?.timeoutStrikes ?? data?.timeout_strikes ?? null,
        };
      } catch (error) {
        if (/stale expected_version/i.test(error.message || "")) {
          throw new GameplayError("STALE_VERSION", "expected_version does not match");
        }
        if (/timeout not due/i.test(error.message || "")) {
          throw new GameplayError("TIMEOUT_NOT_DUE", "timeout not due");
        }
        throw error;
      }
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
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

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser(userJwt);
  if (authError || !user) {
    return json({ error: { code: "AUTH_REQUIRED", message: "Authentication required" } }, 401);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: { code: "INVALID_BODY", message: "JSON body required" } }, 400);
  }

  const op = body.op;
  const store = createPostgrestGameStore(supabaseUrl, { anonKey, userJwt, serviceKey });

  try {
    const result = await handleOnlineGameRequest(op, body, { userId: user.id, store });
    return json(result);
  } catch (error) {
    const rawCode = error?.code;
    const code =
      typeof rawCode === "string" && /^[A-Z][A-Z0-9_]+$/.test(rawCode) ? rawCode : "GAMEPLAY_FAILED";
    return json(
      {
        error: {
          code,
          message: errorText(error),
          pgCode: typeof rawCode === "string" && rawCode !== code ? rawCode : undefined,
        },
      },
      statusFor(code)
    );
  }
});
