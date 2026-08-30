/**
 * Admin Dashboard V1 remaining staff RPCs. Never uses a service-role key.
 */
import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient.js";
import { isInfrastructureOutageError } from "./serviceHealth.js";
import {
  ADMIN_ERROR,
  ADMIN_PAGE_SIZE,
  AdminError,
  adminAccountStatus,
  adminPresenceState,
  fetchAdminLiveMatches,
  fetchAdminOverview,
  fetchAdminTopRp,
  fetchAdminUsers,
  overviewCardsFromPayload,
} from "./adminDashboard.js";

const PRIVATE_FIELD = /email|phone|password|token|metadata|accountage|service.?role|raw_user|jwt/i;

export const ADMIN_V1_NAV = Object.freeze([
  "overview",
  "users",
  "liveMatches",
  "globalRp",
  "reports",
  "challenge",
  "inviteWin",
  "league",
  "feedback",
  "audit",
]);

export const ADMIN_PUBLIC_PLAYER_FIELDS = Object.freeze(["playerId", "displayName", "username", "avatarId"]);

export const ADMIN_USER_DETAIL_FIELDS = Object.freeze([
  "playerId",
  "displayName",
  "username",
  "countryCode",
  "avatarId",
  "createdAt",
  "deletedAt",
  "rp",
  "wins",
  "losses",
  "matchesPlayed",
  "inActiveMatch",
  "matchLastSeenAt",
  "friendCount",
  "presenceLastSeenAt",
]);

export const ADMIN_REPORT_STATUSES = Object.freeze(["open", "reviewing", "resolved", "dismissed"]);
export const ADMIN_CHALLENGE_STATUSES = Object.freeze(["coming_soon", "scheduled", "live", "completed"]);
export const ADMIN_FEEDBACK_CATEGORIES = Object.freeze(["general", "bug", "feature"]);

function clientOf(client) {
  return client ?? getSupabaseClient();
}

function asInt(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function asBool(value) {
  if (typeof value === "boolean") return value;
  return null;
}

function asText(value) {
  if (value == null) return null;
  const text = String(value);
  return text.length ? text : null;
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

function dropPrivateKeys(row) {
  if (!row || typeof row !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (PRIVATE_FIELD.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function pageShape(data, listKey) {
  const raw = Array.isArray(data[listKey]) ? data[listKey] : [];
  return {
    items: raw,
    total: asInt(data.total) ?? raw.length,
    limit: asInt(data.limit) ?? ADMIN_PAGE_SIZE,
    offset: asInt(data.offset) ?? 0,
  };
}

export function normalizeAdminPublicPlayer(row) {
  if (!row || typeof row !== "object") return null;
  const data = dropPrivateKeys(row);
  const playerId = asText(data.player_id ?? data.playerId);
  if (!playerId) return null;
  const player = {
    playerId,
    displayName: asText(data.display_name ?? data.displayName) || "",
    username: asText(data.username) || "",
    avatarId: asText(data.avatar_id ?? data.avatarId) || "",
  };
  for (const key of Object.keys(player)) {
    if (!ADMIN_PUBLIC_PLAYER_FIELDS.includes(key)) delete player[key];
  }
  return player;
}

export function normalizeAdminUserDetail(row) {
  if (!row || typeof row !== "object") return null;
  const data = dropPrivateKeys(row);
  const playerId = asText(data.player_id ?? data.playerId);
  if (!playerId) return null;
  const deletedAt = data.deleted_at ?? data.deletedAt ?? null;
  const matchLastSeenAt = data.match_last_seen_at ?? data.matchLastSeenAt ?? null;
  const detail = {
    playerId,
    displayName: asText(data.display_name ?? data.displayName) || "",
    username: asText(data.username) || "",
    countryCode: asText(data.country_code ?? data.countryCode) || "",
    avatarId: asText(data.avatar_id ?? data.avatarId) || "",
    createdAt: asText(data.created_at ?? data.createdAt),
    deletedAt: deletedAt ? asText(deletedAt) : null,
    rp: asInt(data.rp) ?? 1000,
    wins: asInt(data.wins) ?? 0,
    losses: asInt(data.losses) ?? 0,
    matchesPlayed: asInt(data.matches_played ?? data.matchesPlayed) ?? 0,
    inActiveMatch: asBool(data.in_active_match ?? data.inActiveMatch) === true,
    matchLastSeenAt: matchLastSeenAt ? asText(matchLastSeenAt) : null,
    presenceLastSeenAt: (() => {
      const seen = data.presence_last_seen_at ?? data.presenceLastSeenAt ?? null;
      return seen ? asText(seen) : null;
    })(),
    friendCount: asInt(data.friend_count ?? data.friendCount) ?? 0,
  };
  for (const key of Object.keys(detail)) {
    if (!ADMIN_USER_DETAIL_FIELDS.includes(key)) delete detail[key];
  }
  return detail;
}

export function normalizeAdminUserDetailPayload(row) {
  if (!row || typeof row !== "object") return { player: null, recentRatedMatches: [] };
  const data = dropPrivateKeys(row);
  const recent = Array.isArray(data.recent_rated_matches ?? data.recentRatedMatches)
    ? data.recent_rated_matches ?? data.recentRatedMatches
    : [];
  return {
    player: normalizeAdminUserDetail(data.player),
    recentRatedMatches: recent
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const event = dropPrivateKeys(item);
        if (asBool(event.rated) !== true) return null;
        const matchId = asText(event.match_id ?? event.matchId);
        const settledAt = asText(event.settled_at ?? event.settledAt);
        if (!matchId || !settledAt) return null;
        return {
          matchId,
          rated: true,
          result: asText(event.result) === "loss" ? "loss" : "win",
          rulesetId: asText(event.ruleset_id ?? event.rulesetId) || "",
          finishReason: asText(event.finish_reason ?? event.finishReason) || "",
          settledAt,
          matchKind: asText(event.match_kind ?? event.matchKind) || "public",
        };
      })
      .filter(Boolean),
  };
}

export function normalizeAdminReport(row) {
  if (!row || typeof row !== "object") return null;
  const data = dropPrivateKeys(row);
  const id = asText(data.id);
  const status = asText(data.status);
  if (!id || !ADMIN_REPORT_STATUSES.includes(status)) return null;
  const reporter = normalizeAdminPublicPlayer(data.reporter);
  const reported = normalizeAdminPublicPlayer(data.reported);
  if (!reporter || !reported) return null;
  return {
    id,
    reporter,
    reported,
    category: asText(data.category) || "other",
    body: asText(data.body) || "",
    status,
    assignedStaffId: asText(data.assigned_staff_id ?? data.assignedStaffId),
    resolvedAt: asText(data.resolved_at ?? data.resolvedAt),
    createdAt: asText(data.created_at ?? data.createdAt),
  };
}

export function normalizeAdminFeedback(row) {
  if (!row || typeof row !== "object") return null;
  const data = dropPrivateKeys(row);
  const id = asText(data.id);
  const player = normalizeAdminPublicPlayer(data.player);
  if (!id || !player) return null;
  return {
    id,
    player,
    category: asText(data.category) || "general",
    body: asText(data.body) || "",
    appVersion: asText(data.app_version ?? data.appVersion),
    platform: asText(data.platform),
    status: asText(data.status) || "new",
    createdAt: asText(data.created_at ?? data.createdAt),
  };
}

export function normalizeAdminAudit(row) {
  if (!row || typeof row !== "object") return null;
  const data = dropPrivateKeys(row);
  const id = asText(data.id);
  const createdAt = asText(data.created_at ?? data.createdAt);
  if (!id || !createdAt) return null;
  const metadata = data.metadata && typeof data.metadata === "object" ? dropPrivateKeys(data.metadata) : {};
  return {
    id,
    actorId: asText(data.actor_id ?? data.actorId),
    actorRole: asText(data.actor_role ?? data.actorRole),
    action: asText(data.action) || "",
    targetType: asText(data.target_type ?? data.targetType) || "",
    targetId: asText(data.target_id ?? data.targetId),
    reason: asText(data.reason),
    metadata,
    createdAt,
  };
}

export function normalizeAdminChallenge(row) {
  if (!row || typeof row !== "object") {
    return {
      status: "coming_soon",
      startsAt: null,
      endsAt: null,
      qualificationCp: 5000,
      firstPrizeUsd: 300,
      secondPrizeUsd: 200,
      cpEarningEnabled: false,
      qualifiedPlayers: [],
    };
  }
  const data = dropPrivateKeys(row);
  const status = asText(data.status);
  return {
    status: ADMIN_CHALLENGE_STATUSES.includes(status) ? status : "coming_soon",
    startsAt: asText(data.starts_at ?? data.startsAt),
    endsAt: asText(data.ends_at ?? data.endsAt),
    qualificationCp: asInt(data.qualification_cp ?? data.qualificationCp) || 5000,
    firstPrizeUsd: asInt(data.first_prize_usd ?? data.firstPrizeUsd) || 300,
    secondPrizeUsd: asInt(data.second_prize_usd ?? data.secondPrizeUsd) || 200,
    cpEarningEnabled: false,
    qualifiedPlayers: [],
  };
}

export function normalizeAdminLeague(row) {
  if (!row || typeof row !== "object") {
    return { status: "coming_soon", seasonDays: 60, startsAt: null, endsAt: null, leaderboard: [] };
  }
  const data = dropPrivateKeys(row);
  return {
    status: asText(data.status) || "coming_soon",
    seasonDays: asInt(data.season_days ?? data.seasonDays) || 60,
    startsAt: asText(data.starts_at ?? data.startsAt),
    endsAt: asText(data.ends_at ?? data.endsAt),
    leaderboard: [],
  };
}

export function normalizeAdminInviteWin(row) {
  if (!row || typeof row !== "object") {
    return {
      season: null,
      counts: { pending: 0, validated: 0, rejected: 0 },
      standings: [],
    };
  }
  const data = dropPrivateKeys(row);
  const seasonRaw = data.season && typeof data.season === "object" ? dropPrivateKeys(data.season) : null;
  const countsRaw = data.counts && typeof data.counts === "object" ? data.counts : {};
  const standingsRaw = Array.isArray(data.standings) ? data.standings : [];
  return {
    season: seasonRaw
      ? {
          id: asText(seasonRaw.id),
          slug: asText(seasonRaw.slug),
          name: asText(seasonRaw.name) || "",
          status: asText(seasonRaw.status) || "",
          startsAt: asText(seasonRaw.starts_at ?? seasonRaw.startsAt),
          endsAt: asText(seasonRaw.ends_at ?? seasonRaw.endsAt),
          prizeAmountUsd: asInt(seasonRaw.prize_amount_usd ?? seasonRaw.prizeAmountUsd),
          prizeCurrency: asText(seasonRaw.prize_currency ?? seasonRaw.prizeCurrency) || "USD",
          prizeLabel: asText(seasonRaw.prize_label ?? seasonRaw.prizeLabel) || "",
          winner: normalizeAdminPublicPlayer(seasonRaw.winner),
          finalizedAt: asText(seasonRaw.finalized_at ?? seasonRaw.finalizedAt),
        }
      : null,
    counts: {
      pending: asInt(countsRaw.pending) ?? 0,
      validated: asInt(countsRaw.validated) ?? 0,
      rejected: asInt(countsRaw.rejected) ?? 0,
    },
    standings: standingsRaw
      .map((item) => {
        const player = normalizeAdminPublicPlayer(item);
        if (!player) return null;
        const dataRow = dropPrivateKeys(item);
        return {
          ...player,
          validatedCount: asInt(dataRow.validated_count ?? dataRow.validatedCount) ?? 0,
          pendingCount: asInt(dataRow.pending_count ?? dataRow.pendingCount) ?? 0,
          rejectedCount: asInt(dataRow.rejected_count ?? dataRow.rejectedCount) ?? 0,
        };
      })
      .filter(Boolean),
  };
}

async function rpc(name, payload, client) {
  if (!client && !isSupabaseConfigured()) {
    throw new AdminError(ADMIN_ERROR.UNAVAILABLE);
  }
  const { data, error } = await clientOf(client).rpc(name, payload);
  if (error) throwFromError(error);
  return data;
}

export async function fetchAdminUserDetail(playerId, client) {
  const id = asText(playerId);
  if (!id) throw new AdminError(ADMIN_ERROR.GENERIC, "player required");
  return normalizeAdminUserDetailPayload(await rpc("admin_get_user", { p_player_id: id }, client));
}

export async function fetchAdminReports(query = {}, client) {
  const data = await rpc(
    "admin_list_reports",
    {
      p_limit: Math.min(Math.max(asInt(query.limit) || ADMIN_PAGE_SIZE, 1), 50),
      p_offset: Math.max(asInt(query.offset) || 0, 0),
    },
    client
  );
  const page = pageShape(dropPrivateKeys(data || {}), "items");
  return { ...page, items: page.items.map(normalizeAdminReport).filter(Boolean) };
}

export async function updateAdminReportStatus(reportId, status, reason, client) {
  const id = asText(reportId);
  const wanted = asText(status);
  const why = asText(reason);
  if (!id || !ADMIN_REPORT_STATUSES.includes(wanted) || !why || why.length < 8) {
    throw new AdminError(ADMIN_ERROR.GENERIC, "reason required");
  }
  return rpc(
    "admin_update_report_status",
    { p_report_id: id, p_status: wanted, p_reason: why },
    client
  );
}

export async function fetchAdminFeedback(query = {}, client) {
  const data = await rpc(
    "admin_list_feedback",
    {
      p_limit: Math.min(Math.max(asInt(query.limit) || ADMIN_PAGE_SIZE, 1), 50),
      p_offset: Math.max(asInt(query.offset) || 0, 0),
    },
    client
  );
  const page = pageShape(dropPrivateKeys(data || {}), "items");
  return { ...page, items: page.items.map(normalizeAdminFeedback).filter(Boolean) };
}

export async function fetchAdminAudit(query = {}, client) {
  const data = await rpc(
    "admin_list_audit",
    {
      p_limit: Math.min(Math.max(asInt(query.limit) || ADMIN_PAGE_SIZE, 1), 50),
      p_offset: Math.max(asInt(query.offset) || 0, 0),
    },
    client
  );
  const wrapped = dropPrivateKeys(data || {});
  const raw = Array.isArray(wrapped.events) ? wrapped.events : [];
  return {
    items: raw.map(normalizeAdminAudit).filter(Boolean),
    total: asInt(wrapped.total) ?? raw.length,
    limit: asInt(wrapped.limit) ?? ADMIN_PAGE_SIZE,
    offset: asInt(wrapped.offset) ?? 0,
  };
}

export async function fetchAdminInviteWin(client) {
  return normalizeAdminInviteWin(await rpc("admin_get_invite_win", {}, client));
}

export async function fetchAdminChallenge(client) {
  return normalizeAdminChallenge(await rpc("admin_get_challenge", {}, client));
}

export async function updateAdminChallenge({ status, startsAt, endsAt, reason }, client) {
  const wanted = asText(status);
  const why = asText(reason);
  if (!ADMIN_CHALLENGE_STATUSES.includes(wanted) || !why || why.length < 8) {
    throw new AdminError(ADMIN_ERROR.GENERIC, "reason required");
  }
  return normalizeAdminChallenge(
    await rpc(
      "admin_update_challenge",
      {
        p_status: wanted,
        p_starts_at: startsAt || null,
        p_ends_at: endsAt || null,
        p_reason: why,
      },
      client
    )
  );
}

export async function fetchAdminLeague(client) {
  return normalizeAdminLeague(await rpc("admin_get_league", {}, client));
}

function clipLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function redactClipboardText(value) {
  return clipLine(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]")
    .replace(/\b(?:\+?\d[\d\s().-]{8,}\d)\b/g, "[redacted]");
}

function playerClip(player) {
  if (!player) return "—";
  const name = clipLine(player.displayName || player.username);
  const user = clipLine(player.username);
  if (name && user && name !== user) return `${name} (@${user})`;
  return name || user || "—";
}

function settled(result, fallback = "unavailable") {
  if (result.status === "fulfilled") return result.value;
  return fallback;
}

/**
 * Plain-text staff clipboard export. Never includes email, phone, tokens,
 * hands, engine_state, game_secrets, or legalMoves.
 */
export function formatAdminClipboardReport(input = {}) {
  const generatedAt = clipLine(input.generatedAt) || new Date().toISOString();
  const role = clipLine(input.role) || "unknown";
  const lines = [
    "LeoDomino Admin Dashboard report",
    `Generated: ${generatedAt}`,
    `Staff role: ${role}`,
    "",
  ];

  const warnings = Array.isArray(input.warnings) ? input.warnings.map(clipLine).filter(Boolean) : [];
  lines.push("== Warnings / status ==");
  if (warnings.length) {
    for (const warning of warnings) lines.push(`- ${warning}`);
  } else {
    lines.push("- none");
  }
  lines.push("");

  lines.push("== Overview ==");
  const overview = input.overview;
  if (!overview || overview === "unavailable") {
    lines.push("unavailable");
  } else {
    const cards = overviewCardsFromPayload(overview);
    for (const card of cards) {
      const value = card.unsupported || card.value == null ? "not available yet" : String(card.value);
      lines.push(`${card.id}: ${value}`);
    }
  }
  lines.push("");

  lines.push("== Users ==");
  const users = input.users;
  if (!users || users === "unavailable") {
    lines.push("unavailable");
  } else {
    lines.push(`total: ${users.total ?? 0}`);
    lines.push(`showing: ${(users.users || []).length} (offset ${users.offset ?? 0})`);
    for (const user of users.users || []) {
      const account = adminAccountStatus(user);
      const presence = adminPresenceState(user);
      lines.push(
        `- ${playerClip(user)} | RP ${user.rp ?? "—"} | ${user.wins ?? 0}W/${user.losses ?? 0}L | account ${account} | presence ${presence} | created ${user.createdAt || "—"}`
      );
    }
    if (!(users.users || []).length) lines.push("- none");
  }
  lines.push("");

  lines.push("== Live Matches ==");
  const live = input.liveMatches;
  if (!live || live === "unavailable") {
    lines.push("unavailable");
  } else {
    lines.push(`total: ${live.total ?? 0}`);
    for (const match of live.matches || []) {
      lines.push(
        `- ${playerClip(match.playerA)} vs ${playerClip(match.playerB)} | ${match.rulesetId || "—"} | ${match.rated ? "rated" : "unrated"} | ${match.adminStatus || match.matchStatus || "—"} | score ${match.scoreA ?? "—"}-${match.scoreB ?? "—"} | round ${match.round ?? "—"}`
      );
    }
    if (!(live.matches || []).length) lines.push("- none");
  }
  lines.push("");

  lines.push("== Top RP ==");
  const top = input.topRp;
  if (!top || top === "unavailable") {
    lines.push("unavailable");
  } else {
    lines.push(`total: ${top.total ?? 0}`);
    for (const player of top.players || []) {
      lines.push(
        `- #${player.rank ?? "—"} ${playerClip(player)} | RP ${player.rp ?? "—"} | ${player.wins ?? 0}W/${player.losses ?? 0}L | rated matches ${player.matchesPlayed ?? 0}`
      );
    }
    if (!(top.players || []).length) lines.push("- none");
  }
  lines.push("");

  lines.push("== Reports ==");
  const reports = input.reports;
  if (!reports || reports === "unavailable") {
    lines.push("unavailable");
  } else {
    lines.push(`total: ${reports.total ?? 0}`);
    for (const item of reports.items || []) {
      lines.push(
        `- ${item.status} | ${item.category} | ${playerClip(item.reporter)} vs ${playerClip(item.reported)} | ${item.createdAt || "—"} | ${redactClipboardText(item.body)}`
      );
    }
    if (!(reports.items || []).length) lines.push("- none");
  }
  lines.push("");

  lines.push("== Challenge ==");
  const challenge = input.challenge;
  if (!challenge || challenge === "unavailable") {
    lines.push("unavailable");
  } else {
    lines.push(`status: ${challenge.status || "coming_soon"}`);
    lines.push(`CP earning: ${challenge.cpEarningEnabled ? "ON" : "off"}`);
    lines.push(`target: ${challenge.qualificationCp ?? 5000} CP`);
    lines.push(`first prize: $${challenge.firstPrizeUsd ?? 300} US`);
    lines.push(`second prize: $${challenge.secondPrizeUsd ?? 200} US`);
    lines.push(`starts: ${challenge.startsAt || "—"}`);
    lines.push(`ends: ${challenge.endsAt || "—"}`);
    lines.push(`qualified players: ${(challenge.qualifiedPlayers || []).length}`);
  }
  lines.push("");

  lines.push("== League ==");
  const league = input.league;
  if (!league || league === "unavailable") {
    lines.push("unavailable");
  } else {
    lines.push(`status: ${league.status || "coming_soon"}`);
    lines.push(`season days: ${league.seasonDays ?? 60}`);
    lines.push(`starts: ${league.startsAt || "—"}`);
    lines.push(`ends: ${league.endsAt || "—"}`);
    lines.push(`leaderboard: ${(league.leaderboard || []).length ? String(league.leaderboard.length) : "empty"}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function fetchAdminClipboardReport({ role } = {}, client) {
  const [overview, users, liveMatches, topRp, reports, challenge, league] = await Promise.allSettled([
    fetchAdminOverview(client),
    fetchAdminUsers({ limit: ADMIN_PAGE_SIZE, offset: 0 }, client),
    fetchAdminLiveMatches({ limit: ADMIN_PAGE_SIZE, offset: 0 }, client),
    fetchAdminTopRp({ limit: ADMIN_PAGE_SIZE, offset: 0 }, client),
    fetchAdminReports({ limit: ADMIN_PAGE_SIZE, offset: 0 }, client),
    fetchAdminChallenge(client),
    fetchAdminLeague(client),
  ]);

  const overviewValue = settled(overview);
  const challengeValue = settled(challenge);
  const warnings = [];
  if (overviewValue !== "unavailable" && overviewValue?.globalOnlineUserCount == null) {
    warnings.push("Global Online Users is not available (no signed-in census).");
  }
  if (challengeValue !== "unavailable" && challengeValue?.cpEarningEnabled !== true) {
    warnings.push("Challenge CP earning is off.");
  }
  if (challengeValue !== "unavailable" && (challengeValue?.status || "coming_soon") === "coming_soon") {
    warnings.push("Challenge status is Coming Soon.");
  }

  return formatAdminClipboardReport({
    generatedAt: new Date().toISOString(),
    role,
    warnings,
    overview: overviewValue,
    users: settled(users),
    liveMatches: settled(liveMatches),
    topRp: settled(topRp),
    reports: settled(reports),
    challenge: challengeValue,
    league: settled(league),
  });
}
