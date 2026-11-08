/**
 * Options and seams for `FeishuLarkAdapter`.
 *
 * @public
 */

/**
 * What one open-platform call answered: `code` 0 is success, anything else is Lark's own error
 * code with its `msg`.
 *
 * @public
 */
export interface LarkApiResult {
  readonly code: number;
  readonly msg?: string;
  /** The created or replied message's id, on a successful send. */
  readonly messageId?: string;
}

/**
 * Callbacks the long connection reports to.
 *
 * @public
 */
export interface LarkConnectionHandlers {
  /** One `im.message.receive_v1` event, as the SDK's dispatcher hands it over. Must not throw. */
  readonly onMessage: (data: unknown) => void;
  /** The SDK gave up: initial connect refused for good, or its reconnects exhausted (D7). */
  readonly onError: (err: Error) => void;
}

/**
 * The part of the Lark open platform the adapter uses. The default is built from
 * `@larksuiteoapi/node-sdk`; tests pass a scripted one.
 *
 * @public
 */
export interface LarkTransport {
  /** Fetch a tenant access token, which proves the app id and secret. */
  tenantToken(): Promise<LarkApiResult>;
  /** Open the long connection; resolves once it is up, rejects when the first connect fails. */
  start(handlers: LarkConnectionHandlers): Promise<void>;
  /** Send `text` as a new message to the chat `chatId`. */
  createMessage(chatId: string, text: string): Promise<LarkApiResult>;
  /** Send `text` as a reply to the message `messageId`. */
  replyMessage(messageId: string, text: string): Promise<LarkApiResult>;
  /** Close the long connection. Idempotent. */
  close(): void;
}

/**
 * Construction options for `FeishuLarkAdapter`.
 *
 * @public
 */
export interface FeishuLarkAdapterOptions {
  /** The app's App ID, `cli_` followed by 16 hex characters. */
  readonly appId: string;
  /**
   * The feishu-lark app's App Secret. With the App ID it fetches the tenant access token every call
   * uses and authenticates the long connection.
   *
   * @platform-term App Secret
   * @issued-at the Feishu or Lark developer console, Credentials & Basic Info page of the custom app
   */
  readonly appSecret: string;
  /** Which open platform the app lives on: `"feishu"` (open.feishu.cn, the default) or `"lark"` (open.larksuite.com). */
  readonly domain?: "feishu" | "lark";
  /** Test seam: the open-platform transport. Default one built from `@larksuiteoapi/node-sdk`. */
  readonly transport?: LarkTransport;
}
