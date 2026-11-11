/**
 * `YuanbaoAdapter` — `BasePlatformAdapter` over a Tencent Yuanbao bot: signed JSON webhook in,
 * bot message API out.
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
import { computeYuanbaoSignature, verifyYuanbaoSignature } from "./signature.js";
import { splitForYuanbao } from "./split.js";
import type { YuanbaoAdapterOptions, YuanbaoFetch } from "./types.js";

const LABEL = "gateway-yuanbao";
const DEFAULT_BASE = "https://bot.yuanbao.tencent.com";
const REQUEST_TIMEOUT_MS = 30_000;
/** Refresh this long before the token's stated expiry. */
const TOKEN_MARGIN_MS = 60_000;

/** The signature fields of a webhook request. */
export interface YuanbaoWebhookRequest {
  readonly signature?: string;
  readonly timestamp?: string;
  readonly nonce?: string;
}

/** What a webhook route answers. Anything but 200 makes Yuanbao retry. */
export type YuanbaoWebhookAnswer = {
  readonly status: 200 | 400 | 401 | 503;
  readonly body: string;
  readonly reason: string;
};

const defaultFetch: YuanbaoFetch = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { status: res.status, text: () => res.text() };
};

interface ApiBody {
  code?: number;
  msg?: string;
  data?: { token?: string; duration?: number };
}

interface InboundBody {
  msg_id?: string;
  msg_type?: string;
  from_account?: string;
  content?: string;
  create_time?: number;
}

/**
 * Yuanbao bot adapter.
 *
 * `connect()` signs a token request with the app key and secret and answers `true` or `false`,
 * never a throw. Inbound arrives by `handleWebhook(request, rawBody)`: it verifies the HMAC
 * signature, turns a text message into one event and dispatches it. Replies go through the bot
 * message API; a refusal comes back as `yuanbao_send_failed` with the platform's code. The wire
 * shapes are an assumption (see the README): no live run has confirmed them.
 *
 * @public
 */
export class YuanbaoAdapter extends BasePlatformAdapter {
  readonly platform = "yuanbao" as const;
  private readonly opts: YuanbaoAdapterOptions;
  private readonly doFetch: YuanbaoFetch;
  private handler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private connected = false;
  private accessToken: { value: string; expiresAt: number } | undefined;
  private readonly seen = new Set<string>();

  /** @throws Error when `appKey` or `appSecret` is empty */
  constructor(opts: YuanbaoAdapterOptions) {
    super();
    for (const key of ["appKey", "appSecret"] as const) {
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
        error: { code: "not_connected", message: "YuanbaoAdapter.connect() has not succeeded" },
      };
    }
    if (out.channel.id === "") {
      return {
        ok: false,
        error: { code: "invalid_channel", message: "channel.id must be a Yuanbao account id" },
      };
    }
    try {
      for (const content of splitForYuanbao(this.textFor(out))) {
        const body = await this.call("POST", "/api/v1/bot/message/send", await this.token(false), {
          to_account: out.channel.id,
          msg_type: "text",
          content,
        });
        if (body.code !== 0) {
          return {
            ok: false,
            error: {
              code: "yuanbao_send_failed",
              message: `Yuanbao error ${String(body.code)}: ${String(body.msg)}`,
            },
          };
        }
      }
    } catch (err) {
      return { ok: false, error: { code: "yuanbao_send_failed", message: messageOf(err) } };
    }
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
   * Webhook entry. Pass the request's signature fields and its RAW body. A `503` (no handler
   * subscribed) must not be turned into a 200, or the message is lost.
   */
  async handleWebhook(
    request: YuanbaoWebhookRequest,
    rawBody: string,
  ): Promise<YuanbaoWebhookAnswer> {
    if (!verifyYuanbaoSignature(this.opts.appSecret, request, rawBody)) {
      return { status: 401, body: "", reason: "signature mismatch" };
    }
    let parsed: InboundBody;
    try {
      parsed = JSON.parse(rawBody) as InboundBody;
    } catch {
      return { status: 400, body: "", reason: "body is not JSON" };
    }
    const event = toMessageEvent(parsed);
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
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = Math.random().toString(36).slice(2, 12);
    const body = await this.call("POST", "/api/v5/robotLogic/sign-token", undefined, {
      app_key: this.opts.appKey,
      nonce,
      timestamp,
      signature: computeYuanbaoSignature(this.opts.appSecret, timestamp, nonce, this.opts.appKey),
    });
    if (body.code !== 0) {
      throw new Error(`token answered error ${String(body.code)}: ${String(body.msg)}`);
    }
    const value = body.data?.token;
    if (!value) throw new Error("token answer has no token");
    this.accessToken = { value, expiresAt: Date.now() + (body.data?.duration ?? 7200) * 1000 };
    return value;
  }

  private async call(
    method: "POST",
    path: string,
    token: string | undefined,
    payload: unknown,
  ): Promise<ApiBody> {
    const res = await this.doFetch((this.opts.apiBase ?? DEFAULT_BASE) + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token === undefined ? {} : { "X-Token": token }),
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as ApiBody;
    } catch {
      throw new Error(`Yuanbao answered HTTP ${res.status} with a non-JSON body`);
    }
  }
}

/** The event for a text message, `"skip"` for another type, `undefined` for a text with gaps. */
function toMessageEvent(body: InboundBody): GatewayMessageEvent | "skip" | undefined {
  if (body.msg_type !== "text") return "skip";
  const { from_account: accountId, content: text, msg_id: msgId } = body;
  if (!accountId || typeof text !== "string" || !msgId) return undefined;
  const ts = Number(body.create_time) * 1000;
  return {
    id: msgId,
    platform: "yuanbao",
    sender: { id: accountId },
    channel: { id: accountId, type: "dm" },
    text,
    receivedAt: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
    yuanbao: { messageId: msgId, accountId, raw: body },
  } as GatewayMessageEvent;
}

function ack(reason: string): YuanbaoWebhookAnswer {
  return { status: 200, body: "success", reason };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
