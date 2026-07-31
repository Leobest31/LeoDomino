import "./Avatar.css";

/**
 * Premium medallion avatar (CSS-only artwork).
 */
function Avatar({ label = "?", tone = "player", size = "md", active = false }) {
  const initial = String(label).trim().charAt(0).toUpperCase() || "?";

  return (
    <div
      className={`avatar avatar--${tone} avatar--${size}${active ? " avatar--active" : ""}`}
      aria-hidden="true"
    >
      <span className="avatar__ring" />
      <span className="avatar__face">{initial}</span>
    </div>
  );
}

export default Avatar;
