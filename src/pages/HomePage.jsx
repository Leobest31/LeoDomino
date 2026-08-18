import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import BrandLogo from "../components/BrandLogo";
import Avatar from "../components/Avatar";
import SettingsPanel from "../components/SettingsPanel";
import {
  ArtCoinMark,
  ArtCoins,
  ArtGift,
  ArtGlobe,
  ArtLock,
  ArtTrophy,
  ArtUsers,
  DominoSpread,
  GoldCorners,
  LeagueEmblem,
  LeoBestPortrait,
} from "../components/HomeArt";
import {
  IconBell,
  IconCart,
  IconGrid,
  IconHome,
  IconMenu,
  IconPlayFill,
  IconPlus,
  IconShield,
} from "../components/Icon";
import {
  AI_DIFFICULTY_STORAGE_KEY,
  DEFAULT_DIFFICULTY,
  normalizeDifficulty,
} from "../game/ai/difficulties.js";
import { loadMatch, loadHomeProfile } from "../persistence/index.js";
import { readStorage, writeStorage } from "../utils/storage.js";
import "./HomePage.css";

const LEAGUE_SEASON = 1;

/**
 * V1 Home dashboard — premium portrait hub.
 * PLAY VS LEOBEST is the only live gameplay path.
 */
function HomePage({ onPlayVsLeoBest, onResume }) {
  const { t } = useI18n();
  const { play, unlock } = useAudio();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [canResume, setCanResume] = useState(() => Boolean(loadMatch()));
  const [profile, setProfile] = useState(() => loadHomeProfile());
  const [difficulty, setDifficulty] = useState(() =>
    normalizeDifficulty(readStorage(AI_DIFFICULTY_STORAGE_KEY, DEFAULT_DIFFICULTY))
  );

  useEffect(() => {
    setCanResume(Boolean(loadMatch()));
    setProfile(loadHomeProfile());
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

  const lpPct = profile.lpMax > 0 ? Math.min(100, (profile.lp / profile.lpMax) * 100) : 0;
  const lpRemain = Math.max(0, profile.lpMax - profile.lp);

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
          <BrandLogo size="md" className="home__crest" title={t("common.brand")} />
          <p className="home__tagline">{t("home.tagline")}</p>
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
          <GoldCorners />
          <div className="home__stat">
            <ArtCoinMark />
            <span className="home__stat-value">{profile.leoCoins}</span>
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
              <span className="home__stat-value">{profile.level}</span>
            </div>
          </div>
          <div className="home__stat">
            <div className="home__stat-copy home__stat-copy--lp">
              <span className="home__stat-value">
                {profile.lp} {t("home.lp")}
              </span>
              <span
                className="home__mini-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={profile.lpMax}
                aria-valuenow={profile.lp}
                aria-label={t("home.leoPoints")}
              >
                <span style={{ width: `${lpPct}%` }} />
              </span>
              <span className="home__stat-label">{t("home.nextLabel", { n: profile.lpMax })}</span>
            </div>
          </div>
        </section>

        <article className="home__card home__card--league" data-home-card="league">
          <GoldCorners />
          <div className="home__league-layout">
            <div className="home__league-art">
              <LeagueEmblem />
              <p className="home__division-name">{t("home.leagueDivision")}</p>
            </div>
            <div className="home__league-copy">
              <span className="home__eyebrow">{t("home.leagueSeason", { n: LEAGUE_SEASON })}</span>
              <h2 className="home__kicker">{t("home.yourProgress")}</h2>
              <p className="home__lp-hero">
                {profile.lp} {t("home.lp")}
              </p>
              <div
                className="home__progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={profile.lpMax}
                aria-valuenow={profile.lp}
                aria-label={t("home.leoPoints")}
              >
                <span className="home__progress-fill" style={{ width: `${lpPct}%` }} />
              </div>
              <p className="home__progress-meta">{t("home.lpToNext", { n: lpRemain })}</p>
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
          <div className="home__dots" aria-hidden="true">
            <span className="home__dot home__dot--on" />
            <span className="home__dot" />
            <span className="home__dot" />
            <span className="home__dot" />
            <span className="home__dot" />
          </div>
        </article>

        <article className="home__card home__card--play" data-home-card="leoBest">
          <GoldCorners />
          <div className="home__leo-layout">
            <div className="home__leo-identity">
              <LeoBestPortrait />
              <span className="home__ai-chip">
                {t("game.leoBest")} {t("home.ai")}
              </span>
            </div>
            <div className="home__leo-copy">
              <h2 className="home__card-title">{t("home.playVsLeoBest")}</h2>
              <p className="home__card-sub">{t("home.offlineVs")}</p>
              <span className="home__vs-chip">{t("home.oneVsOne")}</span>
            </div>
            <DominoSpread />
          </div>
          <button
            type="button"
            className="home__cta home__cta--gold"
            data-home-cta="playVsLeoBest"
            onClick={() => tap(() => onPlayVsLeoBest?.())}
          >
            {t("game.play")}
          </button>
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
            action={t("home.findMatch")}
            onPress={showComingSoon}
          />
          <ModeCard
            id="friend"
            tone="blue"
            icon={<ArtUsers />}
            title={t("home.playFriend")}
            action={t("home.invite")}
            onPress={showComingSoon}
          />
          <ModeCard
            id="private"
            tone="purple"
            icon={<ArtLock />}
            title={t("home.privateTable")}
            action={t("home.create")}
            onPress={showComingSoon}
          />
        </section>

        <article className="home__card home__card--promo" id="tournaments" data-home-card="tournaments">
          <GoldCorners />
          <button type="button" className="home__promo" onClick={showComingSoon}>
            <ArtTrophy />
            <div className="home__promo-copy">
              <span className="home__eyebrow">{t("home.nextTournament")}</span>
              <h2 className="home__promo-title">{t("home.leoDominoCup")}</h2>
            </div>
            <span className="home__cta home__cta--mini home__cta--purple">{t("home.viewAll")}</span>
          </button>
        </article>

        <article className="home__card home__card--store" id="store" data-home-card="store">
          <GoldCorners />
          <button type="button" className="home__promo home__promo--store" onClick={showComingSoon}>
            <ArtCoins />
            <div className="home__promo-copy">
              <h2 className="home__promo-title">{t("home.leoCoinsStore")}</h2>
              <span className="home__cta home__cta--mini home__cta--green">{t("home.shopNow")}</span>
            </div>
            <ArtGift />
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
          className="home__nav-item"
          data-home-nav-item="league"
          onClick={showComingSoon}
        >
          <IconShield />
          <span>{t("home.navLeague")}</span>
        </button>
        <button
          type="button"
          className="home__nav-play"
          data-home-nav-item="play"
          aria-label={t("home.navPlay")}
          onClick={() => tap(() => onPlayVsLeoBest?.())}
        >
          <IconPlayFill />
        </button>
        <button
          type="button"
          className="home__nav-item"
          data-home-nav-item="store"
          onClick={showComingSoon}
        >
          <IconCart />
          <span>{t("home.navStore")}</span>
        </button>
        <button
          type="button"
          className="home__nav-item"
          data-home-nav-item="menu"
          onClick={openSettings}
        >
          <IconGrid />
          <span>{t("home.navMenu")}</span>
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

function ModeCard({ id, tone, icon, title, action, onPress }) {
  return (
    <button
      type="button"
      className={`home-mode home-mode--${tone}`}
      id={id}
      data-home-card={id}
      onClick={onPress}
    >
      <GoldCorners />
      <span className="home-mode__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="home-mode__title">{title}</span>
      <span className={`home-mode__cta home-mode__cta--${tone}`}>{action}</span>
    </button>
  );
}

export default HomePage;
