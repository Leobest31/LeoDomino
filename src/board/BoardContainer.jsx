import { useLayoutEffect, useMemo, useRef, useState } from "react";
import DominoTile from "../components/DominoTile";
import {
  calculateBoardLayout,
  layoutBoard,
} from "./DominoLayoutEngine.js";
import {
  buildBoardDisplays,
  validateBoardPresentation,
} from "./connectionDisplay.js";
import { isBoardDebugEnabled, buildLayoutDebugInfo } from "./boardDebug.js";
import BoardDebugOverlay from "./BoardDebugOverlay.jsx";
import "./BoardContainer.css";

/**
 * BoardContainer — Renderer layer for the spatial Domino Layout Engine.
 *
 * Does NOT invent positions. Maps engine output to absolute
 * `transform: translate3d(x, y, 0)` slots. No flex/grid tile flow.
 */
function BoardContainer({
  tiles = [],
  newestId = null,
  centerTileId = null,
  emptyLabel = "",
  debug: debugProp = null,
  hudReserve = 0,
}) {
  const stageRef = useRef(null);
  const probeRef = useRef(null);
  const [area, setArea] = useState({ w: 640, h: 320 });
  const [tileSize, setTileSize] = useState({ w: 36, h: 68 });
  const lastWarnKey = useRef("");
  const debugOn = debugProp ?? isBoardDebugEnabled();

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    const read = () => {
      setArea({
        w: Math.max(120, stage.clientWidth),
        h: Math.max(120, stage.clientHeight),
      });
      const probe = probeRef.current?.querySelector(".domino, .leo-domino-premium");
      if (probe) {
        const r = probe.getBoundingClientRect();
        if (r.width > 2 && r.height > 2) {
          setTileSize({ w: r.width, h: r.height });
        }
      }
    };

    read();
    const ro = new ResizeObserver(read);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [tiles.length]);

  const centerIndex = useMemo(() => {
    if (!tiles.length) return 0;
    if (centerTileId) {
      const i = tiles.findIndex((t) => t.id === centerTileId);
      if (i >= 0) return i;
    }
    return 0;
  }, [tiles, centerTileId]);

  const layout = useMemo(() => {
    if (!tiles.length) {
      return { tiles: [], scale: 1, gap: 2, debug: null, placements: [] };
    }

    const build = (hudRight) => {
      const spatial = calculateBoardLayout(
        tiles,
        { width: area.w, height: area.h },
        {
          centerIndex,
          tileWidth: tileSize.w,
          tileHeight: tileSize.h,
          hudRight,
        }
      );

      const placements = spatial.tiles.map((t) => ({
        id: t.tileId,
        x: t.x,
        y: t.y,
        w: t.w,
        h: t.h,
        orientation: t.orientation,
        rotation: t.rotation,
        travelDir: t.travelDir,
        branch: t.branch,
        double: t.double,
        isCorner: t.isCorner,
        isBridge: t.isBridge,
      }));

      return {
        ...spatial,
        placements,
        tileScale: spatial.scale,
        debug: buildLayoutDebugInfo(placements, tiles),
      };
    };

    // Prefer the measured HUD inset; if the engine still fails closed
    // (empty placements for a non-empty chain), retry without the HUD carve-
    // out so the board never goes blank on narrow viewports.
    const preferred = build(hudReserve > 0 ? hudReserve : null);
    if (preferred.tiles.length > 0 || hudReserve <= 0) return preferred;
    return build(null);
  }, [tiles, centerIndex, area, tileSize, hudReserve]);

  const { placements, tileScale, debug, gap } = layout;

  const tipIds = useMemo(() => {
    if (tiles.length < 2) return new Set();
    return new Set([tiles[0].id, tiles[tiles.length - 1].id]);
  }, [tiles]);

  const displays = useMemo(
    () => buildBoardDisplays(tiles, placements),
    [tiles, placements]
  );

  useLayoutEffect(() => {
    if (!import.meta.env.DEV || tiles.length < 2) return;
    const result = validateBoardPresentation(tiles, {
      layoutFn: layoutBoard,
      centerIndex,
      viewport: { width: area.w, height: area.h },
      tileSize,
    });
    if (result.ok) return;
    const key = `${result.stage}:${result.reason}:${result.index}:${result.leftId}:${result.rightId}`;
    if (key === lastWarnKey.current) return;
    lastWarnKey.current = key;
    console.warn("[LeoDomino] Invalid board presentation after move:", result);
  }, [tiles, centerIndex, area, tileSize]);

  return (
    <div
      className="board-container"
      ref={stageRef}
      data-board-root="true"
      data-board-debug={debugOn ? "1" : undefined}
      role="list"
      style={{ "--board-tile-scale": String(tileScale) }}
    >
      <div className="board-container__measure" ref={probeRef} aria-hidden="true">
        <DominoTile left={6} right={6} orientation="vertical" />
      </div>

      {tiles.length === 0 ? (
        <p className="board-container__empty">{emptyLabel}</p>
      ) : (
        <div
          className="board-container__layer"
          style={{ width: area.w, height: area.h }}
        >
          {displays.map((entry) => {
            if (!entry?.pos || !entry.display) return null;
            const { tile, pos, display } = entry;
            const isTip = tipIds.has(tile.id);
            const classes = [
              "board-container__slot",
              tile.id === newestId ? "board-container__slot--enter" : "",
              isTip ? "board-container__slot--tip" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div
                key={tile.id}
                className={classes}
                role="listitem"
                style={{
                  width: pos.w,
                  height: pos.h,
                  transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
                }}
              >
                <DominoTile
                  left={display.left}
                  right={display.right}
                  orientation={display.orientation}
                  boardTileId={tile.id}
                />
              </div>
            );
          })}
          {debugOn ? <BoardDebugOverlay debug={debug} gap={gap ?? 2} /> : null}
        </div>
      )}
    </div>
  );
}

export default BoardContainer;
