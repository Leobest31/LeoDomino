import { logoOfficial, tile36 } from "../assets";
import "./HomeArt.css";

export function GoldCorners() {
  return (
    <span className="home-corners" aria-hidden="true">
      <span className="home-corners__mark home-corners__mark--tl" />
      <span className="home-corners__mark home-corners__mark--tr" />
      <span className="home-corners__mark home-corners__mark--bl" />
      <span className="home-corners__mark home-corners__mark--br" />
    </span>
  );
}

export function LeagueStars({ filled = 4, total = 5 }) {
  return (
    <div className="home-stars" aria-hidden="true">
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={index < filled ? "home-stars__star home-stars__star--on" : "home-stars__star"}
        />
      ))}
    </div>
  );
}

export function LeagueEmblem() {
  return (
    <div className="home-emblem" aria-hidden="true">
      <svg className="home-emblem__svg" viewBox="0 0 160 188">
        <defs>
          <linearGradient id="homeEmblemGold" x1="20" y1="8" x2="140" y2="180">
            <stop offset="0%" stopColor="#f6e7a8" />
            <stop offset="42%" stopColor="#e0b84a" />
            <stop offset="100%" stopColor="#8a6818" />
          </linearGradient>
          <linearGradient id="homeEmblemFace" x1="40" y1="28" x2="120" y2="150">
            <stop offset="0%" stopColor="#1a2a22" />
            <stop offset="100%" stopColor="#070b10" />
          </linearGradient>
        </defs>
        <path
          d="M80 8 L142 28 V88 C142 136 112 164 80 180 C48 164 18 136 18 88 V28 Z"
          fill="url(#homeEmblemFace)"
          stroke="url(#homeEmblemGold)"
          strokeWidth="5"
        />
        <path
          d="M36 118 C52 138 68 148 80 154 C92 148 108 138 124 118"
          fill="none"
          stroke="#2e9a4e"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <path
          d="M40 112 C56 130 70 140 80 145 C90 140 104 130 120 112"
          fill="none"
          stroke="#7adf8d"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <g fill="#ebc84a">
          <polygon points="80,18 83,26 91,26 84.5,31 87,39 80,34 73,39 75.5,31 69,26 77,26" />
          <polygon points="54,26 57,33 64,33 58.5,37 61,44 54,40 47,44 49.5,37 44,33 51,33" />
          <polygon points="106,26 109,33 116,33 110.5,37 113,44 106,40 99,44 101.5,37 96,33 103,33" />
        </g>
      </svg>
      <img className="home-emblem__lion" src={logoOfficial} alt="" draggable={false} />
    </div>
  );
}

export function LeoBestPortrait() {
  return (
    <div className="home-leo-art" aria-hidden="true">
      <span className="home-leo-art__ring">
        <img className="home-leo-art__face" src={logoOfficial} alt="" draggable={false} />
      </span>
    </div>
  );
}

export function DominoSpread() {
  return (
    <div className="home-dominos" aria-hidden="true">
      <img className="home-dominos__tile home-dominos__tile--a" src={tile36} alt="" draggable={false} />
      <img className="home-dominos__tile home-dominos__tile--b" src={tile36} alt="" draggable={false} />
      <img className="home-dominos__tile home-dominos__tile--c" src={tile36} alt="" draggable={false} />
    </div>
  );
}

export function ArtGlobe() {
  return (
    <svg className="home-art-icon" viewBox="0 0 88 88" aria-hidden="true">
      <defs>
        <radialGradient id="homeGlobe" cx="38%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#6ee08a" />
          <stop offset="55%" stopColor="#1a8c40" />
          <stop offset="100%" stopColor="#063816" />
        </radialGradient>
      </defs>
      <circle cx="44" cy="44" r="30" fill="url(#homeGlobe)" stroke="#ebc84a" strokeWidth="2" />
      <ellipse cx="44" cy="44" rx="12" ry="30" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.6" />
      <path d="M14 44h60M18 32h52M18 56h52" fill="none" stroke="rgba(255,245,200,0.28)" strokeWidth="1.4" />
      <ellipse cx="44" cy="44" rx="30" ry="11" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.4" />
    </svg>
  );
}

export function ArtUsers() {
  return (
    <svg className="home-art-icon" viewBox="0 0 88 88" aria-hidden="true">
      <defs>
        <linearGradient id="homeUsers" x1="18" y1="16" x2="70" y2="74">
          <stop offset="0%" stopColor="#7eb6ff" />
          <stop offset="100%" stopColor="#2f7dff" />
        </linearGradient>
      </defs>
      <circle cx="34" cy="32" r="11" fill="url(#homeUsers)" stroke="#d7e8ff" strokeWidth="1.5" />
      <path d="M16 64c2.4-11 9.2-16.5 18-16.5S49.6 53 52 64" fill="url(#homeUsers)" stroke="#d7e8ff" strokeWidth="1.4" />
      <circle cx="56" cy="34" r="9" fill="#1a3f86" stroke="#9cc4ff" strokeWidth="1.5" />
      <path d="M50 64c1.6-8 6.4-12.4 13-12.8 6.8.4 10.8 5 12 12.8" fill="#1a3f86" stroke="#9cc4ff" strokeWidth="1.4" />
    </svg>
  );
}

export function ArtLock() {
  return (
    <svg className="home-art-icon" viewBox="0 0 88 88" aria-hidden="true">
      <defs>
        <linearGradient id="homeLock" x1="24" y1="18" x2="64" y2="74">
          <stop offset="0%" stopColor="#d2b0ff" />
          <stop offset="100%" stopColor="#7a3fd6" />
        </linearGradient>
      </defs>
      <path
        d="M32 40 V30 a12 12 0 0 1 24 0 v10"
        fill="none"
        stroke="#c9a227"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <rect x="24" y="40" width="40" height="32" rx="8" fill="url(#homeLock)" stroke="#ebc84a" strokeWidth="2" />
      <circle cx="44" cy="54" r="4.2" fill="#1a1028" />
      <path d="M44 58 v8" stroke="#1a1028" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function ArtTrophy() {
  return (
    <svg className="home-art-icon home-art-icon--lg" viewBox="0 0 96 96" aria-hidden="true">
      <defs>
        <linearGradient id="homeTrophy" x1="20" y1="8" x2="76" y2="88">
          <stop offset="0%" stopColor="#f6e7a8" />
          <stop offset="50%" stopColor="#e0b84a" />
          <stop offset="100%" stopColor="#8a6818" />
        </linearGradient>
      </defs>
      <path d="M30 18h36v18a18 18 0 0 1-36 0V18z" fill="url(#homeTrophy)" stroke="#f3e2a4" strokeWidth="1.6" />
      <path d="M30 22 H18 a14 14 0 0 0 12 18M66 22 h12 a14 14 0 0 1-12 18" fill="none" stroke="#ebc84a" strokeWidth="4" />
      <path d="M48 54 v12" stroke="#c9a227" strokeWidth="5" />
      <rect x="34" y="66" width="28" height="8" rx="2" fill="url(#homeTrophy)" />
      <rect x="28" y="76" width="40" height="8" rx="3" fill="#c9a227" />
    </svg>
  );
}

export function ArtCoins() {
  return (
    <svg className="home-art-icon home-art-icon--lg" viewBox="0 0 96 96" aria-hidden="true">
      <defs>
        <linearGradient id="homeCoin" x1="16" y1="12" x2="80" y2="84">
          <stop offset="0%" stopColor="#f6e7a8" />
          <stop offset="55%" stopColor="#e0b84a" />
          <stop offset="100%" stopColor="#8a6818" />
        </linearGradient>
      </defs>
      <ellipse cx="40" cy="62" rx="22" ry="12" fill="#8a6818" />
      <ellipse cx="40" cy="56" rx="22" ry="12" fill="url(#homeCoin)" />
      <ellipse cx="58" cy="48" rx="20" ry="11" fill="#8a6818" />
      <ellipse cx="58" cy="42" rx="20" ry="11" fill="url(#homeCoin)" stroke="#f3e2a4" strokeWidth="1.2" />
      <text x="58" y="46" textAnchor="middle" fill="#5a430f" fontSize="14" fontWeight="800" fontFamily="Outfit, sans-serif">
        {"L"}
      </text>
    </svg>
  );
}

export function ArtGift() {
  return (
    <svg className="home-art-icon" viewBox="0 0 88 88" aria-hidden="true">
      <rect x="18" y="38" width="52" height="34" rx="6" fill="#1a8c40" stroke="#ebc84a" strokeWidth="2" />
      <rect x="16" y="30" width="56" height="12" rx="4" fill="#2e9a4e" stroke="#c9a227" strokeWidth="1.5" />
      <rect x="40" y="30" width="8" height="42" fill="#ebc84a" />
      <path d="M44 30 C34 14 22 22 32 32 M44 30 C54 14 66 22 56 32" fill="none" stroke="#f3e2a4" strokeWidth="4" />
    </svg>
  );
}

export function ArtCoinMark() {
  return (
    <svg className="home-coin-mark" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="homeCoinMark" x1="4" y1="2" x2="28" y2="30">
          <stop offset="0%" stopColor="#f6e7a8" />
          <stop offset="100%" stopColor="#c9a227" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="13" fill="url(#homeCoinMark)" stroke="#8a6818" strokeWidth="1.5" />
      <text x="16" y="21" textAnchor="middle" fill="#4a360c" fontSize="14" fontWeight="800" fontFamily="Outfit, sans-serif">
        {"L"}
      </text>
    </svg>
  );
}
