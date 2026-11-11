/**
 * Options and wire shapes of `YuanbaoAdapter`.
 *
 * @public
 */

/** A `fetch`-shaped function; the adapter's only network seam. @public */
export type YuanbaoFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

/** Credentials and seams for `YuanbaoAdapter`. @public */
export interface YuanbaoAdapterOptions {
  /**
   * The bot's app id (public, like a username).
   *
   * @platform-term AppID (Yuanbao bot)
   * @issued-at the Yuanbao bot console, the bot's credentials page
   */
  readonly appId: string;
  /**
   * The bot's app secret; exchanged for a short-lived access token.
   *
   * @platform-term AppSecret (Yuanbao bot)
   * @issued-at the Yuanbao bot console, the bot's credentials page
   */
  readonly appSecret: string;
  /**
   * The callback signing secret; signs each callback request.
   *
   * @platform-term Callback secret (Yuanbao bot)
   * @issued-at the Yuanbao bot console, the bot's event callback settings
   */
  readonly callbackSecret: string;
  /** Override the API base, `https://yuanbao.tencent.com`. */
  readonly apiBase?: string;
  /** Test seam; defaults to global `fetch`. */
  readonly fetch?: YuanbaoFetch;
}

/** The callback body of a message event. @public */
export interface YuanbaoWebhookEvent {
  readonly event_id?: string;
  readonly type?: string;
  readonly message?: {
    readonly id?: string;
    readonly text?: string;
    readonly create_time?: number;
    readonly from?: { readonly id?: string };
  };
}
