import { logoIcon } from "../assets";
import "./Avatar.css";

/**
 * Premium medallion avatar.
 * LeoBest uses the LeoDomino lion-head mark — not an imported opponent art.
 */
function Avatar({ label = "?", tone = "player", size = "md", active = false }) {
  const initial = String(label).trim().charAt(0).toUpperCase() || "?";
  const leoBest = tone === "leoBest";

  return (
    <div
      className={`avatar avatar--${tone} avatar--${size}${active ? " avatar--active" : ""}`}
      aria-hidden="true"
    >
      <span className="avatar__ring" />
      {leoBest ? (
        <span className="avatar__face avatar__face--crest">
          <img src={logoIcon} alt="" draggable={false} />
        </span>
      ) : (
        <span className="avatar__face">{initial}</span>
      )}
    </div>
  );
}

export default Avatar;
