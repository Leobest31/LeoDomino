import LeoPipsCoin from "./LeoPipsCoin.jsx";
import communityBanner from "../assets/approved-ui/community-approved.jpeg";
import brandLion from "../assets/approved-ui/brand-lion.png";
import royalEmblem from "../assets/approved-ui/royal-emblem.png";
import leoBest from "../assets/approved-ui/home-leobest.webp";
import earthGlobeSmall from "../assets/home/earth-globe-small.png";
import "./PremiumHomePresentation.css";

function Icon({ name }) {
  const paths = {
    mail: <><rect x="4" y="7" width="24" height="18" rx="3"/><path d="m6 10 10 8 10-8"/></>,
    bell: <><path d="M9 23h14l-2-3v-6a5 5 0 0 0-10 0v6z"/><path d="M14 26h4"/></>,
    gear: <><circle cx="16" cy="16" r="5"/><path d="M16 3v4m0 18v4M3 16h4m18 0h4M7 7l3 3m12 12 3 3M25 7l-3 3M10 22l-3 3"/></>,
    users: <><circle cx="12" cy="12" r="4"/><circle cx="21" cy="13" r="3"/><path d="M4 26c1-6 15-6 16 0m-1-6c5-2 9 1 9 5"/></>,
    table: <><path d="M6 11h20l2 6H4z"/><path d="M8 17v10m16-10v10"/></>,
    trophy: <><path d="M10 5h12v9c0 5-12 5-12 0z"/><path d="M10 8H5c0 5 3 8 7 8m10-8h5c0 5-3 8-7 8M16 18v6m-5 3h10"/></>,
    bag: <><path d="M8 11h16l2 17H6z"/><path d="M12 12V8a4 4 0 0 1 8 0v4"/></>,
    chat: <><path d="M6 8h20a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-8l-5 4v-4H6a3 3 0 0 1-3-3V11a3 3 0 0 1 3-3z"/><path d="M10 14h12M10 18h8"/></>,
    home: <><path d="m4 15 12-10 12 10"/><path d="M7 14v14h18V14M13 28V18h6v10"/></>,
    menu: <path d="M5 8h22M5 16h22M5 24h22"/>,
    play: <path d="m12 7 13 9-13 9z"/>,
  };
  return <svg className={`approved-home__icon approved-home__icon--${name}`} viewBox="0 0 32 32" aria-hidden="true">{paths[name]}</svg>;
}

const rankRanges = [
  ["bronze", "BRONZE", "LVL 1 – 19"],
  ["gold", "GOLD", "LVL 20 – 49"],
  ["diamond", "DIAMOND", "LVL 50 – 100"],
];

export default function PremiumHomePresentation({
  homeRef, isolated, walletStatus, availableLabel, avatar, displayName,
  liveLevel, liveXp, liveRank, liveProgress, winFill, levelSubText,
  bellBadge, chatBadge, showResume, resumeLabel, findMatchLabel, notice,
  onPlayOnline, onPlayVsLeoBest, onFriends, onNotifications, onProfile,
  onChat, onSettings, onChallenge, onInviteFriends, onResume,
  onNavPlay, previewOnly, run,
}) {
  const levelName = String(liveRank || liveProgress?.rank || "BRONZE").toUpperCase();
  const nextLevel = liveProgress?.nextLevel || Math.min(100, Number(liveLevel || 0) + 1);
  return (
    <main ref={homeRef} className="approved-home" data-home="true" data-leopips-home="true" data-home-structure="premium-v1" data-leopips-isolated={isolated ? "true" : "false"}>
      <div className="approved-home__shell">
        <header className="approved-home__header">
          <div className="approved-home__brand">
            <img src={brandLion} alt="" />
            <div><strong>LEO DOMINO</strong><span>PLAY. WIN. CONNECT.</span><small>JWE. GENYEN. KONEKTE.</small></div>
          </div>
          <div className="approved-home__tools">
            <button type="button" data-home-cta="messages" onClick={() => run(onChat)} aria-label="Messages"><Icon name="mail" />{chatBadge ? <i /> : null}</button>
            <button type="button" data-home-cta="notifications" onClick={() => run(onNotifications)} aria-label="Notifications"><Icon name="bell" />{bellBadge ? <i /> : null}</button>
            <button type="button" data-home-cta="settings" onClick={() => run(onSettings)} aria-label="Settings"><Icon name="gear" /></button>
          </div>
          <div className="approved-home__wallet" data-leopips-home-wallet="true" data-leopips-wallet-status={isolated ? "preview" : walletStatus}>
            <LeoPipsCoin stake={100} size={42} />
            <span><small>LEOPIPS</small><strong>{availableLabel}</strong></span>
            <button type="button" data-leopips-plus="visual-only" onClick={previewOnly} aria-label="LeoPips">+</button>
          </div>
        </header>

        <section className="approved-home__profile" data-leopips-home-level="true" data-progression-level={liveLevel} data-progression-rank={levelName} data-progression-xp={liveXp}>
          <button type="button" className="approved-home__identity" data-home-cta="account" onClick={() => run(onProfile)}>
            <span className="approved-home__avatar"><img src={avatar} alt="" /><i /></span>
            <span><strong>{displayName}</strong><small>LeoDomino Player</small></span>
          </button>
          <div className={`approved-home__progression approved-home__progression--${levelName.toLowerCase()}`}>
            <div className="approved-home__progression-top">
              <img className="approved-home__progression-crest" src={royalEmblem} alt={`${levelName} rank emblem`} />
              <strong className="approved-home__progression-lvl">LVL {liveLevel}</strong>
              <span className="approved-home__progression-xp"><small>XP</small><b>{Number(liveXp || 0).toLocaleString("en-US")}</b></span>
            </div>
            <div className="approved-home__progression-sep" aria-hidden="true"><i /></div>
            <div className="approved-home__progression-plaque">{levelName}</div>
            <div className="approved-home__progression-bottom">
              <span className="approved-home__progress" data-leopips-win-progress="true"><i style={{ width: `${winFill}%` }} /></span>
              <small>{levelSubText || `${liveProgress?.winsInLevel || 0} / 10 WINS TO LVL ${nextLevel}`}</small>
            </div>
          </div>
        </section>

        <section className="approved-home__rank-grid" aria-label="Rank tiers">
          {rankRanges.map(([key, name, range]) => <article key={key} className={`approved-home__tier approved-home__tier--${key}`}><img src={royalEmblem} alt="" /><strong>{name}</strong><span>{range}</span></article>)}
        </section>

        {showResume ? <button type="button" className="approved-home__resume" data-home-cta="resume" onClick={() => run(onResume)}>{resumeLabel}</button> : null}

        <section className="approved-home__modes" aria-label="Play modes">
          <button type="button" className="approved-home__mode approved-home__mode--online" data-leopips-home-play-online="true" onClick={() => run(onPlayOnline)}><img className="approved-home__globe3d" src={earthGlobeSmall} alt="" aria-hidden="true" draggable={false} /><strong>PLAY ONLINE</strong><span>{findMatchLabel || "FIND A MATCH"}</span><b>›</b></button>
          <button type="button" className="approved-home__mode approved-home__mode--friend" data-home-card="friend" onClick={() => run(onFriends)}><Icon name="users" /><strong>PLAY A FRIEND</strong><span>INVITE &amp; PLAY</span><b>›</b></button>
          <button type="button" className="approved-home__mode approved-home__mode--private" data-home-card="private" onClick={previewOnly}><Icon name="table" /><strong>PRIVATE TABLE</strong><span>COMING SOON</span><b>›</b></button>
        </section>

        <button type="button" className="approved-home__leobest" data-home-cta="playVsLeoBest" onClick={() => run(onPlayVsLeoBest)}><img src={leoBest} alt="LeoBest" /><span><strong>PLAY VS LEOBEST</strong><small>PLAY OFFLINE AGAINST LEOBEST AI</small></span><b>PLAY&nbsp; ›</b></button>

        <section className="approved-home__actions">
          <button type="button" data-home-cta="inviteFriends" onClick={() => run(onInviteFriends)}><Icon name="users" /><strong>INVITE<br/>FRIENDS</strong><span>›</span></button>
          <button type="button" data-home-card="challenge" onClick={() => run(onChallenge)}><Icon name="trophy" /><strong>CHALLENGE</strong><span>›</span></button>
          <button type="button" data-home-card="store" onClick={previewOnly}><Icon name="bag" /><strong>LEOPIPS STORE</strong><small>COMING SOON</small><span>›</span></button>
          <button type="button" data-home-cta="liveChat" onClick={() => run(onChat)} aria-label="Live Chat"><Icon name="chat" /><strong>LIVE<br/>CHAT</strong><span>›</span></button>
        </section>

        <figure className="approved-home__community" data-home-section="community"><img src={communityBanner} alt="More than a game. A community." /></figure>
        {notice ? <p className="approved-home__notice" role="status">{notice}</p> : null}

        <nav className="approved-home__nav" data-home-nav="true" aria-label="Main navigation">
          <button type="button" className="active" data-home-nav-item="home" aria-current="page" onClick={() => {}}><Icon name="home" /><span>HOME</span></button>
          <button type="button" data-home-nav-item="league" onClick={previewOnly}><Icon name="trophy" /><span>LEAGUE</span></button>
          <button type="button" className="play" data-home-nav-item="play" onClick={() => run(onNavPlay || onPlayVsLeoBest)}><i><Icon name="play" /></i><span>PLAY</span></button>
          <button type="button" data-home-nav-item="store" onClick={previewOnly}><Icon name="bag" /><span>STORE</span></button>
          <button type="button" data-home-nav-item="menu" onClick={() => run(onSettings)}><Icon name="menu" /><span>MENU</span></button>
        </nav>
      </div>
    </main>
  );
}
