import { logoOfficial } from "../assets";
import "./BrandLogo.css";

/** Native crest proportions (official artwork). */
export const CREST_WIDTH = 999;
export const CREST_HEIGHT = 1024;

/**
 * Official LeoDomino crest — exact approved artwork.
 * SVG shell + embedded image: scales crisply, never stretches.
 */
function BrandLogo({ size = "md", className = "", title, decorative = false }) {
  const label = title ?? "LeoDomino";

  return (
    <svg
      className={`brand-logo brand-logo--${size}${className ? ` ${className}` : ""}`}
      viewBox={`0 0 ${CREST_WIDTH} ${CREST_HEIGHT}`}
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : label}
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      {!decorative ? <title>{label}</title> : null}
      <image
        href={logoOfficial}
        width={CREST_WIDTH}
        height={CREST_HEIGHT}
        preserveAspectRatio="xMidYMid meet"
      />
    </svg>
  );
}

export default BrandLogo;
