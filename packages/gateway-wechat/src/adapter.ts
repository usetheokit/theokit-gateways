/**
 * `WeChatAdapter` — `BasePlatformAdapter` over a WeChat (Weixin) Official Account: signed XML
 * webhook in, customer-service message API out.
 *
 * @public
 */

import {
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
  WeixinAdapterBase,
  type WeixinSendRequest,
  type WeixinWebhookAnswer,
} from "@theokit/gateway";
import { NonceMemory } from "./nonce-memory.js";
import { refuseAttachments } from "./refuse-attachments.js";
import { isWeChatTimestampFresh, verifyWeChatSignature } from "./signature.js";
import { splitForWeChat } from "./split.js";
import type { WeChatAdapterOptions } from "./types.js";

const LABEL = "gateway-wechat";
const DEFAULT_BASE = "https://api.weixin.qq.com";

/** The query string of a webhook request, plus `echostr` on the verification GET. */
export interface WeChatWebhookRequest {
  readonly signature?: string;
  readonly timestamp?: string;
  readonly nonce?: string;
  readonly echostr?: string;
}

/**
 * What a webhook route answers. `body` is the text to write back: the `echostr` on a
 * verification, `success` on an acknowledged message. Anything but 200 makes WeChat retry.
 */
export type WeChatWebhookAnswer = WeixinWebhookAnswer;

/**
 * WeChat Official Account adapter.
 *
 * `connect()` fetches an access token from AppID and AppSecret and answers `true` or `false`,
 * never a throw. Inbound arrives by `handleWebhook(query, rawBody)`: `GET` (no body) answers the
 * server-URL check, `POST` verifies the signature, turns a text message into one event and
 * dispatches it. Replies go through the customer-service API (`message/custom/send`), which
 * WeChat allows within 48 hours of the user's last message; a refusal comes back as
 * `wechat_send_failed` with WeChat's `errcode`. The token is refreshed before it expires.
 *
 * @public
 */
export class WeChatAdapter extends WeixinAdapterBase {
  readonly platform = "wechat" as const;
  private readonly opts: WeChatAdapterOptions;
  private readonly nonces = new NonceMemory();

  /** @throws Error when `appId`, `appSecret` or `token` is empty */
  constructor(opts: WeChatAdapterOptions) {
    super({
      label: LABEL,
      className: "WeChatAdapter",
      brand: "WeChat",
      userNoun: "a WeChat OpenID",
      defaultBase: DEFAULT_BASE,
      ...(opts.apiBase === undefined ? {} : { apiBase: opts.apiBase }),
      ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
    });
    for (const key of ["appId", "appSecret", "token"] as const) {
      if (typeof opts[key] !== "string" || opts[key] === "") {
        throw new Error(`${LABEL}: opts.${key} is required`);
      }
    }
    this.opts = opts;
  }

  protected tokenPath(): string {
    const q = new URLSearchParams({
      grant_type: "client_credential",
      appid: this.opts.appId,
      secret: this.opts.appSecret,
    });
    return `/cgi-bin/token?${q.toString()}`;
  }

  protected sendRequest(token: string, userId: string, content: string): WeixinSendRequest {
    return {
      path: `/cgi-bin/message/custom/send?access_token=${encodeURIComponent(token)}`,
      payload: { touser: userId, msgtype: "text", text: { content } },
    };
  }

  protected split(text: string): string[] {
    return splitForWeChat(text);
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    return refuseAttachments(out) ?? this.sendText(out);
  }

  /**
   * Webhook entry. Pass the request's query and, for a `POST`, its RAW body; omit `rawBody` for
   * the `GET` verification. Answer `status` and `body` as given. A `503` (no handler subscribed)
   * must not be turned into a 200, or WeChat does not retry and the message is lost.
   *
   * Plain mode signs the query string, not the body. A request is refused (401) when its
   * timestamp is more than 300 seconds from this host's clock, or when its timestamp and nonce
   * were already accepted with a different body. The same request sent again is let through to
   * the message-id dedupe, so WeChat's own retries still work.
   */
  async handleWebhook(query: WeChatWebhookRequest, rawBody?: string): Promise<WeChatWebhookAnswer> {
    const now = Date.now();
    if (!verifyWeChatSignature(this.opts.token, query, now)) {
      const stale = query.timestamp !== undefined && !isWeChatTimestampFresh(query.timestamp, now);
      return { status: 401, body: "", reason: stale ? "stale timestamp" : "signature mismatch" };
    }
    if (rawBody === undefined) {
      return query.echostr === undefined
        ? { status: 400, body: "", reason: "echostr missing" }
        : { status: 200, body: query.echostr, reason: "verified" };
    }
    const { timestamp = "", nonce = "" } = query;
    if (!this.nonces.admit(timestamp, nonce, rawBody, now)) {
      return { status: 401, body: "", reason: "nonce reused" };
    }
    return this.handleMessage(rawBody);
  }

  protected toEvent(fields: Record<string, string>): GatewayMessageEvent | "skip" | undefined {
    if (fields.MsgType !== "text") return "skip";
    const { FromUserName: openId, Content: text, MsgId: msgId } = fields;
    if (!openId || text === undefined || !msgId) return undefined;
    const ts = Number(fields.CreateTime) * 1000;
    return {
      id: msgId,
      platform: "wechat",
      sender: { id: openId },
      channel: { id: openId, type: "dm" },
      text,
      receivedAt: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
      wechat: { messageId: msgId, openId, accountId: fields.ToUserName ?? "", raw: fields },
    } as GatewayMessageEvent;
  }
}
