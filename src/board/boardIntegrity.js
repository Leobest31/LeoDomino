/**
 * Board completeness invariant: every played tile ID must appear exactly
 * once in the layout that reaches the renderer.
 */

export function playedTableTiles(board = [], north = [], south = []) {
  return [...board, ...north, ...south].filter((tile) => tile && tile.id);
}

export function layoutRenderedBoxes(layout) {
  return [...(layout?.tiles || []), ...(layout?.armTiles || [])];
}

function orientationOk(value) {
  return value === "horizontal" || value === "vertical";
}

/**
 * @param {object} layout
 * @param {{ id: string }[]} playedTiles
 * @param {object} [extras]
 */
export function inspectBoardLayoutIntegrity(layout, playedTiles, extras = {}) {
  const played = playedTableTiles(playedTiles);
  const boxes = layoutRenderedBoxes(layout);
  const ids = boxes.map((box) => box.tileId ?? box.id);
  const unique = new Set(ids);
  const playedIds = played.map((tile) => tile.id);
  const playedSet = new Set(playedIds);
  const missing = playedIds.filter((id) => !unique.has(id));
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  const unexpected = ids.filter((id) => id && !playedSet.has(id));
  const invalid = boxes.filter((box) => {
    const x = Number(box.x);
    const y = Number(box.y);
    const w = Number(box.w);
    const h = Number(box.h);
    return !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0;
  });
  const orientationBad = boxes.filter((box) => !orientationOk(box.orientation));
  const ok =
    missing.length === 0 &&
    duplicates.length === 0 &&
    invalid.length === 0 &&
    orientationBad.length === 0 &&
    boxes.length === played.length &&
    unique.size === played.length;

  let reason = "ok";
  if (!ok) {
    if (missing.length) reason = "missing-tiles";
    else if (duplicates.length) reason = "duplicate-tiles";
    else if (invalid.length) reason = "nonfinite-position";
    else if (orientationBad.length) reason = "invalid-orientation";
    else reason = "count-mismatch";
  }

  return {
    ok,
    reason,
    playedCount: played.length,
    layoutCount: boxes.length,
    uniqueCount: unique.size,
    missing,
    duplicates,
    unexpected,
    invalidIds: invalid.map((box) => box.tileId ?? box.id),
    orientationIds: orientationBad.map((box) => box.tileId ?? box.id),
    scale: layout?.scale ?? null,
    packing: layout?.packing ?? extras.packing ?? null,
    routingCandidate: extras.routingCandidate ?? layout?.packing ?? null,
    failureReason: extras.failureReason ?? reason,
  };
}

export function formatLayoutIntegrityError(report) {
  return (
    `[LeoDomino] Incomplete board layout: ` +
    `missing=${(report.missing || []).join(",") || "none"} ` +
    `board=${report.playedCount} layout=${report.layoutCount} ` +
    `scale=${report.scale} ` +
    `routing=${JSON.stringify(report.routingCandidate)} ` +
    `reason=${report.failureReason || report.reason}`
  );
}

export function assertBoardLayoutIntegrity(layout, playedTiles, extras = {}) {
  const report = inspectBoardLayoutIntegrity(layout, playedTiles, extras);
  if (!report.ok) {
    const error = new Error(formatLayoutIntegrityError(report));
    error.report = report;
    throw error;
  }
  return report;
}

export function layoutDevDiagnosticsEnabled() {
  try {
    if (import.meta?.env?.DEV) return true;
  } catch {
    /* Node tests */
  }
  return typeof process !== "undefined" && process.env.NODE_ENV !== "production";
}
