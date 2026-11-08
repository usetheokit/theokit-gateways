/**
 * Options and seams of `ClickClackAdapter`.
 *
 * @public
 */

import type {
  RealtimeBotOptions,
  RealtimeSocket,
  RealtimeSocketFactory,
} from "@theokit/gateway-bot-realtime";

/**
 * The part of a WebSocket the adapter uses. Node 22's global `WebSocket` satisfies it.
 *
 * @public
 */
export type ClickClackSocket = RealtimeSocket;

/**
 * Opens the realtime socket. `headers` carries the bearer token.
 *
 * @public
 */
export type ClickClackSocketFactory = RealtimeSocketFactory;

/**
 * Construction options for `ClickClackAdapter`.
 *
 * @public
 */
export interface ClickClackAdapterOptions extends RealtimeBotOptions {
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
}
