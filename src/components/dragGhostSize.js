/**
 * Pixel box for the pointer-following tile. Measured hand size wins so
 * Classic `width: auto` / collapsed absolute children cannot shrink to a dot.
 * @param {unknown} width
 * @param {unknown} height
 * @returns {{ width: string, height: string, ["--domino-w"]: string, ["--domino-h"]: string } | null}
 */
export function dragGhostSizeStyle(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) return null;
  return {
    width: `${w}px`,
    height: `${h}px`,
    "--domino-w": `${w}px`,
    "--domino-h": `${h}px`,
  };
}
