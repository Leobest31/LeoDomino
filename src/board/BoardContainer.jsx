import { useLayoutEffect, useMemo, useRef, useState } from "react";
import DominoTile from "../components/DominoTile";
import {
  calculateBoardLayout,
  layoutBoard,
  resolveBoardTileBase,
} from "./DominoLayoutEngine.js";
import {
  buildBoardDisplays,
  buildSpinnerArmDisplays,
  validateBoardPresentation,
} from "./connectionDisplay.js";
import { isBoardDebugEnabled, buildLayoutDebugInfo } from "./boardDebug.js";
import BoardDebugOverlay from "./BoardDebugOverlay.jsx";
import {
  buildBoardTopology,
  traceTopologyMove,
} from "../game/boardTopology.js";
import { displayGlowHalves, mergeScoreHighlights } from "./scoreGlow.js";
import { measureHandExclusionPx } from "./handExclusion.js";
import "./BoardContainer.css";

/**
 * BoardContainer — Renderer layer for the spatial Domino Layout Engine.
 *
 * Does NOT invent positions. Maps engine output to absolute
 * `transform: translate3d(x, y, 0)` slots. No flex/grid tile flow.
 *
 * The engine lays out the complete chain (and spinner branches) in logical
 * space, then auto-fits: translate the AABB into the exclusive felt
 * (top HUD and Player 1 dock are outside this rectangle) before any
 * uniform scale. The spinner may leave the geometric felt mid so unused
 * space above a south branch is used.
 */
function BoardContainer({
  tiles = [],
  newestId = null,
  centerTileId = null,
  spinnerId = null,
  spinnerNorth = [],
  spinnerSouth = [],
  targetTileId = null,
  emptyLabel = "",
  debug: debugProp = null,
  scoreHighlights = [],
  hiddenIds = null,
}) {
  const stageRef = useRef(null);
  const probeRef = useRef(null);
  const [area, setArea] = useState({ w: 640, h: 320 });
  const [tileSize, setTileSize] = useState({ w: 72, h: 136 });
  const [handExclusionPx, setHandExclusionPx] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef({ x: 0, y: 0 });
  const panDragRef = useRef(null);
  const lastWarnKey = useRef("");
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
      const dock = document.querySelector("[data-hand-dock]");
      setHandExclusionPx(
        measureHandExclusionPx(
          stage.getBoundingClientRect(),
          dock?.getBoundingClientRect()
        )
      );
      const probe = probeRef.current?.querySelector(".domino, .leo-domino-premium");
      if (probe) {
        const r = probe.getBoundingClientRect();
        if (r.width > 2 && r.height > 2) {
          // CSS probe uses --played-tile-*; composition cap keeps phone
          // bones from dominating a short felt.
          setTileSize(
            resolveBoardTileBase(
              {
                width: nextArea.w,
                height: nextArea.h,
                hudBottom: measureHandExclusionPx(
                  stage.getBoundingClientRect(),
                  dock?.getBoundingClientRect()
                ),
              },
              { w: r.width, h: r.height }
            )
          );
        }
      }
    };

    read();
    const ro = new ResizeObserver(read);
    ro.observe(stage);
    const dock = document.querySelector("[data-hand-dock]");
    if (dock) ro.observe(dock);
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
      return {
        tiles: [],
        scale: 1,
        gap: 2,
        debug: null,
        placements: [],
        armPlacements: [],
        camera: null,
      };
    }

    const build = (hudRight) => {
      const topology = buildBoardTopology({
        board: tiles,
        spinnerId,
        spinnerNorth,
        spinnerSouth,
      });
      const spatial = calculateBoardLayout(
        tiles,
        { width: area.w, height: area.h },
        {
          centerIndex,
          tileWidth: tileSize.w,
          tileHeight: tileSize.h,
          hudRight,
          hudBottom: handExclusionPx,
          maxScale: 1,
          focusTileId: newestId ?? tiles[tiles.length - 1]?.id,
          spinnerId: topology.spinnerId,
          spinnerNorth: topology.branches.SPINNER_TOP,
          spinnerSouth: topology.branches.SPINNER_BOTTOM,
          topology,
        }
      );

      const toPlacement = (t) => ({
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
      });

      const placements = spatial.tiles.map(toPlacement);
      const armPlacements = (spatial.armTiles || []).map(toPlacement);

      return {
        ...spatial,
        placements,
        armPlacements,
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

    return resolved;
  }, [tiles, centerIndex, area, tileSize, newestId, spinnerId, spinnerNorth, spinnerSouth, handExclusionPx]);

  const { placements, armPlacements, tileScale, debug, gap, camera } = layout;
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

  const scoreGlowById = useMemo(
    () => mergeScoreHighlights(scoreHighlights),
    [scoreHighlights]
  );

  const displays = useMemo(
    () => buildBoardDisplays(tiles, placements),
    [tiles, placements]
  );

  /** Spinner N/S arms — positions come from the same layout engine as the chain. */
  const armDisplays = useMemo(() => {
    if (!spinnerId || !placements?.length) return [];
    const spinPos = placements.find((p) => p.id === spinnerId);
    if (!spinPos) return [];
    return buildSpinnerArmDisplays(
      spinPos,
      spinnerNorth,
      spinnerSouth,
      gap ?? 2,
      armPlacements
    );
  }, [spinnerId, spinnerNorth, spinnerSouth, placements, armPlacements, gap]);

  useLayoutEffect(() => {
    if (!import.meta.env.DEV || !newestId) return;
    const all = [...displays, ...armDisplays];
    const newest = all.find((entry) => entry?.tile?.id === newestId);
    if (!newest?.pos || !newest.display) return;
    traceTopologyMove({
      tile: newest.tile.id,
      chosenDestination: newest.tile.destination ?? newest.tile.branch ?? null,
      storedBranch: newest.tile.destination ?? newest.tile.branch ?? null,
      layoutBranch: newest.pos.branch,
      orientation: newest.display.orientation,
      x: newest.pos.x,
      y: newest.pos.y,
    });
  }, [newestId, displays, armDisplays]);

  useLayoutEffect(() => {
    if (!import.meta.env.DEV || tiles.length < 2) return;
    const result = validateBoardPresentation(tiles, {
      layoutFn: layoutBoard,
      centerIndex,
      viewport: { width: area.w, height: area.h },
      tileSize,
      centerTileId: spinnerId,
      spinnerId,
    });
    if (result.ok) return;
    const key = `${result.stage}:${result.reason}:${result.index}:${result.leftId}:${result.rightId}`;
    if (key === lastWarnKey.current) return;
    lastWarnKey.current = key;
    console.warn("[LeoDomino] Invalid board presentation after move:", result);
  }, [tiles, centerIndex, area, tileSize, spinnerId]);

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
          {[...displays, ...armDisplays].map((entry) => {
            if (!entry?.pos || !entry.display) return null;
            const { tile, pos, display } = entry;
            const glow = scoreGlowById.get(tile.id);
            const halves = glow
              ? displayGlowHalves(display, glow.scoringSides)
              : { first: false, second: false };
            const isVertical = display.orientation !== "horizontal";
            const isTip = tipIds.has(tile.id);
            const isTarget = Boolean(targetTileId) && tile.id === targetTileId;
            const classes = [
              "board-container__slot",
              tile.id === newestId ? "board-container__slot--enter" : "",
              isTip ? "board-container__slot--tip" : "",
              isTarget ? "board-container__slot--target" : "",
              halves.first || halves.second ? "board-container__slot--score" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div
                key={tile.id}
                className={classes}
                role="listitem"
                data-board-tile={tile.id}
                data-travel-dir={pos.travelDir || undefined}
                data-score-glow={
                  halves.first || halves.second
                    ? [halves.first ? "first" : "", halves.second ? "second" : ""]
                        .filter(Boolean)
                        .join(" ")
                    : undefined
                }
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
                  highlighted={isTarget}
                  hidden={Boolean(hiddenIds?.has(tile.id))}
                />
                {halves.first ? (
                  <span
                    className={`board-container__score-glow board-container__score-glow--first-${isVertical ? "v" : "h"}`}
                    aria-hidden="true"
                  />
                ) : null}
                {halves.second ? (
                  <span
                    className={`board-container__score-glow board-container__score-glow--second-${isVertical ? "v" : "h"}`}
                    aria-hidden="true"
                  />
                ) : null}
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
