/**
 * Options and seams of `QQAdapter`.
 *
 * @public
 */

/** A `fetch`-shaped function; the adapter's only HTTP seam. @public */
export type QQFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

/** The part of a WebSocket the gateway session uses. Node's global `WebSocket` has this shape. @public */
export interface QQSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((message: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

/** Credentials and seams for `QQAdapter`. @public */
export interface QQAdapterOptions {
  /**
   * The QQ Bot AppID (public, like a username).
   *
   * @platform-term AppID (QQ Bot)
   * @issued-at the QQ Open Platform (q.qq.com), the bot's Development settings
   */
  readonly appId: string;
  /**
   * The bot's AppSecret (ClientSecret); exchanged for a short-lived access token.
   *
   * @platform-term AppSecret / ClientSecret (QQ Bot)
   * @issued-at the QQ Open Platform (q.qq.com), the bot's Development settings
   */
  readonly clientSecret: string;
  /** Gateway intents bitmask. Default `1 << 25` (group and C2C messages). */
  readonly intents?: number;
  /** Override the OpenAPI base, `https://api.sgroup.qq.com` (use the sandbox host for a sandbox bot). */
  readonly apiBase?: string;
  /** Override the token endpoint, `https://bots.qq.com/app/getAppAccessToken`. */
  readonly tokenUrl?: string;
  /** Milliseconds `connect()` waits for the gateway READY. Default 10000. */
  readonly connectTimeoutMs?: number;
  /** Test seam; defaults to global `fetch`. */
  readonly fetch?: QQFetch;
  /** Test seam: opens a gateway socket. Default Node's global `WebSocket`. */
  readonly socketFactory?: (url: string) => QQSocket;
}
