/**
 * `WeChatAdapter` — `BasePlatformAdapter` over a WeChat (Weixin) Official Account: signed XML
 * webhook in, customer-service message API out.
 *
 * @public
 */

import {
  BasePlatformAdapter,
  channelRendering,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
} from "@theokit/gateway";

import { refuseAttachments } from "./refuse-attachments.js";
import { verifyWeChatSignature } from "./signature.js";
import { splitForWeChat } from "./split.js";
import type { WeChatAdapterOptions, WeChatFetch } from "./types.js";
import { parseWeChatXml } from "./xml.js";

const LABEL = "gateway-wechat";
const DEFAULT_BASE = "https://api.weixin.qq.com";
const REQUEST_TIMEOUT_MS = 30_000;
/** Refresh this long before the token's stated expiry. */
const TOKEN_MARGIN_MS = 60_000;

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
export type WeChatWebhookAnswer = {
  readonly status: 200 | 400 | 401 | 503;
  readonly body: string;
  readonly reason: string;
};

const defaultFetch: WeChatFetch = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { status: res.status, text: () => res.text() };
};

interface ApiBody {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
}

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
export class WeChatAdapter extends BasePlatformAdapter {
  readonly platform = "wechat" as const;
  private readonly opts: WeChatAdapterOptions;
  private readonly doFetch: WeChatFetch;
  private handler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private connected = false;
  private accessToken: { value: string; expiresAt: number } | undefined;
  private readonly seen = new Set<string>();

  /** @throws Error when `appId`, `appSecret` or `token` is empty */
  constructor(opts: WeChatAdapterOptions) {
    super();
    for (const key of ["appId", "appSecret", "token"] as const) {
      if (typeof opts[key] !== "string" || opts[key] === "") {
        throw new Error(`${LABEL}: opts.${key} is required`);
      }
    }
    this.opts = opts;
    this.doFetch = opts.fetch ?? defaultFetch;
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    try {
      await this.token(true);
      this.connected = true;
      return true;
    } catch (err) {
      process.stderr.write(`[${LABEL}] connect failed: ${messageOf(err)}\n`);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.accessToken = undefined;
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    return refuseAttachments(out) ?? this.sendText(out);
  }

  private async sendText(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "outbound text is empty" } };
    }
    if (!this.connected) {
      return {
        ok: false,
        error: { code: "not_connected", message: "WeChatAdapter.connect() has not succeeded" },
      };
    }
    if (out.channel.id === "") {
      return {
        ok: false,
        error: { code: "invalid_channel", message: "channel.id must be a WeChat OpenID" },
      };
    }
    try {
      for (const content of splitForWeChat(this.textFor(out))) {
        const token = await this.token(false);
        const body = await this.call(
          "POST",
          `/cgi-bin/message/custom/send?access_token=${encodeURIComponent(token)}`,
          { touser: out.channel.id, msgtype: "text", text: { content } },
        );
        if (body.errcode !== 0) {
          return {
            ok: false,
            error: {
              code: "wechat_send_failed",
              message: `WeChat error ${String(body.errcode)}: ${String(body.errmsg)}`,
            },
          };
        }
      }
    } catch (err) {
      return { ok: false, error: { code: "wechat_send_failed", message: messageOf(err) } };
    }
    // The customer-service API returns no message id.
    return { ok: true, messageId: "" };
  }

  onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    this.handler = handler;
    return () => {
      if (this.handler === handler) this.handler = undefined;
    };
  }

  /** Deliver an event that arrived out of band, through `runHandler`. */
  override async deliver(
    event: GatewayMessageEvent,
  ): Promise<"ok" | "no_handler" | "handler_threw"> {
    return this.runHandler(this.handler, event);
  }

  /**
   * Webhook entry. Pass the request's query and, for a `POST`, its RAW body; omit `rawBody` for
   * the `GET` verification. Answer `status` and `body` as given. A `503` (no handler subscribed)
   * must not be turned into a 200, or WeChat does not retry and the message is lost.
   */
  async handleWebhook(query: WeChatWebhookRequest, rawBody?: string): Promise<WeChatWebhookAnswer> {
    if (!verifyWeChatSignature(this.opts.token, query)) {
      return { status: 401, body: "", reason: "signature mismatch" };
    }
    if (rawBody === undefined) {
      return query.echostr === undefined
        ? { status: 400, body: "", reason: "echostr missing" }
        : { status: 200, body: query.echostr, reason: "verified" };
    }
    return this.handleMessage(rawBody);
  }

  private async handleMessage(rawBody: string): Promise<WeChatWebhookAnswer> {
    const event = toMessageEvent(parseWeChatXml(rawBody));
    if (event === "skip") return ack("not a text message");
    if (event === undefined) return { status: 400, body: "", reason: "incomplete" };
    if (this.seen.has(event.id)) return ack("duplicate");
    if (this.handler === undefined) {
      return { status: 503, body: "", reason: "no handler subscribed" };
    }
    this.remember(event.id);
    const outcome = await this.runHandler(this.handler, event);
    if (outcome === "handler_threw") process.stderr.write(`[${LABEL}] handler threw\n`);
    return ack(outcome);
  }

  private remember(id: string): void {
    this.seen.add(id);
    if (this.seen.size > 1000) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
  }

  private textFor(out: OutboundMessage): string {
    return out.format === "markdown"
      ? channelRendering(this.platform).translate(out.text)
      : out.text;
  }

  private async token(force: boolean): Promise<string> {
    const cached = this.accessToken;
    if (!force && cached !== undefined && cached.expiresAt - TOKEN_MARGIN_MS > Date.now()) {
      return cached.value;
    }
    const q = new URLSearchParams({
      grant_type: "client_credential",
      appid: this.opts.appId,
      secret: this.opts.appSecret,
    });
    const body = await this.call("GET", `/cgi-bin/token?${q.toString()}`);
    if (body.errcode !== undefined && body.errcode !== 0) {
      throw new Error(`token answered error ${String(body.errcode)}: ${String(body.errmsg)}`);
    }
    if (!body.access_token) throw new Error("token answer has no access_token");
    this.accessToken = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 7200) * 1000,
    };
    return body.access_token;
  }

  private async call(method: "GET" | "POST", path: string, payload?: unknown): Promise<ApiBody> {
    const res = await this.doFetch((this.opts.apiBase ?? DEFAULT_BASE) + path, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const text = await res.text();
    let body: ApiBody;
    try {
      body = JSON.parse(text) as ApiBody;
    } catch {
      throw new Error(`WeChat answered HTTP ${res.status} with a non-JSON body`);
    }
    return body;
  }
}

/** The event for a text message, `"skip"` for another type, `undefined` for a text with gaps. */
function toMessageEvent(fields: Record<string, string>): GatewayMessageEvent | "skip" | undefined {
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

function ack(reason: string): WeChatWebhookAnswer {
  return { status: 200, body: "success", reason };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
