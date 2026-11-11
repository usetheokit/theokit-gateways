/**
 * Options and seams of `QQAdapter`.
 *
 * @public
 */

/** The part of a WebSocket the adapter uses. Node 22's global `WebSocket` satisfies it. @public */
export interface QQSocket {
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(
    type: "close",
    listener: (event: { code?: number; reason?: string }) => void,
  ): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  send(data: string): void;
  close(): void;
}

/** Opens the gateway socket at `url`. @public */
export type QQSocketFactory = (url: string) => QQSocket;

/** Construction options for `QQAdapter`. @public */
export interface QQAdapterOptions {
  /**
   * The bot's AppID (public, like a username).
   *
   * @platform-term AppID (QQ Bot)
   * @issued-at the QQ Open Platform console (q.qq.com), the bot's Development Settings
   */
  readonly appId: string;
  /**
   * The bot's AppSecret (`clientSecret`); exchanged for a short-lived access token.
   *
   * @platform-term AppSecret (QQ Bot)
   * @issued-at the QQ Open Platform console (q.qq.com), the bot's Development Settings
   */
  readonly clientSecret: string;
  /** Override the OpenAPI base, `https://api.sgroup.qq.com` (sandbox: `https://sandbox.api.sgroup.qq.com`). */
  readonly apiBase?: string;
  /** Override the token endpoint, `https://bots.qq.com/app/getAppAccessToken`. */
  readonly tokenUrl?: string;
  /** Test seam; defaults to global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Test seam; defaults to the global `WebSocket`. */
  readonly socket?: QQSocketFactory;
  /** Wait before reconnecting a dropped socket, in ms. Default 2000; `0` disables reconnecting. */
  readonly reconnectDelayMs?: number;
}
