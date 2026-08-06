import DominoTile from "./DominoTile";
import "./DragGhost.css";

/**
 * Pointer-following tile while choosing between both legal ends.
 */
function DragGhost({ left, right, x, y }) {
  if (x == null || y == null) return null;

  return (
    <div
      className="drag-ghost"
      style={{
        left: `${x}px`,
        top: `${y}px`,
      }}
      aria-hidden="true"
    >
      <DominoTile left={left} right={right} orientation="vertical" />
    </div>
  );
}

export default DragGhost;
