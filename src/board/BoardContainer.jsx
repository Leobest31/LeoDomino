import { useLayoutEffect, useMemo, useRef, useState } from "react";
import DominoTile from "../components/DominoTile";
import {
  calculateBoardLayout,
  layoutBoard,
  MIN_BOARD_SCALE,
  resolveBoardTileBase,
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
 *
 * Tile scale stays at/above MIN_BOARD_SCALE. Layout is a bounded snake
 * inside the measured playable green felt (stage size + HUD carve-out).
 * Optional drag-pan is available for long chains but must not be required
 * to reveal off-table tiles — the engine keeps every tile on-felt.
 */
function BoardContainer({
  tiles = [],
  newestId = null,
  centerTileId = null,
  emptyLabel = "",
  debug: debugProp = null,
}) {
  const stageRef = useRef(null);
  const probeRef = useRef(null);
  const [area, setArea] = useState({ w: 640, h: 320 });
  const [tileSize, setTileSize] = useState({ w: 72, h: 136 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef({ x: 0, y: 0 });
  const panDragRef = useRef(null);
  const lastWarnKey = useRef("");
  /** Monotonic scale cap across growing chains on a fixed felt size. */
  const scaleStabilityRef = useRef({
    scale: 1,
    count: 0,
    areaW: 0,
    areaH: 0,
  });
  const debugOn = debugProp ?? isBoardDebugEnabled();

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    const read = () => {
      const nextArea = {
        w: Math.max(120, stage.clientWidth),
        h: Math.max(120, stage.clientHeight),
      };
      setArea(nextArea);
      const probe = probeRef.current?.querySelector(".domino, .leo-domino-premium");
      if (probe) {
        const r = probe.getBoundingClientRect();
        if (r.width > 2 && r.height > 2) {
          // CSS probe uses the moderate hand×factor; viewport cap prevents
          // rem/vw scaling from recreating the oversized ~134×254 base.
          setTileSize(
            resolveBoardTileBase(
              { width: nextArea.w, height: nextArea.h },
              { w: r.width, h: r.height }
            )
          );
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
      scaleStabilityRef.current = {
        scale: 1,
        count: 0,
        areaW: area.w,
        areaH: area.h,
      };
      return {
        tiles: [],
        scale: 1,
        gap: 2,
        debug: null,
        placements: [],
        camera: null,
      };
    }

    const st = scaleStabilityRef.current;
    const areaChanged =
      Math.abs(area.w - st.areaW) > 12 || Math.abs(area.h - st.areaH) > 12;
    // When the chain grows on a stable viewport, never allow scale to rise.
    // Also never ratchet the cap below the Plan B/C readability floor.
    const priorCap = Math.max(MIN_BOARD_SCALE, st.scale);
    const maxScale =
      !areaChanged && tiles.length > st.count
        ? priorCap
        : !areaChanged && tiles.length === st.count
          ? priorCap
          : 1;

    const build = (hudRight) => {
      const spatial = calculateBoardLayout(
        tiles,
        { width: area.w, height: area.h },
        {
          centerIndex,
          tileWidth: tileSize.w,
          tileHeight: tileSize.h,
          hudRight,
          maxScale,
          focusTileId: newestId ?? tiles[tiles.length - 1]?.id,
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

    // No live HUD carve-outs on the felt — scoreboard and reserve sit outside
    // the green table. Pass 0 (not null) so the engine does not revive the
    // legacy right-rail estimate.
    const preferred = build(0);
    const resolved =
      preferred.tiles.length > 0 ? preferred : build(null);

    st.scale = resolved.tileScale ?? 1;
    st.count = tiles.length;
    st.areaW = area.w;
    st.areaH = area.h;
    return resolved;
  }, [tiles, centerIndex, area, tileSize, newestId]);

  const { placements, tileScale, debug, gap, camera } = layout;
  // Pan is exploratory UX only — engine must not rely on overflow+pan.
  const panEnabled = tiles.length >= 24;

  // Keep painted CSS tile box identical to the layout engine base×scale.
  // resolveBoardTileBase may soft-cap rem-inflated probes; without this
  // override CSS would still paint the larger hand×factor size and overlap.
  const paintW = Math.max(1, tileSize.w * (tileScale || 1));
  const paintH = Math.max(1, tileSize.h * (tileScale || 1));
  const paintPip = Math.max(2, paintW * 0.132);

  // Reset manual pan when the engine camera recenters on a new chain shape.
  useLayoutEffect(() => {
    panRef.current = { x: 0, y: 0 };
    setPan({ x: 0, y: 0 });
  }, [tiles.length, camera?.focusMode, camera?.localFocus?.x, camera?.localFocus?.y]);

  useLayoutEffect(() => {
    if (!panEnabled) return undefined;
    const stage = stageRef.current;
    if (!stage) return undefined;

    const onPointerDown = (event) => {
      if (event.button != null && event.button !== 0) return;
      // Don't steal taps meant for interactive chrome inside the stage.
      if (event.target?.closest?.("button, a, input, select, textarea")) return;
      panDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: panRef.current.x,
        originY: panRef.current.y,
      };
      stage.setPointerCapture?.(event.pointerId);
    };
    const onPointerMove = (event) => {
      const drag = panDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const next = {
        x: drag.originX + (event.clientX - drag.startX),
        y: drag.originY + (event.clientY - drag.startY),
      };
      panRef.current = next;
      setPan(next);
    };
    const onPointerUp = (event) => {
      const drag = panDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      panDragRef.current = null;
      try {
        stage.releasePointerCapture?.(event.pointerId);
      } catch {
        /* ignore */
      }
    };

    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", onPointerUp);
    stage.addEventListener("pointercancel", onPointerUp);
    return () => {
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", onPointerUp);
      stage.removeEventListener("pointercancel", onPointerUp);
    };
  }, [panEnabled]);

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
      className={`board-container${panEnabled ? " board-container--pannable" : ""}`}
      ref={stageRef}
      data-board-root="true"
      data-board-debug={debugOn ? "1" : undefined}
      data-board-camera={camera?.focusMode || undefined}
      data-board-overflow={camera?.overflow ? "1" : undefined}
      role="list"
      style={{
        "--board-tile-scale": String(tileScale),
        "--domino-w": `${paintW}px`,
        "--domino-h": `${paintH}px`,
        "--domino-pip": `${paintPip}px`,
      }}
    >
      <div className="board-container__measure" ref={probeRef} aria-hidden="true">
        <DominoTile left={6} right={6} orientation="vertical" />
      </div>

      {tiles.length === 0 ? (
        <p className="board-container__empty">{emptyLabel}</p>
      ) : (
        <div
          className="board-container__layer"
          style={{
            width: area.w,
            height: area.h,
            transform:
              pan.x || pan.y
                ? `translate3d(${pan.x}px, ${pan.y}px, 0)`
                : undefined,
          }}
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
