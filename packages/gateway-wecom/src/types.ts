/**
 * Options and wire shapes of `WeComAdapter`.
 *
 * @public
 */

/** A `fetch`-shaped function; the adapter's only network seam. @public */
export type WeComFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

/** Credentials and seams for `WeComAdapter`. @public */
export interface WeComAdapterOptions {
  /**
   * The WeCom corp id (public, like a username).
   *
   * @platform-term CorpID (WeCom)
   * @issued-at the WeCom admin console (work.weixin.qq.com), My Enterprise, Enterprise Info
   */
  readonly corpId: string;
  /**
   * The self-built application's Secret; exchanged for a short-lived access token.
   *
   * @platform-term Secret (WeCom self-built application)
   * @issued-at the WeCom admin console, Application Management, the application's page
   */
  readonly corpSecret: string;
  /**
   * The self-built application's AgentId; the sender of every reply.
   *
   * @platform-term AgentId (WeCom self-built application)
   * @issued-at the WeCom admin console, Application Management, the application's page
   */
  readonly agentId: number | string;
  /**
   * The callback Token you chose; signs each callback request.
   *
   * @platform-term Token (WeCom callback configuration)
   * @issued-at the WeCom admin console, the application's Receive Messages, API Receiving settings
   */
  readonly token: string;
  /**
   * The callback EncodingAESKey (43 characters); decrypts each callback.
   *
   * @platform-term EncodingAESKey (WeCom callback configuration)
   * @issued-at the WeCom admin console, the application's Receive Messages, API Receiving settings
   */
  readonly encodingAesKey: string;
  /** Override the API base, `https://qyapi.weixin.qq.com`. */
  readonly apiBase?: string;
  /** Test seam; defaults to global `fetch`. */
  readonly fetch?: WeComFetch;
}
