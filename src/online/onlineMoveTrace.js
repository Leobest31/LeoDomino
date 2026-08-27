/**
 * DEV-only online move lifecycle tracing.
 * Production builds never log or send trace payloads from this module's helpers
 * when import.meta.env.DEV is false.
 */

export function isOnlineMoveTraceEnabled() {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

export function createOnlineMoveTrace(kind) {
  const t0 =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  const marks = { kind };
  const mark = (name) => {
    const now =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    marks[name] = Math.round(now - t0);
    return marks[name];
  };
  mark("start");
  return {
    marks,
    mark,
    finish(extra = {}) {
      if (!isOnlineMoveTraceEnabled()) return marks;
      const row = { ...marks, ...extra };
      console.info("[online-move]", row);
      return row;
    },
  };
}

/**
 * Network plan for one normal play/draw/pass.
 * Actor: submitGameAction is required. Echo getGameView is not, if the HTTP
 * viewer snapshot already matches the new version.
 * Opponent: getGameView only when Realtime advanced the version and the
 * merged snapshot is not yet a coherent viewer.
 */
export function networkCallsForMove({
  isActor,
  hasCoherentViewerAtNewVersion,
  versionAdvanced,
} = {}) {
  return {
    submitGameAction: isActor ? 1 : 0,
    getGameView: hasCoherentViewerAtNewVersion ? 0 : versionAdvanced ? 1 : 0,
  };
}
