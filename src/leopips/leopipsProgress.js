/**
 * Owner-approved LeoDomino LVL / XP / Rank progression.
 * LVL is NEVER derived from XP, LeoPips, stake, ledger, or duration.
 * Formula is FINAL — do not invent alternate curves.
 */

export const LEOPIPS_LEVEL_FORMULA_FINALIZED = true;

export const LEOPIPS_LEVEL_NOT_FROM_BALANCE = true;
export const LEOPIPS_LEVEL_NOT_FROM_STAKE = true;
export const LEOPIPS_LEVEL_NOT_FROM_LEDGER = true;
export const LEOPIPS_LEVEL_NOT_FROM_XP = true;

export const PROGRESSION_LEVEL_MAX = 100;
export const PROGRESSION_WINS_PER_LEVEL = 10;

/** Official rank category names (keep BRONZE/GOLD/DIAMOND across locales). */
export const PROGRESSION_RANK = Object.freeze({
  NONE: null,
  BRONZE: "BRONZE",
  GOLD: "GOLD",
  DIAMOND: "DIAMOND",
});

export const PROGRESSION_XP = Object.freeze({
  PUBLIC_COMPLETED_WIN: 25,
  PUBLIC_COMPLETED_LOSS: 10,
  FRIEND_COMPLETED_WIN: 10,
  FRIEND_COMPLETED_LOSS: 5,
});

/**
 * Genuine completed results may award XP. Forfeit/abandon/timeout/join_timeout/aborted = 0.
 */
export function leoPipsMayAwardXp({ finishReason, abandoned } = {}) {
  if (abandoned === true) return false;
  const reason = String(finishReason || "");
  if (
    reason === "forfeit" ||
    reason === "abandon" ||
    reason === "abandoned" ||
    reason === "timeout" ||
    reason === "join_timeout" ||
    reason === "aborted" ||
    reason === "cancelled"
  ) {
    return false;
  }
  return reason === "completed";
}

/**
 * Qualifying Level wins: genuine completed PUBLIC online wins only.
 * Friend completed may get XP but never Level credit.
 */
export function leoPipsMayProgressLevel({ finishReason, matchKind, abandoned } = {}) {
  if (!leoPipsMayAwardXp({ finishReason, abandoned })) return false;
  if (String(matchKind || "") === "friend") return false;
  return String(matchKind || "") === "public" || String(matchKind || "") === "";
}

export function progressionLevelFromQualifyingWins(wins) {
  const n = Math.max(0, Math.floor(Number(wins) || 0));
  return Math.min(PROGRESSION_LEVEL_MAX, Math.floor(n / PROGRESSION_WINS_PER_LEVEL));
}

export function progressionRankFromLevel(level) {
  const lvl = Math.max(0, Math.floor(Number(level) || 0));
  if (lvl <= 0) return PROGRESSION_RANK.NONE;
  if (lvl <= 19) return PROGRESSION_RANK.BRONZE;
  if (lvl <= 49) return PROGRESSION_RANK.GOLD;
  if (lvl <= PROGRESSION_LEVEL_MAX) return PROGRESSION_RANK.DIAMOND;
  return PROGRESSION_RANK.DIAMOND;
}

/**
 * Within-level qualifying-win progress toward next Level.
 * At LVL 100: maxed — never show progress toward LVL 101.
 */
export function progressionWinProgress(qualifyingWins) {
  const wins = Math.max(0, Math.floor(Number(qualifyingWins) || 0));
  const level = progressionLevelFromQualifyingWins(wins);
  if (level >= PROGRESSION_LEVEL_MAX) {
    return {
      level,
      rank: progressionRankFromLevel(level),
      winsInLevel: 0,
      winsNeeded: PROGRESSION_WINS_PER_LEVEL,
      nextLevel: null,
      fillPercent: 100,
      maxed: true,
    };
  }
  const winsInLevel = wins % PROGRESSION_WINS_PER_LEVEL;
  const nextLevel = level + 1;
  return {
    level,
    rank: progressionRankFromLevel(level),
    winsInLevel,
    winsNeeded: PROGRESSION_WINS_PER_LEVEL,
    nextLevel,
    fillPercent: Math.round((winsInLevel / PROGRESSION_WINS_PER_LEVEL) * 100),
    maxed: false,
  };
}

/**
 * Exact XP for one player on a finished match. 0 when not eligible.
 * Does not invent loss XP beyond owner matrix.
 */
export function progressionXpForResult({
  finishReason,
  matchKind,
  didWin,
  abandoned,
} = {}) {
  if (!leoPipsMayAwardXp({ finishReason, abandoned })) return 0;
  const friend = String(matchKind || "") === "friend";
  if (didWin) {
    return friend ? PROGRESSION_XP.FRIEND_COMPLETED_WIN : PROGRESSION_XP.PUBLIC_COMPLETED_WIN;
  }
  return friend ? PROGRESSION_XP.FRIEND_COMPLETED_LOSS : PROGRESSION_XP.PUBLIC_COMPLETED_LOSS;
}

export function progressionQualifyingWinCredit({
  finishReason,
  matchKind,
  didWin,
  abandoned,
} = {}) {
  if (!didWin) return 0;
  if (!leoPipsMayProgressLevel({ finishReason, matchKind, abandoned })) return 0;
  return 1;
}

export function leoPipsLevelFromBalance() {
  return null;
}

export function leoPipsLevelFromStake() {
  return null;
}

export function leoPipsLevelFromLedger() {
  return null;
}

export function leoPipsLevelFromXp() {
  return null;
}
