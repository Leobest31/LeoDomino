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
 * Structured online diagnostics. Never logs secrets, tokens, hands, or seeds.
 * @returns {Record<string, string|number|boolean|null>}
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
    connectivity: tokenOrNull(details.connectivity ?? details.clientConnectivity, 24),
    client_version: intOrNull(details.clientVersion ?? details.client_version),
    deadline_at: tokenOrNull(details.deadlineAt ?? details.deadline_at ?? details.turnDeadlineAt, 40),
    timeout_due:
      details.timeoutDue === true || details.timeout_due === true
        ? true
        : details.timeoutDue === false || details.timeout_due === false
          ? false
          : null,
    reconcile_triggered:
      details.reconcileTriggered === true || details.reconcile_triggered === true
        ? true
        : details.reconcileTriggered === false || details.reconcile_triggered === false
          ? false
          : null,
    sweep_result: tokenOrNull(details.sweepResult ?? details.sweep_result, 32),
    cas_conflict:
      details.casConflict === true || details.cas_conflict === true
        ? true
        : details.casConflict === false || details.cas_conflict === false
          ? false
          : null,
    stale_rejected:
      details.staleRejected === true || details.stale_rejected === true
        ? true
        : details.staleRejected === false || details.stale_rejected === false
          ? false
          : null,
  };
  try {
    if (shouldEmitOnlineActionLog()) console.info("[online-action]", row);
  } catch {
    /* ignore logging failures */
  }
  return row;
}

/** Recovery path a drag/drop landed on. */
export const DRAG_DROP_RECOVERY = Object.freeze({
  HIT_TEST: "hit_test",
  PARTIAL_TARGET: "partial_target_recovery",
  ZERO_TARGET: "zero_target_recovery",
  EXPLICIT_CHOICE: "explicit_choice",
  NONE: "none",
});

function boolOrNull(value) {
  return value === true ? true : value === false ? false : null;
}

/**
 * LEGAL_TILE_DROP_UNRESOLVED family — fired when a legal tile's drag/drop
 * could not be resolved by DOM hit-testing alone, and separately which
 * recovery path (if any) rescued the move. Never logs tile ids, pips,
 * hand contents, tokens, or secrets — counts and destination shapes only.
 * @returns {Record<string, string|number|boolean|null>}
 */
export function dragDropDiag(stage, details = {}) {
  const row = {
    stage: tokenOrNull(stage, 32) || "unknown",
    ruleset: tokenOrNull(details.ruleset, 16),
    legal_end_count: intOrNull(details.legalEndCount),
    measured_target_count: intOrNull(details.measuredTargetCount),
    destination_types: tokenOrNull(
      Array.isArray(details.destinationTypes)
        ? details.destinationTypes.join(",")
        : details.destinationTypes,
      64
    ),
    board_tile_count: intOrNull(details.boardTileCount),
    spinner_active: boolOrNull(details.spinnerActive),
    resolved_by_hit_test: boolOrNull(details.resolvedByHitTest),
    recovery_action: tokenOrNull(details.recoveryAction, 24),
    tap_like: boolOrNull(details.tapLike),
    client_build: tokenOrNull(details.clientBuild, 40),
    match_id: tokenOrNull(details.matchId, 36),
    client_known_version: intOrNull(details.clientKnownVersion),
  };
  try {
    if (shouldEmitOnlineActionLog()) console.info("[online-action]", row);
  } catch {
    /* ignore logging failures */
  }
  return row;
}
