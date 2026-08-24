/** Codes that are expected match/control-flow outcomes, not production crashes. */

export const EXPECTED_ERROR_CODES = Object.freeze([
  "STALE_VERSION",
  "MATCH_NOT_FOUND",
  "NOT_FOUND",
  "WRONG_TURN",
  "ILLEGAL_TILE",
  "ILLEGAL_PLACEMENT",
  "ILLEGAL_MOVE",
  "PASS_NOT_ALLOWED",
  "DRAW_NOT_ALLOWED",
  "CLIENT_TILE_ID_FORBIDDEN",
  "AUTH_REQUIRED",
  "AUTH",
  "NOT_A_PLAYER",
  "NOT_OPEN",
  "EXPIRED",
  "ALREADY_OPEN",
  "SELF_ACCEPT",
  "INVALID_STYLE",
  "VERSION_REQUIRED",
  "MATCH_REQUIRED",
  "UNSUPPORTED_RULESET",
  "UNKNOWN_ACTION",
  "ROUND_NOT_ACTIVE",
  "ADVANCE_NOT_ALLOWED",
  "INVALID_SEAT",
  "INVALID_SEATS",
  "NETWORK",
  "OFFLINE",
  "CREATE_FAILED",
  "ACCEPT_FAILED",
  "CANCEL_FAILED",
]);

export const REPORTABLE_ERROR_CODES = Object.freeze([
  "MALFORMED_PROJECTION",
  "IMPOSSIBLE_STATE",
  "RECONSTRUCT_FAILED",
  "UNEXPECTED_RESPONSE",
  "SECRET_LEAK",
  "UNRECOVERABLE_GAMEPLAY",
  "UNRECOVERABLE_MATCHMAKING",
  "REACT_RENDER_CRASH",
]);

const EXPECTED = new Set(EXPECTED_ERROR_CODES);
const REPORTABLE = new Set(REPORTABLE_ERROR_CODES);

export function errorCodeOf(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  return String(error.code || error.name || "");
}

export function isExpectedError(error) {
  const code = errorCodeOf(error);
  if (EXPECTED.has(code)) return true;
  const message = String(error?.message || error || "");
  if (/failed to fetch|networkerror|load failed/i.test(message) && !REPORTABLE.has(code)) {
    return true;
  }
  return false;
}

export function isReportableError(error) {
  if (isExpectedError(error)) return false;
  return REPORTABLE.has(errorCodeOf(error));
}
