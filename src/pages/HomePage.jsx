import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import {
  homeAvatarLion,
  homeDotOff,
  homeDotOn,
  homeIconAward,
  homeIconBell,
  homeIconCart,
  homeIconCoins,
  homeEarthGlobe,
  homeFriendUsers,
  homeLock3d,
  homeIconHouse,
  homeIconMenu,
  homeIconMenuNav,
  homeIconShield,
  homeIconTrophy,
  homeNavPlayGlow,
  homeOnlineDot,
  homeStoreCoinWrap,
} from "../assets";
import BrandLogo from "../components/BrandLogo";
import SettingsPanel from "../components/SettingsPanel";
import ProfilePanel from "../components/ProfilePanel";
import { resolvePlayerAvatar } from "../auth/avatars.media.js";
import {
  DominoSpread,
  HomeGlyph,
  LeagueEmblem,
  LeagueStars,
  LeoBestPortrait,
  StoreChest,
} from "../components/HomeArt";
import { IconUser } from "../components/Icon";
import {
  AI_DIFFICULTY_STORAGE_KEY,
  DEFAULT_DIFFICULTY,
  normalizeDifficulty,
} from "../game/ai/difficulties.js";
import { useAuth } from "../auth";
import { loadMatch } from "../persistence/index.js";
import { readStorage, writeStorage } from "../utils/storage.js";
import "./HomePage.css";

/**
 * Figma `leodomino-premium` layout preview only.
 * Not persisted, not match state, not a player profile.
 */
const HOME_PREVIEW = Object.freeze({
  notices: "3",
  leoCoins: "5,240",
  level: "12",
  leoPoints: "1,250",
  nextPoints: "1,500",
  lp: "1,250",
  levelFill: 75,
  leagueFill: 75,
  countdown: [
    { value: "02", labelKey: "home.countdownDays" },
    { value: "14", labelKey: "home.countdownHrs" },
    { value: "35", labelKey: "home.countdownMin" },
    { value: "48", labelKey: "home.countdownSec" },
  ],
});

/**
 * Premium Home dashboard — Figma visual shell, existing Home only.
 * PLAY VS LEOBEST is the only live gameplay path.
 */
function HomePage({ onPlayVsLeoBest, onResume, onFindMatch }) {
  const { t } = useI18n();
  const { play, unlock } = useAudio();
  const { session, openLogin } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [canResume, setCanResume] = useState(() => Boolean(loadMatch()));
  const [difficulty, setDifficulty] = useState(() =>
    normalizeDifficulty(readStorage(AI_DIFFICULTY_STORAGE_KEY, DEFAULT_DIFFICULTY))
  );
  const homeRef = useRef(null);

  useEffect(() => {
    setCanResume(Boolean(loadMatch()));
  }, []);

  useEffect(() => {
    setSettingsOpen(false);
    setProfileOpen(false);
  }, [session?.playerId]);

  useEffect(() => {
    const node = homeRef.current;
    if (!node) return undefined;
    const apply = () => {
      const visual = window.visualViewport;
      const height = Math.round(visual?.height || window.innerHeight);
      const offsetTop = Math.round(visual?.offsetTop || 0);
      node.style.setProperty("--home-vvh", `${height}px`);
      node.style.setProperty("--home-vv-top", `${offsetTop}px`);
    };
    apply();
    const visual = window.visualViewport;
    visual?.addEventListener("resize", apply);
    visual?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    return () => {
      visual?.removeEventListener("resize", apply);
      visual?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
    };
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

  const openProfile = () => {
    tap(() => setProfileOpen(true));
  };

  const handleDifficultyChange = (next) => {
    const level = normalizeDifficulty(next);
    setDifficulty(level);
    writeStorage(AI_DIFFICULTY_STORAGE_KEY, level);
  };

  const playVsLeoBest = () => {
    tap(() => onPlayVsLeoBest?.());
  };

  /**
   * Find Match: choose Classic / Haitian / American, then create or join a public request.
   */
  const handlePlayOnline = () => {
    tap(() => onFindMatch?.());
  };

  const goToStore = () => {
    tap(() => {
      document.getElementById("store")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  return (
    <main ref={homeRef} className="home" data-home="true" aria-label={t("home.aria")}>
      <div className="home__atmosphere" aria-hidden="true">
        <div className="home__wood" />
        <div className="home__vignette" />
      </div>

      <div className="home__frame">
      <header className="home__header">
        <button
          type="button"
          className="home__menu-btn"
          onClick={openSettings}
          aria-label={t("common.settings")}
        >
          <HomeGlyph src={homeIconMenu} size={36} />
        </button>
        <div className="home__brand">
          <div className="home__wordmark">
            <p className="home__wordmark-row" aria-label={t("common.brand")}>
              <BrandLogo size="sm" className="home__crest" title={t("common.brand")} decorative />
              <span className="home__wordmark-text">
                <span className="home__wordmark-leo">{t("home.wordmarkLeo")}</span>
                <span className="home__wordmark-domino">{t("home.wordmarkDomino")}</span>
              </span>
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
            <span className="home__bell-glyph">
              <HomeGlyph src={homeIconBell} size={18} />
            </span>
            <span className="home__badge">{HOME_PREVIEW.notices}</span>
          </button>
          <button
            type="button"
            className="home__avatar-btn"
            data-home-cta="account"
            onClick={() => {
              if (session) openProfile();
              else tap(() => openLogin());
            }}
            aria-label={t("home.profile")}
          >
            <img
              className="home__avatar-img"
              src={session ? resolvePlayerAvatar(session.avatarId).src : homeAvatarLion}
              alt=""
              draggable={false}
            />
            <img className="home__online-dot" src={homeOnlineDot} alt="" aria-hidden="true" draggable={false} />
          </button>
        </div>
      </header>

      <section className="home__status" aria-label={t("home.statusAria")}>
        <div className="home__stat home__stat--pill">
          <span className="home__stat-glyph home__stat-glyph--16">
            <HomeGlyph src={homeIconCoins} size={16} />
          </span>
          <span className="home__stat-value">{HOME_PREVIEW.leoCoins}</span>
          <button
            type="button"
            className="home__plus"
            onClick={showComingSoon}
            aria-label={t("home.leoCoins")}
          >
            +
          </button>
        </div>
        <div className="home__stat home__stat--level">
          <span className="home__stat-row">
            <span className="home__stat-glyph home__stat-glyph--14">
              <HomeGlyph src={homeIconShield} size={14} />
            </span>
            <span className="home__stat-value home__stat-value--lvl">
              {t("home.lvl", { n: HOME_PREVIEW.level })}
            </span>
          </span>
          <span className="home__mini-progress home__mini-progress--emerald" aria-hidden="true">
            <span style={{ width: `${HOME_PREVIEW.levelFill}%` }} />
          </span>
        </div>
        <div className="home__stat home__stat--pill">
          <BrandLogo size="sm" className="home__stat-crest" title={t("home.leoPoints")} decorative />
          <div className="home__stat-copy home__stat-copy--lp">
            <span className="home__stat-value home__stat-value--lp">
              {HOME_PREVIEW.leoPoints} {t("home.lp")}
            </span>
            <span className="home__stat-next">{t("home.nextLabel", { n: HOME_PREVIEW.nextPoints })}</span>
          </div>
        </div>
      </section>

      <div className="home__scroll">
        <article className="home__card home__card--league" data-home-card="league">
          <div className="home__league-layout">
            <div className="home__league-art">
              <LeagueStars />
              <LeagueEmblem />
              <p className="home__division-name">{t("home.goldII")}</p>
              <p className="home__eyebrow">{t("home.seasonN", { n: 1 })}</p>
            </div>
            <div className="home__league-copy">
              <h2 className="home__progress-label">{t("home.yourProgress")}</h2>
              <p className="home__lp-hero">
                {HOME_PREVIEW.lp} <span>{t("home.lp")}</span>
              </p>
              <div className="home__progress" aria-hidden="true">
                <span className="home__progress-meta-row">
                  <span className="home__progress-meta">{t("home.lpToGoldIII")}</span>
                  <span className="home__progress-pct">{HOME_PREVIEW.leagueFill}%</span>
                </span>
                <span className="home__progress-track">
                  <span className="home__progress-fill" style={{ width: `${HOME_PREVIEW.leagueFill}%` }} />
                </span>
              </div>
              <button
                type="button"
                className="home__cta home__cta--pea home__cta--league home__cta--chevron"
                data-home-cta="league"
                onClick={showComingSoon}
              >
                {t("home.playLeague")}
              </button>
            </div>
          </div>
        </article>
        <div className="home__dots" aria-hidden="true">
          <img className="home__dot" src={homeDotOn} alt="" width={6} height={6} draggable={false} />
          <img className="home__dot" src={homeDotOff} alt="" width={6} height={6} draggable={false} />
          <img className="home__dot" src={homeDotOff} alt="" width={6} height={6} draggable={false} />
        </div>

        <article className="home__card home__card--play" data-home-card="leoBest">
          <div className="home__leo-layout">
            <div className="home__leo-identity" aria-label={t("game.leoBest")}>
              <LeoBestPortrait />
              <span className="home__ai-chip">{t("home.ai")}</span>
            </div>
            <div className="home__leo-copy">
              <h2 className="home__card-title">{t("home.playVsLeoBest")}</h2>
              <p className="home__card-sub">{t("home.offlineVs")}</p>
              <span className="home__vs-chip">
                <IconUser className="home__vs-icon" />
                {t("home.oneVsOne")}
              </span>
            </div>
            <div className="home__leo-side">
              <DominoSpread />
              <button
                type="button"
                className="home__cta home__cta--emerald home__cta--inline home__cta--chevron"
                data-home-cta="playVsLeoBest"
                onClick={playVsLeoBest}
              >
                {t("game.play")}
              </button>
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
            icon={<HomeGlyph src={homeEarthGlobe} size={40} className="home-mode__earth" />}
            title={t("home.playOnline")}
            subtitle={t("home.playOnlineSub")}
            action={t("home.findMatch")}
            onPress={handlePlayOnline}
          />
          <ModeCard
            id="friend"
            tone="royal"
            icon={<HomeGlyph src={homeFriendUsers} size={40} className="home-mode__glyph-3d" />}
            title={t("home.playFriend")}
            subtitle={t("home.friendSub")}
            action={t("home.invite")}
            onPress={showComingSoon}
          />
          <ModeCard
            id="private"
            tone="violet"
            icon={<HomeGlyph src={homeLock3d} size={40} className="home-mode__glyph-3d" />}
            title={t("home.privateTable")}
            subtitle={t("home.privateTableSub")}
            action={t("home.create")}
            onPress={showComingSoon}
          />
        </section>

        <article className="home__card home__card--promo" id="tournaments" data-home-card="tournaments">
          <div className="home__tourney">
            <span className="home__tourney-icon">
              <HomeGlyph src={homeIconTrophy} size={24} />
            </span>
            <div className="home__tourney-copy">
              <h2 className="home__promo-title">{t("home.tournaments")}</h2>
              <p className="home__card-sub">{t("home.tournamentsLead")}</p>
            </div>
          </div>
          <div className="home__tourney-rule" aria-hidden="true" />
          <div className="home__tourney-meta">
            <div>
              <span className="home__eyebrow">{t("home.nextTournament")}</span>
              <p className="home__tourney-name">{t("home.leoDominoCup")}</p>
            </div>
            <div className="home__countdown" aria-hidden="true">
              {HOME_PREVIEW.countdown.map((slot) => (
                <span key={slot.labelKey} className="home__count">
                  <span className="home__count-value">{slot.value}</span>
                  <span className="home__count-label">{t(slot.labelKey)}</span>
                </span>
              ))}
            </div>
            <button
              type="button"
              className="home__cta home__cta--gold-outline home__cta--mini home__cta--view-all home__cta--chevron"
              onClick={showComingSoon}
            >
              {t("home.viewAll")}
            </button>
          </div>
        </article>

        <article className="home__card home__card--store" id="store" data-home-card="store">
          <button type="button" className="home__promo home__promo--store" onClick={showComingSoon}>
            <img
              className="home__store-wrap"
              src={homeStoreCoinWrap}
              alt=""
              aria-hidden="true"
              draggable={false}
            />
            <div className="home__promo-copy">
              <h2 className="home__promo-title">{t("home.leoCoinsStore")}</h2>
              <p className="home__card-sub">{t("home.storeLead")}</p>
              <span className="home__cta home__cta--mini home__cta--gold-fill home__cta--shop home__cta--chevron">
                {t("home.shopNow")}
              </span>
            </div>
            <StoreChest />
          </button>
        </article>
      </div>

      <nav className="home__nav" aria-label={t("common.navigation")} data-home-nav="true">
        <button type="button" className="home__nav-item home__nav-item--on" aria-current="page">
          <HomeGlyph src={homeIconHouse} size={20} />
          <span>{t("home.navHome")}</span>
        </button>
        <button
          type="button"
          className="home__nav-item"
          data-home-nav-item="league"
          onClick={showComingSoon}
        >
          <HomeGlyph src={homeIconAward} size={20} />
          <span>{t("home.navLeague")}</span>
        </button>
        <button
          type="button"
          className="home__nav-item home__nav-item--play"
          data-home-nav-item="play"
          onClick={playVsLeoBest}
        >
          <span className="home__nav-play" aria-hidden="true">
            <img className="home__nav-play-img" src={homeNavPlayGlow} alt="" draggable={false} />
          </span>
          <span>{t("home.navPlay")}</span>
        </button>
        <button
          type="button"
          className="home__nav-item"
          data-home-nav-item="store"
          onClick={goToStore}
        >
          <span className="home__nav-glyph">
            <HomeGlyph src={homeIconCart} size={20} />
          </span>
          <span>{t("home.navStore")}</span>
        </button>
        <button
          type="button"
          className="home__nav-item"
          data-home-nav-item="menu"
          onClick={openSettings}
        >
          <span className="home__nav-glyph">
            <HomeGlyph src={homeIconMenuNav} size={20} />
          </span>
          <span>{t("home.navMenu")}</span>
        </button>
      </nav>
      </div>

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
      <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} />
    </main>
  );
}

function ModeCard({ id, icon, title, subtitle, action, onPress, tone = "emerald" }) {
  return (
    <button
      type="button"
      className="home-mode"
      id={id}
      data-home-card={id}
      onClick={onPress}
    >
      <span className="home-mode__title">{title}</span>
      <span className="home-mode__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="home-mode__sub">{subtitle}</span>
      <span className={`home-mode__cta home-mode__cta--${tone} home__cta--chevron`}>{action}</span>
    </button>
  );
}

export default HomePage;
