import { useI18n } from "../i18n";
import Domino from "./Domino";
import Avatar from "./Avatar";
import { useFlipGroup } from "../hooks/useFlipGroup";
import "./PlayerPanel.css";

function PlayerPanel({
  name,
  status,
  tiles = [],
  selectedId = null,
  onSelectTile,
  onTilePointerDown,
  draggingId = null,
  isTurn = false,
  hiddenIds,
  enteringIds,
}) {
  const { t } = useI18n();
  const resolvedName = name ?? t("game.you");
  const resolvedStatus = status ?? t("game.yourTurn");
  const flipKey = tiles.map((tile) => tile.id).join("|");
  const handRef = useFlipGroup(flipKey);

  return (
    <section
      className={`player-panel${isTurn ? " player-panel--turn" : ""}`}
      aria-label={t("game.handAria", { name: resolvedName })}
    >
      <div className="player-panel__meta">
        <div className="player-panel__identity">
          <Avatar label={resolvedName} tone="player" active={isTurn} />
          <div className="player-panel__text">
            <span className="player-panel__name">{resolvedName}</span>
            <span
              className={
                isTurn
                  ? "player-panel__status player-panel__status--turn"
                  : "player-panel__status"
              }
            >
              {resolvedStatus}
            </span>
          </div>
        </div>
        <span
          className="player-panel__count"
          aria-label={t("game.tilesCount", { count: tiles.length })}
        >
          {t("game.tilesCount", { count: tiles.length })}
        </span>
      </div>

      <div className="player-panel__tray">
        <ul className="player-panel__hand" ref={handRef} data-hand-root="player">
          {tiles.map((tile, index) => {
            const entering = enteringIds?.has(tile.id);
            return (
              <li
                key={tile.id}
                className={
                  entering
                    ? "player-panel__tile player-panel__tile--enter"
                    : "player-panel__tile"
                }
                data-flip-id={tile.id}
                style={
                  entering
                    ? { animationDelay: `${Math.min(index, 10) * 35}ms` }
                    : undefined
                }
              >
                <Domino
                  left={tile.left}
                  right={tile.right}
                  orientation="vertical"
                  size="md"
                  selected={selectedId === tile.id}
                  dragging={draggingId === tile.id}
                  onClick={onSelectTile ? () => onSelectTile(tile.id) : undefined}
                  onPointerDown={
                    onTilePointerDown
                      ? (event) => onTilePointerDown(event, tile.id)
                      : undefined
                  }
                  label={t("game.yourTile", { left: tile.left, right: tile.right })}
                  tileId={tile.id}
                  hidden={hiddenIds?.has(tile.id)}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

export default PlayerPanel;
