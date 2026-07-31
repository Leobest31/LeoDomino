import { useI18n } from "../i18n";
import Domino from "./Domino";
import { useFlipGroup } from "../hooks/useFlipGroup";
import "./GameTable.css";

function GameTable({
  tiles = [],
  hiddenIds,
  newestId,
  dropActive = false,
  hotEnd = null,
  validEnds = null,
}) {
  const { t } = useI18n();
  const flipKey = tiles.map((tile) => `${tile.id}:${tile.orientation}`).join("|");
  const chainRef = useFlipGroup(flipKey);
  const showDrops = dropActive && tiles.length > 0;
  const leftValid = !validEnds || validEnds.includes("left");
  const rightValid = !validEnds || validEnds.includes("right");

  return (
    <section className="game-table" aria-label={t("game.table")}>
      <div className="game-table__frame">
        <div className="game-table__felt">
          <div className="game-table__grain" aria-hidden="true" />

          {showDrops && leftValid ? (
            <div
              className={`game-table__drop game-table__drop--left${
                hotEnd === "left" ? " game-table__drop--hot" : " game-table__drop--ready"
              }`}
              data-drop-end="left"
              aria-hidden="true"
            />
          ) : null}
          {showDrops && rightValid ? (
            <div
              className={`game-table__drop game-table__drop--right${
                hotEnd === "right" ? " game-table__drop--hot" : " game-table__drop--ready"
              }`}
              data-drop-end="right"
              aria-hidden="true"
            />
          ) : null}

          <div
            className="game-table__chain"
            role="list"
            aria-label={t("game.playedTiles")}
            ref={chainRef}
            data-board-root="true"
          >
            {tiles.length === 0 ? (
              <p className="game-table__empty">{t("game.tableReady")}</p>
            ) : (
              tiles.map((tile) => (
                <div
                  key={tile.id}
                  className={
                    tile.id === newestId
                      ? "game-table__slot game-table__slot--enter"
                      : "game-table__slot"
                  }
                  role="listitem"
                  data-flip-id={`board-${tile.id}`}
                >
                  <Domino
                    left={tile.left}
                    right={tile.right}
                    orientation={tile.orientation || "horizontal"}
                    size="md"
                    boardTileId={tile.id}
                    hidden={hiddenIds?.has(tile.id)}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default GameTable;
