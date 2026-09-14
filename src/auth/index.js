export {
  AUTH_ERROR,
  ACCOUNTS_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  PASSWORD_MIN_LENGTH,
  ACCOUNT_MIN_AGE,
  ACCOUNT_MAX_AGE,
} from "./constants.js";
export { AuthError } from "./errors.js";
export { authService, localAuth, isCloudAuth } from "./service.js";
export { AuthProvider } from "./AuthProvider.jsx";
export { useAuth } from "./useAuth.js";
export { publicAccount } from "./validation.js";
export {
  passwordResetRedirectTo,
  locationLooksLikeAuthCallback,
  PASSWORD_RECOVERY_EVENT,
} from "./passwordRecovery.js";
export {
  DEFAULT_AVATAR_ID,
  PLAYER_AVATAR_IDS,
  normalizeAvatarId,
} from "./avatars.js";
