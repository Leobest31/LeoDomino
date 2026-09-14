/**
 * Local LeoPips activation contracts: matchmaking, debit, payout, timeout,
 * referral, XP/Level, and policy gates.
 * Run: node src/leopips/leopipsActivation.contract.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIND_MATCH_STAKE_PIPS,
  MatchmakingError,
  acceptMatchRequest,
  createMatchRequest,
  listJoinableOpenMatchRequests,
  loadFindMatchBoard,
  requestMatchesFindMatchLobby,
  sendFriendMatchInvite,
  visibleFindMatchLobbyRequests,
} from "../online/matchmaking.js";
import { normalizeMatchRequest } from "../online/matchmaking.js";
import {
  LEOPIPS_MIN_FIND_MATCH_STAKE,
  LEOPIPS_REFERRAL_QUALIFYING_MATCHES,
  LEOPIPS_REFERRAL_REWARD,
  LEOPIPS_STAKE_TIERS,
  canEnterLeoPipsFindMatch,
  settleLeoPipsAbandon,
  settleLeoPipsNormalWin,
  settleLeoPipsTimeoutStrike,
} from "./leopipsEconomy.js";
import {
  LEOPIPS_FORFEIT_POT_POLICY,
  LEOPIPS_REFERRAL_COUNT_FRIEND_MATCHES,
  LEOPIPS_REFERRAL_INDEPENDENT_OF_CASH_PRIZE,
  LEOPIPS_TIMEOUT_UNDER5_POLICY,
  countLeoPipsQualifyingReferralMatches,
  isLeoPipsNormalPayoutReason,
  isLeoPipsPotPayoutReason,
  isLeoPipsUnresolvedTerminalReason,
  leoPipsReferralRewardDue,
} from "./leopipsPolicy.js";
import {
  applyLeoPipsIdempotent,
  applyLeoPipsStakeDebit,
  applyLeoPipsTimeoutPenalty,
} from "./leopipsLedger.js";
import {
  LEOPIPS_LEVEL_FORMULA_FINALIZED,
  leoPipsLevelFromBalance,
  leoPipsLevelFromStake,
  leoPipsMayAwardXp,
  leoPipsMayProgressLevel,
} from "./leopipsProgress.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

function row(overrides = {}) {
  return normalizeMatchRequest({
    id: "req-1",
    creator_id: "player-a",
    ruleset_id: "legacy",
    stake_pips: 20,
    status: "open",
    created_at: "2026-09-03T12:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
    waiting_heartbeat_at: "2099-01-01T00:00:00.000Z",
    visibility: "public",
    match_id: null,
    acceptor_id: null,
    profiles: { display_name: "Marie", avatar_id: "amina", country_code: "HT" },
    ...overrides,
  });
}

assert.deepEqual([...FIND_MATCH_STAKE_PIPS], [20, 50, 100, 150]);
assert.deepEqual([...LEOPIPS_STAKE_TIERS], [20, 50, 100, 150]);
assert.equal(LEOPIPS_MIN_FIND_MATCH_STAKE, 20);
assert.equal(canEnterLeoPipsFindMatch(19), false);
assert.equal(canEnterLeoPipsFindMatch(20), true);
assert.equal(canEnterLeoPipsFindMatch(null), false);

{
  const open = [
    row(),
    row({ id: "c50", stake_pips: 50, creator_id: "p-50" }),
    row({ id: "c100", stake_pips: 100, creator_id: "p-100" }),
    row({ id: "c150", stake_pips: 150, creator_id: "p-150" }),
    row({ id: "h20", ruleset_id: "haitian", creator_id: "p-h" }),
  ];
  assert.deepEqual(visibleFindMatchLobbyRequests(open, null, "classic", 20).map((r) => r.id), ["req-1"]);
  assert.deepEqual(visibleFindMatchLobbyRequests(open, null, "classic", 50).map((r) => r.id), ["c50"]);
  assert.deepEqual(visibleFindMatchLobbyRequests(open, null, "classic", 100).map((r) => r.id), ["c100"]);
  assert.deepEqual(visibleFindMatchLobbyRequests(open, null, "classic", 150).map((r) => r.id), ["c150"]);
  assert.equal(
    visibleFindMatchLobbyRequests(
      [...open, row({ id: "friend", visibility: "friend", stake_pips: null })],
      row({ id: "own-50", stake_pips: 50 }),
      "classic",
      20
    ).some((r) => r.id === "own-50" || r.id === "friend" || r.id === "c50"),
    false
  );
  assert.equal(requestMatchesFindMatchLobby(row(), "classic", 50), false);
  assert.equal(requestMatchesFindMatchLobby(row({ ruleset_id: "haitian" }), "classic", 20), false);
}

{
  const listed = await listJoinableOpenMatchRequests("classic", 20, {
    rpc() {
      return Promise.resolve({
        data: null,
        error: { code: "PGRST202", message: "Could not find the function" },
      });
    },
    from() {
      throw new Error("staked lobby must not fall back to unfiltered list");
    },
  });
  assert.deepEqual(listed, []);
}

{
  const board = await loadFindMatchBoard("player-z", { styleId: "classic", stake: 50 }, {
    rpc() {
      return Promise.resolve({
        data: null,
        error: { code: "PGRST202", message: "Could not find the function" },
      });
    },
    from() {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        neq() { return builder; },
        in() { return builder; },
        order() { return builder; },
        limit() { return builder; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        then() { throw new Error("own-request lookup only"); },
      };
      return builder;
    },
  });
  assert.equal(board.source, "lobby-rpc-missing");
  assert.deepEqual(board.open, []);
}

{
  const accept = await acceptMatchRequest("req-1", {
    playerId: "p-b",
    creatorId: "p-a",
    styleId: "classic",
    stakePips: 20,
  }, {
    rpc(name, args) {
      assert.equal(name, "accept_match_request");
      assert.equal(args.p_ruleset_id, "legacy");
      assert.equal(args.p_stake_pips, 20);
      return Promise.resolve({ data: "match-1", error: null });
    },
    from() {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        in() { return builder; },
        single() {
          return Promise.resolve({
            data: {
              id: "match-1",
              request_id: "req-1",
              ruleset_id: "legacy",
              player_a: "p-a",
              player_b: "p-b",
              status: "ready",
              created_at: "2026-09-03T12:00:00.000Z",
            },
            error: null,
          });
        },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      };
      return builder;
    },
  });
  assert.equal(accept.id, "match-1");
}

{
  await sendFriendMatchInvite("friend-1", "classic", {
    rpc(name, args) {
      assert.equal(name, "send_friend_match_invite");
      assert.equal(args.p_invitee_id, "friend-1");
      assert.equal(args.p_stake_pips, undefined);
      return Promise.resolve({ data: "friend-req", error: null });
    },
    from() {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        maybeSingle() {
          return Promise.resolve({
            data: {
              id: "friend-req",
              creator_id: "me",
              invitee_id: "friend-1",
              ruleset_id: "legacy",
              visibility: "friend",
              status: "open",
            },
            error: null,
          });
        },
      };
      return builder;
    },
  });
}

{
  await assert.rejects(
    () => createMatchRequest("classic", 25, { from() { throw new Error("invalid"); } }),
    (err) => err instanceof MatchmakingError && err.code === "INVALID_STAKE"
  );
}

{
  assert.equal(settleLeoPipsNormalWin(20).winnerPayout, 40);
  assert.equal(settleLeoPipsNormalWin(50).winnerPayout, 100);
  assert.equal(settleLeoPipsNormalWin(100).winnerPayout, 200);
  assert.equal(settleLeoPipsNormalWin(150).winnerPayout, 300);
  assert.equal(isLeoPipsNormalPayoutReason("completed"), true);
  assert.equal(isLeoPipsNormalPayoutReason("forfeit"), false);
  assert.equal(isLeoPipsPotPayoutReason("forfeit"), true);
  assert.equal(isLeoPipsPotPayoutReason("timeout"), true);
  assert.equal(isLeoPipsPotPayoutReason("abandoned"), true);
  assert.equal(isLeoPipsPotPayoutReason("join_timeout"), false);
  assert.equal(isLeoPipsUnresolvedTerminalReason("forfeit"), false);
  assert.equal(LEOPIPS_FORFEIT_POT_POLICY, "forfeit_abandon_partial_1_5S");
  assert.equal(settleLeoPipsAbandon(20).winnerPayout, 30);
  assert.equal(settleLeoPipsAbandon(20).houseRetention, 10);
  assert.notEqual(settleLeoPipsNormalWin(20).winnerPayout, settleLeoPipsAbandon(20).winnerPayout);
  assert.equal(settleLeoPipsAbandon(50).loserRefund, 0);
  assert.equal(isLeoPipsPotPayoutReason("join_timeout"), false);
}

{
  assert.equal(settleLeoPipsTimeoutStrike(1, 100).amount, 5);
  assert.equal(settleLeoPipsTimeoutStrike(1, 100).applied, true);
  assert.equal(settleLeoPipsTimeoutStrike(2, 100).amount, 5);
  assert.equal(settleLeoPipsTimeoutStrike(3, 100).amount, 0);
  assert.equal(settleLeoPipsTimeoutStrike(3, 100).matchLoss, true);
  assert.equal(applyLeoPipsTimeoutPenalty(5), 0);
  assert.equal(applyLeoPipsTimeoutPenalty(3), -2);
  assert.equal(applyLeoPipsTimeoutPenalty(0), -5);
  assert.equal(applyLeoPipsTimeoutPenalty(-2), -7);
  assert.equal(settleLeoPipsTimeoutStrike(1, 4).applied, true);
  assert.equal(settleLeoPipsTimeoutStrike(1, 4).nextBalance, -1);
  assert.equal(LEOPIPS_TIMEOUT_UNDER5_POLICY, "allow_negative");
  const keys = new Map();
  const first = applyLeoPipsIdempotent(keys, "timeout_penalty:m:1", () => applyLeoPipsTimeoutPenalty(3));
  const dup = applyLeoPipsIdempotent(keys, "timeout_penalty:m:1", () => applyLeoPipsTimeoutPenalty(first.nextBalance));
  const second = applyLeoPipsIdempotent(keys, "timeout_penalty:m:2", () => applyLeoPipsTimeoutPenalty(first.nextBalance));
  assert.equal(first.nextBalance, -2);
  assert.equal(dup.duplicate, true);
  assert.equal(dup.nextBalance, -2);
  assert.equal(second.nextBalance, -7);
  assert.equal(applyLeoPipsStakeDebit(20, 20), 0);
  assert.throws(() => applyLeoPipsStakeDebit(3, 20), (err) => err.code === "INSUFFICIENT_LEOPIPS");
  assert.throws(() => applyLeoPipsStakeDebit(-5, 20), (err) => err.code === "INSUFFICIENT_LEOPIPS");
}

{
  assert.equal(LEOPIPS_REFERRAL_QUALIFYING_MATCHES, 3);
  assert.equal(LEOPIPS_REFERRAL_REWARD, 100);
  assert.equal(LEOPIPS_REFERRAL_INDEPENDENT_OF_CASH_PRIZE, true);
  assert.equal(LEOPIPS_REFERRAL_COUNT_FRIEND_MATCHES, false);
  const copy = read("src/leopips/leopipsCopy.js");
  assert.match(copy, /3 online matches/);
  const sql = read("supabase/migrations/20260903160000_leopips_activation_settlement.sql");
  assert.match(sql, /qualified_count < 3/);
  assert.match(sql, /match_kind, 'public'\) = 'public'/);
  assert.doesNotMatch(sql, /_evaluate_referral|prize_amount_usd/);
  assert.doesNotMatch(sql, /insufficient_balance_floor_unresolved|unresolved_terminal_pot/);
  const referred = "new-player";
  const attributedAt = "2026-09-01T00:00:00.000Z";
  const matches = [
    { status: "finished", finishReason: "completed", matchKind: "public", finishedAt: "2026-09-02T00:00:00.000Z", playerA: referred, playerB: "x" },
    { status: "finished", finishReason: "completed", matchKind: "public", finishedAt: "2026-09-03T00:00:00.000Z", playerA: referred, playerB: "y" },
    { status: "finished", finishReason: "completed", matchKind: "friend", finishedAt: "2026-09-04T00:00:00.000Z", playerA: referred, playerB: "z" },
    { status: "aborted", finishReason: "join_timeout", matchKind: "public", finishedAt: "2026-09-05T00:00:00.000Z", playerA: referred, playerB: "a" },
    { status: "finished", finishReason: "completed", matchKind: "public", finishedAt: "2026-09-06T00:00:00.000Z", playerA: referred, playerB: "b" },
    { status: "finished", finishReason: "completed", matchKind: "public", finishedAt: "2026-09-07T00:00:00.000Z", playerA: referred, playerB: "c" },
  ];
  assert.equal(countLeoPipsQualifyingReferralMatches(matches.slice(0, 1), referred, attributedAt), 1);
  assert.equal(leoPipsReferralRewardDue(1), false);
  assert.equal(countLeoPipsQualifyingReferralMatches(matches.slice(0, 2), referred, attributedAt), 2);
  assert.equal(leoPipsReferralRewardDue(2), false);
  assert.equal(countLeoPipsQualifyingReferralMatches(matches.slice(0, 5), referred, attributedAt), 3);
  assert.equal(leoPipsReferralRewardDue(3), true);
  assert.equal(countLeoPipsQualifyingReferralMatches(matches, referred, attributedAt), 4);
  assert.equal(leoPipsReferralRewardDue(4), true);
  const rewardKeys = new Map();
  const pay1 = applyLeoPipsIdempotent(rewardKeys, "referral_reward:r1", () => 1000 + 100);
  const pay2 = applyLeoPipsIdempotent(rewardKeys, "referral_reward:r1", () => 1100 + 100);
  assert.equal(pay1.nextBalance, 1100);
  assert.equal(pay2.duplicate, true);
  assert.equal(pay2.nextBalance, 1100);
}

{
  assert.equal(LEOPIPS_LEVEL_FORMULA_FINALIZED, true);
  assert.equal(leoPipsLevelFromBalance(1000), null);
  assert.equal(leoPipsLevelFromStake(150), null);
  assert.equal(leoPipsMayAwardXp({ finishReason: "forfeit" }), false);
  assert.equal(leoPipsMayAwardXp({ finishReason: "abandon" }), false);
  assert.equal(leoPipsMayAwardXp({ finishReason: "timeout" }), false);
  assert.equal(leoPipsMayAwardXp({ finishReason: "completed" }), true);
  assert.equal(leoPipsMayProgressLevel({ finishReason: "forfeit", matchKind: "public" }), false);
  assert.equal(leoPipsMayProgressLevel({ finishReason: "timeout", matchKind: "public" }), false);
  assert.equal(leoPipsMayProgressLevel({ finishReason: "completed", matchKind: "friend" }), false);
  assert.equal(leoPipsMayProgressLevel({ finishReason: "completed", matchKind: "public" }), true);
  assert.equal(leoPipsMayProgressLevel({ finishReason: "completed", abandoned: true }), false);
}

{
  const online = read("src/pages/OnlineGamePage.jsx");
  assert.doesNotMatch(online, /from ["'].*leopips\//);
  assert.match(online, /levelUpEvents/);
}

{
  const matchmaking = read("src/online/matchmaking.js");
  assert.doesNotMatch(matchmaking, /_leopips_debit|_leopips_credit|_leopips_timeout/);
  assert.match(read("src/pages/LeoPipsAuthenticatedStake.jsx"), /canEnterLeoPipsFindMatch|canAffordLeoPipsStake/);
  assert.match(read("src/leopips/LeoPipsStakePage.jsx"), /Play with friends|friendsAction/);
}

console.log("  ✓ LeoPips local activation contracts");
