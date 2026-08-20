import {
  avatarAmina,
  avatarAndre,
  avatarCarmen,
  avatarDiego,
  avatarElena,
  avatarIsla,
  avatarJamal,
  avatarKenji,
  avatarLuca,
  avatarMarcus,
  avatarMei,
  avatarNia,
  avatarNoah,
  avatarOwen,
  avatarPriya,
  avatarRafael,
  avatarSofia,
  avatarTheo,
  avatarYara,
  avatarZara,
} from "../assets";
import { DEFAULT_AVATAR_ID, PLAYER_AVATAR_IDS, normalizeAvatarId } from "./avatars.js";

const AVATAR_ART = Object.freeze({
  marcus: avatarMarcus,
  rafael: avatarRafael,
  andre: avatarAndre,
  noah: avatarNoah,
  jamal: avatarJamal,
  diego: avatarDiego,
  kenji: avatarKenji,
  theo: avatarTheo,
  luca: avatarLuca,
  owen: avatarOwen,
  amina: avatarAmina,
  sofia: avatarSofia,
  priya: avatarPriya,
  elena: avatarElena,
  nia: avatarNia,
  yara: avatarYara,
  mei: avatarMei,
  isla: avatarIsla,
  zara: avatarZara,
  carmen: avatarCarmen,
});

export const PLAYER_AVATARS = Object.freeze(
  PLAYER_AVATAR_IDS.map((id) => ({ id, src: AVATAR_ART[id] }))
);

export function resolvePlayerAvatar(id) {
  const avatarId = normalizeAvatarId(id);
  return { id: avatarId, src: AVATAR_ART[avatarId] };
}

export { DEFAULT_AVATAR_ID, PLAYER_AVATAR_IDS, normalizeAvatarId };
