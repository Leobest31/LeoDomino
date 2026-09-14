/**
 * Stale accepted→finished must not trap Find Match; staked create fails closed.
 * Run: node src/online/staleAcceptedOwnRequest.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MatchmakingError,
  createMatchRequest,
  getOwnLatestRequest,
  isLiveOwnMatchmakingRequest,
} from "./matchmaking.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const mm = readFileSync(join(root, "src/online/matchmaking.js"), "utf8");
const page = readFileSync(join(root, "src/pages/FindMatchPage.jsx"), "utf8");

{
  // 1. OPEN still live
  assert.equal(
    isLiveOwnMatchmakingRequest(
      {
        status: "open",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      null
    ),
    true
  );
}

{
  // 2–3. accepted + ready/playing → live
  assert.equal(
    isLiveOwnMatchmakingRequest(
      { status: "accepted", matchId: "m1" },
      { id: "m1", status: "ready" }
    ),
    true
  );
  assert.equal(
    isLiveOwnMatchmakingRequest(
      { status: "accepted", matchId: "m2" },
      { id: "m2", status: "playing" }
    ),
    true
  );
}

{
  // 4–5. accepted + finished / missing → stale
  assert.equal(
    isLiveOwnMatchmakingRequest(
      { status: "accepted", matchId: "m3" },
      { id: "m3", status: "finished", finishReason: "forfeit" }
    ),
    false
  );
  assert.equal(
    isLiveOwnMatchmakingRequest({ status: "accepted", matchId: "m4" }, null),
    false
  );
  assert.equal(
    isLiveOwnMatchmakingRequest({ status: "accepted", matchId: null }, { id: "x", status: "ready" }),
    false
  );
}

function chainFrom(tableHandlers) {
  return {
    from(table) {
      const handler = tableHandlers[table];
      if (!handler) throw new Error(`unexpected table ${table}`);
      return handler();
    },
  };
}

{
  // getOwnLatestRequest: open returned
  const client = chainFrom({
    match_requests: () => ({
      select() {
        return {
          eq() {
            return {
              in() {
                return {
                  neq() {
                    return {
                      order() {
                        return {
                          limit() {
                            return {
                              maybeSingle() {
                                return Promise.resolve({
                                  data: {
                                    id: "req-open",
                                    creator_id: "p1",
                                    ruleset_id: "legacy",
                                    stake_pips: 20,
                                    status: "open",
                                    match_id: null,
                                    created_at: new Date().toISOString(),
                                    expires_at: new Date(Date.now() + 600000).toISOString(),
                                    visibility: "public",
                                  },
                                  error: null,
                                });
                              },
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    }),
  });
  const own = await getOwnLatestRequest("p1", client);
  assert.equal(own?.id, "req-open");
  assert.equal(own?.status, "open");
}

{
  // getOwnLatestRequest: accepted + ready kept
  const client = chainFrom({
    match_requests: () => ({
      select() {
        return {
          eq() {
            return {
              in() {
                return {
                  neq() {
                    return {
                      order() {
                        return {
                          limit() {
                            return {
                              maybeSingle() {
                                return Promise.resolve({
                                  data: {
                                    id: "req-acc",
                                    creator_id: "p1",
                                    ruleset_id: "haitian",
                                    stake_pips: 150,
                                    status: "accepted",
                                    match_id: "match-ready",
                                    created_at: new Date().toISOString(),
                                    expires_at: new Date(Date.now() + 600000).toISOString(),
                                    visibility: "public",
                                  },
                                  error: null,
                                });
                              },
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    }),
    matches: () => ({
      select() {
        return {
          eq() {
            return {
              maybeSingle() {
                return Promise.resolve({
                  data: { id: "match-ready", status: "ready", finish_reason: null, finished_at: null },
                  error: null,
                });
              },
            };
          },
        };
      },
    }),
  });
  const own = await getOwnLatestRequest("p1", client);
  assert.equal(own?.id, "req-acc");
  assert.equal(own?.matchId, "match-ready");
}

{
  // getOwnLatestRequest: accepted + finished ignored
  const client = chainFrom({
    match_requests: () => ({
      select() {
        return {
          eq() {
            return {
              in() {
                return {
                  neq() {
                    return {
                      order() {
                        return {
                          limit() {
                            return {
                              maybeSingle() {
                                return Promise.resolve({
                                  data: {
                                    id: "req-stale",
                                    creator_id: "p1",
                                    ruleset_id: "legacy",
                                    stake_pips: 150,
                                    status: "accepted",
                                    match_id: "515fe6f5-81ad-4faa-918a-4fd92f7af09a",
                                    created_at: new Date().toISOString(),
                                    expires_at: new Date(Date.now() + 600000).toISOString(),
                                    visibility: "public",
                                  },
                                  error: null,
                                });
                              },
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    }),
    matches: () => ({
      select() {
        return {
          eq() {
            return {
              maybeSingle() {
                return Promise.resolve({
                  data: {
                    id: "515fe6f5-81ad-4faa-918a-4fd92f7af09a",
                    status: "finished",
                    finish_reason: "forfeit",
                    finished_at: new Date().toISOString(),
                  },
                  error: null,
                });
              },
            };
          },
        };
      },
    }),
  });
  const own = await getOwnLatestRequest("p1", client);
  assert.equal(own, null);
}

{
  // getOwnLatestRequest: accepted + missing match ignored
  const client = chainFrom({
    match_requests: () => ({
      select() {
        return {
          eq() {
            return {
              in() {
                return {
                  neq() {
                    return {
                      order() {
                        return {
                          limit() {
                            return {
                              maybeSingle() {
                                return Promise.resolve({
                                  data: {
                                    id: "req-missing",
                                    creator_id: "p1",
                                    ruleset_id: "legacy",
                                    stake_pips: 20,
                                    status: "accepted",
                                    match_id: "gone",
                                    created_at: new Date().toISOString(),
                                    expires_at: new Date(Date.now() + 600000).toISOString(),
                                    visibility: "public",
                                  },
                                  error: null,
                                });
                              },
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    }),
    matches: () => ({
      select() {
        return {
          eq() {
            return {
              maybeSingle() {
                return Promise.resolve({ data: null, error: null });
              },
            };
          },
        };
      },
    }),
  });
  assert.equal(await getOwnLatestRequest("p1", client), null);
}

{
  // 9–10. staked create does NOT blind-insert when RPC missing
  let inserted = false;
  const client = {
    rpc() {
      return Promise.resolve({
        data: null,
        error: { code: "PGRST202", message: "Could not find the function" },
      });
    },
    from() {
      return {
        insert() {
          inserted = true;
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({ data: { id: "should-not" }, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
  await assert.rejects(
    () => createMatchRequest("classic", 20, client),
    (err) => err instanceof MatchmakingError && err.code === "JOIN_OR_CREATE_UNAVAILABLE"
  );
  assert.equal(inserted, false, "no blind INSERT on RPC miss");
}

{
  // NULL stake / unstaked still inserts
  const capture = {};
  const client = {
    from() {
      return {
        insert(row) {
          capture.insert = row;
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({
                    data: {
                      id: "req-null",
                      creator_id: "p1",
                      ruleset_id: "haitian",
                      status: "open",
                      created_at: new Date().toISOString(),
                      expires_at: new Date(Date.now() + 600000).toISOString(),
                    },
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };
  const created = await createMatchRequest("haitian", client);
  assert.deepEqual(capture.insert, { ruleset_id: "haitian" });
  assert.equal(created.id, "req-null");
}

{
  // Wiring contracts
  assert.match(mm, /export function isLiveOwnMatchmakingRequest/);
  assert.match(mm, /fetchLinkedMatchBrief/);
  assert.match(mm, /isLiveOwnMatchmakingRequest\(own, linked\)/);
  assert.match(mm, /Public staked Find Match MUST use/);
  assert.doesNotMatch(
    mm.slice(mm.indexOf("export async function createMatchRequest"), mm.indexOf("export async function listOpenMatchRequests")),
    /Fall through to insert|JOIN_OR_CREATE_UNAVAILABLE[\s\S]*insert\(row\)/
  );
  assert.match(page, /liveAcceptedPending/);
  assert.doesNotMatch(page, /Hosted RPC not applied yet/);
  assert.doesNotMatch(
    page.slice(page.indexOf("const handleCreate"), page.indexOf("const handleDiagTitleTap")),
    /createMatchRequest\(selectedId, lockedStakePips\)/
  );
  assert.match(
    page.slice(page.indexOf("const handleCreate"), page.indexOf("const handleDiagTitleTap")),
    /joinOrCreatePublicMatchRequest\(selectedId, lockedStakePips\)/
  );
}

console.log("  ✓ stale accepted own-request + staked fail-closed");
