/**
 * Options and wire shapes of `QQAdapter`.
 *
 * @public
 */

/** A `fetch`-shaped function; the adapter's only network seam. @public */
export type QQFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

/** Credentials and seams for `QQAdapter`. @public */
export interface QQAdapterOptions {
  /**
   * The bot's AppID (public, like a username).
   *
   * @platform-term AppID (QQ Bot)
   * @issued-at q.qq.com, the bot's Development settings page
   */
  readonly appId: string;
  /**
   * The bot's AppSecret; exchanged for a short-lived access token and the seed of the webhook
   * signing key.
   *
   * @platform-term AppSecret (QQ Bot)
   * @issued-at q.qq.com, the bot's Development settings page
   */
  readonly appSecret: string;
  /** Override the API base, `https://api.sgroup.qq.com`. */
  readonly apiBase?: string;
  /** Override the token endpoint, `https://bots.qq.com/app/getAppAccessToken`. */
  readonly tokenUrl?: string;
  /** Test seam; defaults to global `fetch`. */
  readonly fetch?: QQFetch;
}

/** The body of a webhook callback. @public */
export interface QQWebhookPayload {
  readonly id?: string;
  /** 0 = dispatch, 13 = callback URL validation. */
  readonly op?: number;
  /** The event name when `op` is 0, e.g. `C2C_MESSAGE_CREATE`. */
  readonly t?: string;
  readonly d?: {
    readonly id?: string;
    readonly content?: string;
    readonly timestamp?: string;
    readonly author?: { readonly user_openid?: string };
    readonly plain_token?: string;
    readonly event_ts?: string;
  };
}
