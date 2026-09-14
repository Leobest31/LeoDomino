import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { resolvePlayerAvatar, DEFAULT_AVATAR_ID } from "../auth/avatars.media.js";
import { IconClose } from "../components/Icon";
import { gameStyleForRulesetId } from "../game/rulesets/registry.js";
import {
  ADMIN_LIVE_POLL_MS,
  ADMIN_PAGE_SIZE,
  ADMIN_PRESENCE_POLL_MS,
  adminErrorI18nKey,
  adminAccountStatus,
  adminAccountStatusI18nKey,
  adminPresenceI18nKey,
  adminPresenceState,
  fetchAdminLiveMatches,
  fetchAdminOverview,
  fetchAdminUsers,
  liveMatchStatusKey,
  overviewCardsFromPayload,
  probeAmIStaff,
} from "../online/adminDashboard.js";
import { ADMIN_V1_NAV, fetchAdminPlayerEmail, fetchAdminUserDetail } from "../online/adminV1.js";
import {
  ADMIN_PLAYER_MESSAGE_MAX,
  fetchAdminPlayerMessages,
  sendAdminPlayerMessage,
  trimAdminPlayerMessage,
  validateAdminPlayerMessage,
} from "../online/adminPlayerMessages.js";
import {
  ADMIN_RANKING_MODES,
  fetchAdminPlayerRankingUniverse,
  paginateRankings,
  rankingPlayerAsUser,
} from "../online/adminPlayerRankings.js";
import AdminSpectatorView from "./AdminSpectatorView.jsx";
import { AdminV1Panels } from "./AdminV1Panels.jsx";
import { AdminLeopipsPanels } from "./AdminLeopipsPanels.jsx";
import { AdminPanelErrorBoundary } from "./AdminBoot.jsx";
import {
  ADMIN_OVERVIEW_DRILL,
  adminElapsedSeconds,
  adminMatchEconomyI18nKey,
  adminMatchEconomyKind,
  adminOccupancyI18nKey,
  adminOccupancyKind,
  adminStakeLabel,
  flattenLiveMatchPlayers,
  looksLikeAdminMatchId,
  referralProgressLabel,
  userPassesAdminDirectoryFilter,
} from "../online/adminLeopipsOps.js";
import {
  adminHistoryStatusKey,
  fetchAdminMatches,
  fetchAdminPlayerLeopips,
} from "../online/adminLeopipsReads.js";
import {
  ADMIN_LEOPIPS_GIFT_REASON_PRESETS,
  computeLeopipsBalanceAfter,
  createAdminLeopipsGiftIdempotencyKey,
  sendAdminLeopipsGift,
  validateLeopipsGiftAmount,
} from "../online/adminLeopipsGift.js";
import { formatCopyReport, toCsvBlob } from "../online/adminPlayerHistoryExport.js";
import {
  ADMIN_MATCH_HISTORY_PAGE_SIZE,
  deriveAdminMatchHistoryLoser,
  fetchAdminPlayerMatchHistory,
} from "../online/adminPlayerMatchHistory.js";
import "./AdminPage.css";

const ADMIN_RANKING_STYLES = Object.freeze(["all", "legacy", "haitian", "american"]);

function rankingStyleLabelKey(style) {
  if (style === "legacy") return "admin.rankingStyleClassic";
  if (style === "haitian") return "admin.rankingStyleHaitian";
  if (style === "american") return "admin.rankingStyleAmerican";
  return "admin.filterAll";
}

const USER_DIRECTORY_FILTERS = Object.freeze([
  "all",
  "newToday",
  "last7",
  "last30",
  "deleted",
  "presence",
]);

function directoryFilterLabelKey(filter) {
  if (filter === "newToday") return "admin.newToday";
  if (filter === "last7") return "admin.last7Days";
  if (filter === "last30") return "admin.last30Days";
  if (filter === "deleted") return "admin.deletedAccounts";
  if (filter === "presence") return "admin.presenceOnlineRecently";
  return "admin.filterAll";
}

function adminAvatarSrc(avatarId) {
  return resolvePlayerAvatar(avatarId).src || resolvePlayerAvatar(DEFAULT_AVATAR_ID).src;
}

function AdminAvatarImage({ avatarId, size = 72, className }) {
  const fallback = resolvePlayerAvatar(DEFAULT_AVATAR_ID).src;
  return (
    <img
      className={className}
      src={adminAvatarSrc(avatarId)}
      alt=""
      width={size}
      height={size}
      draggable={false}
      data-admin-avatar="true"
      onError={(event) => {
        if (event.currentTarget.dataset.fallbackApplied === "true") return;
        event.currentTarget.dataset.fallbackApplied = "true";
        event.currentTarget.src = fallback;
      }}
    />
  );
}

function AdminSummaryRow({ label, children, valueClassName, valueProps }) {
  return (
    <div className="admin-page__summary-row">
      <dt>{label}</dt>
      <dd className={valueClassName} {...valueProps}>
        {children}
      </dd>
    </div>
  );
}

const NAV = ADMIN_V1_NAV;

function errorMessageKey(error) {
  return adminErrorI18nKey(error);
}

function AdminBackBar({ onBack }) {
  const { t } = useI18n();
  return (
    <header className="admin-page__topbar">
      <button
        type="button"
        className="admin-page__back"
        data-admin-back="true"
        onClick={() => onBack?.()}
        aria-label={t("common.back")}
      >
        <span className="admin-page__back-chevron" aria-hidden="true" />
        <span>{t("common.back")}</span>
      </button>
    </header>
  );
}

function AdminPage({ onBack }) {
  const { t, formatNumber, formatDate } = useI18n();
  const [gate, setGate] = useState("checking");
  const [role, setRole] = useState(null);
  const [gateError, setGateError] = useState("");
  const [section, setSection] = useState("overview");
  const [overview, setOverview] = useState(null);
  const [overviewError, setOverviewError] = useState("");
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [userPage, setUserPage] = useState({ users: [], total: 0, limit: ADMIN_PAGE_SIZE, offset: 0 });
  const [usersError, setUsersError] = useState("");
  const [usersLoading, setUsersLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [liveOffset, setLiveOffset] = useState(0);
  const [livePage, setLivePage] = useState({ matches: [], total: 0, limit: ADMIN_PAGE_SIZE, offset: 0 });
  const [liveError, setLiveError] = useState("");
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveSelected, setLiveSelected] = useState(null);
  const [watchingMatchId, setWatchingMatchId] = useState(null);
  const watchingMatchIdRef = useRef(null);
  watchingMatchIdRef.current = watchingMatchId;
  const [userDetail, setUserDetail] = useState(null);
  const [usersFilter, setUsersFilter] = useState("all");
  const [liveView, setLiveView] = useState("matches");
  const [globalSearchInput, setGlobalSearchInput] = useState("");
  const [globalSearchHint, setGlobalSearchHint] = useState("");
  const [playerLeopips, setPlayerLeopips] = useState(null);
  const [playerLeopipsError, setPlayerLeopipsError] = useState("");
  const [playerEmail, setPlayerEmail] = useState(null);
  const [matchHistory, setMatchHistory] = useState({
    matches: [],
    total: 0,
    limit: ADMIN_MATCH_HISTORY_PAGE_SIZE,
    offset: 0,
  });
  const [matchHistoryLoading, setMatchHistoryLoading] = useState(false);
  const [matchHistoryLoadingMore, setMatchHistoryLoadingMore] = useState(false);
  const [matchHistoryError, setMatchHistoryError] = useState("");
  const [historyExportStatus, setHistoryExportStatus] = useState("");
  const [dmComposeOpen, setDmComposeOpen] = useState(false);
  const [dmDraft, setDmDraft] = useState("");
  const [dmBusy, setDmBusy] = useState(false);
  const [dmStatus, setDmStatus] = useState({ kind: "", key: "" });
  const [dmHistory, setDmHistory] = useState([]);
  const [dmHistoryError, setDmHistoryError] = useState("");
  const [quickDmTarget, setQuickDmTarget] = useState(null);
  const [quickDmDraft, setQuickDmDraft] = useState("");
  const [quickDmBusy, setQuickDmBusy] = useState(false);
  const [quickDmStatus, setQuickDmStatus] = useState({ kind: "", key: "" });
  const [livePlayerEmails, setLivePlayerEmails] = useState({ a: null, b: null });
  const [rankingSearchInput, setRankingSearchInput] = useState("");
  const [rankingSearch, setRankingSearch] = useState("");
  const [rankingMode, setRankingMode] = useState("leopips");
  const [rankingOffset, setRankingOffset] = useState(0);
  const [rankingPlayers, setRankingPlayers] = useState([]);
  const [rankingLevelXpAvailable, setRankingLevelXpAvailable] = useState(false);
  const [rankingError, setRankingError] = useState("");
  const [rankingLoading, setRankingLoading] = useState(false);
  const [globalHistorySearchInput, setGlobalHistorySearchInput] = useState("");
  const [globalHistorySearch, setGlobalHistorySearch] = useState("");
  const [globalHistoryStyle, setGlobalHistoryStyle] = useState("all");
  const [globalHistoryStatus, setGlobalHistoryStatus] = useState("");
  const [globalHistoryFinish, setGlobalHistoryFinish] = useState("");
  const [globalHistoryFrom, setGlobalHistoryFrom] = useState("");
  const [globalHistoryTo, setGlobalHistoryTo] = useState("");
  const [globalHistoryOffset, setGlobalHistoryOffset] = useState(0);
  const [globalHistoryPage, setGlobalHistoryPage] = useState({
    matches: [],
    total: 0,
    limit: ADMIN_PAGE_SIZE,
    offset: 0,
  });
  const [globalHistoryError, setGlobalHistoryError] = useState("");
  const [globalHistoryLoading, setGlobalHistoryLoading] = useState(false);
  const [quickGiftTarget, setQuickGiftTarget] = useState(null);
  const [quickGiftBalance, setQuickGiftBalance] = useState(null);
  const [quickGiftBalanceError, setQuickGiftBalanceError] = useState("");
  const [quickGiftAmount, setQuickGiftAmount] = useState("");
  const [quickGiftReason, setQuickGiftReason] = useState("");
  const [quickGiftBusy, setQuickGiftBusy] = useState(false);
  const [quickGiftStatus, setQuickGiftStatus] = useState({ kind: "", key: "" });
  const [quickGiftResult, setQuickGiftResult] = useState(null);
  const quickGiftIdempotencyKeyRef = useRef(null);
  const quickGiftRequestIdRef = useRef(0);

  const checkAccess = useCallback(async () => {
    setGate("checking");
    setGateError("");
    try {
      const probe = await probeAmIStaff();
      if (!probe.isStaff) {
        setRole(null);
        setGate("denied");
        return;
      }
      setRole(probe.role);
      setGate("ok");
    } catch (error) {
      setRole(null);
      setGate("error");
      setGateError(errorMessageKey(error));
    }
  }, []);

  useEffect(() => {
    void checkAccess();
  }, [checkAccess]);

  const loadOverview = useCallback(async (silent = false) => {
    if (!silent) {
      setOverviewLoading(true);
      setOverviewError("");
    }
    try {
      setOverview(await fetchAdminOverview());
      if (silent) setOverviewError("");
    } catch (error) {
      if (!silent) {
        setOverview(null);
        setOverviewError(errorMessageKey(error));
      }
    } finally {
      if (!silent) setOverviewLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async (query, silent = false) => {
    if (!silent) {
      setUsersLoading(true);
      setUsersError("");
    }
    try {
      const page = await fetchAdminUsers(query);
      setUserPage(page);
      if (silent) setUsersError("");
    } catch (error) {
      if (!silent) {
        setUserPage({ users: [], total: 0, limit: ADMIN_PAGE_SIZE, offset: query.offset || 0 });
        setUsersError(errorMessageKey(error));
      }
    } finally {
      if (!silent) setUsersLoading(false);
    }
  }, []);

  const loadLiveMatches = useCallback(async (query, silent = false) => {
    if (!silent) setLiveLoading(true);
    setLiveError("");
    try {
      const page = await fetchAdminLiveMatches(query);
      setLivePage(page);
      setLiveSelected((current) => {
        if (!current) return null;
        const next = page.matches.find((match) => match.matchId === current.matchId);
        if (next) return next;
        if (watchingMatchIdRef.current && watchingMatchIdRef.current === current.matchId) {
          return current;
        }
        return null;
      });
    } catch (error) {
      if (!silent) {
        setLivePage({ matches: [], total: 0, limit: ADMIN_PAGE_SIZE, offset: query.offset || 0 });
      }
      setLiveError(errorMessageKey(error));
    } finally {
      if (!silent) setLiveLoading(false);
    }
  }, []);

  const loadRankings = useCallback(async (query, silent = false) => {
    if (!silent) {
      setRankingLoading(true);
      setRankingError("");
    }
    try {
      const universe = await fetchAdminPlayerRankingUniverse(query);
      setRankingPlayers(Array.isArray(universe?.players) ? universe.players : []);
      setRankingLevelXpAvailable(universe?.levelXpAvailable === true);
      if (silent) setRankingError("");
    } catch (error) {
      if (!silent) {
        setRankingPlayers([]);
        setRankingLevelXpAvailable(false);
        setRankingError(errorMessageKey(error));
      }
    } finally {
      if (!silent) setRankingLoading(false);
    }
  }, []);


  useEffect(() => {
    if (gate !== "ok" || section !== "overview") return undefined;
    void loadOverview();
    const handle = window.setInterval(() => {
      void loadOverview(true);
    }, ADMIN_PRESENCE_POLL_MS);
    return () => window.clearInterval(handle);
  }, [gate, section, loadOverview]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setOffset(0);
  }, [search]);

  useEffect(() => {
    if (gate !== "ok" || section !== "users") return undefined;
    void loadUsers({ search, offset, limit: ADMIN_PAGE_SIZE });
    const handle = window.setInterval(() => {
      void loadUsers({ search, offset, limit: ADMIN_PAGE_SIZE }, true);
    }, ADMIN_PRESENCE_POLL_MS);
    return () => window.clearInterval(handle);
  }, [gate, section, search, offset, loadUsers]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setRankingSearch(rankingSearchInput.trim());
    }, 300);
    return () => window.clearTimeout(handle);
  }, [rankingSearchInput]);

  useEffect(() => {
    setRankingOffset(0);
  }, [rankingSearch, rankingMode]);

  useEffect(() => {
    if (gate !== "ok" || section !== "playerRankings") return undefined;
    const query = {
      search: rankingSearch,
    };
    void loadRankings(query);
    const poll = window.setInterval(() => {
      void loadRankings(query, true);
    }, ADMIN_PRESENCE_POLL_MS);
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void loadRankings(query, true);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [gate, section, rankingSearch, loadRankings]);

  useEffect(() => {
    if (gate !== "ok" || !selected?.playerId) {
      setUserDetail(null);
      return undefined;
    }
    let cancelled = false;
    const load = () => {
      void fetchAdminUserDetail(selected.playerId)
        .then((detail) => {
          if (!cancelled) setUserDetail(detail);
        })
        .catch(() => {
          /* keep last successful detail */
        });
    };
    load();
    const handle = window.setInterval(load, ADMIN_PRESENCE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [gate, selected?.playerId]);

  useEffect(() => {
    if (gate !== "ok" || !selected?.playerId) {
      setPlayerEmail(null);
      return undefined;
    }
    let cancelled = false;
    void fetchAdminPlayerEmail(selected.playerId)
      .then((row) => {
        if (!cancelled) setPlayerEmail(row.email);
      })
      .catch(() => {
        if (!cancelled) setPlayerEmail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [gate, selected?.playerId]);

  useEffect(() => {
    if (gate !== "ok" || !selected?.playerId) {
      setMatchHistory({
        matches: [],
        total: 0,
        limit: ADMIN_MATCH_HISTORY_PAGE_SIZE,
        offset: 0,
      });
      setMatchHistoryError("");
      setMatchHistoryLoading(false);
      setMatchHistoryLoadingMore(false);
      return undefined;
    }
    let cancelled = false;
    setMatchHistoryLoading(true);
    setMatchHistoryError("");
    setMatchHistory({
      matches: [],
      total: 0,
      limit: ADMIN_MATCH_HISTORY_PAGE_SIZE,
      offset: 0,
    });
    void fetchAdminPlayerMatchHistory(selected.playerId, {
      limit: ADMIN_MATCH_HISTORY_PAGE_SIZE,
      offset: 0,
    })
      .then((page) => {
        if (!cancelled) setMatchHistory(page);
      })
      .catch((error) => {
        if (!cancelled) {
          setMatchHistory({
            matches: [],
            total: 0,
            limit: ADMIN_MATCH_HISTORY_PAGE_SIZE,
            offset: 0,
          });
          setMatchHistoryError(adminErrorI18nKey(error, "admin.matchHistoryUnavailable"));
        }
      })
      .finally(() => {
        if (!cancelled) setMatchHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gate, selected?.playerId]);

  const loadMoreMatchHistory = useCallback(async () => {
    if (!selected?.playerId || matchHistoryLoading || matchHistoryLoadingMore) return;
    const nextOffset = matchHistory.matches.length;
    if (nextOffset >= (matchHistory.total || 0)) return;
    setMatchHistoryLoadingMore(true);
    setMatchHistoryError("");
    try {
      const page = await fetchAdminPlayerMatchHistory(selected.playerId, {
        limit: ADMIN_MATCH_HISTORY_PAGE_SIZE,
        offset: nextOffset,
      });
      setMatchHistory((prev) => ({
        ...page,
        matches: [...prev.matches, ...page.matches],
      }));
    } catch (error) {
      setMatchHistoryError(adminErrorI18nKey(error, "admin.matchHistoryUnavailable"));
    } finally {
      setMatchHistoryLoadingMore(false);
    }
  }, [
    selected?.playerId,
    matchHistory.matches.length,
    matchHistory.total,
    matchHistoryLoading,
    matchHistoryLoadingMore,
  ]);

  useEffect(() => {
    if (gate !== "ok" || !selected?.playerId) {
      setDmComposeOpen(false);
      setDmDraft("");
      setDmBusy(false);
      setDmStatus({ kind: "", key: "" });
      setDmHistory([]);
      setDmHistoryError("");
      return undefined;
    }
    let cancelled = false;
    setDmHistoryError("");
    void fetchAdminPlayerMessages(selected.playerId, 20)
      .then((page) => {
        if (!cancelled) setDmHistory(page.items || []);
      })
      .catch(() => {
        if (!cancelled) {
          setDmHistory([]);
          setDmHistoryError("admin.messageHistoryUnavailable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [gate, selected?.playerId]);

  const sendSelectedPlayerMessage = useCallback(async () => {
    if (!selected?.playerId || dmBusy) return;
    const body = trimAdminPlayerMessage(dmDraft);
    const invalid = validateAdminPlayerMessage(body);
    if (invalid === "EMPTY") {
      setDmStatus({ kind: "error", key: "admin.messageEmpty" });
      return;
    }
    if (invalid === "TOO_LONG") {
      setDmStatus({ kind: "error", key: "admin.messageTooLong" });
      return;
    }
    setDmBusy(true);
    setDmStatus({ kind: "", key: "" });
    try {
      const sent = await sendAdminPlayerMessage(selected.playerId, body);
      setDmDraft("");
      setDmStatus({ kind: "ok", key: "admin.messageSent" });
      setDmHistory((prev) => [sent, ...prev.filter((row) => row.id !== sent.id)].slice(0, 20));
    } catch (error) {
      setDmStatus({ kind: "error", key: adminErrorI18nKey(error, "admin.messageSendFailed") });
    } finally {
      setDmBusy(false);
    }
  }, [selected?.playerId, dmBusy, dmDraft]);

  const closeQuickPlayerMessage = useCallback(() => {
    setQuickDmTarget(null);
    setQuickDmDraft("");
    setQuickDmBusy(false);
    setQuickDmStatus({ kind: "", key: "" });
  }, []);

  const openQuickPlayerMessage = useCallback((player) => {
    if (!player?.playerId) return;
    setQuickDmTarget({
      playerId: player.playerId,
      displayName: player.displayName || "",
      username: player.username || "",
      avatarId: player.avatarId || DEFAULT_AVATAR_ID,
    });
    setQuickDmDraft("");
    setQuickDmBusy(false);
    setQuickDmStatus({ kind: "", key: "" });
  }, []);

  /** Live-match detail shortcut — same composer / sendAdminPlayerMessage path. */
  const openLivePlayerMessage = openQuickPlayerMessage;

  const sendQuickPlayerMessage = useCallback(async () => {
    if (!quickDmTarget?.playerId || quickDmBusy) return;
    const body = trimAdminPlayerMessage(quickDmDraft);
    const invalid = validateAdminPlayerMessage(body);
    if (invalid === "EMPTY") {
      setQuickDmStatus({ kind: "error", key: "admin.messageEmpty" });
      return;
    }
    if (invalid === "TOO_LONG") {
      setQuickDmStatus({ kind: "error", key: "admin.messageTooLong" });
      return;
    }
    setQuickDmBusy(true);
    setQuickDmStatus({ kind: "", key: "" });
    try {
      await sendAdminPlayerMessage(quickDmTarget.playerId, body);
      setQuickDmDraft("");
      setQuickDmStatus({ kind: "ok", key: "admin.messageSent" });
    } catch (error) {
      setQuickDmStatus({ kind: "error", key: adminErrorI18nKey(error, "admin.messageSendFailed") });
    } finally {
      setQuickDmBusy(false);
    }
  }, [quickDmTarget?.playerId, quickDmBusy, quickDmDraft]);

  const closeQuickLeopipsGift = useCallback(() => {
    setQuickGiftTarget(null);
    setQuickGiftBalance(null);
    setQuickGiftBalanceError("");
    setQuickGiftAmount("");
    setQuickGiftReason("");
    setQuickGiftBusy(false);
    setQuickGiftStatus({ kind: "", key: "" });
    setQuickGiftResult(null);
  }, []);

  /** Opens independently of the (unrelated, possibly-unavailable) detail drawer. */
  const openQuickLeopipsGift = useCallback((player) => {
    if (!player?.playerId) return;
    quickGiftIdempotencyKeyRef.current = createAdminLeopipsGiftIdempotencyKey();
    const requestId = quickGiftRequestIdRef.current + 1;
    quickGiftRequestIdRef.current = requestId;
    setQuickGiftTarget({
      playerId: player.playerId,
      displayName: player.displayName || "",
      username: player.username || "",
      avatarId: player.avatarId || DEFAULT_AVATAR_ID,
    });
    setQuickGiftBalance(
      Number.isFinite(Number(player.leopipsBalance)) ? Number(player.leopipsBalance) : null
    );
    setQuickGiftBalanceError("");
    setQuickGiftAmount("");
    setQuickGiftReason("");
    setQuickGiftBusy(false);
    setQuickGiftStatus({ kind: "", key: "" });
    setQuickGiftResult(null);
    // Refresh with the authoritative balance; ignore if a newer open superseded this.
    void fetchAdminPlayerLeopips(player.playerId)
      .then((row) => {
        if (quickGiftRequestIdRef.current !== requestId) return;
        if (row?.balance != null) setQuickGiftBalance(row.balance);
      })
      .catch((error) => {
        if (quickGiftRequestIdRef.current !== requestId) return;
        setQuickGiftBalanceError(adminErrorI18nKey(error, "admin.playerLeopipsUnavailable"));
      });
  }, []);

  const quickGiftAmountCheck = validateLeopipsGiftAmount(quickGiftAmount);
  const quickGiftPreviewAfter =
    quickGiftBalance != null && !quickGiftAmountCheck
      ? computeLeopipsBalanceAfter(quickGiftBalance, Number(quickGiftAmount))
      : null;

  const sendQuickLeopipsGift = useCallback(async () => {
    if (!quickGiftTarget?.playerId || quickGiftBusy) return;
    if (quickGiftAmountCheck) {
      setQuickGiftStatus({ kind: "error", key: "admin.giftAmountRequired" });
      return;
    }
    const note = quickGiftReason.trim();
    if (!note) {
      setQuickGiftStatus({ kind: "error", key: "admin.giftReasonRequired" });
      return;
    }
    if (!quickGiftIdempotencyKeyRef.current) {
      quickGiftIdempotencyKeyRef.current = createAdminLeopipsGiftIdempotencyKey();
    }
    setQuickGiftBusy(true);
    setQuickGiftStatus({ kind: "", key: "" });
    try {
      const result = await sendAdminLeopipsGift({
        playerId: quickGiftTarget.playerId,
        amount: Number(quickGiftAmount),
        reason: note,
        idempotencyKey: quickGiftIdempotencyKeyRef.current,
      });
      setQuickGiftResult(result);
      setQuickGiftStatus({ kind: "ok", key: "admin.giftSent" });
      setQuickGiftBalance(result.balanceAfter);
      // Next confirm click (a genuinely new gift) gets a fresh key; this one
      // stays fixed so a retry of THIS submission cannot double-credit.
      quickGiftIdempotencyKeyRef.current = null;
      const giftedPlayerId = quickGiftTarget.playerId;
      setRankingPlayers((prev) =>
        prev.map((row) =>
          row.playerId === giftedPlayerId ? { ...row, leopipsBalance: result.balanceAfter } : row
        )
      );
      setPlayerLeopips((prev) =>
        prev && selected?.playerId === giftedPlayerId ? { ...prev, balance: result.balanceAfter } : prev
      );
    } catch (error) {
      setQuickGiftStatus({ kind: "error", key: adminErrorI18nKey(error, "admin.giftSendFailed") });
    } finally {
      setQuickGiftBusy(false);
    }
  }, [quickGiftTarget?.playerId, quickGiftBusy, quickGiftAmount, quickGiftAmountCheck, quickGiftReason, selected?.playerId]);

  useEffect(() => {
    if (gate !== "ok" || !liveSelected?.playerA?.playerId || !liveSelected?.playerB?.playerId) {
      setLivePlayerEmails({ a: null, b: null });
      return undefined;
    }
    let cancelled = false;
    setLivePlayerEmails({ a: null, b: null });
    Promise.all([
      fetchAdminPlayerEmail(liveSelected.playerA.playerId).catch(() => null),
      fetchAdminPlayerEmail(liveSelected.playerB.playerId).catch(() => null),
    ]).then(([emailA, emailB]) => {
      if (cancelled) return;
      setLivePlayerEmails({
        a: emailA?.email || null,
        b: emailB?.email || null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [gate, liveSelected?.matchId, liveSelected?.playerA?.playerId, liveSelected?.playerB?.playerId]);

  useEffect(() => {
    if (gate !== "ok" || !selected?.playerId) {
      setPlayerLeopips(null);
      setPlayerLeopipsError("");
      return undefined;
    }
    let cancelled = false;
    setPlayerLeopipsError("");
    void fetchAdminPlayerLeopips(selected.playerId)
      .then((detail) => {
        if (!cancelled) setPlayerLeopips(detail);
      })
      .catch((error) => {
        if (!cancelled) {
          setPlayerLeopips(null);
          setPlayerLeopipsError(adminErrorI18nKey(error, "admin.playerLeopipsUnavailable"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [gate, selected?.playerId]);

  useEffect(() => {
    if (gate !== "ok" || section !== "liveMatches") return undefined;
    void loadLiveMatches({ offset: liveOffset, limit: ADMIN_PAGE_SIZE });
    const handle = window.setInterval(() => {
      void loadLiveMatches({ offset: liveOffset, limit: ADMIN_PAGE_SIZE }, true);
    }, ADMIN_LIVE_POLL_MS);
    return () => window.clearInterval(handle);
  }, [gate, section, liveOffset, loadLiveMatches]);

  const loadGlobalMatchHistory = useCallback(async (query, silent = false) => {
    if (!silent) {
      setGlobalHistoryLoading(true);
      setGlobalHistoryError("");
    }
    try {
      const page = await fetchAdminMatches({
        search: query.search || null,
        rulesetId: query.rulesetId || null,
        status: query.status || null,
        finishReason: query.finishReason || null,
        from: query.from || null,
        to: query.to || null,
        limit: query.limit ?? ADMIN_PAGE_SIZE,
        offset: query.offset ?? 0,
      });
      setGlobalHistoryPage(page);
      if (silent) setGlobalHistoryError("");
    } catch (error) {
      if (!silent) {
        setGlobalHistoryPage({
          matches: [],
          total: 0,
          limit: ADMIN_PAGE_SIZE,
          offset: query.offset || 0,
        });
        setGlobalHistoryError(adminErrorI18nKey(error, "admin.matchHistoryUnavailable"));
      }
    } finally {
      if (!silent) setGlobalHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setGlobalHistorySearch(globalHistorySearchInput.trim());
    }, 300);
    return () => window.clearTimeout(handle);
  }, [globalHistorySearchInput]);

  useEffect(() => {
    setGlobalHistoryOffset(0);
  }, [
    globalHistorySearch,
    globalHistoryStyle,
    globalHistoryStatus,
    globalHistoryFinish,
    globalHistoryFrom,
    globalHistoryTo,
  ]);

  useEffect(() => {
    if (gate !== "ok" || section !== "matchHistory") return undefined;
    const rulesetId = globalHistoryStyle === "all" ? null : globalHistoryStyle;
    void loadGlobalMatchHistory({
      search: globalHistorySearch,
      rulesetId,
      status: globalHistoryStatus || null,
      finishReason: globalHistoryFinish || null,
      from: globalHistoryFrom ? new Date(`${globalHistoryFrom}T00:00:00.000Z`).toISOString() : null,
      to: globalHistoryTo ? new Date(`${globalHistoryTo}T23:59:59.999Z`).toISOString() : null,
      limit: ADMIN_PAGE_SIZE,
      offset: globalHistoryOffset,
    });
    return undefined;
  }, [
    gate,
    section,
    globalHistorySearch,
    globalHistoryStyle,
    globalHistoryStatus,
    globalHistoryFinish,
    globalHistoryFrom,
    globalHistoryTo,
    globalHistoryOffset,
    loadGlobalMatchHistory,
  ]);

  const cards = useMemo(() => overviewCardsFromPayload(overview), [overview]);
  const visibleUsers = useMemo(
    () =>
      userPage.users.filter((user) => {
        if (!userPassesAdminDirectoryFilter(user, usersFilter)) return false;
        if (usersFilter === "presence") {
          const presence = adminPresenceState(user);
          return presence === "online" || presence === "in_match";
        }
        return true;
      }),
    [userPage.users, usersFilter]
  );
  const livePlayers = useMemo(() => flattenLiveMatchPlayers(livePage.matches), [livePage.matches]);
  const selectedLiveRow = useMemo(() => {
    if (!selected?.playerId) return null;
    return livePlayers.find((row) => row.playerId === selected.playerId) || null;
  }, [selected?.playerId, livePlayers]);
  const pageCount = Math.max(1, Math.ceil((userPage.total || 0) / (userPage.limit || ADMIN_PAGE_SIZE)));
  const pageNumber = Math.floor((userPage.offset || 0) / (userPage.limit || ADMIN_PAGE_SIZE)) + 1;
  const canPrev = (userPage.offset || 0) > 0;
  const selectedAccount = selected ? adminAccountStatus(selected) : "active";
  const selectedPresence = selected
    ? adminPresenceState({
        deletedAt: selected.deletedAt,
        inActiveMatch: userDetail?.player?.inActiveMatch ?? selected.inActiveMatch,
        matchLastSeenAt: userDetail?.player?.matchLastSeenAt ?? selected.matchLastSeenAt,
        presenceLastSeenAt: userDetail?.player?.presenceLastSeenAt ?? selected.presenceLastSeenAt,
      })
    : "offline";
  const canNext = (userPage.offset || 0) + userPage.users.length < (userPage.total || 0);
  const livePageCount = Math.max(1, Math.ceil((livePage.total || 0) / (livePage.limit || ADMIN_PAGE_SIZE)));
  const livePageNumber = Math.floor((livePage.offset || 0) / (livePage.limit || ADMIN_PAGE_SIZE)) + 1;
  const liveCanPrev = (livePage.offset || 0) > 0;
  const liveCanNext = (livePage.offset || 0) + livePage.matches.length < (livePage.total || 0);
  const rankingPage = useMemo(
    () =>
      paginateRankings(rankingPlayers, {
        mode: rankingMode,
        limit: ADMIN_PAGE_SIZE,
        offset: rankingOffset,
      }),
    [rankingPlayers, rankingMode, rankingOffset]
  );
  const rankingPageCount = Math.max(
    1,
    Math.ceil((rankingPage.total || 0) / (rankingPage.limit || ADMIN_PAGE_SIZE))
  );
  const rankingPageNumber =
    Math.floor((rankingPage.offset || 0) / (rankingPage.limit || ADMIN_PAGE_SIZE)) + 1;
  const rankingCanPrev = (rankingPage.offset || 0) > 0;
  const rankingCanNext =
    (rankingPage.offset || 0) + rankingPage.players.length < (rankingPage.total || 0);
  const formatWhen = (value) => {
    if (!value) return "—";
    const label = formatDate(value, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    return label || "—";
  };

  const playerLabel = (player) => player?.displayName || player?.username || "—";

  const styleLabel = (rulesetId) => {
    const style = gameStyleForRulesetId(rulesetId);
    return t(style?.nameKey || "setup.gameStyle.classic");
  };

  const matchFinishLabel = (reason) => {
    if (reason === "completed") return t("admin.finishCompleted");
    if (reason === "timeout") return t("admin.finishTimeout");
    if (reason === "forfeit") return t("admin.finishForfeit");
    if (reason === "aborted") return t("admin.finishAborted");
    if (reason === "other") return t("admin.finishOther");
    return reason || "—";
  };

  const formatDuration = (seconds) => {
    if (seconds == null || !Number.isFinite(seconds)) return "—";
    const total = Math.max(0, Math.trunc(seconds));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    if (mins <= 0) return t("admin.durationSecondsOnly", { seconds: formatNumber(secs) });
    return t("admin.durationMinutesSeconds", {
      minutes: formatNumber(mins),
      seconds: formatNumber(secs),
    });
  };

  const matchKindLabel = (kind) => {
    if (kind === "friend") return t("admin.matchKindFriend");
    if (kind === "private") return t("admin.matchKindPrivate");
    if (kind === "public") return t("admin.matchKindPublic");
    return kind || "—";
  };

  const matchResultLabel = (result) => {
    if (result === "win") return t("admin.resultWin");
    if (result === "loss") return t("admin.resultLoss");
    return t("admin.resultUnknown");
  };

  const matchHistoryScoreLabel = (score) => {
    if (!score) return "—";
    if (score.selected != null && score.opponent != null) {
      return `${formatNumber(score.selected)}–${formatNumber(score.opponent)}`;
    }
    if (score.a != null && score.b != null) {
      return `${formatNumber(score.a)}–${formatNumber(score.b)}`;
    }
    return "—";
  };

  const stakeDisplay = (value) => adminStakeLabel(value) ?? t("admin.noStake");

  const occupancyLabel = (match) => t(adminOccupancyI18nKey(adminOccupancyKind(match)));

  const economyLabel = (match) => t(adminMatchEconomyI18nKey(adminMatchEconomyKind(match)));

  const elapsedLabel = (startedAt) => {
    const seconds = adminElapsedSeconds(startedAt);
    if (!seconds) return "—";
    const minutes = Math.floor(seconds / 60);
    const remain = seconds % 60;
    return `${minutes}:${String(remain).padStart(2, "0")}`;
  };

  const occupancyClass = (kind) => {
    if (kind === "real") return "is-occupancy-real";
    if (kind === "stale") return "is-occupancy-stale";
    return "is-occupancy-unknown";
  };

  const handleGlobalSearch = async () => {
    const query = globalSearchInput.trim();
    if (!query) return;
    setGlobalSearchHint("");
    if (looksLikeAdminMatchId(query)) {
      const fromPage = livePage.matches.find((match) => match.matchId === query);
      if (fromPage) {
        setSection("liveMatches");
        setLiveView("matches");
        setLiveSelected(fromPage);
        return;
      }
      try {
        const page = await fetchAdminLiveMatches({ offset: 0, limit: ADMIN_PAGE_SIZE });
        setLivePage(page);
        const found = page.matches.find((match) => match.matchId === query);
        if (found) {
          setSection("liveMatches");
          setLiveView("matches");
          setLiveSelected(found);
          return;
        }
      } catch {
        /* try history */
      }
      try {
        const history = await fetchAdminMatches({ search: query, limit: 1, offset: 0 });
        if (history.matches[0]) {
          setSection("matchHistory");
          setGlobalSearchHint("");
          return;
        }
      } catch (error) {
        setSection("matchHistory");
        setGlobalSearchHint(adminErrorI18nKey(error, "admin.matchHistoryUnavailable"));
        return;
      }
      setSection("matchHistory");
      setGlobalSearchHint("");
      return;
    }
    setSearchInput(query);
    setUsersFilter("all");
    setSection("users");
  };


  const scoreLabel = (match) => {
    if (match?.scoreA == null || match?.scoreB == null) return "—";
    return `${formatNumber(match.scoreA)}–${formatNumber(match.scoreB)}`;
  };

  const statusClass = (status) => {
    if (status === "live") return "is-live";
    if (status === "disconnected") return "is-deleted";
    if (status === "waiting") return "is-ok";
    return "";
  };

  const presencePillClass = (presence) => {
    if (presence === "online") return "is-presence-online";
    if (presence === "in_match") return "is-presence-in-match";
    return "is-presence-offline";
  };

  const globalHistoryPageCount = Math.max(
    1,
    Math.ceil((globalHistoryPage.total || 0) / (globalHistoryPage.limit || ADMIN_PAGE_SIZE))
  );
  const globalHistoryPageNumber =
    Math.floor((globalHistoryPage.offset || 0) / (globalHistoryPage.limit || ADMIN_PAGE_SIZE)) + 1;
  const globalHistoryCanPrev = (globalHistoryPage.offset || 0) > 0;
  const globalHistoryCanNext =
    (globalHistoryPage.offset || 0) + globalHistoryPage.matches.length <
    (globalHistoryPage.total || 0);

  const resolvedLeopipsBalance =
    playerLeopips?.balance != null
      ? playerLeopips.balance
      : selected?.leopipsBalance != null
        ? selected.leopipsBalance
        : null;

  const matchHistoryCanLoadMore =
    matchHistory.matches.length < (matchHistory.total || 0) && !matchHistoryLoading;

  const copyPlayerHistoryReport = useCallback(async () => {
    if (!selected) return;
    const text = formatCopyReport({
      player: selected,
      leopipsBalance: resolvedLeopipsBalance,
      levelXpStatus: "Unavailable",
      matches: matchHistory.matches,
    });
    try {
      await navigator.clipboard.writeText(text);
      setHistoryExportStatus("admin.reportCopied");
    } catch {
      setHistoryExportStatus("admin.copyHistoryFailed");
    }
  }, [selected, resolvedLeopipsBalance, matchHistory.matches]);

  const downloadPlayerHistoryCsv = useCallback(() => {
    if (!selected) return;
    const blob = toCsvBlob({
      player: selected,
      leopipsBalance: resolvedLeopipsBalance,
      levelXpStatus: "Unavailable",
      matches: matchHistory.matches,
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName = String(selected.username || selected.playerId || "player").replace(
      /[^\w.-]+/g,
      "_"
    );
    link.href = url;
    link.download = `admin-match-history-${safeName}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setHistoryExportStatus("admin.csvDownloaded");
  }, [selected, resolvedLeopipsBalance, matchHistory.matches]);

  return (
    <main className="admin-page" data-admin="true" aria-label={t("admin.aria")}>
      <AdminBackBar onBack={onBack} />

      {gate === "checking" ? (
        <div className="admin-page__gate" data-admin-gate="checking">
          <p>{t("admin.checkingAccess")}</p>
        </div>
      ) : null}

      {gate === "denied" ? (
        <div className="admin-page__gate" data-admin-gate="denied">
          <h1>{t("admin.accessDenied")}</h1>
          <p>{t("admin.accessDeniedBody")}</p>
        </div>
      ) : null}

      {gate === "error" ? (
        <div className="admin-page__gate" data-admin-gate="error">
          <h1>{t("admin.title")}</h1>
          <p>{t(gateError || "admin.unavailable")}</p>
          <div className="admin-page__gate-actions">
            <button type="button" className="admin-page__btn" onClick={() => void checkAccess()}>
              {t("admin.retry")}
            </button>
          </div>
        </div>
      ) : null}

      {gate === "ok" ? (
        <div className="admin-page__shell" data-admin-gate="ok">
          <aside className="admin-page__sidebar">
            <div className="admin-page__brand">
              <p className="admin-page__kicker">{t("common.brand")}</p>
              <h1>{t("admin.title")}</h1>
              {role ? <p className="admin-page__role">{t("admin.staffRole", { role })}</p> : null}
            </div>
            <nav className="admin-page__nav" aria-label={t("admin.navAria")}>
              {NAV.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`admin-page__nav-btn${section === id ? " is-active" : ""}`}
                  data-admin-nav-item={id}
                  aria-current={section === id ? "page" : undefined}
                  onClick={() => {
                    setSection(id);
                    setSelected(null);
                    setLiveSelected(null);
                    setWatchingMatchId(null);
                    if (id === "users") setUsersFilter("all");
                    if (id === "liveMatches") setLiveView("matches");
                  }}
                >
                  {t(`admin.${id}`)}
                </button>
              ))}
            </nav>
          </aside>

          <section className="admin-page__main" data-admin-section={section}>
            <AdminPanelErrorBoundary resetKey={section}>
            <form
              className="admin-page__search admin-page__search--global"
              data-admin-global-search="true"
              onSubmit={(event) => {
                event.preventDefault();
                void handleGlobalSearch();
              }}
            >
              <label>
                <span className="sr-only">{t("admin.globalSearch")}</span>
                <input
                  type="search"
                  value={globalSearchInput}
                  placeholder={t("admin.globalSearch")}
                  onChange={(event) => setGlobalSearchInput(event.target.value)}
                />
              </label>
              <button type="submit" className="admin-page__btn admin-page__btn--ghost">
                {t("admin.search")}
              </button>
            </form>
            {section === "overview" ? (
              <div data-admin-overview="true">
                <header className="admin-page__header">
                  <h2>{t("admin.overview")}</h2>
                  <button
                    type="button"
                    className="admin-page__btn admin-page__btn--ghost"
                    disabled={overviewLoading}
                    onClick={() => void loadOverview()}
                  >
                    {t("admin.retry")}
                  </button>
                </header>
                {overviewError ? (
                  <p className="admin-page__error" role="alert">
                    {t(overviewError)}
                  </p>
                ) : null}
                {overviewLoading ? <p className="admin-page__hint">{t("admin.loading")}</p> : null}
                {!overviewError && !overviewLoading && cards.length === 0 ? (
                  <p className="admin-page__empty">{t("admin.unavailable")}</p>
                ) : null}
                <div className="admin-page__cards">
                  {cards.map((card) => {
                    const unavailable = Boolean(card.unsupported || card.value == null);
                    const drill = ADMIN_OVERVIEW_DRILL[card.id];
                    return (
                      <button
                        type="button"
                        key={card.id}
                        className={`admin-page__card${unavailable ? " is-unavailable" : ""}${drill ? " is-clickable" : ""}`}
                        data-admin-card={card.id}
                        data-admin-card-open={drill ? `${drill.section}:${drill.usersFilter || drill.liveView || "open"}` : undefined}
                        data-admin-card-unavailable={unavailable ? "true" : "false"}
                        disabled={!drill}
                        onClick={() => {
                          if (!drill) return;
                          setSection(drill.section);
                          setSelected(null);
                          setLiveSelected(null);
                          if (drill.usersFilter) setUsersFilter(drill.usersFilter);
                          if (drill.liveView) setLiveView(drill.liveView);
                        }}
                      >
                        <p className="admin-page__card-label">{t(`admin.${card.id}`)}</p>
                        <p className={`admin-page__card-value${unavailable ? " is-unavailable" : ""}`}>
                          {unavailable ? t("admin.metricUnavailable") : formatNumber(card.value)}
                        </p>
                        {card.id === "globalOnlineUsers" ? (
                          <p className="admin-page__card-hint">
                            {unavailable ? t("admin.onlineUnavailableHint") : t("admin.onlineCountHint")}
                          </p>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {section === "users" ? (
              <div data-admin-users="true">
                <header className="admin-page__header">
                  <h2>{t("admin.users")}</h2>
                </header>
                <p className="admin-page__hint">{t("admin.presenceHint")}</p>
                <div className="admin-page__filters" data-admin-users-filter="true">
                  {USER_DIRECTORY_FILTERS.map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      className={`admin-page__filter${usersFilter === filter ? " is-active" : ""}`}
                      data-admin-users-filter-item={filter}
                      onClick={() => setUsersFilter(filter)}
                    >
                      {t(directoryFilterLabelKey(filter))}
                    </button>
                  ))}
                </div>
                {usersFilter !== "all" ? (
                  <p className="admin-page__hint" data-admin-directory-page-hint="true">
                    {t("admin.directoryPageHint")}
                  </p>
                ) : null}
                <label className="admin-page__search">
                  <span className="sr-only">{t("admin.searchUsers")}</span>
                  <input
                    type="search"
                    value={searchInput}
                    data-admin-search="true"
                    placeholder={t("admin.searchUsers")}
                    onChange={(event) => setSearchInput(event.target.value)}
                  />
                </label>
                {usersError ? (
                  <p className="admin-page__error" role="alert">
                    {t(usersError)}
                  </p>
                ) : null}
                {usersLoading ? <p className="admin-page__hint">{t("admin.loading")}</p> : null}
                <div className="admin-page__table-wrap">
                  <table className="admin-page__table">
                    <thead>
                      <tr>
                        <th>{t("admin.username")}</th>
                        <th>{t("admin.displayName")}</th>
                        <th>{t("admin.country")}</th>
                        <th>{t("admin.created")}</th>
                        <th>{t("admin.accountStatus")}</th>
                        <th>{t("admin.presence")}</th>
                        <th>{t("admin.messageAction")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleUsers.map((user) => {
                        const account = adminAccountStatus(user);
                        const presence = adminPresenceState(user);
                        return (
                        <tr
                          key={user.playerId}
                          data-admin-user={user.playerId}
                          onClick={() => setSelected(user)}
                        >
                          <td>{user.username || "—"}</td>
                          <td>{user.displayName || "—"}</td>
                          <td>{user.countryCode || "—"}</td>
                          <td>{formatWhen(user.createdAt)}</td>
                          <td>
                            <span
                              className={`admin-page__pill${account === "deleted" ? " is-deleted" : " is-ok"}`}
                              data-admin-account={account}
                            >
                              {t(adminAccountStatusI18nKey(account))}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`admin-page__pill ${presencePillClass(presence)}`}
                              data-admin-presence={presence}
                            >
                              {t(adminPresenceI18nKey(presence))}
                            </span>
                          </td>
                          <td className="admin-page__row-actions">
                            <button
                              type="button"
                              className="admin-page__btn admin-page__btn--ghost admin-page__btn--compact"
                              data-admin-quick-message={user.playerId}
                              onClick={(event) => {
                                event.stopPropagation();
                                openQuickPlayerMessage(user);
                              }}
                            >
                              {t("admin.messageAction")}
                            </button>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!usersLoading && !usersError && userPage.users.length === 0 ? (
                  <p className="admin-page__empty">{t("admin.noUsers")}</p>
                ) : null}
                {!usersLoading && !usersError && userPage.users.length > 0 && visibleUsers.length === 0 ? (
                  <p className="admin-page__empty" data-admin-users-filter-empty="true">
                    {t("admin.noUsersOnPage")}
                  </p>
                ) : null}
                <div className="admin-page__pager" data-admin-page="true">
                  <button
                    type="button"
                    className="admin-page__btn admin-page__btn--ghost"
                    disabled={!canPrev || usersLoading}
                    onClick={() => setOffset(Math.max(0, offset - ADMIN_PAGE_SIZE))}
                  >
                    {t("admin.previous")}
                  </button>
                  <p>{t("admin.pageOf", { page: formatNumber(pageNumber), pages: formatNumber(pageCount) })}</p>
                  <button
                    type="button"
                    className="admin-page__btn admin-page__btn--ghost"
                    disabled={!canNext || usersLoading}
                    onClick={() => setOffset(offset + ADMIN_PAGE_SIZE)}
                  >
                    {t("admin.next")}
                  </button>
                </div>
              </div>
            ) : null}

            {section === "liveMatches" ? (
              <div data-admin-live="true">
                <header className="admin-page__header">
                  <h2>{t("admin.liveMatches")}</h2>
                  <button
                    type="button"
                    className="admin-page__btn admin-page__btn--ghost"
                    disabled={liveLoading}
                    onClick={() => void loadLiveMatches({ offset: liveOffset, limit: ADMIN_PAGE_SIZE })}
                  >
                    {t("admin.retry")}
                  </button>
                </header>
                <div className="admin-page__filters" data-admin-live-view="true">
                  <button
                    type="button"
                    className={`admin-page__filter${liveView === "matches" ? " is-active" : ""}`}
                    data-admin-live-view-item="matches"
                    onClick={() => setLiveView("matches")}
                  >
                    {t("admin.liveMatchesView")}
                  </button>
                  <button
                    type="button"
                    className={`admin-page__filter${liveView === "players" ? " is-active" : ""}`}
                    data-admin-live-view-item="players"
                    onClick={() => setLiveView("players")}
                  >
                    {t("admin.livePlayersView")}
                  </button>
                </div>
                {liveError ? (
                  <p className="admin-page__error" role="alert">
                    {t(liveError)}
                  </p>
                ) : null}
                {liveLoading ? <p className="admin-page__hint">{t("admin.loading")}</p> : null}
                {!liveLoading && !liveError && livePage.matches.length === 0 ? (
                  <p className="admin-page__empty" data-admin-live-empty="true">
                    {t("admin.noLiveMatches")}
                  </p>
                ) : null}
                {liveView === "players" ? (
                  <div className="admin-page__table-wrap" data-admin-live-players="true">
                    <table className="admin-page__table">
                      <thead>
                        <tr>
                          <th>{t("admin.displayName")}</th>
                          <th>{t("admin.username")}</th>
                          <th>{t("admin.playerId")}</th>
                          <th>{t("admin.matchId")}</th>
                          <th>{t("admin.vs")}</th>
                          <th>{t("admin.style")}</th>
                          <th>{t("admin.stake")}</th>
                          <th>{t("admin.occupancy")}</th>
                          <th>{t("admin.status")}</th>
                          <th>{t("admin.started")}</th>
                          <th>{t("admin.messageAction")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {livePlayers.map((row) => (
                          <tr
                            key={`${row.matchId}:${row.playerId}`}
                            data-admin-live-player={row.playerId}
                            onClick={() => {
                              const match = livePage.matches.find((item) => item.matchId === row.matchId);
                              if (match) setLiveSelected(match);
                            }}
                          >
                            <td>{row.displayName || "—"}</td>
                            <td>{row.username || "—"}</td>
                            <td className="admin-page__mono">{row.playerId}</td>
                            <td className="admin-page__mono">{row.matchId}</td>
                            <td>{row.opponentName || "—"}</td>
                            <td>{styleLabel(row.rulesetId)}</td>
                            <td>{stakeDisplay(row.stakePips)}</td>
                            <td>
                              <span className={`admin-page__pill ${occupancyClass(row.occupancy)}`}>
                                {t(adminOccupancyI18nKey(row.occupancy))}
                              </span>
                            </td>
                            <td>{t(liveMatchStatusKey(row.adminStatus))}</td>
                            <td>{formatWhen(row.createdAt)}</td>
                            <td className="admin-page__row-actions">
                              <button
                                type="button"
                                className="admin-page__btn admin-page__btn--ghost admin-page__btn--compact"
                                data-admin-quick-message={row.playerId}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openQuickPlayerMessage(row);
                                }}
                              >
                                {t("admin.messageAction")}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                <div className="admin-page__match-list">
                  {livePage.matches.map((match) => {
                    const occupancy = adminOccupancyKind(match);
                    return (
                    <article
                      key={match.matchId}
                      className="admin-page__match"
                      data-admin-live-match={match.matchId}
                      data-admin-occupancy={occupancy}
                    >
                      <div className="admin-page__match-top">
                        <p className="admin-page__match-players">
                          <span>{playerLabel(match.playerA)}</span>
                          <span className="admin-page__match-vs">{t("admin.vs")}</span>
                          <span>{playerLabel(match.playerB)}</span>
                        </p>
                        <span
                          className={`admin-page__pill ${statusClass(match.adminStatus)}`}
                          data-admin-live-status={match.adminStatus}
                        >
                          {t(liveMatchStatusKey(match.adminStatus))}
                        </span>
                      </div>
                      <dl className="admin-page__match-meta">
                        <div>
                          <dt>{t("admin.matchId")}</dt>
                          <dd className="admin-page__mono">{match.matchId}</dd>
                        </div>
                        <div>
                          <dt>{t("admin.matchKind")}</dt>
                          <dd>{economyLabel(match)}</dd>
                        </div>
                        <div>
                          <dt>{t("admin.stake")}</dt>
                          <dd data-admin-stake={adminStakeLabel(match.stakePips) || "none"}>
                            {stakeDisplay(match.stakePips)}
                          </dd>
                        </div>
                        <div>
                          <dt>{t("admin.occupancy")}</dt>
                          <dd>
                            <span className={`admin-page__pill ${occupancyClass(occupancy)}`}>
                              {occupancyLabel(match)}
                            </span>
                          </dd>
                        </div>
                        <div>
                          <dt>{t("admin.style")}</dt>
                          <dd>{styleLabel(match.rulesetId)}</dd>
                        </div>
                        <div>
                          <dt>{t("admin.matchType")}</dt>
                          <dd>{match.rated ? t("admin.rated") : t("admin.unrated")}</dd>
                        </div>
                        <div>
                          <dt>{t("admin.score")}</dt>
                          <dd>{scoreLabel(match)}</dd>
                        </div>
                        <div>
                          <dt>{t("admin.round")}</dt>
                          <dd>{match.round == null ? "—" : formatNumber(match.round)}</dd>
                        </div>
                        <div>
                          <dt>{t("admin.started")}</dt>
                          <dd>{formatWhen(match.createdAt)}</dd>
                        </div>
                        <div>
                          <dt>{t("admin.elapsed")}</dt>
                          <dd>{elapsedLabel(match.createdAt)}</dd>
                        </div>
                      </dl>
                      <button
                        type="button"
                        className="admin-page__btn admin-page__btn--ghost"
                        data-admin-live-view={match.matchId}
                        onClick={() => setLiveSelected(match)}
                      >
                        {t("admin.viewDetails")}
                      </button>
                    </article>
                    );
                  })}
                </div>
                )}
                <div className="admin-page__pager" data-admin-live-page="true">
                  <button
                    type="button"
                    className="admin-page__btn admin-page__btn--ghost"
                    disabled={!liveCanPrev || liveLoading}
                    onClick={() => setLiveOffset(Math.max(0, liveOffset - ADMIN_PAGE_SIZE))}
                  >
                    {t("admin.previous")}
                  </button>
                  <p>
                    {t("admin.pageOf", {
                      page: formatNumber(livePageNumber),
                      pages: formatNumber(livePageCount),
                    })}
                  </p>
                  <button
                    type="button"
                    className="admin-page__btn admin-page__btn--ghost"
                    disabled={!liveCanNext || liveLoading}
                    onClick={() => setLiveOffset(liveOffset + ADMIN_PAGE_SIZE)}
                  >
                    {t("admin.next")}
                  </button>
                </div>
              </div>
            ) : null}

            {section === "matchHistory" ? (
              <div data-admin-global-match-history="true">
                <header className="admin-page__header">
                  <h2>{t("admin.matchHistory")}</h2>
                  <button
                    type="button"
                    className="admin-page__btn admin-page__btn--ghost"
                    disabled={globalHistoryLoading}
                    onClick={() =>
                      void loadGlobalMatchHistory({
                        search: globalHistorySearch,
                        rulesetId: globalHistoryStyle === "all" ? null : globalHistoryStyle,
                        status: globalHistoryStatus || null,
                        finishReason: globalHistoryFinish || null,
                        from: globalHistoryFrom
                          ? new Date(`${globalHistoryFrom}T00:00:00.000Z`).toISOString()
                          : null,
                        to: globalHistoryTo
                          ? new Date(`${globalHistoryTo}T23:59:59.999Z`).toISOString()
                          : null,
                        limit: ADMIN_PAGE_SIZE,
                        offset: globalHistoryOffset,
                      })
                    }
                  >
                    {t("admin.retry")}
                  </button>
                </header>
                <p className="admin-page__hint">{t("admin.globalMatchHistoryHint")}</p>
                <div className="admin-page__filters" data-admin-global-history-style="true">
                  {ADMIN_RANKING_STYLES.map((style) => (
                    <button
                      key={style}
                      type="button"
                      className={`admin-page__filter${globalHistoryStyle === style ? " is-active" : ""}`}
                      data-admin-global-history-style-item={style}
                      onClick={() => setGlobalHistoryStyle(style)}
                    >
                      {t(rankingStyleLabelKey(style))}
                    </button>
                  ))}
                </div>
                <div className="admin-page__filters">
                  <label className="admin-page__search">
                    <span className="sr-only">{t("admin.search")}</span>
                    <input
                      type="search"
                      value={globalHistorySearchInput}
                      data-admin-global-history-search="true"
                      placeholder={t("admin.globalMatchHistorySearch")}
                      onChange={(event) => setGlobalHistorySearchInput(event.target.value)}
                    />
                  </label>
                  <label>
                    <span className="sr-only">{t("admin.status")}</span>
                    <select
                      value={globalHistoryStatus}
                      data-admin-global-history-status="true"
                      onChange={(event) => setGlobalHistoryStatus(event.target.value)}
                    >
                      <option value="">{t("admin.filterAll")}</option>
                      <option value="ready">{t("admin.statusReady")}</option>
                      <option value="playing">{t("admin.statusPlaying")}</option>
                      <option value="finished">{t("admin.statusFinished")}</option>
                      <option value="aborted">{t("admin.statusAborted")}</option>
                    </select>
                  </label>
                  <label>
                    <span className="sr-only">{t("admin.finishReason")}</span>
                    <select
                      value={globalHistoryFinish}
                      data-admin-global-history-finish="true"
                      onChange={(event) => setGlobalHistoryFinish(event.target.value)}
                    >
                      <option value="">{t("admin.filterAll")}</option>
                      <option value="completed">{t("admin.finishCompleted")}</option>
                      <option value="timeout">{t("admin.finishTimeout")}</option>
                      <option value="forfeit">{t("admin.finishForfeit")}</option>
                      <option value="aborted">{t("admin.finishAborted")}</option>
                      <option value="join_timeout">{t("admin.statusJoinTimeout")}</option>
                    </select>
                  </label>
                  <label>
                    <span className="sr-only">{t("admin.dateFrom")}</span>
                    <input
                      type="date"
                      value={globalHistoryFrom}
                      data-admin-global-history-from="true"
                      onChange={(event) => setGlobalHistoryFrom(event.target.value)}
                    />
                  </label>
                  <label>
                    <span className="sr-only">{t("admin.dateTo")}</span>
                    <input
                      type="date"
                      value={globalHistoryTo}
                      data-admin-global-history-to="true"
                      onChange={(event) => setGlobalHistoryTo(event.target.value)}
                    />
                  </label>
                </div>
                {globalHistoryError ? (
                  <p className="admin-page__error" role="alert">
                    {t(globalHistoryError)}
                  </p>
                ) : null}
                {globalHistoryLoading && globalHistoryPage.matches.length === 0 ? (
                  <p className="admin-page__empty">{t("admin.loading")}</p>
                ) : null}
                <div className="admin-page__table-wrap">
                  <table className="admin-page__table">
                    <thead>
                      <tr>
                        <th>{t("admin.matchId")}</th>
                        <th>{t("admin.playerA")}</th>
                        <th>{t("admin.playerB")}</th>
                        <th>{t("admin.style")}</th>
                        <th>{t("admin.stakePips")}</th>
                        <th>{t("admin.winner")}</th>
                        <th>{t("admin.loser")}</th>
                        <th>{t("admin.score")}</th>
                        <th>{t("admin.finishReason")}</th>
                        <th>{t("admin.started")}</th>
                        <th>{t("admin.finishedAt")}</th>
                        <th>{t("admin.duration")}</th>
                        <th>{t("admin.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {globalHistoryPage.matches.map((match) => (
                        <tr key={match.matchId} data-admin-global-history-match={match.matchId}>
                          <td className="admin-page__mono">{match.matchId}</td>
                          <td>{playerLabel(match.playerA)}</td>
                          <td>{playerLabel(match.playerB)}</td>
                          <td>{match.styleLabel || styleLabel(match.rulesetId)}</td>
                          <td>
                            {match.stakePips == null ? "—" : formatNumber(match.stakePips)}
                          </td>
                          <td>{match.winnerLabel || "—"}</td>
                          <td>{match.loserLabel || "—"}</td>
                          <td>{match.scoreLabel || "—"}</td>
                          <td>{matchFinishLabel(match.finishReason)}</td>
                          <td>{formatWhen(match.createdAt)}</td>
                          <td>{formatWhen(match.finishedAt)}</td>
                          <td>{formatDuration(match.durationSeconds)}</td>
                          <td>{t(adminHistoryStatusKey(match.status, match.finishReason))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!globalHistoryLoading &&
                !globalHistoryError &&
                globalHistoryPage.matches.length === 0 ? (
                  <p className="admin-page__empty" data-admin-global-history-empty="true">
                    {t("admin.noGlobalMatchHistory")}
                  </p>
                ) : null}
                <div className="admin-page__pager" data-admin-global-history-page="true">
                  <button
                    type="button"
                    className="admin-page__btn admin-page__btn--ghost"
                    disabled={!globalHistoryCanPrev || globalHistoryLoading}
                    onClick={() =>
                      setGlobalHistoryOffset(Math.max(0, globalHistoryOffset - ADMIN_PAGE_SIZE))
                    }
                  >
                    {t("admin.previous")}
                  </button>
                  <p>
                    {t("admin.pageOf", {
                      page: formatNumber(globalHistoryPageNumber),
                      pages: formatNumber(globalHistoryPageCount),
                    })}
                  </p>
                  <button
                    type="button"
                    className="admin-page__btn admin-page__btn--ghost"
                    disabled={!globalHistoryCanNext || globalHistoryLoading}
                    onClick={() => setGlobalHistoryOffset(globalHistoryOffset + ADMIN_PAGE_SIZE)}
                  >
                    {t("admin.next")}
                  </button>
                </div>
              </div>
            ) : null}

            {section === "playerRankings" ? (
              <div data-admin-rankings="true">
                <header className="admin-page__header">
                  <h2>{t("admin.playerRankings")}</h2>
                  <button
                    type="button"
                    className="admin-page__btn admin-page__btn--ghost"
                    disabled={rankingLoading}
                    onClick={() =>
                      void loadRankings({
                        search: rankingSearch,
                      })
                    }
                  >
                    {t("admin.retry")}
                  </button>
                </header>
                <p className="admin-page__hint">{t("admin.rankingHint")}</p>
                {!rankingLevelXpAvailable ? (
                  <p className="admin-page__hint" data-admin-ranking-level-xp-inactive="true">
                    {t("admin.rankingLevelXpInactive")}
                  </p>
                ) : null}
                <div className="admin-page__filters" data-admin-ranking-mode="true">
                  {ADMIN_RANKING_MODES.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`admin-page__filter${rankingMode === mode ? " is-active" : ""}`}
                      data-admin-ranking-mode-item={mode}
                      onClick={() => setRankingMode(mode)}
                    >
                      {t(
                        mode === "level"
                          ? "admin.rankingModeLevel"
                          : mode === "xp"
                            ? "admin.rankingModeXp"
                            : "admin.rankingModeLeopips"
                      )}
                    </button>
                  ))}
                </div>
                <label className="admin-page__search">
                  <span className="sr-only">{t("admin.searchUsers")}</span>
                  <input
                    type="search"
                    value={rankingSearchInput}
                    data-admin-ranking-search="true"
                    placeholder={t("admin.searchUsers")}
                    onChange={(event) => setRankingSearchInput(event.target.value)}
                  />
                </label>
                {rankingError ? (
                  <p className="admin-page__error" role="alert">
                    {t(rankingError)}
                  </p>
                ) : null}
                {rankingLoading && rankingPage.players.length === 0 ? (
                  <p className="admin-page__empty" data-admin-rankings-loading="true">
                    {t("admin.loading")}
                  </p>
                ) : null}
                <div className="admin-page__table-wrap">
                  <table className="admin-page__table">
                    <thead>
                      <tr>
                        <th>{t("admin.displayName")}</th>
                        <th>{t("admin.username")}</th>
                        <th>{t("admin.playerId")}</th>
                        <th>{t("admin.leopipsBalance")}</th>
                        <th>{t("admin.level")}</th>
                        <th>{t("admin.rankingProgressionRank")}</th>
                        <th>{t("admin.xp")}</th>
                        <th>{t("admin.rankingQualifyingWins")}</th>
                        <th>{t("admin.messageAction")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankingPage.players.map((player) => (
                        <tr
                          key={player.playerId}
                          data-admin-ranking-player={player.playerId}
                          onClick={() => setSelected(rankingPlayerAsUser(player))}
                        >
                          <td>{player.displayName || "—"}</td>
                          <td>{player.username || "—"}</td>
                          <td className="admin-page__mono">{player.playerId}</td>
                          <td>
                            {player.leopipsBalance == null ? "—" : formatNumber(player.leopipsBalance)}
                          </td>
                          <td data-admin-ranking-level="true">
                            {player.level == null ? "—" : formatNumber(player.level)}
                          </td>
                          <td data-admin-ranking-progression-rank="true">
                            {player.progressionRank || "—"}
                          </td>
                          <td data-admin-ranking-xp="true">
                            {player.xp == null ? "—" : formatNumber(player.xp)}
                          </td>
                          <td data-admin-ranking-qualifying-wins="true">
                            {player.qualifyingWins == null ? "—" : formatNumber(player.qualifyingWins)}
                          </td>
                          <td className="admin-page__row-actions">
                            <button
                              type="button"
                              className="admin-page__btn admin-page__btn--ghost admin-page__btn--compact"
                              data-admin-quick-message={player.playerId}
                              onClick={(event) => {
                                event.stopPropagation();
                                openQuickPlayerMessage(player);
                              }}
                            >
                              {t("admin.messageAction")}
                            </button>
                            <button
                              type="button"
                              className="admin-page__btn admin-page__btn--ghost admin-page__btn--compact"
                              data-admin-quick-gift={player.playerId}
                              onClick={(event) => {
                                event.stopPropagation();
                                openQuickLeopipsGift(player);
                              }}
                            >
                              {t("admin.giftLeopipsAction")}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!rankingLoading && !rankingError && rankingPage.players.length === 0 ? (
                  <p className="admin-page__empty" data-admin-rankings-empty="true">
                    {t("admin.noRankings")}
                  </p>
                ) : null}
                <div className="admin-page__pager" data-admin-rankings-page="true">
                  <button
                    type="button"
                    className="admin-page__btn admin-page__btn--ghost"
                    disabled={!rankingCanPrev || rankingLoading}
                    onClick={() => setRankingOffset(Math.max(0, rankingOffset - ADMIN_PAGE_SIZE))}
                  >
                    {t("admin.previous")}
                  </button>
                  <p>
                    {t("admin.pageOf", {
                      page: formatNumber(rankingPageNumber),
                      pages: formatNumber(rankingPageCount),
                    })}
                  </p>
                  <button
                    type="button"
                    className="admin-page__btn admin-page__btn--ghost"
                    disabled={!rankingCanNext || rankingLoading}
                    onClick={() => setRankingOffset(rankingOffset + ADMIN_PAGE_SIZE)}
                  >
                    {t("admin.next")}
                  </button>
                </div>
              </div>
            ) : null}


            <AdminLeopipsPanels
              section={section}
              t={t}
              formatNumber={formatNumber}
              formatWhen={formatWhen}
              searchHint={globalSearchHint}
            />

            <AdminV1Panels
              section={section}
              role={role}
              t={t}
              formatNumber={formatNumber}
              formatWhen={formatWhen}
            />
            </AdminPanelErrorBoundary>
          </section>
        </div>
      ) : null}

      {gate === "ok" && selected ? (
        <div className="admin-page__drawer-wrap">
          <button
            type="button"
            className="admin-page__drawer-backdrop"
            aria-label={t("admin.closeDetail")}
            onClick={() => setSelected(null)}
          />
          <aside className="admin-page__drawer" data-admin-detail="true" aria-label={t("admin.playerDetail")}>
            <header className="admin-page__drawer-head">
              <h2>{t("admin.playerDetail")}</h2>
              <button type="button" className="admin-page__icon-btn" onClick={() => setSelected(null)}>
                <IconClose />
                <span className="sr-only">{t("admin.closeDetail")}</span>
              </button>
            </header>
            <div className="admin-page__identity" data-admin-player-identity="true">
              <AdminAvatarImage avatarId={selected.avatarId} size={72} />
              <div className="admin-page__identity-text">
                <p className="admin-page__drawer-name">{selected.displayName || "—"}</p>
                <p className="admin-page__identity-username" data-admin-player-username="true">
                  {selected.username ? `@${selected.username}` : "—"}
                </p>
                <p className="admin-page__identity-id admin-page__mono" data-admin-player-id="true">
                  {selected.playerId || "—"}
                </p>
              </div>
            </div>
            <dl className="admin-page__summary" data-admin-player-summary="true">
              <AdminSummaryRow
                label={t("admin.email")}
                valueClassName="admin-page__mono"
                valueProps={{ "data-admin-player-email": "true" }}
              >
                {playerEmail || "—"}
              </AdminSummaryRow>
              <AdminSummaryRow label={t("admin.country")}>{selected.countryCode || "—"}</AdminSummaryRow>
              <AdminSummaryRow
                label={t("admin.leopipsBalance")}
                valueProps={{ "data-admin-leopips-balance": "true" }}
              >
                {playerLeopips?.balance == null
                  ? selected.leopipsBalance == null
                    ? "—"
                    : formatNumber(selected.leopipsBalance)
                  : formatNumber(playerLeopips.balance)}
              </AdminSummaryRow>
              <div className="admin-page__drawer-gift-trigger">
                <button
                  type="button"
                  className="admin-page__btn admin-page__btn--ghost admin-page__btn--compact"
                  data-admin-detail-quick-gift="true"
                  onClick={() =>
                    openQuickLeopipsGift({
                      playerId: selected.playerId,
                      displayName: selected.displayName,
                      username: selected.username,
                      avatarId: selected.avatarId,
                      leopipsBalance: playerLeopips?.balance ?? selected.leopipsBalance,
                    })
                  }
                >
                  {t("admin.giftLeopipsAction")}
                </button>
              </div>
              <AdminSummaryRow label={t("admin.level")} valueProps={{ "data-admin-player-level": "true" }}>
                {selected.level == null ? "—" : formatNumber(selected.level)}
              </AdminSummaryRow>
              <AdminSummaryRow label={t("admin.xp")} valueProps={{ "data-admin-player-xp": "true" }}>
                {selected.xp == null ? "—" : formatNumber(selected.xp)}
              </AdminSummaryRow>
              <AdminSummaryRow
                label={t("admin.rankingQualifyingWins")}
                valueProps={{ "data-admin-player-qualifying-wins": "true" }}
              >
                {selected.qualifyingWins == null ? "—" : formatNumber(selected.qualifyingWins)}
              </AdminSummaryRow>
              <AdminSummaryRow
                label={t("admin.rankingProgressionRank")}
                valueProps={{ "data-admin-player-progression-rank": "true" }}
              >
                {selected.progressionRank || "—"}
              </AdminSummaryRow>
              <AdminSummaryRow label={t("admin.currentMatch")} valueClassName="admin-page__mono">
                {selectedLiveRow?.matchId || "—"}
              </AdminSummaryRow>
              <AdminSummaryRow label={t("admin.created")}>{formatWhen(selected.createdAt)}</AdminSummaryRow>
              <AdminSummaryRow label={t("admin.accountStatus")}>
                <span
                  className={`admin-page__pill${selectedAccount === "deleted" ? " is-deleted" : " is-ok"}`}
                  data-admin-account={selectedAccount}
                >
                  {t(adminAccountStatusI18nKey(selectedAccount))}
                </span>
              </AdminSummaryRow>
              <AdminSummaryRow label={t("admin.presence")}>
                <span
                  className={`admin-page__pill ${presencePillClass(selectedPresence)}`}
                  data-admin-presence={selectedPresence}
                >
                  {t(adminPresenceI18nKey(selectedPresence))}
                </span>
              </AdminSummaryRow>
              <AdminSummaryRow label={t("admin.friendCount")}>
                {formatNumber(userDetail?.player?.friendCount ?? 0)}
              </AdminSummaryRow>
              <AdminSummaryRow label={t("admin.matchLastSeen")}>
                {formatWhen(userDetail?.player?.matchLastSeenAt)}
              </AdminSummaryRow>
            </dl>
            <div className="admin-page__history-actions" data-admin-history-actions="true">
              <button
                type="button"
                className="admin-page__btn admin-page__btn--ghost"
                data-admin-copy-history="true"
                onClick={() => void copyPlayerHistoryReport()}
              >
                {t("admin.copyHistoryReport")}
              </button>
              <button
                type="button"
                className="admin-page__btn admin-page__btn--ghost"
                data-admin-download-history="true"
                onClick={() => downloadPlayerHistoryCsv()}
              >
                {t("admin.downloadHistoryCsv")}
              </button>
            </div>
            {historyExportStatus ? (
              <p className="admin-page__hint" data-admin-history-export-status="true">
                {t(historyExportStatus)}
              </p>
            ) : null}
            <section className="admin-page__match-history" data-admin-match-history="true">
              <h3>{t("admin.matchHistory")}</h3>
              {matchHistoryLoading ? (
                <p data-admin-match-history-loading="true">{t("admin.loading")}</p>
              ) : null}
              {matchHistoryError ? (
                <p data-admin-match-history-error="true">{t(matchHistoryError)}</p>
              ) : null}
              {!matchHistoryLoading && !matchHistoryError && matchHistory.matches.length === 0 ? (
                <p data-admin-match-history-empty="true">{t("admin.noMatchHistory")}</p>
              ) : null}
              {matchHistory.matches.length ? (
                <ol className="admin-page__match-history-list">
                  {matchHistory.matches.map((event) => {
                    const loser = deriveAdminMatchHistoryLoser(event, selected);
                    return (
                      <li key={event.matchId} className="admin-page__match-history-item">
                        <div className="admin-page__match-history-top">
                          <span
                            className={`admin-page__pill${
                              event.selectedResult === "win"
                                ? " is-ok"
                                : event.selectedResult === "loss"
                                  ? " is-deleted"
                                  : ""
                            }`}
                          >
                            {matchResultLabel(event.selectedResult)}
                          </span>
                          <time dateTime={event.finishedAt || event.createdAt || undefined}>
                            {formatWhen(event.finishedAt || event.createdAt)}
                          </time>
                        </div>
                        <dl className="admin-page__match-meta">
                          <div>
                            <dt>{t("admin.matchHistoryOpponent")}</dt>
                            <dd>
                              {event.opponent?.displayName ||
                                event.opponent?.username ||
                                "—"}
                            </dd>
                          </div>
                          <div>
                            <dt>{t("admin.style")}</dt>
                            <dd>{event.styleLabel || styleLabel(event.rulesetId)}</dd>
                          </div>
                          <div>
                            <dt>{t("admin.matchKind")}</dt>
                            <dd>{matchKindLabel(event.matchKind)}</dd>
                          </div>
                          <div>
                            <dt>{t("admin.matchType")}</dt>
                            <dd>
                              {event.rated == null
                                ? "—"
                                : event.rated
                                  ? t("admin.rated")
                                  : t("admin.unrated")}
                            </dd>
                          </div>
                          <div>
                            <dt>{t("admin.stakePips")}</dt>
                            <dd>
                              {event.stakePips == null ? "—" : formatNumber(event.stakePips)}
                            </dd>
                          </div>
                          <div>
                            <dt>{t("admin.result")}</dt>
                            <dd>{matchResultLabel(event.selectedResult)}</dd>
                          </div>
                          <div>
                            <dt>{t("admin.winner")}</dt>
                            <dd>{event.winnerUsername || "—"}</dd>
                          </div>
                          <div>
                            <dt>{t("admin.loser")}</dt>
                            <dd data-admin-match-loser="true">
                              {loser?.displayName || loser?.username || event.loserUsername || "—"}
                            </dd>
                          </div>
                          <div>
                            <dt>{t("admin.score")}</dt>
                            <dd>{matchHistoryScoreLabel(event.finalScore)}</dd>
                          </div>
                          <div>
                            <dt>{t("admin.finishReason")}</dt>
                            <dd>{matchFinishLabel(event.finishReason)}</dd>
                          </div>
                          <div>
                            <dt>{t("admin.duration")}</dt>
                            <dd>{formatDuration(event.durationSeconds)}</dd>
                          </div>
                          <div>
                            <dt>{t("admin.status")}</dt>
                            <dd>{event.status || "—"}</dd>
                          </div>
                          <div>
                            <dt>{t("admin.started")}</dt>
                            <dd>{formatWhen(event.createdAt)}</dd>
                          </div>
                          <div>
                            <dt>{t("admin.finishedAt")}</dt>
                            <dd>{formatWhen(event.finishedAt)}</dd>
                          </div>
                        </dl>
                        <p className="admin-page__match-id">{event.matchId}</p>
                      </li>
                    );
                  })}
                </ol>
              ) : null}
              {matchHistoryCanLoadMore ? (
                <button
                  type="button"
                  className="admin-page__btn admin-page__btn--ghost"
                  data-admin-match-history-more="true"
                  disabled={matchHistoryLoadingMore}
                  onClick={() => void loadMoreMatchHistory()}
                >
                  {matchHistoryLoadingMore ? t("admin.loading") : t("admin.loadMore")}
                </button>
              ) : null}
            </section>
            <div className="admin-page__dm" data-admin-player-message="true">
              <button
                type="button"
                className="admin-page__btn"
                data-admin-send-message="true"
                onClick={() => {
                  setDmComposeOpen((open) => !open);
                  setDmStatus({ kind: "", key: "" });
                }}
              >
                {t("admin.sendMessage")}
              </button>
              {dmComposeOpen ? (
                <div className="admin-page__dm-compose" data-admin-message-compose="true">
                  <label className="admin-page__dm-label" htmlFor="admin-player-dm">
                    {t("admin.messageLabel")}
                  </label>
                  <textarea
                    id="admin-player-dm"
                    className="admin-page__dm-textarea"
                    data-admin-message-input="true"
                    rows={4}
                    maxLength={ADMIN_PLAYER_MESSAGE_MAX}
                    value={dmDraft}
                    disabled={dmBusy}
                    onChange={(event) => setDmDraft(event.target.value)}
                    placeholder={t("admin.messagePlaceholder")}
                  />
                  <p className="admin-page__hint">
                    {trimAdminPlayerMessage(dmDraft).length}/{ADMIN_PLAYER_MESSAGE_MAX}
                  </p>
                  <button
                    type="button"
                    className="admin-page__btn"
                    data-admin-message-submit="true"
                    disabled={dmBusy}
                    onClick={() => {
                      void sendSelectedPlayerMessage();
                    }}
                  >
                    {dmBusy ? t("admin.sendingMessage") : t("admin.send")}
                  </button>
                  {dmStatus.key ? (
                    <p
                      className={`admin-page__hint${dmStatus.kind === "error" ? " is-error" : ""}`}
                      data-admin-message-status={dmStatus.kind || undefined}
                    >
                      {t(dmStatus.key)}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div data-admin-message-history="true">
                <p className="admin-page__hint">{t("admin.messageHistory")}</p>
                {dmHistoryError ? <p className="admin-page__hint">{t(dmHistoryError)}</p> : null}
                {dmHistory.length ? (
                  <ol className="admin-page__rp-history">
                    {dmHistory.map((row) => (
                      <li key={row.id} data-admin-message-row={row.seen ? "seen" : "unseen"}>
                        <div className="admin-page__rp-event-top">
                          <span className={`admin-page__pill ${row.seen ? "is-ok" : "is-warn"}`}>
                            {row.seen ? t("admin.messageSeen") : t("admin.messageUnseen")}
                          </span>
                          <time dateTime={row.createdAt || undefined}>{formatWhen(row.createdAt)}</time>
                        </div>
                        <p className="admin-page__dm-history-body">{row.messageText}</p>
                      </li>
                    ))}
                  </ol>
                ) : !dmHistoryError ? (
                  <p className="admin-page__hint">{t("admin.messageHistoryEmpty")}</p>
                ) : null}
              </div>
            </div>
            {playerLeopipsError ? (
              <p className="admin-page__hint">{t(playerLeopipsError)}</p>
            ) : playerLeopips ? (
              <div data-admin-player-leopips="true">
                {playerLeopips.referral?.qualifyingCount != null ? (
                  <p className="admin-page__hint">
                    {t("admin.qualifyingProgress")}: {referralProgressLabel(playerLeopips.referral.qualifyingCount)}
                  </p>
                ) : null}
                {(playerLeopips.ledger || []).length ? (
                  <ol className="admin-page__rp-history">
                    {playerLeopips.ledger.map((line, index) => (
                      <li key={line.idempotencyKey || `${line.reason}:${line.createdAt}:${index}`}>
                        {line.reason} {line.amount}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}

      {gate === "ok" && liveSelected ? (
        <div className="admin-page__drawer-wrap">
          <button
            type="button"
            className="admin-page__drawer-backdrop"
            aria-label={t("admin.closeDetail")}
            onClick={() => {
              setLiveSelected(null);
              setWatchingMatchId(null);
            }}
          />
          <aside className="admin-page__drawer" data-admin-live-detail="true" aria-label={t("admin.matchDetail")}>
            <header className="admin-page__drawer-head">
              <h2>{t("admin.matchDetail")}</h2>
              <button
                type="button"
                className="admin-page__icon-btn"
                onClick={() => {
                  setLiveSelected(null);
                  setWatchingMatchId(null);
                }}
              >
                <IconClose />
                <span className="sr-only">{t("admin.closeDetail")}</span>
              </button>
            </header>
            <p className="admin-page__match-id">{liveSelected.matchId}</p>
            <p className="admin-page__hint">
              <span className={`admin-page__pill ${occupancyClass(adminOccupancyKind(liveSelected))}`}>
                {occupancyLabel(liveSelected)}
              </span>
            </p>
            <div className="admin-page__drawer-hero admin-page__drawer-hero--pair">
              <div>
                <AdminAvatarImage avatarId={liveSelected.playerA.avatarId} size={56} />
                <p className="admin-page__drawer-name">{playerLabel(liveSelected.playerA)}</p>
                <p>{liveSelected.playerA.username || "—"}</p>
                <p className="admin-page__hint" data-admin-live-player-email="a">
                  {livePlayerEmails.a || "—"}
                </p>
                <button
                  type="button"
                  className="admin-page__btn admin-page__btn--ghost admin-page__btn--compact"
                  data-admin-live-message="a"
                  onClick={() => openLivePlayerMessage(liveSelected.playerA)}
                >
                  {t("admin.messageAction")}
                </button>
              </div>
              <div>
                <AdminAvatarImage avatarId={liveSelected.playerB.avatarId} size={56} />
                <p className="admin-page__drawer-name">{playerLabel(liveSelected.playerB)}</p>
                <p>{liveSelected.playerB.username || "—"}</p>
                <p className="admin-page__hint" data-admin-live-player-email="b">
                  {livePlayerEmails.b || "—"}
                </p>
                <button
                  type="button"
                  className="admin-page__btn admin-page__btn--ghost admin-page__btn--compact"
                  data-admin-live-message="b"
                  onClick={() => openLivePlayerMessage(liveSelected.playerB)}
                >
                  {t("admin.messageAction")}
                </button>
              </div>
            </div>
            <dl className="admin-page__facts">
              <div>
                <dt>{t("admin.status")}</dt>
                <dd>{t(liveMatchStatusKey(liveSelected.adminStatus))}</dd>
              </div>
              <div>
                <dt>{t("admin.style")}</dt>
                <dd>{styleLabel(liveSelected.rulesetId)}</dd>
              </div>
              <div>
                <dt>{t("admin.matchType")}</dt>
                <dd>{liveSelected.rated ? t("admin.rated") : t("admin.unrated")}</dd>
              </div>
              <div>
                <dt>{t("admin.matchKind")}</dt>
                <dd>{economyLabel(liveSelected)}</dd>
              </div>
              <div>
                <dt>{t("admin.stake")}</dt>
                <dd data-admin-stake={adminStakeLabel(liveSelected.stakePips) || "none"}>
                  {stakeDisplay(liveSelected.stakePips)}
                </dd>
              </div>
              <div>
                <dt>{t("admin.elapsed")}</dt>
                <dd>{elapsedLabel(liveSelected.createdAt)}</dd>
              </div>
              <div>
                <dt>{t("admin.finishState")}</dt>
                <dd>{liveSelected.finishReason || (liveSelected.finishedAt ? formatWhen(liveSelected.finishedAt) : "—")}</dd>
              </div>
              <div>
                <dt>{t("admin.score")}</dt>
                <dd>{scoreLabel(liveSelected)}</dd>
              </div>
              <div>
                <dt>{t("admin.round")}</dt>
                <dd>{liveSelected.round == null ? "—" : formatNumber(liveSelected.round)}</dd>
              </div>
              <div>
                <dt>{t("admin.turn")}</dt>
                <dd>
                  {liveSelected.currentPlayerId
                    ? t("admin.whoseTurn", {
                        name: playerLabel(
                          liveSelected.currentPlayerId === liveSelected.playerA.playerId
                            ? liveSelected.playerA
                            : liveSelected.playerB
                        ),
                      })
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("admin.tileCount")}</dt>
                <dd>
                  {liveSelected.handCountA == null || liveSelected.handCountB == null
                    ? "—"
                    : `${formatNumber(liveSelected.handCountA)} / ${formatNumber(liveSelected.handCountB)}`}
                </dd>
              </div>
              <div>
                <dt>{t("admin.boneyardCount")}</dt>
                <dd>{liveSelected.reserveCount == null ? "—" : formatNumber(liveSelected.reserveCount)}</dd>
              </div>
              <div>
                <dt>{t("admin.started")}</dt>
                <dd>{formatWhen(liveSelected.createdAt)}</dd>
              </div>
              <div>
                <dt>{t("admin.lastSeen")}</dt>
                <dd>
                  {formatWhen(liveSelected.playerA.lastSeenAt)} / {formatWhen(liveSelected.playerB.lastSeenAt)}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              className="admin-page__btn"
              data-admin-watch-live={liveSelected.matchId}
              onClick={() => setWatchingMatchId(liveSelected.matchId)}
            >
              {t("admin.watchLive")}
            </button>
          </aside>
        </div>
      ) : null}
      {gate === "ok" && watchingMatchId ? (
        <AdminSpectatorView
          matchId={watchingMatchId}
          seed={liveSelected?.matchId === watchingMatchId ? liveSelected : null}
          onClose={() => setWatchingMatchId(null)}
        />
      ) : null}
      {gate === "ok" && quickDmTarget ? (
        <div className="admin-page__drawer-wrap" data-admin-quick-message-overlay="true">
          <button
            type="button"
            className="admin-page__drawer-backdrop"
            aria-label={t("common.cancel")}
            onClick={closeQuickPlayerMessage}
          />
          <aside
            className="admin-page__drawer admin-page__drawer--quick-message"
            data-admin-quick-message-compose="true"
            data-admin-live-message-compose="true"
            aria-label={t("admin.sendMessage")}
          >
            <header className="admin-page__drawer-head">
              <h2>{t("admin.sendMessage")}</h2>
              <button type="button" className="admin-page__icon-btn" onClick={closeQuickPlayerMessage}>
                <IconClose />
                <span className="sr-only">{t("common.close")}</span>
              </button>
            </header>
            <div className="admin-page__drawer-hero">
              <AdminAvatarImage avatarId={quickDmTarget.avatarId} size={56} />
              <p className="admin-page__drawer-name" data-admin-quick-message-name="true">
                {quickDmTarget.displayName || quickDmTarget.username || "—"}
              </p>
              <p data-admin-quick-message-username="true">{quickDmTarget.username || "—"}</p>
              <p className="admin-page__mono" data-admin-quick-message-player={quickDmTarget.playerId}>
                {quickDmTarget.playerId}
              </p>
            </div>
            <div className="admin-page__dm-compose">
              <label className="admin-page__dm-label" htmlFor="admin-quick-player-dm">
                {t("admin.messageLabel")}
              </label>
              <textarea
                id="admin-quick-player-dm"
                className="admin-page__dm-textarea"
                data-admin-quick-message-input="true"
                rows={4}
                maxLength={ADMIN_PLAYER_MESSAGE_MAX}
                value={quickDmDraft}
                disabled={quickDmBusy}
                onChange={(event) => setQuickDmDraft(event.target.value)}
                placeholder={t("admin.messagePlaceholder")}
              />
              <p className="admin-page__hint">
                {trimAdminPlayerMessage(quickDmDraft).length}/{ADMIN_PLAYER_MESSAGE_MAX}
              </p>
              <div className="admin-page__quick-message-actions">
                <button
                  type="button"
                  className="admin-page__btn"
                  data-admin-quick-message-submit="true"
                  disabled={quickDmBusy}
                  onClick={() => {
                    void sendQuickPlayerMessage();
                  }}
                >
                  {quickDmBusy ? t("admin.sendingMessage") : t("admin.send")}
                </button>
                <button
                  type="button"
                  className="admin-page__btn admin-page__btn--ghost"
                  data-admin-quick-message-cancel="true"
                  disabled={quickDmBusy}
                  onClick={closeQuickPlayerMessage}
                >
                  {t("common.cancel")}
                </button>
              </div>
              {quickDmStatus.key ? (
                <p
                  className={`admin-page__hint${quickDmStatus.kind === "error" ? " is-error" : ""}`}
                  data-admin-quick-message-status={quickDmStatus.kind || undefined}
                >
                  {t(quickDmStatus.key)}
                </p>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}

      {gate === "ok" && quickGiftTarget ? (
        <div className="admin-page__drawer-wrap" data-admin-quick-gift-overlay="true">
          <button
            type="button"
            className="admin-page__drawer-backdrop"
            aria-label={t("common.cancel")}
            onClick={closeQuickLeopipsGift}
          />
          <aside
            className="admin-page__drawer admin-page__drawer--quick-message"
            data-admin-quick-gift-compose="true"
            aria-label={t("admin.sendLeopipsGift")}
          >
            <header className="admin-page__drawer-head">
              <h2>{t("admin.sendLeopipsGift")}</h2>
              <button type="button" className="admin-page__icon-btn" onClick={closeQuickLeopipsGift}>
                <IconClose />
                <span className="sr-only">{t("common.close")}</span>
              </button>
            </header>
            <div className="admin-page__drawer-hero">
              <AdminAvatarImage avatarId={quickGiftTarget.avatarId} size={56} />
              <p className="admin-page__drawer-name" data-admin-quick-gift-name="true">
                {quickGiftTarget.displayName || quickGiftTarget.username || "—"}
              </p>
              <p data-admin-quick-gift-username="true">{quickGiftTarget.username || "—"}</p>
              <p className="admin-page__mono" data-admin-quick-gift-player={quickGiftTarget.playerId}>
                {quickGiftTarget.playerId}
              </p>
            </div>
            <div className="admin-page__dm-compose" data-admin-gift-compose="true">
              <dl className="admin-page__summary" data-admin-gift-review="true">
                <AdminSummaryRow
                  label={t("admin.giftBalanceBefore")}
                  valueProps={{ "data-admin-gift-balance-before": "true" }}
                >
                  {quickGiftBalanceError
                    ? t(quickGiftBalanceError)
                    : quickGiftBalance == null
                      ? "—"
                      : formatNumber(quickGiftBalance)}
                </AdminSummaryRow>
              </dl>
              <label className="admin-page__dm-label" htmlFor="admin-quick-gift-amount">
                {t("admin.giftAmountLabel")}
              </label>
              <input
                id="admin-quick-gift-amount"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                className="admin-page__input"
                data-admin-gift-amount="true"
                value={quickGiftAmount}
                disabled={quickGiftBusy}
                onChange={(event) => setQuickGiftAmount(event.target.value.replace(/[^0-9]/g, ""))}
                placeholder={t("admin.giftAmountPlaceholder")}
              />
              <label className="admin-page__dm-label" htmlFor="admin-quick-gift-reason">
                {t("admin.giftReasonLabel")}
              </label>
              <div className="admin-page__filters" data-admin-gift-reason-presets="true">
                {ADMIN_LEOPIPS_GIFT_REASON_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`admin-page__filter${quickGiftReason === preset ? " is-active" : ""}`}
                    disabled={quickGiftBusy}
                    onClick={() => setQuickGiftReason(preset)}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <textarea
                id="admin-quick-gift-reason"
                className="admin-page__dm-textarea"
                data-admin-gift-reason="true"
                rows={2}
                maxLength={500}
                value={quickGiftReason}
                disabled={quickGiftBusy}
                onChange={(event) => setQuickGiftReason(event.target.value)}
                placeholder={t("admin.giftReasonPlaceholder")}
              />
              <dl className="admin-page__summary" data-admin-gift-review="true">
                <AdminSummaryRow label={t("admin.giftAmountLabel")}>
                  {quickGiftAmountCheck || !quickGiftAmount
                    ? "—"
                    : `+${formatNumber(Number(quickGiftAmount))}`}
                </AdminSummaryRow>
                <AdminSummaryRow
                  label={t("admin.giftBalanceAfter")}
                  valueProps={{ "data-admin-gift-balance-after": "true" }}
                >
                  {quickGiftPreviewAfter == null ? "—" : formatNumber(quickGiftPreviewAfter)}
                </AdminSummaryRow>
              </dl>
              <div className="admin-page__quick-message-actions">
                <button
                  type="button"
                  className="admin-page__btn"
                  data-admin-gift-submit="true"
                  disabled={quickGiftBusy}
                  onClick={() => {
                    void sendQuickLeopipsGift();
                  }}
                >
                  {quickGiftBusy ? t("admin.giftSending") : t("admin.giftConfirm")}
                </button>
                <button
                  type="button"
                  className="admin-page__btn admin-page__btn--ghost"
                  disabled={quickGiftBusy}
                  onClick={closeQuickLeopipsGift}
                >
                  {t("common.cancel")}
                </button>
              </div>
              {quickGiftStatus.key ? (
                <p
                  className={`admin-page__hint${quickGiftStatus.kind === "error" ? " is-error" : ""}`}
                  data-admin-gift-status={quickGiftStatus.kind || undefined}
                >
                  {t(quickGiftStatus.key)}
                  {quickGiftStatus.kind === "ok" && quickGiftResult
                    ? ` (${formatNumber(quickGiftResult.balanceBefore)} → ${formatNumber(quickGiftResult.balanceAfter)})`
                    : ""}
                </p>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </main>
  );
}

export default AdminPage;
