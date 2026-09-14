/**
 * Ranked Find Match pair limit — 3 public rated games per unordered pair
 * in a rolling 24-hour window. Mirrors the SQL contract. No network.
 */

export const RANKED_FIND_MATCH_PAIR_LIMIT = 3;
export const RANKED_FIND_MATCH_PAIR_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Canonical unordered pair. A vs B === B vs A. Independent of host/creator order.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {[string, string]|null}
 */
export function normalizePlayerPair(a, b) {
  const left = typeof a === "string" ? a : a == null ? "" : String(a);
  const right = typeof b === "string" ? b : b == null ? "" : String(b);
  if (!left || !right || left === right) return null;
  return left < right ? [left, right] : [right, left];
}

/**
 * @param {{ playerA?: string, playerB?: string, player_a?: string, player_b?: string }} match
 * @param {string} a
 * @param {string} b
 */
export function matchSeatsArePair(match, a, b) {
  const pair = normalizePlayerPair(a, b);
  const seated = normalizePlayerPair(
    match?.playerA ?? match?.player_a,
    match?.playerB ?? match?.player_b
  );
  return Boolean(pair && seated && pair[0] === seated[0] && pair[1] === seated[1]);
}

/**
 * Server-side qualifying match. Client helper is for tests / list skip only.
 * @param {object} match
 * @param {number} [nowMs]
 */
export function isQualifyingRankedFindMatch(match, nowMs = Date.now()) {
  if (!match) return false;
  const rated = match.rated === true;
  const kind = match.matchKind ?? match.match_kind;
  if (!rated || kind !== "public") return false;
  const createdAt = match.createdAt ?? match.created_at;
  if (!createdAt) return false;
  const started = Date.parse(createdAt);
  if (!Number.isFinite(started)) return false;
  return started >= nowMs - RANKED_FIND_MATCH_PAIR_WINDOW_MS;
}

/**
 * @param {object[]} matches
 * @param {string} a
 * @param {string} b
 * @param {number} [nowMs]
 */
export function countQualifyingRankedPairMatches(matches, a, b, nowMs = Date.now()) {
  if (!Array.isArray(matches) || !normalizePlayerPair(a, b)) return 0;
  let n = 0;
  for (const match of matches) {
    if (!matchSeatsArePair(match, a, b)) continue;
    if (isQualifyingRankedFindMatch(match, nowMs)) n += 1;
  }
  return n;
}

/**
 * @param {number} count
 */
export function rankedFindMatchPairLimitReached(count) {
  return Number(count) >= RANKED_FIND_MATCH_PAIR_LIMIT;
}

/**
 * @param {string} playerId
 * @param {string} opponentId
 * @param {Iterable<string>|Set<string>} [blockedOpponentIds]
 */
export function isRankedPairBlockedOpponent(playerId, opponentId, blockedOpponentIds) {
  if (!playerId || !opponentId || playerId === opponentId) return false;
  const blocked =
    blockedOpponentIds instanceof Set ? blockedOpponentIds : new Set(blockedOpponentIds || []);
  return blocked.has(opponentId);
}

/**
 * Skip pair-blocked public requests; keep scanning for another eligible opponent.
 * Own requests are not accept targets and are left to the caller.
 *
 * @param {Array<object|null|undefined>} requests
 * @param {string} playerId
 * @param {(request: object, playerId: string) => boolean} canAccept
 * @param {Iterable<string>|Set<string>} [blockedOpponentIds]
 */
export function nextJoinableOpenRequest(requests, playerId, canAccept, blockedOpponentIds) {
  if (!playerId || !Array.isArray(requests)) return null;
  for (const request of requests) {
    if (!request) continue;
    if (isRankedPairBlockedOpponent(playerId, request.creatorId, blockedOpponentIds)) continue;
    if (canAccept(request, playerId)) return request;
  }
  return null;
}

/**
 * @param {Array<object|null|undefined>} requests
 * @param {string} playerId
 * @param {Iterable<string>|Set<string>} [blockedOpponentIds]
 */
export function excludeRankedPairBlockedRequests(requests, playerId, blockedOpponentIds) {
  if (!Array.isArray(requests)) return [];
  return requests.filter((request) => {
    if (!request) return false;
    if (request.creatorId === playerId) return true;
    return !isRankedPairBlockedOpponent(playerId, request.creatorId, blockedOpponentIds);
  });
}
