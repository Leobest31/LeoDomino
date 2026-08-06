import { useI18n } from "../i18n";
import BoardContainer from "../board/BoardContainer";
import "./GameTable.css";

/**
 * Table chrome (walnut frame + felt + drop zones).
 * Board geometry lives in BoardContainer + DominoLayoutEngine — not here.
 */
function GameTable({
  tiles = [],
  newestId,
  centerTileId = null,
  dropActive = false,
  hotEnd = null,
  validEnds = null,
  hudReserve = 0,
}) {
  const { t } = useI18n();
  const showDrops = dropActive && tiles.length > 0;
  const leftValid = !validEnds || validEnds.includes("left");
  const rightValid = !validEnds || validEnds.includes("right");

  return (
    <section className="game-table" aria-label={t("game.table")}>
      <div className="game-table__frame">
        <div className="game-table__felt">
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

          <BoardContainer
            tiles={tiles}
            newestId={newestId}
            centerTileId={centerTileId}
            emptyLabel={t("game.tableReady")}
            hudReserve={hudReserve}
          />
        </div>
      </div>
    </section>
  );
}

export default GameTable;
