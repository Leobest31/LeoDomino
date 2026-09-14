/**
 * Internal overdue-timeout sweeper.
 * Not a player gameplay endpoint. Requires TIMEOUT_SWEEP_SECRET.
 * Reuses applyTimeoutAndCommit via handleSweepDueTimeouts.
 */

import { GameplayError } from "../../../src/online/gameAuthority.js";
import {
  committedTransitionFromRpc,
  gameplayErrorFromCommitRaise,
} from "../../../src/online/commitTransitionResult.js";
import { handleSweepDueTimeouts, TIMEOUT_SWEEP_SCAN } from "../../../src/online/gameplayHandler.js";
import { authorizeTimeoutSweep } from "../../../src/online/timeoutSweep.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-timeout-sweep-secret",
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

function createServiceGameStore(supabaseUrl, serviceKey) {
  const restUrl = String(supabaseUrl).replace(/\/$/, "") + "/rest/v1";
  const opaqueSecret = String(serviceKey).startsWith("sb_");

  function headers() {
    const out = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "return=representation",
      apikey: serviceKey,
    };
    if (!opaqueSecret) out.Authorization = "Bearer " + serviceKey;
    return out;
  }

  function isMissingRpcError(error) {
    const text = [error?.message, error?.code, error?.details, error?.hint].filter(Boolean).join(" ");
    return /PGRST202|could not find the function|schema cache/i.test(text);
  }

  async function rest(path, { method = "GET", body } = {}) {
    const res = await fetch(restUrl + path, {
      method,
      headers: headers(),
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
    async listDueTimeoutMatches(limit = TIMEOUT_SWEEP_SCAN) {
      const data = await rest("/rpc/list_due_timeout_matches", {
        method: "POST",
        body: { p_limit: limit },
      });
      return Array.isArray(data) ? data : data?.matches ?? data ?? [];
    },
    async loadMatch(matchId) {
      const rows = await rest(
        "/matches?select=id,ruleset_id,player_a,player_b,status&id=eq." + encodeURIComponent(matchId)
      );
      return Array.isArray(rows) ? rows[0] || null : rows;
    },
    async loadSession(matchId) {
      const rows = await rest("/game_sessions?select=*&match_id=eq." + encodeURIComponent(matchId));
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
          encodeURIComponent(matchId)
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
    async commitTransition({ matchId, expectedVersion, publicRow, engineState, action, matchStatus }) {
      try {
        const body = {
          p_match_id: matchId,
          p_expected_version: expectedVersion,
          p_actor: action.actorId,
          p_seat: action.seat,
          p_action_type: action.actionType,
          p_payload: action.payload ?? {},
          p_public: publicRow,
          p_engine_state: engineState,
          p_match_status: matchStatus ?? null,
        };
        let data;
        try {
          data = await rest("/rpc/_leopips_commit_online_game_transition", {
            method: "POST",
            body,
          });
        } catch (error) {
          if (!isMissingRpcError(error)) throw error;
          data = await rest("/rpc/commit_online_game_transition", {
            method: "POST",
            body,
          });
        }
        return committedTransitionFromRpc(data);
      } catch (error) {
        if (error instanceof GameplayError) throw error;
        const mapped = gameplayErrorFromCommitRaise(error);
        if (mapped) throw mapped;
        throw error;
      }
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  const headerMap = Object.fromEntries(req.headers.entries());
  const auth = authorizeTimeoutSweep(headerMap, Deno.env.toObject());
  if (!auth.ok) {
    return json({ error: { code: auth.code, message: "Sweep authorization required" } }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SUPABASE_SECRET_KEY") ||
    firstNamedKey(Deno.env.get("SUPABASE_SECRET_KEYS"));
  if (!supabaseUrl || !serviceKey) {
    return json(
      { error: { code: "SERVER_MISCONFIGURED", message: "Hosted function secrets are missing" } },
      500
    );
  }

  const store = createServiceGameStore(supabaseUrl, serviceKey);
  try {
    const result = await handleSweepDueTimeouts({ store });
    const summary = result?.summary;
    if (summary && typeof summary === "object") {
      const failedRows = Array.isArray(result?.results)
        ? result.results
            .filter((row) => row?.status === "failed")
            .map((row) => ({
              matchId: row.matchId,
              code: row.code,
              reason: row.reason ?? null,
              oldVersion: row.oldVersion ?? null,
              rulesetId: row.rulesetId ?? null,
            }))
        : [];
      console.log(
        JSON.stringify({
          event: "timeout_sweep",
          candidatesFound: summary.candidatesFound ?? 0,
          processed: summary.processed ?? 0,
          resolved: summary.resolved ?? 0,
          stale: summary.stale ?? 0,
          skipped: summary.skipped ?? 0,
          failed: summary.failed ?? 0,
          remainingDue: summary.remainingDue ?? 0,
          elapsed_ms: summary.elapsedMs ?? null,
          skipReasons: summary.skipReasons ?? {},
          failedRows,
        })
      );
    }
    // Surface per-match failures to operators (body still carries full results).
    const httpStatus = result?.ok === false ? 207 : 200;
    return json(result, httpStatus);
  } catch (error) {
    console.log(
      JSON.stringify({
        event: "timeout_sweep",
        error: "invoke_authority",
        code: "SWEEP_FAILED",
        message: errorText(error).slice(0, 240),
      })
    );
    return json(
      {
        error: {
          code: "SWEEP_FAILED",
          message: errorText(error),
        },
      },
      500
    );
  }
});
