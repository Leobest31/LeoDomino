/**
 * Session-scoped memory of matches that were authoritatively terminal.
 * Survives Home/Find Match remounts in the same tab so a forfeited/completed
 * match cannot be resumed from a stale playing snapshot during a later outage.
 *
 * Does not invent terminal state. Callers must have positive evidence
 * (status, finish_reason, session match_over, or a successful forfeit RPC).
 */

export const TERMINAL_MATCH_MEMORY_KEY = "leodomino.terminalMatches";
const MAX_IDS = 32;

const notedIds = new Set();
let hydratedFromStorage = false;

function readPersisted(storage) {
  if (!storage?.getItem) return [];
  try {
    const parsed = JSON.parse(storage.getItem(TERMINAL_MATCH_MEMORY_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id) => typeof id === "string" && id);
  } catch {
    return [];
  }
}

function hydrate(storage) {
  if (hydratedFromStorage) return;
  hydratedFromStorage = true;
  for (const id of readPersisted(storage)) notedIds.add(id);
}

function persist(storage) {
  if (!storage?.setItem) return;
  const ids = [...notedIds];
  const trimmed = ids.length > MAX_IDS ? ids.slice(ids.length - MAX_IDS) : ids;
  if (trimmed.length !== ids.length) {
    notedIds.clear();
    for (const id of trimmed) notedIds.add(id);
  }
  try {
    storage.setItem(TERMINAL_MATCH_MEMORY_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota / private mode */
  }
}

/** Test-only: isolate in-process note state between cases. */
export function resetTerminalMatchMemory() {
  notedIds.clear();
  hydratedFromStorage = true;
}

/**
 * @param {string|null|undefined} matchId
 * @param {Storage} [storage]
 */
export function noteTerminalMatch(matchId, storage = globalThis.sessionStorage) {
  if (typeof matchId !== "string" || !matchId) return;
  hydrate(storage);
  notedIds.add(matchId);
  persist(storage);
}

/**
 * @param {string|null|undefined} matchId
 * @param {Storage} [storage]
 */
export function isNotedTerminalMatch(matchId, storage = globalThis.sessionStorage) {
  if (typeof matchId !== "string" || !matchId) return false;
  hydrate(storage);
  return notedIds.has(matchId);
}
