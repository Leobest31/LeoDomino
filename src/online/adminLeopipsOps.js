/**
 * Read-only Admin LeoPips presentation helpers.
 * Does not query wallets, ledgers, or matches tables.
 * Does not invent RP↔LeoPips conversions or mutation controls.
 */

export const ADMIN_LEOPIPS_STAKES = Object.freeze([20, 50, 100, 150]);

export const ADMIN_BLOCKED_READ_RPCS = Object.freeze({
  matchHistory: "admin_list_matches",
  matchDetailLedger: "admin_get_match_leopips",
  wallets: "admin_get_leopips_overview",
  negativeWallets: "admin_list_negative_leopips",
  stakeActivity: "admin_list_leopips_stake_activity",
  referrals: "admin_list_leopips_referrals",
  timeoutPenalties: "admin_list_timeout_penalties",
  settlementAnomalies: "admin_list_leopips_anomalies",
  matchmakingHealth: "admin_list_open_match_requests",
  playerWallet: "admin_get_player_leopips",
});

export const ADMIN_OVERVIEW_DRILL = Object.freeze({
  totalAccounts: { section: "users", usersFilter: "all" },
  newToday: { section: "users", usersFilter: "newToday" },
  last7Days: { section: "users", usersFilter: "last7" },
  last30Days: { section: "users", usersFilter: "last30" },
  activeMatches: { section: "liveMatches", liveView: "matches" },
  activeMatchPlayers: { section: "liveMatches", liveView: "players" },
  deletedAccounts: { section: "users", usersFilter: "deleted" },
  globalOnlineUsers: { section: "users", usersFilter: "presence" },
});

export function toStoredAdminStake(value) {
  const n = Number(value);
  return Number.isInteger(n) && ADMIN_LEOPIPS_STAKES.includes(n) ? n : null;
}

export function adminStakeLabel(value) {
  const stake = toStoredAdminStake(value);
  return stake == null ? null : String(stake);
}

export function adminExpectedPot(value) {
  const stake = toStoredAdminStake(value);
  return stake == null ? null : stake * 2;
}

export function adminMatchEconomyKind(match) {
  const kind = String(match?.matchKind || "");
  const stake = toStoredAdminStake(match?.stakePips);
  if (kind === "friend") return "friend";
  if (kind === "private") return "private";
  if (stake != null) return "leopips_public";
  if (kind === "public") return "public_unstaked";
  return "legacy";
}

export function adminMatchEconomyI18nKey(kind) {
  if (kind === "friend") return "admin.matchKindFriend";
  if (kind === "private") return "admin.matchKindPrivate";
  if (kind === "leopips_public") return "admin.matchKindLeoPipsPublic";
  if (kind === "public_unstaked") return "admin.matchKindPublicNoStake";
  return "admin.matchKindLegacy";
}

export function adminOccupancyKind(match) {
  if (match?.adminStatus === "disconnected") return "stale";
  if (match?.playerA?.stale || match?.playerB?.stale) return "stale";
  if (match?.adminStatus === "live" || match?.adminStatus === "waiting") return "real";
  return "unknown";
}

export function adminOccupancyI18nKey(kind) {
  if (kind === "real") return "admin.occupancyReal";
  if (kind === "stale") return "admin.occupancyStale";
  return "admin.occupancyUnknown";
}

export function adminElapsedSeconds(startedAt, nowMs = Date.now()) {
  const start = Date.parse(String(startedAt ?? ""));
  if (!Number.isFinite(start) || nowMs < start) return 0;
  return Math.floor((nowMs - start) / 1000);
}

export function isUtcDayOffset(iso, daysBack, nowMs = Date.now()) {
  const created = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(created)) return false;
  const start = new Date(nowMs);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - daysBack);
  return created >= start.getTime();
}

export function userPassesAdminDirectoryFilter(user, filter, nowMs = Date.now()) {
  if (filter === "deleted") return Boolean(user?.deletedAt);
  if (filter === "newToday") return !user?.deletedAt && isUtcDayOffset(user?.createdAt, 0, nowMs);
  if (filter === "last7") return isUtcDayOffset(user?.createdAt, 7, nowMs);
  if (filter === "last30") return isUtcDayOffset(user?.createdAt, 30, nowMs);
  return true;
}

export function flattenLiveMatchPlayers(matches = []) {
  const rows = [];
  for (const match of matches) {
    if (!match?.matchId) continue;
    for (const [seat, player] of [
      [0, match.playerA],
      [1, match.playerB],
    ]) {
      if (!player?.playerId) continue;
      const opponent = seat === 0 ? match.playerB : match.playerA;
      rows.push({
        playerId: player.playerId,
        displayName: player.displayName || "",
        username: player.username || "",
        matchId: match.matchId,
        opponentName: opponent?.displayName || opponent?.username || "",
        rulesetId: match.rulesetId || "",
        stakePips: match.stakePips ?? null,
        matchKind: match.matchKind || "public",
        adminStatus: match.adminStatus,
        occupancy: adminOccupancyKind(match),
        createdAt: match.createdAt,
        lastSeenAt: player.lastSeenAt,
        stale: player.stale === true,
      });
    }
  }
  return rows;
}

export function looksLikeAdminMatchId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
}

export const LEOPIPS_REFERRAL_REQUIRED = 3;

export const LEOPIPS_REFERRAL_REWARD_AMOUNT = 100;

export const LEOPIPS_REFERRAL_REWARD_KEY_PREFIX = "referral_reward:";

export function referralProgressValue(count) {
  const n = Number(count);
  if (!Number.isInteger(n) || n < 0) return 0;
  return Math.min(n, LEOPIPS_REFERRAL_REQUIRED);
}

export function referralProgressLabel(count) {
  return `${referralProgressValue(count)} / ${LEOPIPS_REFERRAL_REQUIRED}`;
}

const REFERRAL_REWARD_KEY = /^referral_reward:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function hasLeoPipsReferralRewardProof(row) {
  if (!row || row.rewarded !== true) return false;
  if (row.rewardAmount !== LEOPIPS_REFERRAL_REWARD_AMOUNT) return false;
  const key = String(row.rewardIdempotencyKey || "");
  if (key && !REFERRAL_REWARD_KEY.test(key)) return false;
  return true;
}

/**
 * LeoPips status only. Invite & Win `validated` (10-match cash) is never +100 proof.
 * 3/3 is not issued unless the referral_reward ledger row exists.
 */
export function leoPipsReferralStatus(row) {
  if (row?.inviteWinStatus === "rejected" || row?.validationStatus === "rejected") {
    return "rejected";
  }
  if (hasLeoPipsReferralRewardProof(row)) return "issued";
  if (referralProgressValue(row?.qualifyingCount ?? row?.progress) >= LEOPIPS_REFERRAL_REQUIRED) {
    return "qualified";
  }
  return "in_progress";
}

export function leoPipsReferralStatusI18nKey(status) {
  if (status === "issued") return "admin.referralRewardIssued";
  if (status === "qualified") return "admin.referralQualifiedPending";
  if (status === "rejected") return "admin.referralRejected";
  return "admin.referralInProgress";
}

export function leoPipsRewardI18nKey(row) {
  if (hasLeoPipsReferralRewardProof(row)) return "admin.plus100Issued";
  if (leoPipsReferralStatus(row) === "qualified") return "admin.referralRewardPending";
  return "admin.plus100NotIssued";
}

export function leoPipsReferralIssuedAmount(row) {
  return hasLeoPipsReferralRewardProof(row) ? LEOPIPS_REFERRAL_REWARD_AMOUNT : 0;
}

/**
 * Read-only backfill candidate classification. Does not credit wallets.
 * Deleted/tombstoned parties require an explicit policy decision.
 */
export function classifyLeoPipsReferralBackfillCandidate(row = {}) {
  const qualifyingCount = Number(row.qualifyingCount);
  const existingRewardRows = Number(row.existingRewardRows) || 0;
  const inviterDeleted = row.inviterDeleted === true;
  const referredDeleted = row.referredDeleted === true;
  const inviterWallet = row.inviterWallet;
  const hasWallet = inviterWallet != null && Number.isFinite(Number(inviterWallet));
  const alreadyRewarded = existingRewardRows > 0 || row.hasPlus100Ledger === true;

  if (!Number.isFinite(qualifyingCount) || qualifyingCount < LEOPIPS_REFERRAL_REQUIRED) {
    return {
      eligibility: "FAIL",
      reason: "below_threshold",
      proposedCredit: 0,
      projectedWallet: hasWallet ? Number(inviterWallet) : null,
    };
  }
  if (alreadyRewarded) {
    return {
      eligibility: "FAIL",
      reason: "already_rewarded",
      proposedCredit: 0,
      projectedWallet: hasWallet ? Number(inviterWallet) : null,
    };
  }
  if (!row.inviterPlayerId) {
    return {
      eligibility: "FAIL",
      reason: "inviter_missing",
      proposedCredit: 0,
      projectedWallet: null,
    };
  }
  if (inviterDeleted || referredDeleted) {
    return {
      eligibility: "POLICY DECISION REQUIRED",
      reason: "deleted_or_tombstoned_party",
      proposedCredit: LEOPIPS_REFERRAL_REWARD_AMOUNT,
      projectedWallet: hasWallet ? Number(inviterWallet) + LEOPIPS_REFERRAL_REWARD_AMOUNT : null,
    };
  }
  if (!hasWallet) {
    return {
      eligibility: "FAIL",
      reason: "inviter_wallet_missing",
      proposedCredit: 0,
      projectedWallet: null,
    };
  }
  return {
    eligibility: "PASS",
    reason: "eligible_for_plus100",
    proposedCredit: LEOPIPS_REFERRAL_REWARD_AMOUNT,
    projectedWallet: Number(inviterWallet) + LEOPIPS_REFERRAL_REWARD_AMOUNT,
  };
}

export function summarizeLeoPipsReferrals(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const seen = new Set();
  let inProgress = 0;
  let qualified = 0;
  let pendingRewards = 0;
  let issuedRewards = 0;
  let issuedAmount = 0;
  let rejected = 0;
  for (const row of list) {
    const id = row?.referralId || "";
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    const status = leoPipsReferralStatus(row);
    if (status === "rejected") {
      rejected += 1;
      continue;
    }
    if (status === "issued") {
      qualified += 1;
      issuedRewards += 1;
      issuedAmount += leoPipsReferralIssuedAmount(row);
      continue;
    }
    if (status === "qualified") {
      qualified += 1;
      pendingRewards += 1;
      continue;
    }
    inProgress += 1;
  }
  return {
    totalReferrals: inProgress + qualified + rejected,
    inProgress,
    qualified,
    pendingRewards,
    issuedRewards,
    issuedAmount,
    rejected,
  };
}

export function searchLeoPipsReferrals(rows, query) {
  const wanted = String(query || "").trim().toLowerCase();
  const list = Array.isArray(rows) ? rows : [];
  if (!wanted) return list.slice();
  return list.filter((row) => {
    const inviterName = String(row?.inviter?.displayName || "").toLowerCase();
    const inviterUser = String(row?.inviter?.username || "").toLowerCase();
    const referredName = String(row?.referred?.displayName || "").toLowerCase();
    const referredUser = String(row?.referred?.username || "").toLowerCase();
    return (
      inviterName.includes(wanted) ||
      inviterUser.includes(wanted) ||
      referredName.includes(wanted) ||
      referredUser.includes(wanted)
    );
  });
}

export function aggregateLeoPipsReferrer(rows, referrerId) {
  const id = String(referrerId || "");
  const mine = (Array.isArray(rows) ? rows : []).filter((row) => row?.inviter?.playerId === id);
  const summary = summarizeLeoPipsReferrals(mine);
  return {
    referrer: mine[0]?.inviter || { playerId: id, displayName: "", username: "" },
    totalReferred: summary.totalReferrals,
    ...summary,
  };
}

export function hasAdminMutationControls(source) {
  return /creditLeoPips|debitLeoPips|settleMatch|admin_credit|admin_debit|_leopips_credit|_leopips_debit/.test(
    String(source || "")
  );
}
