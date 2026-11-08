/**
 * Options and seams of `TwitchAdapter`.
 *
 * @public
 */

/**
 * The `fetch` the adapter calls Twitch with; the default is the global `fetch`.
 *
 * @public
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * The part of a WebSocket the EventSub session uses. Node's global `WebSocket` has this shape.
 *
 * @public
 */
export interface TwitchSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((message: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

/**
 * Construction options for `TwitchAdapter`.
 *
 * @public
 */
export interface TwitchAdapterOptions {
  /**
   * The bot account's twitch user access token, with the `user:read:chat` and `user:write:chat`
   * scopes. It authenticates the EventSub subscriptions and every chat message the bot sends.
   * The adapter does not refresh it; supply a fresh one when it expires.
   *
   * @platform-term user access token (OAuth)
   * @issued-at the Twitch developer console app's OAuth flow (Authorization Code or Device Code) for
   *   the bot account
   */
  readonly accessToken: string;
  /** The bot account's numeric user id; it must be the token's own. */
  readonly botUserId: string;
  /** The numeric user ids of the channels whose chat the bot reads. At least one. */
  readonly broadcasterUserIds: readonly string[];
  /** The EventSub WebSocket URL. Default `wss://eventsub.wss.twitch.tv/ws`. */
  readonly eventSubUrl?: string;
  /** Test seam: the `fetch` used for the token validator and Helix. */
  readonly fetch?: FetchLike;
  /** Test seam: opens an EventSub socket. Default Node's global `WebSocket`. */
  readonly socketFactory?: (url: string) => TwitchSocket;
}
