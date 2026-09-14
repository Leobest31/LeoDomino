/**
 * Dual-compat mapping for commit_online_game_transition.
 * Old hosted SQL RAISES stale / timeout-not-due.
 * New SQL returns HTTP 200 { ok: false, code }.
 * Both become GameplayError STALE_VERSION / TIMEOUT_NOT_DUE (HTTP 409).
 */
import { GameplayError } from "./gameAuthority.js";

export function commitConflictCode(data) {
  if (!data || data.ok !== false) return "";
  const code = String(data.code || "");
  if (code === "STALE_VERSION" || code === "TIMEOUT_NOT_DUE") return code;
  return "";
}

export function throwIfCommitConflict(data) {
  const code = commitConflictCode(data);
  if (code === "STALE_VERSION") {
    throw new GameplayError("STALE_VERSION", "expected_version does not match");
  }
  if (code === "TIMEOUT_NOT_DUE") {
    throw new GameplayError("TIMEOUT_NOT_DUE", "timeout not due");
  }
  if (data && data.ok === false) {
    throw new GameplayError("GAMEPLAY_FAILED", String(data.code || "commit rejected"));
  }
}

function unwrapCommitRpcData(data) {
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

/**
 * Edge PostgREST commit adapter. HTTP 200 + { ok: false } is a conflict,
 * never a persisted transition. Must not return a viewer.
 */
export function committedTransitionFromRpc(data) {
  const row = unwrapCommitRpcData(data);
  throwIfCommitConflict(row);
  return {
    version: row?.version,
    turnDeadlineAt: row?.turnDeadlineAt ?? row?.turn_deadline_at ?? null,
    timeoutStrikes: row?.timeoutStrikes ?? row?.timeout_strikes ?? null,
  };
}

export function gameplayErrorFromCommitRaise(error) {
  if (error instanceof GameplayError) return error;
  const message = String(error?.message || error?.details || "");
  if (/stale expected_version/i.test(message) || error?.code === "40001") {
    return new GameplayError("STALE_VERSION", "expected_version does not match");
  }
  if (/timeout not due/i.test(message)) {
    return new GameplayError("TIMEOUT_NOT_DUE", "timeout not due");
  }
  return null;
}
