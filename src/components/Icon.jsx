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
