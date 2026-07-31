import Domino from "./Domino";
import "./FlyingDomino.css";

/**
 * Viewport-fixed tile that slides between two screen rects.
 * Transform-only (translate / rotate / scale) for 60 FPS compositing.
 * Positions by tile center so scale + rotate land on the destination rect.
 */
function FlyingDomino({
  left = 0,
  right = 0,
  faceDown = false,
  from,
  to,
  startOrientation = "vertical",
  endOrientation = "horizontal",
  durationMs = 480,
  arcLiftPx = 10,
  onComplete,
}) {
  if (!from || !to) return null;

  const rotating = startOrientation !== endOrientation;
  const rotate = rotating ? (endOrientation === "horizontal" ? -90 : 90) : 0;

  // Scale before rotate so the post-rotate silhouette matches the destination rect.
  const scaleX = from.w > 0 ? (rotating ? to.h / from.w : to.w / from.w) : 1;
  const scaleY = from.h > 0 ? (rotating ? to.w / from.h : to.h / from.h) : 1;

  const fromTx = from.x;
  const fromTy = from.y;
  const toTx = to.x + to.w / 2 - from.w / 2;
  const toTy = to.y + to.h / 2 - from.h / 2;

  const style = {
    "--flight-duration": `${durationMs}ms`,
    "--from-x": `${fromTx}px`,
    "--from-y": `${fromTy}px`,
    "--from-w": `${from.w}px`,
    "--from-h": `${from.h}px`,
    "--to-x": `${toTx}px`,
    "--to-y": `${toTy}px`,
    "--to-scale-x": String(scaleX),
    "--to-scale-y": String(scaleY),
    "--flight-rotate": `${rotate}deg`,
    "--arc-lift": `${arcLiftPx}px`,
  };

  return (
    <div className="flying-domino" style={style} aria-hidden="true">
      <div className="flying-domino__inner" onAnimationEnd={() => onComplete?.()}>
        <Domino
          left={left}
          right={right}
          faceDown={faceDown}
          orientation={startOrientation}
          size="md"
        />
      </div>
    </div>
  );
}

export default FlyingDomino;
