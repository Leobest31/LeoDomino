/** Allowlisted crash metadata. Never attach engine or secret objects. */

export const SAFE_TAG_KEYS = Object.freeze([
  "appVersion",
  "buildNumber",
  "environment",
  "platform",
  "screen",
  "page",
  "ruleset",
  "mode",
  "matchId",
  "matchVersion",
  "actionName",
  "backendErrorCode",
]);

const SAFE = new Set(SAFE_TAG_KEYS);

const SAFE_MODE = new Set(["online", "LeoBest"]);
const SAFE_PLATFORM = new Set(["android", "ios", "web"]);
const SAFE_RULESET = new Set(["classic", "haitian", "american", "legacy"]);

function asShortId(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 36);
}

function asToken(value, allowed) {
  if (typeof value !== "string") return undefined;
  return allowed.has(value) ? value : undefined;
}

/**
 * Keep only safe scalar telemetry fields.
 * @param {Record<string, unknown>} [input]
 */
export function pickSafeMetadata(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  /** @type {Record<string, string | number>} */
  const out = {};

  for (const key of SAFE_TAG_KEYS) {
    if (!(key in src)) continue;
    const value = src[key];
    if (value == null || value === "") continue;

    if (key === "mode") {
      const mode = asToken(value, SAFE_MODE);
      if (mode) out.mode = mode;
      continue;
    }
    if (key === "platform") {
      const platform = asToken(String(value).toLowerCase(), SAFE_PLATFORM);
      if (platform) out.platform = platform;
      continue;
    }
    if (key === "ruleset") {
      const ruleset = asToken(String(value).toLowerCase(), SAFE_RULESET) || asShortId(String(value));
      if (ruleset && !String(ruleset).includes("{")) out.ruleset = String(ruleset).slice(0, 32);
      continue;
    }
    if (key === "matchId") {
      const id = asShortId(String(value));
      if (id) out.matchId = id;
      continue;
    }
    if (key === "matchVersion") {
      const n = Number(value);
      if (Number.isInteger(n) && n >= 0) out.matchVersion = n;
      continue;
    }
    if (key === "actionName") {
      if (typeof value === "string" && /^(play|draw|pass|enter|advance_round)$/.test(value)) {
        out.actionName = value;
      }
      continue;
    }
    if (key === "backendErrorCode") {
      if (typeof value === "string" && /^[A-Z][A-Z0-9_]{1,64}$/.test(value)) {
        out.backendErrorCode = value;
      }
      continue;
    }
    if (typeof value === "string") {
      out[key] = value.slice(0, 64);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    }
  }

  return out;
}

export function metadataToTags(metadata) {
  const tags = {};
  for (const [key, value] of Object.entries(pickSafeMetadata(metadata))) {
    tags[key] = String(value);
  }
  return tags;
}

export function hasUnsafeKeys(input) {
  if (!input || typeof input !== "object") return false;
  return Object.keys(input).some((key) => !SAFE.has(key));
}
