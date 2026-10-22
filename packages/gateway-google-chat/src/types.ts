/**
 * Options and seams for `GoogleChatAdapter`.
 *
 * @public
 */

import type { Express } from "express";

/**
 * The part of `fetch` the adapter uses. The default is the global `fetch`; tests pass a scripted
 * one, so nothing reaches Google.
 *
 * @public
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Construction options for `GoogleChatAdapter`.
 *
 * @public
 */
export interface GoogleChatAdapterOptions {
  /**
   * The Chat app's service account, `<name>@<project>.iam.gserviceaccount.com`. The adapter signs
   * its token requests as this account.
   */
  readonly serviceAccountEmail: string;
  /**
   * The google-chat service account's private key, the PEM block in the `private_key` field of
   * its JSON key file. A `\n` written as two characters, as an environment variable often holds
   * it, is read as a line break.
   *
   * @platform-term `private_key` of a Google Cloud service account key
   * @issued-at Google Cloud console → IAM & Admin → Service Accounts → the Chat app's account →
   *   Keys → Add key → JSON
   */
  readonly privateKey: string;
  /**
   * The endpoint URL configured in the Chat app (Google Cloud console → Chat API →
   * Configuration → HTTP endpoint URL). Inbound tokens must carry exactly this audience; a
   * trailing slash on one side and not the other refuses every request.
   */
  readonly audience: string;
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
  /** Path of the webhook route. Default `/google-chat`. */
  readonly path?: string;
  /** How long `connect()` waits for the first access token. Default 10000 ms. */
  readonly connectTimeoutMs?: number;
  /** Test seam: the `fetch` used for tokens, key reads and sends. Default the global `fetch`. */
  readonly fetch?: FetchLike;
  /** Test seam: the clock, in ms since the epoch. Default `Date.now`. */
  readonly now?: () => number;
}
