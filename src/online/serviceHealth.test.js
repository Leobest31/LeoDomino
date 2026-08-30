/**
 * Online service-outage fail-safe. Run: node src/online/serviceHealth.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_BACKEND_I18N_KEY,
  SERVICE_OUTAGE_I18N_KEY,
  SERVICE_OUTAGE_NETWORK_THRESHOLD,
  emptyServiceHealthState,
  httpStatusFromError,
  isDomainGameplayError,
  isImmediateInfrastructureOutage,
  isInfrastructureOutageError,
  noteServiceFailure,
  noteServiceSuccess,
  planOutageHealthTick,
  shouldDisableGameplayActions,
  shouldSuppressTimeoutResolve,
} from "./serviceHealth.js";
import { planTimeoutTick } from "./timeoutFreeze.js";
import { isMatchOverView, onlineErrorKey } from "./onlineTable.js";
import { ADMIN_ERROR, AdminError } from "./adminDashboard.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hook = readFileSync(join(root, "src/hooks/useOnlineMatch.js"), "utf8");
const page = readFileSync(join(root, "src/pages/OnlineGamePage.jsx"), "utf8");
const adminPage = readFileSync(join(root, "src/pages/AdminPage.jsx"), "utf8");
const adminDash = readFileSync(join(root, "src/online/adminDashboard.js"), "utf8");
const en = readFileSync(join(root, "src/i18n/locales/en.js"), "utf8");
const ht = readFileSync(join(root, "src/i18n/locales/ht.js"), "utf8");

const pgrst504 = {
  status: 504,
  code: "PGRST003",
  message: "Timed out acquiring connection from connection pool.",
};
const http503 = { status: 503, message: "upstream connect error or disconnect/reset before headers." };
const networkTimeout = { name: "AbortError", message: "The user aborted a request." };
const timeoutNotDue = { code: "TIMEOUT_NOT_DUE", message: "timeout not due" };
const illegalTile = { code: "ILLEGAL_TILE", message: "illegal tile" };

{
  assert.equal(httpStatusFromError(pgrst504), 504);
  assert.equal(isImmediateInfrastructureOutage(pgrst504), true);
  const next = noteServiceFailure(emptyServiceHealthState(), pgrst504, 1000);
  assert.equal(next.outage, true);
  assert.equal(shouldSuppressTimeoutResolve(next), true);
  assert.equal(shouldDisableGameplayActions(next), true);
  console.log("  ✓ 504 + PGRST003 enters outage mode");
}

{
  const next = noteServiceFailure(emptyServiceHealthState(), http503, 1000);
  assert.equal(next.outage, true);
  console.log("  ✓ 503 enters outage mode");
}

{
  const delayed = { message: "delayed connect error: 111" };
  assert.equal(isImmediateInfrastructureOutage(delayed), true);
  assert.equal(noteServiceFailure(emptyServiceHealthState(), delayed, 1000).outage, true);
  console.log("  ✓ PostgREST delayed-connect 503 body enters outage");
}

{
  assert.equal(SERVICE_OUTAGE_NETWORK_THRESHOLD, 2);
  const one = noteServiceFailure(emptyServiceHealthState(), networkTimeout, 1000);
  assert.equal(one.outage, false);
  assert.equal(one.consecutiveNetworkFailures, 1);
  const two = noteServiceFailure(one, networkTimeout, 2000);
  assert.equal(two.outage, true);
  console.log("  ✓ network timeout enters outage after consecutive threshold");
}

{
  const one = noteServiceFailure(emptyServiceHealthState(), networkTimeout, 1000);
  assert.equal(one.outage, false);
  const recovered = noteServiceSuccess(one);
  assert.equal(recovered.outage, false);
  assert.equal(recovered.consecutiveNetworkFailures, 0);
  console.log("  ✓ one transient failure does not enter outage");
}

{
  assert.equal(isDomainGameplayError(timeoutNotDue), true);
  const next = noteServiceFailure(emptyServiceHealthState(), timeoutNotDue, 1000);
  assert.equal(next.outage, false);
  assert.equal(isInfrastructureOutageError(timeoutNotDue), false);
  console.log("  ✓ TIMEOUT_NOT_DUE does not become service outage");
}

{
  const next = noteServiceFailure(emptyServiceHealthState(), illegalTile, 1000);
  assert.equal(next.outage, false);
  assert.equal(isDomainGameplayError(illegalTile), true);
  console.log("  ✓ invalid move does not become service outage");
}

{
  const outage = noteServiceFailure(emptyServiceHealthState(), pgrst504, 1000);
  assert.equal(shouldDisableGameplayActions(outage), true);
  assert.match(hook, /shouldDisableGameplayActions/);
  assert.match(hook, /if \(shouldDisableGameplayActions\(health\)\) return false/);
  console.log("  ✓ outage mode disables gameplay actions");
}

{
  const outage = noteServiceFailure(emptyServiceHealthState(), pgrst504, 1000);
  assert.equal(shouldSuppressTimeoutResolve(outage), true);
  const planned = planTimeoutTick(
    { phase: "playing", status: "playing", turnDeadlineAt: "2000-01-01T00:00:00.000Z" },
    { nowMs: Date.now(), serviceOutage: true }
  );
  assert.equal(planned.action, "idle");
  assert.match(hook, /shouldSuppressTimeoutResolve/);
  assert.match(hook, /serviceOutage:/);
  console.log("  ✓ outage mode suppresses timeout resolution");
}

{
  assert.match(hook, /keep last authoritative view/);
  assert.match(page, /data-online-outage/);
  assert.match(page, /serviceOutage/);
  console.log("  ✓ last known-good board remains visible in outage wiring");
}

{
  const outage = noteServiceFailure(emptyServiceHealthState(), pgrst504, 1000);
  const recovered = noteServiceSuccess(outage);
  assert.equal(recovered.outage, false);
  assert.match(hook, /noteServiceSuccess/);
  assert.match(hook, /asViewerSnapshot\(await getGameView/);
  console.log("  ✓ healthy authoritative get_game_view exits outage mode");
}

{
  const aborted = {
    matchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "match_over",
    phase: "matchOver",
    finishReason: "aborted",
    matchWinnerSeat: null,
    scores: [0, 0],
  };
  assert.equal(isMatchOverView(aborted), true);
  assert.match(page, /isOnlineMatchAborted/);
  assert.doesNotMatch(
    readFileSync(join(root, "src/online/serviceHealth.js"), "utf8"),
    /matchWinnerSeat\s*=\s*[01]|scores\s*=\s*\[|settle_match_global_rp|winner_new_rp/
  );
  console.log("  ✓ server-aborted match after recovery uses server state; no fabricated RP/winner");
}

{
  assert.equal(onlineErrorKey({ code: "SERVICE_UNAVAILABLE" }), SERVICE_OUTAGE_I18N_KEY);
  assert.match(en, /Online service temporarily unavailable\. Your match is paused safely\./);
  assert.match(ht, /Sèvis online lan pa disponib pou kounye a\. Match ou a kanpe an sekirite\./);
  assert.match(
    readFileSync(join(root, "src/i18n/locales/fr.js"), "utf8"),
    /Le service en ligne est temporairement indisponible\. Votre partie est en pause en toute sécurité\./
  );
  assert.match(
    readFileSync(join(root, "src/i18n/locales/es.js"), "utf8"),
    /El servicio en línea no está disponible por el momento\. Tu partida está pausada de forma segura\./
  );
  assert.match(
    readFileSync(join(root, "src/i18n/locales/pt.js"), "utf8"),
    /O serviço online está temporariamente indisponível\. A tua partida está em pausa em segurança\./
  );
  console.log("  ✓ i18n outage copy present");
}

{
  assert.equal(ADMIN_ERROR.BACKEND, "backend");
  const mapped = new AdminError(ADMIN_ERROR.BACKEND, "pool", pgrst504);
  assert.equal(mapped.code, "backend");
  assert.match(adminDash, /ADMIN_ERROR\.BACKEND/);
  assert.match(adminDash, /PGRST003/);
  assert.match(adminPage, /adminErrorI18nKey|ADMIN_ERROR\.BACKEND/);
  assert.match(en, /Online backend is temporarily unavailable\. Admin data will retry automatically\./);
  assert.equal(ADMIN_BACKEND_I18N_KEY, "admin.backendUnavailable");
  console.log("  ✓ Admin maps backend outage errors specifically");
}

{
  const waiting = planOutageHealthTick(
    { outage: true, retryNotBefore: 5000, retryAttempt: 0, consecutiveNetworkFailures: 0 },
    1000
  );
  assert.equal(waiting.action, "wait");
  const refresh = planOutageHealthTick(
    { outage: true, retryNotBefore: 500, retryAttempt: 0, consecutiveNetworkFailures: 0 },
    1000
  );
  assert.equal(refresh.action, "refresh");
  console.log("  ✓ outage health retry is conservative");
}

console.log("\nserviceHealth tests OK\n");
