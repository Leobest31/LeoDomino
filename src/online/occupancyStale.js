/**
 * Occupancy stale-classification decision table (C2).
 *
 * SQL twin: public._occupancy_presence_action
 * Used by cleanup_stale_occupied_matches and touch_my_match_presence.
 *
 * Classification uses one pre-mutation snapshot of both occupied
 * last_seen_at values. A reconnecting player's heartbeat must not
 * stamp last_seen_at before that snapshot is classified, or a shared
 * outage becomes a one-sided forfeit.
 */

export const PRESENCE_GRACE_MS = 5 * 60 * 1000;

export const LIVE_MATCH_STATUSES = new Set(["ready", "playing"]);

export const TERMINAL_MATCH_STATUSES = new Set([
  "finished",
  "aborted",
  "completed",
  "forfeited",
  "timed_out",
  "timeout",
  "join_timeout",
  "match_over",
]);

export function isPresenceStale(lastSeenAt, now, graceMs = PRESENCE_GRACE_MS) {
  if (lastSeenAt == null) return true;
  return lastSeenAt < now - graceMs;
}

export function isTerminalMatch(status, finishReason) {
  if (status == null) return true;
  if (!LIVE_MATCH_STATUSES.has(status)) return true;
  if (finishReason && TERMINAL_MATCH_STATUSES.has(finishReason)) return true;
  return false;
}

/**
 * Authoritative classifier. `seenA`/`seenB`/`joinedA`/`joinedB` must be
 * a single snapshot taken before any last_seen mutation.
 *
 * @returns {{
 *   kind: 'none' | 'abort' | 'forfeit',
 *   reason: string,
 *   winner: 'a' | 'b' | null,
 *   loser: 'a' | 'b' | null,
 *   settleRp: boolean,
 *   action: 'none' | 'abort' | 'forfeit_a' | 'forfeit_b'
 * }}
 */
export function classifyOccupiedPresence({
  status,
  finishReason = null,
  seenA,
  seenB,
  joinedA,
  joinedB,
  now,
  graceMs = PRESENCE_GRACE_MS,
}) {
  if (isTerminalMatch(status, finishReason)) {
    return {
      kind: "none",
      reason: "terminal",
      winner: null,
      loser: null,
      settleRp: false,
      action: "none",
    };
  }

  if (joinedA == null || joinedB == null) {
    return {
      kind: "none",
      reason: "join_waiting",
      winner: null,
      loser: null,
      settleRp: false,
      action: "none",
    };
  }

  if (seenA == null && seenB == null) {
    return {
      kind: "none",
      reason: "uninitialized",
      winner: null,
      loser: null,
      settleRp: false,
      action: "none",
    };
  }

  const staleA = isPresenceStale(seenA, now, graceMs);
  const staleB = isPresenceStale(seenB, now, graceMs);

  if (!staleA && !staleB) {
    return {
      kind: "none",
      reason: "neither_stale",
      winner: null,
      loser: null,
      settleRp: false,
      action: "none",
    };
  }

  if (staleA && staleB) {
    return {
      kind: "abort",
      reason: "both_stale",
      winner: null,
      loser: null,
      settleRp: false,
      action: "abort",
    };
  }

  if (staleA) {
    return {
      kind: "forfeit",
      reason: "one_stale",
      winner: "b",
      loser: "a",
      settleRp: true,
      action: "forfeit_a",
    };
  }

  return {
    kind: "forfeit",
    reason: "one_stale",
    winner: "a",
    loser: "b",
    settleRp: true,
    action: "forfeit_b",
  };
}

export function snapshotOccupancy(match) {
  return {
    status: match.status,
    finishReason: match.finishReason ?? null,
    seenA: match.occupancy?.a?.lastSeenAt ?? null,
    seenB: match.occupancy?.b?.lastSeenAt ?? null,
    joinedA: match.occupancy?.a?.joinedAt ?? null,
    joinedB: match.occupancy?.b?.joinedAt ?? null,
  };
}

export function applyOccupancyDecision(match, decision) {
  if (decision.kind === "none") {
    return {
      ...match,
      rpSettled: match.rpSettled === true,
      rpLedger: match.rpLedger ?? null,
    };
  }

  if (isTerminalMatch(match.status, match.finishReason)) {
    return match;
  }

  if (decision.kind === "abort") {
    return {
      ...match,
      status: "aborted",
      finishReason: match.finishReason ?? "aborted",
      winner: null,
      loser: null,
      occupancy: {},
      rpSettled: false,
      rpLedger: null,
      ratingsChanged: false,
    };
  }

  return {
    ...match,
    status: "finished",
    finishReason: "forfeit",
    winner: decision.winner,
    loser: decision.loser,
    occupancy: {},
    rpSettled: true,
    rpLedger: {
      winner: decision.winner,
      loser: decision.loser,
      reason: "forfeit",
    },
    ratingsChanged: match.rated !== false,
  };
}

/**
 * Heartbeat: classify the pre-stamp snapshot, apply abort/forfeit, THEN
 * stamp the caller's last_seen_at if occupancy still exists.
 */
export function touchMatchPresence(match, caller, now, graceMs = PRESENCE_GRACE_MS) {
  const snapshot = snapshotOccupancy(match);
  const decision = classifyOccupiedPresence({ ...snapshot, now, graceMs });
  let next = applyOccupancyDecision(match, decision);
  const seat = next.occupancy?.[caller];
  if (seat) {
    next = {
      ...next,
      occupancy: {
        ...next.occupancy,
        [caller]: {
          ...seat,
          lastSeenAt: now,
          joinedAt: seat.joinedAt ?? now,
        },
      },
    };
  }
  return { match: next, decision, snapshot };
}

export function cleanupOccupiedMatch(match, now, graceMs = PRESENCE_GRACE_MS) {
  const snapshot = snapshotOccupancy(match);
  const decision = classifyOccupiedPresence({ ...snapshot, now, graceMs });
  return { match: applyOccupancyDecision(match, decision), decision, snapshot };
}

/**
 * Old (buggy) heartbeat: stamp the caller first, then classify.
 * Kept only so tests prove C2 does not regress to this order.
 */
export function touchMatchPresenceStampFirst(match, caller, now, graceMs = PRESENCE_GRACE_MS) {
  const stamped = {
    ...match,
    occupancy: {
      ...match.occupancy,
      [caller]: {
        ...match.occupancy[caller],
        lastSeenAt: now,
        joinedAt: match.occupancy[caller]?.joinedAt ?? now,
      },
    },
  };
  return cleanupOccupiedMatch(stamped, now, graceMs);
}

export function cloneMatch(match) {
  return structuredClone(match);
}

export function occupiedMatch({
  seenA,
  seenB,
  joinedA,
  joinedB,
  status = "playing",
  finishReason = null,
  rated = true,
} = {}) {
  return {
    status,
    finishReason,
    rated,
    winner: null,
    loser: null,
    occupancy: {
      a: { lastSeenAt: seenA, joinedAt: joinedA },
      b: { lastSeenAt: seenB, joinedAt: joinedB },
    },
    rpSettled: false,
    rpLedger: null,
    ratingsChanged: false,
  };
}

export function runPresenceOps(match, now, ops, graceMs = PRESENCE_GRACE_MS) {
  let current = cloneMatch(match);
  const decisions = [];
  for (const op of ops) {
    if (op === "cleanup") {
      const result = cleanupOccupiedMatch(current, now, graceMs);
      current = result.match;
      decisions.push({ op, ...result.decision });
    } else if (op === "touch:a" || op === "touch:b") {
      const caller = op === "touch:a" ? "a" : "b";
      const result = touchMatchPresence(current, caller, now, graceMs);
      current = result.match;
      decisions.push({ op, ...result.decision });
    } else {
      throw new Error(`unknown presence op: ${op}`);
    }
  }
  return { match: current, decisions };
}
