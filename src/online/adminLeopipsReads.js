/**
 * Staff-only LeoPips admin readers. RPC only. Never uses a service-role key.
 */
import {
  ADMIN_ERROR,
  ADMIN_PAGE_SIZE,
  AdminError,
  adminErrorI18nKey,
} from "./adminDashboard.js";
import { isInfrastructureOutageError } from "./serviceHealth.js";
import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient.js";
import { toStoredAdminStake } from "./adminLeopipsOps.js";

const PRIVATE_FIELD = /email|phone|password|token|metadata|accountage|service.?role|raw_user|jwt/i;

function clientOf(client) {
  return client ?? getSupabaseClient();
}

function asInt(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function asText(value) {
  if (value == null) return null;
  const text = String(value);
  return text.length ? text : null;
}

function asBool(value) {
  if (typeof value === "boolean") return value;
  return null;
}

function dropPrivateKeys(row) {
  if (!row || typeof row !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (PRIVATE_FIELD.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function throwFromError(error) {
  const msg = String(error?.message || error?.details || error?.hint || error?.code || "");
  const code = String(error?.code || "");
  if (/authentication required/i.test(msg) || code === "28000") {
    throw new AdminError(ADMIN_ERROR.AUTH, msg, error);
  }
  if (/staff required/i.test(msg) || code === "42501") {
    throw new AdminError(ADMIN_ERROR.FORBIDDEN, msg, error);
  }
  if (/does not exist|42883|PGRST202/i.test(`${msg} ${code}`)) {
    throw new AdminError(ADMIN_ERROR.UNAVAILABLE, msg, error);
  }
  if (isInfrastructureOutageError(error) || code === "PGRST003") {
    throw new AdminError(ADMIN_ERROR.BACKEND, msg, error);
  }
  throw new AdminError(ADMIN_ERROR.GENERIC, msg, error);
}

function publicPlayer(row) {
  if (!row || typeof row !== "object") return { playerId: "", displayName: "", username: "" };
  const data = dropPrivateKeys(row);
  return {
    playerId: asText(data.player_id ?? data.playerId) || "",
    displayName: asText(data.display_name ?? data.displayName) || "",
    username: asText(data.username) || "",
  };
}

function requireConfigured(client) {
  if (!client && !isSupabaseConfigured()) {
    throw new AdminError(ADMIN_ERROR.UNAVAILABLE);
  }
}

async function rpc(name, payload, client) {
  requireConfigured(client);
  const { data, error } = await clientOf(client).rpc(name, payload);
  if (error) throwFromError(error);
  return data && typeof data === "object" ? dropPrivateKeys(data) : {};
}

export function adminHistoryStatusKey(status, finishReason) {
  if (finishReason === "forfeit") return "admin.statusForfeit";
  if (finishReason === "timeout") return "admin.statusTimeout";
  if (finishReason === "join_timeout") return "admin.statusJoinTimeout";
  if (finishReason === "completed") return "admin.finishCompleted";
  if (status === "ready") return "admin.statusReady";
  if (status === "playing") return "admin.statusPlaying";
  if (status === "finished") return "admin.statusFinished";
  if (status === "aborted") return "admin.statusAborted";
  return "admin.statusWaiting";
}

export function normalizeAdminHistoryMatch(row) {
  if (!row || typeof row !== "object") return null;
  const data = dropPrivateKeys(row);
  const matchId = asText(data.match_id ?? data.matchId);
  if (!matchId) return null;
  return {
    matchId,
    playerA: publicPlayer(data.player_a ?? data.playerA),
    playerB: publicPlayer(data.player_b ?? data.playerB),
    rulesetId: asText(data.ruleset_id ?? data.rulesetId) || "",
    matchKind: asText(data.match_kind ?? data.matchKind) || "public",
    stakePips: toStoredAdminStake(data.stake_pips ?? data.stakePips),
    createdAt: asText(data.created_at ?? data.createdAt),
    finishedAt: asText(data.finished_at ?? data.finishedAt),
    durationSeconds: asInt(data.duration_seconds ?? data.durationSeconds),
    status: asText(data.status) || "",
    finishReason: asText(data.finish_reason ?? data.finishReason),
    winnerPlayerId: asText(data.winner_player_id ?? data.winnerPlayerId),
    loserPlayerId: asText(data.loser_player_id ?? data.loserPlayerId),
    winnerSeat: asInt(data.winner_seat ?? data.winnerSeat),
  };
}

export function normalizeAdminMatchPage(row) {
  const data = row && typeof row === "object" ? dropPrivateKeys(row) : {};
  const raw = Array.isArray(data.matches) ? data.matches : [];
  return {
    matches: raw.map(normalizeAdminHistoryMatch).filter(Boolean),
    total: asInt(data.total) ?? 0,
    limit: asInt(data.limit) ?? ADMIN_PAGE_SIZE,
    offset: asInt(data.offset) ?? 0,
  };
}

export function normalizeAdminMatchLeopips(row) {
  const data = row && typeof row === "object" ? dropPrivateKeys(row) : {};
  const raw = Array.isArray(data.ledger) ? data.ledger : [];
  return {
    found: data.found !== false,
    matchId: asText(data.match_id ?? data.matchId),
    stakePips: toStoredAdminStake(data.stake_pips ?? data.stakePips),
    expectedPot: asInt(data.expected_pot ?? data.expectedPot),
    playerA: asText(data.player_a ?? data.playerA),
    playerB: asText(data.player_b ?? data.playerB),
    winnerPlayerId: asText(data.winner_player_id ?? data.winnerPlayerId),
    status: asText(data.status) || "",
    finishReason: asText(data.finish_reason ?? data.finishReason),
    createdAt: asText(data.created_at ?? data.createdAt),
    finishedAt: asText(data.finished_at ?? data.finishedAt),
    matchKind: asText(data.match_kind ?? data.matchKind) || "",
    rulesetId: asText(data.ruleset_id ?? data.rulesetId) || "",
    ledger: raw.map((item) => {
      const line = dropPrivateKeys(item);
      return {
        id: asText(line.id),
        playerId: asText(line.player_id ?? line.playerId),
        username: asText(line.username) || "",
        displayName: asText(line.display_name ?? line.displayName) || "",
        amount: asInt(line.amount),
        reason: asText(line.reason) || "",
        idempotencyKey: asText(line.idempotency_key ?? line.idempotencyKey) || "",
        balanceAfter: asInt(line.balance_after ?? line.balanceAfter),
        createdAt: asText(line.created_at ?? line.createdAt),
        referralId: asText(line.referral_id ?? line.referralId),
      };
    }),
  };
}

export function normalizeAdminLeopipsOverview(row) {
  const data = row && typeof row === "object" ? dropPrivateKeys(row) : {};
  const wallets = data.wallets && typeof data.wallets === "object" ? dropPrivateKeys(data.wallets) : {};
  const ledger = data.ledger && typeof data.ledger === "object" ? dropPrivateKeys(data.ledger) : {};
  return {
    totalWallets: asInt(wallets.total_wallets ?? wallets.totalWallets) ?? 0,
    totalBalance: asInt(wallets.total_balance ?? wallets.totalBalance) ?? 0,
    positiveWallets: asInt(wallets.positive_wallets ?? wallets.positiveWallets) ?? 0,
    zeroWallets: asInt(wallets.zero_wallets ?? wallets.zeroWallets) ?? 0,
    negativeWallets: asInt(wallets.negative_wallets ?? wallets.negativeWallets) ?? 0,
    minBalance: asInt(wallets.min_balance ?? wallets.minBalance),
    maxBalance: asInt(wallets.max_balance ?? wallets.maxBalance),
    ledger,
  };
}

export function normalizeAdminNegativePage(row) {
  const data = row && typeof row === "object" ? dropPrivateKeys(row) : {};
  const raw = Array.isArray(data.wallets) ? data.wallets : [];
  return {
    wallets: raw.map((item) => {
      const w = dropPrivateKeys(item);
      return {
        playerId: asText(w.player_id ?? w.playerId) || "",
        username: asText(w.username) || "",
        displayName: asText(w.display_name ?? w.displayName) || "",
        balance: asInt(w.balance),
        latestAmount: asInt(w.latest_amount ?? w.latestAmount),
        latestReason: asText(w.latest_reason ?? w.latestReason) || "",
        latestCreatedAt: asText(w.latest_created_at ?? w.latestCreatedAt),
        timeoutPenaltyLatest: asBool(w.timeout_penalty_latest ?? w.timeoutPenaltyLatest) === true,
      };
    }),
    total: asInt(data.total) ?? 0,
    limit: asInt(data.limit) ?? ADMIN_PAGE_SIZE,
    offset: asInt(data.offset) ?? 0,
  };
}

export function normalizeAdminStakeActivity(row) {
  const data = row && typeof row === "object" ? dropPrivateKeys(row) : {};
  const totals = data.totals && typeof data.totals === "object" ? dropPrivateKeys(data.totals) : {};
  const styles = Array.isArray(data.by_style ?? data.byStyle) ? data.by_style ?? data.byStyle : [];
  return {
    from: asText(data.from),
    to: asText(data.to),
    totals: {
      20: asInt(totals["20"]) ?? 0,
      50: asInt(totals["50"]) ?? 0,
      100: asInt(totals["100"]) ?? 0,
      150: asInt(totals["150"]) ?? 0,
      nullStake: asInt(totals.null_stake ?? totals.nullStake) ?? 0,
    },
    byStyle: styles.map((item) => {
      const s = dropPrivateKeys(item);
      return {
        rulesetId: asText(s.ruleset_id ?? s.rulesetId) || "",
        20: asInt(s["20"]) ?? 0,
        50: asInt(s["50"]) ?? 0,
        100: asInt(s["100"]) ?? 0,
        150: asInt(s["150"]) ?? 0,
      };
    }),
  };
}

export function normalizeAdminLeopipsReferralPage(row) {
  const data = row && typeof row === "object" ? dropPrivateKeys(row) : {};
  const raw = Array.isArray(data.referrals) ? data.referrals : [];
  const summary = data.summary && typeof data.summary === "object" ? dropPrivateKeys(data.summary) : {};
  return {
    referrals: raw.map((item) => {
      const r = dropPrivateKeys(item);
      return {
        referralId: asText(r.referral_id ?? r.referralId) || "",
        inviter: publicPlayer(r.inviter),
        referred: publicPlayer(r.referred),
        createdAt: asText(r.created_at ?? r.createdAt),
        attributedAt: asText(r.attributed_at ?? r.attributedAt),
        validationStatus: asText(r.validation_status ?? r.validationStatus) || "",
        inviteWinStatus: asText(r.validation_status ?? r.validationStatus) || "",
        qualifyingCount: asInt(r.qualifying_count ?? r.qualifyingCount) ?? 0,
        progress: asInt(r.progress) ?? 0,
        required: asInt(r.required) ?? 3,
        eligible: asBool(r.eligible) === true,
        rewarded: asBool(r.rewarded) === true,
        rewardAmount: asInt(r.reward_amount ?? r.rewardAmount),
        rewardCreatedAt: asText(r.reward_created_at ?? r.rewardCreatedAt),
        rewardIdempotencyKey: asText(r.reward_idempotency_key ?? r.rewardIdempotencyKey) || "",
      };
    }),
    summary: {
      totalReferrals: asInt(summary.total_referrals ?? summary.totalReferrals) ?? 0,
      pending: asInt(summary.pending) ?? 0,
      validated: asInt(summary.validated) ?? 0,
      rejected: asInt(summary.rejected) ?? 0,
      rewarded: asInt(summary.rewarded) ?? 0,
    },
    total: asInt(data.total) ?? 0,
    limit: asInt(data.limit) ?? ADMIN_PAGE_SIZE,
    offset: asInt(data.offset) ?? 0,
  };
}

export function normalizeAdminTimeoutPage(row) {
  const data = row && typeof row === "object" ? dropPrivateKeys(row) : {};
  const raw = Array.isArray(data.penalties) ? data.penalties : [];
  return {
    penalties: raw.map((item) => {
      const p = dropPrivateKeys(item);
      return {
        matchId: asText(p.match_id ?? p.matchId) || "",
        playerId: asText(p.player_id ?? p.playerId) || "",
        username: asText(p.username) || "",
        displayName: asText(p.display_name ?? p.displayName) || "",
        amount: asInt(p.amount),
        strike: asInt(p.strike),
        idempotencyKey: asText(p.idempotency_key ?? p.idempotencyKey) || "",
        createdAt: asText(p.created_at ?? p.createdAt),
        currentBalance: asInt(p.current_balance ?? p.currentBalance),
        anomalyUnexpectedAmount: asBool(p.anomaly_unexpected_amount ?? p.anomalyUnexpectedAmount) === true,
        anomalyStrike3: asBool(p.anomaly_strike_3 ?? p.anomalyStrike3) === true,
        anomalyDuplicateStrike: asBool(p.anomaly_duplicate_strike ?? p.anomalyDuplicateStrike) === true,
      };
    }),
    total: asInt(data.total) ?? 0,
    limit: asInt(data.limit) ?? ADMIN_PAGE_SIZE,
    offset: asInt(data.offset) ?? 0,
  };
}

export function normalizeAdminAnomalyPage(row) {
  const data = row && typeof row === "object" ? dropPrivateKeys(row) : {};
  const raw = Array.isArray(data.anomalies) ? data.anomalies : [];
  return {
    anomalies: raw.map((item) => {
      const a = dropPrivateKeys(item);
      return {
        anomalyType: asText(a.anomaly_type ?? a.anomalyType) || "",
        matchId: asText(a.match_id ?? a.matchId) || "",
        playerId: asText(a.player_id ?? a.playerId),
        stakePips: toStoredAdminStake(a.stake_pips ?? a.stakePips),
        status: asText(a.status) || "",
        finishReason: asText(a.finish_reason ?? a.finishReason),
        ledgerKey: asText(a.ledger_key ?? a.ledgerKey),
        ledgerAmount: asInt(a.ledger_amount ?? a.ledgerAmount),
        createdAt: asText(a.created_at ?? a.createdAt),
      };
    }),
    limit: asInt(data.limit) ?? 50,
  };
}

export function normalizeAdminOpenRequestPage(row) {
  const data = row && typeof row === "object" ? dropPrivateKeys(row) : {};
  const raw = Array.isArray(data.requests) ? data.requests : [];
  return {
    requests: raw.map((item) => {
      const r = dropPrivateKeys(item);
      return {
        requestId: asText(r.request_id ?? r.requestId) || "",
        creator: publicPlayer(r.creator),
        visibility: asText(r.visibility) || "",
        rulesetId: asText(r.ruleset_id ?? r.rulesetId) || "",
        stakePips: toStoredAdminStake(r.stake_pips ?? r.stakePips),
        status: asText(r.status) || "",
        createdAt: asText(r.created_at ?? r.createdAt),
        ageSeconds: asInt(r.age_seconds ?? r.ageSeconds) ?? 0,
        flagPublicNullStake: asBool(r.flag_public_null_stake ?? r.flagPublicNullStake) === true,
        flagInvalidStake: asBool(r.flag_invalid_stake ?? r.flagInvalidStake) === true,
        flagInvalidStyle: asBool(r.flag_invalid_style ?? r.flagInvalidStyle) === true,
        flagStale: asBool(r.flag_stale ?? r.flagStale) === true,
        flagFriendAsPublic: asBool(r.flag_friend_as_public ?? r.flagFriendAsPublic) === true,
        exactStyleStakeBucket: asText(r.exact_style_stake_bucket ?? r.exactStyleStakeBucket),
      };
    }),
    total: asInt(data.total) ?? 0,
    limit: asInt(data.limit) ?? ADMIN_PAGE_SIZE,
    offset: asInt(data.offset) ?? 0,
  };
}

export function normalizeAdminPlayerLeopips(row) {
  const data = row && typeof row === "object" ? dropPrivateKeys(row) : {};
  const player = data.player && typeof data.player === "object" ? dropPrivateKeys(data.player) : {};
  const ledger = Array.isArray(data.ledger) ? data.ledger : [];
  const matches = Array.isArray(data.recent_staked_matches ?? data.recentStakedMatches)
    ? data.recent_staked_matches ?? data.recentStakedMatches
    : [];
  const referral = data.referral && typeof data.referral === "object" ? dropPrivateKeys(data.referral) : {};
  const asReferred = referral.as_referred ?? referral.asReferred;
  return {
    found: data.found !== false,
    balance: asInt(player.balance),
    walletUpdatedAt: asText(player.wallet_updated_at ?? player.walletUpdatedAt),
    ledger: ledger.map((item) => {
      const line = dropPrivateKeys(item);
      return {
        amount: asInt(line.amount),
        reason: asText(line.reason) || "",
        matchId: asText(line.match_id ?? line.matchId),
        idempotencyKey: asText(line.idempotency_key ?? line.idempotencyKey) || "",
        createdAt: asText(line.created_at ?? line.createdAt),
      };
    }),
    recentStakedMatches: matches.map((item) => {
      const m = dropPrivateKeys(item);
      return {
        matchId: asText(m.match_id ?? m.matchId) || "",
        stakePips: toStoredAdminStake(m.stake_pips ?? m.stakePips),
        status: asText(m.status) || "",
        finishReason: asText(m.finish_reason ?? m.finishReason),
        createdAt: asText(m.created_at ?? m.createdAt),
      };
    }),
    referral: {
      qualifyingCount: asInt(asReferred?.qualifying_count ?? asReferred?.qualifyingCount),
      validationStatus: asText(asReferred?.validation_status ?? asReferred?.validationStatus),
      rewarded: asBool(asReferred?.rewarded) === true,
    },
  };
}

export async function fetchAdminMatches(query = {}, client) {
  const data = await rpc(
    "admin_list_matches",
    {
      p_search: query.search || null,
      p_ruleset_id: query.rulesetId || null,
      p_match_kind: query.matchKind || null,
      p_stake_filter: query.stakeFilter || null,
      p_status: query.status || null,
      p_finish_reason: query.finishReason || null,
      p_from: query.from || null,
      p_to: query.to || null,
      p_limit: query.limit ?? ADMIN_PAGE_SIZE,
      p_offset: query.offset ?? 0,
    },
    client
  );
  return normalizeAdminMatchPage(data);
}

export async function fetchAdminMatchLeopips(matchId, client) {
  const data = await rpc("admin_get_match_leopips", { p_match_id: matchId }, client);
  return normalizeAdminMatchLeopips(data);
}

export async function fetchAdminLeopipsOverview(client) {
  return normalizeAdminLeopipsOverview(await rpc("admin_get_leopips_overview", {}, client));
}

export async function fetchAdminNegativeLeopips(query = {}, client) {
  return normalizeAdminNegativePage(
    await rpc(
      "admin_list_negative_leopips",
      { p_limit: query.limit ?? ADMIN_PAGE_SIZE, p_offset: query.offset ?? 0 },
      client
    )
  );
}

export async function fetchAdminStakeActivity(query = {}, client) {
  return normalizeAdminStakeActivity(
    await rpc("admin_list_leopips_stake_activity", { p_from: query.from || null, p_to: query.to || null }, client)
  );
}

export async function fetchAdminLeopipsReferrals(query = {}, client) {
  return normalizeAdminLeopipsReferralPage(
    await rpc(
      "admin_list_leopips_referrals",
      {
        p_search: query.search || null,
        p_limit: query.limit ?? ADMIN_PAGE_SIZE,
        p_offset: query.offset ?? 0,
      },
      client
    )
  );
}

export const ADMIN_REFERRAL_FETCH_LIMIT = 50;

export const ADMIN_REFERRAL_MAX = 2000;

export async function fetchAdminLeopipsReferralUniverse(client) {
  const referrals = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total && referrals.length < ADMIN_REFERRAL_MAX) {
    const page = await fetchAdminLeopipsReferrals(
      { search: null, limit: ADMIN_REFERRAL_FETCH_LIMIT, offset },
      client
    );
    total = Number.isFinite(page.total) ? page.total : 0;
    const batch = Array.isArray(page.referrals) ? page.referrals : [];
    referrals.push(...batch);
    if (!batch.length) break;
    offset += ADMIN_REFERRAL_FETCH_LIMIT;
  }
  return referrals;
}

export async function fetchAdminTimeoutPenalties(query = {}, client) {
  return normalizeAdminTimeoutPage(
    await rpc(
      "admin_list_timeout_penalties",
      {
        p_from: query.from || null,
        p_to: query.to || null,
        p_limit: query.limit ?? ADMIN_PAGE_SIZE,
        p_offset: query.offset ?? 0,
      },
      client
    )
  );
}

export async function fetchAdminLeopipsAnomalies(query = {}, client) {
  return normalizeAdminAnomalyPage(
    await rpc(
      "admin_list_leopips_anomalies",
      { p_from: query.from || null, p_to: query.to || null, p_limit: query.limit ?? 50 },
      client
    )
  );
}

export async function fetchAdminOpenMatchRequests(query = {}, client) {
  return normalizeAdminOpenRequestPage(
    await rpc(
      "admin_list_open_match_requests",
      { p_limit: query.limit ?? ADMIN_PAGE_SIZE, p_offset: query.offset ?? 0 },
      client
    )
  );
}

export async function fetchAdminPlayerLeopips(playerId, client) {
  return normalizeAdminPlayerLeopips(await rpc("admin_get_player_leopips", { p_player_id: playerId }, client));
}

export { adminErrorI18nKey };
