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
  ONLINE_ACTION_TIMEOUT,
  GameplayError,
  applyOnlineAction,
  applyTimeoutResolution,
  createServerSeed,
  dealOnlineGame,
  isOnlineRulesetId,
  matchStatusForEngine,
  projectGameView,
  projectPublicSession,
  seatForUser,
  PHASE,
} from "./gameAuthority.js";
import {
  TURN_TIMEOUT_MS,
  isTurnDeadlineExpired,
  normalizeTimeoutStrikes,
  stampDeadlineReceipt,
} from "./turnTimeout.js";

const PLAY_DRAW_PASS = new Set([ONLINE_ACTION_PLAY, ONLINE_ACTION_DRAW, ONLINE_ACTION_PASS]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function timeoutFields(session) {
  return {
    turnDeadlineAt: session?.turnDeadlineAt ?? session?.turn_deadline_at ?? null,
    timeoutStrikes: normalizeTimeoutStrikes(session?.timeoutStrikes ?? session?.timeout_strikes),
    currentSeat: session?.currentSeat ?? session?.current_seat ?? null,
    phase: session?.phase ?? null,
  };
}

function decorateView(view, session, extras = {}) {
  const fields = timeoutFields(session);
  const serverNow = extras.serverNow ?? new Date().toISOString();
  return stampDeadlineReceipt(
    {
      ...view,
      turnDeadlineAt: extras.turnDeadlineAt ?? fields.turnDeadlineAt,
      timeoutStrikes: extras.timeoutStrikes ?? fields.timeoutStrikes,
    },
    { serverNow }
  );
}

function sessionDeadlineExpired(session, nowMs = Date.now()) {
  const fields = timeoutFields(session);
  return isTurnDeadlineExpired(
    {
      phase: fields.phase === PHASE.PLAYING || fields.phase === "playing" ? "playing" : fields.phase,
      turnDeadlineAt: fields.turnDeadlineAt,
      serverNow: new Date(nowMs).toISOString(),
      deadlineReceivedAt: new Date(nowMs).toISOString(),
    },
    nowMs
  );
}

function nextTurnDeadline(session, publicRow) {
  if (publicRow?.phase && publicRow.phase !== PHASE.PLAYING) return null;
  if (publicRow?.status === "round_over" || publicRow?.status === "match_over") return null;
  if (publicRow?.resetTurnDeadline === true) {
    return new Date(Date.now() + TURN_TIMEOUT_MS).toISOString();
  }
  const prevSeat = timeoutFields(session).currentSeat;
  if (prevSeat != null && publicRow?.currentSeat != null && prevSeat !== publicRow.currentSeat) {
    return new Date(Date.now() + TURN_TIMEOUT_MS).toISOString();
  }
  const prevPhase = timeoutFields(session).phase;
  if (prevPhase && prevPhase !== PHASE.PLAYING && publicRow?.phase === PHASE.PLAYING) {
    return new Date(Date.now() + TURN_TIMEOUT_MS).toISOString();
  }
  return timeoutFields(session).turnDeadlineAt ?? new Date(Date.now() + TURN_TIMEOUT_MS).toISOString();
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

function viewFromSecret(secret, matchId, session, viewerSeat) {
  const view = projectGameView(secret.engineState, {
    matchId,
    version: session.version,
    viewerSeat,
  });
  return decorateView(view, session);
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
      const installed = clone({
        matchId,
        rulesetId,
        ...publicRow,
        turnDeadlineAt:
          publicRow.turnDeadlineAt ?? new Date(Date.now() + TURN_TIMEOUT_MS).toISOString(),
        timeoutStrikes: normalizeTimeoutStrikes(publicRow.timeoutStrikes),
      });
      sessions.set(matchId, installed);
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
      if (action?.actionType === ONLINE_ACTION_TIMEOUT) {
        if (!sessionDeadlineExpired(again)) {
          throw new GameplayError("TIMEOUT_NOT_DUE", "timeout not due");
        }
      }
      const nextVersion = expectedVersion + 1;
      const turnDeadlineAt = nextTurnDeadline(again, publicRow);
      const timeoutStrikes = normalizeTimeoutStrikes(
        publicRow.timeoutStrikes ?? again.timeoutStrikes
      );
      sessions.set(
        matchId,
        clone({
          ...again,
          ...publicRow,
          matchId,
          version: nextVersion,
          turnDeadlineAt,
          timeoutStrikes,
        })
      );
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
        if (match) {
          match.status = matchStatus;
          if (matchStatus === "finished" && action?.finishReason && !match.finish_reason) {
            match.finish_reason = action.finishReason;
          }
        }
      }
      return { version: nextVersion, turnDeadlineAt, timeoutStrikes };
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
    return viewFromSecret(secret, matchId, existing, seat);
  }

  const makeSeed = createSeed ?? createServerSeed;
  const { state, seed } = dealOnlineGame({
    rulesetId: match.ruleset_id,
    playerAId: match.player_a,
    playerBId: match.player_b,
    seed: makeSeed(),
  });
  const publicRow = projectPublicSession(state, { version: 0 });
  publicRow.turnDeadlineAt = new Date(Date.now() + TURN_TIMEOUT_MS).toISOString();
  publicRow.timeoutStrikes = [0, 0];
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
    return viewFromSecret(secret, matchId, session, seat);
  }
  return decorateView(projectGameView(state, { matchId, version: 0, viewerSeat: seat }), {
    ...publicRow,
    version: 0,
  });
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
  return viewFromSecret(secret, matchId, session, seat);
}

async function commitApplied({
  userId,
  matchId,
  expectedVersion,
  seat,
  session,
  applied,
  store,
  trace,
  edgeStarted,
  finishReason = null,
}) {
  const validatedAt = Date.now();
  const nextVersion = expectedVersion + 1;
  const publicRow = projectPublicSession(applied.state, {
    version: nextVersion,
    timeoutStrikes: applied.timeoutStrikes ?? timeoutFields(session).timeoutStrikes,
    resetTurnDeadline: applied.resetTurnDeadline === true,
  });
  if (finishReason) publicRow.finishReason = finishReason;
  const committed = await store.commitTransition({
    matchId,
    expectedVersion,
    publicRow,
    engineState: applied.state,
    action: {
      actorId: userId,
      seat: applied.safePayload?.timedOutSeat ?? seat,
      actionType: applied.actionType,
      payload: applied.safePayload,
      finishReason,
    },
    matchStatus: matchStatusForEngine(applied.state),
    finishReason,
  });
  const committedAt = Date.now();
  const view = decorateView(
    projectGameView(applied.state, { matchId, version: nextVersion, viewerSeat: seat }),
    {
      ...session,
      ...publicRow,
      version: nextVersion,
      turnDeadlineAt: committed?.turnDeadlineAt,
      timeoutStrikes: committed?.timeoutStrikes ?? publicRow.timeoutStrikes,
    }
  );
  if (trace) {
    view._timings = {
      edgeReceivedToValidatedMs: validatedAt - edgeStarted,
      edgeValidatedToCommitMs: committedAt - validatedAt,
      edgeCommitToReturnMs: Date.now() - committedAt,
      edgeTotalMs: Date.now() - edgeStarted,
    };
  }
  return view;
}

async function applyTimeoutAndCommit({ userId, matchId, expectedVersion, store, trace }) {
  const edgeStarted = Date.now();
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
  if (secret.engineState?.phase === PHASE.MATCH_OVER || session.status === "match_over") {
    throw new GameplayError("MATCH_NOT_ELIGIBLE", "Match is not eligible for online play");
  }
  if (!sessionDeadlineExpired(session)) {
    throw new GameplayError("TIMEOUT_NOT_DUE", "timeout not due");
  }
  const applied = applyTimeoutResolution(secret.engineState, {
    timeoutStrikes: timeoutFields(session).timeoutStrikes,
  });
  if (applied.idempotent) {
    return viewFromSecret(secret, matchId, session, seat);
  }
  return commitApplied({
    userId,
    matchId,
    expectedVersion,
    seat,
    session,
    applied,
    store,
    trace,
    edgeStarted,
    finishReason: applied.finishReason,
  });
}

async function applyAndCommit({ userId, matchId, expectedVersion, action, store, allowedTypes, trace }) {
  const edgeStarted = Date.now();
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
  if (sessionDeadlineExpired(session)) {
    return applyTimeoutAndCommit({ userId, matchId, expectedVersion, store, trace });
  }
  const type = action?.type;
  if (!allowedTypes.has(type)) {
    throw new GameplayError("UNKNOWN_ACTION", "Unsupported action type");
  }
  const applied = applyOnlineAction(secret.engineState, { seat, action });
  applied.timeoutStrikes = timeoutFields(session).timeoutStrikes;
  applied.resetTurnDeadline = false;
  return commitApplied({
    userId,
    matchId,
    expectedVersion,
    seat,
    session,
    applied,
    store,
    trace,
    edgeStarted,
    finishReason: null,
  });
}

export async function handleSubmitGameAction({ userId, matchId, expectedVersion, action, store, trace }) {
  return applyAndCommit({
    userId,
    matchId,
    expectedVersion,
    action,
    store,
    allowedTypes: PLAY_DRAW_PASS,
    trace,
  });
}

export async function handleAdvanceOnlineRound({ userId, matchId, expectedVersion, store, trace }) {
  return applyAndCommit({
    userId,
    matchId,
    expectedVersion,
    action: { type: ONLINE_ACTION_ADVANCE_ROUND },
    store,
    allowedTypes: new Set([ONLINE_ACTION_ADVANCE_ROUND]),
    trace,
  });
}

export async function handleResolveTurnTimeout({ userId, matchId, expectedVersion, store, trace }) {
  return applyTimeoutAndCommit({ userId, matchId, expectedVersion, store, trace });
}

export async function handleOnlineGameRequest(op, payload, ctx) {
  if (op === "enter_online_match") {
    return handleEnterOnlineMatch({ ...ctx, ...payload, body: payload });
  }
  if (op === "get_game_view") {
    return handleGetGameView({ ...ctx, ...payload });
  }
  if (op === "submit_game_action") {
    return handleSubmitGameAction({ ...ctx, ...payload, trace: Boolean(payload?.trace) });
  }
  if (op === "advance_online_round") {
    return handleAdvanceOnlineRound({ ...ctx, ...payload, trace: Boolean(payload?.trace) });
  }
  if (op === "resolve_turn_timeout") {
    return handleResolveTurnTimeout({ ...ctx, ...payload, trace: Boolean(payload?.trace) });
  }
  throw new GameplayError("UNKNOWN_OP", "Unknown gameplay operation");
}
