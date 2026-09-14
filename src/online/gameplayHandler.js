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
import { onlineActionDiag } from "./onlineActionDiag.js";

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

/**
 * Mirrors commit_online_game_transition: only the re-arm branch (seat
 * change / phase entering playing / explicit reset) is gated on both seats
 * having joined. Carrying forward the existing deadline (null or set) is
 * otherwise untouched, so a reconnect / unrelated commit can never reset or
 * duplicate a valid timer, and never invents one out of a legitimately null
 * pre-both-join deadline.
 */
function nextTurnDeadline(session, publicRow, ready) {
  if (publicRow?.phase && publicRow.phase !== PHASE.PLAYING) return null;
  if (publicRow?.status === "round_over" || publicRow?.status === "match_over") return null;
  const prevSeat = timeoutFields(session).currentSeat;
  const seatChanged =
    prevSeat != null && publicRow?.currentSeat != null && prevSeat !== publicRow.currentSeat;
  const prevPhase = timeoutFields(session).phase;
  const enteringPlaying = prevPhase && prevPhase !== PHASE.PLAYING && publicRow?.phase === PHASE.PLAYING;
  const rearm = publicRow?.resetTurnDeadline === true || seatChanged || enteringPlaying;
  if (rearm) {
    return ready ? new Date(Date.now() + TURN_TIMEOUT_MS).toISOString() : null;
  }
  return timeoutFields(session).turnDeadlineAt ?? null;
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

function isSessionTerminal(match, session, secret) {
  return (
    match?.status === "finished" ||
    match?.status === "aborted" ||
    session?.status === "match_over" ||
    secret?.engineState?.phase === PHASE.MATCH_OVER
  );
}

/**
 * Server-authoritative due-timeout recovery.
 * Hydrate / re-enter share applyTimeoutAndCommit with resolve_turn_timeout and
 * submit_game_action. One CAS winner writes the timeout; LeoPips -5 is applied
 * once by _leopips_commit_online_game_transition (idempotency_key per strike).
 * STALE_VERSION / TIMEOUT_NOT_DUE mean another actor already resolved it.
 */
async function expireDueTimeoutIfNeeded({ userId, matchId, store, seat }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const match = await store.loadMatch(matchId);
    const session = await store.loadSession(matchId);
    const secret = await store.loadSecret(matchId);
    if (!session) {
      throw new GameplayError("NO_SESSION", "Game session has not been created");
    }
    if (!secret || isSessionTerminal(match, session, secret) || !sessionDeadlineExpired(session)) {
      return viewFromSecret(secret, matchId, session, seat);
    }
    try {
      return await applyTimeoutAndCommit({
        userId,
        matchId,
        expectedVersion: session.version,
        store,
      });
    } catch (error) {
      const code = error?.code;
      if (code === "STALE_VERSION" || code === "TIMEOUT_NOT_DUE") {
        continue;
      }
      if (code === "MATCH_NOT_ELIGIBLE" || code === "ROUND_NOT_ACTIVE") {
        const latestSession = await store.loadSession(matchId);
        const latestSecret = await store.loadSecret(matchId);
        if (!latestSession) throw error;
        return viewFromSecret(latestSecret, matchId, latestSession, seat);
      }
      throw error;
    }
  }
  const session = await store.loadSession(matchId);
  const secret = await store.loadSecret(matchId);
  if (!session) {
    throw new GameplayError("NO_SESSION", "Game session has not been created");
  }
  return viewFromSecret(secret, matchId, session, seat);
}

/**
 * In-memory store for contract tests (CAS via expected version).
 */
export function createMemoryGameStore(seedMatches = []) {
  const matches = new Map(seedMatches.map((row) => [row.id, clone(row)]));
  const sessions = new Map();
  const secrets = new Map();
  const actions = [];
  const joinedPlayers = new Map();
  let yieldOnCommit = false;

  // Every pre-existing test in this codebase seeds a match and expects
  // gameplay to already be fully live (it is testing mechanics, not the
  // join race). Default to "both seats already joined" for every seeded
  // match so that behavior — the overwhelming common case — needs no
  // per-test changes. A test that specifically wants to exercise the
  // pre-both-join waiting state seeds the match with `pendingJoin: true`
  // and calls store.touchPresence(...) itself to simulate each seat
  // entering, exactly as the real client's boot() does.
  for (const row of seedMatches) {
    if (row.pendingJoin === true) continue;
    const joined = new Set();
    if (row.player_a) joined.add(row.player_a);
    if (row.player_b) joined.add(row.player_b);
    joinedPlayers.set(row.id, joined);
  }

  // Mirrors SQL _online_turn_timer_ready: true only once both seats have
  // touched presence at least once. Occupancy is a live table in Postgres;
  // here it is a plain per-match Set of joined userIds.
  function isTurnTimerReady(matchId) {
    const match = matches.get(matchId);
    if (!match) return false;
    const joined = joinedPlayers.get(matchId);
    if (!joined) return false;
    return joined.has(match.player_a) && joined.has(match.player_b);
  }

  return {
    enableCommitYield() {
      yieldOnCommit = true;
    },
    matches,
    sessions,
    secrets,
    actions,
    joinedPlayers,
    isTurnTimerReady,
    // Mirrors touch_my_match_presence: first touch stamps "joined", then
    // opportunistically arms turn_deadline_at exactly once (idempotent via
    // the turnDeadlineAt-is-null guard) once both seats have joined.
    async touchPresence(matchId, userId) {
      if (!matchId || !userId) return { ok: false, touched: false };
      let joined = joinedPlayers.get(matchId);
      if (!joined) {
        joined = new Set();
        joinedPlayers.set(matchId, joined);
      }
      const alreadyJoined = joined.has(userId);
      joined.add(userId);
      const session = sessions.get(matchId);
      if (
        session &&
        session.status === "playing" &&
        session.phase === PHASE.PLAYING &&
        !session.turnDeadlineAt &&
        isTurnTimerReady(matchId)
      ) {
        session.turnDeadlineAt = new Date(Date.now() + TURN_TIMEOUT_MS).toISOString();
      }
      return { ok: true, touched: !alreadyJoined, joined: true };
    },
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
      const ready =
        (publicRow.status ?? "playing") === "playing" &&
        (publicRow.phase ?? "playing") === PHASE.PLAYING &&
        isTurnTimerReady(matchId);
      const installed = clone({
        matchId,
        rulesetId,
        ...publicRow,
        turnDeadlineAt: ready ? new Date(Date.now() + TURN_TIMEOUT_MS).toISOString() : null,
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
      const turnDeadlineAt = nextTurnDeadline(again, publicRow, isTurnTimerReady(matchId));
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
    async listDueTimeoutMatches(limit = TIMEOUT_SWEEP_SCAN) {
      const safeLimit = Math.min(Math.max(Number(limit) || TIMEOUT_SWEEP_SCAN, 1), TIMEOUT_SWEEP_SCAN);
      const now = Date.now();
      const due = [];
      for (const [matchId, session] of sessions) {
        const match = matches.get(matchId);
        if (!match || match.status !== "playing") continue;
        if (!match.player_a || !match.player_b) continue;
        if (session.status !== "playing" || session.phase !== PHASE.PLAYING) continue;
        if (!session.turnDeadlineAt) continue;
        const dueAt = Date.parse(session.turnDeadlineAt);
        if (!Number.isFinite(dueAt) || dueAt > now) continue;
        due.push({
          match_id: matchId,
          version: session.version,
          turn_deadline_at: session.turnDeadlineAt,
          // Memory store has no active_match_players; SQL reports 0–2 informationally.
          occupancy_seats: 0,
        });
      }
      due.sort((left, right) => Date.parse(left.turn_deadline_at) - Date.parse(right.turn_deadline_at));
      return due.slice(0, safeLimit);
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
    return expireDueTimeoutIfNeeded({ userId, matchId, store, seat });
  }

  const makeSeed = createSeed ?? createServerSeed;
  const { state, seed } = dealOnlineGame({
    rulesetId: match.ruleset_id,
    playerAId: match.player_a,
    playerBId: match.player_b,
    seed: makeSeed(),
  });
  const publicRow = projectPublicSession(state, { version: 0 });
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
    return expireDueTimeoutIfNeeded({ userId, matchId, store, seat });
  }
  // The deadline (armed or still null pre-both-join) is decided authoritatively
  // by installGame, never by this pre-install hint. Read it back so the view
  // handed to the entering client cannot show a countdown that never armed.
  const installedSession = await store.loadSession(matchId);
  return decorateView(
    projectGameView(state, { matchId, version: 0, viewerSeat: seat }),
    installedSession
  );
}

export async function handleGetGameView({ userId, matchId, store }) {
  requireUser(userId);
  if (!matchId) throw new GameplayError("MATCH_REQUIRED", "match_id required");
  const match = await store.loadMatch(matchId);
  if (!match) throw new GameplayError("MATCH_NOT_FOUND", "Match not found");
  const seat = requireParticipant(match, userId);
  return expireDueTimeoutIfNeeded({ userId, matchId, store, seat });
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

/**
 * Shared timeout commit. Player hydrate / resolve / overdue submit and the
 * system sweeper all call this. actorId is a real seated player id.
 */
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
  onlineActionDiag("received", {
    matchId,
    playerId: userId,
    expectedVersion,
    serverVersion: session?.version,
    clientKnownVersion: expectedVersion,
    serverTurn: timeoutFields(session).currentSeat,
    actionType: ONLINE_ACTION_TIMEOUT,
    failureStage: "received",
  });
  try {
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
      onlineActionDiag("persist", {
        matchId,
        playerId: userId,
        expectedVersion,
        serverVersion: session.version,
        clientKnownVersion: expectedVersion,
        serverTurn: timeoutFields(session).currentSeat,
        actionType: ONLINE_ACTION_TIMEOUT,
        failureStage: "persist",
      });
      return viewFromSecret(secret, matchId, session, seat);
    }
    const view = await commitApplied({
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
    onlineActionDiag("persist", {
      matchId,
      playerId: userId,
      expectedVersion,
      serverVersion: view.version,
      clientKnownVersion: expectedVersion,
      serverTurn: view.currentSeat,
      actionType: ONLINE_ACTION_TIMEOUT,
      failureStage: "persist",
    });
    return view;
  } catch (error) {
    onlineActionDiag("rejected", {
      matchId,
      playerId: userId,
      expectedVersion,
      serverVersion: session?.version,
      clientKnownVersion: expectedVersion,
      serverTurn: timeoutFields(session).currentSeat,
      actionType: ONLINE_ACTION_TIMEOUT,
      failureStage: "rejected",
    });
    throw error;
  }
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
  const actionType = action?.type ?? null;
  onlineActionDiag("received", {
    matchId,
    playerId: userId,
    expectedVersion,
    serverVersion: session?.version,
    clientKnownVersion: expectedVersion,
    serverTurn: timeoutFields(session).currentSeat,
    actionType,
    failureStage: "received",
  });
  try {
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
    // Same-seat draw must refresh the 30s clock (incident 369c7279 endgame:
    // draws left a stale pre-draw deadline and timeout never resolved cleanly).
    applied.resetTurnDeadline = type === "draw";
    const view = await commitApplied({
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
    onlineActionDiag("persist", {
      matchId,
      playerId: userId,
      expectedVersion,
      serverVersion: view.version,
      clientKnownVersion: expectedVersion,
      serverTurn: view.currentSeat,
      actionType,
      failureStage: "persist",
    });
    return view;
  } catch (error) {
    onlineActionDiag("rejected", {
      matchId,
      playerId: userId,
      expectedVersion,
      serverVersion: session?.version,
      clientKnownVersion: expectedVersion,
      serverTurn: timeoutFields(session).currentSeat,
      actionType,
      failureStage: "rejected",
    });
    throw error;
  }
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

/** Max successful timeout commits per sweep invocation. */
export const TIMEOUT_SWEEP_BATCH = 8;
/** Max overdue candidates scanned per sweep (must be >= BATCH for anti-starvation). */
export const TIMEOUT_SWEEP_SCAN = 24;
/** Bounded CAS re-reads when a concurrent player action wins the version race. */
export const TIMEOUT_SWEEP_CAS_ATTEMPTS = 3;

const SWEEP_SKIP = new Set([
  "STALE_VERSION",
  "TIMEOUT_NOT_DUE",
  "MATCH_NOT_ELIGIBLE",
  "ROUND_NOT_ACTIVE",
  "MATCH_NOT_FOUND",
  "NO_SESSION",
  "UNSUPPORTED_RULESET",
]);

function timedOutPlayerId(match, engineState) {
  const seat = engineState?.currentPlayer === 1 ? 1 : 0;
  const playerId = seat === 1 ? match?.player_b : match?.player_a;
  return playerId ? { seat, playerId } : null;
}

/** Map raw PostgREST/SQL failures to stable sweep codes (no secrets). */
export function classifySweepFailure(error) {
  const code = error?.code;
  const message = String(error?.message || error?.details || "");
  if (code === "42501" || /service role required|permission denied/i.test(message)) {
    return {
      code: "42501",
      reason: /service role required/i.test(message)
        ? "service_role_required"
        : "permission_denied",
    };
  }
  if (typeof code === "string" && code) return { code, reason: code };
  return { code: "SWEEP_FAILED", reason: "sweep_failed" };
}

function sweepDiagFromSession(session, nowMs = Date.now()) {
  const fields = timeoutFields(session);
  const deadlineMs = fields.turnDeadlineAt ? Date.parse(fields.turnDeadlineAt) : NaN;
  return {
    revision: Number.isInteger(session?.version) ? session.version : null,
    currentSeat: fields.currentSeat,
    deadline: fields.turnDeadlineAt,
    overdueMs:
      Number.isFinite(deadlineMs) && deadlineMs <= nowMs ? Math.max(0, nowMs - deadlineMs) : null,
    timeoutStrike: fields.timeoutStrikes,
  };
}

export function normalizeSweepCandidates(candidates, limit = TIMEOUT_SWEEP_SCAN) {
  const safeLimit = Math.min(
    Math.max(Number(limit) || TIMEOUT_SWEEP_SCAN, 1),
    TIMEOUT_SWEEP_SCAN
  );
  const rows = [];
  for (const row of Array.isArray(candidates) ? candidates : []) {
    if (!row || typeof row !== "object") continue;
    const matchId = row.match_id ?? row.matchId;
    if (!matchId || typeof matchId !== "string") continue;
    const versionRaw = row.version;
    const version =
      versionRaw == null || versionRaw === ""
        ? null
        : Number.isInteger(versionRaw)
          ? versionRaw
          : Number.isInteger(Number(versionRaw))
            ? Number(versionRaw)
            : null;
    if (versionRaw != null && versionRaw !== "" && version == null) continue;
    const occRaw = row.occupancy_seats ?? row.occupancySeats;
    const occupancySeats =
      occRaw == null || occRaw === ""
        ? null
        : Number.isInteger(Number(occRaw))
          ? Number(occRaw)
          : null;
    rows.push({
      matchId,
      version,
      turnDeadlineAt: row.turn_deadline_at ?? row.turnDeadlineAt ?? null,
      occupancySeats,
      rulesetId: row.ruleset_id ?? row.rulesetId ?? null,
    });
    if (rows.length >= safeLimit) break;
  }
  return rows;
}

function mapSkipStatus(code) {
  if (code === "STALE_VERSION") return "stale";
  if (code === "TIMEOUT_NOT_DUE") return "not_due";
  return "skipped";
}

/** Safe sweep diagnostics — no secrets, hands, or payloads. */
export function summarizeSweepResults(candidates, results) {
  const list = Array.isArray(results) ? results : [];
  const counts = {
    resolved: 0,
    skipped: 0,
    stale: 0,
    notDue: 0,
    failed: 0,
  };
  const skipReasons = {};
  for (const row of list) {
    const status = row?.status;
    if (status === "resolved") counts.resolved += 1;
    else if (status === "stale") {
      counts.stale += 1;
      counts.skipped += 1;
      skipReasons.STALE_VERSION = (skipReasons.STALE_VERSION || 0) + 1;
    } else if (status === "not_due") {
      counts.notDue += 1;
      counts.skipped += 1;
      skipReasons.TIMEOUT_NOT_DUE = (skipReasons.TIMEOUT_NOT_DUE || 0) + 1;
    } else if (status === "skipped") {
      counts.skipped += 1;
      const code = typeof row.code === "string" ? row.code : "UNKNOWN";
      skipReasons[code] = (skipReasons[code] || 0) + 1;
    } else if (status === "failed") counts.failed += 1;
  }
  const remainingDue = Math.max(
    0,
    counts.failed + Math.max(0, (Array.isArray(candidates) ? candidates.length : 0) - list.length)
  );
  return {
    candidatesFound: Array.isArray(candidates) ? candidates.length : 0,
    processed: list.length,
    ...counts,
    remainingDue,
    skipReasons,
  };
}

async function sweepOneDueTimeoutAttempt({ matchId, version, store }) {
  const match = await store.loadMatch(matchId);
  assertMatchEligible(match);
  if (match.status !== "playing") {
    throw new GameplayError("MATCH_NOT_ELIGIBLE", "Match is not eligible for online play");
  }
  const session = await store.loadSession(matchId);
  const secret = await store.loadSecret(matchId);
  if (!session || !secret) {
    throw new GameplayError("NO_SESSION", "Game session has not been created");
  }
  if (isSessionTerminal(match, session, secret)) {
    throw new GameplayError("MATCH_NOT_ELIGIBLE", "Match is not eligible for online play");
  }
  if (session.status !== "playing" || timeoutFields(session).phase !== PHASE.PLAYING) {
    throw new GameplayError("ROUND_NOT_ACTIVE", "Round is not active");
  }
  if (!sessionDeadlineExpired(session)) {
    throw new GameplayError("TIMEOUT_NOT_DUE", "timeout not due");
  }
  if (version != null && session.version !== version) {
    throw new GameplayError("STALE_VERSION", "expected_version does not match");
  }
  const actor = timedOutPlayerId(match, secret.engineState);
  if (!actor) {
    throw new GameplayError("MATCH_NOT_ELIGIBLE", "Match seats are not filled");
  }
  const view = await applyTimeoutAndCommit({
    userId: actor.playerId,
    matchId,
    expectedVersion: session.version,
    store,
  });
  return {
    view,
    diag: {
      ...sweepDiagFromSession(session),
      actionChosen: view?.roundResult?.reason === "timeout" ? "timeout_loss" : "timeout",
      casAttempt: 1,
      casResult: "committed",
    },
  };
}

/**
 * One overdue match. CAS conflicts re-read; if still overdue, retry bounded.
 * Failures never mark the turn handled — later sweeps remain eligible.
 */
async function sweepOneDueTimeout({ matchId, version, store }) {
  let expected = version;
  let lastStale = null;
  for (let attempt = 1; attempt <= TIMEOUT_SWEEP_CAS_ATTEMPTS; attempt += 1) {
    try {
      const result = await sweepOneDueTimeoutAttempt({
        matchId,
        version: expected,
        store,
      });
      result.diag.casAttempt = attempt;
      return result;
    } catch (error) {
      if (error?.code !== "STALE_VERSION") throw error;
      lastStale = error;
      const session = await store.loadSession(matchId);
      if (!session || !sessionDeadlineExpired(session)) {
        // Concurrent mutation already advanced past this overdue turn.
        throw new GameplayError("TIMEOUT_NOT_DUE", "timeout not due");
      }
      expected = session.version;
    }
  }
  throw lastStale || new GameplayError("STALE_VERSION", "expected_version does not match");
}

/**
 * System sweeper. No player JWT. Reuses applyTimeoutAndCommit.
 * Per-match isolation: one failure never aborts the batch.
 * Scans up to TIMEOUT_SWEEP_SCAN overdue rows; stops after TIMEOUT_SWEEP_BATCH
 * successful resolves so poisoned oldest rows cannot starve the rest forever.
 * Failed attempts stay retryable on the next cron cycle.
 */
export async function handleSweepDueTimeouts({ candidates, store, listDue } = {}) {
  const started = Date.now();
  let raw = candidates;
  if (typeof listDue === "function") {
    raw = await listDue(TIMEOUT_SWEEP_SCAN);
  } else if (raw == null && typeof store?.listDueTimeoutMatches === "function") {
    raw = await store.listDueTimeoutMatches(TIMEOUT_SWEEP_SCAN);
  }
  const rows = normalizeSweepCandidates(raw, TIMEOUT_SWEEP_SCAN);
  const results = [];
  let resolvedCount = 0;
  for (const row of rows) {
    if (resolvedCount >= TIMEOUT_SWEEP_BATCH) break;
    const oldVersion = row.version;
    try {
      const { view, diag } = await sweepOneDueTimeout({
        matchId: row.matchId,
        version: row.version,
        store,
      });
      resolvedCount += 1;
      results.push({
        matchId: row.matchId,
        status: "resolved",
        code: null,
        reason: null,
        oldVersion,
        newVersion: view.version,
        version: view.version,
        strike: view.roundResult?.strike ?? view.timeoutStrikes?.[view.currentSeat] ?? null,
        finishReason: view.roundResult?.reason === "timeout" ? "timeout" : null,
        occupancySeats: row.occupancySeats,
        rulesetId: row.rulesetId,
        revision: view.version,
        currentSeat: view.currentSeat ?? null,
        deadline: view.turnDeadlineAt ?? null,
        overdueMs: diag?.overdueMs ?? null,
        timeoutStrike: view.timeoutStrikes ?? diag?.timeoutStrike ?? null,
        actionChosen: diag?.actionChosen ?? "timeout",
        casAttempt: diag?.casAttempt ?? 1,
        casResult: "committed",
      });
    } catch (error) {
      const code = error?.code;
      if (SWEEP_SKIP.has(code)) {
        results.push({
          matchId: row.matchId,
          status: mapSkipStatus(code),
          code,
          reason: code,
          oldVersion,
          newVersion: null,
          occupancySeats: row.occupancySeats,
          rulesetId: row.rulesetId,
          skipReason: code,
        });
        continue;
      }
      const classified = classifySweepFailure(error);
      const message = String(error?.message || error?.details || "").slice(0, 180);
      results.push({
        matchId: row.matchId,
        status: "failed",
        code: classified.code,
        reason: classified.reason,
        message: message || null,
        oldVersion,
        newVersion: null,
        occupancySeats: row.occupancySeats,
        rulesetId: row.rulesetId,
        // Intentionally not marked handled — remains list_due eligible.
      });
    }
  }
  const summary = {
    ...summarizeSweepResults(rows, results),
    elapsedMs: Date.now() - started,
  };
  return {
    ok: summary.failed === 0,
    processed: results.length,
    results,
    summary,
  };
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
  if (op === "sweep_due_timeouts") {
    throw new GameplayError("UNKNOWN_OP", "Unknown gameplay operation");
  }
  throw new GameplayError("UNKNOWN_OP", "Unknown gameplay operation");
}
