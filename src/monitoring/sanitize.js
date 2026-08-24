/**
 * Privacy sanitizer for crash reports.
 * Strips credentials, PII, chat, and hidden gameplay state before Sentry send.
 */

export const REDACTED = "[Filtered]";

const SENSITIVE_KEY =
  /^(passwords?|passcodes?|otps?|otp_code|tokens?|jwt|jwts|authorization|auth|cookie|cookies|secret|secrets|service_role|serviceRoleKey|apikey|api_key|refresh_token|access_token|id_token|bearer|email|emails|phone|phone_number|tel|chat|chat_text|private_chat|message_body|message_text|hand|hands|my_hand|opponent_hand|opponentHand|hidden_hand|reserve|boneyard|bone_yard|seed|deal_seed|engine_state|engineState|game_state|gameState|full_state|authoritative_state|body|payload|request_body)$/i;

const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._\-+=/]+/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /\+?\d[\d\s().-]{8,}\d/g;
const SB_SECRET_RE = /\bsb_secret_[A-Za-z0-9]+\b/g;
const SB_PUBLISHABLE_RE = /\bsb_publishable_[A-Za-z0-9_]+\b/g;

const SENSITIVE_QUERY = /^(access_token|refresh_token|id_token|token|jwt|code|password|otp|email|phone|apikey|api_key)$/i;

const DROP_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "apikey",
  "x-supabase-api-version",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function looksLikeGameState(value) {
  if (!isPlainObject(value)) return false;
  const keys = new Set(Object.keys(value));
  const hasHands = keys.has("hands") || keys.has("hand") || keys.has("players");
  const hasHidden =
    keys.has("reserve") ||
    keys.has("boneyard") ||
    keys.has("engineState") ||
    keys.has("engine_state") ||
    keys.has("gameState") ||
    keys.has("seed");
  return hasHands && hasHidden;
}

function redactString(value) {
  if (typeof value !== "string" || !value) return value;
  return value
    .replace(JWT_RE, REDACTED)
    .replace(BEARER_RE, `Bearer ${REDACTED}`)
    .replace(SB_SECRET_RE, REDACTED)
    .replace(SB_PUBLISHABLE_RE, REDACTED)
    .replace(EMAIL_RE, REDACTED)
    .replace(PHONE_RE, REDACTED);
}

function sanitizeUrl(url) {
  if (typeof url !== "string" || !url) return url;
  try {
    const parsed = new URL(url, "https://leodomino.invalid");
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY.test(key) || SENSITIVE_KEY.test(key)) {
        parsed.searchParams.set(key, REDACTED);
      }
    }
    const redacted = redactString(parsed.toString());
    if (url.startsWith("http")) return redacted;
    return redacted.replace("https://leodomino.invalid", "");
  } catch {
    return redactString(url);
  }
}

function sanitizeHeaders(headers) {
  if (!headers) return headers;
  if (typeof headers === "string") return redactString(headers);
  if (!isPlainObject(headers)) return sanitizeValue(headers, "");
  const next = {};
  for (const [key, value] of Object.entries(headers)) {
    if (DROP_HEADERS.has(String(key).toLowerCase()) || SENSITIVE_KEY.test(key)) {
      next[key] = REDACTED;
    } else {
      next[key] = sanitizeValue(value, key);
    }
  }
  return next;
}

/**
 * Recursively sanitize a value. Sensitive keys are replaced entirely.
 * @param {unknown} value
 * @param {string} [key]
 * @param {number} [depth]
 */
export function sanitizeValue(value, key = "", depth = 0) {
  if (depth > 8) return REDACTED;
  if (value == null) return value;
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (looksLikeGameState(value)) return REDACTED;
  if (typeof value === "string") {
    if (/url|href|link/i.test(key)) return sanitizeUrl(value);
    return redactString(value);
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, key, depth + 1));
  }
  const next = {};
  for (const [childKey, child] of Object.entries(value)) {
    next[childKey] = sanitizeValue(child, childKey, depth + 1);
  }
  return next;
}

export function sanitizeBreadcrumb(breadcrumb) {
  if (!breadcrumb || typeof breadcrumb !== "object") return breadcrumb;
  const next = {
    ...breadcrumb,
    message: redactString(breadcrumb.message),
    data: breadcrumb.data ? sanitizeValue(breadcrumb.data, "data") : breadcrumb.data,
  };
  if (next.data && isPlainObject(next.data)) {
    if (next.data.url) next.data.url = sanitizeUrl(String(next.data.url));
    if (next.data.from) next.data.from = sanitizeUrl(String(next.data.from));
    if (next.data.to) next.data.to = sanitizeUrl(String(next.data.to));
  }
  return next;
}

/**
 * @param {import("@sentry/core").ErrorEvent | import("@sentry/core").Event | null} event
 */
export function sanitizeEvent(event) {
  if (!event || typeof event !== "object") return event;
  const next = { ...event };

  if (next.user) {
    next.user = { id: typeof next.user.id === "string" ? next.user.id.slice(0, 8) : undefined };
  }

  if (next.request) {
    next.request = {
      ...next.request,
      url: next.request.url ? sanitizeUrl(next.request.url) : next.request.url,
      headers: sanitizeHeaders(next.request.headers),
      cookies: next.request.cookies ? REDACTED : next.request.cookies,
      data: next.request.data ? sanitizeValue(next.request.data, "data") : next.request.data,
      query_string: next.request.query_string
        ? sanitizeUrl(`https://x.invalid/?${next.request.query_string}`).split("?")[1]
        : next.request.query_string,
    };
  }

  if (next.extra) next.extra = sanitizeValue(next.extra, "extra");
  if (next.contexts) next.contexts = sanitizeValue(next.contexts, "contexts");
  if (next.tags) next.tags = sanitizeValue(next.tags, "tags");
  if (Array.isArray(next.breadcrumbs)) {
    next.breadcrumbs = next.breadcrumbs.map((crumb) => sanitizeBreadcrumb(crumb));
  } else if (Array.isArray(next.breadcrumbs?.values)) {
    next.breadcrumbs = {
      ...next.breadcrumbs,
      values: next.breadcrumbs.values.map((crumb) => sanitizeBreadcrumb(crumb)),
    };
  }
  if (next.message) next.message = redactString(next.message);
  if (next.exception?.values) {
    next.exception = {
      ...next.exception,
      values: next.exception.values.map((item) => ({
        ...item,
        value: redactString(item.value),
      })),
    };
  }

  return next;
}
