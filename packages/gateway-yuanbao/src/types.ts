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
   * The bot's app key (public, like a username).
   *
   * @platform-term AppKey (Yuanbao bot)
   * @issued-at the Tencent Yuanbao bot platform, the bot's application settings
   */
  readonly appKey: string;
  /**
   * The bot's app secret; signs the token request and verifies each inbound webhook.
   *
   * @platform-term AppSecret (Yuanbao bot)
   * @issued-at the Tencent Yuanbao bot platform, the bot's application settings
   */
  readonly appSecret: string;
  /** Override the API base, `https://bot.yuanbao.tencent.com`. */
  readonly apiBase?: string;
  /** Test seam; defaults to global `fetch`. */
  readonly fetch?: YuanbaoFetch;
}
