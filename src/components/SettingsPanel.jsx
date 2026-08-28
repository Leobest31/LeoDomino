import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import { usePrefs } from "../hooks/usePrefs.js";
import {
  averageRoundScore,
  loadStats,
  resetStats,
  winPercentage,
} from "../persistence/index.js";
import { LEGAL_URLS } from "../legal/urls.js";
import { canOpenStoreListing, openConfiguredStoreListing } from "../legal/storeLinks.js";
import { AUTH_ERROR, isCloudAuth, useAuth } from "../auth";
import {
  FEEDBACK_ERROR,
  FEEDBACK_MAX_LENGTH,
  FEEDBACK_MIN_LENGTH,
  submitMyFeedback,
  validateFeedbackInput,
} from "../online/feedback.js";
import { getPlatform } from "../monitoring/client.js";
import { IconClose } from "./Icon";
import LanguageSwitcher from "./LanguageSwitcher";
import DifficultySwitcher from "./DifficultySwitcher";
import "./SettingsPanel.css";

/**
 * Slide-over settings — language, AI, sound, music, vibration, theme, stats.
 */
function SettingsPanel({
  open,
  onClose,
  difficulty,
  onDifficultyChange,
}) {
  const { t } = useI18n();
  const { volume, muted, ambient, setVolume, setMuted, setAmbient, play } = useAudio();
  const { theme, tileSkin, vibration, setTheme, setTileSkin, setVibration } = usePrefs();
  const { session, logout, openCreate, openLogin, deleteAccount, busy } = useAuth();
  const [stats, setStats] = useState(() => loadStats());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [feedbackCategory, setFeedbackCategory] = useState("general");
  const [feedbackBody, setFeedbackBody] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState("");
  const [feedbackError, setFeedbackError] = useState("");
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) setStats(loadStats());
    if (!open) {
      setDeleteOpen(false);
      setDeletePassword("");
      setDeleteError("");
      setFeedbackCategory("general");
      setFeedbackBody("");
      setFeedbackSending(false);
      setFeedbackNotice("");
      setFeedbackError("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const panel = document.querySelector(".settings-panel");
    const closeBtn = panel?.querySelector(".settings-panel__close");
    closeBtn?.focus?.();

    const onKey = (event) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = panel.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open && !wasOpen.current) {
      play("menuOpen");
    } else if (!open && wasOpen.current) {
      play("menuClose");
    }
    wasOpen.current = open;
  }, [open, play]);

  const tap = (fn) => {
    play("button");
    fn?.();
  };

  const deletionErrorKey = (code) => {
    if (code === AUTH_ERROR.INVALID_PASSWORD || code === AUTH_ERROR.CREDENTIALS) {
      return "auth.errorDeletePassword";
    }
    if (code === AUTH_ERROR.DELETE_PENDING) return "auth.errorDeletePending";
    if (code === AUTH_ERROR.DELETE_UNAVAILABLE) return "auth.errorDeleteUnavailable";
    return "auth.errorDeleteFailed";
  };

  const confirmDelete = async () => {
    play("button");
    setDeleteError("");
    if (!deletePassword) {
      setDeleteError("auth.errorDeletePassword");
      return;
    }
    try {
      await deleteAccount(deletePassword);
      setDeleteOpen(false);
      setDeletePassword("");
      onClose();
    } catch (error) {
      setDeleteError(deletionErrorKey(error?.code));
    }
  };

  const feedbackErrorKey = (code) => {
    if (code === FEEDBACK_ERROR.TOO_SHORT) return "feedback.tooShort";
    if (code === FEEDBACK_ERROR.TOO_LONG) return "feedback.tooLong";
    if (code === FEEDBACK_ERROR.INVALID_CATEGORY) return "feedback.invalidCategory";
    if (code === FEEDBACK_ERROR.RATE_LIMIT) return "feedback.rateLimit";
    if (code === FEEDBACK_ERROR.AUTH || code === FEEDBACK_ERROR.UNAVAILABLE) return "feedback.signIn";
    return "feedback.error";
  };

  const canSubmitFeedback = isCloudAuth() && Boolean(session);
  const feedbackLength = feedbackBody.trim().length;
  const showFeedbackMinHint = Boolean(feedbackLength) && feedbackLength < FEEDBACK_MIN_LENGTH;
  const feedbackReady =
    canSubmitFeedback &&
    !feedbackSending &&
    !validateFeedbackInput({ category: feedbackCategory, body: feedbackBody });
  const canRate = canOpenStoreListing(getPlatform());

  const submitFeedback = async (event) => {
    event.preventDefault();
    play("button");
    setFeedbackNotice("");
    setFeedbackError("");
    if (!canSubmitFeedback) {
      setFeedbackError("feedback.signIn");
      return;
    }
    const invalid = validateFeedbackInput({ category: feedbackCategory, body: feedbackBody });
    if (invalid) {
      setFeedbackError(feedbackErrorKey(invalid));
      return;
    }
    setFeedbackSending(true);
    try {
      await submitMyFeedback({ category: feedbackCategory, body: feedbackBody });
      setFeedbackCategory("general");
      setFeedbackBody("");
      setFeedbackNotice("feedback.success");
    } catch (error) {
      setFeedbackError(feedbackErrorKey(error?.code));
    } finally {
      setFeedbackSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`settings-backdrop${open ? " settings-backdrop--open" : ""}`}
        aria-label={t("common.close")}
        tabIndex={open ? 0 : -1}
        inert={!open ? true : undefined}
        onClick={onClose}
      />
      <aside
        className={`settings-panel${open ? " settings-panel--open" : ""}`}
        aria-hidden={!open}
        inert={!open ? true : undefined}
        aria-label={t("common.settings")}
      >
        <header className="settings-panel__header">
          <h2 className="settings-panel__title">{t("common.settings")}</h2>
          <button
            type="button"
            className="settings-panel__close"
            onClick={() => tap(onClose)}
          >
            <IconClose />
            <span className="sr-only">{t("common.close")}</span>
          </button>
        </header>

        <div className="settings-panel__body">
          <section className="settings-panel__account" aria-label={t("auth.accountSection")}>
            <h3 className="settings-panel__label">{t("auth.accountSection")}</h3>
            {session ? (
              <>
                <p className="settings-panel__account-name">{session.displayName}</p>
                <p className="settings-panel__account-meta">{session.email}</p>
                <p className="settings-panel__account-meta">{t("auth.playerId", { id: session.playerId })}</p>
                <button
                  type="button"
                  className="btn btn--ghost settings-panel__account-btn"
                  onClick={() => tap(logout)}
                >
                  {t("auth.logout")}
                </button>
                {isCloudAuth() ? (
                  <div className="settings-panel__delete" data-account-delete="true">
                    {!deleteOpen ? (
                      <button
                        type="button"
                        className="btn btn--ghost settings-panel__account-btn settings-panel__delete-open"
                        onClick={() => tap(() => {
                          setDeleteError("");
                          setDeletePassword("");
                          setDeleteOpen(true);
                        })}
                      >
                        {t("auth.deleteAccount")}
                      </button>
                    ) : (
                      <form
                        className="settings-panel__delete-confirm"
                        data-account-delete-confirm="true"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void confirmDelete();
                        }}
                      >
                        <p className="settings-panel__hint">{t("auth.deleteAccountBody")}</p>
                        <p className="settings-panel__hint">{t("auth.deleteAccountPassword")}</p>
                        <input
                          className="settings-panel__select"
                          type="password"
                          name="delete-account-password"
                          value={deletePassword}
                          autoComplete="current-password"
                          spellCheck={false}
                          aria-label={t("auth.deleteAccountPassword")}
                          onChange={(event) => setDeletePassword(event.target.value)}
                        />
                        {deleteError ? (
                          <p className="settings-panel__delete-error" role="alert">
                            {t(deleteError)}
                          </p>
                        ) : null}
                        <button
                          type="submit"
                          className="btn btn--ghost settings-panel__account-btn settings-panel__delete-confirm-btn"
                          disabled={busy || !deletePassword}
                        >
                          {t("auth.deleteAccountConfirm")}
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost settings-panel__account-btn"
                          disabled={busy}
                          onClick={() => tap(() => {
                            setDeleteOpen(false);
                            setDeletePassword("");
                            setDeleteError("");
                          })}
                        >
                          {t("common.cancel")}
                        </button>
                      </form>
                    )}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <p className="settings-panel__hint">{t("auth.guest")}</p>
                <div className="settings-panel__account-actions">
                  <button
                    type="button"
                    className="btn btn--primary settings-panel__account-btn"
                    onClick={() => tap(() => { onClose(); openCreate(); })}
                  >
                    {t("auth.createCta")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost settings-panel__account-btn"
                    onClick={() => tap(() => { onClose(); openLogin(); })}
                  >
                    {t("auth.loginCta")}
                  </button>
                </div>
              </>
            )}
          </section>

          <label className="settings-panel__field">
            <span className="settings-panel__label">{t("language.label")}</span>
            <LanguageSwitcher />
          </label>

          {difficulty != null && onDifficultyChange ? (
            <label className="settings-panel__field">
              <span className="settings-panel__label">{t("ai.switcherAria")}</span>
              <DifficultySwitcher value={difficulty} onChange={onDifficultyChange} />
            </label>
          ) : null}

          <fieldset className="settings-panel__fieldset">
            <legend className="settings-panel__label">{t("audio.title")}</legend>

            <label className="settings-panel__toggle">
              <input
                type="checkbox"
                checked={!muted}
                onChange={(event) => {
                  const nextMuted = !event.target.checked;
                  if (nextMuted) play("button");
                  setMuted(nextMuted);
                  if (!nextMuted) play("button");
                }}
              />
              <span>{muted ? t("audio.unmute") : t("audio.mute")}</span>
            </label>

            <label className="settings-panel__field">
              <span className="settings-panel__label">{t("audio.volume")}</span>
              <input
                className="settings-panel__range"
                type="range"
                min="0"
                max="100"
                step="1"
                value={Math.round(volume * 100)}
                disabled={muted}
                aria-valuetext={`${Math.round(volume * 100)}%`}
                onChange={(event) => {
                  setVolume(Number(event.target.value) / 100);
                }}
              />
            </label>

            <label className="settings-panel__toggle">
              <input
                type="checkbox"
                checked={ambient}
                onChange={(event) => {
                  setAmbient(event.target.checked);
                  play("button");
                }}
              />
              <span>{t("audio.music")}</span>
            </label>
          </fieldset>

          <fieldset className="settings-panel__fieldset">
            <legend className="settings-panel__label">{t("settings.preferences")}</legend>

            <label className="settings-panel__toggle">
              <input
                type="checkbox"
                checked={vibration}
                onChange={(event) => {
                  setVibration(event.target.checked);
                  play("button");
                }}
              />
              <span>{t("settings.vibration")}</span>
            </label>

            <label className="settings-panel__field">
              <span className="settings-panel__label">{t("settings.theme")}</span>
              <select
                className="settings-panel__select"
                value={theme}
                onChange={(event) => {
                  setTheme(event.target.value);
                  play("button");
                }}
              >
                <option value="classic">{t("settings.themeClassic")}</option>
                <option value="noir">{t("settings.themeNoir")}</option>
              </select>
            </label>

            <label className="settings-panel__field">
              <span className="settings-panel__label">{t("settings.tileSkin")}</span>
              <select
                className="settings-panel__select"
                value={tileSkin}
                onChange={(event) => {
                  setTileSkin(event.target.value);
                  play("button");
                }}
              >
                <option value="classic">{t("settings.tileSkinClassic")}</option>
                <option value="premium">{t("settings.tileSkinPremium")}</option>
              </select>
            </label>
          </fieldset>

          <section className="settings-panel__stats" aria-label={t("stats.title")}>
            <h3 className="settings-panel__label">{t("stats.title")}</h3>
            <ul className="settings-panel__stats-list">
              <li>
                <span>{t("stats.matchesPlayed")}</span>
                <strong>{stats.matchesPlayed}</strong>
              </li>
              <li>
                <span>{t("stats.wins")}</span>
                <strong>{stats.wins}</strong>
              </li>
              <li>
                <span>{t("stats.losses")}</span>
                <strong>{stats.losses}</strong>
              </li>
              <li>
                <span>{t("stats.winRate")}</span>
                <strong>{winPercentage(stats)}%</strong>
              </li>
              <li>
                <span>{t("stats.highestScore")}</span>
                <strong>{stats.highestScore}</strong>
              </li>
              <li>
                <span>{t("stats.bestStreak")}</span>
                <strong>{stats.bestStreak}</strong>
              </li>
              <li>
                <span>{t("stats.avgRound")}</span>
                <strong>{averageRoundScore(stats)}</strong>
              </li>
            </ul>
            <button
              type="button"
              className="btn btn--ghost settings-panel__reset"
              onClick={() => {
                if (window.confirm(t("settings.resetStatsConfirm"))) {
                  setStats(resetStats());
                  play("button");
                }
              }}
            >
              {t("settings.resetStats")}
            </button>
          </section>

          <section className="settings-panel__feedback" data-settings-feedback="true">
            <h3 className="settings-panel__label">{t("feedback.title")}</h3>
            {canSubmitFeedback ? (
              <form className="settings-panel__feedback-form" onSubmit={submitFeedback}>
                <label className="settings-panel__field">
                  <span className="settings-panel__label">{t("feedback.category")}</span>
                  <select
                    className="settings-panel__select"
                    value={feedbackCategory}
                    disabled={feedbackSending}
                    aria-label={t("feedback.category")}
                    onChange={(event) => {
                      setFeedbackCategory(event.target.value);
                      setFeedbackNotice("");
                      setFeedbackError("");
                    }}
                  >
                    <option value="general">{t("feedback.general")}</option>
                    <option value="bug">{t("feedback.bug")}</option>
                    <option value="feature">{t("feedback.feature")}</option>
                  </select>
                </label>
                <label className="settings-panel__field">
                  <span className="settings-panel__label">{t("feedback.message")}</span>
                  <textarea
                    className="settings-panel__textarea"
                    value={feedbackBody}
                    disabled={feedbackSending}
                    maxLength={FEEDBACK_MAX_LENGTH}
                    rows={5}
                    placeholder={t("feedback.placeholder")}
                    aria-label={t("feedback.message")}
                    onChange={(event) => {
                      setFeedbackBody(event.target.value);
                      setFeedbackNotice("");
                      setFeedbackError("");
                    }}
                  />
                  <span className="settings-panel__feedback-meta">
                    {showFeedbackMinHint ? (
                      <span
                        className="settings-panel__feedback-min"
                        data-settings-feedback-min="true"
                        aria-live="polite"
                      >
                        {t("feedback.minHint")}
                      </span>
                    ) : null}
                    <span className="settings-panel__hint">
                      {feedbackLength}/{FEEDBACK_MAX_LENGTH}
                    </span>
                  </span>
                </label>
                {feedbackNotice ? (
                  <p className="settings-panel__feedback-success" role="status">
                    {t(feedbackNotice)}
                  </p>
                ) : null}
                {feedbackError ? (
                  <p className="settings-panel__feedback-error" role="alert">
                    {t(feedbackError)}
                  </p>
                ) : null}
                <button
                  type="submit"
                  className="btn btn--ghost settings-panel__account-btn"
                  data-settings-feedback-submit="true"
                  disabled={!feedbackReady}
                >
                  {feedbackSending ? t("feedback.submitting") : t("feedback.submit")}
                </button>
              </form>
            ) : (
              <p className="settings-panel__hint">{t("feedback.signIn")}</p>
            )}
          </section>

          <section className="settings-panel__rate" data-settings-rate="true">
            <h3 className="settings-panel__label">{t("feedback.rateTitle")}</h3>
            <button
              type="button"
              className="btn btn--ghost settings-panel__account-btn"
              data-settings-rate-btn="true"
              disabled={!canRate}
              onClick={() =>
                tap(() => {
                  openConfiguredStoreListing(getPlatform());
                })
              }
            >
              {canRate ? t("feedback.rateTitle") : t("feedback.rateComingSoon")}
            </button>
            {!canRate ? (
              <p className="settings-panel__hint">{t("home.comingSoonNotice")}</p>
            ) : null}
          </section>

          <nav className="settings-panel__legal" aria-label={t("legal.navAria")}>
            <p className="settings-panel__label">{t("legal.section")}</p>
            <div className="settings-panel__legal-links">
              <a
                href={LEGAL_URLS.privacy}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("legal.privacy")}
              </a>
              <a
                href={LEGAL_URLS.terms}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("legal.terms")}
              </a>
              <a
                href={LEGAL_URLS.support}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("legal.support")}
              </a>
            </div>
          </nav>
        </div>
      </aside>
    </>
  );
}

export default SettingsPanel;
