/**
 * LeoPips settlement formulas. Isolated: does not touch live RP.
 * Run: node src/leopips/leopipsEconomy.test.js
 */
import assert from "node:assert/strict";
import {
  LEOPIPS_BIG_WIN_PAYOUT,
  LEOPIPS_HOME_PREVIEW,
  LEOPIPS_INITIAL_GRANT,
  LEOPIPS_MIN_FIND_MATCH_STAKE,
  LEOPIPS_POPULAR_STAKE,
  LEOPIPS_PREVIEW_DEFAULT_BALANCE,
  LEOPIPS_REFERRAL_QUALIFYING_MATCHES,
  LEOPIPS_REFERRAL_REWARD,
  LEOPIPS_STAKE_TIERS,
  LEOPIPS_TIMEOUT_MS,
  LEOPIPS_TIMEOUT_PENALTY,
  LEOPIPS_TIMEOUT_STRIKE_LIMIT,
  LEOPIPS_TIMEOUT_UI,
  LEOPIPS_TOP_REFERRAL_USD,
  canAffordLeoPipsStake,
  canEnterLeoPipsFindMatch,
  clampLeoPipsBalance,
  formatLeoPipsAmount,
  isLeoPipsBigWin,
  isLeoPipsTimeoutMatchLoss,
  leoPipsCumulativeTimeoutPenalty,
  leoPipsEnabledStakes,
  leoPipsPot,
  leoPipsStakeCardModel,
  leoPipsTimeoutPenaltyForStrike,
  settleLeoPipsAbandon,
  settleLeoPipsNormalWin,
  settleLeoPipsTimeoutPenalty,
  settleLeoPipsTimeoutStrike,
} from "./leopipsEconomy.js";

assert.deepEqual([...LEOPIPS_STAKE_TIERS], [20, 50, 100, 150]);
assert.equal(LEOPIPS_MIN_FIND_MATCH_STAKE, 20);
assert.equal(LEOPIPS_POPULAR_STAKE, 50);
assert.equal(LEOPIPS_TIMEOUT_PENALTY, 5);
assert.equal(LEOPIPS_TIMEOUT_STRIKE_LIMIT, 3);
assert.equal(LEOPIPS_TIMEOUT_MS, 30_000);
assert.equal(LEOPIPS_BIG_WIN_PAYOUT, 300);
assert.equal(LEOPIPS_REFERRAL_REWARD, 100);
assert.equal(LEOPIPS_REFERRAL_QUALIFYING_MATCHES, 3);
assert.equal(LEOPIPS_TOP_REFERRAL_USD, 63);
assert.equal(LEOPIPS_HOME_PREVIEW.level, 12);
assert.equal(LEOPIPS_HOME_PREVIEW.xp, 2450);
assert.equal(LEOPIPS_HOME_PREVIEW.xpNext, 3000);
assert.notEqual(LEOPIPS_HOME_PREVIEW.level, LEOPIPS_PREVIEW_DEFAULT_BALANCE);
assert.equal(LEOPIPS_INITIAL_GRANT, 1000);
assert.equal(LEOPIPS_PREVIEW_DEFAULT_BALANCE, 1000);
assert.equal(formatLeoPipsAmount(LEOPIPS_PREVIEW_DEFAULT_BALANCE), "1,000");

{
  assert.equal(leoPipsPot(20), 40);
  assert.equal(leoPipsPot(50), 100);
  assert.equal(leoPipsPot(100), 200);
  assert.equal(leoPipsPot(150), 300);
}

{
  const n20 = settleLeoPipsNormalWin(20);
  assert.equal(n20.winnerPayout, 40);
  assert.equal(n20.winnerNet, 20);
  assert.equal(n20.loserNet, -20);
  assert.equal(n20.houseRetention, 0);
  assert.equal(n20.bigWin, false);

  const n150 = settleLeoPipsNormalWin(150);
  assert.equal(n150.winnerPayout, 300);
  assert.equal(n150.winnerNet, 150);
  assert.equal(n150.loserNet, -150);
  assert.equal(n150.bigWin, true);
  assert.equal(isLeoPipsBigWin(n150.winnerPayout), true);
  assert.equal(isLeoPipsBigWin(299), false);
  assert.equal(isLeoPipsBigWin(300), true);
}

{
  const a20 = settleLeoPipsAbandon(20);
  assert.equal(a20.authoritative, true);
  assert.equal(a20.winnerPayout, 30);
  assert.equal(a20.loserRefund, 0);
  assert.equal(a20.houseRetention, 10);
  assert.equal(a20.abandonerNet, -20);
  assert.equal(a20.opponentNet, 10);

  const a50 = settleLeoPipsAbandon(50);
  assert.equal(a50.winnerPayout, 75);
  assert.equal(a50.loserRefund, 0);
  assert.equal(a50.houseRetention, 25);

  const a100 = settleLeoPipsAbandon(100);
  assert.equal(a100.winnerPayout, 150);
  assert.equal(a100.houseRetention, 50);
  assert.equal(a100.opponentNet, 50);

  const a150 = settleLeoPipsAbandon(150);
  assert.equal(a150.winnerPayout, 225);
  assert.equal(a150.loserRefund, 0);
  assert.equal(a150.houseRetention, 75);
}

{
  const ok = settleLeoPipsTimeoutPenalty(500);
  assert.equal(ok.applied, true);
  assert.equal(ok.nextBalance, 495);
  const floor = settleLeoPipsTimeoutPenalty(3);
  assert.equal(floor.applied, true);
  assert.equal(floor.nextBalance, -2);
  assert.equal(settleLeoPipsTimeoutPenalty(5).nextBalance, 0);
  assert.equal(settleLeoPipsTimeoutPenalty(0).nextBalance, -5);
}

{
  assert.equal(leoPipsTimeoutPenaltyForStrike(1), 5);
  assert.equal(leoPipsTimeoutPenaltyForStrike(2), 5);
  assert.equal(leoPipsTimeoutPenaltyForStrike(3), 0);
  assert.equal(leoPipsCumulativeTimeoutPenalty(1), 5);
  assert.equal(leoPipsCumulativeTimeoutPenalty(2), 10);
  assert.equal(leoPipsCumulativeTimeoutPenalty(3), 10);
  assert.equal(isLeoPipsTimeoutMatchLoss(3), true);
  assert.equal(isLeoPipsTimeoutMatchLoss(2), false);

  const t1 = settleLeoPipsTimeoutStrike(1, 80);
  assert.equal(t1.amount, 5);
  assert.equal(t1.matchLoss, false);
  assert.equal(t1.nextBalance, 75);

  const t2 = settleLeoPipsTimeoutStrike(2, 75);
  assert.equal(t2.amount, 5);
  assert.equal(t2.cumulative, 10);
  assert.equal(t2.matchLoss, false);

  const t3 = settleLeoPipsTimeoutStrike(3, 70);
  assert.equal(t3.kind, "timeout_match_loss");
  assert.equal(t3.amount, 0);
  assert.equal(t3.matchLoss, true);
  assert.equal(t3.cumulative, 10);
  assert.equal(t3.nextBalance, 70);

  assert.equal(LEOPIPS_TIMEOUT_UI[1].penalty, 5);
  assert.equal(LEOPIPS_TIMEOUT_UI[2].cumulative, 10);
  assert.equal(LEOPIPS_TIMEOUT_UI[3].penalty, 0);
  assert.equal(LEOPIPS_TIMEOUT_UI[3].matchLoss, true);
}

{
  assert.equal(clampLeoPipsBalance(-12), 0);
  assert.equal(clampLeoPipsBalance(Number.NaN), 0);
  assert.equal(canAffordLeoPipsStake(-40, 20), false);
  assert.equal(canAffordLeoPipsStake(19, 20), false);
  assert.equal(canAffordLeoPipsStake(20, 20), true);
  assert.equal(canAffordLeoPipsStake(100, 25), false);
  assert.equal(canEnterLeoPipsFindMatch(5), false);
  assert.equal(canEnterLeoPipsFindMatch(19), false);
  assert.equal(canEnterLeoPipsFindMatch(20), true);
  assert.equal(canEnterLeoPipsFindMatch(75), true);

  assert.deepEqual(leoPipsEnabledStakes(5), []);
  assert.deepEqual(leoPipsEnabledStakes(20), [20]);
  assert.deepEqual(leoPipsEnabledStakes(75), [20, 50]);
  assert.deepEqual(leoPipsEnabledStakes(1000), [20, 50, 100, 150]);

  const low = LEOPIPS_STAKE_TIERS.map((stake) => leoPipsStakeCardModel(stake, 5));
  assert.deepEqual(low.map((card) => card.disabled), [true, true, true, true]);

  const onlyMin = LEOPIPS_STAKE_TIERS.map((stake) => leoPipsStakeCardModel(stake, 20));
  assert.deepEqual(onlyMin.map((card) => card.disabled), [false, true, true, true]);

  const mid = LEOPIPS_STAKE_TIERS.map((stake) => leoPipsStakeCardModel(stake, 75));
  assert.equal(mid[0].disabled, false);
  assert.equal(mid[1].disabled, false);
  assert.equal(mid[2].disabled, true);
  assert.equal(mid[3].disabled, true);

  const rich = LEOPIPS_STAKE_TIERS.map((stake) => leoPipsStakeCardModel(stake, 1000));
  assert.deepEqual(rich.map((card) => card.disabled), [false, false, false, false]);

  const card150 = leoPipsStakeCardModel(150, 200, "Classic");
  assert.equal(card150.pot, 300);
  assert.equal(card150.potLabel, "300 LEOPIPS");
  assert.equal(card150.popular, false);
  assert.equal(leoPipsStakeCardModel(50, 75).popular, true);
}

assert.throws(() => settleLeoPipsNormalWin(25));
console.log("  ✓ LeoPips isolated economy formulas");
