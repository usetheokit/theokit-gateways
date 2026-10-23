/**
 * Options, seams and errors of `SynologyChatAdapter`.
 *
 * @public
 */

import type { Express } from "express";

/**
 * The `fetch` the adapter calls the NAS with; the default is the global `fetch`.
 *
 * @public
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * A configuration the adapter refuses at construction: an empty bot token, or an incoming URL that
 * is not an http(s) URL carrying a `token` parameter.
 *
 * @public
 */
export class SynologyChatConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SynologyChatConfigError";
  }
}

/**
 * Construction options for `SynologyChatAdapter`.
 *
 * @public
 */
export interface SynologyChatAdapterOptions {
  /**
   * The token Synology Chat sends with every outgoing callback of the synology-chat bot; a callback
   * whose `token` differs is answered 401.
   *
   * @platform-term bot token (Outgoing URL token)
   * @issued-at Synology Chat → Integration → Bots → your bot, shown beside the Outgoing URL
   */
  readonly botToken: string;
  /**
   * The synology-chat bot's Incoming URL, `https://<nas>/webapi/entry.cgi?api=SYNO.Chat.External&method=chatbot&version=2&token=…`.
   * It carries its own token, so it is never logged.
   *
   * @platform-term Incoming URL of a bot
   * @issued-at Synology Chat → Integration → Bots → your bot
   */
  readonly incomingUrl: string;
  /** The route the NAS posts callbacks to. Default `/synology-chat`. */
  readonly path?: string;
  /** The port of the adapter's own listener. Default 3000; ignored with `app`. */
  readonly port?: number;
  /** Mount the route on this Express app instead; the caller then owns listening. */
  readonly app?: Express;
  /** How long `connect()` waits for `user_list`. Default 10000 ms. */
  readonly connectTimeoutMs?: number;
  /** Test seam: the `fetch` used to call the NAS. */
  readonly fetch?: FetchLike;
}
