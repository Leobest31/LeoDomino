/**
 * Online table interaction recovery. Does not change engine legality,
 * timeout strikes, scoring, or RP. Server-authoritative progress always
 * beats stale local drag / end-choice state.
 */

import { isMatchOverView } from "./onlineTable.js";

export const UNHEALTHY_REALTIME_STATUSES = ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"];

export function viewVersionOf(view) {
  const n = Number(view?.version);
  return Number.isInteger(n) && n >= 0 ? n : -1;
}

export function interactionEpoch(view) {
  if (!view) return "none";
  const terminal = isMatchOverView(view) ? "over" : "live";
  return `${view.matchId || ""}:${viewVersionOf(view)}:${Number(view.currentSeat)}:${Number(view.round) || 0}:${terminal}`;
}

/**
 * True when the incoming snapshot is a different authoritative turn/table
 * than the one the player started dragging/selecting on.
 */
export function shouldClearLocalInteraction(previous, next) {
  if (!next) return Boolean(previous);
  if (!previous) return false;
  if (isMatchOverView(next) && !isMatchOverView(previous)) return true;
  if ((previous.matchId || "") !== (next.matchId || "")) return true;
  if (viewVersionOf(next) > viewVersionOf(previous)) return true;
  if (Number(next.currentSeat) !== Number(previous.currentSeat)) return true;
  if ((Number(next.round) || 0) !== (Number(previous.round) || 0)) return true;
  return false;
}

/** Drag may delay same-turn Realtime; it must not stash a newer turn/table. */
export function shouldBypassDragLock(previous, incoming) {
  return shouldClearLocalInteraction(previous, incoming);
}

export function isUnhealthyRealtimeStatus(status) {
  return UNHEALTHY_REALTIME_STATUSES.includes(status);
}

export function shouldRefreshAuthoritativeViewOnResume(view) {
  if (!view || isMatchOverView(view)) return false;
  return view.phase === "playing" || view.status === "playing";
}

export function documentIsVisible(doc = globalThis.document) {
  if (!doc) return true;
  return doc.visibilityState !== "hidden";
}

/**
 * Map a highlighted board tile back to a legal end. Shared opening doubles
 * return null so the caller uses equivalentPlayEnd.
 */
export function endpointEndForTileId(highlightByEnd, tileId) {
  if (!tileId || !highlightByEnd || typeof highlightByEnd !== "object") return null;
  const hits = Object.entries(highlightByEnd)
    .filter(([, id]) => id === tileId)
    .map(([end]) => end);
  if (hits.length === 1) return hits[0];
  return null;
}

/**
 * When the pointer is over no measured DOM endpoint, still allow a legal
 * play if the engine only has one distinct placement (or equivalent ends).
 * Two distinct Classic ends with no DOM must not auto-pick; the UI offers
 * tap-left / tap-right instead of locking the hand.
 *
 * @returns {{ action: "place", end: string } | { action: "cancel" } | { action: "choose" }}
 */
export function resolvePlayWithoutDomTargets({
  legalEnds = [],
  equivalent = null,
  autoEnd = null,
} = {}) {
  const ends = Array.isArray(legalEnds) ? legalEnds.filter(Boolean) : [];
  if (autoEnd) return { action: "place", end: autoEnd };
  if (equivalent) return { action: "place", end: equivalent };
  if (ends.length === 1) return { action: "place", end: ends[0] };
  if (ends.length > 1) return { action: "choose" };
  return { action: "cancel" };
}

export function hasUsableDomTargets(targets) {
  return Array.isArray(targets) && targets.some((entry) => entry?.end && entry.rect);
}

export function endChoiceI18nKey(end) {
  if (end === "left") return "game.chooseLeftEnd";
  if (end === "right") return "game.chooseRightEnd";
  if (end === "north") return "game.chooseNorthEnd";
  if (end === "south") return "game.chooseSouthEnd";
  return "game.chooseLeftEnd";
}
