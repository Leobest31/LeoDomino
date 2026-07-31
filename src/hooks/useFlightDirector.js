import { useCallback, useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion.js";
import { MOTION, measure, nextFrame, rectToLayer, wait } from "../utils/motion.js";

/**
 * Orchestrates play/draw flights using DOM measurements.
 * Keeps board/hand tiles hidden until the flight lands (no teleport).
 * Queues overlapping flights so AI/human motion never drops.
 */
export function useFlightDirector() {
  const reduced = usePrefersReducedMotion();
  const [flight, setFlight] = useState(null);
  const [hiddenIds, setHiddenIds] = useState(() => new Set());
  const busyRef = useRef(false);
  const queueRef = useRef([]);
  const runInternalRef = useRef(null);

  const hideTile = useCallback((id) => {
    setHiddenIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const showTile = useCallback((id) => {
    setHiddenIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const drainQueue = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) return;
    runInternalRef.current?.(next.spec).then(next.resolve);
  }, []);

  const runFlightInternal = useCallback(
    async (spec) => {
      busyRef.current = true;

      const finishWithoutFlight = () => {
        spec.apply?.();
        showTile(spec.tileId);
        busyRef.current = false;
        spec.onLanded?.();
        drainQueue();
      };

      const fromEl = measure(spec.fromSelector);
      const from = spec.fromRect
        ? spec.fromRect
        : fromEl
          ? rectToLayer(fromEl)
          : null;

      if (reduced || !from) {
        finishWithoutFlight();
        return;
      }

      if (!spec.skipHide) {
        hideTile(spec.tileId);
      }
      spec.apply?.();
      await nextFrame();

      let toEl = measure(spec.toSelector);
      for (let attempt = 0; attempt < 12 && !toEl; attempt += 1) {
        await wait(16);
        toEl = measure(spec.toSelector);
      }

      if (!toEl) {
        showTile(spec.tileId);
        busyRef.current = false;
        spec.onLanded?.();
        drainQueue();
        return;
      }

      const to = rectToLayer(toEl);
      await new Promise((resolve) => {
        setFlight({
          tileId: spec.tileId,
          left: spec.left,
          right: spec.right,
          faceDown: Boolean(spec.faceDown),
          from,
          to,
          startOrientation: spec.startOrientation ?? "vertical",
          endOrientation: spec.endOrientation ?? "horizontal",
          durationMs: spec.durationMs ?? MOTION.tileFlightMs,
          arcLiftPx: spec.arcLiftPx ?? MOTION.playArcLiftPx,
          onComplete: () => {
            showTile(spec.tileId);
            setFlight(null);
            busyRef.current = false;
            spec.onLanded?.();
            resolve();
            drainQueue();
          },
        });
      });
    },
    [drainQueue, hideTile, reduced, showTile]
  );

  runInternalRef.current = runFlightInternal;

  /**
   * @param {object} spec
   * @param {string} spec.tileId
   * @param {number} spec.left
   * @param {number} spec.right
   * @param {boolean} [spec.faceDown]
   * @param {string} [spec.fromSelector]
   * @param {{ x: number, y: number, w: number, h: number }} [spec.fromRect]
   * @param {string} spec.toSelector
   * @param {string} [spec.startOrientation]
   * @param {string} [spec.endOrientation]
   * @param {number} [spec.durationMs]
   * @param {number} [spec.arcLiftPx]
   * @param {boolean} [spec.skipHide] - tile already hidden (AI post-commit)
   * @param {() => void} [spec.apply] - mutate game state before measuring destination
   * @param {() => void} [spec.onLanded] - after tile is revealed at destination
   */
  const runFlight = useCallback(
    (spec) => {
      if (busyRef.current) {
        return new Promise((resolve) => {
          queueRef.current.push({ spec, resolve });
        });
      }
      return runFlightInternal(spec);
    },
    [runFlightInternal]
  );

  useEffect(
    () => () => {
      busyRef.current = false;
      queueRef.current = [];
    },
    []
  );

  return {
    flight,
    hiddenIds,
    runFlight,
    hideTile,
    showTile,
    isAnimating: Boolean(flight),
  };
}

export default useFlightDirector;
