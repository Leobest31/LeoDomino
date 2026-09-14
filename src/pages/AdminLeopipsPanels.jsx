import { useCallback, useEffect, useMemo, useState } from "react";
import { ADMIN_PAGE_SIZE, ADMIN_PRESENCE_POLL_MS, adminErrorI18nKey } from "../online/adminDashboard.js";
import {
  adminExpectedPot,
  adminStakeLabel,
  aggregateLeoPipsReferrer,
  hasLeoPipsReferralRewardProof,
  leoPipsReferralIssuedAmount,
  leoPipsReferralStatus,
  leoPipsReferralStatusI18nKey,
  leoPipsRewardI18nKey,
  referralProgressLabel,
  searchLeoPipsReferrals,
  summarizeLeoPipsReferrals,
} from "../online/adminLeopipsOps.js";
import {
  adminHistoryStatusKey,
  fetchAdminLeopipsAnomalies,
  fetchAdminLeopipsOverview,
  fetchAdminLeopipsReferralUniverse,
  fetchAdminMatchLeopips,
  fetchAdminMatches,
  fetchAdminNegativeLeopips,
  fetchAdminOpenMatchRequests,
  fetchAdminStakeActivity,
  fetchAdminTimeoutPenalties,
} from "../online/adminLeopipsReads.js";

function playerLabel(player) {
  return player?.displayName || player?.username || "—";
}

function rangeFor(timeframe) {
  const now = new Date();
  if (timeframe === "today") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return { from: start.toISOString(), to: now.toISOString() };
  }
  const days = timeframe === "30" ? 30 : 7;
  return { from: new Date(now.getTime() - days * 86400000).toISOString(), to: now.toISOString() };
}

function Pager({ page, pageCount, canPrev, canNext, loading, onPrev, onNext, t, formatNumber }) {
  return (
    <div className="admin-page__pager">
      <button type="button" className="admin-page__btn admin-page__btn--ghost" disabled={!canPrev || loading} onClick={onPrev}>
        {t("admin.previous")}
      </button>
      <p>{t("admin.pageOf", { page: formatNumber(page), pages: formatNumber(pageCount) })}</p>
      <button type="button" className="admin-page__btn admin-page__btn--ghost" disabled={!canNext || loading} onClick={onNext}>
        {t("admin.next")}
      </button>
    </div>
  );
}

function MatchHistoryPanel({ t, formatNumber, formatWhen }) {
  const [search, setSearch] = useState("");
  const [rulesetId, setRulesetId] = useState("");
  const [matchKind, setMatchKind] = useState("");
  const [stakeFilter, setStakeFilter] = useState("");
  const [status, setStatus] = useState("");
  const [finishReason, setFinishReason] = useState("");
  const [timeframe, setTimeframe] = useState("30");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState({ matches: [], total: 0, limit: ADMIN_PAGE_SIZE, offset: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const range = rangeFor(timeframe);
      setPage(
        await fetchAdminMatches({
          search,
          rulesetId,
          matchKind,
          stakeFilter,
          status,
          finishReason,
          from: range.from,
          to: range.to,
          offset,
          limit: ADMIN_PAGE_SIZE,
        })
      );
    } catch (err) {
      setPage({ matches: [], total: 0, limit: ADMIN_PAGE_SIZE, offset });
      setError(adminErrorI18nKey(err, "admin.matchHistoryUnavailable"));
    } finally {
      setLoading(false);
    }
  }, [search, rulesetId, matchKind, stakeFilter, status, finishReason, timeframe, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected?.matchId) {
      setDetail(null);
      return undefined;
    }
    let cancelled = false;
    setDetailError("");
    void fetchAdminMatchLeopips(selected.matchId)
      .then((next) => {
        if (!cancelled) setDetail(next);
      })
      .catch((err) => {
        if (!cancelled) setDetailError(adminErrorI18nKey(err, "admin.leopipsUnavailable"));
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.matchId]);

  const pageCount = Math.max(1, Math.ceil((page.total || 0) / (page.limit || ADMIN_PAGE_SIZE)));
  const pageNumber = Math.floor((page.offset || 0) / (page.limit || ADMIN_PAGE_SIZE)) + 1;

  return (
    <div data-admin-match-history="true">
      <header className="admin-page__header">
        <h2>{t("admin.matchHistory")}</h2>
      </header>
      <div className="admin-page__filters">
        <select aria-label={t("admin.style")} value={rulesetId} onChange={(event) => { setOffset(0); setRulesetId(event.target.value); }}>
          <option value="">{t("admin.filterAll")}</option>
          <option value="legacy">{t("setup.gameStyle.classic")}</option>
          <option value="haitian">{t("setup.gameStyle.haitian")}</option>
          <option value="american">{t("setup.gameStyle.american")}</option>
        </select>
        <select aria-label={t("admin.matchKind")} value={matchKind} onChange={(event) => { setOffset(0); setMatchKind(event.target.value); }}>
          <option value="">{t("admin.filterAll")}</option>
          <option value="public">{t("admin.matchKindLeoPipsPublic")}</option>
          <option value="friend">{t("admin.matchKindFriend")}</option>
        </select>
        <select aria-label={t("admin.stake")} value={stakeFilter} onChange={(event) => { setOffset(0); setStakeFilter(event.target.value); }}>
          <option value="">{t("admin.filterAll")}</option>
          <option value="20">20</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="150">150</option>
          <option value="none">{t("admin.stakeNoneFilter")}</option>
        </select>
        <select aria-label={t("admin.status")} value={status} onChange={(event) => { setOffset(0); setStatus(event.target.value); }}>
          <option value="">{t("admin.filterAll")}</option>
          <option value="ready">{t("admin.statusReady")}</option>
          <option value="playing">{t("admin.statusPlaying")}</option>
          <option value="finished">{t("admin.statusFinished")}</option>
          <option value="aborted">{t("admin.statusAborted")}</option>
        </select>
        <select aria-label={t("admin.finishReason")} value={finishReason} onChange={(event) => { setOffset(0); setFinishReason(event.target.value); }}>
          <option value="">{t("admin.filterAll")}</option>
          <option value="completed">{t("admin.finishCompleted")}</option>
          <option value="forfeit">{t("admin.finishForfeit")}</option>
          <option value="timeout">{t("admin.statusTimeout")}</option>
          <option value="join_timeout">{t("admin.statusJoinTimeout")}</option>
          <option value="aborted">{t("admin.statusAborted")}</option>
        </select>
        <select aria-label={t("admin.timeframe")} value={timeframe} onChange={(event) => { setOffset(0); setTimeframe(event.target.value); }}>
          <option value="today">{t("admin.timeframeToday")}</option>
          <option value="7">{t("admin.timeframe7")}</option>
          <option value="30">{t("admin.timeframe30")}</option>
        </select>
      </div>
      <label className="admin-page__search">
        <span className="sr-only">{t("admin.globalSearch")}</span>
        <input
          type="search"
          value={search}
          data-admin-match-search="true"
          placeholder={t("admin.globalSearch")}
          onChange={(event) => {
            setOffset(0);
            setSearch(event.target.value);
          }}
        />
      </label>
      {loading ? <p className="admin-page__hint">{t("admin.loading")}</p> : null}
      {error ? (
        <p className="admin-page__error" role="alert" data-admin-match-history-error="true">
          {t(error)}
        </p>
      ) : null}
      {!loading && !error && page.matches.length === 0 ? (
        <p className="admin-page__empty" data-admin-match-history-empty="true">
          {t("admin.noMatchesFound")}
        </p>
      ) : null}
      <div className="admin-page__table-wrap">
        <table className="admin-page__table">
          <thead>
            <tr>
              <th>{t("admin.matchId")}</th>
              <th>{t("admin.vs")}</th>
              <th>{t("admin.style")}</th>
              <th>{t("admin.matchKind")}</th>
              <th>{t("admin.stake")}</th>
              <th>{t("admin.started")}</th>
              <th>{t("admin.endsAt")}</th>
              <th>{t("admin.status")}</th>
              <th>{t("admin.winner")}</th>
            </tr>
          </thead>
          <tbody>
            {page.matches.map((match) => (
              <tr key={match.matchId} data-admin-history-match={match.matchId} onClick={() => setSelected(match)}>
                <td className="admin-page__mono">{match.matchId}</td>
                <td>
                  {playerLabel(match.playerA)} {t("admin.vs")} {playerLabel(match.playerB)}
                </td>
                <td>{match.rulesetId || "—"}</td>
                <td>{match.matchKind}</td>
                <td data-admin-stake={adminStakeLabel(match.stakePips) || "none"}>{adminStakeLabel(match.stakePips) ?? t("admin.noStake")}</td>
                <td>{formatWhen(match.createdAt)}</td>
                <td>{formatWhen(match.finishedAt)}</td>
                <td>{t(adminHistoryStatusKey(match.status, match.finishReason))}</td>
                <td className="admin-page__mono">{match.winnerPlayerId || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager
        page={pageNumber}
        pageCount={pageCount}
        canPrev={offset > 0}
        canNext={offset + ADMIN_PAGE_SIZE < page.total}
        loading={loading}
        onPrev={() => setOffset(Math.max(0, offset - ADMIN_PAGE_SIZE))}
        onNext={() => setOffset(offset + ADMIN_PAGE_SIZE)}
        t={t}
        formatNumber={formatNumber}
      />
      {selected ? (
        <div className="admin-page__drawer-wrap">
          <button type="button" className="admin-page__drawer-backdrop" aria-label={t("admin.closeDetail")} onClick={() => setSelected(null)} />
          <aside className="admin-page__drawer" data-admin-history-detail="true">
            <header className="admin-page__drawer-head">
              <h2>{t("admin.matchDetail")}</h2>
              <button type="button" className="admin-page__icon-btn" onClick={() => setSelected(null)}>
                {t("admin.closeDetail")}
              </button>
            </header>
            <p className="admin-page__match-id">{selected.matchId}</p>
            <dl className="admin-page__facts">
              <div>
                <dt>{t("admin.stake")}</dt>
                <dd>{adminStakeLabel(selected.stakePips) ?? t("admin.noStake")}</dd>
              </div>
              <div>
                <dt>{t("admin.expectedPot")}</dt>
                <dd>{adminExpectedPot(selected.stakePips) ?? "—"}</dd>
              </div>
              <div>
                <dt>{t("admin.status")}</dt>
                <dd>{t(adminHistoryStatusKey(selected.status, selected.finishReason))}</dd>
              </div>
              <div>
                <dt>{t("admin.winner")}</dt>
                <dd className="admin-page__mono">{selected.winnerPlayerId || "—"}</dd>
              </div>
              <div>
                <dt>{t("admin.loser")}</dt>
                <dd className="admin-page__mono">{selected.loserPlayerId || "—"}</dd>
              </div>
            </dl>
            {detailError ? <p className="admin-page__error" role="alert">{t(detailError)}</p> : null}
            {detail ? (
              <div data-admin-match-leopips="true">
                <h3>{t("admin.leopips")}</h3>
                {(detail.ledger || []).length === 0 ? <p className="admin-page__hint">—</p> : null}
                <ul className="admin-page__rp-history">
                  {(detail.ledger || []).map((line) => (
                    <li key={line.id || `${line.reason}:${line.createdAt}`}>
                      {line.reason} {line.amount} {line.idempotencyKey || ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function LeopipsOpsPanel({ t, formatNumber, formatWhen }) {
  const [overview, setOverview] = useState(null);
  const [overviewError, setOverviewError] = useState("");
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [negatives, setNegatives] = useState({ wallets: [], total: 0 });
  const [negError, setNegError] = useState("");
  const [timeframe, setTimeframe] = useState("7");
  const [stakes, setStakes] = useState(null);
  const [stakeError, setStakeError] = useState("");
  const [penalties, setPenalties] = useState({ penalties: [] });
  const [penError, setPenError] = useState("");
  const [anomalies, setAnomalies] = useState({ anomalies: [] });
  const [anomError, setAnomError] = useState("");

  useEffect(() => {
    setOverviewLoading(true);
    setOverviewError("");
    void fetchAdminLeopipsOverview()
      .then(setOverview)
      .catch((err) => setOverviewError(adminErrorI18nKey(err, "admin.leopipsUnavailable")))
      .finally(() => setOverviewLoading(false));
    void fetchAdminNegativeLeopips()
      .then(setNegatives)
      .catch((err) => setNegError(adminErrorI18nKey(err, "admin.leopipsUnavailable")));
  }, []);

  useEffect(() => {
    const range = rangeFor(timeframe);
    setStakeError("");
    setPenError("");
    setAnomError("");
    void fetchAdminStakeActivity(range)
      .then(setStakes)
      .catch((err) => setStakeError(adminErrorI18nKey(err, "admin.leopipsUnavailable")));
    void fetchAdminTimeoutPenalties({ ...range, limit: ADMIN_PAGE_SIZE })
      .then(setPenalties)
      .catch((err) => setPenError(adminErrorI18nKey(err, "admin.leopipsUnavailable")));
    void fetchAdminLeopipsAnomalies(range)
      .then(setAnomalies)
      .catch((err) => setAnomError(adminErrorI18nKey(err, "admin.leopipsUnavailable")));
  }, [timeframe]);

  return (
    <div data-admin-leopips-ops="true">
      <header className="admin-page__header">
        <h2>{t("admin.leopips")}</h2>
      </header>
      {overviewLoading ? <p className="admin-page__hint">{t("admin.loading")}</p> : null}
      {overviewError ? <p className="admin-page__error" role="alert">{t(overviewError)}</p> : null}
      {overview ? (
        <div className="admin-page__cards" data-admin-leopips-overview="true">
          <article className="admin-page__card">
            <p className="admin-page__card-label">{t("admin.walletsTotal")}</p>
            <p className="admin-page__card-value">{formatNumber(overview.totalWallets)}</p>
          </article>
          <article className="admin-page__card">
            <p className="admin-page__card-label">{t("admin.circulation")}</p>
            <p className="admin-page__card-value">{formatNumber(overview.totalBalance)}</p>
          </article>
          <article className="admin-page__card">
            <p className="admin-page__card-label">{t("admin.negativeWallets")}</p>
            <p className="admin-page__card-value">{formatNumber(overview.negativeWallets)}</p>
          </article>
          <article className="admin-page__card">
            <p className="admin-page__card-label">{t("admin.lowestBalance")}</p>
            <p className="admin-page__card-value">{overview.minBalance == null ? "—" : formatNumber(overview.minBalance)}</p>
          </article>
        </div>
      ) : null}

      <h3>{t("admin.leopipsNegative")}</h3>
      <p className="admin-page__hint">{t("admin.negativeNotError")}</p>
      {negError ? <p className="admin-page__error" role="alert">{t(negError)}</p> : null}
      {!negError && negatives.wallets.length === 0 ? <p className="admin-page__empty">{t("admin.noNegativeWallets")}</p> : null}
      <div className="admin-page__table-wrap" data-admin-negative-wallets="true">
        <table className="admin-page__table">
          <thead>
            <tr>
              <th>{t("admin.displayName")}</th>
              <th>{t("admin.leopipsBalance")}</th>
              <th>{t("admin.ledgerReason")}</th>
              <th>{t("admin.created")}</th>
            </tr>
          </thead>
          <tbody>
            {negatives.wallets.map((row) => (
              <tr key={row.playerId}>
                <td>{row.displayName || row.username || row.playerId}</td>
                <td>{row.balance}</td>
                <td>{row.latestReason || "—"}</td>
                <td>{formatWhen(row.latestCreatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-page__filters">
        <select aria-label={t("admin.timeframe")} value={timeframe} onChange={(event) => setTimeframe(event.target.value)}>
          <option value="today">{t("admin.timeframeToday")}</option>
          <option value="7">{t("admin.timeframe7")}</option>
          <option value="30">{t("admin.timeframe30")}</option>
        </select>
      </div>
      <h3>{t("admin.leopipsStakeActivity")}</h3>
      {stakeError ? <p className="admin-page__error" role="alert">{t(stakeError)}</p> : null}
      {stakes ? (
        <div className="admin-page__cards" data-admin-stake-activity="true">
          {[20, 50, 100, 150].map((stake) => (
            <article key={stake} className="admin-page__card">
              <p className="admin-page__card-label">{stake}</p>
              <p className="admin-page__card-value">{formatNumber(stakes.totals[stake])}</p>
            </article>
          ))}
        </div>
      ) : null}

      <h3>{t("admin.timeoutPenalties")}</h3>
      {penError ? <p className="admin-page__error" role="alert">{t(penError)}</p> : null}
      {!penError && penalties.penalties.length === 0 ? <p className="admin-page__empty">{t("admin.noTimeoutPenalties")}</p> : null}
      <div className="admin-page__table-wrap" data-admin-timeout-penalties="true">
        <table className="admin-page__table">
          <thead>
            <tr>
              <th>{t("admin.matchId")}</th>
              <th>{t("admin.displayName")}</th>
              <th>{t("admin.timeoutPenalties")}</th>
              <th>{t("admin.created")}</th>
            </tr>
          </thead>
          <tbody>
            {penalties.penalties.map((row) => (
              <tr key={`${row.matchId}:${row.idempotencyKey}`}>
                <td className="admin-page__mono">{row.matchId}</td>
                <td>{row.displayName || row.username}</td>
                <td>
                  {row.amount} :{row.strike ?? "—"}
                  {row.anomalyStrike3 ? " !" : ""}
                </td>
                <td>{formatWhen(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>{t("admin.settlementHealth")}</h3>
      {anomError ? <p className="admin-page__error" role="alert">{t(anomError)}</p> : null}
      {!anomError && anomalies.anomalies.length === 0 ? <p className="admin-page__empty">{t("admin.noAnomalies")}</p> : null}
      <div className="admin-page__table-wrap" data-admin-anomalies="true">
        <table className="admin-page__table">
          <thead>
            <tr>
              <th>{t("admin.anomalyType")}</th>
              <th>{t("admin.matchId")}</th>
              <th>{t("admin.stake")}</th>
              <th>{t("admin.created")}</th>
            </tr>
          </thead>
          <tbody>
            {anomalies.anomalies.map((row, index) => (
              <tr key={`${row.anomalyType}:${row.matchId}:${index}`}>
                <td>{row.anomalyType}</td>
                <td className="admin-page__mono">{row.matchId}</td>
                <td>{adminStakeLabel(row.stakePips) ?? t("admin.noStake")}</td>
                <td>{formatWhen(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="admin-page__hint">{t("admin.exactStyleStakeRule")}</p>
    </div>
  );
}

function namedPlayer(player) {
  const name = player?.displayName || player?.username || "—";
  const username = player?.username ? `@${player.username}` : "";
  return username && player?.displayName ? `${name} ${username}` : name;
}

function ReferralsPanel({ t, formatNumber, formatWhen }) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [referrerId, setReferrerId] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      setReferrals(await fetchAdminLeopipsReferralUniverse());
      if (silent) setError("");
    } catch (err) {
      if (!silent) {
        setReferrals([]);
        setError(adminErrorI18nKey(err, "admin.leopipsReferralUnavailable"));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    void load();
    const poll = window.setInterval(() => {
      void load(true);
    }, ADMIN_PRESENCE_POLL_MS);
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void load(true);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const searched = useMemo(() => searchLeoPipsReferrals(referrals, search), [referrals, search]);

  const filtered = useMemo(() => {
    if (!referrerId) return searched;
    return searched.filter((row) => row.inviter?.playerId === referrerId);
  }, [searched, referrerId]);

  // Top cards always match the search-scoped universe, not a single-referrer drill-in.
  const summary = useMemo(() => summarizeLeoPipsReferrals(searched), [searched]);
  const referrerSummary = useMemo(
    () => (referrerId ? aggregateLeoPipsReferrer(referrals, referrerId) : null),
    [referrals, referrerId]
  );
  const pageRows = filtered.slice(offset, offset + ADMIN_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil((filtered.length || 0) / ADMIN_PAGE_SIZE));
  const pageNumber = Math.floor(offset / ADMIN_PAGE_SIZE) + 1;

  return (
    <div data-admin-leopips-referrals="true">
      <header className="admin-page__header">
        <h2>{t("admin.leopipsReferrals")}</h2>
        <button
          type="button"
          className="admin-page__btn admin-page__btn--ghost"
          disabled={loading}
          onClick={() => void load()}
        >
          {t("admin.retry")}
        </button>
      </header>
      <p className="admin-page__hint">{t("admin.leopipsReferralSeparate")}</p>
      <p className="admin-page__hint">{t("admin.leopipsReferralRuleHint")}</p>
      <div className="admin-page__cards" data-admin-referral-summary="true">
        <article className="admin-page__card" data-admin-referral-summary-card="total">
          <p className="admin-page__card-label">{t("admin.leopipsReferrals")}</p>
          <p className="admin-page__card-value">{formatNumber(summary.totalReferrals)}</p>
        </article>
        <article className="admin-page__card" data-admin-referral-summary-card="inProgress">
          <p className="admin-page__card-label">{t("admin.referralsInProgress")}</p>
          <p className="admin-page__card-value">{formatNumber(summary.inProgress)}</p>
        </article>
        <article className="admin-page__card" data-admin-referral-summary-card="qualified">
          <p className="admin-page__card-label">{t("admin.referralsQualified")}</p>
          <p className="admin-page__card-value">{formatNumber(summary.qualified)}</p>
        </article>
        <article className="admin-page__card" data-admin-referral-summary-card="pending">
          <p className="admin-page__card-label">{t("admin.referralsPending")}</p>
          <p className="admin-page__card-value">{formatNumber(summary.pendingRewards)}</p>
        </article>
        <article className="admin-page__card" data-admin-referral-summary-card="issued">
          <p className="admin-page__card-label">{t("admin.referralsIssued")}</p>
          <p className="admin-page__card-value">{formatNumber(summary.issuedRewards)}</p>
        </article>
      </div>
      <label className="admin-page__search">
        <span className="sr-only">{t("admin.searchReferrals")}</span>
        <input
          type="search"
          value={searchInput}
          data-admin-referral-search="true"
          placeholder={t("admin.searchReferrals")}
          onChange={(event) => setSearchInput(event.target.value)}
        />
      </label>
      {referrerSummary ? (
        <>
          <dl className="admin-page__facts" data-admin-referrer-detail="true">
            <div>
              <dt>{t("admin.referrerDetail")}</dt>
              <dd>{namedPlayer(referrerSummary.referrer)}</dd>
            </div>
            <div>
              <dt>{t("admin.totalReferred")}</dt>
              <dd>{formatNumber(referrerSummary.totalReferred)}</dd>
            </div>
            <div>
              <dt>{t("admin.referralsInProgress")}</dt>
              <dd>{formatNumber(referrerSummary.inProgress)}</dd>
            </div>
            <div>
              <dt>{t("admin.referralsQualified")}</dt>
              <dd>{formatNumber(referrerSummary.qualified)}</dd>
            </div>
            <div>
              <dt>{t("admin.referralsPending")}</dt>
              <dd>{formatNumber(referrerSummary.pendingRewards)}</dd>
            </div>
            <div>
              <dt>{t("admin.referralsIssued")}</dt>
              <dd>{formatNumber(referrerSummary.issuedRewards)}</dd>
            </div>
            <div>
              <dt>{t("admin.referralLeoPipsEarned")}</dt>
              <dd>{formatNumber(referrerSummary.issuedAmount)}</dd>
            </div>
          </dl>
          <button
            type="button"
            className="admin-page__btn admin-page__btn--ghost"
            onClick={() => {
              setReferrerId("");
              setOffset(0);
            }}
          >
            {t("admin.filterAll")}
          </button>
        </>
      ) : null}
      {loading && referrals.length === 0 ? <p className="admin-page__hint">{t("admin.loading")}</p> : null}
      {error ? (
        <p className="admin-page__error" role="alert" data-admin-referral-error="true">
          {t(error)}
        </p>
      ) : null}
      {!loading && !error && pageRows.length === 0 ? (
        <p className="admin-page__empty" data-admin-referral-empty="true">
          {t(search || referrerId ? "admin.noReferralSearch" : "admin.noLeopipsReferrals")}
        </p>
      ) : null}
      <div className="admin-page__table-wrap">
        <table className="admin-page__table">
          <thead>
            <tr>
              <th>{t("admin.referrer")}</th>
              <th>{t("admin.referredPlayer")}</th>
              <th>{t("admin.created")}</th>
              <th>{t("admin.qualifyingProgress")}</th>
              <th>{t("admin.referralStatus")}</th>
              <th>{t("admin.plus100Leopips")}</th>
              <th>{t("admin.validatedIssuedAt")}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const status = leoPipsReferralStatus(row);
              const issued = hasLeoPipsReferralRewardProof(row);
              return (
                <tr
                  key={row.referralId}
                  data-admin-leopips-referral={row.referralId}
                  data-admin-referral-status={status}
                  data-admin-referral-reward={issued ? "issued" : status === "qualified" ? "pending" : "none"}
                  onClick={() => setSelected(row)}
                >
                  <td>
                    <button
                      type="button"
                      className="admin-page__btn admin-page__btn--ghost"
                      data-admin-referral-referrer={row.inviter?.playerId || ""}
                      onClick={(event) => {
                        event.stopPropagation();
                        setReferrerId(row.inviter?.playerId || "");
                        setOffset(0);
                      }}
                    >
                      {namedPlayer(row.inviter)}
                    </button>
                  </td>
                  <td data-admin-referral-referred={row.referred?.playerId || ""}>
                    {namedPlayer(row.referred)}
                  </td>
                  <td data-admin-referral-created={row.createdAt || ""}>
                    {formatWhen(row.createdAt)}
                  </td>
                  <td data-admin-referral-progress={referralProgressLabel(row.qualifyingCount ?? row.progress)}>
                    {referralProgressLabel(row.qualifyingCount ?? row.progress)}
                  </td>
                  <td>{t(leoPipsReferralStatusI18nKey(status))}</td>
                  <td>{t(leoPipsRewardI18nKey(row))}</td>
                  <td>{issued ? formatWhen(row.rewardCreatedAt) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager
        page={pageNumber}
        pageCount={pageCount}
        canPrev={offset > 0}
        canNext={offset + ADMIN_PAGE_SIZE < filtered.length}
        loading={loading}
        onPrev={() => setOffset(Math.max(0, offset - ADMIN_PAGE_SIZE))}
        onNext={() => setOffset(offset + ADMIN_PAGE_SIZE)}
        t={t}
        formatNumber={formatNumber}
      />
      {selected ? (
        <div className="admin-page__drawer-wrap">
          <button
            type="button"
            className="admin-page__drawer-backdrop"
            aria-label={t("admin.closeDetail")}
            onClick={() => setSelected(null)}
          />
          <aside className="admin-page__drawer" data-admin-referral-detail="true">
            <header className="admin-page__drawer-head">
              <h2>{t("admin.leopipsReferrals")}</h2>
              <button type="button" className="admin-page__icon-btn" onClick={() => setSelected(null)}>
                {t("admin.closeDetail")}
              </button>
            </header>
            <dl className="admin-page__facts">
              <div>
                <dt>{t("admin.referralId")}</dt>
                <dd className="admin-page__mono">{selected.referralId || "—"}</dd>
              </div>
              <div>
                <dt>{t("admin.referrer")}</dt>
                <dd>{namedPlayer(selected.inviter)}</dd>
              </div>
              <div>
                <dt>{t("admin.referrerPlayerId")}</dt>
                <dd className="admin-page__mono">{selected.inviter?.playerId || "—"}</dd>
              </div>
              <div>
                <dt>{t("admin.referredPlayer")}</dt>
                <dd>{namedPlayer(selected.referred)}</dd>
              </div>
              <div>
                <dt>{t("admin.referredPlayerId")}</dt>
                <dd className="admin-page__mono">{selected.referred?.playerId || "—"}</dd>
              </div>
              <div>
                <dt>{t("admin.created")}</dt>
                <dd>{formatWhen(selected.createdAt)}</dd>
              </div>
              <div>
                <dt>{t("admin.qualifyingProgress")}</dt>
                <dd>{referralProgressLabel(selected.qualifyingCount ?? selected.progress)}</dd>
              </div>
              <div>
                <dt>{t("admin.referralStatus")}</dt>
                <dd>{t(leoPipsReferralStatusI18nKey(leoPipsReferralStatus(selected)))}</dd>
              </div>
              <div>
                <dt>{t("admin.plus100Leopips")}</dt>
                <dd>{t(leoPipsRewardI18nKey(selected))}</dd>
              </div>
              <div>
                <dt>{t("admin.rewardAmount")}</dt>
                <dd>
                  {hasLeoPipsReferralRewardProof(selected)
                    ? formatNumber(leoPipsReferralIssuedAmount(selected))
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("admin.issuedAt")}</dt>
                <dd>
                  {hasLeoPipsReferralRewardProof(selected) ? formatWhen(selected.rewardCreatedAt) : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("admin.ledgerReference")}</dt>
                <dd className="admin-page__mono">
                  {hasLeoPipsReferralRewardProof(selected) ? selected.rewardIdempotencyKey || "—" : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("admin.idempotencyKey")}</dt>
                <dd className="admin-page__mono">{selected.rewardIdempotencyKey || "—"}</dd>
              </div>
              <div>
                <dt>{t("admin.inviteWinStatusLegacy")}</dt>
                <dd data-admin-referral-invite-win={selected.inviteWinStatus || selected.validationStatus || ""}>
                  {selected.inviteWinStatus || selected.validationStatus || "—"}
                </dd>
              </div>
              {selected.inviteWinStatus === "validated" || selected.validationStatus === "validated" ? (
                <div>
                  <dt>{t("admin.inviteWin")}</dt>
                  <dd data-admin-referral-invite-win-legacy="true">{t("admin.inviteWinValidatedLegacy")}</dd>
                </div>
              ) : null}
            </dl>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function MatchmakingHealthPanel({ t }) {
  const [page, setPage] = useState({ requests: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    void fetchAdminOpenMatchRequests()
      .then(setPage)
      .catch((err) => setError(adminErrorI18nKey(err, "admin.matchmakingHealthUnavailable")))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div data-admin-matchmaking-health="true">
      <header className="admin-page__header">
        <h2>{t("admin.matchmakingHealth")}</h2>
      </header>
      <p className="admin-page__hint">{t("admin.exactStyleStakeRule")}</p>
      {loading ? <p className="admin-page__hint">{t("admin.loading")}</p> : null}
      {error ? <p className="admin-page__error" role="alert">{t(error)}</p> : null}
      {!loading && !error && page.requests.length === 0 ? <p className="admin-page__empty">{t("admin.noOpenRequests")}</p> : null}
      <div className="admin-page__table-wrap">
        <table className="admin-page__table">
          <thead>
            <tr>
              <th>{t("admin.displayName")}</th>
              <th>{t("admin.visibility")}</th>
              <th>{t("admin.style")}</th>
              <th>{t("admin.stake")}</th>
              <th>{t("admin.requestAge")}</th>
              <th>{t("admin.status")}</th>
            </tr>
          </thead>
          <tbody>
            {page.requests.map((row) => (
              <tr key={row.requestId} data-admin-open-request={row.requestId}>
                <td>{playerLabel(row.creator)}</td>
                <td>{row.visibility}</td>
                <td>{row.rulesetId}</td>
                <td>{adminStakeLabel(row.stakePips) ?? t("admin.noStake")}</td>
                <td>{row.ageSeconds}</td>
                <td>
                  {row.status}
                  {row.flagPublicNullStake || row.flagStale || row.flagInvalidStake ? " !" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminLeopipsPanels({ section, t, formatNumber, formatWhen, searchHint }) {
  if (section === "matchHistory") {
    return (
      <>
        <MatchHistoryPanel t={t} formatNumber={formatNumber} formatWhen={formatWhen} />
        {searchHint ? (
          <p className="admin-page__hint" data-admin-global-search-hint="true">
            {t(searchHint)}
          </p>
        ) : null}
      </>
    );
  }
  if (section === "leopips") {
    return <LeopipsOpsPanel t={t} formatNumber={formatNumber} formatWhen={formatWhen} />;
  }
  if (section === "leopipsReferrals") {
    return <ReferralsPanel t={t} formatNumber={formatNumber} formatWhen={formatWhen} />;
  }
  if (section === "matchmakingHealth") {
    return <MatchmakingHealthPanel t={t} />;
  }
  return null;
}
