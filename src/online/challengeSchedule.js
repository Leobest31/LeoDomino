/**
 * Player Challenge schedule client. Read-only public RPC.
 * Never writes. Never uses staff Challenge RPCs.
 */
import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient.js";

export const CHALLENGE_SCHEDULE_STATUSES = Object.freeze([
  "coming_soon",
  "scheduled",
  "live",
  "completed",
]);

export const CHALLENGE_SCHEDULE_ERROR = Object.freeze({
  AUTH: "auth",
  UNAVAILABLE: "unavailable",
  GENERIC: "generic",
});

const UNSAFE_FIELD = /email|phone|token|password|qualified|audit|staff|hand|engine_state|legalMoves|secret|jwt|metadata/i;

export class ChallengeScheduleError extends Error {
  constructor(code, message, cause) {
    super(message || code);
    this.name = "ChallengeScheduleError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function clientOf(client) {
  return client ?? getSupabaseClient();
}

function asInt(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function asText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function throwFromError(error) {
  const msg = String(error?.message || error?.details || error?.hint || error?.code || "");
  const code = String(error?.code || "");
  if (/authentication required/i.test(msg) || code === "28000") {
    throw new ChallengeScheduleError(CHALLENGE_SCHEDULE_ERROR.AUTH, msg, error);
  }
  if (/does not exist|42883|PGRST202/i.test(`${msg} ${code}`)) {
    throw new ChallengeScheduleError(CHALLENGE_SCHEDULE_ERROR.UNAVAILABLE, msg, error);
  }
  throw new ChallengeScheduleError(CHALLENGE_SCHEDULE_ERROR.GENERIC, msg, error);
}

function dropUnsafeKeys(row) {
  if (!row || typeof row !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (UNSAFE_FIELD.test(key)) continue;
    out[key] = value;
  }
  return out;
}

export function normalizeChallengeSchedule(row) {
  if (!row || typeof row !== "object") return null;
  const data = dropUnsafeKeys(row);
  const status = asText(data.status);
  return {
    status: CHALLENGE_SCHEDULE_STATUSES.includes(status) ? status : "coming_soon",
    startsAt: asText(data.starts_at ?? data.startsAt),
    endsAt: asText(data.ends_at ?? data.endsAt),
    qualificationCp: asInt(data.qualification_cp ?? data.qualificationCp),
    firstPrizeUsd: asInt(data.first_prize_usd ?? data.firstPrizeUsd),
    secondPrizeUsd: asInt(data.second_prize_usd ?? data.secondPrizeUsd),
    cpEarningEnabled: false,
  };
}

export const ZERO_COUNTDOWN = Object.freeze({
  days: "00",
  hours: "00",
  minutes: "00",
  seconds: "00",
});

export function padCountdownPart(value) {
  return String(Math.max(0, Math.trunc(Number(value) || 0))).padStart(2, "0");
}

/** Non-negative parts of `targetMs - nowMs`. Never goes below zero. */
export function remainingCountdownParts(targetMs, nowMs = Date.now()) {
  if (!Number.isFinite(targetMs)) return { ...ZERO_COUNTDOWN };
  const totalSec = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  return {
    days: padCountdownPart(Math.floor(totalSec / 86400)),
    hours: padCountdownPart(Math.floor((totalSec % 86400) / 3600)),
    minutes: padCountdownPart(Math.floor((totalSec % 3600) / 60)),
    seconds: padCountdownPart(totalSec % 60),
  };
}

export function challengeCountdownParts(startMs, nowMs = Date.now()) {
  if (!Number.isFinite(startMs) || startMs - nowMs <= 0) return null;
  return remainingCountdownParts(startMs, nowMs);
}

/**
 * Clock chrome from hosted timestamps. Does not write status. Does not auto-live.
 * upcoming: now < starts_at → countdown to start
 * running: starts_at reached and now < ends_at → countdown to end
 * ended: ends_at reached → 00:00:00:00
 */
export function challengeClockPresentation(schedule, nowMs = Date.now()) {
  if (!schedule) {
    return {
      status: "coming_soon",
      startsAt: null,
      endsAt: null,
      qualificationCp: null,
      firstPrizeUsd: null,
      secondPrizeUsd: null,
      cpEarningEnabled: false,
      clockPhase: "upcoming",
      countdown: { ...ZERO_COUNTDOWN },
      targetMs: null,
    };
  }
  const startMs = Date.parse(schedule.startsAt || "");
  const endMs = Date.parse(schedule.endsAt || "");
  const hasStart = Number.isFinite(startMs);
  const hasEnd = Number.isFinite(endMs);
  let clockPhase = "upcoming";
  let targetMs = hasStart ? startMs : null;
  if (hasStart && nowMs < startMs) {
    clockPhase = "upcoming";
    targetMs = startMs;
  } else if (hasEnd && nowMs < endMs) {
    clockPhase = "running";
    targetMs = endMs;
  } else if (hasEnd && nowMs >= endMs) {
    clockPhase = "ended";
    targetMs = endMs;
  } else if (hasStart && nowMs >= startMs) {
    clockPhase = "ended";
    targetMs = startMs;
  }
  const countdown =
    clockPhase === "ended" || !Number.isFinite(targetMs)
      ? { ...ZERO_COUNTDOWN }
      : remainingCountdownParts(targetMs, nowMs);
  return {
    status: schedule.status,
    startsAt: schedule.startsAt,
    endsAt: schedule.endsAt,
    qualificationCp: schedule.qualificationCp,
    firstPrizeUsd: schedule.firstPrizeUsd,
    secondPrizeUsd: schedule.secondPrizeUsd,
    cpEarningEnabled: false,
    clockPhase,
    countdown,
    targetMs: Number.isFinite(targetMs) ? targetMs : null,
  };
}

export function challengeClockHeadlineKey(phase) {
  if (phase === "running") return "challenge.clockLive";
  if (phase === "ended") return "challenge.clockCompleted";
  return "challenge.clockComingSoon";
}

export function challengeClockSubKey(phase) {
  if (phase === "running") return "challenge.timeRemaining";
  if (phase === "ended") return "challenge.ended";
  return "challenge.startsIn";
}

/**
 * Home/page presentation. Hosted status is never upgraded from the clock.
 */
export function challengeHomePresentation(schedule, nowMs = Date.now()) {
  const clock = challengeClockPresentation(schedule, nowMs);
  return {
    ...clock,
    showCountdown: clock.clockPhase !== "ended" && clock.targetMs != null,
  };
}

export function challengeStatusI18nKey(status) {
  if (status === "scheduled") return "home.challengeStatusScheduled";
  if (status === "live") return "home.challengeStatusLive";
  if (status === "completed") return "home.challengeStatusCompleted";
  return "home.challengeStatusComingSoon";
}

export async function fetchPublicChallengeSchedule(client) {
  if (!client && !isSupabaseConfigured()) {
    throw new ChallengeScheduleError(CHALLENGE_SCHEDULE_ERROR.UNAVAILABLE, "supabase not configured");
  }
  let db;
  try {
    db = clientOf(client);
  } catch (err) {
    throw new ChallengeScheduleError(CHALLENGE_SCHEDULE_ERROR.UNAVAILABLE, err?.message, err);
  }
  const { data, error } = await db.rpc("get_public_challenge_schedule", {}, { get: false });
  if (error) throwFromError(error);
  return normalizeChallengeSchedule(data);
}
