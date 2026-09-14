/**
 * LeoPips module.
 *
 * Authenticated testers may import LeoPipsHomePage and LeoPipsStakePage.
 * FindMatchPage / OnlineGamePage / matchmaking.js must not import this.
 * Stake values stay local UI state until hosted settlement is activated.
 */

export {
  LEOPIPS_BIG_WIN_PAYOUT,
  LEOPIPS_HOME_PREVIEW,
  LEOPIPS_INITIAL_GRANT,
  LEOPIPS_LEDGER_KINDS,
  LEOPIPS_MIN_FIND_MATCH_STAKE,
  LEOPIPS_POPULAR_STAKE,
  LEOPIPS_PREVIEW_DEFAULT_BALANCE,
  LEOPIPS_PROGRESS_STEPS,
  LEOPIPS_REFERRAL_QUALIFYING_MATCHES,
  LEOPIPS_REFERRAL_REWARD,
  LEOPIPS_STAKE_TIERS,
  LEOPIPS_STYLE_IDS,
  LEOPIPS_TIMEOUT_MS,
  LEOPIPS_TIMEOUT_PENALTY,
  LEOPIPS_TIMEOUT_STRIKE_LIMIT,
  LEOPIPS_TIMEOUT_UI,
  LEOPIPS_TOP_REFERRAL_USD,
  canAffordLeoPipsStake,
  canEnterLeoPipsFindMatch,
  clampLeoPipsBalance,
  formatLeoPipsAmount,
  leoPipsEnabledStakes,
  isLeoPipsBigWin,
  isLeoPipsTimeoutMatchLoss,
  leoPipsCumulativeTimeoutPenalty,
  leoPipsPot,
  leoPipsStakeCardModel,
  leoPipsTimeoutPenaltyForStrike,
  settleLeoPipsAbandon,
  settleLeoPipsNormalWin,
  settleLeoPipsTimeoutPenalty,
  settleLeoPipsTimeoutStrike,
} from "./leopipsEconomy.js";
export { LEOPIPS_COPY } from "./leopipsCopy.js";
export {
  LEOPIPS_STAKE_COUNT_RULESETS,
  countLeoPipsJoinableStakePools,
  countsForLeoPipsStyle,
  emptyLeoPipsStakeCounts,
  formatLeoPipsRequestCountLabel,
  leoPipsRulesetIdForStyle,
  loadLeoPipsStakeRequestCounts,
} from "./leopipsStakeRequestCounts.js";
export {
  LEOPIPS_FORFEIT_POT_POLICY,
  LEOPIPS_TIMEOUT_POT_POLICY,
  LEOPIPS_REFERRAL_COUNT_FRIEND_MATCHES,
  LEOPIPS_REFERRAL_QUALIFYING_MATCHES as LEOPIPS_POLICY_REFERRAL_MATCHES,
  LEOPIPS_TIMEOUT_UNDER5_POLICY,
  isLeoPipsNormalPayoutReason,
  isLeoPipsPotPayoutReason,
  isLeoPipsPrestartAbortReason,
  isLeoPipsUnresolvedTerminalReason,
} from "./leopipsPolicy.js";
export {
  applyLeoPipsIdempotent,
  applyLeoPipsStakeDebit,
  applyLeoPipsTimeoutPenalty,
  signedLeoPipsBalance,
} from "./leopipsLedger.js";
export {
  LEOPIPS_LEVEL_FORMULA_FINALIZED,
  LEOPIPS_LEVEL_NOT_FROM_XP,
  PROGRESSION_LEVEL_MAX,
  PROGRESSION_RANK,
  PROGRESSION_XP,
  PROGRESSION_WINS_PER_LEVEL,
  leoPipsLevelFromBalance,
  leoPipsLevelFromXp,
  leoPipsMayAwardXp,
  leoPipsMayProgressLevel,
  progressionLevelFromQualifyingWins,
  progressionQualifyingWinCredit,
  progressionRankFromLevel,
  progressionWinProgress,
  progressionXpForResult,
} from "./leopipsProgress.js";
export {
  consumeMyLevelUpEvent,
  listMyPendingLevelUps,
  normalizeProgressionRow,
  readMyProgression,
} from "./leopipsProgressRead.js";
export { RankBadge } from "./RankBadge.jsx";
export { LEOPIPS_COIN_SRC, leoPipsCoinSrc } from "./leopipsAssets.js";
export { default as LeoPipsCoin } from "./LeoPipsCoin.jsx";
export { default as LeoPipsHomePage } from "./LeoPipsHomePage.jsx";
export { default as LeoPipsStakePage } from "./LeoPipsStakePage.jsx";
export { default as LeoPipsWinOverlay } from "./LeoPipsWinOverlay.jsx";
