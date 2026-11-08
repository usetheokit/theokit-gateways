/**
 * Options and seams shared by the realtime bot adapters.
 */

/** The part of a WebSocket the adapter uses. Node 22's global `WebSocket` satisfies it. */
export interface RealtimeSocket {
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(
    type: "close",
    listener: (event: { code?: number; reason?: string }) => void,
  ): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  close(): void;
}

/** Opens the realtime socket. `headers` carries the bearer token. */
export type RealtimeSocketFactory = (
  url: string,
  headers: Readonly<Record<string, string>>,
) => RealtimeSocket;

/** Construction options common to the realtime bot adapters. */
export interface RealtimeBotOptions {
  /** Base URL of the server, e.g. `https://chat.example.com`. */
  readonly baseUrl: string;
  /** A bot token with `bot:write` and `realtime:read`. */
  readonly token: string;
  /** The workspace whose realtime stream is followed. */
  readonly workspaceId: string;
  /** The bot's own user id; events it authored are ignored. */
  readonly botUserId: string;
  /** Test seam: replaces `fetch`. */
  readonly fetch?: typeof fetch;
  /** Test seam: replaces the global `WebSocket`. */
  readonly socket?: RealtimeSocketFactory;
  /** Wait before reconnecting a dropped socket, in ms. Default 2000; `0` disables reconnecting. */
  readonly reconnectDelayMs?: number;
}
