import { useI18n } from "../i18n";
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
 * Visual domino tile with selection / hover / touch motion hooks.
 */
function Domino({
  left = 0,
  right = 0,
  faceDown = false,
  orientation = "vertical",
  selected = false,
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
}) {
  const { t } = useI18n();

  const classes = [
    "domino",
    `domino--${orientation}`,
    `domino--${size}`,
    faceDown ? "domino--facedown" : "domino--faceup",
    selected ? "domino--selected" : "",
    onClick || onPointerDown ? "domino--interactive" : "",
    hidden || dragging ? "domino--hidden" : "",
    dragging ? "domino--dragging" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const accessibleLabel =
    label ||
    (faceDown
      ? t("game.faceDown")
      : t("game.dominoLabel", { left, right }));

  const content = faceDown ? (
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
        {content}
      </button>
    );
  }

  return (
    <div className={classes} role="img" aria-label={accessibleLabel} {...dataProps}>
      {content}
    </div>
  );
}

export default Domino;
