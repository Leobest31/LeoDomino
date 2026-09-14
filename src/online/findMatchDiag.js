/**
 * TEMPORARY read-only Find Match lobby diagnostics for physical-phone repro.
 * Does not create/accept/cancel, change heartbeats, pair-limit, or wallets.
 * Never includes auth tokens, email, phone, or refresh credentials.
 */

import { getSupabaseClient } from "./supabaseClient.js";
import {
  getMyActiveMatch,
  isPublicRequestCreatorFresh,
  listJoinableOpenMatchRequests,
  toFindMatchRulesetId,
  toFindMatchStakePips,
} from "./matchmaking.js";
import { copyText } from "./referrals.js";

export const FIND_MATCH_DIAG_VERSION = 1;

function clientOf(client) {
  return client || getSupabaseClient();
}

function asId(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function hbAgeSec(iso, now = Date.now()) {
  if (!iso) return null;
  const ms = now - Date.parse(String(iso));
  return Number.isFinite(ms) ? Math.round(ms / 100) / 10 : null;
}

function slimRequest(row, now = Date.now()) {
  if (!row) return null;
  const id = asId(row.id);
  const creatorId = asId(row.creatorId ?? row.creator_id);
  const waitingHeartbeatAt = row.waitingHeartbeatAt ?? row.waiting_heartbeat_at ?? null;
  return {
    id,
    creator_id: creatorId,
    display_name: row.creator?.displayName || row.display_name || null,
    ruleset_id: row.rulesetId ?? row.ruleset_id ?? null,
    stake_pips: row.stakePips ?? row.stake_pips ?? null,
    status: row.status ?? null,
    visibility: row.visibility ?? null,
    expires_at: row.expiresAt ?? row.expires_at ?? null,
    waiting_heartbeat_at: waitingHeartbeatAt,
    heartbeat_age_sec: hbAgeSec(waitingHeartbeatAt, now),
    creator_fresh: isPublicRequestCreatorFresh(row, now),
  };
}

/**
 * Read-only blocked-opponent ids from the existing authenticated RPC.
 * Missing RPC → null (not an empty list that looks like "nobody blocked").
 * @param {object} [client]
 */
export async function readRankedBlockedOpponentIds(client) {
  const db = clientOf(client);
  if (typeof db.rpc !== "function") return { ok: false, reason: "rpc_unavailable", ids: null };
  try {
    const { data, error } = await db.rpc("list_ranked_find_match_blocked_opponents");
    if (error) {
      return {
        ok: false,
        reason: String(error.code || error.message || "rpc_error").slice(0, 80),
        ids: null,
      };
    }
    const ids = (Array.isArray(data) ? data : [])
      .map((id) => asId(id))
      .filter(Boolean);
    return { ok: true, reason: null, ids };
  } catch (error) {
    return {
      ok: false,
      reason: String(error?.message || error || "throw").slice(0, 80),
      ids: null,
    };
  }
}

/**
 * @param {object} input
 * @param {object} [hosts]
 */
export async function buildFindMatchDiagSnapshot(input, hosts = {}) {
  const now = hosts.now ?? Date.now();
  const styleOrRuleset = input.styleId ?? input.rulesetId ?? null;
  const rulesetId = toFindMatchRulesetId(styleOrRuleset);
  const lockedStakePips = toFindMatchStakePips(input.lockedStakePips ?? input.stakePips);
  const lobbyKey =
    input.lobbyKey ||
    (styleOrRuleset && lockedStakePips != null ? `${styleOrRuleset}-${lockedStakePips}` : null);

  const ownSlim = slimRequest(input.own, now);
  const merged = (Array.isArray(input.mergedBoard) ? input.mergedBoard : [])
    .map((row) => slimRequest(row, now))
    .filter(Boolean);
  const renderedIds = (Array.isArray(input.renderedRequestIds) ? input.renderedRequestIds : [])
    .map((id) => asId(id))
    .filter(Boolean);

  let rawRpc = { ok: false, reason: "skipped", ids: [], rows: [] };
  if (rulesetId && lockedStakePips != null) {
    try {
      const rows = await (hosts.listJoinable || listJoinableOpenMatchRequests)(
        rulesetId,
        lockedStakePips,
        hosts.client
      );
      const slim = (Array.isArray(rows) ? rows : []).map((row) => slimRequest(row, now)).filter(Boolean);
      rawRpc = {
        ok: true,
        reason: null,
        ids: slim.map((row) => row.id).filter(Boolean),
        rows: slim,
      };
    } catch (error) {
      rawRpc = {
        ok: false,
        reason: String(error?.code || error?.message || "list_failed").slice(0, 80),
        ids: [],
        rows: [],
      };
    }
  } else {
    rawRpc = { ok: false, reason: "lobby_incomplete", ids: [], rows: [] };
  }

  const blocked = await (hosts.readBlocked || readRankedBlockedOpponentIds)(hosts.client);
  const peerCreatorIds = [
    ...new Set(
      [...merged, ...(rawRpc.rows || [])]
        .map((row) => row.creator_id)
        .filter((id) => id && id !== input.playerId)
    ),
  ];
  const pairLimitForPeers = peerCreatorIds.map((creatorId) => ({
    creator_id: creatorId,
    blocked_for_caller:
      blocked.ok && Array.isArray(blocked.ids) ? blocked.ids.includes(creatorId) : null,
  }));

  let callerOccupancy = { ok: false, reason: "skipped", match: null };
  try {
    const match = await (hosts.getMyActiveMatch || getMyActiveMatch)(hosts.client);
    callerOccupancy = {
      ok: true,
      reason: null,
      match: match
        ? {
            match_id: asId(match.id),
            status: match.status ?? null,
            ruleset_id: match.rulesetId ?? match.ruleset_id ?? null,
            stake_pips: match.stakePips ?? match.stake_pips ?? null,
          }
        : null,
    };
  } catch (error) {
    callerOccupancy = {
      ok: false,
      reason: String(error?.code || error?.message || "occupancy_failed").slice(0, 80),
      match: null,
    };
  }

  const visibilityState =
    typeof document !== "undefined" ? document.visibilityState || null : input.visibilityState ?? null;
  const online =
    typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
      ? navigator.onLine
      : input.online ?? null;

  return {
    diag: "find_match_lobby",
    version: FIND_MATCH_DIAG_VERSION,
    captured_at: new Date(now).toISOString(),
    player_id: asId(input.playerId),
    display_name: input.displayName || null,
    style_id: styleOrRuleset || null,
    ruleset_id: rulesetId,
    lockedStakePips,
    lobby_key: lobbyKey,
    boardSource: input.boardSource || null,
    ui_state: input.uiState || null,
    own_request_id: ownSlim?.id || null,
    own_request_status: ownSlim?.status || null,
    own_waiting_heartbeat_at: ownSlim?.waiting_heartbeat_at || null,
    own_heartbeat_age_sec: ownSlim?.heartbeat_age_sec ?? null,
    own_request: ownSlim,
    raw_list_joinable_ok: rawRpc.ok,
    raw_list_joinable_reason: rawRpc.reason,
    raw_list_joinable_ids: rawRpc.ids,
    raw_list_joinable_rows: rawRpc.rows,
    merged_board_ids: merged.map((row) => row.id).filter(Boolean),
    merged_board_rows: merged,
    rendered_request_ids: renderedIds,
    pair_limit_blocked_rpc_ok: blocked.ok,
    pair_limit_blocked_rpc_reason: blocked.reason,
    pair_limit_blocked_opponent_ids: blocked.ids,
    pair_limit_for_peers: pairLimitForPeers,
    caller_occupancy: callerOccupancy,
    visibilityState,
    online,
    last_refresh_reason: input.lastRefreshReason || null,
    note: "temporary_readonly_find_match_diag",
  };
}

export function serializeFindMatchDiag(snapshot) {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/**
 * Assert snapshot has no secret-looking fields.
 * @param {object} snapshot
 */
export function assertFindMatchDiagSafe(snapshot) {
  const text = JSON.stringify(snapshot);
  const banned = [
    /access_token/i,
    /refresh_token/i,
    /service_role/i,
    /password/i,
    /"email"\s*:/i,
    /Bearer\s+[A-Za-z0-9\-._~+/]+=*/i,
    /sb_secret_/i,
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i,
  ];
  for (const pattern of banned) {
    if (pattern.test(text)) {
      throw new Error(`find_match_diag_unsafe:${pattern}`);
    }
  }
  return true;
}

/**
 * @param {object} snapshot
 * @param {{ copyText?: Function, share?: Function }} [hosts]
 */
export async function exportFindMatchDiag(snapshot, hosts = {}) {
  assertFindMatchDiagSafe(snapshot);
  const text = serializeFindMatchDiag(snapshot);
  const copy = hosts.copyText || copyText;
  const copied = await copy(text);
  if (copied) return { ok: true, method: "clipboard", text };
  const shareFn = hosts.share ?? globalThis.navigator?.share?.bind(globalThis.navigator);
  if (typeof shareFn === "function") {
    try {
      await shareFn({ title: "LeoDomino Find Match diag", text });
      return { ok: true, method: "share", text };
    } catch (error) {
      if (error?.name === "AbortError") return { ok: false, method: "share_cancelled", text };
    }
  }
  return { ok: false, method: "manual", text };
}

/**
 * Hidden gesture: 5 taps within 2s on the Find Match title.
 * @param {{ count: number, firstAt: number }} state
 * @param {number} [now]
 */
export function noteFindMatchDiagTitleTap(state, now = Date.now()) {
  const prev = state && typeof state === "object" ? state : { count: 0, firstAt: 0 };
  if (!prev.firstAt || now - prev.firstAt > 2000) {
    return { count: 1, firstAt: now, armed: false };
  }
  const count = prev.count + 1;
  return { count, firstAt: prev.firstAt, armed: count >= 5 };
}
