import { useI18n } from "../i18n";
import DominoTile from "./DominoTile";
import Avatar from "./Avatar";
import { useFlipGroup } from "../hooks/useFlipGroup";
import "./OpponentPanel.css";

/**
 * One seat at the table for a non-human player. Always face-down — pip
 * values are never exposed for an opponent's hand.
 *
 * `position` places the seat around the felt for 2 / 3 / 4 player tables:
 * "top", "left", and "right".
 */
function OpponentPanel({
  name,
  status,
  tileCount = 7,
  thinking = false,
  isTurn = false,
  position = "top",
  seatIndex = 1,
  compact = false,
  avatarTone = "rival",
}) {
  const { t } = useI18n();
  const resolvedName = name ?? t("game.rival");
  const resolvedStatus = status ?? t("game.waiting");
  const flipKey = `${position}:${tileCount}`;
  const trayRef = useFlipGroup(flipKey, "[data-opp-flip-id]");
  const sideSeat = position === "left" || position === "right";

  return (
    <section
      className={`opponent-panel opponent-panel--${position}${
        compact ? " opponent-panel--compact" : ""
      }${thinking ? " opponent-panel--thinking" : ""}${
        isTurn && !thinking ? " opponent-panel--turn" : ""
      }`}
      aria-label={t("game.handAria", { name: resolvedName })}
    >
      <div className="opponent-panel__meta">
        <div className="opponent-panel__identity">
          <Avatar
            label={resolvedName}
            tone={avatarTone}
            size="sm"
            active={thinking || isTurn}
          />
          <div className="opponent-panel__text">
            <span className="opponent-panel__name">{resolvedName}</span>
            <span
              className={
                thinking
                  ? "opponent-panel__status opponent-panel__status--thinking"
                  : isTurn
                    ? "opponent-panel__status opponent-panel__status--turn"
                    : "opponent-panel__status"
              }
            >
              {resolvedStatus}
            </span>
          </div>
        </div>
        <span
          className="opponent-panel__count"
          aria-label={t("game.tilesCount", { count: tileCount })}
        >
          {tileCount}
        </span>
      </div>

      <div
        className="opponent-panel__tray"
        data-opponent-origin="true"
        data-seat-index={seatIndex}
      >
        <ul className="opponent-panel__hand" ref={trayRef} data-hand-root={`opponent-${seatIndex}`}>
          {Array.from({ length: tileCount }, (_, index) => {
            // Face-down tiles are interchangeable — a stable slot id (not a
            // real tile id, which the UI must never learn) is enough for the
            // FLIP group to smoothly reflow when the count changes.
            const isLast = index === tileCount - 1;
            return (
              <li
                key={index}
                className="opponent-panel__tile"
                data-opp-flip-id={`opp-slot-${index}`}
                data-opponent-top-tile={isLast ? "true" : undefined}
              >
                <DominoTile
                  faceDown
                  orientation={sideSeat ? "horizontal" : "vertical"}
                  size="sm"
                  label={t("game.faceDown")}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

export default OpponentPanel;
