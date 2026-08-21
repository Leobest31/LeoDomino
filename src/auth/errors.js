/**
 * Shared auth error type used by local and cloud adapters.
 */
export class AuthError extends Error {
  /**
   * @param {string} code
   * @param {string} [field]
   */
  constructor(code, field) {
    super(code);
    this.name = "AuthError";
    this.code = code;
    this.field = field || null;
  }
}
