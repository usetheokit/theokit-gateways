/**
 * The ship refused the login code.
 *
 * @public
 */
export class TlonAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TlonAuthError";
  }
}
