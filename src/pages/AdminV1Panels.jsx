import { useCallback, useEffect, useRef, useState } from "react";
import { IconClose } from "../components/Icon";
import { ADMIN_PAGE_SIZE, adminErrorI18nKey } from "../online/adminDashboard.js";
import {
  ADMIN_CHALLENGE_STATUSES,
  ADMIN_REPORT_STATUSES,
  fetchAdminAudit,
  fetchAdminChallenge,
  fetchAdminClipboardReport,
  fetchAdminFeedback,
  fetchAdminInviteWin,
  fetchAdminLeague,
  fetchAdminReports,
  updateAdminChallenge,
  updateAdminReportStatus,
} from "../online/adminV1.js";
import { copyText } from "../online/referrals.js";

function postgresErrorCode(error) {
  const pg = String(error?.cause?.code || "").trim();
  if (pg) return pg;
  const msg = String(error?.message || "");
  if (/reason required/i.test(msg) || /invalid challenge status/i.test(msg)) return "22023";
  return "";
}

function errorMessageKey(error, fallback = "admin.loadError") {
  const mapped = adminErrorI18nKey(error, "");
  if (mapped) return mapped;
  const pg = postgresErrorCode(error);
  const msg = String(error?.message || "");
  if (pg === "22023" || /reason required|invalid challenge status/i.test(msg)) {
    return "admin.reasonHint";
  }
  return fallback;
}

function errorCodeOf(error) {
  return postgresErrorCode(error) || String(error?.message || "").slice(0, 120);
}

function playerLabel(player) {
  return player?.displayName || player?.username || "—";
}

function titleCaseParts(value) {
  return String(value || "")
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
    .join("");
}

function scheduleStatusKey(status) {
  const id = titleCaseParts(status);
  return id ? `admin.challenge${id}` : "admin.metricUnavailable";
}

function inviteSeasonStatusKey(status) {
  const map = {
    upcoming: "admin.seasonUpcoming",
    active: "admin.seasonActive",
    ended: "admin.seasonEnded",
    under_review: "admin.seasonUnderReview",
    finalized: "admin.seasonFinalized",
  };
  return map[status] || "admin.metricUnavailable";
}

function staffRoleKey(role) {
  const map = {
    owner: "admin.roleOwner",
    admin: "admin.roleAdmin",
    moderator: "admin.roleModerator",
  };
  return map[role] || "admin.metricUnavailable";
}

function auditActionKey(action) {
  const map = {
    report_status: "admin.auditActionReportStatus",
    challenge_update: "admin.auditActionChallengeUpdate",
  };
  return map[action] || "admin.metricUnavailable";
}

function auditTargetKey(targetType) {
  const map = {
    player_report: "admin.targetPlayerReport",
    challenge_config: "admin.targetChallenge",
  };
  return map[targetType] || "admin.metricUnavailable";
}

function feedbackStatusKey(status) {
  const map = {
    new: "admin.feedbackStatusNew",
    reviewed: "admin.feedbackStatusReviewed",
    resolved: "admin.feedbackStatusResolved",
  };
  return map[status] || "admin.metricUnavailable";
}

function toLocalInput(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function Pager({ page, pageCount, canPrev, canNext, loading, onPrev, onNext, t, formatNumber }) {
  return (
    <div className="admin-page__pager">
      <button type="button" className="admin-page__btn admin-page__btn--ghost" disabled={!canPrev || loading} onClick={onPrev}>
        {t("admin.previous")}
      </button>
      <p>
        {t("admin.pageOf", { page: formatNumber(page), pages: formatNumber(pageCount) })}
      </p>
      <button type="button" className="admin-page__btn admin-page__btn--ghost" disabled={!canNext || loading} onClick={onNext}>
        {t("admin.next")}
      </button>
    </div>
  );
}

function useAdminPage(loader) {
  const [page, setPage] = useState({ items: [], total: 0, limit: ADMIN_PAGE_SIZE, offset: 0 });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPage(await loader({ offset, limit: ADMIN_PAGE_SIZE }));
    } catch (err) {
      setPage({ items: [], total: 0, limit: ADMIN_PAGE_SIZE, offset });
      setError(errorMessageKey(err));
    } finally {
      setLoading(false);
    }
  }, [loader, offset]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const pageCount = Math.max(1, Math.ceil((page.total || 0) / (page.limit || ADMIN_PAGE_SIZE)));
  const pageNumber = Math.floor((page.offset || 0) / (page.limit || ADMIN_PAGE_SIZE)) + 1;
  return {
    page,
    error,
    loading,
    reload,
    offset,
    setOffset,
    pageCount,
    pageNumber,
    canPrev: (page.offset || 0) > 0,
    canNext: (page.offset || 0) + page.items.length < (page.total || 0),
  };
}

export function AdminV1Panels({ section, role, t, formatNumber, formatWhen }) {
  const canMutateChallenge = role === "admin" || role === "owner";

  if (section === "reports") {
    return <ReportsPanel t={t} formatNumber={formatNumber} formatWhen={formatWhen} role={role} />;
  }
  if (section === "challenge") {
    return (
      <ChallengePanel
        t={t}
        formatNumber={formatNumber}
        formatWhen={formatWhen}
        canMutate={canMutateChallenge}
      />
    );
  }
  if (section === "inviteWin") return <InviteWinPanel t={t} formatNumber={formatNumber} formatWhen={formatWhen} />;
  if (section === "league") return <LeaguePanel t={t} formatNumber={formatNumber} formatWhen={formatWhen} />;
  if (section === "feedback") return <FeedbackPanel t={t} formatNumber={formatNumber} formatWhen={formatWhen} />;
  if (section === "audit") return <AuditPanel t={t} formatNumber={formatNumber} formatWhen={formatWhen} />;
  return null;
}

function ReportsPanel({ t, formatNumber, formatWhen, role }) {
  const loader = useCallback((query) => fetchAdminReports(query), []);
  const list = useAdminPage(loader);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState("reviewing");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  return (
    <div data-admin-reports="true">
      <header className="admin-page__header">
        <h2>{t("admin.reports")}</h2>
        <div className="admin-page__header-actions">
          {copied ? <p className="admin-page__copied" role="status">{t("admin.reportCopied")}</p> : null}
          <button
            type="button"
            className="admin-page__btn admin-page__btn--ghost"
            data-admin-copy-report="true"
            disabled={copying}
            onClick={async () => {
              setCopying(true);
              setCopied(false);
              setCopyError(false);
              try {
                const text = await fetchAdminClipboardReport({ role });
                const ok = await copyText(text);
                setCopied(ok);
                setCopyError(!ok);
              } catch {
                setCopied(false);
                setCopyError(true);
              } finally {
                setCopying(false);
              }
            }}
          >
            {t("admin.copyAllReports")}
          </button>
          <button type="button" className="admin-page__btn admin-page__btn--ghost" disabled={list.loading} onClick={() => void list.reload()}>
            {t("admin.retry")}
          </button>
        </div>
      </header>
      {copyError ? <p className="admin-page__error" role="alert">{t("admin.loadError")}</p> : null}
      {list.error ? <p className="admin-page__error" role="alert">{t(list.error)}</p> : null}
      <div className="admin-page__match-list">
        {list.page.items.map((item) => (
          <article key={item.id} className="admin-page__match" data-admin-report={item.id}>
            <div className="admin-page__match-top">
              <p className="admin-page__match-players">
                {playerLabel(item.reporter)}
                <span className="admin-page__match-vs">{t("admin.vs")}</span>
                {playerLabel(item.reported)}
              </p>
              <span className="admin-page__pill">{t(`admin.status${titleCaseParts(item.status)}`)}</span>
            </div>
            <dl className="admin-page__match-meta">
              <div>
                <dt>{t("admin.reportCategory")}</dt>
                <dd>{t(`admin.category${titleCaseParts(item.category)}`)}</dd>
              </div>
              <div>
                <dt>{t("admin.created")}</dt>
                <dd>{formatWhen(item.createdAt)}</dd>
              </div>
            </dl>
            <p>{item.body}</p>
            <button
              type="button"
              className="admin-page__btn admin-page__btn--ghost"
              onClick={() => {
                setSelected(item);
                setStatus(item.status === "open" ? "reviewing" : item.status);
                setReason("");
                setFormError("");
              }}
            >
              {t("admin.viewDetails")}
            </button>
          </article>
        ))}
      </div>
      {!list.loading && !list.error && list.page.items.length === 0 ? (
        <p className="admin-page__empty">{t("admin.noReports")}</p>
      ) : null}
      <Pager
        page={list.pageNumber}
        pageCount={list.pageCount}
        canPrev={list.canPrev}
        canNext={list.canNext}
        loading={list.loading}
        onPrev={() => list.setOffset(Math.max(0, list.offset - ADMIN_PAGE_SIZE))}
        onNext={() => list.setOffset(list.offset + ADMIN_PAGE_SIZE)}
        t={t}
        formatNumber={formatNumber}
      />
      {selected ? (
        <div className="admin-page__drawer-wrap">
          <button type="button" className="admin-page__drawer-backdrop" aria-label={t("admin.closeDetail")} onClick={() => setSelected(null)} />
          <aside className="admin-page__drawer" data-admin-report-detail="true">
            <header className="admin-page__drawer-head">
              <h2>{t("admin.reports")}</h2>
              <button type="button" className="admin-page__icon-btn" onClick={() => setSelected(null)}>
                <IconClose />
                <span className="sr-only">{t("admin.closeDetail")}</span>
              </button>
            </header>
            <p className="admin-page__mono">{selected.id}</p>
            <p>{selected.body}</p>
            {selected.assignedStaffId ? (
              <p className="admin-page__mono">
                {t("admin.assignedStaff")}: {selected.assignedStaffId}
              </p>
            ) : null}
            <label className="admin-page__search">
              <span>{t("admin.reportStatus")}</span>
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                {ADMIN_REPORT_STATUSES.map((id) => (
                  <option key={id} value={id}>
                    {t(`admin.status${titleCaseParts(id)}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-page__search">
              <span>{t("admin.reasonLabel")}</span>
              <textarea value={reason} rows={3} onChange={(event) => setReason(event.target.value)} placeholder={t("admin.reasonHint")} />
            </label>
            {formError ? <p className="admin-page__error">{t(formError)}</p> : null}
            <button
              type="button"
              className="admin-page__btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setFormError("");
                try {
                  await updateAdminReportStatus(selected.id, status, reason);
                  setSelected(null);
                  await list.reload();
                } catch (error) {
                  setFormError(errorMessageKey(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("admin.updateStatus")}
            </button>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function ChallengePanel({ t, formatNumber, formatWhen, canMutate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [status, setStatus] = useState("coming_soon");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const loadGen = useRef(0);

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    setError("");
    setErrorCode("");
    try {
      const next = await fetchAdminChallenge();
      if (gen !== loadGen.current) return;
      setData(next);
      setStatus(next.status);
      setStartsAt(toLocalInput(next.startsAt));
      setEndsAt(toLocalInput(next.endsAt));
    } catch (err) {
      if (gen !== loadGen.current) return;
      setError(errorMessageKey(err));
      setErrorCode(errorCodeOf(err));
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      loadGen.current += 1;
    };
  }, [load]);

  return (
    <div data-admin-challenge="true">
      <header className="admin-page__header">
        <h2>{t("admin.challenge")}</h2>
        <button type="button" className="admin-page__btn admin-page__btn--ghost" onClick={() => void load()}>
          {t("admin.retry")}
        </button>
      </header>
      {error ? (
        <p className="admin-page__error" role="alert" data-admin-challenge-error={error} data-admin-error-code={errorCode || undefined}>
          {t(error)}
          {errorCode ? <span className="admin-page__error-code">{errorCode}</span> : null}
        </p>
      ) : null}
      <p className="admin-page__empty">{t("admin.challengeHint")}</p>
      {data ? (
        <dl className="admin-page__facts">
          <div>
            <dt>{t("admin.challengeStatus")}</dt>
            <dd>{t(scheduleStatusKey(data.status))}</dd>
          </div>
          <div>
            <dt>{t("admin.qualificationTarget")}</dt>
            <dd>{t("admin.cpAmount", { amount: formatNumber(data.qualificationCp) })}</dd>
          </div>
          <div>
            <dt>{t("admin.firstPrize")}</dt>
            <dd>{t("admin.prizeUsd", { amount: formatNumber(data.firstPrizeUsd) })}</dd>
          </div>
          <div>
            <dt>{t("admin.secondPrize")}</dt>
            <dd>{t("admin.prizeUsd", { amount: formatNumber(data.secondPrizeUsd) })}</dd>
          </div>
          <div>
            <dt>{t("admin.cpEarning")}</dt>
            <dd>{t("admin.cpEarningOff")}</dd>
          </div>
          <div>
            <dt>{t("admin.startsAt")}</dt>
            <dd>{formatWhen(data.startsAt)}</dd>
          </div>
          <div>
            <dt>{t("admin.endsAt")}</dt>
            <dd>{formatWhen(data.endsAt)}</dd>
          </div>
        </dl>
      ) : null}
      <h3>{t("admin.qualifiedPlayers")}</h3>
      <p className="admin-page__empty">{t("admin.noQualified")}</p>
      {canMutate ? (
        <form
          className="admin-page__search"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!confirm) return;
            setBusy(true);
            setError("");
            setErrorCode("");
            try {
              const next = await updateAdminChallenge({
                status,
                startsAt: fromLocalInput(startsAt),
                endsAt: fromLocalInput(endsAt),
                reason,
              });
              setData(next);
              setStartsAt(toLocalInput(next.startsAt));
              setEndsAt(toLocalInput(next.endsAt));
              setReason("");
              setConfirm(false);
            } catch (err) {
              setError(errorMessageKey(err, "admin.challengeSaveError"));
              setErrorCode(errorCodeOf(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            <span>{t("admin.challengeStatus")}</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {ADMIN_CHALLENGE_STATUSES.map((id) => (
                <option key={id} value={id}>
                  {t(scheduleStatusKey(id))}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("admin.startsAt")}</span>
            <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
          </label>
          <label>
            <span>{t("admin.endsAt")}</span>
            <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
          </label>
          <label>
            <span>{t("admin.reasonLabel")}</span>
            <textarea value={reason} rows={3} onChange={(event) => setReason(event.target.value)} placeholder={t("admin.reasonHint")} />
          </label>
          <label>
            <input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />
            {t("admin.challengeConfirm")}
          </label>
          <button type="submit" className="admin-page__btn" disabled={busy || !confirm}>
            {t("admin.saveChallenge")}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function InviteWinPanel({ t, formatNumber, formatWhen }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void (async () => {
      try {
        setData(await fetchAdminInviteWin());
      } catch (err) {
        setError(errorMessageKey(err));
      }
    })();
  }, []);
  return (
    <div data-admin-invite-win="true">
      <header className="admin-page__header">
        <h2>{t("admin.inviteWin")}</h2>
      </header>
      {error ? <p className="admin-page__error">{t(error)}</p> : null}
      {!data?.season ? <p className="admin-page__empty">{t("admin.noInviteSeason")}</p> : null}
      {data?.season ? (
        <dl className="admin-page__facts">
          <div>
            <dt>{t("admin.inviteSeason")}</dt>
            <dd>{data.season.name}</dd>
          </div>
          <div>
            <dt>{t("admin.status")}</dt>
            <dd>{t(inviteSeasonStatusKey(data.season.status))}</dd>
          </div>
          <div>
            <dt>{t("admin.firstPrize")}</dt>
            <dd>{t("admin.prizeUsd", { amount: formatNumber(data.season.prizeAmountUsd || 0) })}</dd>
          </div>
          <div>
            <dt>{t("admin.startsAt")}</dt>
            <dd>{formatWhen(data.season.startsAt)}</dd>
          </div>
          <div>
            <dt>{t("admin.endsAt")}</dt>
            <dd>{formatWhen(data.season.endsAt)}</dd>
          </div>
          <div>
            <dt>{t("admin.winner")}</dt>
            <dd>{data.season.winner ? playerLabel(data.season.winner) : t("admin.noWinner")}</dd>
          </div>
          <div>
            <dt>{t("admin.pending")}</dt>
            <dd>{formatNumber(data.counts.pending)}</dd>
          </div>
          <div>
            <dt>{t("admin.validated")}</dt>
            <dd>{formatNumber(data.counts.validated)}</dd>
          </div>
          <div>
            <dt>{t("admin.rejected")}</dt>
            <dd>{formatNumber(data.counts.rejected)}</dd>
          </div>
        </dl>
      ) : null}
      <h3>{t("admin.standings")}</h3>
      {!data?.standings?.length ? <p className="admin-page__empty">{t("admin.noStandings")}</p> : null}
      <ol className="admin-page__rp-history">
        {(data?.standings || []).map((row) => (
          <li key={row.playerId} className="admin-page__rp-event">
            <p className="admin-page__rp-event-vs">{playerLabel(row)}</p>
            <dl className="admin-page__rp-event-facts">
              <div>
                <dt>{t("admin.validated")}</dt>
                <dd>{formatNumber(row.validatedCount)}</dd>
              </div>
              <div>
                <dt>{t("admin.pending")}</dt>
                <dd>{formatNumber(row.pendingCount)}</dd>
              </div>
              <div>
                <dt>{t("admin.rejected")}</dt>
                <dd>{formatNumber(row.rejectedCount)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
    </div>
  );
}

function LeaguePanel({ t, formatNumber, formatWhen }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void (async () => {
      try {
        setData(await fetchAdminLeague());
      } catch (err) {
        setError(errorMessageKey(err));
      }
    })();
  }, []);
  return (
    <div data-admin-league="true">
      <header className="admin-page__header">
        <h2>{t("admin.league")}</h2>
      </header>
      {error ? <p className="admin-page__error">{t(error)}</p> : null}
      <p className="admin-page__empty">{t("admin.leagueHint")}</p>
      {data ? (
        <dl className="admin-page__facts">
          <div>
            <dt>{t("admin.status")}</dt>
            <dd>{t(scheduleStatusKey(data.status))}</dd>
          </div>
          <div>
            <dt>{t("admin.seasonDays")}</dt>
            <dd>{formatNumber(data.seasonDays)}</dd>
          </div>
          <div>
            <dt>{t("admin.startsAt")}</dt>
            <dd>{formatWhen(data.startsAt)}</dd>
          </div>
          <div>
            <dt>{t("admin.endsAt")}</dt>
            <dd>{formatWhen(data.endsAt)}</dd>
          </div>
        </dl>
      ) : null}
      <p className="admin-page__empty">{t("admin.noLeaderboard")}</p>
    </div>
  );
}

function FeedbackPanel({ t, formatNumber, formatWhen }) {
  const loader = useCallback((query) => fetchAdminFeedback(query), []);
  const list = useAdminPage(loader);
  return (
    <div data-admin-feedback="true">
      <header className="admin-page__header">
        <h2>{t("admin.feedback")}</h2>
        <button type="button" className="admin-page__btn admin-page__btn--ghost" disabled={list.loading} onClick={() => void list.reload()}>
          {t("admin.retry")}
        </button>
      </header>
      {list.error ? <p className="admin-page__error">{t(list.error)}</p> : null}
      <div className="admin-page__match-list">
        {list.page.items.map((item) => (
          <article key={item.id} className="admin-page__match" data-admin-feedback-item={item.id}>
            <div className="admin-page__match-top">
              <p className="admin-page__match-players">{playerLabel(item.player)}</p>
              <span className="admin-page__pill">{t(`admin.feedback${titleCaseParts(item.category)}`)}</span>
              <span className="admin-page__pill">{t(feedbackStatusKey(item.status))}</span>
            </div>
            <p>{item.body}</p>
            <p className="admin-page__match-id">{formatWhen(item.createdAt)}</p>
          </article>
        ))}
      </div>
      {!list.loading && !list.error && list.page.items.length === 0 ? (
        <p className="admin-page__empty">{t("admin.noFeedbackItems")}</p>
      ) : null}
      <Pager
        page={list.pageNumber}
        pageCount={list.pageCount}
        canPrev={list.canPrev}
        canNext={list.canNext}
        loading={list.loading}
        onPrev={() => list.setOffset(Math.max(0, list.offset - ADMIN_PAGE_SIZE))}
        onNext={() => list.setOffset(list.offset + ADMIN_PAGE_SIZE)}
        t={t}
        formatNumber={formatNumber}
      />
    </div>
  );
}

function AuditPanel({ t, formatNumber, formatWhen }) {
  const loader = useCallback((query) => fetchAdminAudit(query), []);
  const list = useAdminPage(loader);
  return (
    <div data-admin-audit="true">
      <header className="admin-page__header">
        <h2>{t("admin.audit")}</h2>
        <button type="button" className="admin-page__btn admin-page__btn--ghost" disabled={list.loading} onClick={() => void list.reload()}>
          {t("admin.retry")}
        </button>
      </header>
      {list.error ? <p className="admin-page__error">{t(list.error)}</p> : null}
      <ol className="admin-page__rp-history" data-admin-audit-list="true">
        {list.page.items.map((item) => (
          <li key={item.id} className="admin-page__rp-event">
            <div className="admin-page__rp-event-top">
              <span className="admin-page__pill">{t(auditActionKey(item.action))}</span>
              <time dateTime={item.createdAt}>{formatWhen(item.createdAt)}</time>
            </div>
            <p className="admin-page__rp-event-vs">
              {t(staffRoleKey(item.actorRole))} · {t(auditTargetKey(item.targetType))} {item.targetId || ""}
            </p>
            {item.reason ? <p>{item.reason}</p> : null}
          </li>
        ))}
      </ol>
      {!list.loading && !list.error && list.page.items.length === 0 ? (
        <p className="admin-page__empty">{t("admin.noAuditEvents")}</p>
      ) : null}
      <Pager
        page={list.pageNumber}
        pageCount={list.pageCount}
        canPrev={list.canPrev}
        canNext={list.canNext}
        loading={list.loading}
        onPrev={() => list.setOffset(Math.max(0, list.offset - ADMIN_PAGE_SIZE))}
        onNext={() => list.setOffset(list.offset + ADMIN_PAGE_SIZE)}
        t={t}
        formatNumber={formatNumber}
      />
    </div>
  );
}

