/**
 * LeoPips Choose Stake request-count helper.
 *
 * Counts are informational only. They reuse list_joinable_open_match_requests
 * (exact ruleset_id + stake_pips). They do not create, accept, cancel, or
 * change matchmaking.
 *
 * Canonical matchmaking IDs: classic UI → legacy, haitian, american.
 */

import { LEOPIPS_COPY } from "./leopipsCopy.js";
import { LEOPIPS_STAKE_TIERS, LEOPIPS_STYLE_IDS } from "./leopipsEconomy.js";
import {
  FIND_MATCH_RULESET_IDS,
  canAcceptMatchRequest,
  listJoinableOpenMatchRequests,
  toFindMatchRulesetId,
  toFindMatchStakePips,
} from "../online/matchmaking.js";

export const LEOPIPS_STAKE_COUNT_RULESETS = Object.freeze({
  classic: "legacy",
  haitian: "haitian",
  american: "american",
});

export function emptyLeoPipsStakeCounts() {
  return Object.freeze({
    20: 0,
    50: 0,
    100: 0,
    150: 0,
  });
}

export function emptyLeoPipsAllStyleStakeCounts() {
  return Object.freeze({
    legacy: emptyLeoPipsStakeCounts(),
    haitian: emptyLeoPipsStakeCounts(),
    american: emptyLeoPipsStakeCounts(),
  });
}

/**
 * UI style id or already-canonical ruleset id → SQL ruleset_id.
 * @param {unknown} styleOrRuleset
 * @returns {"legacy"|"haitian"|"american"|null}
 */
export function leoPipsRulesetIdForStyle(styleOrRuleset) {
  const mapped = LEOPIPS_STAKE_COUNT_RULESETS[String(styleOrRuleset || "")];
  if (mapped) return mapped;
  const rulesetId = toFindMatchRulesetId(styleOrRuleset);
  return FIND_MATCH_RULESET_IDS.includes(rulesetId) ? rulesetId : null;
}

/**
 * @param {unknown} styleOrRuleset
 * @param {{ 20?: number, 50?: number, 100?: number, 150?: number }|null|undefined} allOrSelected
 */
export function countsForLeoPipsStyle(allOrSelected, styleOrRuleset) {
  const rulesetId = leoPipsRulesetIdForStyle(styleOrRuleset);
  if (!rulesetId || !allOrSelected) return emptyLeoPipsStakeCounts();
  const bucket = allOrSelected[rulesetId] || allOrSelected;
  return Object.freeze({
    20: asCount(bucket[20]),
    50: asCount(bucket[50]),
    100: asCount(bucket[100]),
    150: asCount(bucket[150]),
  });
}

/**
 * Group already-normalized requests into the 12 public LeoPips pools.
 * Own / friend / expired / stale / unstaked / non-open rows are excluded
 * because the current player cannot accept them.
 *
 * @param {Array<object|null|undefined>} requests
 * @param {string} playerId
 * @param {number} [now]
 */
export function countLeoPipsJoinableStakePools(requests, playerId, now = Date.now()) {
  const pools = {
    legacy: { 20: 0, 50: 0, 100: 0, 150: 0 },
    haitian: { 20: 0, 50: 0, 100: 0, 150: 0 },
    american: { 20: 0, 50: 0, 100: 0, 150: 0 },
  };
  if (!playerId || !Array.isArray(requests)) {
    return Object.freeze({
      legacy: Object.freeze(pools.legacy),
      haitian: Object.freeze(pools.haitian),
      american: Object.freeze(pools.american),
    });
  }
  for (const request of requests) {
    if (!canAcceptMatchRequest(request, playerId, now)) continue;
    const rulesetId = toFindMatchRulesetId(request.rulesetId);
    const stake = toFindMatchStakePips(request.stakePips);
    if (!rulesetId || pools[rulesetId] == null || stake == null) continue;
    pools[rulesetId][stake] += 1;
  }
  return Object.freeze({
    legacy: Object.freeze(pools.legacy),
    haitian: Object.freeze(pools.haitian),
    american: Object.freeze(pools.american),
  });
}

export function formatLeoPipsRequestCountLabel(count) {
  const n = asCount(count);
  const word = n === 1 ? LEOPIPS_COPY.request : LEOPIPS_COPY.requests;
  return `${n} ${word}`;
}

/**
 * Four exact-bucket RPCs for the selected style only.
 * Does not query the other two styles.
 *
 * @param {unknown} styleOrRuleset
 * @param {object} [client]
 * @returns {Promise<{ 20: number, 50: number, 100: number, 150: number }>}
 */
export async function loadLeoPipsStakeRequestCounts(styleOrRuleset, client) {
  const rulesetId = leoPipsRulesetIdForStyle(styleOrRuleset);
  if (!rulesetId) return emptyLeoPipsStakeCounts();
  const lists = await Promise.all(
    LEOPIPS_STAKE_TIERS.map((stake) => listJoinableOpenMatchRequests(rulesetId, stake, client))
  );
  const counts = { 20: 0, 50: 0, 100: 0, 150: 0 };
  LEOPIPS_STAKE_TIERS.forEach((stake, index) => {
    counts[stake] = Array.isArray(lists[index]) ? lists[index].length : 0;
  });
  return Object.freeze(counts);
}

export function leoPipsStakeCountStyleIds() {
  return LEOPIPS_STYLE_IDS;
}

function asCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
