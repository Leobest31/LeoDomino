import DominoTile from "./DominoTile";
import { dragGhostSizeStyle } from "./dragGhostSize.js";
import "./DragGhost.css";

/**
 * Pointer-following tile while choosing between both legal ends.
 */
function DragGhost({ left, right, x, y, width, height }) {
  if (x == null || y == null) return null;
  const sizeStyle = dragGhostSizeStyle(width, height);

  return (
    <div
      className="drag-ghost"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        ...(sizeStyle || {}),
      }}
      aria-hidden="true"
    >
      <DominoTile
        left={left}
        right={right}
        orientation="vertical"
        boardTileId="drag-ghost"
      />
    </div>
  );
}

export default DragGhost;
