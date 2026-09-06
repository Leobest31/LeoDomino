/**
 * Targeted freeze diagnostics. No hands, seeds, reserve order, or tokens.
 * Safe to log from Edge and from the online table client.
 */

function intOrNull(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function shouldEmitOnlineActionLog() {
  try {
    if (typeof Deno !== "undefined") return true;
  } catch {
    /* browser / node */
  }
  try {
    if (import.meta.env?.DEV) return true;
  } catch {
    /* no vite env */
  }
  try {
    if (typeof process !== "undefined" && process.env?.LEO_ONLINE_ACTION_DIAG === "1") {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function tokenOrNull(value, max = 48) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

/**
 * @returns {{
 *   stage: string,
 *   match_id: string|null,
 *   player_id: string|null,
 *   expected_version: number|null,
 *   server_version: number|null,
 *   client_known_version: number|null,
 *   server_turn: number|null,
 *   action_type: string|null,
 *   failure_stage: string|null,
 * }}
 */
export function onlineActionDiag(stage, details = {}) {
  const row = {
    stage: tokenOrNull(stage, 32) || "unknown",
    match_id: tokenOrNull(details.matchId ?? details.match_id, 36),
    player_id: tokenOrNull(details.playerId ?? details.player_id, 36),
    expected_version: intOrNull(details.expectedVersion ?? details.expected_version),
    server_version: intOrNull(details.serverVersion ?? details.server_version),
    client_known_version: intOrNull(
      details.clientKnownVersion ?? details.client_known_version ?? details.expectedVersion
    ),
    server_turn: intOrNull(details.serverTurn ?? details.server_turn),
    action_type: tokenOrNull(details.actionType ?? details.action_type, 32),
    failure_stage: tokenOrNull(details.failureStage ?? details.failure_stage ?? stage, 32),
  };
  try {
    if (shouldEmitOnlineActionLog()) console.info("[online-action]", row);
  } catch {
    /* ignore logging failures */
  }
  return row;
}
