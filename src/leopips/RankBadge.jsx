/**
 * Premium rank badges for Home LVL strip.
 * BRONZE / GOLD / DIAMOND — not emoji.
 */
export function RankBadge({ rank, size = 18, className = "" }) {
  if (!rank) return null;
  const r = String(rank).toUpperCase();
  if (r === "BRONZE") return <BronzeBadge size={size} className={className} />;
  if (r === "GOLD") return <GoldBadge size={size} className={className} />;
  if (r === "DIAMOND") return <DiamondBadge size={size} className={className} />;
  return null;
}

function BronzeBadge({ size, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      data-rank-badge="BRONZE"
    >
      <defs>
        <linearGradient id="bronzeMetal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f0c090" />
          <stop offset="45%" stopColor="#cd7f32" />
          <stop offset="100%" stopColor="#8a4b1a" />
        </linearGradient>
      </defs>
      <path
        d="M16 2.5 L27 7.5 V15.5 C27 22.2 22.4 27.8 16 29.5 C9.6 27.8 5 22.2 5 15.5 V7.5 Z"
        fill="url(#bronzeMetal)"
        stroke="#5c3310"
        strokeWidth="1.2"
      />
      <circle cx="16" cy="15" r="5.2" fill="#5c3310" opacity="0.35" />
      <path
        d="M16 10.2c1.8 0 2.9 1.1 2.9 2.6 0 1.2-.7 2-1.7 2.4l.7 3.6h-3.8l.7-3.6c-1-.4-1.7-1.2-1.7-2.4 0-1.5 1.1-2.6 2.9-2.6z"
        fill="#f6d7b0"
      />
    </svg>
  );
}

function GoldBadge({ size, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      data-rank-badge="GOLD"
    >
      <defs>
        <linearGradient id="goldMetal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffe9a0" />
          <stop offset="40%" stopColor="#f5c542" />
          <stop offset="100%" stopColor="#b8860b" />
        </linearGradient>
      </defs>
      <path
        d="M16 2 L28 7 V16 C28 23.2 22.8 28.6 16 30.2 C9.2 28.6 4 23.2 4 16 V7 Z"
        fill="url(#goldMetal)"
        stroke="#8a6508"
        strokeWidth="1.2"
      />
      <path
        d="M10 12.5 L16 9.5 L22 12.5 L20.5 19.5 H11.5 Z"
        fill="#fff4c2"
        stroke="#8a6508"
        strokeWidth="0.8"
      />
      <circle cx="16" cy="14.5" r="2.2" fill="#8a6508" />
    </svg>
  );
}

function DiamondBadge({ size, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      data-rank-badge="DIAMOND"
    >
      <defs>
        <linearGradient id="diamondFace" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="35%" stopColor="#c9ecff" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <path
        d="M8 10 L12 5 H20 L24 10 L16 27 Z"
        fill="url(#diamondFace)"
        stroke="#1e3a8a"
        strokeWidth="1.1"
      />
      <path d="M8 10 H24 L16 14 Z" fill="#e8f6ff" opacity="0.9" />
      <path d="M12 5 L16 14 L20 5" fill="none" stroke="#93c5fd" strokeWidth="0.9" />
    </svg>
  );
}
