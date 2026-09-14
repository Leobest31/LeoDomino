/**
 * LeoPips economy — isolated from live Global RP / Find Match.
 *
 * FindMatchPage, OnlineGamePage, and matchmaking.js must not import this.
 * Authenticated testers may use the stake UI; stake values stay local until
 * the owner activates hosted LeoPips settlement.
 *
 * Hosted SQL, Edge, and the testers URL stay on the current Elo RP online flow.
 *
 * Settlement (local helpers mirror authoritative hosted SQL):
 *   Normal completed: winner receives pot 2S; loser +0; house 0.
 *   Forfeit / abandon / timeout-win: winner +1.5S; loser +0; house retains 0.5S.
 *   These helpers never debit wallets — server settlement is authoritative.
 *
 * Timeout (30s):
 *   Strike 1: auto-play, -5 LeoPips.
 *   Strike 2: auto-play, another -5 (cumulative -10).
 *   Strike 3: match loss. Do NOT deduct a third -5.
 *
 * Referral (UI/architecture only — do not change hosted Invite & Win):
 *   +100 LeoPips to the inviter after 3 qualifying completed online matches.
 *   Friend-match counting is an owner decision and is not invented here.
 */

export const LEOPIPS_CURRENCY = "LEOPIPS";

/** Server must reject any other stake. Extensible without rewriting the page. */
export const LEOPIPS_STAKE_TIERS = Object.freeze([20, 50, 100, 150]);

export const LEOPIPS_PLAYERS_PER_MATCH = 2;

export const LEOPIPS_MIN_FIND_MATCH_STAKE = 20;

export const LEOPIPS_POPULAR_STAKE = 50;

export const LEOPIPS_TIMEOUT_MS = 30_000;

export const LEOPIPS_TIMEOUT_PENALTY = 5;

export const LEOPIPS_TIMEOUT_STRIKE_LIMIT = 3;

/** Strikes that deduct LeoPips. Strike 3 is match loss with no extra fee. */
export const LEOPIPS_TIMEOUT_PENALTY_STRIKES = Object.freeze([1, 2]);

/** First BIG WIN presentation threshold: total payout (pot) of 300. */
export const LEOPIPS_BIG_WIN_PAYOUT = 300;

/** Planned credit per validated referral. Hosted Invite & Win is unchanged. */
export const LEOPIPS_REFERRAL_REWARD = 100;

/** Required completed qualifying online matches before +100. Not the Invite & Win 10-match prize. */
export const LEOPIPS_REFERRAL_QUALIFYING_MATCHES = 3;

/** Isolated Home preview only. Promotional USD prize — not a LeoPips amount. */
export const LEOPIPS_TOP_REFERRAL_USD = 63;

/** Planned hosted starting balance. Preview default only until SQL is applied. */
export const LEOPIPS_INITIAL_GRANT = 1000;

/** Isolated preview fixture. Query `?balance=` still overrides. */
export const LEOPIPS_PREVIEW_DEFAULT_BALANCE = LEOPIPS_INITIAL_GRANT;

/**
 * Isolated Home preview fixtures. Not hosted XP / League / wallet data.
 * Level is not derived from LeoPips.
 */
export const LEOPIPS_HOME_PREVIEW = Object.freeze({
  level: 12,
  xp: 2450,
  xpNext: 3000,
  xpFill: 82,
  division: "GOLD II",
  season: 1,
  leagueFill: 75,
});

export const LEOPIPS_STYLE_IDS = Object.freeze(["classic", "haitian", "american"]);

export const LEOPIPS_STYLE_TITLES = Object.freeze({
  classic: "CLASSIC DOMINO",
  haitian: "HAITIAN DOMINO",
  american: "AMERICAN DOMINO",
});

export const LEOPIPS_PROGRESS_STEPS = Object.freeze([
  Object.freeze({ id: "playOnline", label: "Play Online", state: "completed" }),
  Object.freeze({ id: "chooseStake", label: "Choose Stake", state: "active" }),
  Object.freeze({ id: "findMatch", label: "Find Match", state: "upcoming" }),
]);

export const LEOPIPS_LEDGER_KINDS = Object.freeze([
  "initial_balance",
  "stake_reserved",
  "stake_released",
  "match_win",
  "match_loss",
  "abandon_loss",
  "abandon_reward",
  "game_retention",
  "timeout_penalty",
  "referral_reward",
  "admin_adjustment",
  "migration_from_rp",
]);

/**
 * Timeout UI states for a later isolated overlay. Not hosted accounting.
 * Strike 3 ends the match and does not deduct another 5 LeoPips.
 */
export const LEOPIPS_TIMEOUT_UI = Object.freeze({
  1: Object.freeze({
    strike: 1,
    autoPlay: true,
    penalty: LEOPIPS_TIMEOUT_PENALTY,
    cumulative: LEOPIPS_TIMEOUT_PENALTY,
    matchLoss: false,
  }),
  2: Object.freeze({
    strike: 2,
    autoPlay: true,
    penalty: LEOPIPS_TIMEOUT_PENALTY,
    cumulative: LEOPIPS_TIMEOUT_PENALTY * 2,
    matchLoss: false,
  }),
  3: Object.freeze({
    strike: 3,
    autoPlay: false,
    penalty: 0,
    cumulative: LEOPIPS_TIMEOUT_PENALTY * 2,
    matchLoss: true,
  }),
});

export function isAllowedLeoPipsStake(stake) {
  return LEOPIPS_STAKE_TIERS.includes(Number(stake));
}

export function isLeoPipsStyleId(styleId) {
  return LEOPIPS_STYLE_IDS.includes(String(styleId || ""));
}

export function leoPipsStyleTitle(styleId) {
  const id = String(styleId || "classic");
  return LEOPIPS_STYLE_TITLES[id] || LEOPIPS_STYLE_TITLES.classic;
}

export function nextLeoPipsStyleId(styleId) {
  const index = LEOPIPS_STYLE_IDS.indexOf(String(styleId || "classic"));
  const next = index < 0 ? 0 : (index + 1) % LEOPIPS_STYLE_IDS.length;
  return LEOPIPS_STYLE_IDS[next];
}

export function leoPipsPot(stake, players = LEOPIPS_PLAYERS_PER_MATCH) {
  return Number(stake) * players;
}

/** Available balance cannot be negative. Non-finite values become 0. */
export function clampLeoPipsBalance(availableBalance) {
  const balance = Number(availableBalance);
  if (!Number.isFinite(balance) || balance < 0) return 0;
  return balance;
}

export function formatLeoPipsAmount(amount) {
  return new Intl.NumberFormat("en-US").format(clampLeoPipsBalance(amount));
}

export function canAffordLeoPipsStake(availableBalance, stake) {
  const balance = clampLeoPipsBalance(availableBalance);
  const s = Number(stake);
  if (!Number.isFinite(s)) return false;
  return balance >= s && isAllowedLeoPipsStake(s);
}

export function canEnterLeoPipsFindMatch(availableBalance) {
  return canAffordLeoPipsStake(availableBalance, LEOPIPS_MIN_FIND_MATCH_STAKE);
}

/** UI gating only. Does not debit or change matchmaking. */
export function leoPipsEnabledStakes(availableBalance) {
  return LEOPIPS_STAKE_TIERS.filter((stake) => canAffordLeoPipsStake(availableBalance, stake));
}

export function isLeoPipsBigWin(payout) {
  return Number(payout) >= LEOPIPS_BIG_WIN_PAYOUT;
}

export function leoPipsTimeoutPenaltyForStrike(strike) {
  const n = Number(strike);
  if (LEOPIPS_TIMEOUT_PENALTY_STRIKES.includes(n)) return LEOPIPS_TIMEOUT_PENALTY;
  return 0;
}

export function leoPipsCumulativeTimeoutPenalty(strikeCount) {
  const n = Number(strikeCount);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(LEOPIPS_TIMEOUT_PENALTY_STRIKES.length, Math.floor(n)) * LEOPIPS_TIMEOUT_PENALTY;
}

export function isLeoPipsTimeoutMatchLoss(strike) {
  return Number(strike) >= LEOPIPS_TIMEOUT_STRIKE_LIMIT;
}

/**
 * Normal completion. Both players staked S. Winner receives the pot 2S.
 * Winner net +S, loser net -S. House: 0.
 */
export function settleLeoPipsNormalWin(stake) {
  const s = Number(stake);
  if (!isAllowedLeoPipsStake(s)) {
    throw new Error("invalid LeoPips stake");
  }
  const pot = leoPipsPot(s);
  return {
    kind: "normal",
    stake: s,
    pot,
    winnerPayout: pot,
    winnerNet: s,
    loserNet: -s,
    houseRetention: 0,
    bigWin: pot >= LEOPIPS_BIG_WIN_PAYOUT,
  };
}

/**
 * Authoritative loss after gameplay start and successful debit:
 * forfeit, abandon, or third-timeout match loss.
 * Winner/opponent +1.5S; abandoner/loser +0; house retains 0.5S.
 * Local/sim/display only — does not override server settlement.
 */
export function settleLeoPipsAbandon(stake) {
  const s = Number(stake);
  if (!isAllowedLeoPipsStake(s)) {
    throw new Error("invalid LeoPips stake");
  }
  const pot = leoPipsPot(s);
  const winnerPayout = (s * 3) / 2;
  const houseRetention = s / 2;
  return {
    kind: "authoritative_loss",
    stake: s,
    pot,
    winnerPayout,
    winnerNet: winnerPayout - s,
    loserNet: -s,
    loserRefund: 0,
    abandonerNet: -s,
    opponentPayout: winnerPayout,
    opponentNet: winnerPayout - s,
    houseRetention,
    bigWin: winnerPayout >= LEOPIPS_BIG_WIN_PAYOUT,
    authoritative: true,
    ownerDecisionRequired: false,
  };
}

/**
 * Per 30s turn-timeout auto-play: -5 LeoPips on strikes 1 and 2.
 * Strike 3 is match loss and must not call this for a third deduction.
 * Authoritative timeout penalties apply even when balance is below 5.
 */
export function settleLeoPipsTimeoutPenalty(availableBalance) {
  const balance = Number(availableBalance);
  const current = Number.isFinite(balance) ? balance : 0;
  return {
    kind: "timeout_penalty",
    amount: LEOPIPS_TIMEOUT_PENALTY,
    applied: true,
    reason: null,
    nextBalance: current - LEOPIPS_TIMEOUT_PENALTY,
  };
}

export function settleLeoPipsTimeoutStrike(strike, availableBalance) {
  const n = Number(strike);
  if (isLeoPipsTimeoutMatchLoss(n)) {
    return {
      kind: "timeout_match_loss",
      strike: n,
      amount: 0,
      applied: false,
      matchLoss: true,
      cumulative: leoPipsCumulativeTimeoutPenalty(LEOPIPS_TIMEOUT_PENALTY_STRIKES.length),
      nextBalance: Number.isFinite(Number(availableBalance)) ? Number(availableBalance) : 0,
    };
  }
  const penalty = settleLeoPipsTimeoutPenalty(availableBalance);
  return {
    ...penalty,
    strike: n,
    matchLoss: false,
    cumulative: leoPipsCumulativeTimeoutPenalty(n),
  };
}

export function leoPipsStakeCardModel(stake, availableBalance, styleLabel) {
  const s = Number(stake);
  const pot = leoPipsPot(s);
  const affordable = canAffordLeoPipsStake(availableBalance, s);
  return {
    stake: s,
    label: `${s} LEOPIPS`,
    players: LEOPIPS_PLAYERS_PER_MATCH,
    equation: `${s} + ${s}`,
    pot,
    potLabel: `${pot} LEOPIPS`,
    styleLabel: styleLabel || "",
    popular: s === LEOPIPS_POPULAR_STAKE,
    affordable,
    disabled: !affordable,
  };
}
