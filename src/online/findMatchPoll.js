/**

 * Creator Find Match discovery fallback. Realtime remains the fast path.

 * Polls while the local own request is still "open" OR "accepted" without Match Ready

 * (creator must not stall after accept if occupancy is briefly empty).

 */



import { canRecoverMatch, decideMatchRecovery, shouldPromoteAcceptedToMatchReady } from "./matchRecovery.js";



/** Visible-only while waiting. Realtime/focus still refresh immediately. */

export const FIND_MATCH_OPEN_POLL_MS = 2500;



export function documentIsHidden(doc = globalThis.document) {

  return typeof doc !== "undefined" && doc?.visibilityState === "hidden";

}



function isCreatorWaitingStatus(ownStatus) {

  return ownStatus === "open" || ownStatus === "accepted";

}



/**

 * Whether the creator waiting-card poll interval should be armed.

 * Hidden pages keep the interval but ticks skip (see planOpenRequestPollTick).

 * Keep polling through "accepted" until Match Ready is shown.

 */

export function shouldPollOpenRequest({ onlineReady = false, ownStatus = null, hasMatched = false } = {}) {

  return Boolean(onlineReady) && isCreatorWaitingStatus(ownStatus) && !hasMatched;

}



/**

 * One interval tick. Never starts create/accept. Hidden and in-flight skip.

 */

export function planOpenRequestPollTick({

  hidden = false,

  ownStatus = null,

  hasMatched = false,

  inFlight = false,

} = {}) {

  if (hasMatched || !isCreatorWaitingStatus(ownStatus)) return { action: "stop" };

  if (hidden || inFlight) return { action: "skip" };

  return { action: "refresh" };

}



/**

 * Apply one successful server snapshot to creator Find Match UI.

 * Occupancy / accepted own wins over a stale local open card.

 * Does not create or accept a request.

 */

export function applyCreatorDiscoverySnapshot({

  localOwn = null,

  occupancyMatch = null,

  occupancyUnknown = false,

  lastKnown = null,

  hydratedAcceptedMatch = undefined,

} = {}) {

  const acceptedMatchId = localOwn?.status === "accepted" ? localOwn.matchId || localOwn.match_id : null;

  const decision = decideMatchRecovery({

    occupancyUnknown,

    occupancyMatch,

    lastKnown,

    acceptedMatchId,

    hydratedAcceptedMatch,

  });

  let matched = null;

  if ((decision.kind === "resume" || decision.kind === "keep") && decision.match) {

    matched = canRecoverMatch(decision.match) ? decision.match : null;

  }

  // Occupancy-none right after accept: still promote via hydrated match row.

  const promoteFrom =

    (canRecoverMatch(occupancyMatch) && occupancyMatch) ||

    (canRecoverMatch(hydratedAcceptedMatch) && hydratedAcceptedMatch) ||

    null;

  if (!matched && shouldPromoteAcceptedToMatchReady(localOwn, promoteFrom)) {

    matched = promoteFrom;

  }

  const matchId = matched?.id || occupancyMatch?.id || hydratedAcceptedMatch?.id || null;

  const showWaiting =
    (localOwn?.status === "open" || localOwn?.status === "accepted") && !canRecoverMatch(matched);

  const showMatchReady = Boolean(canRecoverMatch(matched));

  const poll = shouldPollOpenRequest({

    onlineReady: true,

    ownStatus: localOwn?.status,

    hasMatched: showMatchReady,

  });

  return {

    matched,

    matchId,

    showWaiting,

    showMatchReady,

    showCancel: showWaiting,

    poll,

    source: decision.source,

  };

}
