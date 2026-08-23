import { useI18n } from "../i18n";
import BoardContainer from "../board/BoardContainer";
import RoundHandSummary from "./RoundHandSummary";
import { homeLeoBestLion } from "../assets";
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
  status = "",
  statusActive = false,
  hiddenIds = null,
  dock = null,
  children = null,
  rulesetId = "",
}) {
  const { t } = useI18n();

  return (
    <section className="game-table" aria-label={t("game.table")}>
      <div className="game-table__frame">
        <div className="game-table__felt">
          <div className="game-table__mark" aria-hidden="true">
            <img src={homeLeoBestLion} alt="" />
            <p className="game-table__mark-word">{t("auth.wordmark")}</p>
            <p className="game-table__mark-tag">{t("auth.brandTagline")}</p>
          </div>

          {status ? (
            <p
              className={`game-table__status${
                statusActive ? " game-table__status--active" : ""
              }`}
            >
              <span className="game-table__status-dot" aria-hidden="true" />
              <span>{status}</span>
            </p>
          ) : null}

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
            rulesetId={rulesetId}
          />

          {playScore && !roundSummary ? (
            <div className="game-table__play-score" aria-live="polite">
              {t("game.playScore", { points: playScore })}
            </div>
          ) : null}

          <RoundHandSummary view={roundSummary} playerNames={playerNames} />
          {children}
        </div>
        {dock}
      </div>
    </section>
  );
}

export default GameTable;
