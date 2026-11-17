/**
 * `WeComAdapter` — `BasePlatformAdapter` over a WeCom (企业微信) self-built application: encrypted
 * XML callback in, application message API out.
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

import { decryptWeCom, verifyWeComSignature } from "./crypto.js";
import { refuseAttachments } from "./refuse-attachments.js";
import { splitForWeCom } from "./split.js";
import type { WeComAdapterOptions } from "./types.js";
import { parseWeComXml } from "./xml.js";

const LABEL = "gateway-wecom";
const DEFAULT_BASE = "https://qyapi.weixin.qq.com";

/** The query string of a callback request, plus `echostr` (encrypted) on the verification GET. */
export interface WeComWebhookRequest {
  readonly msg_signature?: string;
  readonly timestamp?: string;
  readonly nonce?: string;
  readonly echostr?: string;
}

/**
 * What a webhook route answers. `body` is the text to write back: the `echostr` on a
 * verification, `success` on an acknowledged message. Anything but 200 makes WeCom retry.
 */
export type WeComWebhookAnswer = WeixinWebhookAnswer;

/**
 * WeCom self-built application adapter.
 *
 * `connect()` fetches an access token from CorpID and Secret and answers `true` or `false`,
 * never a throw. Inbound arrives by `handleWebhook(query, rawBody)`: `GET` (no body) answers the
 * callback URL check by decrypting `echostr`; `POST` verifies the signature, decrypts the
 * envelope, turns a text message into one event and dispatches it. Replies go through
 * `message/send` as the application; a refusal comes back as `wecom_send_failed` with WeCom's
 * `errcode`. The token is refreshed before it expires.
 *
 * @public
 */
export class WeComAdapter extends WeixinAdapterBase {
  readonly platform = "wecom" as const;
  private readonly opts: WeComAdapterOptions;

  /** @throws Error when a credential is empty */
  constructor(opts: WeComAdapterOptions) {
    super({
      label: LABEL,
      className: "WeComAdapter",
      brand: "WeCom",
      userNoun: "a WeCom user id",
      defaultBase: DEFAULT_BASE,
      ...(opts.apiBase === undefined ? {} : { apiBase: opts.apiBase }),
      ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
    });
    for (const key of ["corpId", "corpSecret", "token", "encodingAesKey"] as const) {
      if (typeof opts[key] !== "string" || opts[key] === "") {
        throw new Error(`${LABEL}: opts.${key} is required`);
      }
    }
    if (opts.agentId === undefined || opts.agentId === "" || Number.isNaN(Number(opts.agentId))) {
      throw new Error(`${LABEL}: opts.agentId is required`);
    }
    this.opts = opts;
  }

  protected tokenPath(): string {
    const q = new URLSearchParams({
      corpid: this.opts.corpId,
      corpsecret: this.opts.corpSecret,
    });
    return `/cgi-bin/gettoken?${q.toString()}`;
  }

  protected sendRequest(token: string, userId: string, content: string): WeixinSendRequest {
    return {
      path: `/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`,
      payload: {
        touser: userId,
        msgtype: "text",
        agentid: Number(this.opts.agentId),
        text: { content },
      },
    };
  }

  protected split(text: string): string[] {
    return splitForWeCom(text);
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    return refuseAttachments(out) ?? this.sendText(out);
  }

  /**
   * Callback entry. Pass the request's query and, for a `POST`, its RAW body; omit `rawBody` for
   * the `GET` verification. Answer `status` and `body` as given. A `503` (no handler subscribed)
   * must not be turned into a 200, or WeCom does not retry and the message is lost.
   */
  async handleWebhook(query: WeComWebhookRequest, rawBody?: string): Promise<WeComWebhookAnswer> {
    const encrypted = rawBody === undefined ? query.echostr : parseWeComXml(rawBody).Encrypt;
    if (encrypted === undefined || encrypted === "") {
      return { status: 400, body: "", reason: "encrypted payload missing" };
    }
    if (!verifyWeComSignature(this.opts.token, query, encrypted)) {
      return { status: 401, body: "", reason: "signature mismatch" };
    }
    let plain: string;
    try {
      plain = decryptWeCom(this.opts.encodingAesKey, encrypted, this.opts.corpId);
    } catch {
      return { status: 400, body: "", reason: "cannot decrypt" };
    }
    return rawBody === undefined
      ? { status: 200, body: plain, reason: "verified" }
      : this.handleMessage(plain);
  }

  protected toEvent(fields: Record<string, string>): GatewayMessageEvent | "skip" | undefined {
    if (fields.MsgType !== "text") return "skip";
    const { FromUserName: userId, Content: text, MsgId: msgId } = fields;
    if (!userId || text === undefined || !msgId) return undefined;
    const ts = Number(fields.CreateTime) * 1000;
    return {
      id: msgId,
      platform: "wecom",
      sender: { id: userId },
      channel: { id: userId, type: "dm" },
      text,
      receivedAt: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
      wecom: { messageId: msgId, userId, corpId: fields.ToUserName ?? "", raw: fields },
    } as GatewayMessageEvent;
  }
}
