import DominoTile from "./DominoTile";
import "./FlyingDomino.css";

/**
 * Viewport-fixed DominoTile — translate + rotate only.
 * Same physical DominoTile as hand and board (no size morph).
 */
function FlyingDomino({
  left = 0,
  right = 0,
  faceDown = false,
  from,
  to,
  startOrientation = "vertical",
  endOrientation = "horizontal",
  durationMs = 280,
  arcLiftPx = 2,
  onComplete,
}) {
  if (!from || !to) return null;

  const rotating = startOrientation !== endOrientation;
  const rotate = rotating ? (endOrientation === "horizontal" ? -90 : 90) : 0;

  const fromTx = from.x;
  const fromTy = from.y;
  const toTx = to.x + to.w / 2 - from.w / 2;
  const toTy = to.y + to.h / 2 - from.h / 2;

  const style = {
    "--flight-duration": `${durationMs}ms`,
    "--from-x": `${fromTx}px`,
    "--from-y": `${fromTy}px`,
    "--to-x": `${toTx}px`,
    "--to-y": `${toTy}px`,
    "--flight-rotate": `${rotate}deg`,
    "--arc-lift": `${arcLiftPx}px`,
  };

  return (
    <div className="flying-domino" style={style} aria-hidden="true" data-flight-path>
      <div className="flying-domino__inner" onAnimationEnd={() => onComplete?.()}>
        <DominoTile
          left={left}
          right={right}
          faceDown={faceDown}
          orientation={startOrientation}
        />
      </div>
    </div>
  );
}

export default FlyingDomino;
