import { useI18n } from "../i18n";
import "./LeoDominoPremium.css";

const PIP_POSITIONS = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function DominoHalf({ value }) {
  const activePips = PIP_POSITIONS[value] || [];

  return (
    <div className="leo-premium__half" aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => (
        <div key={index} className="leo-premium__pip-slot">
          {activePips.includes(index) ? <div className="leo-premium__pip" /> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * Premium Classic — CSS 3D walnut + gold frame.
 * Footprint follows --domino-w / --domino-h (same as Classic) so layout stays exact.
 */
export function LeoDominoPremium({
  left = 0,
  right = 0,
  faceDown = false,
  orientation = "vertical",
  selected = false,
  highlighted = false,
  playable = false,
  disabled = false,
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
}) {
  const { t } = useI18n();

  const flat = Boolean(boardTileId) || dragging;
  const interactive = Boolean((onClick || onPointerDown) && !disabled);

  const stateClasses = [
    "leo-domino-premium",
    `leo-domino-premium--${orientation}`,
    size === "sm" ? "leo-domino-premium--sm" : "leo-domino-premium--md",
    faceDown ? "is-face-down" : "is-face-up",
    selected ? "is-selected" : "",
    highlighted ? "is-highlighted" : "",
    playable ? "is-playable" : "",
    disabled ? "is-disabled" : "",
    flat ? "is-flat" : "",
    interactive ? "is-interactive" : "",
    hidden || dragging ? "is-hidden" : "",
    dragging ? "is-dragging" : "",
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
    <div className="leo-premium__face-down" aria-hidden="true" />
  ) : (
    <>
      <DominoHalf value={left} />
      <div className="leo-premium__divider" aria-hidden="true">
        <div className="leo-premium__pin" />
      </div>
      <DominoHalf value={right} />
    </>
  );

  const body = (
    <>
      <div className="leo-premium__body">
        <div className="leo-premium__face">
          <div className="leo-premium__gold-frame">{faceContent}</div>
        </div>
        <div className="leo-premium__side leo-premium__side--left" aria-hidden="true" />
        <div className="leo-premium__side leo-premium__side--right" aria-hidden="true" />
        <div className="leo-premium__side leo-premium__side--top" aria-hidden="true" />
        <div className="leo-premium__side leo-premium__side--bottom" aria-hidden="true" />
      </div>
      <div className="leo-premium__shadow" aria-hidden="true" />
    </>
  );

  const dataProps = {
    ...(tileId ? { "data-tile-id": tileId } : {}),
    ...(boardTileId ? { "data-board-tile": boardTileId } : {}),
    ...(flipId ? { "data-flip-id": flipId } : {}),
  };

  if (interactive) {
    return (
      <button
        type="button"
        className={stateClasses}
        onClick={disabled ? undefined : onClick}
        onPointerDown={disabled ? undefined : onPointerDown}
        aria-label={accessibleLabel}
        aria-pressed={selected}
        disabled={disabled || undefined}
        {...dataProps}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={stateClasses} role="img" aria-label={accessibleLabel} {...dataProps}>
      {body}
    </div>
  );
}

export default LeoDominoPremium;
