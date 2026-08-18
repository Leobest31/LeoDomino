/**
 * Lightweight SVG icons for the HUD (no icon font dependency).
 */

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export function IconSettings({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true">
      <circle cx="12" cy="12" r="3" {...stroke} />
      <path
        d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"
        {...stroke}
      />
    </svg>
  );
}

export function IconHome({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z" {...stroke} />
    </svg>
  );
}

export function IconClose({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" {...stroke} />
    </svg>
  );
}

export function IconPlay({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.05em" height="1.05em" aria-hidden="true">
      <path d="M8 6.5v11l10-5.5L8 6.5z" {...stroke} />
    </svg>
  );
}

export function IconPlayFill({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true">
      <path fill="currentColor" d="M8.2 5.8v12.4L19.2 12 8.2 5.8z" />
    </svg>
  );
}

export function IconCart({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true">
      <path d="M5 7h15l-1.4 8.2a1.6 1.6 0 0 1-1.6 1.3H8.4A1.6 1.6 0 0 1 6.8 15L5 7z" {...stroke} />
      <path d="M5 7 4.2 4.6H2.8" {...stroke} />
      <circle cx="9" cy="19.2" r="1.15" {...stroke} />
      <circle cx="17" cy="19.2" r="1.15" {...stroke} />
    </svg>
  );
}

export function IconGrid({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true">
      <rect x="4.5" y="4.5" width="6" height="6" rx="1.2" {...stroke} />
      <rect x="13.5" y="4.5" width="6" height="6" rx="1.2" {...stroke} />
      <rect x="4.5" y="13.5" width="6" height="6" rx="1.2" {...stroke} />
      <rect x="13.5" y="13.5" width="6" height="6" rx="1.2" {...stroke} />
    </svg>
  );
}

export function IconShield({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true">
      <path d="M12 3.4 19 6.2v5.4c0 4.4-2.9 7.4-7 8.9-4.1-1.5-7-4.5-7-8.9V6.2L12 3.4z" {...stroke} />
      <path d="M12 8.2v4.6M12 8.2l.9 1.4h-1.8L12 8.2z" {...stroke} />
    </svg>
  );
}

export function IconPlus({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.05em" height="1.05em" aria-hidden="true">
      <path d="M12 6.5v11M6.5 12h11" {...stroke} />
    </svg>
  );
}

export function IconDraw({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.05em" height="1.05em" aria-hidden="true">
      <path d="M12 4v12M8 12l4 4 4-4M5 20h14" {...stroke} />
    </svg>
  );
}

export function IconPass({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.05em" height="1.05em" aria-hidden="true">
      <path d="M5 12h14M15 8l4 4-4 4" {...stroke} />
    </svg>
  );
}

export function IconMute({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true">
      <path d="M4 10v4h3l4 3V7L7 10H4z" {...stroke} />
      <path d="M16 9.5 20.5 14M20.5 9.5 16 14" {...stroke} />
    </svg>
  );
}

export function IconUnmute({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true">
      <path d="M4 10v4h3l4 3V7L7 10H4z" {...stroke} />
      <path d="M15.5 9.5a3.2 3.2 0 0 1 0 5" {...stroke} />
      <path d="M17.8 7.2a6 6 0 0 1 0 9.6" {...stroke} />
    </svg>
  );
}

export function IconMenu({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" {...stroke} />
    </svg>
  );
}

export function IconBell({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true">
      <path d="M6 9.5A6 6 0 0 1 18 9.5c0 4.2 1.5 5.5 1.5 5.5H4.5S6 13.7 6 9.5z" {...stroke} />
      <path d="M10 19a2 2 0 0 0 4 0" {...stroke} />
    </svg>
  );
}

export function IconTrophy({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true">
      <path d="M8 5h8v4a4 4 0 0 1-8 0V5z" {...stroke} />
      <path d="M8 7H5.5A2.5 2.5 0 0 0 8 9.5M16 7h2.5A2.5 2.5 0 0 1 16 9.5" {...stroke} />
      <path d="M12 13v3M9 20h6M10 17h4" {...stroke} />
    </svg>
  );
}

export function IconStore({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true">
      <path d="M4 9.5 6 5h12l2 4.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9.5z" {...stroke} />
      <path d="M4 9.5h16M9 13h6" {...stroke} />
    </svg>
  );
}

export function IconUsers({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true">
      <circle cx="9" cy="8" r="2.4" {...stroke} />
      <path d="M4.5 18c.4-2.8 2.2-4.2 4.5-4.2S13.1 15.2 13.5 18" {...stroke} />
      <circle cx="16.5" cy="9" r="2" {...stroke} />
      <path d="M15 18c.3-1.8 1.4-3 3.2-3.2 1.8.2 2.8 1.4 3.1 3.2" {...stroke} />
    </svg>
  );
}

export function IconGlobe({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true">
      <circle cx="12" cy="12" r="8" {...stroke} />
      <path d="M4.5 12h15M12 4c2.4 2.6 3.6 5.4 3.6 8S14.4 17.4 12 20c-2.4-2.6-3.6-5.4-3.6-8S9.6 6.6 12 4z" {...stroke} />
    </svg>
  );
}

export function IconTable({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true">
      <rect x="4" y="6" width="16" height="12" rx="2" {...stroke} />
      <path d="M4 12h16M12 6v12" {...stroke} />
    </svg>
  );
}

export function IconCoins({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true">
      <ellipse cx="12" cy="8" rx="6.5" ry="3" {...stroke} />
      <path d="M5.5 8v5c0 1.7 2.9 3 6.5 3s6.5-1.3 6.5-3V8" {...stroke} />
      <path d="M5.5 10.6c0 1.7 2.9 3 6.5 3s6.5-1.3 6.5-3" {...stroke} />
    </svg>
  );
}
