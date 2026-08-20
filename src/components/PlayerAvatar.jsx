import { resolvePlayerAvatar } from "../auth/avatars.media.js";
import "./PlayerAvatar.css";

function PlayerAvatar({ avatarId, size = "sm", alt = "" }) {
  const avatar = resolvePlayerAvatar(avatarId);
  return (
    <img
      className={`player-avatar player-avatar--${size}`}
      src={avatar.src}
      alt={alt}
      draggable={false}
    />
  );
}

export default PlayerAvatar;
