import { useLayoutEffect, useRef } from "react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion.js";
import { MOTION } from "../utils/motion.js";

/**
 * FLIP animation for a list of keyed children.
 * Existing items slide; they never teleport.
 *
 * @param {string} dependencyKey - change when layout membership changes
 * @param {string} [itemSelector='[data-flip-id]']
 */
export function useFlipGroup(dependencyKey, itemSelector = "[data-flip-id]") {
  const rootRef = useRef(null);
  const prevRef = useRef(new Map());
  const reduced = usePrefersReducedMotion();

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const nodes = [...root.querySelectorAll(itemSelector)];
    /** @type {Map<string, DOMRect>} */
    const next = new Map();

    for (const node of nodes) {
      const id = node.getAttribute("data-flip-id");
      if (!id) continue;
      next.set(id, node.getBoundingClientRect());
    }

    if (!reduced) {
      for (const node of nodes) {
        const id = node.getAttribute("data-flip-id");
        if (!id) continue;
        const last = prevRef.current.get(id);
        const current = next.get(id);
        if (!last || !current) continue;

        const dx = last.left - current.left;
        const dy = last.top - current.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

        node.style.transition = "none";
        node.style.transform = `translate(${dx}px, ${dy}px)`;

        // Force reflow then animate to identity.
        void node.offsetWidth;
        node.style.transition = `transform ${MOTION.handFlipMs}ms var(--ease-out)`;
        node.style.transform = "";
      }
    }

    prevRef.current = next;
  }, [dependencyKey, itemSelector, reduced]);

  return rootRef;
}

export default useFlipGroup;
