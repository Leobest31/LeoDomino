/**
 * Account-deletion success guards.
 * Pure helpers shared by the Edge Function and contract tests.
 * Do not log JWTs, emails, or secrets.
 */

export function isAlreadyGone(error) {
  const code = String(error?.error_code || error?.code || "").toLowerCase();
  return code === "user_not_found";
}

export function isPrepareSuccess(prepared) {
  return Boolean(prepared) && prepared.ok === true && typeof prepared.already_tombstoned === "boolean";
}

export function isTombstoneVerified(profile) {
  const row = Array.isArray(profile) ? profile[0] : profile;
  return Boolean(row && row.deleted_at);
}

/**
 * Interpret Auth Admin GET /admin/users/:id.
 * "absent" only when GoTrue names user_not_found.
 * Generic 404 / 401 / empty 200 is "unknown", never success.
 */
export function authLookupResult(status, body, userId) {
  if (status >= 200 && status < 300) {
    const user = body?.id ? body : body?.user;
    if (user?.id && (!userId || String(user.id) === String(userId))) return "exists";
    return "unknown";
  }
  const code = String(body?.error_code || body?.code || "").toLowerCase();
  if (code === "user_not_found") return "absent";
  return "unknown";
}

export function canReturnOk({ tombstoneVerified, authState }) {
  return tombstoneVerified === true && authState === "absent";
}
