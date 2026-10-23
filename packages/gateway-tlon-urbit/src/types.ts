/**
 * Options and seams of `TlonUrbitAdapter`.
 *
 * @public
 */

/**
 * The `fetch` the adapter calls the ship with; the default is the global `fetch`.
 *
 * @public
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Construction options for `TlonUrbitAdapter`.
 *
 * @public
 */
export interface TlonUrbitAdapterOptions {
  /** The ship's HTTP base URL, for example `https://bot.tlon.network`. */
  readonly shipUrl: string;
  /** The bot's ship name, `~sampel-palnet` (the `~` may be left out). */
  readonly ship: string;
  /**
   * The tlon-urbit ship's web login code, four dash-joined syllable words. It is posted to
   * `/~/login` once per session and never logged.
   *
   * @platform-term `+code` (web login code)
   * @issued-at the ship's dojo, `+code`; Tlon hosting shows it in the ship's settings. It changes
   *   when the ship rotates it.
   */
  readonly code: string;
  /** How long `connect()` waits for the login and the subscription. Default 10000 ms. */
  readonly connectTimeoutMs?: number;
  /** Test seam: the `fetch` used to call the ship. */
  readonly fetch?: FetchLike;
}
