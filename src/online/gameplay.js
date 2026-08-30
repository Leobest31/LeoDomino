/**
 * Browser client for the live-gameplay Edge Function.
 * OnlineGamePage / useOnlineMatch consume this. GamePage (LeoBest) must not.
 */
import { getSupabaseClient } from "./supabaseClient.js";

export class GameplayClientError extends Error {
  /** @param {string} code @param {string} [message] @param {unknown} [cause] */
  constructor(code, message, cause) {
    super(message || code);
    this.name = "GameplayClientError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function clientOf(client) {
  return client ?? getSupabaseClient();
}

function throwFromFunctions(error, fallback) {
  const code = error?.context?.code || error?.code || fallback;
  const wrapped = new GameplayClientError(code, error?.message || fallback, error);
  const status = Number(error?.context?.status || error?.status || error?.cause?.status);
  if (Number.isInteger(status) && status >= 100) wrapped.status = status;
  throw wrapped;
}

async function invoke(op, payload, client) {
  const body = { op, ...payload };
  try {
    if (import.meta.env?.DEV) body.trace = true;
  } catch {
    /* node tests have no Vite DEV flag */
  }
  const { data, error } = await clientOf(client).functions.invoke("online-game", {
    body,
  });
  if (error) throwFromFunctions(error, "GAMEPLAY_FAILED");
  if (data?.error) {
    throw new GameplayClientError(data.error.code || "GAMEPLAY_FAILED", data.error.message);
  }
  return data;
}

export function enterOnlineMatch(matchId, client) {
  return invoke("enter_online_match", { matchId }, client);
}

export function getGameView(matchId, client) {
  return invoke("get_game_view", { matchId }, client);
}

export function submitGameAction(matchId, expectedVersion, action, client) {
  return invoke("submit_game_action", { matchId, expectedVersion, action }, client);
}

/**
 * Minimum next-round contract after phase === roundOver.
 * Classic/Haitian deal the next round. American finishes a pending match
 * winner or deals the next round.
 */
export function advanceOnlineRound(matchId, expectedVersion, client) {
  return invoke("advance_online_round", { matchId, expectedVersion }, client);
}

export function resolveTurnTimeout(matchId, expectedVersion, client) {
  return invoke("resolve_turn_timeout", { matchId, expectedVersion }, client);
}

export function subscribeGameSession(matchId, onEvent, client) {
  const db = clientOf(client);
  const channel = db.channel(`leo-game-session-${matchId}`);
  channel
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "game_sessions", filter: `match_id=eq.${matchId}` },
      (payload) => {
        onEvent?.(payload);
      }
    )
    .subscribe();
  return () => {
    db.removeChannel(channel);
  };
}
