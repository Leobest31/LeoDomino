/**
 * Read-only LeoPips wallet client contract.
 * Run: node src/leopips/leopipsWalletRead.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readMyLeoPipsWallet,
  subscribeMyLeoPipsWallet,
  notifyLeoPipsWalletChanged,
  LeoPipsWalletError,
  LEOPIPS_WALLET_TABLE,
  LEOPIPS_WALLET_CHANGED_EVENT,
} from "./leopipsWalletRead.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = readFileSync(join(root, "src/leopips/leopipsWalletRead.js"), "utf8");
const wrapper = readFileSync(join(root, "src/pages/LeoPipsAuthenticatedHome.jsx"), "utf8");
const online = readFileSync(join(root, "src/pages/OnlineGamePage.jsx"), "utf8");
const app = readFileSync(join(root, "src/App.jsx"), "utf8");
const findMatch = readFileSync(join(root, "src/pages/FindMatchPage.jsx"), "utf8");
const matchmaking = readFileSync(join(root, "src/online/matchmaking.js"), "utf8");

assert.equal(LEOPIPS_WALLET_TABLE, "player_leopips_wallets");
assert.equal(LEOPIPS_WALLET_CHANGED_EVENT, "leodomino:leopips-wallet-changed");
assert.match(src, /\.from\(LEOPIPS_WALLET_TABLE\)/);
assert.match(src, /\.select\("balance"\)/);
assert.match(src, /\.maybeSingle\(\)/);
assert.match(src, /subscribeMyLeoPipsWallet/);
assert.match(src, /postgres_changes/);
assert.match(src, /notifyLeoPipsWalletChanged/);
assert.doesNotMatch(src, /\.rpc\(/);
assert.doesNotMatch(src, /get_my_leopips_wallet/);
assert.doesNotMatch(src, /_leopips_ensure_initial_grant/);
assert.doesNotMatch(src, /_leopips_debit|_leopips_credit|_leopips_apply/);
assert.doesNotMatch(src, /match_stake|match_payout|timeout_penalty|referral_reward/);
assert.doesNotMatch(src, /insert\(|update\(|upsert\(/i);

assert.match(wrapper, /readMyLeoPipsWallet/);
assert.match(wrapper, /subscribeMyLeoPipsWallet/);
assert.match(wrapper, /LEOPIPS_WALLET_CHANGED_EVENT/);
assert.doesNotMatch(wrapper, /get_my_leopips_wallet/);
assert.doesNotMatch(wrapper, /5240|5,240/);
assert.doesNotMatch(wrapper, /LeoPipsStakePage/);
assert.match(wrapper, /onPlayOnline/);
assert.match(wrapper, /onFindMatch/);

assert.match(online, /notifyLeoPipsWalletChanged/);
assert.match(online, /loadLeoPipsMatchResult/);
assert.match(online, /source: "match_over"/);

assert.match(app, /LeoPipsAuthenticatedHome/);
assert.doesNotMatch(app, /LeoPipsStakePage/);
assert.match(app, /LeoPipsAuthenticatedStake/);
assert.match(app, /onFindMatch=\{\(\) => setPhase\("leopipsStake"\)\}/);
assert.match(app, /<FindMatchPage/);

assert.match(findMatch, /acceptMatchRequest/);
assert.doesNotMatch(findMatch, /leopips|LeoPipsStakePage|stake_pips/);
assert.match(matchmaking, /acceptMatchRequest/);
assert.doesNotMatch(matchmaking, /leopips|_leopips_debit/);

{
  const missingUser = {
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  };
  await assert.rejects(() => readMyLeoPipsWallet({ client: missingUser }), (error) => {
    assert.ok(error instanceof LeoPipsWalletError);
    assert.equal(error.code, "AUTH");
    return true;
  });
}

{
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "player-1" } }, error: null }) },
    from(table) {
      assert.equal(table, "player_leopips_wallets");
      return {
        select(cols) {
          assert.equal(cols, "balance");
          return {
            eq(col, id) {
              assert.equal(col, "player_id");
              assert.equal(id, "player-1");
              return {
                maybeSingle: async () => ({ data: { balance: 1000 }, error: null }),
              };
            },
          };
        },
      };
    },
  };
  const result = await readMyLeoPipsWallet({ client });
  assert.deepEqual(result, { status: "ready", balance: 1000 });
}

{
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "player-1" } }, error: null }) },
    from() {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: async () => ({ data: null, error: null }) };
            },
          };
        },
      };
    },
  };
  const result = await readMyLeoPipsWallet({ client });
  assert.deepEqual(result, { status: "missing", balance: null });
}

{
  let seen = null;
  const handlers = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "player-1" } }, error: null }) },
    channel() {
      const ch = {
        on(_type, filter, cb) {
          assert.equal(filter.table, "player_leopips_wallets");
          assert.equal(filter.filter, "player_id=eq.player-1");
          handlers.push(cb);
          return ch;
        },
        subscribe() {
          return ch;
        },
        unsubscribe() {},
      };
      return ch;
    },
    removeChannel() {},
  };
  const unsub = await subscribeMyLeoPipsWallet((result) => {
    seen = result;
  }, { client });
  assert.equal(typeof unsub, "function");
  handlers[0]({ new: { balance: 925 } });
  assert.deepEqual(seen, { status: "ready", balance: 925 });
  unsub();
}

{
  let fired = false;
  const handler = () => {
    fired = true;
  };
  const target = globalThis;
  if (typeof target.addEventListener === "function") {
    target.addEventListener(LEOPIPS_WALLET_CHANGED_EVENT, handler);
    notifyLeoPipsWalletChanged({ source: "test" });
    target.removeEventListener(LEOPIPS_WALLET_CHANGED_EVENT, handler);
    assert.equal(fired, true);
  } else {
    // Node: notify must no-op safely without window.
    notifyLeoPipsWalletChanged({ source: "test" });
  }
}

console.log("  ✓ LeoPips wallet read-only client contract");
