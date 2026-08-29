/**
 * Admin Dashboard V1 Phase 1 UI contract.
 * Run: node src/ui/admin.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const app = read("App.jsx");
const page = read("pages/AdminPage.jsx");
const css = read("pages/AdminPage.css");
const settings = read("components/SettingsPanel.jsx");
const home = read("pages/HomePage.jsx");
const en = read("i18n/locales/en.js");
const client = read("online/adminDashboard.js");
const sql = readFileSync(join(root, "..", "supabase/migrations/20260828290000_admin_dashboard_phase1.sql"), "utf8");
const liveSql = readFileSync(join(root, "..", "supabase/migrations/20260828300000_admin_live_matches_phase2a.sql"), "utf8");
const spectatorSql = readFileSync(
  join(root, "..", "supabase/migrations/20260828310000_admin_live_match_spectator.sql"),
  "utf8"
);
const spectator = read("pages/AdminSpectatorView.jsx");

assert.match(app, /"admin"/);
assert.match(app, /<AdminPage/);
assert.match(app, /phase === "admin" && playable/);
assert.match(app, /probeAmIStaff/);
assert.match(app, /isAdminLocation/);
assert.match(app, /enterAdminLocation/);
assert.match(app, /leaveAdminLocation/);
assert.match(app, /goBackFromAdmin/);
assert.match(app, /handleAdminBack/);
assert.match(app, /onBack=\{handleAdminBack\}/);
assert.match(app, /showAdmin=\{typeof staffRole === "string"\}/);
assert.doesNotMatch(app, /localStorage|sessionStorage/);
assert.doesNotMatch(app, /supabaseClient|@supabase\/supabase-js|SERVICE_ROLE/);

assert.match(page, /data-admin="true"/);
assert.match(page, /data-admin-back="true"/);
assert.match(page, /common\.back/);
assert.match(page, /AdminBackBar/);
assert.doesNotMatch(page, /admin-page__home/);
assert.doesNotMatch(page, /admin\.backHome/);
assert.match(page, /data-admin-gate="denied"/);
assert.match(page, /data-admin-gate="ok"/);
assert.match(page, /data-admin-gate="checking"/);
assert.match(page, /probeAmIStaff/);
assert.match(page, /fetchAdminOverview/);
assert.match(page, /fetchAdminUsers/);
assert.match(page, /overviewCardsFromPayload/);
assert.match(page, /data-admin-overview="true"/);
assert.match(page, /data-admin-users="true"/);
assert.match(page, /data-admin-search="true"/);
assert.match(page, /data-admin-page="true"/);
assert.match(page, /data-admin-detail="true"/);
assert.match(page, /data-admin-nav-item=\{id\}/);
assert.match(page, /data-admin-card=\{card.id\}/);
assert.match(page, /"globalRp"/);
assert.match(page, /"liveMatches"/);
assert.match(page, /ADMIN_V1_NAV/);
assert.match(page, /AdminV1Panels/);
assert.doesNotMatch(page, /admin\.comingNext/);
assert.doesNotMatch(page, /is-disabled/);
assert.match(page, /data-admin-live="true"/);
assert.match(page, /data-admin-live-empty/);
assert.match(page, /data-admin-live-detail/);
assert.match(page, /data-admin-live-view/);
assert.match(page, /fetchAdminLiveMatches/);
assert.match(page, /ADMIN_LIVE_POLL_MS/);
assert.match(page, /data-admin-watch-live/);
assert.match(page, /admin\.watchLive/);
assert.match(page, /AdminSpectatorView/);
assert.doesNotMatch(page, /get_game_view|submit_game_action|forfeit_online_match/);
assert.doesNotMatch(page, /get_game_view|myHand|engine_state|game_secrets/);
assert.match(page, /admin\.accessDenied/);
assert.match(page, /setOffset\(offset \+ ADMIN_PAGE_SIZE\)/);
assert.match(page, /searchInput/);
assert.doesNotMatch(page, /localStorage|sessionStorage/);
assert.doesNotMatch(page, /email|phone|password|raw_user_meta_data|accountAge|service_role/i);
assert.doesNotMatch(page, /getSupabaseClient|createClient|SERVICE_ROLE/);
assert.doesNotMatch(page, /settle_match_global_rp|findMatch|onPlayVsLeoBest/);

assert.match(css, /#070b14|#05070d/);
assert.match(css, /color-gold/);
assert.match(css, /color-success/);
assert.match(css, /admin-page__topbar/);
assert.match(css, /admin-page__back/);
assert.match(css, /safe-area-inset-top/);
assert.match(css, /admin-page__match-list/);
assert.match(css, /admin-page__match/);
assert.match(css, /max-width: 860px/);
assert.match(css, /min-height: 44px/);
assert.doesNotMatch(css, /admin-page__home/);

assert.match(settings, /data-settings-admin="true"/);
assert.match(settings, /showAdmin/);
assert.match(settings, /admin\.openAdmin/);
assert.doesNotMatch(settings, /getSupabaseClient|createClient/);
assert.match(home, /showAdmin=\{Boolean\(showAdmin\)\}/);
assert.match(home, /onOpenAdmin/);

assert.match(client, /dropPrivateKeys|PRIVATE_FIELD/);
assert.match(sql, /public\.is_staff\('moderator'\)/);
assert.doesNotMatch(sql, /email|phone|password|raw_user_meta_data/i);
assert.match(liveSql, /admin_list_live_matches/);
assert.match(liveSql, /public\.is_staff\('moderator'\)/);
assert.doesNotMatch(liveSql, /get_game_view|game_secrets|engine_state|myHand/);
assert.doesNotMatch(liveSql, /CREATE POLICY|GRANT SELECT/);

assert.match(page, /admin\.metricUnavailable/);
assert.match(page, /data-admin-card-unavailable/);
assert.match(page, /gate === "ok" && selected/);
assert.doesNotMatch(client, /\.from\(/);
assert.match(page, /data-admin-account=/);
assert.match(page, /data-admin-presence=/);
assert.match(page, /presencePillClass/);
assert.match(page, /is-presence-online/);
assert.match(page, /is-presence-offline/);
assert.match(page, /is-presence-in-match/);
assert.match(css, /\.admin-page__pill\.is-presence-online/);
assert.match(css, /\.admin-page__pill\.is-presence-offline/);
assert.match(css, /\.admin-page__pill\.is-presence-in-match/);
assert.match(css, /\.admin-page__pill\.is-ok/);
assert.match(css, /\.admin-page__pill\.is-deleted/);
assert.match(page, /account === "deleted" \? " is-deleted" : " is-ok"/);
assert.doesNotMatch(
  page,
  /data-admin-presence=\{presence\}[\s\S]{0,80}is-live|data-admin-presence=\{selectedPresence\}[\s\S]{0,80}is-live/
);
assert.match(page, /adminAccountStatus/);
assert.match(page, /adminPresenceState/);
assert.match(page, /admin\.accountStatus/);
assert.match(page, /admin\.presence/);
assert.match(page, /admin\.presenceHint/);
assert.doesNotMatch(
  page,
  /deletedAt\s*\?\s*t\("admin\.deleted"\)\s*:\s*[\s\S]*inActiveMatch\s*\?\s*t\("admin\.inMatch"\)\s*:\s*t\("admin\.active"\)/,
  "Users table does not mix account status with occupancy"
);
assert.match(en, /accountStatus: "Account"/);
assert.match(en, /presenceInMatch: "In Match"/);
assert.match(en, /presenceOffline: "Offline"/);
assert.match(client, /adminPresenceState/);
assert.match(client, /STALE_MATCH_GRACE_MS/);
assert.doesNotMatch(client, /leo-presence:/);
assert.match(en, /globalOnlineUsers: "Global Online Users"/);
assert.match(en, /metricUnavailable: "Not available yet"/);
assert.match(en, /noLiveMatches: "No live matches right now."/);
assert.match(en, /started: "Match created"/);
assert.match(en, /statusDisconnected: "Disconnected"/);
assert.match(en, /viewDetails: "View"/);
assert.match(page, /admin\.onlineUnavailableHint/);
assert.match(page, /ADMIN_PRESENCE_POLL_MS/);
assert.match(page, /admin\.onlineCountHint/);
assert.match(en, /onlineCountHint:/);
assert.match(en, /Match occupancy is not enough/);
assert.match(en, /Occupancy alone is Offline/);
assert.match(client, /if \(!isFreshSignedIn\(user, nowMs\)\) return "offline"/);
assert.match(client, /PRESENCE_ONLINE_GRACE_MS/);
assert.match(client, /presenceLastSeenAt/);
assert.match(page, /data-admin-user-recent/);
assert.doesNotMatch(page, /forceEndMatch|banUser|suspendAccount|editRp/);
assert.match(en, /spectatorEnded: "This match has ended."/);
assert.match(en, /noTopRp: "No rated players yet."/);
assert.match(en, /rankedActivity: "Ranked activity"/);
assert.match(en, /rpBefore: "RP before"/);
assert.match(en, /rpChange: "RP change"/);
assert.match(en, /rpAfter: "RP after"/);
assert.match(page, /data-admin-top-rp="true"/);
assert.match(page, /data-admin-top-rp-player/);
assert.match(page, /data-admin-rp-detail="true"/);
assert.match(page, /data-admin-rp-history="true"/);
assert.match(page, /data-admin-rp-settled-at=/);
assert.match(page, /dateStyle: "medium"/);
assert.match(page, /timeStyle: "short"/);
assert.match(page, /fetchAdminTopRp/);
assert.match(page, /fetchAdminPlayerRpHistory/);
assert.match(page, /admin\.noTopRp/);
assert.match(page, /admin\.noRpHistory/);
assert.match(page, /admin\.loading/);
assert.match(css, /admin-page__rp-history/);
assert.match(css, /admin-page__rp-event/);
assert.doesNotMatch(page, /editRp|setRp\(|suspend|banUser|mutateMatch/);
assert.doesNotMatch(page, /settle_match_global_rp|UPDATE public\.player_global_ratings/);
assert.doesNotMatch(page, /type="number"/);

assert.match(spectatorSql, /admin_get_live_match_view/);
assert.match(spectatorSql, /public\.is_staff\('moderator'\)/);
assert.match(spectatorSql, /'board', COALESCE\(gs\.board/);
assert.doesNotMatch(spectatorSql, /get_game_view|game_secrets|engine_state|myHand/);
assert.doesNotMatch(spectatorSql, /CREATE POLICY|GRANT SELECT/);
assert.match(spectatorSql, /REVOKE ALL ON FUNCTION public\.admin_get_live_match_view\(uuid\) FROM PUBLIC, anon/);

assert.match(spectator, /data-admin-spectator="true"/);
assert.match(spectator, /data-admin-spectator-readonly="true"/);
assert.match(spectator, /data-admin-spectator-board/);
assert.match(spectator, /data-admin-spectator-hand-a/);
assert.match(spectator, /data-admin-spectator-hand-b/);
assert.match(spectator, /data-admin-spectator-ended/);
assert.match(spectator, /<GameTable/);
assert.match(spectator, /<OpponentPanel/);
assert.match(spectator, /faceDown|OpponentPanel/);
assert.match(spectator, /fetchAdminLiveMatchView/);
assert.match(spectator, /ADMIN_SPECTATOR_POLL_MS/);
assert.match(spectator, /setInterval/);
assert.match(spectator, /shouldApplySpectatorSnapshot/);
assert.match(spectator, /isAdminSpectatorEnded/);
assert.match(spectator, /remainingTurnMs/);
assert.match(spectator, /statusTone/);
assert.doesNotMatch(spectator, /BottomBar|PlayerPanel|ReservePicker|DragGhost/);
assert.doesNotMatch(spectator, /onPass|onSelectTile|onPick|handleDraw|handlePass/);
assert.doesNotMatch(spectator, /get_game_view|getGameView|enterOnlineMatch|useOnlineMatch/);
assert.doesNotMatch(spectator, /submit_game_action|forfeitOnlineMatch|forfeit_online_match/);
assert.doesNotMatch(spectator, /myHand|handTilesFromView|legalMoves/);
assert.match(client, /rpc\("admin_get_live_match_view"/);
assert.doesNotMatch(client, /get_game_view/);

assert.match(en, /noAuditEvents: "No admin actions recorded yet."/);
assert.match(en, /onlineUnavailableHint:/);
assert.match(en, /challengeComingSoon: "Coming Soon"/);
const panels = read("pages/AdminV1Panels.jsx");
assert.match(panels, /data-admin-reports="true"/);
assert.match(panels, /data-admin-challenge="true"/);
assert.match(panels, /data-admin-error-code/);
assert.match(panels, /admin\.challengeSaveError/);
assert.match(panels, /loadGen/);
assert.match(en, /challengeSaveError: "Could not save Challenge."/);
assert.match(panels, /data-admin-invite-win="true"/);
assert.match(panels, /data-admin-league="true"/);
assert.match(panels, /data-admin-feedback="true"/);
assert.match(panels, /data-admin-audit="true"/);
assert.match(panels, /data-admin-copy-report="true"/);
assert.match(panels, /admin\.copyAllReports/);
assert.match(en, /copyAllReports: "Copy All Reports"/);
assert.match(en, /reportCopied: "Report copied"/);
assert.doesNotMatch(panels, /forceEndMatch|banUser|suspendAccount|SERVICE_ROLE/);
assert.doesNotMatch(panels, /cpEarningEnabled: true|get_game_view|engine_state/);
const auditSql = readFileSync(join(root, "..", "supabase/migrations/20260828330000_admin_audit_log.sql"), "utf8");
const readersSql = readFileSync(join(root, "..", "supabase/migrations/20260828340000_admin_v1_readers.sql"), "utf8");
const restSql = readFileSync(join(root, "..", "supabase/migrations/20260828350000_admin_reports_challenge.sql"), "utf8");
assert.match(auditSql, /CREATE TABLE public\.admin_audit_log/);
assert.match(readersSql, /admin_get_user/);
assert.match(restSql, /CONSTRAINT challenge_config_cp_off CHECK \(cp_earning_enabled = false\)/);
assert.doesNotMatch(restSql, /GRANT SELECT/);

console.log("  ✓ admin dashboard phase 1 UI contract");
