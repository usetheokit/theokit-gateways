/**
 * Options and seams of `ZaloPersonalAdapter`.
 *
 * @public
 */

/**
 * A Zalo web session, the three values the `zca-js` login takes.
 *
 * @public
 */
export interface ZaloCredentials {
  /** The account's Zalo web cookie jar, as the JSON `zca-js` accepts. */
  readonly cookie: unknown;
  /** The device id the session was opened with. */
  readonly imei: string;
  /** The user agent the session was opened with. */
  readonly userAgent: string;
}

/**
 * A message the listener reports. The fields are the ones `zca-js` gives a `message` event.
 *
 * @public
 */
export interface ZaloListenerMessage {
  /** `0` for a direct chat, `1` for a group. */
  readonly type: number;
  readonly threadId: string;
  /** `true` for a message the logged-in account sent itself. */
  readonly isSelf?: boolean;
  readonly data: {
    readonly msgId?: unknown;
    readonly uidFrom?: unknown;
    readonly dName?: unknown;
    readonly content?: unknown;
  };
}

/**
 * The part of a logged-in `zca-js` API the adapter uses.
 *
 * @public
 */
export interface ZaloApi {
  readonly listener: {
    on(event: "message", handler: (message: ZaloListenerMessage) => void): void;
    on(event: "closed", handler: (code: number, reason: string) => void): void;
    on(event: "error", handler: (error: unknown) => void): void;
    start(): void;
    stop(): void;
  };
  sendMessage(
    message: { msg: string },
    threadId: string,
    type: number,
  ): Promise<{ message?: { msgId?: unknown } | null }>;
}

/**
 * Logs in and answers the API. The default imports `zca-js`, which the consumer installs.
 *
 * @public
 */
export type ZaloLogin = (credentials: ZaloCredentials) => Promise<ZaloApi>;

/**
 * Construction options for `ZaloPersonalAdapter`.
 *
 * @public
 */
export interface ZaloPersonalAdapterOptions {
  /**
   * The zalo-personal account's web session.
   *
   * @platform-term web session (cookie, imei, user agent)
   * @issued-at a browser signed in to chat.zalo.me, or the `zca-js` QR login, saved by the operator
   */
  readonly credentials: ZaloCredentials;
  /** Test seam: replaces the `zca-js` login. */
  readonly login?: ZaloLogin;
}
