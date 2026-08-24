/**
 * Online gameplay request handler.
 * Used by the Edge Function (Supabase store) and in-process tests (memory store).
 * JWT identity is supplied as userId; this module never trusts client seed / draw tile ids.
 */

import {
  ONLINE_ACTION_ADVANCE_ROUND,
  ONLINE_ACTION_DRAW,
  ONLINE_ACTION_PASS,
  ONLINE_ACTION_PLAY,
  GameplayError,
  applyOnlineAction,
  createServerSeed,
  dealOnlineGame,
  isOnlineRulesetId,
  matchStatusForEngine,
  projectGameView,
  projectPublicSession,
  seatForUser,
} from "./gameAuthority.js";

const PLAY_DRAW_PASS = new Set([ONLINE_ACTION_PLAY, ONLINE_ACTION_DRAW, ONLINE_ACTION_PASS]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function requireUser(userId) {
  if (!userId || typeof userId !== "string") {
    throw new GameplayError("AUTH_REQUIRED", "Authentication required");
  }
}

function requireParticipant(match, userId) {
  const seat = seatForUser(match, userId);
  if (seat == null) {
    throw new GameplayError("NOT_A_PLAYER", "Only seated players may access this match");
  }
  return seat;
}

function assertMatchEligible(match) {
  if (!match) {
    throw new GameplayError("MATCH_NOT_FOUND", "Match not found");
  }
  if (!isOnlineRulesetId(match.ruleset_id)) {
    throw new GameplayError("UNSUPPORTED_RULESET", "Match ruleset is not enabled for online play");
  }
  if (match.status === "finished" || match.status === "aborted") {
    throw new GameplayError("MATCH_NOT_ELIGIBLE", "Match is not eligible for online play");
  }
  if (match.status !== "ready" && match.status !== "playing") {
    throw new GameplayError("MATCH_NOT_ELIGIBLE", "Match is not eligible for online play");
  }
  if (!match.player_a || !match.player_b) {
    throw new GameplayError("MATCH_NOT_ELIGIBLE", "Match seats are not filled");
  }
}

function viewFromSecret(secret, matchId, version, viewerSeat) {
  return projectGameView(secret.engineState, { matchId, version, viewerSeat });
}

/**
 * In-memory store for contract tests (CAS via expected version).
 */
export function createMemoryGameStore(seedMatches = []) {
  const matches = new Map(seedMatches.map((row) => [row.id, clone(row)]));
  const sessions = new Map();
  const secrets = new Map();
  const actions = [];
  let yieldOnCommit = false;

  return {
    enableCommitYield() {
      yieldOnCommit = true;
    },
    matches,
    sessions,
    secrets,
    actions,
    async loadMatch(matchId) {
      return clone(matches.get(matchId) ?? null);
    },
    async loadSession(matchId) {
      return clone(sessions.get(matchId) ?? null);
    },
    async loadSecret(matchId) {
      return clone(secrets.get(matchId) ?? null);
    },
    async installGame({ matchId, rulesetId, publicRow, engineState, seed, matchStatus }) {
      if (sessions.has(matchId)) {
        return { created: false, version: sessions.get(matchId).version };
      }
      sessions.set(matchId, clone({ matchId, rulesetId, ...publicRow }));
      secrets.set(matchId, clone({ matchId, engineState, seed }));
      if (matchStatus) {
        const match = matches.get(matchId);
        if (match) match.status = matchStatus;
      }
      return { created: true, version: publicRow.version ?? 0 };
    },
    async commitTransition({
      matchId,
      expectedVersion,
      publicRow,
      engineState,
      action,
      matchStatus,
    }) {
      const session = sessions.get(matchId);
      if (!session || session.version !== expectedVersion) {
        throw new GameplayError("STALE_VERSION", "expected_version does not match");
      }
      if (yieldOnCommit) {
        await Promise.resolve();
      }
      const again = sessions.get(matchId);
      if (!again || again.version !== expectedVersion) {
        throw new GameplayError("STALE_VERSION", "expected_version does not match");
      }
      const nextVersion = expectedVersion + 1;
      sessions.set(matchId, clone({ ...again, ...publicRow, matchId, version: nextVersion }));
      secrets.set(matchId, clone({ matchId, engineState, seed: secrets.get(matchId)?.seed }));
      actions.push(
        clone({
          matchId,
          version: nextVersion,
          actorId: action.actorId,
          seat: action.seat,
          actionType: action.actionType,
          payload: action.payload ?? {},
        })
      );
      if (matchStatus) {
        const match = matches.get(matchId);
        if (match) match.status = matchStatus;
      }
      return { version: nextVersion };
    },
  };
}

export async function handleEnterOnlineMatch({ userId, matchId, body, store, createSeed }) {
  requireUser(userId);
  if (!matchId) throw new GameplayError("MATCH_REQUIRED", "match_id required");
  void body;
  const match = await store.loadMatch(matchId);
  assertMatchEligible(match);
  const seat = requireParticipant(match, userId);

  const existing = await store.loadSession(matchId);
  if (existing) {
    const secret = await store.loadSecret(matchId);
    return viewFromSecret(secret, matchId, existing.version, seat);
  }

  const makeSeed = createSeed ?? createServerSeed;
  const { state, seed } = dealOnlineGame({
    rulesetId: match.ruleset_id,
    playerAId: match.player_a,
    playerBId: match.player_b,
    seed: makeSeed(),
  });
  const publicRow = projectPublicSession(state, { version: 0 });
  const installed = await store.installGame({
    matchId,
    rulesetId: match.ruleset_id,
    publicRow,
    engineState: state,
    seed,
    matchStatus: "playing",
  });
  if (!installed.created) {
    const session = await store.loadSession(matchId);
    const secret = await store.loadSecret(matchId);
    return viewFromSecret(secret, matchId, session.version, seat);
  }
  return projectGameView(state, { matchId, version: 0, viewerSeat: seat });
}

export async function handleGetGameView({ userId, matchId, store }) {
  requireUser(userId);
  if (!matchId) throw new GameplayError("MATCH_REQUIRED", "match_id required");
  const match = await store.loadMatch(matchId);
  if (!match) throw new GameplayError("MATCH_NOT_FOUND", "Match not found");
  const seat = requireParticipant(match, userId);
  const session = await store.loadSession(matchId);
  if (!session) throw new GameplayError("NO_SESSION", "Game session has not been created");
  const secret = await store.loadSecret(matchId);
  return viewFromSecret(secret, matchId, session.version, seat);
}

async function applyAndCommit({ userId, matchId, expectedVersion, action, store, allowedTypes }) {
  requireUser(userId);
  if (!matchId) throw new GameplayError("MATCH_REQUIRED", "match_id required");
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    throw new GameplayError("VERSION_REQUIRED", "expected_version required");
  }
  const match = await store.loadMatch(matchId);
  assertMatchEligible(match);
  const seat = requireParticipant(match, userId);
  const session = await store.loadSession(matchId);
  const secret = await store.loadSecret(matchId);
  if (!session || !secret) {
    throw new GameplayError("NO_SESSION", "Game session has not been created");
  }
  if (session.version !== expectedVersion) {
    throw new GameplayError("STALE_VERSION", "expected_version does not match");
  }
  const type = action?.type;
  if (!allowedTypes.has(type)) {
    throw new GameplayError("UNKNOWN_ACTION", "Unsupported action type");
  }
  const applied = applyOnlineAction(secret.engineState, { seat, action });
  const nextVersion = expectedVersion + 1;
  const publicRow = projectPublicSession(applied.state, { version: nextVersion });
  await store.commitTransition({
    matchId,
    expectedVersion,
    publicRow,
    engineState: applied.state,
    action: {
      actorId: userId,
      seat,
      actionType: applied.actionType,
      payload: applied.safePayload,
    },
    matchStatus: matchStatusForEngine(applied.state),
  });
  return projectGameView(applied.state, { matchId, version: nextVersion, viewerSeat: seat });
}

export async function handleSubmitGameAction({ userId, matchId, expectedVersion, action, store }) {
  return applyAndCommit({
    userId,
    matchId,
    expectedVersion,
    action,
    store,
    allowedTypes: PLAY_DRAW_PASS,
  });
}

export async function handleAdvanceOnlineRound({ userId, matchId, expectedVersion, store }) {
  return applyAndCommit({
    userId,
    matchId,
    expectedVersion,
    action: { type: ONLINE_ACTION_ADVANCE_ROUND },
    store,
    allowedTypes: new Set([ONLINE_ACTION_ADVANCE_ROUND]),
  });
}

export async function handleOnlineGameRequest(op, payload, ctx) {
  if (op === "enter_online_match") {
    return handleEnterOnlineMatch({ ...ctx, ...payload, body: payload });
  }
  if (op === "get_game_view") {
    return handleGetGameView({ ...ctx, ...payload });
  }
  if (op === "submit_game_action") {
    return handleSubmitGameAction({ ...ctx, ...payload });
  }
  if (op === "advance_online_round") {
    return handleAdvanceOnlineRound({ ...ctx, ...payload });
  }
  throw new GameplayError("UNKNOWN_OP", "Unknown gameplay operation");
}
