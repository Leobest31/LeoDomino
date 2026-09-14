/**
 * LeoPips stake-card request counts — 12 isolated style+stake pools.
 * Own requests are excluded (list_joinable creator_id <> caller).
 * Run: node src/leopips/leopipsStakeRequestCounts.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeMatchRequest } from "../online/matchmaking.js";
import { LEOPIPS_COPY } from "./leopipsCopy.js";
import { LEOPIPS_STAKE_TIERS, LEOPIPS_STYLE_IDS } from "./leopipsEconomy.js";
import {
  LEOPIPS_STAKE_COUNT_RULESETS,
  countLeoPipsJoinableStakePools,
  countsForLeoPipsStyle,
  emptyLeoPipsAllStyleStakeCounts,
  emptyLeoPipsStakeCounts,
  formatLeoPipsRequestCountLabel,
  leoPipsRulesetIdForStyle,
  loadLeoPipsStakeRequestCounts,
} from "./leopipsStakeRequestCounts.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const ME = "player-me";
const NOW = Date.parse("2026-09-03T18:00:00.000Z");

function row(overrides = {}) {
  return normalizeMatchRequest({
    id: "req-1",
    creator_id: "player-a",
    ruleset_id: "legacy",
    stake_pips: 20,
    status: "open",
    created_at: "2026-09-03T12:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
    waiting_heartbeat_at: "2026-09-03T17:59:50.000Z",
    visibility: "public",
    match_id: null,
    acceptor_id: null,
    profiles: { display_name: "Marie", avatar_id: "amina", country_code: "HT" },
    ...overrides,
  });
}

assert.deepEqual(LEOPIPS_STAKE_COUNT_RULESETS, {
  classic: "legacy",
  haitian: "haitian",
  american: "american",
});
assert.equal(leoPipsRulesetIdForStyle("classic"), "legacy");
assert.equal(leoPipsRulesetIdForStyle("legacy"), "legacy");
assert.equal(leoPipsRulesetIdForStyle("haitian"), "haitian");
assert.equal(leoPipsRulesetIdForStyle("american"), "american");
assert.equal(leoPipsRulesetIdForStyle("allFives"), null);
assert.equal(leoPipsRulesetIdForStyle("classic"), "legacy");
assert.notEqual(leoPipsRulesetIdForStyle("classic"), "classic");

{
  const empty = emptyLeoPipsAllStyleStakeCounts();
  for (const ruleset of ["legacy", "haitian", "american"]) {
    assert.deepEqual(empty[ruleset], { 20: 0, 50: 0, 100: 0, 150: 0 });
  }
  assert.deepEqual(countsForLeoPipsStyle(empty, "classic"), emptyLeoPipsStakeCounts());
}

{
  const mixed = [
    row({ id: "c20", ruleset_id: "legacy", stake_pips: 20, creator_id: "p-c20" }),
    row({ id: "c20b", ruleset_id: "legacy", stake_pips: 20, creator_id: "p-c20b" }),
    row({ id: "c50", ruleset_id: "legacy", stake_pips: 50, creator_id: "p-c50" }),
    row({ id: "c100", ruleset_id: "legacy", stake_pips: 100, creator_id: "p-c100" }),
    row({ id: "c150", ruleset_id: "legacy", stake_pips: 150, creator_id: "p-c150" }),
    row({ id: "h20", ruleset_id: "haitian", stake_pips: 20, creator_id: "p-h20" }),
    row({ id: "h50", ruleset_id: "haitian", stake_pips: 50, creator_id: "p-h50" }),
    row({ id: "h50b", ruleset_id: "haitian", stake_pips: 50, creator_id: "p-h50b" }),
    row({ id: "h100", ruleset_id: "haitian", stake_pips: 100, creator_id: "p-h100" }),
    row({ id: "h150", ruleset_id: "haitian", stake_pips: 150, creator_id: "p-h150" }),
    row({ id: "a20", ruleset_id: "american", stake_pips: 20, creator_id: "p-a20" }),
    row({ id: "a50", ruleset_id: "american", stake_pips: 50, creator_id: "p-a50" }),
    row({ id: "a100", ruleset_id: "american", stake_pips: 100, creator_id: "p-a100" }),
    row({ id: "a150", ruleset_id: "american", stake_pips: 150, creator_id: "p-a150" }),
  ];
  const pools = countLeoPipsJoinableStakePools(mixed, ME, NOW);
  assert.deepEqual(pools.legacy, { 20: 2, 50: 1, 100: 1, 150: 1 });
  assert.deepEqual(pools.haitian, { 20: 1, 50: 2, 100: 1, 150: 1 });
  assert.deepEqual(pools.american, { 20: 1, 50: 1, 100: 1, 150: 1 });
  assert.deepEqual(countsForLeoPipsStyle(pools, "classic"), { 20: 2, 50: 1, 100: 1, 150: 1 });
  assert.deepEqual(countsForLeoPipsStyle(pools, "haitian"), { 20: 1, 50: 2, 100: 1, 150: 1 });
  assert.deepEqual(countsForLeoPipsStyle(pools, "american"), { 20: 1, 50: 1, 100: 1, 150: 1 });
}

{
  const haitian50Raw = {
    id: "h50-only",
    ruleset_id: "haitian",
    stake_pips: 50,
    creator_id: "p-h50",
  };
  const before = countLeoPipsJoinableStakePools([], ME, NOW);
  const afterOpen = countLeoPipsJoinableStakePools([row(haitian50Raw)], ME, NOW);
  assert.equal(before.haitian[50], 0);
  assert.equal(afterOpen.haitian[50], 1, "open request +1");
  assert.equal(afterOpen.legacy[50], 0, "Haitian 50 must not raise Classic 50");
  assert.equal(afterOpen.american[50], 0, "Haitian 50 must not raise American 50");
  assert.equal(afterOpen.haitian[20], 0);
  assert.equal(afterOpen.haitian[100], 0);
  assert.equal(afterOpen.haitian[150], 0);

  const accepted = countLeoPipsJoinableStakePools(
    [row({ ...haitian50Raw, status: "accepted", acceptor_id: ME })],
    ME,
    NOW
  );
  assert.equal(accepted.haitian[50], 0, "accepted request -1");

  const cancelled = countLeoPipsJoinableStakePools(
    [row({ ...haitian50Raw, status: "cancelled" })],
    ME,
    NOW
  );
  assert.equal(cancelled.haitian[50], 0, "cancelled request -1");

  const expired = countLeoPipsJoinableStakePools(
    [row({ ...haitian50Raw, expires_at: "2020-01-01T00:00:00.000Z" })],
    ME,
    NOW
  );
  assert.equal(expired.haitian[50], 0, "expired request -1");

  const rejected = countLeoPipsJoinableStakePools(
    [row({ ...haitian50Raw, status: "rejected" })],
    ME,
    NOW
  );
  assert.equal(rejected.haitian[50], 0, "rejected/invalid must not remain counted");

  const staleHeartbeat = countLeoPipsJoinableStakePools(
    [row({ ...haitian50Raw, waiting_heartbeat_at: "2026-09-03T17:00:00.000Z" })],
    ME,
    NOW
  );
  assert.equal(staleHeartbeat.haitian[50], 0, "stale heartbeat is not joinable");

  const friend = countLeoPipsJoinableStakePools(
    [row({ ...haitian50Raw, visibility: "friend", invitee_id: ME })],
    ME,
    NOW
  );
  assert.equal(friend.haitian[50], 0, "friend/private is never a public pool count");

  const unstaked = countLeoPipsJoinableStakePools(
    [row({ ...haitian50Raw, stake_pips: null })],
    ME,
    NOW
  );
  assert.equal(unstaked.haitian[50], 0, "NULL stake never matches a LeoPips card");

  const own = countLeoPipsJoinableStakePools(
    [row({ ...haitian50Raw, creator_id: ME })],
    ME,
    NOW
  );
  assert.equal(own.haitian[50], 0, "own open request is excluded — player cannot accept self");
}

{
  assert.equal(formatLeoPipsRequestCountLabel(0), "0 REQUESTS");
  assert.equal(formatLeoPipsRequestCountLabel(1), "1 REQUEST");
  assert.equal(formatLeoPipsRequestCountLabel(5), "5 REQUESTS");
  assert.equal(formatLeoPipsRequestCountLabel(12), "12 REQUESTS");
  assert.equal(formatLeoPipsRequestCountLabel(-3), "0 REQUESTS");
  assert.equal(formatLeoPipsRequestCountLabel(null), "0 REQUESTS");
  assert.equal(LEOPIPS_COPY.request, "REQUEST");
  assert.equal(LEOPIPS_COPY.requests, "REQUESTS");
}

{
  const rpcCalls = [];
  const client = {
    rpc(name, args) {
      rpcCalls.push({ name, args });
      assert.equal(name, "list_joinable_open_match_requests");
      assert.notEqual(args.p_ruleset_id, "classic");
      assert.notEqual(args.p_ruleset_id, "allFives");
      if (args.p_ruleset_id === "haitian" && args.p_stake_pips === 50) {
        return Promise.resolve({
          data: [
            {
              id: "h50a",
              creator_id: "p-1",
              ruleset_id: "haitian",
              stake_pips: 50,
              status: "open",
              created_at: "2026-09-03T12:00:00.000Z",
              expires_at: "2099-01-01T00:00:00.000Z",
              waiting_heartbeat_at: "2099-01-01T00:00:00.000Z",
              visibility: "public",
              display_name: "A",
              avatar_id: "marcus",
              country_code: "HT",
            },
            {
              id: "h50b",
              creator_id: "p-2",
              ruleset_id: "haitian",
              stake_pips: 50,
              status: "open",
              created_at: "2026-09-03T12:01:00.000Z",
              expires_at: "2099-01-01T00:00:00.000Z",
              waiting_heartbeat_at: "2099-01-01T00:00:00.000Z",
              visibility: "public",
              display_name: "B",
              avatar_id: "marcus",
              country_code: "HT",
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    },
  };

  const haitian = await loadLeoPipsStakeRequestCounts("haitian", client);
  assert.deepEqual(haitian, { 20: 0, 50: 2, 100: 0, 150: 0 });
  assert.equal(rpcCalls.length, 4, "selected style only — four stake RPCs, not 12");
  assert.ok(rpcCalls.every((call) => call.args.p_ruleset_id === "haitian"));
  assert.deepEqual(
    rpcCalls.map((call) => call.args.p_stake_pips).sort((a, b) => a - b),
    [...LEOPIPS_STAKE_TIERS]
  );

  rpcCalls.length = 0;
  const classic = await loadLeoPipsStakeRequestCounts("classic", client);
  assert.deepEqual(classic, { 20: 0, 50: 0, 100: 0, 150: 0 });
  assert.ok(rpcCalls.every((call) => call.args.p_ruleset_id === "legacy"));
  assert.ok(rpcCalls.every((call) => call.args.p_ruleset_id !== "classic"));
}

{
  const page = read("src/leopips/LeoPipsStakePage.jsx");
  const css = read("src/leopips/LeoPipsStakePage.css");
  const wrapper = read("src/pages/LeoPipsAuthenticatedStake.jsx");
  const hook = read("src/hooks/useLeoPipsStakeRequestCounts.js");
  const helper = read("src/leopips/leopipsStakeRequestCounts.js");

  assert.match(page, /leopips-stake__requests/);
  assert.match(page, /data-leopips-requests=\{stake\}/);
  assert.match(page, /isolated \? "ready" : requestCountsStatus/);
  assert.doesNotMatch(page, /listJoinableOpenMatchRequests|subscribeMatchRequests|useLeoPipsStakeRequestCounts/);
  assert.doesNotMatch(page, /createMatchRequest|acceptMatchRequest/);

  assert.match(css, /\.leopips-stake__requests/);
  assert.match(css, /\.leopips-stake__card\.is-popular \.leopips-stake__requests/);
  assert.match(css, /\.leopips-stake__badge \{[\s\S]*left:\s*50%/);

  assert.match(wrapper, /useLeoPipsStakeRequestCounts\(styleId\)/);
  assert.match(wrapper, /requestCounts=\{requestCounts\}/);
  assert.match(wrapper, /onChangeStyle/);
  assert.doesNotMatch(wrapper, /createMatchRequest|acceptMatchRequest/);
  assert.doesNotMatch(wrapper, /\.rpc\(/);

  assert.match(hook, /subscribeMatchRequests/);
  assert.match(hook, /loadLeoPipsStakeRequestCounts\(styleId\)/);
  assert.match(hook, /reportError/);
  assert.match(hook, /LEOPIPS_STAKE_COUNT_POLL_MS\s*=\s*5_000/);
  assert.match(hook, /setInterval/);
  assert.match(hook, /stakeCountsDocumentIsHidden/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /refreshInFlightRef/);
  assert.doesNotMatch(hook, /createMatchRequest|acceptMatchRequest/);
  assert.doesNotMatch(hook, /_leopips_debit|_leopips_credit|settlement/);

  assert.match(helper, /list_joinable_open_match_requests/);
  assert.match(helper, /classic: "legacy"/);
  assert.doesNotMatch(helper, /classic: "classic"/);
  assert.doesNotMatch(helper, /_leopips_debit|_leopips_credit/);

  for (const style of LEOPIPS_STYLE_IDS) {
    assert.ok(leoPipsRulesetIdForStyle(style), `${style} maps to a Find Match ruleset`);
  }
}

console.log("  ✓ LeoPips stake request counts isolate all 12 style+stake pools");
