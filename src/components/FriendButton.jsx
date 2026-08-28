import { useI18n } from "../i18n";
import { FRIEND_RELATIONS } from "../online/friends.js";
import "./FriendButton.css";

function FriendButton({
  relation,
  onAdd,
  onAccept,
  onDecline,
  onCancel,
  onRemove,
  busy = false,
  compact = false,
}) {
  const { t } = useI18n();
  if (!relation || relation === FRIEND_RELATIONS.self) return null;

  if (relation === FRIEND_RELATIONS.friends) {
    if (onRemove) {
      return (
        <button
          type="button"
          className="friend-btn friend-btn--remove"
          data-friend-remove="true"
          disabled={busy}
          onClick={onRemove}
        >
          {t("friends.removeFriend")}
        </button>
      );
    }
    return (
      <span className="friend-btn friend-btn--state" data-friend-relation="friends">
        {t("friends.friends")}
      </span>
    );
  }

  if (relation === FRIEND_RELATIONS.outgoing) {
    return (
      <span className="friend-btn__pair">
        <span className="friend-btn friend-btn--state" data-friend-relation="outgoing">
          {t("friends.pending")}
        </span>
        {onCancel ? (
          <button
            type="button"
            className="friend-btn friend-btn--ghost"
            data-friend-cancel="true"
            disabled={busy}
            onClick={onCancel}
          >
            {t("friends.cancel")}
          </button>
        ) : null}
      </span>
    );
  }

  if (relation === FRIEND_RELATIONS.incoming) {
    return (
      <span className="friend-btn__pair">
        <button
          type="button"
          className="friend-btn friend-btn--accept"
          data-friend-accept="true"
          disabled={busy}
          onClick={onAccept}
        >
          {t("friends.accept")}
        </button>
        <button
          type="button"
          className="friend-btn friend-btn--ghost"
          data-friend-decline="true"
          disabled={busy}
          onClick={onDecline}
        >
          {t("friends.decline")}
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`friend-btn friend-btn--add${compact ? " friend-btn--compact" : ""}`}
      data-friend-add="true"
      disabled={busy}
      onClick={onAdd}
    >
      {t("friends.addFriend")}
    </button>
  );
}

export default FriendButton;
