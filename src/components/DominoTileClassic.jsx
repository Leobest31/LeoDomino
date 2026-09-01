import { useI18n } from "../i18n";
import { useCanvasTileRenderer } from "../hooks/useCanvasTileRenderer.js";
import CanvasDominoSurface from "./CanvasDominoSurface.jsx";
import "./Domino.css";

const PIP_MAP = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Half({ value }) {
  return (
    <div className="domino__half" aria-hidden="true">
      <div className="domino__pips">
        {Array.from({ length: 9 }, (_, index) => (
          <span
            key={index}
            className={`domino__pip${PIP_MAP[value]?.includes(index) ? " domino__pip--on" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Classic ivory DominoTile (tournament 2.5D).
 * Size from --domino-w / --domino-h; orientation swaps footprint.
 */
function DominoTileClassic({
  left = 0,
  right = 0,
  faceDown = false,
  orientation = "vertical",
  selected = false,
  /** @deprecated Play tiles ignore size; "sm" is HUD-only (reserve). */
  size = "md",
  className = "",
  onClick,
  onPointerDown,
  label,
  hidden = false,
  tileId,
  boardTileId,
  flipId,
  dragging = false,
  highlighted = false,
  playable = false,
}) {
  const { t } = useI18n();
  // Dev-only: default is always false, so every player sees the CSS
  // renderer unchanged unless a developer explicitly opts in (Phase 1).
  const useCanvas = useCanvasTileRenderer();

  const sizeClass = size === "sm" ? "domino--sm" : "domino--md";

  const classes = [
    "domino",
    `domino--${orientation}`,
    sizeClass,
    faceDown ? "domino--facedown" : "domino--faceup",
    selected ? "domino--selected" : "",
    onClick || onPointerDown ? "domino--interactive" : "",
    hidden || dragging ? "domino--hidden" : "",
    dragging ? "domino--dragging" : "",
    highlighted ? "domino--target" : "",
    playable ? "domino--playable" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const accessibleLabel =
    label ||
    (faceDown
      ? t("game.faceDown")
      : t("game.dominoLabel", { left, right }));

  const faceContent = faceDown ? (
    <div className="domino__back" aria-hidden="true">
      <span className="domino__back-pattern" />
    </div>
  ) : (
    <>
      <Half value={left} />
      <div className="domino__divider" aria-hidden="true" />
      <Half value={right} />
    </>
  );

  const body = (
    <>
      <span className="domino__side domino__side--y" aria-hidden="true" />
      <span className="domino__side domino__side--x" aria-hidden="true" />
      <span className="domino__base" aria-hidden="true" />
      {useCanvas ? (
        <CanvasDominoSurface
          left={left}
          right={right}
          faceDown={faceDown}
          orientation={orientation}
          selected={selected}
          size={size}
        />
      ) : (
        <div className="domino__face">{faceContent}</div>
      )}
    </>
  );

  const dataProps = {
    ...(tileId ? { "data-tile-id": tileId } : {}),
    ...(boardTileId ? { "data-board-tile": boardTileId } : {}),
    ...(flipId ? { "data-flip-id": flipId } : {}),
  };

  if (onClick || onPointerDown) {
    return (
      <button
        type="button"
        className={classes}
        onClick={onClick}
        onPointerDown={onPointerDown}
        aria-label={accessibleLabel}
        aria-pressed={selected}
        {...dataProps}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={classes} role="img" aria-label={accessibleLabel} {...dataProps}>
      {body}
    </div>
  );
}

export default DominoTileClassic;
