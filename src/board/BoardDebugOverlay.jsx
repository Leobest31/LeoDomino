/**
 * Board debug overlay — fixed collision rectangles, visual boxes, path, turns.
 * Enable with ?boardDebug=1 or localStorage leodomino.boardDebug=1
 */

export default function BoardDebugOverlay({ debug, gap = 2 }) {
  if (!debug?.boxes?.length) return null;

  const { boxes, path, turnPoints = [] } = debug;
  const pathD = path
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  return (
    <svg
      className="board-container__debug"
      width="100%"
      height="100%"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 20,
        overflow: "visible",
      }}
      aria-hidden="true"
    >
      {/* Fixed collision rectangles (spinner halo included) */}
      {boxes.map((b) => {
        const c = b.collision || {
          x: b.x - gap / 2,
          y: b.y - gap / 2,
          w: b.w + gap,
          h: b.h + gap,
        };
        return (
          <rect
            key={`col-${b.id}`}
            x={c.x}
            y={c.y}
            width={c.w}
            height={c.h}
            fill={b.double ? "rgba(255, 112, 67, 0.12)" : "rgba(220, 80, 60, 0.06)"}
            stroke={b.double ? "rgba(255, 112, 67, 0.85)" : "rgba(220, 80, 60, 0.45)"}
            strokeWidth={b.double ? 1.5 : 1}
            strokeDasharray={b.double ? "4 2" : "3 3"}
          />
        );
      })}

      {/* Visual tile bounding boxes */}
      {boxes.map((b) => (
        <rect
          key={`box-${b.id}`}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          fill="none"
          stroke="#f5d76e"
          strokeWidth={1.5}
        />
      ))}

      {/* Chain path */}
      <path d={pathD} fill="none" stroke="#4fc3f7" strokeWidth={2} opacity={0.9} />

      {/* Centers + index labels */}
      {boxes.map((b) => (
        <g key={`pt-${b.id}`}>
          <circle cx={b.cx} cy={b.cy} r={3} fill="#4fc3f7" />
          <text
            x={b.cx}
            y={b.y - 4}
            textAnchor="middle"
            fill="#fff8e7"
            fontSize="10"
            fontFamily="monospace"
            style={{ paintOrder: "stroke", stroke: "#000", strokeWidth: 2 }}
          >
            {b.index}:{b.id}
            {b.double ? "◆" : ""}
          </text>
        </g>
      ))}

      {/* Turn points */}
      {turnPoints.map((t) => (
        <g key={`turn-${t.id}-${t.index}`}>
          <circle
            cx={t.x}
            cy={t.y}
            r={7}
            fill="none"
            stroke="#ff7043"
            strokeWidth={2}
          />
          <text
            x={t.x + 10}
            y={t.y + 3}
            fill="#ff7043"
            fontSize="9"
            fontFamily="monospace"
          >
            {t.from}→{t.to}
          </text>
        </g>
      ))}
    </svg>
  );
}
