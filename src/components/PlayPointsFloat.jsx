import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion.js";
import "./PlayPointsFloat.css";

/**
 * Floating mid-table score pop (+5 / +10 / …) shown before the HUD catches up.
 */
function PlayPointsFloat({ points = 0, onDone }) {
  const reduced = usePrefersReducedMotion();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!Number.isFinite(points) || points <= 0) return undefined;
    setVisible(true);
    const hold = reduced ? 280 : 900;
    const timer = window.setTimeout(() => {
      setVisible(false);
      onDone?.();
    }, hold);
    return () => window.clearTimeout(timer);
  }, [points, onDone, reduced]);

  if (!Number.isFinite(points) || points <= 0 || !visible) return null;

  return (
    <div className="play-points-float" aria-live="polite">
      <span className="play-points-float__value">+{points}</span>
    </div>
  );
}

export default PlayPointsFloat;
