/**
 * Active match recovery — occupancy SELECT, not Realtime.
 * Run: node src/online/activeMatchRecovery.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MatchmakingError,
  getMyActiveMatch,
  isActiveMatchLockError,
  throwFromPostgrest,
} from "./matchmaking.js";
import { JOIN_GRACE_MS } from "./joinTimeout.js";
import { isMissingActiveMatchRow } from "./matchRecovery.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, "src", rel), "utf8");

function thenable(result, capture = {}) {
  const builder = {
    select(sql) {
      capture.select = sql;
      capture.selects = capture.selects || [];
      capture.selects.push(sql);
      return builder;
    },
    eq(column, value) {
      capture.eq = capture.eq || [];
      capture.eq.push([column, value]);
      return builder;
    },
    in(column, value) {
      capture.in = [column, value];
      return builder;
    },
    order(column, opts) {
      capture.order = [column, opts];
      return builder;
    },
    limit(n) {
      capture.limit = n;
      return builder;
    },
    single() {
      return Promise.resolve(result);
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

const MATCH_ROW = {
  id: "match-ready-1",
  request_id: "req-1",
  ruleset_id: "haitian",
  player_a: "creator-iphone",
  player_b: "acceptor-android",
  status: "ready",
  created_at: "2026-08-30T12:00:00.000Z",
  rated: true,
};

const PROFILES = [
  { id: "creator-iphone", display_name: "Leonord", avatar_id: "marcus", country_code: "HT" },
  { id: "acceptor-android", display_name: "Marie", avatar_id: "amina", country_code: "HT" },
];

function recoveryClient({ match = MATCH_ROW, session = null, acceptedAt = MATCH_ROW.created_at } = {}) {
  const captures = { tables: [] };
  return {
    captures,
    from(table) {
      captures.tables.push(table);
      if (table === "matches") {
        const isList = !captures.hydrating;
        if (isList) {
          captures.hydrating = true;
          return thenable({ data: match, error: null }, captures.list || (captures.list = {}));
        }
        return thenable({ data: match, error: null }, captures.hydrate || (captures.hydrate = {}));
      }
      if (table === "profiles") {
        return thenable({ data: PROFILES, error: null }, captures.profiles || (captures.profiles = {}));
      }
      if (table === "game_sessions") {
        return thenable({ data: session, error: null }, captures.session || (captures.session = {}));
      }
      if (table === "match_requests") {
        return thenable(
          { data: { accepted_at: acceptedAt }, error: null },
          captures.request || (captures.request = {})
        );
      }
      return thenable({ data: null, error: null });
    },
  };
}

{
  const client = recoveryClient();
  const active = await getMyActiveMatch(client);
  assert.equal(active.id, "match-ready-1");
  assert.equal(active.status, "ready");
  assert.equal(active.rulesetId, "haitian");
  assert.equal(active.styleId, "haitian");
  assert.equal(active.host.playerId, "creator-iphone");
  assert.equal(active.opponent.playerId, "acceptor-android");
  assert.equal(active.hasGameSession, false);
  assert.equal(active.gameplayStarted, false);
  assert.equal(active.reservedNotStarted, true);
  assert.equal(active.joinDeadlineAt, "2026-08-30T12:03:00.000Z");
  assert.equal(client.captures.list.in[0], "status");
  assert.deepEqual(client.captures.list.in[1], ["ready", "playing"]);
  assert.equal(client.captures.list.limit, 1);
  assert.equal(client.captures.source || active.source, "select");
  assert.ok(!client.captures.tables.includes("active_match_players"));
}

{
  const client = recoveryClient({
    match: { ...MATCH_ROW, status: "playing" },
    session: { match_id: "match-ready-1" },
  });
  const active = await getMyActiveMatch(client);
  assert.equal(active.status, "playing");
  assert.equal(active.hasGameSession, true);
  assert.equal(active.gameplayStarted, true);
  assert.equal(active.reservedNotStarted, false);
}

{
  const client = {
    from(table) {
      assert.equal(table, "matches");
      return thenable({ data: null, error: null });
    },
  };
  assert.equal(await getMyActiveMatch(client), null);
}

{
  const rpcClient = {
    async rpc(name) {
      assert.equal(name, "get_my_active_match");
      return {
        data: {
          match_id: "match-ready-1",
          has_game_session: false,
          gameplay_started: false,
          accepted_at: MATCH_ROW.created_at,
          join_deadline_at: "2026-08-30T12:03:00.000Z",
          rated: true,
        },
        error: null,
      };
    },
    from(table) {
      if (table === "matches") {
        return thenable({ data: MATCH_ROW, error: null });
      }
      if (table === "profiles") {
        return thenable({ data: PROFILES, error: null });
      }
      return thenable({ data: null, error: null });
    },
  };
  const active = await getMyActiveMatch(rpcClient);
  assert.equal(active.id, "match-ready-1");
  assert.equal(active.source, "rpc");
  assert.equal(active.gameplayStarted, false);
  assert.equal(Date.parse(active.joinDeadlineAt) - Date.parse(MATCH_ROW.created_at), JOIN_GRACE_MS);
}

{
  const outageClient = {
    async rpc(name) {
      assert.equal(name, "get_my_active_match");
      return {
        data: { match_id: "match-ready-1" },
        error: null,
      };
    },
    from(table) {
      if (table === "matches") {
        return thenable({
          data: null,
          error: { status: 521, message: "Web server is down" },
        });
      }
      return thenable({ data: null, error: null });
    },
  };
  // throwFromPostgrest now classifies 521 (a SERVICE_OUTAGE_HTTP status) as
  // SERVICE_UNAVAILABLE rather than the generic MATCH_FAILED fallback — the
  // original intent of this test (a hosted outage during hydrate must never
  // be silently swallowed into "no active match") still holds under the
  // more specific code: isMissingActiveMatchRow explicitly excludes every
  // infrastructure-outage error, so a caller still cannot mistake this for
  // "match not found."
  await assert.rejects(
    () => getMyActiveMatch(outageClient),
    (err) => err.code === "SERVICE_UNAVAILABLE",
    "hydrate 521 must not be treated as no active match"
  );
  assert.equal(
    isMissingActiveMatchRow({ status: 521, message: "Web server is down" }),
    false,
    "a 521 outage must never be classified as a missing/absent match row"
  );
}

{
  const schemaCacheClient = {
    async rpc() {
      return {
        data: null,
        error: {
          code: "PGRST002",
          status: 503,
          message: "Could not query the database for the schema cache. Retrying.",
        },
      };
    },
    from() {
      throw new Error("SELECT fallback must not run during schema-cache outage");
    },
  };
  // Same reclassification as the 521 case above: PGRST002/503 is a
  // SERVICE_OUTAGE_HTTP status, now correctly SERVICE_UNAVAILABLE.
  await assert.rejects(
    () => getMyActiveMatch(schemaCacheClient),
    (err) => err.code === "SERVICE_UNAVAILABLE"
  );
}

{
  const client = recoveryClient({
    match: { ...MATCH_ROW, status: "finished", finish_reason: "forfeit" },
  });
  assert.equal(await getMyActiveMatch(client), null);
}

{
  const client = recoveryClient({
    match: { ...MATCH_ROW, status: "playing" },
    session: { match_id: "match-ready-1", status: "match_over", phase: "matchOver" },
  });
  assert.equal(await getMyActiveMatch(client), null, "game_sessions match_over is never resumable");
}

{
  const { isResumableMatch } = await import("./joinTimeout.js");
  assert.equal(isResumableMatch({ id: "match-ready-1", status: "finished", finishReason: "forfeit" }), false);
  assert.equal(isResumableMatch({ id: "match-ready-1", status: "playing" }), true);
}

{
  assert.equal(isActiveMatchLockError(new MatchmakingError("PLAYER_BUSY")), true);
  assert.equal(isActiveMatchLockError(new MatchmakingError("ACTIVE_MATCH_EXISTS")), true);
  assert.throws(
    () => throwFromPostgrest({ message: "ACTIVE_MATCH_EXISTS" }),
    (err) => err.code === "ACTIVE_MATCH_EXISTS"
  );
}

{
  const findMatch = read("pages/FindMatchPage.jsx");
  assert.match(findMatch, /getMyActiveMatch/);
  assert.doesNotMatch(
    findMatch,
    /ownStatusRef\.current === ["']open["'] &&/
  );
  assert.match(findMatch, /nextOwn\?\.status === ["']accepted["']/);
  assert.match(findMatch, /visibilitychange/);
  assert.match(findMatch, /addEventListener\("online"/);
  assert.match(findMatch, /isActiveMatchLockError/);
  assert.match(findMatch, /resolveJoinTimeout/);
  assert.doesNotMatch(findMatch, /game_sessions|game_secrets|enter_online_match/);
}

{
  const app = read("App.jsx");
  const hook = read("hooks/useActiveOnlineMatch.js");
  const matchHook = read("hooks/useOnlineMatch.js");
  assert.match(app, /useActiveOnlineMatch/);
  assert.match(app, /activeOnlineMatch=\{activeOnline\.match\}/);
  assert.match(app, /getMyActiveMatch\(\)/);
  assert.doesNotMatch(app, /cleanupStaleOccupiedMatches/);
  assert.match(app, /match\?\.status && !canRecoverMatch/);
  assert.match(hook, /getMyActiveMatch/);
  assert.match(hook, /subscribeMatchRequests/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /addEventListener\("online"/);
  assert.match(hook, /canRecoverMatch/);
  assert.match(hook, /keep last known occupancy|Do not invent a cancellation/);
  assert.match(matchHook, /isMatchOverView\(kept\)/);
  assert.match(matchHook, /clearOnlineSession\(\)/);
  assert.match(matchHook, /persistOnlineSession/);
}

{
  const matchmaking = read("online/matchmaking.js");
  assert.match(matchmaking, /select\("match_id, status, phase"\)/);
  assert.match(matchmaking, /if \(!isResumableMatch\(match\)\)/);
  assert.match(matchmaking, /isMissingActiveMatchRow/);
}

{
  const home = read("pages/HomePage.jsx");
  const liveHome = read("pages/LeoPipsAuthenticatedHome.jsx");
  assert.match(home, /activeOnlineMatch/);
  assert.match(home, /home\.resumeMatch/);
  assert.match(home, /canRecoverMatch\(activeOnlineMatch\)/);
  assert.match(home, /onEnterMatch\?\.\(resumeOnline\)/);
  assert.match(home, /data-home-resume-online/);
  assert.doesNotMatch(home, /acceptMatchRequest|match_requests/);
  assert.match(liveHome, /canRecoverMatch\(activeOnlineMatch\)/);
  assert.match(liveHome, /onEnterMatch\?\.\(resumeOnline\)/);
  assert.doesNotMatch(liveHome, /acceptMatchRequest|match_requests|LeoPipsStakePage/);
}

console.log("  ✓ active match recovery");
