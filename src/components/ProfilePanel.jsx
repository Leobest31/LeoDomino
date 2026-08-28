import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import { AUTH_ERROR, DEFAULT_AVATAR_ID, useAuth } from "../auth";
import { PLAYER_AVATARS } from "../auth/avatars.media.js";
import { countryFlag, countryName } from "../auth/countries.js";
import { validateUsername } from "../auth/validation.js";
import CountryPicker from "./CountryPicker";
import PlayerAvatar from "./PlayerAvatar";
import { IconClose } from "./Icon";
import { isReferralSuccessNotice } from "../online/referrals.js";
import { getMyGlobalRating, subscribeGlobalRatingRefresh } from "../online/globalRp.js";
import "./ProfilePanel.css";

function ProfilePanel({ open, onClose, referral }) {
  const { t, locale, formatNumber } = useI18n();
  const { play } = useAudio();
  const { session, updateProfile, busy } = useAuth();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarId, setAvatarId] = useState(DEFAULT_AVATAR_ID);
  const [countryCode, setCountryCode] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [rating, setRating] = useState(null);
  const [ratingStatus, setRatingStatus] = useState("idle");

  useEffect(() => {
    if (!open || !session) return;
    const handle = session.username || "";
    setUsername(validateUsername(handle) ? "" : handle);
    setDisplayName(session.displayName || session.username || "");
    setAvatarId(session.avatarId || DEFAULT_AVATAR_ID);
    setCountryCode(session.countryCode || "");
    setError("");
    setSaved(false);
  }, [open, session]);

  const loadRating = useCallback(async () => {
    if (!open || !session?.playerId) {
      setRating(null);
      setRatingStatus("idle");
      return;
    }
    setRating(null);
    setRatingStatus("loading");
    try {
      const next = await getMyGlobalRating();
      setRating(next);
      setRatingStatus("ready");
    } catch {
      setRating(null);
      setRatingStatus("unavailable");
    }
  }, [open, session?.playerId]);

  useEffect(() => {
    void loadRating();
    if (!open || !session?.playerId) return undefined;
    return subscribeGlobalRatingRefresh(() => {
      void loadRating();
    });
  }, [loadRating, open, session?.playerId]);

  if (!open || !session) return null;

  const flag = countryFlag(countryCode);
  const country = countryName(countryCode, locale);

  const save = async (event) => {
    event.preventDefault();
    play("button");
    setError("");
    setSaved(false);
    try {
      await updateProfile({ username, displayName, avatarId, countryCode });
      setSaved(true);
    } catch (err) {
      setError(err?.code || AUTH_ERROR.GENERIC);
    }
  };

  return (
    <div className="profile-panel" role="dialog" aria-modal="true" aria-label={t("profile.title")}>
      <button type="button" className="profile-panel__backdrop" aria-label={t("common.close")} onClick={onClose} />
      <section className="profile-panel__sheet">
        <header className="profile-panel__header">
          <h2>{t("profile.title")}</h2>
          <button type="button" className="profile-panel__close" onClick={onClose} aria-label={t("common.close")}>
            <IconClose />
          </button>
        </header>
        <div className="profile-panel__hero">
          <PlayerAvatar avatarId={avatarId} size="md" alt="" />
          <p className="profile-panel__name">{displayName || session.displayName}</p>
          {username ? (
            <p className="profile-panel__handle" data-profile-handle="true">
              @{username}
            </p>
          ) : null}
          <p className="profile-panel__country">
            {flag ? (
              <>
                <span className="profile-panel__flag" aria-hidden="true">{flag}</span>
                <span>{country}</span>
              </>
            ) : (
              t("auth.countryPlaceholder")
            )}
          </p>
        </div>
        <section
          className="profile-panel__global-rp"
          data-global-rp="true"
          data-global-rp-status={ratingStatus}
          aria-label={t("profile.globalRanking")}
          aria-busy={ratingStatus === "loading" ? "true" : undefined}
        >
          <h3>{t("profile.globalRanking")}</h3>
          {ratingStatus === "unavailable" ? (
            <p className="profile-panel__global-rp-unavailable" data-global-rp-unavailable="true">
              {t("profile.ratingUnavailable")}
            </p>
          ) : ratingStatus === "ready" && rating ? (
            <dl className="profile-panel__global-rp-stats">
              <div>
                <dt>{t("profile.globalRank")}</dt>
                <dd data-global-rp-rank="true">{t("profile.rankValue", { n: formatNumber(rating.globalRank) })}</dd>
              </div>
              <div>
                <dt>{t("profile.rp")}</dt>
                <dd data-global-rp-value="true">{t("profile.rpAmount", { n: formatNumber(rating.rp) })}</dd>
              </div>
              <div>
                <dt>{t("profile.matchesPlayed")}</dt>
                <dd data-global-rp-matches="true">{formatNumber(rating.matchesPlayed)}</dd>
              </div>
              <div>
                <dt>{t("profile.wins")}</dt>
                <dd data-global-rp-wins="true">{formatNumber(rating.wins)}</dd>
              </div>
              <div>
                <dt>{t("profile.losses")}</dt>
                <dd data-global-rp-losses="true">{formatNumber(rating.losses)}</dd>
              </div>
              <div>
                <dt>{t("profile.winRate")}</dt>
                <dd data-global-rp-winrate="true">
                  {formatNumber(rating.winRate, { style: "percent", maximumFractionDigits: 0 })}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="profile-panel__global-rp-loading" data-global-rp-loading="true" />
          )}
        </section>
        {referral ? (
          <section className="profile-panel__referral" data-referral="true" aria-label={t("referral.title")}>
            <h3>{t("referral.title")}</h3>
            <p className="profile-panel__referral-label">{t("referral.yourCode")}</p>
            <p className="profile-panel__referral-code" data-referral-code="true">
              {referral.code || "————"}
            </p>
            <div className="profile-panel__referral-actions">
              <button
                type="button"
                className="profile-panel__referral-copy"
                data-referral-copy="true"
                disabled={!referral.code || referral.busy}
                onClick={() => {
                  play("button");
                  void referral.copyCode();
                }}
              >
                {t("referral.copy")}
              </button>
              <button
                type="button"
                className="profile-panel__friends"
                data-referral-invite="true"
                disabled={referral.busy}
                onClick={() => {
                  play("button");
                  void referral.inviteFriends();
                }}
              >
                {t("referral.inviteFriends")}
              </button>
            </div>
            {referral.noticeKey ? (
              <p
                className={`profile-panel__referral-status${isReferralSuccessNotice(referral.noticeKey) ? "" : " is-error"}`}
                role="status"
                data-referral-notice="true"
              >
                {t(referral.noticeKey)}
              </p>
            ) : null}
          </section>
        ) : null}
        <form className="profile-panel__form" onSubmit={save}>
          <label className="profile-panel__field">
            <span>{t("auth.username")}</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              spellCheck={false}
              data-profile-username="true"
            />
            <span className="profile-panel__hint">{t("auth.usernameHint")}</span>
          </label>
          <label className="profile-panel__field">
            <span>{t("auth.displayName")}</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="nickname"
              data-profile-display-name="true"
            />
          </label>
          <div className="profile-panel__field">
            <span>{t("auth.avatar")}</span>
            <div className="profile-panel__avatars" role="listbox" aria-label={t("auth.avatar")}>
              {PLAYER_AVATARS.map((avatar) => {
                const selected = avatar.id === avatarId;
                return (
                  <button
                    key={avatar.id}
                    type="button"
                    className={`profile-panel__avatar${selected ? " is-selected" : ""}`}
                    role="option"
                    aria-selected={selected}
                    aria-label={t("auth.avatarChoice")}
                    onClick={() => setAvatarId(avatar.id)}
                  >
                    <img src={avatar.src} alt="" draggable={false} />
                  </button>
                );
              })}
            </div>
          </div>
          <label className="profile-panel__field">
            <span>{t("auth.country")}</span>
            <CountryPicker value={countryCode} onChange={setCountryCode} error={error === AUTH_ERROR.COUNTRY} />
          </label>
          {error ? (
            <p className="profile-panel__error" role="alert">
              {t(
                error === AUTH_ERROR.USERNAME
                  ? "auth.errorUsername"
                  : error === AUTH_ERROR.USERNAME_TAKEN
                    ? "auth.errorUsernameTaken"
                    : error === AUTH_ERROR.DISPLAY_NAME
                      ? "auth.errorDisplayName"
                      : error === AUTH_ERROR.COUNTRY
                        ? "auth.errorCountry"
                        : "auth.errorGeneric"
              )}
            </p>
          ) : null}
          {saved ? <p className="profile-panel__saved">{t("profile.saved")}</p> : null}
          <button type="submit" className="profile-panel__save" disabled={busy}>
            {t("profile.save")}
          </button>
        </form>
      </section>
    </div>
  );
}

export default ProfilePanel;
