/**
 * Admin URL entry helpers.
 * Run: node src/online/adminRoute.test.js
 */
import assert from "node:assert/strict";
import { canLeaveAdminViaHistory, enterAdminLocation, goBackFromAdmin, isAdminLocation, leaveAdminLocation } from "./adminRoute.js";

assert.equal(isAdminLocation({ pathname: "/admin", hash: "" }), true);
assert.equal(isAdminLocation({ pathname: "/admin/", hash: "" }), true);
assert.equal(isAdminLocation({ pathname: "/", hash: "#/admin" }), true);
assert.equal(isAdminLocation({ pathname: "/", hash: "#admin" }), true);
assert.equal(isAdminLocation({ pathname: "/", hash: "" }), false);
assert.equal(isAdminLocation({ pathname: "/privacy", hash: "" }), false);
assert.equal(isAdminLocation({ pathname: "/invite", hash: "" }), false);
assert.equal(isAdminLocation(null), false);

{
  const history = [];
  const loc = { protocol: "https:", pathname: "/", hash: "" };
  const win = {
    location: loc,
    history: {
      pushState(_state, _title, url) {
        history.push(url);
        loc.pathname = url;
      },
    },
  };
  enterAdminLocation(win);
  assert.deepEqual(history, ["/admin"]);
  leaveAdminLocation(win);
  assert.deepEqual(history, ["/admin", "/"]);
}

{
  const loc = { protocol: "file:", pathname: "/index.html", hash: "" };
  const win = { location: loc, history: { pushState() {} } };
  enterAdminLocation(win);
  assert.equal(loc.hash, "#/admin");
  leaveAdminLocation(win);
  assert.equal(loc.hash, "");
}

{
  const calls = [];
  const loc = { protocol: "https:", pathname: "/admin", hash: "" };
  const win = {
    location: loc,
    history: {
      length: 3,
      state: { leoAdmin: true },
      back() {
        calls.push("back");
      },
      replaceState() {
        calls.push("replace");
      },
    },
  };
  assert.equal(canLeaveAdminViaHistory(win), true);
  goBackFromAdmin(win, () => calls.push("home"));
  assert.deepEqual(calls, ["back"]);
}

{
  const calls = [];
  const loc = { protocol: "https:", pathname: "/admin", hash: "" };
  const win = {
    location: loc,
    history: {
      length: 1,
      state: null,
      back() {
        calls.push("back");
      },
      replaceState(_state, _title, url) {
        calls.push(["replace", url]);
        loc.pathname = url;
      },
    },
  };
  assert.equal(canLeaveAdminViaHistory(win), false);
  goBackFromAdmin(win, () => calls.push("home"));
  assert.deepEqual(calls, [["replace", "/"], "home"]);
}

{
  const calls = [];
  const loc = { protocol: "https:", pathname: "/admin", hash: "" };
  const win = {
    location: loc,
    history: {
      length: 8,
      state: null,
      back() {
        calls.push("back");
      },
      replaceState(_state, _title, url) {
        calls.push(["replace", url]);
        loc.pathname = url;
      },
    },
  };
  assert.equal(canLeaveAdminViaHistory(win), false);
  goBackFromAdmin(win, () => calls.push("home"));
  assert.deepEqual(calls, [["replace", "/"], "home"]);
}

console.log("  ✓ admin route helpers");
