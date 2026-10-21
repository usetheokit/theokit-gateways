/**
 * Options and seams for `IrcAdapter`.
 *
 * @public
 */

import type { Duplex } from "node:stream";

/**
 * Where the adapter connects, as the socket factory receives it.
 *
 * @public
 */
export interface IrcEndpoint {
  readonly host: string;
  readonly port: number;
  readonly tls: boolean;
}

/**
 * Opens the connection to the IRC server. The default opens `node:tls` (or `node:net` when `tls`
 * is false); tests pass one that connects to an in-process server.
 *
 * @public
 */
export type SocketFactory = (endpoint: IrcEndpoint) => Duplex;

/**
 * Construction options for `IrcAdapter`.
 *
 * @public
 */
export interface IrcAdapterOptions {
  /** The IRC server's host name, for example `irc.libera.chat`. */
  readonly host: string;
  /** The server's port. Default 6697, the TLS port most networks use. */
  readonly port?: number;
  /** Whether to speak TLS. Default `true`. */
  readonly tls?: boolean;
  /**
   * The nick the adapter registers with. When the server answers that it is in use (numeric
   * 433), the adapter appends `_` and tries again, up to 3 times.
   */
  readonly nick: string;
  /** The username sent in `USER`. Default the nick. */
  readonly username?: string;
  /** The real name sent in `USER`. Default the nick. */
  readonly realname?: string;
  /**
   * The irc server password, sent as `PASS` before registration. Most public networks have none;
   * a bouncer or a private server may require one.
   *
   * @platform-term server password (`PASS`)
   * @issued-at by whoever runs the IRC server or bouncer; it is part of its configuration
   */
  readonly password?: string;
  /** The account name for SASL PLAIN. Default the nick. Used only with `saslPassword`. */
  readonly saslAccount?: string;
  /**
   * The password of the irc network account (NickServ), sent through SASL PLAIN before
   * registration completes. Without it no SASL is negotiated and the nick connects unregistered.
   *
   * @platform-term SASL PLAIN password of a services (NickServ) account
   * @issued-at the network's NickServ: `/msg NickServ REGISTER <password> <email>`, confirmed by
   *   the email it sends
   */
  readonly saslPassword?: string;
  /** Channels to join after registration, `#name` or `&name`. `connect()` waits for each. */
  readonly channels: readonly string[];
  /** How long `connect()` waits for registration and every join. Default 10000 ms. */
  readonly connectTimeoutMs?: number;
  /** Test seam: opens the connection. Default `node:tls` or `node:net`. */
  readonly socketFactory?: SocketFactory;
}
