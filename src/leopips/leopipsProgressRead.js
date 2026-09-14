/**
 * Read-only player progression for authenticated Home / Level-Up.
 * SELECT via RLS only. Clients cannot write XP/Level.
 */

import { getSupabaseClient, isSupabaseConfigured } from "../online/supabaseClient.js";
import {
  progressionRankFromLevel,
  progressionWinProgress,
} from "./leopipsProgress.js";

export const PLAYER_PROGRESSION_TABLE = "player_progression";
export const PLAYER_LEVEL_UP_EVENTS_TABLE = "player_level_up_events";

export class LeoPipsProgressionError extends Error {
  constructor(code, message, cause) {
    super(message || code);
    this.name = "LeoPipsProgressionError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function clientOf(client) {
  return client ?? getSupabaseClient();
}

function asNonNegInt(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

export function normalizeProgressionRow(row) {
  if (!row) {
    return {
      status: "missing",
      lifetimeXp: 0,
      qualifyingWins: 0,
      level: 0,
      rank: null,
      winProgress: progressionWinProgress(0),
    };
  }
  const lifetimeXp = asNonNegInt(row.lifetime_xp ?? row.lifetimeXp) ?? 0;
  const qualifyingWins =
    asNonNegInt(row.qualifying_public_completed_wins ?? row.qualifyingWins) ?? 0;
  const level =
    asNonNegInt(row.level) ?? progressionWinProgress(qualifyingWins).level;
  const winProgress = progressionWinProgress(qualifyingWins);
  return {
    status: "ready",
    lifetimeXp,
    qualifyingWins,
    level,
    rank: progressionRankFromLevel(level),
    winProgress,
  };
}

/**
 * @returns {Promise<object>}
 */
export async function readMyProgression({ client } = {}) {
  if (!isSupabaseConfigured() && !client) {
    throw new LeoPipsProgressionError("UNAVAILABLE", "Progression is unavailable.");
  }
  const db = clientOf(client);
  const { data: authData, error: authError } = await db.auth.getUser();
  if (authError || !authData?.user?.id) {
    throw new LeoPipsProgressionError("AUTH", "Sign in to load progression.", authError);
  }

  const { data, error } = await db
    .from(PLAYER_PROGRESSION_TABLE)
    .select("lifetime_xp, qualifying_public_completed_wins, level")
    .eq("player_id", authData.user.id)
    .maybeSingle();

  if (error) {
    throw new LeoPipsProgressionError(
      "READ_FAILED",
      error.message || "Progression read failed.",
      error
    );
  }

  return normalizeProgressionRow(data);
}

export async function listMyPendingLevelUps({ client } = {}) {
  if (!isSupabaseConfigured() && !client) {
    return [];
  }
  const db = clientOf(client);
  const { data: authData, error: authError } = await db.auth.getUser();
  if (authError || !authData?.user?.id) return [];

  const { data, error } = await db
    .from(PLAYER_LEVEL_UP_EVENTS_TABLE)
    .select("id, level, qualifying_wins, match_id, rank, created_at, consumed_at")
    .eq("player_id", authData.user.id)
    .is("consumed_at", null)
    .order("level", { ascending: true });

  if (error || !Array.isArray(data)) return [];
  return data.map((row) => ({
    id: row.id,
    level: asNonNegInt(row.level),
    qualifyingWins: asNonNegInt(row.qualifying_wins),
    matchId: row.match_id,
    rank: row.rank || progressionRankFromLevel(row.level),
    createdAt: row.created_at,
  }));
}

export async function consumeMyLevelUpEvent(level, { client } = {}) {
  const db = clientOf(client);
  const { data, error } = await db.rpc("consume_my_level_up_event", {
    p_level: Number(level),
  });
  if (error) {
    throw new LeoPipsProgressionError(
      "CONSUME_FAILED",
      error.message || "Level-Up consume failed.",
      error
    );
  }
  return data;
}
