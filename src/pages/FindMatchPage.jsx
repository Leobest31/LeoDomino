import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import { IconHome } from "../components/Icon";
import { isCloudAuth, useAuth } from "../auth";
import { resolvePlayerAvatar } from "../auth/avatars.media.js";
import {
  DEFAULT_GAME_STYLE_ID,
  flagEmojiFromCountryCode,
  gameStyleFlagDataUrl,
  gameStyleFlagEmoji,
  listV1GameStyles,
} from "../data/gameStyles.js";
import { addSafeBreadcrumb } from "../monitoring";
import {
  acceptMatchRequest,
  canAcceptMatchRequest,
  cancelMatchRequest,
  createMatchRequest,
  getMatchWithPlayers,
  getMyActiveMatch,
  isAllowedFindMatchStake,
  isOwnMatchRequest,
  isStaleMatchAcceptError,
  joinOrCreatePublicMatchRequest,
  loadFindMatchBoard,
  PUBLIC_REQUEST_HEARTBEAT_MS,
  requestMatchesFindMatchLobby,
  subscribeMatchRequests,
  touchMyOpenPublicRequest,
  visibleFindMatchLobbyRequests,
  visibleFindMatchRequests,
} from "../online/matchmaking.js";
import {
  FIND_MATCH_OPEN_POLL_MS,
  documentIsHidden as findMatchDocumentIsHidden,
  planOpenRequestPollTick,
  shouldPollOpenRequest,
} from "../online/findMatchPoll.js";
import {
  buildFindMatchDiagSnapshot,
  exportFindMatchDiag,
  noteFindMatchDiagTitleTap,
} from "../online/findMatchDiag.js";
import { canRecoverMatch, decideMatchRecovery, shouldPromoteAcceptedToMatchReady } from "../online/matchRecovery.js";
import { isNotedTerminalMatch } from "../online/terminalMatchMemory.js";
import { isReservedNotStarted } from "../online/joinTimeout.js";
import { useFriendsBoard } from "../hooks/useFriends.js";
import FriendButton from "../components/FriendButton";
import "./FindMatchPage.css";

const GAME_STYLES = listV1GameStyles();

function errorMessageKey(error) {
  switch (error?.code) {
    case "INVALID_STYLE":
      return "findMatch.invalidStyle";
    case "INVALID_STAKE":
      return "findMatch.invalidStake";
    case "LOBBY_MISMATCH":
      return "findMatch.lobbyMismatch";
    case "SELF_ACCEPT":
      return "findMatch.cannotAcceptOwn";
    case "PLAYER_BUSY":
    case "REQUEST_UNAVAILABLE":
    case "REQUEST_ALREADY_ACCEPTED":
    case "NOT_OPEN":
    case "NOT_FOUND":
    case "CREATOR_UNAVAILABLE":
      return "findMatch.playerUnavailable";
    case "RANKED_PAIR_LIMIT":
      return "findMatch.rankedPairLimit";
    case "EXPIRED":
      return "findMatch.expired";
    case "ALREADY_OPEN":
      return "findMatch.alreadyOpen";
    case "AUTH":
      return "findMatch.unavailable";
    case "SERVICE_UNAVAILABLE":
      return "findMatch.serviceUnavailable";
    case "ACCOUNT_DELETED":
      return "findMatch.accountDeleted";
    case "CREATE_FAILED":
      return "findMatch.createError";
    case "ACCEPT_FAILED":
      return "findMatch.acceptError";
    case "CANCEL_FAILED":
      return "findMatch.cancelError";
    default:
      return "findMatch.error";
  }
}

function styleNameKey(styleId) {
  const style = GAME_STYLES.find((entry) => entry.id === styleId);
  return style?.nameKey ?? "setup.gameStyle.classic";
}

function withSessionIdentity(request, session) {
  if (!request || !session?.playerId) return request;
  if (request.creatorId !== session.playerId) return request;
  const displayName = session.displayName || session.username || request.creator?.displayName;
  return {
    ...request,
    creator: {
      playerId: session.playerId,
      displayName: displayName || request.creator?.displayName,
      avatarId: session.avatarId || request.creator?.avatarId,
      countryCode: session.countryCode || request.creator?.countryCode || "",
    },
  };
}

function Identity({ person, label, you }) {
  const { t } = useI18n();
  const avatar = resolvePlayerAvatar(person?.avatarId);
  const flag = flagEmojiFromCountryCode(person?.countryCode);
  return (
    <div className="find-match__who">
      <img className="find-match__avatar" src={avatar.src} alt="" draggable={false} />
      <div className="find-match__who-copy">
        {label ? <p className="find-match__who-role">{label}</p> : null}
        <p className="find-match__who-name">
          {person?.displayName || t("findMatch.you")}
          {you ? <span className="find-match__you">{t("findMatch.you")}</span> : null}
        </p>
      </div>
      {flag ? (
        <span className="find-match__flag" aria-hidden="true">
          {flag}
        </span>
      ) : null}
    </div>
  );
}

function FindMatchPage({
  onBack,
  onMainMenu,
  onEnterMatch,
  lockedStyleId = "",
  lockedStake = null,
}) {
  const { t } = useI18n();
  const { play, unlock } = useAudio();
  const { session } = useAuth();
  const playerId = session?.playerId ?? "";
  const onlineReady = isCloudAuth() && !session?.deletionPending;
  const friends = useFriendsBoard({ watchOnline: false });
  const lockedId = GAME_STYLES.some((entry) => entry.id === lockedStyleId) ? lockedStyleId : "";
  const lockedStakePips = isAllowedFindMatchStake(lockedStake) ? Number(lockedStake) : null;

  const [selectedId, setSelectedId] = useState(lockedId || DEFAULT_GAME_STYLE_ID);
  const [open, setOpen] = useState([]);
  const [own, setOwn] = useState(null);
  const [matched, setMatched] = useState(null);
  const [state, setState] = useState(onlineReady ? "loading" : "unavailable");
  const [busy, setBusy] = useState("");
  const [busyId, setBusyId] = useState("");
  const [errorKey, setErrorKey] = useState("");
  const [notice, setNotice] = useState("");
  const [boardSource, setBoardSource] = useState("legacy-list");
  const [diagStatus, setDiagStatus] = useState("");
  const ownStatusRef = useRef(null);
  const ownOpenIdRef = useRef(null);
  const matchedRef = useRef(null);
  const enteredOnlineRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const resolveWhileWaitingRef = useRef(false);
  const lastRefreshReasonRef = useRef("mount");
  const titleTapRef = useRef({ count: 0, firstAt: 0 });
  const diagBusyRef = useRef(false);

  const markEnteredOnline = (matchId) => {
    if (enteredOnlineRef.current) return;
    enteredOnlineRef.current = true;
    addSafeBreadcrumb("entered online match", {
      screen: "findMatch",
      mode: "online",
      matchId,
    });
  };

  const tap = (fn) => {
    unlock();
    play("button");
    fn?.();
  };

  const applyMatched = (match) => {
    if (!canRecoverMatch(match)) return false;
    matchedRef.current = match;
    setMatched(match);
    markEnteredOnline(match.id);
    return true;
  };

  const clearMatched = () => {
    matchedRef.current = null;
    setMatched(null);
  };

  const refresh = useCallback(async () => {
    if (!onlineReady) {
      setState("unavailable");
      return;
    }
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }
    refreshInFlightRef.current = true;
    try {
      let occupancyUnknown = false;
      let occupancyMatch = null;
      const lobbyStyle = lockedId || selectedId;
      const isLeoPipsLobby = lockedStakePips != null || Boolean(lockedId);
      const lobby =
        lockedStakePips != null
          ? { styleId: lobbyStyle, stakePips: lockedStakePips }
          : null;
      const [board] = await Promise.all([
        loadFindMatchBoard(playerId, lobby),
        getMyActiveMatch()
          .then((match) => {
            occupancyMatch = match;
          })
          .catch(() => {
            occupancyUnknown = true;
          }),
      ]);
      const nextOwn = withSessionIdentity(board.own, session);
      const nextOpen = (board.open ?? []).map((row) => withSessionIdentity(row, session));
      const acceptedMatchId = nextOwn?.status === "accepted" ? nextOwn.matchId : null;
      let hydratedAcceptedMatch;
      // Hydrate accepted match whenever occupancy is empty/unknown so the creator
      // still gets Match Ready (acceptor can enter via accept path without this).
      if (
        acceptedMatchId &&
        !isNotedTerminalMatch(acceptedMatchId) &&
        !canRecoverMatch(occupancyMatch)
      ) {
        try {
          hydratedAcceptedMatch = await getMatchWithPlayers(acceptedMatchId);
        } catch {
          hydratedAcceptedMatch = undefined;
        }
      }
      const wasWaiting = isReservedNotStarted(matchedRef.current);
      const decision = decideMatchRecovery({
        occupancyUnknown,
        occupancyMatch,
        lastKnown: matchedRef.current,
        acceptedMatchId,
        hydratedAcceptedMatch,
      });
      if (decision.kind === "resume" || decision.kind === "keep") {
        if (decision.match) applyMatched(decision.match);
      } else {
        clearMatched();
        if (wasWaiting) setNotice("joinTimeout");
      }
      const promoteCandidate =
        (canRecoverMatch(occupancyMatch) && occupancyMatch) ||
        (canRecoverMatch(hydratedAcceptedMatch) && hydratedAcceptedMatch) ||
        null;
      if (shouldPromoteAcceptedToMatchReady(nextOwn, promoteCandidate)) {
        applyMatched(promoteCandidate);
      }
      ownStatusRef.current = nextOwn?.status ?? null;
      ownOpenIdRef.current = nextOwn?.status === "open" ? nextOwn.id : null;
      setOwn(nextOwn);
      setBoardSource(board.source || "legacy-list");
      if (isLeoPipsLobby && (lockedStakePips == null || board.source !== "lobby-rpc")) {
        setOpen([]);
        setErrorKey(lockedStakePips == null ? "findMatch.invalidStake" : "findMatch.error");
        setState(matchedRef.current ? "matched" : "error");
        return;
      }
      const visibleOpenRows = isLeoPipsLobby
        ? visibleFindMatchLobbyRequests(nextOpen, nextOwn, lobbyStyle, lockedStakePips)
        : visibleFindMatchRequests(nextOpen, nextOwn);

      // Stuck dual-OPEN convergence: while waiting, prefer accept-over-wait
      // when a compatible peer is already on the board (server-authoritative RPC).
      if (
        !matchedRef.current &&
        nextOwn?.status === "open" &&
        lockedStakePips != null &&
        visibleOpenRows.length > 0 &&
        !resolveWhileWaitingRef.current
      ) {
        resolveWhileWaitingRef.current = true;
        try {
          const joined = await joinOrCreatePublicMatchRequest(lobbyStyle, lockedStakePips);
          if (joined.outcome === "accepted" && joined.match && applyMatched(joined.match)) {
            setOwn(withSessionIdentity(joined.request, session));
            setOpen([]);
            setErrorKey("");
            setState("matched");
            markEnteredOnline(joined.match?.id);
            return;
          }
        } catch {
          // RPC missing or transient — keep waiting UI; manual Accept still works.
        } finally {
          resolveWhileWaitingRef.current = false;
        }
      }

      setOpen(visibleOpenRows);
      setErrorKey("");
      if (matchedRef.current) {
        setState("matched");
      } else if (visibleOpenRows.length === 0) {
        setState("empty");
      } else {
        setState("list");
      }
    } catch (error) {
      setErrorKey(errorMessageKey(error));
      setState("error");
    } finally {
      refreshInFlightRef.current = false;
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        void refresh();
      }
    }
  }, [onlineReady, playerId, session, lockedId, lockedStakePips, selectedId]);

  useEffect(() => {
    if (!onlineReady) {
      setState("unavailable");
      return undefined;
    }
    setState("loading");
    refresh();
    let stop = () => {};
    try {
      stop = subscribeMatchRequests(() => {
        lastRefreshReasonRef.current = "realtime";
        refresh();
      });
    } catch {
      // Listing still works without Realtime.
    }
    return () => stop();
  }, [onlineReady, refresh]);

  useEffect(() => {
    if (!onlineReady) return undefined;
    const runForegroundRefresh = (reason) => {
      lastRefreshReasonRef.current = reason;
      refresh();
      // Late / background gaps: refresh creator heartbeat as soon as waiting
      // returns to the foreground, then resume the normal visible interval.
      if (ownStatusRef.current === "open" && !matchedRef.current) {
        void touchMyOpenPublicRequest().catch(() => {
          /* best-effort until the RPC exists */
        });
      }
    };
    const onFocus = () => runForegroundRefresh("focus");
    const onVis = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        runForegroundRefresh("visibility");
      }
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
    };
  }, [onlineReady, refresh]);

  useEffect(() => {
    if (
      !shouldPollOpenRequest({
        onlineReady,
        ownStatus: own?.status,
        hasMatched: Boolean(matched),
      })
    ) {
      return undefined;
    }
    const tick = () => {
      const planned = planOpenRequestPollTick({
        hidden: findMatchDocumentIsHidden(),
        ownStatus: ownStatusRef.current,
        hasMatched: Boolean(matchedRef.current),
        inFlight: refreshInFlightRef.current,
      });
      if (planned.action === "refresh") {
        lastRefreshReasonRef.current = "poll";
        void refresh();
      }
    };
    const handle = window.setInterval(tick, FIND_MATCH_OPEN_POLL_MS);
    return () => window.clearInterval(handle);
  }, [onlineReady, own?.status, matched, refresh]);

  useEffect(() => {
    if (!onlineReady || own?.status !== "open" || matched) return undefined;
    const beat = () => {
      if (findMatchDocumentIsHidden()) return;
      void touchMyOpenPublicRequest().catch(() => {
        /* heartbeat is best-effort until the RPC exists */
      });
    };
    beat();
    const handle = window.setInterval(beat, PUBLIC_REQUEST_HEARTBEAT_MS);
    return () => window.clearInterval(handle);
  }, [onlineReady, own?.status, matched]);

  useEffect(() => {
    if (onlineReady) return undefined;
    const id = ownOpenIdRef.current;
    if (id) {
      ownOpenIdRef.current = null;
      void cancelMatchRequest(id).catch(() => {});
    }
    return undefined;
  }, [onlineReady]);

  useEffect(() => {
    addSafeBreadcrumb("entered Find Match", { screen: "findMatch", mode: "online" });
  }, []);

  useEffect(() => {
    if (lockedId) setSelectedId(lockedId);
  }, [lockedId]);

  const handleSelect = (styleId) => {
    if (lockedId) return;
    tap(() => {
      setSelectedId(styleId);
      addSafeBreadcrumb(
        styleId === "haitian" ? "selected Haitian ruleset" : `selected ${styleId} ruleset`,
        { screen: "findMatch", ruleset: styleId, mode: "online" }
      );
    });
  };

  const handleCreate = () => {
    if (busy || own?.status === "open" || own?.status === "accepted") return;
    tap(async () => {
      setBusy("creating");
      setErrorKey("");
      try {
        if (lockedStakePips) {
          const joined = await joinOrCreatePublicMatchRequest(selectedId, lockedStakePips);
          if (joined.outcome === "accepted" && joined.match) {
            if (!applyMatched(joined.match)) {
              setState("list");
              return;
            }
            setState("matched");
            addSafeBreadcrumb("joined match via join_or_create", {
              screen: "findMatch",
              mode: "online",
              ruleset: selectedId,
              matchId: joined.match?.id,
            });
            markEnteredOnline(joined.match?.id);
            return;
          }
          const created = withSessionIdentity(joined.request, session);
          setOwn(created);
          ownStatusRef.current = created?.status ?? "open";
          ownOpenIdRef.current = created?.id ?? null;
          setNotice("");
          addSafeBreadcrumb("created match request", {
            screen: "findMatch",
            mode: "online",
            ruleset: selectedId,
          });
          await refresh();
          return;
        }
        const created = await createMatchRequest(selectedId);
        setOwn(withSessionIdentity(created, session));
        ownStatusRef.current = "open";
        ownOpenIdRef.current = created.id;
        setNotice("");
        addSafeBreadcrumb("created match request", {
          screen: "findMatch",
          mode: "online",
          ruleset: selectedId,
        });
        await refresh();
      } catch (error) {
        setErrorKey(
          error?.code === "PLAYER_BUSY" ? "findMatch.alreadyInMatch" : errorMessageKey(error)
        );
      } finally {
        setBusy("");
      }
    });
  };

  /** Temporary owner gesture: 5 quick taps on the Find Match title → copy read-only diag. */
  const handleDiagTitleTap = () => {
    const next = noteFindMatchDiagTitleTap(titleTapRef.current, Date.now());
    titleTapRef.current = next;
    if (!next.armed || diagBusyRef.current) return;
    diagBusyRef.current = true;
    setDiagStatus("busy");
    const lobbyStyle = lockedId || selectedId;
    const lobbyKey =
      lockedStakePips != null && lobbyStyle ? `${lobbyStyle}-${lockedStakePips}` : null;
    const renderedRequestIds = [
      ...document.querySelectorAll("[data-find-match-request]"),
    ].map((el) => el.getAttribute("data-find-match-request"));
    void buildFindMatchDiagSnapshot({
      playerId,
      displayName: session?.displayName || session?.username || null,
      styleId: lobbyStyle,
      lockedStakePips,
      lobbyKey,
      boardSource,
      uiState: matched ? "matched" : state,
      own,
      mergedBoard: open,
      renderedRequestIds,
      lastRefreshReason: lastRefreshReasonRef.current,
    })
      .then((snapshot) => exportFindMatchDiag(snapshot))
      .then((result) => {
        setDiagStatus(result.ok ? "copied" : "manual");
        if (!result.ok && result.text && typeof window !== "undefined") {
          window.prompt("LeoDomino Find Match diag — copy:", result.text);
        }
      })
      .catch(() => {
        setDiagStatus("failed");
      })
      .finally(() => {
        diagBusyRef.current = false;
        titleTapRef.current = { count: 0, firstAt: 0 };
        window.setTimeout(() => setDiagStatus(""), 4000);
      });
  };

  const handleAccept = (request) => {
    if (!canAcceptMatchRequest(request, playerId) || busy) return;
    tap(async () => {
      setBusy("accepting");
      setBusyId(request.id);
      setErrorKey("");
      try {
        const match = await acceptMatchRequest(request.id, {
          playerId,
          creatorId: request.creatorId,
          ...(lockedStakePips
            ? { styleId: selectedId, stakePips: lockedStakePips }
            : {}),
        });
        if (!applyMatched(match)) {
          setState("list");
          return;
        }
        setState("matched");
        addSafeBreadcrumb("accepted request", {
          screen: "findMatch",
          mode: "online",
          matchId: match?.id,
        });
        markEnteredOnline(match?.id);
      } catch (error) {
        const key = errorMessageKey(error);
        if (isStaleMatchAcceptError(error)) {
          setOpen((prev) => prev.filter((row) => row.id !== request.id));
          setMatched(null);
          matchedRef.current = null;
        }
        await refresh();
        setErrorKey(key);
      } finally {
        setBusy("");
        setBusyId("");
      }
    });
  };

  const handleCancel = (request) => {
    if (!isOwnMatchRequest(request, playerId) || busy) return;
    tap(async () => {
      setBusy("cancelling");
      setBusyId(request.id);
      setErrorKey("");
      try {
        await cancelMatchRequest(request.id);
        setNotice("cancelled");
        setOwn(null);
        ownStatusRef.current = null;
        ownOpenIdRef.current = null;
        await refresh();
      } catch (error) {
        setErrorKey(errorMessageKey(error));
      } finally {
        setBusy("");
        setBusyId("");
      }
    });
  };

  const handleEnterTable = () => {
    if (!canRecoverMatch(matched) || busy) return;
    tap(() => {
      addSafeBreadcrumb("enter live table", {
        screen: "findMatch",
        mode: "online",
        matchId: matched.id,
        ruleset: matched.rulesetId,
      });
      onEnterMatch?.({
        matchId: matched.id,
        rulesetId: matched.rulesetId,
        host: matched.host || own?.creator,
        opponent: matched.opponent,
      });
    });
  };

  const cancelOwnOpenBestEffort = () => {
    const id = ownOpenIdRef.current;
    if (!id) return;
    ownOpenIdRef.current = null;
    void cancelMatchRequest(id).catch(() => {});
  };

  const handleBack = () =>
    tap(() => {
      cancelOwnOpenBestEffort();
      onBack?.();
    });
  const handleMainMenu = () =>
    tap(() => {
      cancelOwnOpenBestEffort();
      onMainMenu?.();
    });

  const lobbyStyle = lockedId || selectedId;
  const isLeoPipsLobby = lockedStakePips != null || Boolean(lockedId);
  // Keep YOUR REQUEST visible through live "accepted" until Match Ready hydrates.
  // Stale accepted→finished is filtered out by getOwnLatestRequest (own is null).
  const liveAcceptedPending =
    own?.status === "accepted" && Boolean(own?.matchId) && !matched;
  const ownOpen =
    (own?.status === "open" || liveAcceptedPending) &&
    (!isLeoPipsLobby ||
      own?.status !== "open" ||
      requestMatchesFindMatchLobby(own, lobbyStyle, lockedStakePips));
  const visibleOpen = isLeoPipsLobby
    ? boardSource === "lobby-rpc" && lockedStakePips
      ? visibleFindMatchLobbyRequests(open, own, lobbyStyle, lockedStakePips)
      : []
    : visibleFindMatchRequests(open, own);
  const screenState = matched ? "matched" : state;
  const createDisabled = Boolean(busy) || ownOpen || !selectedId;

  return (
    <main
      className="find-match"
      data-find-match="true"
      data-find-match-state={screenState}
      data-find-match-busy={busy || undefined}
      data-find-match-style-picker={lockedId ? "hidden" : "visible"}
      data-find-match-locked-style={lockedId || undefined}
      data-find-match-lobby={
        isLeoPipsLobby && lockedStakePips ? `${lobbyStyle}-${lockedStakePips}` : undefined
      }
      data-find-match-diag={diagStatus || undefined}
      aria-label={t("findMatch.screenAria")}
    >
      <div className="find-match__atmosphere" aria-hidden="true">
        <div className="find-match__wood" />
        <div className="find-match__vignette" />
      </div>

      <div className="find-match__shell">
        <header className="find-match__header">
          <button type="button" className="find-match__back" onClick={handleBack} aria-label={t("common.back")}>
            <span className="find-match__back-chevron" aria-hidden="true" />
            <span className="find-match__back-label">{t("common.back")}</span>
          </button>
          <h1
            className="find-match__title find-match__diag"
            data-find-match-diag-trigger="title-tap-5"
            onClick={handleDiagTitleTap}
          >
            {t("findMatch.title")}
          </h1>
          <button
            type="button"
            className="find-match__menu"
            onClick={handleMainMenu}
            aria-label={t("common.mainMenu")}
          >
            <IconHome />
            <span className="find-match__menu-label">{t("common.mainMenu")}</span>
          </button>
        </header>

        {screenState === "matched" && matched ? (
          <section className="find-match__panel find-match__panel--ready" data-find-match-ready="true">
            <p className="find-match__kicker">{t("findMatch.matchReady")}</p>
            <p className="find-match__hint">{t("findMatch.matchReadyHint")}</p>
            <p className="find-match__match-id">
              {t("findMatch.matchId", { id: String(matched.id || "").slice(0, 8) })}
            </p>
            <p className="find-match__style-lock" data-find-match-ruleset={matched.rulesetId}>
              {t(styleNameKey(matched.styleId))}
              {matched.stakePips != null ? (
                <span data-find-match-stake={matched.stakePips}>
                  {t("findMatch.stakePips", { n: matched.stakePips })}
                </span>
              ) : lockedStakePips ? (
                <span data-find-match-stake={lockedStakePips}>
                  {t("findMatch.stakePips", { n: lockedStakePips })}
                </span>
              ) : null}
              <span>{t("findMatch.styleLocked")}</span>
            </p>
            <Identity person={matched.host || own?.creator} label={t("findMatch.host")} />
            <Identity
              person={matched.opponent}
              label={t("findMatch.opponent")}
              you={matched.opponent?.playerId === playerId}
            />
            {matched.opponent?.playerId && matched.opponent.playerId !== playerId ? (
              <div data-find-match-friend={matched.opponent.playerId}>
                <FriendButton
                  relation={friends.relationFor(matched.opponent.playerId)}
                  busy={Boolean(friends.busy)}
                  onAdd={() => friends.sendTo(matched.opponent.playerId)}
                  onAccept={() => friends.accept(friends.incomingRequestId(matched.opponent.playerId))}
                  onDecline={() => friends.decline(friends.incomingRequestId(matched.opponent.playerId))}
                  onCancel={() => friends.cancel(friends.outgoingRequestId(matched.opponent.playerId))}
                />
              </div>
            ) : null}
            <button
              type="button"
              className="find-match__primary"
              data-find-match-enter="true"
              onClick={handleEnterTable}
            >
              {t("findMatch.enterTable")}
            </button>
            <button type="button" className="find-match__ghost" onClick={handleBack}>
              {t("findMatch.backHome")}
            </button>
          </section>
        ) : liveAcceptedPending ? (
          <section
            className="find-match__panel find-match__panel--ready"
            data-find-match-accepted-pending="true"
          >
            <p className="find-match__kicker">{t("findMatch.waiting")}</p>
            <p className="find-match__hint">{t("findMatch.matchReadyHint")}</p>
            {own.matchId ? (
              <p className="find-match__match-id">
                {t("findMatch.matchId", { id: String(own.matchId).slice(0, 8) })}
              </p>
            ) : null}
          </section>
        ) : (
          <>
            <p className="find-match__hint">{t("findMatch.hint")}</p>

            {screenState === "unavailable" ? (
              <section className="find-match__panel find-match__status" data-find-match-unavailable="true">
                <p>{t("findMatch.unavailable")}</p>
                <button type="button" className="find-match__primary" onClick={handleBack}>
                  {t("findMatch.backHome")}
                </button>
              </section>
            ) : (
              <>
                <p className="find-match__fair-play" data-find-match-fair-play="true">
                  <span className="find-match__fair-play-icon" aria-hidden="true">
                    ⓘ
                  </span>
                  <span>
                    <strong>{t("findMatch.fairPlayTitle")}</strong>
                    <br />
                    {t("findMatch.fairPlayRule")}
                  </span>
                </p>
                <section
                  className="find-match__panel"
                  aria-label={t("findMatch.chooseStyle")}
                  data-find-match-choose-style={lockedId ? "bypassed" : "visible"}
                >
                  {lockedId ? (
                    <p className="find-match__style-lock" data-find-match-style-lock="preselected">
                      {t(styleNameKey(selectedId))}
                      {lockedStakePips ? (
                        <span data-find-match-stake={lockedStakePips}>
                          {t("findMatch.stakePips", { n: lockedStakePips })}
                        </span>
                      ) : null}
                    </p>
                  ) : (
                    <>
                      <h2 className="find-match__section-title">{t("findMatch.chooseStyle")}</h2>
                      <div className="find-match__styles" role="listbox" aria-label={t("findMatch.chooseStyle")}>
                        {GAME_STYLES.map((style) => {
                          const selected = style.id === selectedId;
                          const flagImg = gameStyleFlagDataUrl(style);
                          const flag = gameStyleFlagEmoji(style);
                          return (
                            <button
                              key={style.id}
                              type="button"
                              role="option"
                              data-find-match-style={style.id}
                              className={`find-match__style${selected ? " find-match__style--on" : ""}`}
                              aria-selected={selected}
                              onClick={() => handleSelect(style.id)}
                            >
                              {flagImg ? (
                                <img className="find-match__style-flag" src={flagImg} alt="" draggable={false} />
                              ) : flag ? (
                                <span className="find-match__style-flag" aria-hidden="true">
                                  {flag}
                                </span>
                              ) : null}
                              <span>{t(style.nameKey)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                  <button
                    type="button"
                    className="find-match__primary"
                    data-find-match-create="true"
                    disabled={createDisabled}
                    onClick={handleCreate}
                  >
                    {busy === "creating" ? t("findMatch.creating") : t("findMatch.createRequest")}
                  </button>
                  {ownOpen ? <p className="find-match__note">{t("findMatch.alreadyOpen")}</p> : null}
                </section>

                <section className="find-match__panel" aria-label={t("findMatch.openRequests")}>
                  <h2 className="find-match__section-title">{t("findMatch.openRequests")}</h2>
                  {errorKey ? (
                    <div className="find-match__status find-match__status--error">
                      <p>{t(errorKey)}</p>
                      <button type="button" className="find-match__ghost" onClick={() => tap(refresh)}>
                        {t("findMatch.retry")}
                      </button>
                    </div>
                  ) : null}
                  {notice === "cancelled" ? (
                    <p className="find-match__note" data-find-match-notice="cancelled">
                      {t("findMatch.statusCancelled")}
                    </p>
                  ) : null}
                  {screenState === "loading" ? <p className="find-match__note">{t("findMatch.loading")}</p> : null}
                  {screenState === "empty" && !ownOpen ? (
                    <p className="find-match__note">{t("findMatch.empty")}</p>
                  ) : null}
                  <ul className="find-match__list">
                    {visibleOpen.map((request) => {
                      const mine = isOwnMatchRequest(request, playerId);
                      const lobbyOk = isLeoPipsLobby
                        ? requestMatchesFindMatchLobby(request, lobbyStyle, lockedStakePips)
                        : request.visibility !== "friend";
                      const canAccept =
                        canAcceptMatchRequest(request, playerId) && lobbyOk;
                      const accepting = busy === "accepting" && busyId === request.id;
                      const cancelling = busy === "cancelling" && busyId === request.id;
                      return (
                        <li
                          key={request.id}
                          className={`find-match__card${mine ? " find-match__card--mine" : ""}`}
                          data-find-match-request={request.id}
                          data-find-match-own={mine ? "true" : "false"}
                          data-find-match-ruleset={request.rulesetId}
                          data-find-match-visibility={request.visibility || "public"}
                          data-find-match-stake={
                            request.visibility !== "friend" && request.stakePips != null
                              ? request.stakePips
                              : undefined
                          }
                        >
                          <Identity person={request.creator} you={mine} />
                          {!mine ? (
                            <div data-find-match-friend={request.creatorId}>
                              <FriendButton
                                compact
                                relation={friends.relationFor(request.creatorId)}
                                busy={Boolean(friends.busy)}
                                onAdd={() => friends.sendTo(request.creatorId)}
                                onAccept={() => friends.accept(friends.incomingRequestId(request.creatorId))}
                                onDecline={() => friends.decline(friends.incomingRequestId(request.creatorId))}
                                onCancel={() => friends.cancel(friends.outgoingRequestId(request.creatorId))}
                              />
                            </div>
                          ) : null}
                          <div className="find-match__card-meta">
                            <span className="find-match__pill">{t(styleNameKey(request.styleId))}</span>
                            {request.visibility !== "friend" && request.stakePips != null ? (
                              <span className="find-match__pill" data-find-match-stake={request.stakePips}>
                                {t("findMatch.stakePips", { n: request.stakePips })}
                              </span>
                            ) : null}
                            <span className="find-match__pill find-match__pill--open">
                              {mine ? t("findMatch.waiting") : t("findMatch.statusOpen")}
                            </span>
                            {mine ? <span className="find-match__pill">{t("findMatch.yours")}</span> : null}
                          </div>
                          {mine ? (
                            <button
                              type="button"
                              className="find-match__ghost"
                              data-find-match-cancel="true"
                              disabled={Boolean(busy)}
                              onClick={() => handleCancel(request)}
                            >
                              {cancelling ? t("findMatch.cancelling") : t("findMatch.cancelRequest")}
                            </button>
                          ) : canAccept ? (
                            <button
                              type="button"
                              className="find-match__accept"
                              data-find-match-accept="true"
                              disabled={Boolean(busy)}
                              onClick={() => handleAccept(request)}
                            >
                              {accepting ? t("findMatch.accepting") : t("findMatch.accept")}
                            </button>
                          ) : (
                            <p className="find-match__note">{t("findMatch.cannotAcceptOwn")}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

export default FindMatchPage;
