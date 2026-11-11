/**
 * Options and wire shapes of `WeChatAdapter`.
 *
 * @public
 */

/** A `fetch`-shaped function; the adapter's only network seam. @public */
export type WeChatFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

/** Credentials and seams for `WeChatAdapter`. @public */
export interface WeChatAdapterOptions {
  /**
   * The Official Account AppID (public, like a username).
   *
   * @platform-term AppID (WeChat Official Account)
   * @issued-at the WeChat Official Accounts Platform (mp.weixin.qq.com), Settings and Development, Basic Configuration
   */
  readonly appId: string;
  /**
   * The Official Account AppSecret; exchanged for a short-lived access token.
   *
   * @platform-term AppSecret (WeChat Official Account)
   * @issued-at the WeChat Official Accounts Platform (mp.weixin.qq.com), Settings and Development, Basic Configuration
   */
  readonly appSecret: string;
  /**
   * The server-URL verification token you chose; signs each webhook request and is used only to
   * verify it.
   *
   * @platform-term Token (WeChat Official Account server configuration)
   * @issued-at the WeChat Official Accounts Platform (mp.weixin.qq.com), Settings and Development, Basic Configuration, Server Configuration
   */
  readonly token: string;
  /** Override the API base, `https://api.weixin.qq.com`. */
  readonly apiBase?: string;
  /** Test seam; defaults to global `fetch`. */
  readonly fetch?: WeChatFetch;
}
