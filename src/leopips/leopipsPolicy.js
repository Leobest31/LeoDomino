/**
 * Final LeoPips owner decisions.
 * Timeout may go negative (−5 penalties). Genuine completed pays full pot 2S.
 * Forfeit / abandon / timeout-win: winner +1.5S, retain 0.5S (non_completed_partial).
 * Referral +100 requires 3 public completed online matches. Friends do not count.
 */

export const LEOPIPS_REFERRAL_QUALIFYING_MATCHES = 3;

export const LEOPIPS_REFERRAL_REWARD_AMOUNT = 100;

/** Cash Invite & Win stays on its own 10-match / USD pipeline. */
export const LEOPIPS_REFERRAL_INDEPENDENT_OF_CASH_PRIZE = true;

/** Friend online matches do not count toward the LeoPips +100 threshold. */
export const LEOPIPS_REFERRAL_COUNT_FRIEND_MATCHES = false;

export const LEOPIPS_REFERRAL_DEFAULT_MATCH_KIND = "public";

export const LEOPIPS_POT_PAYOUT_REASONS = Object.freeze([
  "completed",
  "forfeit",
  "timeout",
  "abandon",
  "abandoned",
]);

export const LEOPIPS_NO_XP_REASONS = Object.freeze([
  "forfeit",
  "abandon",
  "abandoned",
  "timeout",
  "join_timeout",
  "aborted",
]);

/** Winner +1.5S; loser +0; game retains 0.5S (leopips_match_retentions). Applies to forfeit/abandon/timeout-win. */
export const LEOPIPS_FORFEIT_POT_POLICY = "forfeit_abandon_partial_1_5S";
export const LEOPIPS_TIMEOUT_POT_POLICY = "non_completed_partial_1_5S";

export const LEOPIPS_TIMEOUT_UNDER5_POLICY = "allow_negative";

export const LEOPIPS_SETTLEMENT_STATES = Object.freeze({
  ACCEPTED_LOBBY: "accepted_lobby",
  STAKE_DEBITED: "stake_debited",
  BOTH_JOINED_STARTED: "both_joined_started",
  GAMEPLAY_ACTIVE: "gameplay_active",
  TERMINAL: "terminal",
});

export function isLeoPipsNormalPayoutReason(finishReason) {
  return String(finishReason || "") === "completed";
}

export function isLeoPipsPotPayoutReason(finishReason) {
  return LEOPIPS_POT_PAYOUT_REASONS.includes(String(finishReason || ""));
}

export function isLeoPipsUnresolvedTerminalReason() {
  return false;
}

export function isLeoPipsPrestartAbortReason(finishReason) {
  return String(finishReason || "") === "join_timeout";
}

export function isLeoPipsInfrastructureAbort(finishReason, { winnerPresent } = {}) {
  if (String(finishReason || "") === "join_timeout") return true;
  return winnerPresent !== true && String(finishReason || "") === "abandoned";
}

export function leoPipsReferralFriendMatchesCount() {
  return false;
}

export function isLeoPipsQualifyingReferralMatch(match, referredId, attributedAt) {
  if (!match || !referredId) return false;
  if (match.status !== "finished") return false;
  if (match.finishReason !== "completed") return false;
  if (String(match.matchKind || "public") !== "public") return false;
  if (!match.finishedAt || (attributedAt && match.finishedAt < attributedAt)) return false;
  return match.playerA === referredId || match.playerB === referredId;
}

export function countLeoPipsQualifyingReferralMatches(matches, referredId, attributedAt) {
  return (matches || []).filter((match) =>
    isLeoPipsQualifyingReferralMatch(match, referredId, attributedAt)
  ).length;
}

export function leoPipsReferralRewardDue(qualifiedCount) {
  return Number(qualifiedCount) >= LEOPIPS_REFERRAL_QUALIFYING_MATCHES;
}
