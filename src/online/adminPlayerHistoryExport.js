/**
 * Client-only Admin player match-history export helpers.
 * Clipboard text + CSV download. No backend.
 */

function clip(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function playerName(player) {
  if (!player) return "—";
  const display = clip(player.displayName);
  const username = clip(player.username);
  if (display && username && display !== username) return `${display} (@${username})`;
  return display || username || "—";
}

function scoreLabel(score) {
  if (!score || typeof score !== "object") return "—";
  if (score.selected != null && score.opponent != null) {
    return `${score.selected}–${score.opponent}`;
  }
  if (score.a != null && score.b != null) {
    return `${score.a}–${score.b}`;
  }
  return "—";
}

function loserLabel(match, selectedPlayer) {
  const username = clip(match?.loserUsername);
  const display = clip(match?.loserDisplayName);
  if (display || username) {
    return display && username && display !== username ? `${display} (@${username})` : display || username;
  }
  if (match?.selectedResult === "win" && match?.opponent) {
    return playerName(match.opponent);
  }
  if (match?.selectedResult === "loss" && selectedPlayer) {
    return playerName(selectedPlayer);
  }
  if (match?.loserPlayerId && selectedPlayer?.playerId === match.loserPlayerId) {
    return playerName(selectedPlayer);
  }
  return match?.loserPlayerId || "—";
}

/**
 * Plain-text staff copy report for currently loaded match history rows.
 */
export function formatCopyReport({
  player,
  leopipsBalance,
  levelXpStatus = "Unavailable",
  matches = [],
} = {}) {
  const lines = [
    "LeoDomino Admin — Player Match History",
    `Player: ${playerName(player)}`,
    `Player ID: ${clip(player?.playerId) || "—"}`,
    `LeoPips: ${leopipsBalance == null ? "—" : String(leopipsBalance)}`,
    `Level: ${levelXpStatus}`,
    `XP: ${levelXpStatus}`,
    "",
    `Loaded matches: ${Array.isArray(matches) ? matches.length : 0}`,
    "",
  ];

  for (const match of Array.isArray(matches) ? matches : []) {
    lines.push(`- Match ID: ${clip(match.matchId) || "—"}`);
    lines.push(`  Opponent: ${playerName(match.opponent)}`);
    lines.push(`  Style: ${clip(match.styleLabel || match.rulesetId) || "—"}`);
    lines.push(`  Kind: ${clip(match.matchKind) || "—"}`);
    lines.push(
      `  Rated: ${match.rated == null ? "—" : match.rated ? "yes" : "no"}`
    );
    lines.push(`  Stake: ${match.stakePips == null ? "—" : String(match.stakePips)}`);
    lines.push(`  Result: ${clip(match.selectedResult) || "—"}`);
    lines.push(`  Winner: ${clip(match.winnerUsername) || clip(match.winnerPlayerId) || "—"}`);
    lines.push(`  Loser: ${loserLabel(match, player)}`);
    lines.push(`  Score: ${scoreLabel(match.finalScore)}`);
    lines.push(`  Finish: ${clip(match.finishReason) || "—"}`);
    lines.push(`  Status: ${clip(match.status) || "—"}`);
    lines.push(`  Started: ${clip(match.createdAt) || "—"}`);
    lines.push(`  Finished: ${clip(match.finishedAt) || "—"}`);
    lines.push(
      `  Duration (s): ${match.durationSeconds == null ? "—" : String(match.durationSeconds)}`
    );
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function escapeCsvField(value) {
  if (value == null) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

const CSV_HEADERS = [
  "player_name",
  "player_id",
  "leopips_balance",
  "level",
  "xp",
  "match_id",
  "opponent",
  "style",
  "match_kind",
  "rated",
  "stake_pips",
  "result",
  "winner",
  "loser",
  "score",
  "finish_reason",
  "status",
  "started_at",
  "finished_at",
  "duration_seconds",
];

/**
 * CSV text for currently loaded history + player summary columns.
 */
export function formatHistoryCsv({
  player,
  leopipsBalance,
  levelXpStatus = "Unavailable",
  matches = [],
} = {}) {
  const rows = [CSV_HEADERS.map(escapeCsvField).join(",")];
  const name = playerName(player);
  const id = clip(player?.playerId);
  const balance = leopipsBalance == null ? "" : String(leopipsBalance);
  const level = levelXpStatus;
  const xp = levelXpStatus;
  const list = Array.isArray(matches) ? matches : [];
  if (!list.length) {
    rows.push(
      [
        name,
        id,
        balance,
        level,
        xp,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]
        .map(escapeCsvField)
        .join(",")
    );
  } else {
    for (const match of list) {
      rows.push(
        [
          name,
          id,
          balance,
          level,
          xp,
          match.matchId || "",
          playerName(match.opponent),
          match.styleLabel || match.rulesetId || "",
          match.matchKind || "",
          match.rated == null ? "" : match.rated ? "yes" : "no",
          match.stakePips == null ? "" : String(match.stakePips),
          match.selectedResult || "",
          match.winnerUsername || match.winnerPlayerId || "",
          loserLabel(match, player),
          scoreLabel(match.finalScore),
          match.finishReason || "",
          match.status || "",
          match.createdAt || "",
          match.finishedAt || "",
          match.durationSeconds == null ? "" : String(match.durationSeconds),
        ]
          .map(escapeCsvField)
          .join(",")
      );
    }
  }
  return `${rows.join("\r\n")}\r\n`;
}

/** Blob suitable for client-side CSV download. */
export function toCsvBlob(input = {}) {
  const csv = typeof input === "string" ? input : formatHistoryCsv(input);
  return new Blob([csv], { type: "text/csv;charset=utf-8" });
}
