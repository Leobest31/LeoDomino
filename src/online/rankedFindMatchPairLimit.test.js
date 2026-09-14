/**
 * Ranked Find Match pair-limit qualifying rule (client-side mirror of SQL).
 * Run: node src/online/rankedFindMatchPairLimit.test.js
 */
import assert from "node:assert/strict";

/**
 * Mirrors public.ranked_find_match_qualifying_count after
 * 20260904230000_ranked_pair_limit_completed_only.
 */
export function countQualifyingRankedFindMatches(matches, playerA, playerB, now = Date.now()) {
  if (!playerA || !playerB || playerA === playerB) return 0;
  const windowMs = 24 * 60 * 60 * 1000;
  const pair = new Set([playerA, playerB]);
  const seen = new Set();
  let n = 0;
  for (const m of matches || []) {
    if (!m?.id || seen.has(m.id)) continue;
    const players = new Set([m.playerA, m.playerB]);
    if (players.size !== 2 || ![...pair].every((id) => players.has(id))) continue;
    if (m.rated !== true) continue;
    if (m.matchKind !== "public") continue;
    if (m.finishReason !== "completed") continue;
    const created = Date.parse(m.createdAt);
    if (!Number.isFinite(created) || now - created > windowMs || created > now) continue;
    seen.add(m.id);
    n += 1;
  }
  return n;
}

export function pairLimitReached(matches, playerA, playerB, { friends = false, now = Date.now() } = {}) {
  if (friends) return false;
  return countQualifyingRankedFindMatches(matches, playerA, playerB, now) >= 3;
}

const A = "pozinx";
const B = "petion";
const NOW = Date.parse("2026-09-04T23:07:00.000Z");

function row(partial) {
  return {
    id: partial.id,
    playerA: partial.playerA ?? A,
    playerB: partial.playerB ?? B,
    rated: partial.rated ?? true,
    matchKind: partial.matchKind ?? "public",
    finishReason: partial.finishReason ?? "completed",
    createdAt: partial.createdAt,
  };
}

const h = (hoursAgo) => new Date(NOW - hoursAgo * 3600 * 1000).toISOString();

{
  const matches = [
    row({ id: "1", finishReason: "completed", createdAt: h(1) }),
    row({ id: "2", finishReason: "completed", createdAt: h(2) }),
    row({ id: "3", finishReason: "completed", createdAt: h(3) }),
  ];
  assert.equal(countQualifyingRankedFindMatches(matches, A, B, NOW), 3);
  assert.equal(pairLimitReached(matches, A, B, { now: NOW }), true);
  console.log("  ✓ 1. 3 completed public rated in 24h => limited");
}

{
  const matches = [
    row({ id: "1", finishReason: "completed", createdAt: h(1) }),
    row({ id: "2", finishReason: "completed", createdAt: h(2) }),
    row({ id: "3", finishReason: "timeout", createdAt: h(3) }),
  ];
  assert.equal(countQualifyingRankedFindMatches(matches, A, B, NOW), 2);
  assert.equal(pairLimitReached(matches, A, B, { now: NOW }), false);
  console.log("  ✓ 2. 2 completed + 1 timeout => NOT limited");
}

{
  const matches = [
    row({ id: "1", finishReason: "completed", createdAt: h(1) }),
    row({ id: "2", finishReason: "completed", createdAt: h(2) }),
    row({ id: "3", finishReason: "forfeit", createdAt: h(3) }),
  ];
  assert.equal(countQualifyingRankedFindMatches(matches, A, B, NOW), 2);
  assert.equal(pairLimitReached(matches, A, B, { now: NOW }), false);
  console.log("  ✓ 3. 2 completed + 1 forfeit => NOT limited");
}

{
  const matches = [
    row({ id: "1", finishReason: "timeout", createdAt: h(1) }),
    row({ id: "2", finishReason: "timeout", createdAt: h(2) }),
    row({ id: "3", finishReason: "timeout", createdAt: h(3) }),
  ];
  assert.equal(countQualifyingRankedFindMatches(matches, A, B, NOW), 0);
  assert.equal(pairLimitReached(matches, A, B, { now: NOW }), false);
  console.log("  ✓ 4. 3 timeout => NOT limited");
}

{
  const matches = [row({ id: "1", finishReason: "aborted", createdAt: h(1) })];
  assert.equal(countQualifyingRankedFindMatches(matches, A, B, NOW), 0);
  console.log("  ✓ 5. aborted => does not count");
}

{
  const matches = [row({ id: "1", matchKind: "private", finishReason: "completed", createdAt: h(1) })];
  assert.equal(countQualifyingRankedFindMatches(matches, A, B, NOW), 0);
  console.log("  ✓ 6. private => does not count");
}

{
  const matches = [row({ id: "1", rated: false, finishReason: "completed", createdAt: h(1) })];
  assert.equal(countQualifyingRankedFindMatches(matches, A, B, NOW), 0);
  console.log("  ✓ 7. unrated => does not count");
}

{
  const matches = [
    row({ id: "1", finishReason: "completed", createdAt: h(1) }),
    row({ id: "2", finishReason: "completed", createdAt: h(2) }),
    row({ id: "3", finishReason: "completed", createdAt: h(3) }),
  ];
  assert.equal(pairLimitReached(matches, A, B, { friends: true, now: NOW }), false);
  console.log("  ✓ 8. friend pair => exempt");
}

{
  const matches = [row({ id: "1", finishReason: "completed", createdAt: h(25) })];
  assert.equal(countQualifyingRankedFindMatches(matches, A, B, NOW), 0);
  console.log("  ✓ 9. completed older than 24h => does not count");
}

{
  const matches = [
    row({ id: "same", finishReason: "completed", createdAt: h(1) }),
    row({ id: "same", finishReason: "completed", createdAt: h(1) }),
    row({ id: "same", finishReason: "completed", createdAt: h(1) }),
  ];
  assert.equal(countQualifyingRankedFindMatches(matches, A, B, NOW), 1);
  console.log("  ✓ 10. no duplicate counting of same match");
}

{
  // Historical pozinx↔petion sample from hosted audit (NY times → UTC equivalents).
  const sample = [
    row({
      id: "5e132be0-7dab-4a30-8047-789043589a4d",
      finishReason: "timeout",
      createdAt: "2026-09-04T15:20:14.398509Z",
    }),
    row({
      id: "f1c14c5c-57b8-4c78-bf02-6057e0d035c4",
      finishReason: "completed",
      createdAt: "2026-09-04T02:56:20.619525Z",
    }),
    row({
      id: "a6ed358b-b654-4540-8bb9-e470ba7ca168",
      finishReason: "timeout",
      createdAt: "2026-09-04T02:45:18.676008Z",
    }),
  ];
  assert.equal(countQualifyingRankedFindMatches(sample, A, B, NOW), 1);
  assert.equal(pairLimitReached(sample, A, B, { now: NOW }), false);
  console.log("  ✓ 11. pozinx↔petion sample => qualifying_count 1, not limited");
}

{
  // badasse↔lizaire: 3 timeouts => 0
  const BA = "badasse";
  const LI = "lizaire";
  const sample = [
    row({ id: "t1", playerA: BA, playerB: LI, finishReason: "timeout", createdAt: h(6) }),
    row({ id: "t2", playerA: BA, playerB: LI, finishReason: "timeout", createdAt: h(6.5) }),
    row({ id: "t3", playerA: BA, playerB: LI, finishReason: "timeout", createdAt: h(7) }),
  ];
  assert.equal(countQualifyingRankedFindMatches(sample, BA, LI, NOW), 0);
  assert.equal(pairLimitReached(sample, BA, LI, { now: NOW }), false);
  console.log("  ✓ badasse↔lizaire (3 timeouts) => count 0, not limited");
}

{
  // mrsm↔sassou: 1 timeout + 2 forfeit => 0
  const M = "mrsm";
  const S = "sassou";
  const sample = [
    row({ id: "t1", playerA: M, playerB: S, finishReason: "timeout", createdAt: h(5) }),
    row({ id: "f1", playerA: M, playerB: S, finishReason: "forfeit", createdAt: h(5.1) }),
    row({ id: "f2", playerA: M, playerB: S, finishReason: "forfeit", createdAt: h(7) }),
  ];
  assert.equal(countQualifyingRankedFindMatches(sample, M, S, NOW), 0);
  assert.equal(pairLimitReached(sample, M, S, { now: NOW }), false);
  console.log("  ✓ mrsm↔sassou (timeout+forfeits) => count 0, not limited");
}

{
  // deschnai↔pozinx: 2 completed + 1 timeout => 2, not limited
  const D = "deschnai";
  const P = "pozinx";
  const sample = [
    row({ id: "t1", playerA: D, playerB: P, finishReason: "timeout", createdAt: h(8) }),
    row({ id: "c1", playerA: D, playerB: P, finishReason: "completed", createdAt: h(9) }),
    row({ id: "c2", playerA: D, playerB: P, finishReason: "completed", createdAt: h(11) }),
  ];
  assert.equal(countQualifyingRankedFindMatches(sample, D, P, NOW), 2);
  assert.equal(pairLimitReached(sample, D, P, { now: NOW }), false);
  console.log("  ✓ deschnai↔pozinx (2 completed + 1 timeout) => count 2, not limited");
}

console.log("  ✓ ranked Find Match pair-limit completed-only rule");
