import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import BrandLogo from "../components/BrandLogo";
import Avatar from "../components/Avatar";
import SettingsPanel from "../components/SettingsPanel";
import {
  ArtCoinMark,
  ArtCoins,
  ArtGlobe,
  ArtLock,
  ArtTrophy,
  ArtUsers,
  DominoSpread,
  GoldCorners,
  LeagueEmblem,
  LeagueStars,
  LeoBestPortrait,
} from "../components/HomeArt";
import {
  IconBell,
  IconHome,
  IconMenu,
  IconPlayFill,
  IconPlus,
  IconShield,
  IconUser,
  IconUsers,
} from "../components/Icon";
import {
  AI_DIFFICULTY_STORAGE_KEY,
  DEFAULT_DIFFICULTY,
  normalizeDifficulty,
} from "../game/ai/difficulties.js";
import { loadMatch } from "../persistence/index.js";
import { readStorage, writeStorage } from "../utils/storage.js";
import "./HomePage.css";

/**
 * Figma `leodomino-full-reproduction` layout preview only.
 * Not persisted, not match state, not a player profile.
 */
const HOME_PREVIEW = Object.freeze({
  leoCoins: "5,240",
  level: "12",
  leoPoints: "1,250",
  nextPoints: "1,500",
  lp: "1,250",
  pointsFill: 72,
  leagueFill: 75,
  countdown: [
    { value: "02", labelKey: "home.countdownDays" },
    { value: "14", labelKey: "home.countdownHrs" },
    { value: "35", labelKey: "home.countdownMin" },
    { value: "48", labelKey: "home.countdownSec" },
  ],
});

/**
 * V1 Home dashboard — Figma visual shell, existing Home only.
 * PLAY VS LEOBEST is the only live gameplay path.
 */
function HomePage({ onPlayVsLeoBest, onResume }) {
  const { t } = useI18n();
  const { play, unlock } = useAudio();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [canResume, setCanResume] = useState(() => Boolean(loadMatch()));
  const [difficulty, setDifficulty] = useState(() =>
    normalizeDifficulty(readStorage(AI_DIFFICULTY_STORAGE_KEY, DEFAULT_DIFFICULTY))
  );

  useEffect(() => {
    setCanResume(Boolean(loadMatch()));
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const tap = (fn) => {
    unlock();
    play("button");
    fn?.();
  };

  const showComingSoon = () => {
    tap(() => setNotice(t("home.comingSoonNotice")));
  };

  const openSettings = () => {
    tap(() => setSettingsOpen(true));
  };

  const handleDifficultyChange = (next) => {
    const level = normalizeDifficulty(next);
    setDifficulty(level);
    writeStorage(AI_DIFFICULTY_STORAGE_KEY, level);
  };

  const playVsLeoBest = () => {
    tap(() => onPlayVsLeoBest?.());
  };

  return (
    <main className="home" data-home="true" aria-label={t("home.aria")}>
      <div className="home__atmosphere" aria-hidden="true">
        <div className="home__wood" />
        <div className="home__vignette" />
      </div>

      <header className="home__header">
        <button
          type="button"
          className="home__icon-btn"
          onClick={openSettings}
          aria-label={t("common.settings")}
        >
          <IconMenu />
        </button>
        <div className="home__brand">
          <BrandLogo size="md" className="home__crest" title={t("common.brand")} decorative />
          <div className="home__wordmark">
            <p className="home__wordmark-row" aria-label={t("common.brand")}>
              <span className="home__wordmark-leo">{t("home.wordmarkLeo")}</span>
              <span className="home__wordmark-domino">{t("home.wordmarkDomino")}</span>
            </p>
            <p className="home__tagline">{t("home.tagline")}</p>
          </div>
        </div>
        <div className="home__header-end">
          <button
            type="button"
            className="home__icon-btn"
            onClick={showComingSoon}
            aria-label={t("home.notifications")}
          >
            <IconBell />
          </button>
          <button
            type="button"
            className="home__avatar-btn"
            onClick={openSettings}
            aria-label={t("home.profile")}
          >
            <Avatar label={t("game.you")} tone="player" size="sm" />
            <span className="home__online-dot" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="home__scroll">
        <section className="home__status" aria-label={t("home.statusAria")}>
          <div className="home__stat">
            <ArtCoinMark />
            <div className="home__stat-copy">
              <span className="home__stat-label">{t("home.leoCoins")}</span>
              <span className="home__stat-value">{HOME_PREVIEW.leoCoins}</span>
            </div>
            <button
              type="button"
              className="home__plus"
              onClick={showComingSoon}
              aria-label={t("home.leoCoins")}
            >
              <IconPlus />
            </button>
          </div>
          <div className="home__stat">
            <IconShield className="home__stat-icon" />
            <div className="home__stat-copy">
              <span className="home__stat-label">{t("home.level")}</span>
              <span className="home__stat-value">{HOME_PREVIEW.level}</span>
            </div>
          </div>
          <div className="home__stat">
            <div className="home__stat-copy home__stat-copy--lp">
              <span className="home__stat-row">
                <span className="home__stat-label">{t("home.leoPoints")}</span>
                <span className="home__stat-value home__stat-value--gold">{HOME_PREVIEW.leoPoints}</span>
              </span>
              <span className="home__mini-progress" aria-hidden="true">
                <span style={{ width: `${HOME_PREVIEW.pointsFill}%` }} />
              </span>
              <span className="home__stat-next">{t("home.nextLabel", { n: HOME_PREVIEW.nextPoints })}</span>
            </div>
          </div>
        </section>

        <article className="home__card home__card--league" data-home-card="league">
          <GoldCorners />
          <div className="home__league-layout">
            <div className="home__league-art">
              <span className="home__eyebrow">{t("home.leagueSeason", { n: 1 })}</span>
              <LeagueEmblem />
              <LeagueStars />
              <p className="home__division-name">{t("home.goldII")}</p>
            </div>
            <div className="home__league-copy">
              <h2 className="home__progress-label">{t("home.yourProgress")}</h2>
              <p className="home__lp-hero">
                {HOME_PREVIEW.lp} <span>{t("home.lp")}</span>
              </p>
              <p className="home__progress-meta">{t("home.lpToGoldIII")}</p>
              <div className="home__progress" aria-hidden="true">
                <span className="home__progress-track">
                  <span className="home__progress-fill" style={{ width: `${HOME_PREVIEW.leagueFill}%` }} />
                </span>
                <IconShield className="home__progress-icon" />
              </div>
              <button
                type="button"
                className="home__cta home__cta--green"
                data-home-cta="league"
                onClick={showComingSoon}
              >
                {t("home.playLeague")}
              </button>
            </div>
          </div>
        </article>
        <div className="home__dots" aria-hidden="true">
          <span className="home__dot home__dot--on" />
          <span className="home__dot" />
          <span className="home__dot" />
          <span className="home__dot" />
          <span className="home__dot" />
        </div>

        <article className="home__card home__card--play" data-home-card="leoBest">
          <GoldCorners />
          <div className="home__leo-layout">
            <div className="home__leo-identity">
              <LeoBestPortrait />
              <span className="home__leo-name-row">
                <span className="home__leo-name">{t("game.leoBest")}</span>
                <span className="home__ai-chip">{t("home.ai")}</span>
              </span>
            </div>
            <div className="home__leo-copy">
              <h2 className="home__card-title">{t("home.playVsLeoBest")}</h2>
              <p className="home__card-sub">{t("home.offlineVs")}</p>
              <div className="home__leo-meta">
                <span className="home__vs-chip">
                  <IconUsers className="home__vs-icon" />
                  {t("home.oneVsOne")}
                </span>
                <DominoSpread />
                <button
                  type="button"
                  className="home__cta home__cta--gold home__cta--inline"
                  data-home-cta="playVsLeoBest"
                  onClick={playVsLeoBest}
                >
                  {t("game.play")}
                </button>
              </div>
            </div>
          </div>
        </article>

        {canResume ? (
          <button
            type="button"
            className="home__resume"
            data-home-cta="resume"
            onClick={() => tap(() => onResume?.())}
          >
            {t("setup.resumeMatch")}
          </button>
        ) : null}

        <section className="home__modes" aria-label={t("setup.comingSoonLegend")}>
          <ModeCard
            id="online"
            tone="green"
            icon={<ArtGlobe />}
            title={t("home.playOnline")}
            subtitle={t("home.playOnlineSub")}
            action={t("home.findMatch")}
            onPress={showComingSoon}
          />
          <ModeCard
            id="friend"
            tone="blue"
            icon={<ArtUsers />}
            title={t("home.playFriend")}
            subtitle={t("home.friendSub")}
            action={t("home.invite")}
            onPress={showComingSoon}
          />
          <ModeCard
            id="private"
            tone="purple"
            icon={<ArtLock />}
            title={t("home.privateTable")}
            subtitle={t("home.privateTableSub")}
            action={t("home.create")}
            onPress={showComingSoon}
          />
        </section>

        <article className="home__card home__card--promo" id="tournaments" data-home-card="tournaments">
          <GoldCorners />
          <div className="home__tourney">
            <ArtTrophy />
            <div className="home__tourney-copy">
              <h2 className="home__promo-title">{t("home.tournaments")}</h2>
              <p className="home__card-sub">{t("home.tournamentsLead")}</p>
              <div className="home__tourney-rule" aria-hidden="true" />
              <div className="home__tourney-meta">
                <div>
                  <span className="home__eyebrow">{t("home.nextTournament")}</span>
                  <p className="home__tourney-name">{t("home.leoDominoCup")}</p>
                </div>
                <div className="home__countdown" aria-hidden="true">
                  {HOME_PREVIEW.countdown.map((slot, index) => (
                    <span key={slot.labelKey} className="home__countdown-group">
                      {index > 0 ? <span className="home__countdown-sep">:</span> : null}
                      <span className="home__count">
                        <span className="home__count-value">{slot.value}</span>
                        <span className="home__count-label">{t(slot.labelKey)}</span>
                      </span>
                    </span>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="home__cta home__cta--purple"
                onClick={showComingSoon}
              >
                {t("home.viewAll")}
              </button>
            </div>
          </div>
        </article>

        <article className="home__card home__card--store" id="store" data-home-card="store">
          <button type="button" className="home__promo home__promo--store" onClick={showComingSoon}>
            <ArtCoins />
            <div className="home__promo-copy">
              <h2 className="home__promo-title home__promo-title--green">{t("home.leoCoinsStore")}</h2>
              <p className="home__card-sub">{t("home.storeLead")}</p>
            </div>
            <span className="home__cta home__cta--mini home__cta--purple">{t("home.shopNow")}</span>
          </button>
        </article>
      </div>

      <nav className="home__nav" aria-label={t("common.navigation")} data-home-nav="true">
        <button type="button" className="home__nav-item home__nav-item--on" aria-current="page">
          <IconHome />
          <span>{t("home.navHome")}</span>
        </button>
        <button
          type="button"
          className="home__nav-item home__nav-item--play"
          data-home-nav-item="play"
          onClick={playVsLeoBest}
        >
          <span className="home__nav-play" aria-hidden="true">
            <IconPlayFill />
          </span>
          <span>{t("home.navPlay")}</span>
        </button>
        <button
          type="button"
          className="home__nav-item"
          data-home-nav-item="friends"
          onClick={showComingSoon}
        >
          <IconUsers />
          <span>{t("home.navFriends")}</span>
        </button>
        <button
          type="button"
          className="home__nav-item"
          data-home-nav-item="league"
          onClick={showComingSoon}
        >
          <IconShield />
          <span>{t("home.navLeague")}</span>
        </button>
        <button
          type="button"
          className="home__nav-item"
          data-home-nav-item="profile"
          onClick={openSettings}
        >
          <IconUser />
          <span>{t("home.navProfile")}</span>
        </button>
      </nav>

      {notice ? (
        <p className="home__notice" role="status">
          {notice}
        </p>
      ) : null}

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        difficulty={difficulty}
        onDifficultyChange={handleDifficultyChange}
      />
    </main>
  );
}

function ModeCard({ id, tone, icon, title, subtitle, action, onPress }) {
  return (
    <button
      type="button"
      className={`home-mode home-mode--${tone}`}
      id={id}
      data-home-card={id}
      onClick={onPress}
    >
      <GoldCorners />
      <span className="home-mode__title">{title}</span>
      <span className="home-mode__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="home-mode__sub">{subtitle}</span>
      <span className={`home-mode__cta home-mode__cta--${tone}`}>{action}</span>
    </button>
  );
}

export default HomePage;
