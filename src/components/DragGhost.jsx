import Domino from "./Domino";
import "./DragGhost.css";

/**
 * Pointer-following tile while choosing between both legal ends.
 */
function DragGhost({ left, right, x, y, width, height }) {
  if (x == null || y == null) return null;

  return (
    <div
      className="drag-ghost"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        width: width ? `${width}px` : undefined,
        height: height ? `${height}px` : undefined,
      }}
      aria-hidden="true"
    >
      <Domino left={left} right={right} orientation="vertical" size="md" />
    </div>
  );
}

export default DragGhost;
