/**
 * Options and seams of `ClickClackAdapter`.
 *
 * @public
 */

/**
 * The part of a WebSocket the adapter uses. Node 22's global `WebSocket` satisfies it.
 *
 * @public
 */
export interface ClickClackSocket {
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(
    type: "close",
    listener: (event: { code?: number; reason?: string }) => void,
  ): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  close(): void;
}

/**
 * Opens the realtime socket. `headers` carries the bearer token.
 *
 * @public
 */
export type ClickClackSocketFactory = (
  url: string,
  headers: Readonly<Record<string, string>>,
) => ClickClackSocket;

/**
 * Construction options for `ClickClackAdapter`.
 *
 * @public
 */
export interface ClickClackAdapterOptions {
  /**
   * Base URL of the ClickClack server, e.g. `https://chat.example.com`.
   *
   * @platform-term server URL
   * @issued-at the operator's own ClickClack deployment
   */
  readonly baseUrl: string;
  /**
   * A bot token (`ccb_…`) with `bot:write` and `realtime:read`.
   *
   * @platform-term bot token
   * @issued-at `clickclack admin bot create`
   */
  readonly token: string;
  /** The workspace whose realtime stream is followed. */
  readonly workspaceId: string;
  /** The bot's own user id; events it authored are ignored. */
  readonly botUserId: string;
  /** Test seam: replaces `fetch`. */
  readonly fetch?: typeof fetch;
  /** Test seam: replaces the global `WebSocket`. */
  readonly socket?: ClickClackSocketFactory;
  /** Wait before reconnecting a dropped socket, in ms. Default 2000; `0` disables reconnecting. */
  readonly reconnectDelayMs?: number;
}
