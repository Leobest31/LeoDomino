/**
 * In-app Send Feedback client. Settings must not import Supabase.
 * Run: node src/online/feedback.test.js
 */
import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient.js";
import { APP_VERSION, getPlatform } from "../monitoring/client.js";

export const FEEDBACK_MIN_LENGTH = 20;
export const FEEDBACK_MAX_LENGTH = 2000;
export const FEEDBACK_CATEGORIES = Object.freeze(["general", "bug", "feature"]);

export const FEEDBACK_ERROR = Object.freeze({
  UNAVAILABLE: "unavailable",
  AUTH: "auth",
  INVALID_CATEGORY: "invalidCategory",
  TOO_SHORT: "tooShort",
  TOO_LONG: "tooLong",
  RATE_LIMIT: "rateLimit",
  GENERIC: "generic",
});

export class FeedbackError extends Error {
  constructor(code, message, cause) {
    super(message || code);
    this.name = "FeedbackError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function clientOf(client) {
  return client ?? getSupabaseClient();
}

function readViteEnv(name) {
  try {
    const env = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
    const value = env[name];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

export function normalizeFeedbackBody(raw) {
  return String(raw ?? "").trim();
}

export function normalizeFeedbackCategory(raw) {
  const category = String(raw ?? "").trim().toLowerCase();
  return FEEDBACK_CATEGORIES.includes(category) ? category : "";
}

export function feedbackBuildNumber() {
  return readViteEnv("VITE_BUILD_NUMBER").slice(0, 32);
}

export function buildFeedbackPayload({ category, body, platform, appVersion, buildNumber } = {}) {
  const cleanedCategory = normalizeFeedbackCategory(category);
  const cleanedBody = normalizeFeedbackBody(body);
  const resolvedPlatform = platform || getPlatform();
  const safePlatform =
    resolvedPlatform === "ios" || resolvedPlatform === "android" || resolvedPlatform === "web"
      ? resolvedPlatform
      : "web";
  const build = buildNumber === undefined ? feedbackBuildNumber() : String(buildNumber || "").trim();
  return {
    p_category: cleanedCategory,
    p_body: cleanedBody,
    p_app_version: String(appVersion || APP_VERSION).slice(0, 32),
    p_platform: safePlatform,
    p_build_number: build ? build.slice(0, 32) : null,
  };
}

export function validateFeedbackInput({ category, body } = {}) {
  if (!normalizeFeedbackCategory(category)) return FEEDBACK_ERROR.INVALID_CATEGORY;
  const text = normalizeFeedbackBody(body);
  if (text.length < FEEDBACK_MIN_LENGTH) return FEEDBACK_ERROR.TOO_SHORT;
  if (text.length > FEEDBACK_MAX_LENGTH) return FEEDBACK_ERROR.TOO_LONG;
  return null;
}

function throwFromError(error) {
  const msg = String(error?.message || error?.details || error?.hint || error?.code || "");
  if (/authentication required/i.test(msg) || error?.code === "28000") {
    throw new FeedbackError(FEEDBACK_ERROR.AUTH, msg, error);
  }
  if (/FEEDBACK_CATEGORY/i.test(msg)) {
    throw new FeedbackError(FEEDBACK_ERROR.INVALID_CATEGORY, msg, error);
  }
  if (/FEEDBACK_BODY_SHORT/i.test(msg)) {
    throw new FeedbackError(FEEDBACK_ERROR.TOO_SHORT, msg, error);
  }
  if (/FEEDBACK_BODY_LONG/i.test(msg)) {
    throw new FeedbackError(FEEDBACK_ERROR.TOO_LONG, msg, error);
  }
  if (/FEEDBACK_RATE_LIMIT/i.test(msg)) {
    throw new FeedbackError(FEEDBACK_ERROR.RATE_LIMIT, msg, error);
  }
  throw new FeedbackError(FEEDBACK_ERROR.GENERIC, msg, error);
}

export async function submitMyFeedback({ category, body } = {}, client) {
  if (!client && !isSupabaseConfigured()) {
    throw new FeedbackError(FEEDBACK_ERROR.UNAVAILABLE);
  }
  const invalid = validateFeedbackInput({ category, body });
  if (invalid) throw new FeedbackError(invalid);
  const payload = buildFeedbackPayload({ category, body });
  const { data, error } = await clientOf(client).rpc("submit_my_feedback", payload);
  if (error) throwFromError(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok || !row?.id) {
    throw new FeedbackError(FEEDBACK_ERROR.GENERIC);
  }
  return { ok: true, id: row.id };
}
