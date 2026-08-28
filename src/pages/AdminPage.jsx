import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { resolvePlayerAvatar } from "../auth/avatars.media.js";
import { IconClose } from "../components/Icon";
import { gameStyleForRulesetId } from "../game/rulesets/registry.js";
import {
  ADMIN_ERROR,
  ADMIN_LIVE_POLL_MS,
  ADMIN_PAGE_SIZE,
  fetchAdminLiveMatches,
  fetchAdminOverview,
  fetchAdminPlayerRpHistory,
  fetchAdminTopRp,
  fetchAdminUsers,
  liveMatchStatusKey,
  overviewCardsFromPayload,
  probeAmIStaff,
} from "../online/adminDashboard.js";
import AdminSpectatorView from "./AdminSpectatorView.jsx";
import "./AdminPage.css";

const NAV = Object.freeze(["overview", "users", "liveMatches", "globalRp"]);

function errorMessageKey(error) {
  if (error?.code === ADMIN_ERROR.AUTH) return "admin.signInRequired";
  if (error?.code === ADMIN_ERROR.FORBIDDEN) return "admin.accessDeniedBody";
  if (error?.code === ADMIN_ERROR.UNAVAILABLE) return "admin.unavailable";
  return "admin.loadError";
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
  const [rpOffset, setRpOffset] = useState(0);
  const [rpPage, setRpPage] = useState({ players: [], total: 0, limit: ADMIN_PAGE_SIZE, offset: 0 });
  const [rpError, setRpError] = useState("");
  const [rpLoading, setRpLoading] = useState(false);
  const [rpSelected, setRpSelected] = useState(null);
  const [rpHistory, setRpHistory] = useState({ events: [], total: 0, limit: ADMIN_PAGE_SIZE, offset: 0 });
  const [rpHistoryError, setRpHistoryError] = useState("");
  const [rpHistoryLoading, setRpHistoryLoading] = useState(false);
  const [rpHistoryOffset, setRpHistoryOffset] = useState(0);

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

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError("");
    try {
      setOverview(await fetchAdminOverview());
    } catch (error) {
      setOverview(null);
      setOverviewError(errorMessageKey(error));
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async (query) => {
    setUsersLoading(true);
    setUsersError("");
    try {
      const page = await fetchAdminUsers(query);
      setUserPage(page);
    } catch (error) {
      setUserPage({ users: [], total: 0, limit: ADMIN_PAGE_SIZE, offset: query.offset || 0 });
      setUsersError(errorMessageKey(error));
    } finally {
      setUsersLoading(false);
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

  const loadTopRp = useCallback(async (query) => {
    setRpLoading(true);
    setRpError("");
    try {
      setRpPage(await fetchAdminTopRp(query));
    } catch (error) {
      setRpPage({ players: [], total: 0, limit: ADMIN_PAGE_SIZE, offset: query.offset || 0 });
      setRpError(errorMessageKey(error));
    } finally {
      setRpLoading(false);
    }
  }, []);

  const loadRpHistory = useCallback(async (playerId, query) => {
    setRpHistoryLoading(true);
    setRpHistoryError("");
    try {
      const page = await fetchAdminPlayerRpHistory(playerId, query);
      setRpHistory(page);
      if (page.player) setRpSelected(page.player);
    } catch (error) {
      setRpHistory({ events: [], total: 0, limit: ADMIN_PAGE_SIZE, offset: query.offset || 0 });
      setRpHistoryError(errorMessageKey(error));
    } finally {
      setRpHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (gate !== "ok" || section !== "overview") return undefined;
    void loadOverview();
    return undefined;
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
    return undefined;
  }, [gate, section, search, offset, loadUsers]);

  useEffect(() => {
    if (gate !== "ok" || section !== "liveMatches") return undefined;
    void loadLiveMatches({ offset: liveOffset, limit: ADMIN_PAGE_SIZE });
    const handle = window.setInterval(() => {
      void loadLiveMatches({ offset: liveOffset, limit: ADMIN_PAGE_SIZE }, true);
    }, ADMIN_LIVE_POLL_MS);
    return () => window.clearInterval(handle);
  }, [gate, section, liveOffset, loadLiveMatches]);

  useEffect(() => {
    if (gate !== "ok" || section !== "globalRp") return undefined;
    void loadTopRp({ offset: rpOffset, limit: ADMIN_PAGE_SIZE });
    return undefined;
  }, [gate, section, rpOffset, loadTopRp]);

  useEffect(() => {
    if (gate !== "ok" || !rpSelected?.playerId) return undefined;
    void loadRpHistory(rpSelected.playerId, { offset: rpHistoryOffset, limit: ADMIN_PAGE_SIZE });
    return undefined;
  }, [gate, rpSelected?.playerId, rpHistoryOffset, loadRpHistory]);

  const cards = useMemo(() => overviewCardsFromPayload(overview), [overview]);
  const pageCount = Math.max(1, Math.ceil((userPage.total || 0) / (userPage.limit || ADMIN_PAGE_SIZE)));
  const pageNumber = Math.floor((userPage.offset || 0) / (userPage.limit || ADMIN_PAGE_SIZE)) + 1;
  const canPrev = (userPage.offset || 0) > 0;
  const canNext = (userPage.offset || 0) + userPage.users.length < (userPage.total || 0);
  const livePageCount = Math.max(1, Math.ceil((livePage.total || 0) / (livePage.limit || ADMIN_PAGE_SIZE)));
  const livePageNumber = Math.floor((livePage.offset || 0) / (livePage.limit || ADMIN_PAGE_SIZE)) + 1;
  const liveCanPrev = (livePage.offset || 0) > 0;
  const liveCanNext = (livePage.offset || 0) + livePage.matches.length < (livePage.total || 0);
  const rpPageCount = Math.max(1, Math.ceil((rpPage.total || 0) / (rpPage.limit || ADMIN_PAGE_SIZE)));
  const rpPageNumber = Math.floor((rpPage.offset || 0) / (rpPage.limit || ADMIN_PAGE_SIZE)) + 1;
  const rpCanPrev = (rpPage.offset || 0) > 0;
  const rpCanNext = (rpPage.offset || 0) + rpPage.players.length < (rpPage.total || 0);
  const rpHistoryPageCount = Math.max(1, Math.ceil((rpHistory.total || 0) / (rpHistory.limit || ADMIN_PAGE_SIZE)));
  const rpHistoryPageNumber = Math.floor((rpHistory.offset || 0) / (rpHistory.limit || ADMIN_PAGE_SIZE)) + 1;
  const rpHistoryCanPrev = (rpHistory.offset || 0) > 0;
  const rpHistoryCanNext = (rpHistory.offset || 0) + rpHistory.events.length < (rpHistory.total || 0);

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

  const finishReasonLabel = (reason) => {
    if (reason === "forfeit") return t("admin.finishForfeit");
    if (reason === "completed") return t("admin.finishCompleted");
    return reason || "—";
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
                    setRpSelected(null);
                  }}
                >
                  {t(`admin.${id}`)}
                </button>
              ))}
            </nav>
          </aside>

          <section className="admin-page__main" data-admin-section={section}>
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
                {!overviewError && !overviewLoading && cards.length === 0 ? (
                  <p className="admin-page__empty">{t("admin.unavailable")}</p>
                ) : null}
                <div className="admin-page__cards">
                  {cards.map((card) => {
                    const unavailable = Boolean(card.unsupported || card.value == null);
                    return (
                      <article
                        key={card.id}
                        className={`admin-page__card${unavailable ? " is-unavailable" : ""}`}
                        data-admin-card={card.id}
                        data-admin-card-unavailable={unavailable ? "true" : "false"}
                      >
                        <p className="admin-page__card-label">{t(`admin.${card.id}`)}</p>
                        <p className={`admin-page__card-value${unavailable ? " is-unavailable" : ""}`}>
                          {unavailable ? t("admin.metricUnavailable") : formatNumber(card.value)}
                        </p>
                      </article>
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
                <div className="admin-page__table-wrap">
                  <table className="admin-page__table">
                    <thead>
                      <tr>
                        <th>{t("admin.username")}</th>
                        <th>{t("admin.displayName")}</th>
                        <th>{t("admin.country")}</th>
                        <th>{t("admin.rp")}</th>
                        <th>{t("admin.wins")}</th>
                        <th>{t("admin.losses")}</th>
                        <th>{t("admin.ratedMatches")}</th>
                        <th>{t("admin.created")}</th>
                        <th>{t("admin.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userPage.users.map((user) => (
                        <tr
                          key={user.playerId}
                          data-admin-user={user.playerId}
                          onClick={() => setSelected(user)}
                        >
                          <td>{user.username || "—"}</td>
                          <td>{user.displayName || "—"}</td>
                          <td>{user.countryCode || "—"}</td>
                          <td>{formatNumber(user.rp)}</td>
                          <td>{formatNumber(user.wins)}</td>
                          <td>{formatNumber(user.losses)}</td>
                          <td>{formatNumber(user.matchesPlayed)}</td>
                          <td>{formatWhen(user.createdAt)}</td>
                          <td>
                            <span
                              className={`admin-page__pill${user.deletedAt ? " is-deleted" : user.inActiveMatch ? " is-live" : " is-ok"}`}
                            >
                              {user.deletedAt
                                ? t("admin.deleted")
                                : user.inActiveMatch
                                  ? t("admin.inMatch")
                                  : t("admin.active")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!usersLoading && !usersError && userPage.users.length === 0 ? (
                  <p className="admin-page__empty">{t("admin.noUsers")}</p>
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
                {liveError ? (
                  <p className="admin-page__error" role="alert">
                    {t(liveError)}
                  </p>
                ) : null}
                {!liveLoading && !liveError && livePage.matches.length === 0 ? (
                  <p className="admin-page__empty" data-admin-live-empty="true">
                    {t("admin.noLiveMatches")}
                  </p>
                ) : null}
                <div className="admin-page__match-list">
                  {livePage.matches.map((match) => (
                    <article
                      key={match.matchId}
                      className="admin-page__match"
                      data-admin-live-match={match.matchId}
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
                          <dt>{t("admin.rp")}</dt>
                          <dd>
                            {formatNumber(match.playerA.rp)} / {formatNumber(match.playerB.rp)}
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
                  ))}
                </div>
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

            {section === "globalRp" ? (
              <div data-admin-top-rp="true">
                <header className="admin-page__header">
                  <h2>{t("admin.globalRp")}</h2>
                  <button
                    type="button"
                    className="admin-page__btn admin-page__btn--ghost"
                    disabled={rpLoading}
                    onClick={() => void loadTopRp({ offset: rpOffset, limit: ADMIN_PAGE_SIZE })}
                  >
                    {t("admin.retry")}
                  </button>
                </header>
                {rpError ? (
                  <p className="admin-page__error" role="alert">
                    {t(rpError)}
                  </p>
                ) : null}
                {rpLoading && rpPage.players.length === 0 ? (
                  <p className="admin-page__empty" data-admin-top-rp-loading="true">
                    {t("admin.loading")}
                  </p>
                ) : null}
                <div className="admin-page__table-wrap">
                  <table className="admin-page__table">
                    <thead>
                      <tr>
                        <th>{t("admin.rank")}</th>
                        <th>{t("admin.displayName")}</th>
                        <th>{t("admin.username")}</th>
                        <th>{t("admin.rp")}</th>
                        <th>{t("admin.wins")}</th>
                        <th>{t("admin.losses")}</th>
                        <th>{t("admin.ratedMatches")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rpPage.players.map((player) => (
                        <tr
                          key={player.playerId}
                          data-admin-top-rp-player={player.playerId}
                          onClick={() => {
                            setRpHistoryOffset(0);
                            setRpSelected(player);
                          }}
                        >
                          <td>{player.rank == null ? "—" : formatNumber(player.rank)}</td>
                          <td>{player.displayName || "—"}</td>
                          <td>{player.username || "—"}</td>
                          <td>{formatNumber(player.rp)}</td>
                          <td>{formatNumber(player.wins)}</td>
                          <td>{formatNumber(player.losses)}</td>
                          <td>{formatNumber(player.matchesPlayed)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!rpLoading && !rpError && rpPage.players.length === 0 ? (
                  <p className="admin-page__empty" data-admin-top-rp-empty="true">
                    {t("admin.noTopRp")}
                  </p>
                ) : null}
                <div className="admin-page__pager" data-admin-top-rp-page="true">
                  <button
                    type="button"
                    className="admin-page__btn admin-page__btn--ghost"
                    disabled={!rpCanPrev || rpLoading}
                    onClick={() => setRpOffset(Math.max(0, rpOffset - ADMIN_PAGE_SIZE))}
                  >
                    {t("admin.previous")}
                  </button>
                  <p>
                    {t("admin.pageOf", {
                      page: formatNumber(rpPageNumber),
                      pages: formatNumber(rpPageCount),
                    })}
                  </p>
                  <button
                    type="button"
                    className="admin-page__btn admin-page__btn--ghost"
                    disabled={!rpCanNext || rpLoading}
                    onClick={() => setRpOffset(rpOffset + ADMIN_PAGE_SIZE)}
                  >
                    {t("admin.next")}
                  </button>
                </div>
              </div>
            ) : null}
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
            <div className="admin-page__drawer-hero">
              <img
                src={resolvePlayerAvatar(selected.avatarId)}
                alt=""
                width={72}
                height={72}
              />
              <div>
                <p className="admin-page__drawer-name">{selected.displayName || "—"}</p>
                <p>{selected.username || "—"}</p>
              </div>
            </div>
            <dl className="admin-page__facts">
              <div>
                <dt>{t("admin.country")}</dt>
                <dd>{selected.countryCode || "—"}</dd>
              </div>
              <div>
                <dt>{t("admin.rp")}</dt>
                <dd>{formatNumber(selected.rp)}</dd>
              </div>
              <div>
                <dt>{t("admin.wins")}</dt>
                <dd>{formatNumber(selected.wins)}</dd>
              </div>
              <div>
                <dt>{t("admin.losses")}</dt>
                <dd>{formatNumber(selected.losses)}</dd>
              </div>
              <div>
                <dt>{t("admin.ratedMatches")}</dt>
                <dd>{formatNumber(selected.matchesPlayed)}</dd>
              </div>
              <div>
                <dt>{t("admin.created")}</dt>
                <dd>{formatWhen(selected.createdAt)}</dd>
              </div>
              <div>
                <dt>{t("admin.status")}</dt>
                <dd>
                  {selected.deletedAt
                    ? t("admin.deleted")
                    : selected.inActiveMatch
                      ? t("admin.inMatch")
                      : t("admin.active")}
                </dd>
              </div>
            </dl>
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
            <div className="admin-page__drawer-hero admin-page__drawer-hero--pair">
              <div>
                <img src={resolvePlayerAvatar(liveSelected.playerA.avatarId)} alt="" width={56} height={56} />
                <p className="admin-page__drawer-name">{playerLabel(liveSelected.playerA)}</p>
                <p>{liveSelected.playerA.username || "—"}</p>
              </div>
              <div>
                <img src={resolvePlayerAvatar(liveSelected.playerB.avatarId)} alt="" width={56} height={56} />
                <p className="admin-page__drawer-name">{playerLabel(liveSelected.playerB)}</p>
                <p>{liveSelected.playerB.username || "—"}</p>
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
                <dd>
                  {liveSelected.matchKind === "friend" ? t("admin.matchKindFriend") : t("admin.matchKindPublic")}
                </dd>
              </div>
              <div>
                <dt>{t("admin.rp")}</dt>
                <dd>
                  {formatNumber(liveSelected.playerA.rp)} / {formatNumber(liveSelected.playerB.rp)}
                </dd>
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
      {gate === "ok" && rpSelected ? (
        <div className="admin-page__drawer-wrap">
          <button
            type="button"
            className="admin-page__drawer-backdrop"
            aria-label={t("admin.closeDetail")}
            onClick={() => setRpSelected(null)}
          />
          <aside className="admin-page__drawer" data-admin-rp-detail="true" aria-label={t("admin.rankedActivity")}>
            <header className="admin-page__drawer-head">
              <h2>{t("admin.rankedActivity")}</h2>
              <button type="button" className="admin-page__icon-btn" onClick={() => setRpSelected(null)}>
                <IconClose />
                <span className="sr-only">{t("admin.closeDetail")}</span>
              </button>
            </header>
            <div className="admin-page__drawer-hero">
              <img src={resolvePlayerAvatar(rpSelected.avatarId)} alt="" width={72} height={72} />
              <div>
                <p className="admin-page__drawer-name">{rpSelected.displayName || "—"}</p>
                <p>{rpSelected.username || "—"}</p>
              </div>
            </div>
            <dl className="admin-page__facts">
              <div>
                <dt>{t("admin.rank")}</dt>
                <dd>{rpSelected.rank == null ? "—" : formatNumber(rpSelected.rank)}</dd>
              </div>
              <div>
                <dt>{t("admin.rp")}</dt>
                <dd>{formatNumber(rpSelected.rp)}</dd>
              </div>
              <div>
                <dt>{t("admin.wins")}</dt>
                <dd>{formatNumber(rpSelected.wins)}</dd>
              </div>
              <div>
                <dt>{t("admin.losses")}</dt>
                <dd>{formatNumber(rpSelected.losses)}</dd>
              </div>
              <div>
                <dt>{t("admin.ratedMatches")}</dt>
                <dd>{formatNumber(rpSelected.matchesPlayed)}</dd>
              </div>
              <div>
                <dt>{t("admin.playerId")}</dt>
                <dd className="admin-page__mono">{rpSelected.playerId}</dd>
              </div>
            </dl>
            {rpHistoryError ? (
              <p className="admin-page__error" role="alert">
                {t(rpHistoryError)}
              </p>
            ) : null}
            {rpHistoryLoading && rpHistory.events.length === 0 ? (
              <p className="admin-page__empty" data-admin-rp-history-loading="true">
                {t("admin.loading")}
              </p>
            ) : null}
            {!rpHistoryLoading && !rpHistoryError && rpHistory.events.length === 0 ? (
              <p className="admin-page__empty" data-admin-rp-history-empty="true">
                {t("admin.noRpHistory")}
              </p>
            ) : null}
            <ol className="admin-page__rp-history" data-admin-rp-history="true">
              {rpHistory.events.map((event) => (
                <li
                  key={event.matchId}
                  className="admin-page__rp-event"
                  data-admin-rp-event={event.matchId}
                  data-admin-rp-result={event.result}
                >
                  <div className="admin-page__rp-event-top">
                    <span className={`admin-page__pill ${event.result === "win" ? "is-ok" : "is-deleted"}`}>
                      {event.result === "win" ? t("admin.rpWin") : t("admin.rpLoss")}
                    </span>
                    <time dateTime={event.settledAt} data-admin-rp-settled-at={event.settledAt}>
                      {formatWhen(event.settledAt)}
                    </time>
                  </div>
                  <p className="admin-page__rp-event-vs">
                    {t("admin.vs")} {playerLabel(event.opponent)}
                  </p>
                  <dl className="admin-page__rp-event-facts">
                    <div>
                      <dt>{t("admin.rpBefore")}</dt>
                      <dd>{formatNumber(event.rpBefore)}</dd>
                    </div>
                    <div>
                      <dt>{t("admin.rpChange")}</dt>
                      <dd>
                        {event.rpDelta > 0 ? "+" : ""}
                        {formatNumber(event.rpDelta)}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("admin.rpAfter")}</dt>
                      <dd>{formatNumber(event.rpAfter)}</dd>
                    </div>
                    <div>
                      <dt>{t("admin.style")}</dt>
                      <dd>{styleLabel(event.rulesetId)}</dd>
                    </div>
                    <div>
                      <dt>{t("admin.matchType")}</dt>
                      <dd>{event.rated ? t("admin.rated") : t("admin.unrated")}</dd>
                    </div>
                    <div>
                      <dt>{t("admin.matchKind")}</dt>
                      <dd>
                        {event.matchKind === "friend" ? t("admin.matchKindFriend") : t("admin.matchKindPublic")}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("admin.finishReason")}</dt>
                      <dd>{finishReasonLabel(event.finishReason)}</dd>
                    </div>
                    <div>
                      <dt>{t("admin.matchId")}</dt>
                      <dd className="admin-page__mono">{event.matchId}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ol>
            <div className="admin-page__pager" data-admin-rp-history-page="true">
              <button
                type="button"
                className="admin-page__btn admin-page__btn--ghost"
                disabled={!rpHistoryCanPrev || rpHistoryLoading}
                onClick={() => setRpHistoryOffset(Math.max(0, rpHistoryOffset - ADMIN_PAGE_SIZE))}
              >
                {t("admin.previous")}
              </button>
              <p>
                {t("admin.pageOf", {
                  page: formatNumber(rpHistoryPageNumber),
                  pages: formatNumber(rpHistoryPageCount),
                })}
              </p>
              <button
                type="button"
                className="admin-page__btn admin-page__btn--ghost"
                disabled={!rpHistoryCanNext || rpHistoryLoading}
                onClick={() => setRpHistoryOffset(rpHistoryOffset + ADMIN_PAGE_SIZE)}
              >
                {t("admin.next")}
              </button>
            </div>
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
    </main>
  );
}

export default AdminPage;
