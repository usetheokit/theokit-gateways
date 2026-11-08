/**
 * Options and seams of `BuzzAdapter`.
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
export type BuzzSocket = RealtimeSocket;

/**
 * Opens the realtime socket. `headers` carries the bearer token.
 *
 * @public
 */
export type BuzzSocketFactory = RealtimeSocketFactory;

/**
 * Construction options for `BuzzAdapter`.
 *
 * @public
 */
export interface BuzzAdapterOptions extends RealtimeBotOptions {
  /**
   * Base URL of the Buzz server, e.g. `https://chat.example.com`.
   *
   * @platform-term server URL
   * @issued-at the operator's own Buzz deployment
   */
  readonly baseUrl: string;
  /**
   * A bot token (`bz_…`) with `bot:write` and `realtime:read`.
   *
   * @platform-term bot token
   * @issued-at the Buzz admin console
   */
  readonly token: string;
}
