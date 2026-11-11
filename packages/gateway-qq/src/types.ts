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
   * @issued-at the QQ Open Platform (q.qq.com), the bot's development settings
   */
  readonly appId: string;
  /**
   * The bot's AppSecret; exchanged for a short-lived access token and the source of the callback
   * signing key.
   *
   * @platform-term AppSecret (QQ Bot)
   * @issued-at the QQ Open Platform (q.qq.com), the bot's development settings
   */
  readonly clientSecret: string;
  /** Override the token endpoint, `https://bots.qq.com/app/getAppAccessToken`. */
  readonly tokenUrl?: string;
  /** Override the API base, `https://api.sgroup.qq.com` (the sandbox is `https://sandbox.api.sgroup.qq.com`). */
  readonly apiBase?: string;
  /** Test seam; defaults to global `fetch`. */
  readonly fetch?: QQFetch;
}

/** The callback body: a gateway payload (`op` 0 dispatch, `op` 13 validation). @public */
export interface QQWebhookPayload {
  readonly id?: string;
  readonly op?: number;
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
