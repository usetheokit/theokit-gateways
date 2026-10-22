/**
 * Options and seams for `NextcloudTalkAdapter`.
 *
 * @public
 */

import type { Express } from "express";

/**
 * The part of `fetch` the adapter uses. The default is the global `fetch`; tests pass a scripted
 * one, so nothing reaches a server.
 *
 * @public
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Construction options for `NextcloudTalkAdapter`.
 *
 * @public
 */
export interface NextcloudTalkAdapterOptions {
  /**
   * The Nextcloud server, `https://cloud.example.com`, without a trailing path. The adapter reads
   * `<baseUrl>/ocs/v2.php/cloud/capabilities` and posts to
   * `<baseUrl>/ocs/v2.php/apps/spreed/api/v1/bot/<room>/message`.
   */
  readonly baseUrl: string;
  /**
   * The nextcloud-talk bot secret: the shared key Talk signs every webhook with and checks every
   * bot message against. Talk requires 40 to 128 characters.
   *
   * @platform-term the `secret` argument of `occ talk:bot:install`
   * @issued-at chosen by the server's administrator and passed to
   *   `occ talk:bot:install <name> <secret> <webhook url>`; Talk never shows it again
   */
  readonly secret: string;
  /**
   * Port the webhook listener binds. Default 3000, the default of every webhook adapter in this
   * family, so two of them in one process need distinct ports or a shared `app`. A port another
   * listener holds makes `connect()` answer `false`. Ignored when `app` is given.
   */
  readonly port?: number;
  /**
   * Mount the webhook route on this Express app instead of creating one. The caller owns
   * listening, and `connect()` opens no port. The route stays mounted after `disconnect()`, and a
   * later `connect()` mounts it again; the first one still answers.
   */
  readonly app?: Express;
  /** Path of the webhook route. Default `/nextcloud-talk`. */
  readonly path?: string;
  /** How long `connect()` waits for the capabilities read. Default 10000 ms. */
  readonly connectTimeoutMs?: number;
  /** Test seam: the `fetch` used for the capabilities read and sends. Default the global `fetch`. */
  readonly fetch?: FetchLike;
}
