/**
 * In-match getGameView fallback when Realtime is missed or the merged
 * snapshot is public-only. Server remains the authority.
 * Does not change engine legality, timeout strikes, occupancy, or RP.
 */

import {
  hasCoherentInteraction,
  isMatchOverView,
  isViewerTurn,
  needsPrivateHydration,
} from "./onlineTable.js";
import { isTurnDeadlineExpired } from "./turnTimeout.js";

/** Visible-only while a round is live. Realtime/focus still refresh immediately. */
export const PLAYING_HYDRATE_POLL_MS = 2500;

/** Planner tick while a private hand is missing. Requests stay backoff-gated. */
export const PRIVATE_HYDRATION_TICK_MS = 250;

/** Delays after a failed private getGameView. First detect is always immediate. */
export const PRIVATE_HYDRATION_RETRY_MS = Object.freeze([400, 1000, 2500, 4000, 8000]);

export const PRIVATE_HYDRATION_I18N_KEY = "online.reconnectingGame";

export function documentIsHidden(doc = globalThis.document) {
  return typeof doc !== "undefined" && doc?.visibilityState === "hidden";
}

export function isLivePlayingView(view) {
  if (!view || isMatchOverView(view)) return false;
  return view.phase === "playing" || view.status === "playing";
}

/**
 * Public Realtime patches strip interaction. A coherent waiting snapshot can
 * also be stale if CHANNEL_ERROR dropped opponent draws/plays/timeouts.
 */
export function needsPlayingHydrate(view) {
  return isLivePlayingView(view) || needsPrivateHydration(view);
}

export function emptyPrivateHydrationState() {
  return {
    attempt: 0,
    retryAt: 0,
    lastFailed: false,
  };
}

export function notePrivateHydrationSuccess() {
  return emptyPrivateHydrationState();
}

export function notePrivateHydrationFailure(state = emptyPrivateHydrationState(), nowMs = 0) {
  const attempt = (state.attempt || 0) + 1;
  const delay =
    PRIVATE_HYDRATION_RETRY_MS[Math.min(attempt - 1, PRIVATE_HYDRATION_RETRY_MS.length - 1)];
  return {
    attempt,
    retryAt: nowMs + delay,
    lastFailed: true,
  };
}

/**
 * Deterministic private-hand recovery. Immediate on first detect and on
 * foreground/reconnect. Failures back off. Concurrent requests dedupe.
 * Never submits play/draw/pass and never marks the match terminal.
 */
export function planPrivateHydration(view, state = emptyPrivateHydrationState(), options = {}) {
  if (isMatchOverView(view) || !needsPrivateHydration(view)) {
    return { action: "idle" };
  }
  if (options.hidden) return { action: "wait_visible" };
  if (options.refreshInFlight) return { action: "dedupe" };
  const now = Number(options.nowMs) || 0;
  if (!options.immediate && state.retryAt > 0 && now < state.retryAt) {
    return { action: "wait", retryAt: state.retryAt };
  }
  return { action: "refresh", force: true, reason: "private_hand_missing" };
}

/**
 * One interval tick. Never submits play/draw/pass.
 * Missing private hands and incoherent viewer turns force hydrate even
 * during a stuck drag. Background tabs wait for visibility.
 */
export function planPlayingHydrateTick(view, options = {}) {
  if (needsPrivateHydration(view)) {
    if (options.hidden) return { action: "skip" };
    return {
      action: "refresh",
      force: true,
      reason: "private_hand_missing",
    };
  }
  if (!isLivePlayingView(view)) return { action: "stop" };
  if (options.hidden) return { action: "skip" };
  // Pending timeout UI must not wait on Realtime; force catch-up while overdue
  // even if busy/drag soft-locks would otherwise skip the hydrate poll.
  if (isTurnDeadlineExpired(view, options.nowMs, options.monoMs)) {
    return {
      action: "refresh",
      force: true,
      reason: "timeout_pending_resync",
    };
  }
  if (options.busy) return { action: "skip" };
  const incoherent = !hasCoherentInteraction(view);
  if (options.dragLocked && !incoherent) return { action: "skip" };
  if (incoherent) {
    return {
      action: "refresh",
      force: true,
      reason: isViewerTurn(view) ? "incoherent_turn" : "incoherent_wait",
    };
  }
  return { action: "refresh", force: false, reason: "catch_up" };
}
