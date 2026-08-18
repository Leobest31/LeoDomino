import { useI18n } from "../i18n";
import BoardContainer from "../board/BoardContainer";
import RoundHandSummary from "./RoundHandSummary";
import "./GameTable.css";

/**
 * Table chrome (walnut frame + felt).
 * Board geometry lives in BoardContainer + DominoLayoutEngine — not here.
 * Destination choice uses the real chain tiles, never felt drop-zone boxes.
 */
function GameTable({
  tiles = [],
  newestId,
  centerTileId = null,
  targetTileId = null,
  spinnerId = null,
  spinnerNorth = [],
  spinnerSouth = [],
  playScore = null,
  scoreHighlights = [],
  roundSummary = null,
  playerNames = [],
  hiddenIds = null,
}) {
  const { t } = useI18n();

  return (
    <section className="game-table" aria-label={t("game.table")}>
      <div className="game-table__frame">
        <div className="game-table__felt">
          <BoardContainer
            tiles={tiles}
            newestId={newestId}
            centerTileId={centerTileId}
            spinnerId={spinnerId}
            spinnerNorth={spinnerNorth}
            spinnerSouth={spinnerSouth}
            targetTileId={targetTileId}
            emptyLabel={t("game.tableReady")}
            scoreHighlights={scoreHighlights}
            hiddenIds={hiddenIds}
          />

          {playScore && !roundSummary ? (
            <div className="game-table__play-score" aria-live="polite">
              {t("game.playScore", { points: playScore })}
            </div>
          ) : null}

          <RoundHandSummary view={roundSummary} playerNames={playerNames} />
        </div>
      </div>
    </section>
  );
}

export default GameTable;
