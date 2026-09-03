import { useEffect, useRef, useState } from "react";
import {
  homeAvatarLion,
  homeDotOff,
  homeDotOn,
  homeEarthGlobe,
  homeFriendUsers,
  homeIconAward,
  homeIconBell,
  homeIconCart,
  homeIconHouse,
  homeIconMenu,
  homeIconMenuNav,
  homeIconShield,
  homeIconTrophy,
  homeLock3d,
  homeNavPlayGlow,
  homeOnlineDot,
  homeStoreCoinWrap,
} from "../assets";
import BrandLogo from "../components/BrandLogo";
import {
  DominoSpread,
  HomeGlyph,
  LeagueEmblem,
  LeagueStars,
  LeoBestPortrait,
  StoreChest,
} from "../components/HomeArt";
import { IconChat, IconUser } from "../components/Icon";
import LeoPipsCoin from "./LeoPipsCoin.jsx";
import { LEOPIPS_COPY } from "./leopipsCopy.js";
import {
  LEOPIPS_HOME_PREVIEW,
  clampLeoPipsBalance,
  formatLeoPipsAmount,
} from "./leopipsEconomy.js";
import "../pages/HomePage.css";
import "./LeoPipsHomePage.css";

/**
 * Isolated LeoPips Home preview. Reuses the live Home visual standard.
 * Not imported by App.jsx or the real HomePage.
 */
function LeoPipsHomePage({ balance = 0, onPlayOnline }) {
  const available = clampLeoPipsBalance(balance);
  const [notice, setNotice] = useState("");
  const homeRef = useRef(null);

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

  const previewOnly = () => setNotice(LEOPIPS_COPY.previewNotice);

  return (
    <main
      ref={homeRef}
      className="home leopips-home"
      data-home="true"
      data-leopips-home="true"
      data-leopips-isolated="true"
      aria-label={LEOPIPS_COPY.homeAria}
    >
      <div className="home__atmosphere" aria-hidden="true">
        <div className="home__wood" />
        <div className="home__vignette" />
      </div>

      <div className="home__frame">
        <header className="home__header">
          <button
            type="button"
            className="home__menu-btn"
            onClick={previewOnly}
            aria-label={LEOPIPS_COPY.settings}
          >
            <HomeGlyph src={homeIconMenu} size={36} />
          </button>
          <div className="home__brand">
            <div className="home__wordmark">
              <p className="home__wordmark-row" aria-label="LeoDomino">
                <BrandLogo size="sm" className="home__crest" title="LeoDomino" decorative />
                <span className="home__wordmark-text">
                  <span className="home__wordmark-leo">{LEOPIPS_COPY.wordmarkLeo}</span>
                  <span className="home__wordmark-domino">{LEOPIPS_COPY.wordmarkDomino}</span>
                </span>
              </p>
              <p className="home__tagline">{LEOPIPS_COPY.homeTagline}</p>
            </div>
          </div>
          <div className="home__header-end">
            <button
              type="button"
              className="home__icon-btn"
              onClick={previewOnly}
              aria-label={LEOPIPS_COPY.liveChat}
            >
              <IconChat className="home__chat-glyph" />
            </button>
            <button
              type="button"
              className="home__icon-btn"
              onClick={previewOnly}
              aria-label={LEOPIPS_COPY.notifications}
            >
              <span className="home__bell-glyph">
                <HomeGlyph src={homeIconBell} size={18} />
              </span>
              <span className="home__badge">3</span>
            </button>
            <button
              type="button"
              className="home__avatar-btn"
              onClick={previewOnly}
              aria-label={LEOPIPS_COPY.profile}
            >
              <img className="home__avatar-img" src={homeAvatarLion} alt="" draggable={false} />
              <img className="home__online-dot" src={homeOnlineDot} alt="" aria-hidden="true" draggable={false} />
            </button>
          </div>
        </header>

        <section className="home__status" aria-label={LEOPIPS_COPY.statusAria}>
          <div className="home__stat home__stat--pill home__stat--pips" data-leopips-home-wallet="true">
            <LeoPipsCoin stake={100} size={24} className="leopips-home__wallet-coin" />
            <div className="home__stat-copy">
              <span className="home__stat-next">{LEOPIPS_COPY.currency}</span>
              <span className="home__stat-value">{formatLeoPipsAmount(available)}</span>
            </div>
            <button
              type="button"
              className="home__plus"
              data-leopips-plus="visual-only"
              aria-label={LEOPIPS_COPY.currency}
              onClick={previewOnly}
            >
              +
            </button>
          </div>
          <div className="home__stat home__stat--level" data-leopips-home-level="true">
            <span className="home__stat-row">
              <span className="home__stat-glyph home__stat-glyph--14">
                <HomeGlyph src={homeIconShield} size={14} />
              </span>
              <span className="home__stat-value home__stat-value--lvl">{LEOPIPS_COPY.levelLabel}</span>
            </span>
            <span className="home__mini-progress home__mini-progress--emerald" aria-hidden="true">
              <span style={{ width: `${LEOPIPS_HOME_PREVIEW.xpFill}%` }} />
            </span>
          </div>
          <div className="home__stat home__stat--pill" data-leopips-home-xp="true">
            <div className="home__stat-copy">
              <span className="home__stat-next">{LEOPIPS_COPY.xpLabel}</span>
              <span className="home__stat-value home__stat-value--lvl">{LEOPIPS_COPY.xpProgress}</span>
            </div>
          </div>
        </section>

        <div className="home__scroll">
          <article className="home__card home__card--league" data-home-card="league">
            <div className="home__league-layout">
              <div className="home__league-art">
                <LeagueStars />
                <LeagueEmblem />
                <p className="home__division-name">{LEOPIPS_HOME_PREVIEW.division}</p>
                <p className="home__eyebrow">{LEOPIPS_COPY.seasonN}</p>
              </div>
              <div className="home__league-copy">
                <h2 className="home__progress-label">{LEOPIPS_COPY.yourProgress}</h2>
                <p className="leopips-home__season-hero">{LEOPIPS_COPY.leagueProgress}</p>
                <div className="home__progress" aria-hidden="true">
                  <span className="home__progress-meta-row">
                    <span className="home__progress-meta">{LEOPIPS_COPY.seasonN}</span>
                    <span className="home__progress-pct">{LEOPIPS_HOME_PREVIEW.leagueFill}%</span>
                  </span>
                  <span className="home__progress-track">
                    <span className="home__progress-fill" style={{ width: `${LEOPIPS_HOME_PREVIEW.leagueFill}%` }} />
                  </span>
                </div>
                <button
                  type="button"
                  className="home__cta home__cta--pea home__cta--league home__cta--chevron"
                  onClick={previewOnly}
                >
                  {LEOPIPS_COPY.playLeague}
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
              <div className="home__leo-identity" aria-label="LeoBest">
                <LeoBestPortrait />
                <span className="home__ai-chip">AI</span>
              </div>
              <div className="home__leo-copy">
                <h2 className="home__card-title">{LEOPIPS_COPY.playVsLeoBest}</h2>
                <p className="home__card-sub">{LEOPIPS_COPY.offlineVs}</p>
                <span className="home__vs-chip">
                  <IconUser className="home__vs-icon" />
                  {LEOPIPS_COPY.oneVsOne}
                </span>
              </div>
              <div className="home__leo-side">
                <DominoSpread />
                <button
                  type="button"
                  className="home__cta home__cta--emerald home__cta--inline home__cta--chevron"
                  onClick={previewOnly}
                >
                  {LEOPIPS_COPY.play}
                </button>
              </div>
            </div>
          </article>

          <section className="home__modes" aria-label="Play modes">
            <ModeCard
              id="online"
              icon={<HomeGlyph src={homeEarthGlobe} size={40} className="home-mode__earth" />}
              title={LEOPIPS_COPY.playOnline}
              subtitle={LEOPIPS_COPY.playOnlineSub}
              action={LEOPIPS_COPY.findMatch}
              onPress={() => onPlayOnline?.()}
              chip="LEOPIPS"
            />
            <ModeCard
              id="friend"
              tone="royal"
              icon={<HomeGlyph src={homeFriendUsers} size={40} className="home-mode__glyph-3d" />}
              title={LEOPIPS_COPY.playFriend}
              subtitle={LEOPIPS_COPY.friendSub}
              action={LEOPIPS_COPY.invite}
              onPress={previewOnly}
            />
            <ModeCard
              id="private"
              tone="violet"
              icon={<HomeGlyph src={homeLock3d} size={40} className="home-mode__glyph-3d" />}
              title={LEOPIPS_COPY.privateTable}
              subtitle={LEOPIPS_COPY.privateTableSub}
              action={LEOPIPS_COPY.create}
              onPress={previewOnly}
            />
          </section>

          <article
            className="home__card home__card--promo leopips-home__reward"
            data-leopips-home-referral="true"
          >
            <div className="leopips-home__reward-copy">
              <p className="home__promo-title">{LEOPIPS_COPY.referralTitle}</p>
              <p className="leopips-home__reward-amount">{LEOPIPS_COPY.referralAmount}</p>
              <p className="home__card-sub">{LEOPIPS_COPY.referralHint}</p>
            </div>
            <LeoPipsCoin stake={100} size={44} className="leopips-home__reward-coin" />
          </article>

          <article
            className="home__card home__card--promo leopips-home__cash"
            data-leopips-home-top-referral="true"
          >
            <span className="home__tourney">
              <span className="home__tourney-icon">
                <HomeGlyph src={homeIconTrophy} size={24} />
              </span>
              <span className="leopips-home__cash-copy">
                <span className="home__eyebrow">{LEOPIPS_COPY.topReferralEyebrow}</span>
                <span className="home__promo-title">{LEOPIPS_COPY.topReferralTitle}</span>
              </span>
            </span>
            <span className="leopips-home__cash-prize">{LEOPIPS_COPY.topReferralPrize}</span>
            <p className="home__card-sub">{LEOPIPS_COPY.topReferralBody}</p>
          </article>

          <button
            type="button"
            className="home__invite-friends"
            data-home-cta="inviteFriends"
            onClick={previewOnly}
          >
            {LEOPIPS_COPY.referralInvite}
          </button>

          <button type="button" className="home__live-chat" onClick={previewOnly}>
            {LEOPIPS_COPY.liveChat}
          </button>

          <button
            type="button"
            className="home__card home__card--promo home__challenge-launch"
            id="challenge"
            data-home-card="challenge"
            onClick={previewOnly}
          >
            <span className="home__tourney">
              <span className="home__tourney-icon">
                <HomeGlyph src={homeIconTrophy} size={24} />
              </span>
              <span className="home__promo-title">{LEOPIPS_COPY.challengeName}</span>
            </span>
            <span className="home__cta home__cta--gold-outline home__cta--mini home__cta--chevron">
              {LEOPIPS_COPY.viewChallenge}
            </span>
          </button>

          <article className="home__card home__card--store" id="store" data-home-card="store">
            <button type="button" className="home__promo home__promo--store" onClick={previewOnly}>
              <img
                className="home__store-wrap"
                src={homeStoreCoinWrap}
                alt=""
                aria-hidden="true"
                draggable={false}
              />
              <div className="home__promo-copy">
                <h2 className="home__promo-title">{LEOPIPS_COPY.leoCoinsStore}</h2>
                <p className="home__card-sub">{LEOPIPS_COPY.storeLead}</p>
                <span className="home__cta home__cta--mini home__cta--gold-fill home__cta--shop home__cta--chevron">
                  {LEOPIPS_COPY.shopNow}
                </span>
              </div>
              <StoreChest />
            </button>
          </article>
        </div>

        <nav className="home__nav" aria-label="Game navigation" data-home-nav="true">
          <button type="button" className="home__nav-item home__nav-item--on" aria-current="page">
            <HomeGlyph src={homeIconHouse} size={20} />
            <span>{LEOPIPS_COPY.navHome}</span>
          </button>
          <button type="button" className="home__nav-item" onClick={previewOnly}>
            <HomeGlyph src={homeIconAward} size={20} />
            <span>{LEOPIPS_COPY.navLeague}</span>
          </button>
          <button type="button" className="home__nav-item home__nav-item--play" onClick={previewOnly}>
            <span className="home__nav-play" aria-hidden="true">
              <img className="home__nav-play-img" src={homeNavPlayGlow} alt="" draggable={false} />
            </span>
            <span>{LEOPIPS_COPY.navPlay}</span>
          </button>
          <button
            type="button"
            className="home__nav-item"
            onClick={() => document.getElementById("store")?.scrollIntoView({ behavior: "smooth", block: "center" })}
          >
            <span className="home__nav-glyph">
              <HomeGlyph src={homeIconCart} size={20} />
            </span>
            <span>{LEOPIPS_COPY.navStore}</span>
          </button>
          <button type="button" className="home__nav-item" onClick={previewOnly}>
            <span className="home__nav-glyph">
              <HomeGlyph src={homeIconMenuNav} size={20} />
            </span>
            <span>{LEOPIPS_COPY.navMenu}</span>
          </button>
        </nav>
      </div>

      {notice ? (
        <p className="home__notice" role="status">
          {notice}
        </p>
      ) : null}
    </main>
  );
}

function ModeCard({ id, icon, title, subtitle, action, onPress, tone = "emerald", chip }) {
  return (
    <button
      type="button"
      className="home-mode"
      id={id}
      data-home-card={id}
      data-leopips-home-play-online={id === "online" ? "true" : undefined}
      onClick={onPress}
    >
      <span className="home-mode__title">{title}</span>
      <span className="home-mode__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="home-mode__sub">{subtitle}</span>
      {chip ? <span className="leopips-home__mode-chip">{chip}</span> : null}
      <span className={`home-mode__cta home-mode__cta--${tone} home__cta--chevron`}>{action}</span>
    </button>
  );
}

export default LeoPipsHomePage;
