import { useI18n } from "../i18n";
import DominoTile from "./DominoTile";
import "./RoundHandSummary.css";

/**
 * Felt overlay: remaining scoring hands, counted one tile at a time.
 * Does not mutate the logical board.
 */
function RoundHandSummary({
  view = null,
  playerNames = [],
}) {
  const { t } = useI18n();
  if (!view || view.done) return null;

  const hands = Array.isArray(view.hands) ? view.hands : [];
  const activeId = view.activeTileId;

  return (
    <div className="round-summary" aria-live="polite">
      <div className="round-summary__hands">
        {hands.map((hand) => (
          <div key={`hand-${hand.playerIndex}`} className="round-summary__hand">
            {hands.length > 1 ? (
              <p className="round-summary__hand-name">
                {playerNames[hand.playerIndex] ||
                  t("game.playerN", { n: hand.playerIndex + 1 })}
              </p>
            ) : null}
            <div className="round-summary__tiles">
              {(hand.tiles || []).map((tile) => {
                const active = tile.id === activeId;
                return (
                  <div
                    key={tile.id}
                    className={`round-summary__slot${
                      active ? " round-summary__slot--active" : ""
                    }`}
                  >
                    <DominoTile
                      left={tile.left}
                      right={tile.right}
                      orientation="vertical"
                      boardTileId={`summary-${tile.id}`}
                    />
                    {active ? (
                      <span className="round-summary__tile-pips" aria-hidden="true">
                        {t("game.playScore", { points: tile.pips })}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="round-summary__totals">
        <p className="round-summary__raw">
          {t("game.rawPipsLabel", { total: view.rawVisible })}
        </p>
        {view.showAward ? (
          <p className="round-summary__award">
            <span className="round-summary__award-label">
              {t("game.roundPointsLabel")}
            </span>
            <span className="round-summary__award-value">
              {t("game.playScore", { points: view.awarded })}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default RoundHandSummary;
