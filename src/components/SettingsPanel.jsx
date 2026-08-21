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
import { useAuth } from "../auth";
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
  const { session, logout, openCreate, openLogin } = useAuth();
  const [stats, setStats] = useState(() => loadStats());
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) setStats(loadStats());
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

  return (
    <>
      <button
        type="button"
        className={`settings-backdrop${open ? " settings-backdrop--open" : ""}`}
        aria-label={t("common.close")}
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />
      <aside
        className={`settings-panel${open ? " settings-panel--open" : ""}`}
        aria-hidden={!open}
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
