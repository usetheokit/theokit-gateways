/**
 * `YuanbaoAdapter` — `BasePlatformAdapter` over a Tencent Yuanbao (元宝) bot: signed JSON webhook
 * in, bot message API out.
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
import { verifyYuanbaoSignature } from "./signature.js";
import { splitForYuanbao } from "./split.js";
import type { YuanbaoAdapterOptions, YuanbaoFetch, YuanbaoWebhookEvent } from "./types.js";

const LABEL = "gateway-yuanbao";
const DEFAULT_BASE = "https://yuanbao.tencent.com";
const REQUEST_TIMEOUT_MS = 30_000;
/** Refresh this long before the token's stated expiry. */
const TOKEN_MARGIN_MS = 60_000;

/** What a webhook route answers: 200 acknowledges, anything else makes Yuanbao redeliver. */
export type YuanbaoWebhookAnswer = {
  readonly status: 200 | 400 | 401 | 503;
  readonly reason: string;
};

interface ApiBody {
  code?: number;
  msg?: string;
  data?: { access_token?: string; expires_in?: number; message_id?: string };
}

const defaultFetch: YuanbaoFetch = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { status: res.status, text: () => res.text() };
};

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Tencent Yuanbao bot adapter.
 *
 * `connect()` exchanges the app id and secret for an access token and answers `true` or `false`,
 * never a throw. Inbound arrives by `handleWebhook(rawBody, signature, timestamp)`, which verifies
 * the signature, turns a text message into one direct-message event and dispatches it. Replies go
 * through the bot message API, split at 2000 characters; a refusal comes back as
 * `yuanbao_send_failed` with Yuanbao's `code`. The token is refreshed before it expires.
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

  /** @throws Error when `appId`, `appSecret` or `callbackSecret` is empty */
  constructor(opts: YuanbaoAdapterOptions) {
    super();
    for (const key of ["appId", "appSecret", "callbackSecret"] as const) {
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
        error: { code: "invalid_channel", message: "channel.id must be a Yuanbao user id" },
      };
    }
    let messageId = "";
    try {
      for (const text of splitForYuanbao(this.textFor(out))) {
        const token = await this.token(false);
        const body = await this.call("POST", "/open-apis/message/send", token, {
          receive_id: out.channel.id,
          msg_type: "text",
          content: { text },
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
        messageId = body.data?.message_id ?? messageId;
      }
    } catch (err) {
      return { ok: false, error: { code: "yuanbao_send_failed", message: messageOf(err) } };
    }
    return { ok: true, messageId };
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
   * Webhook entry: verify, parse and dispatch. Pass the RAW body and the signature and timestamp
   * headers. Answer `status` 200 only when the event was handled or is not for this adapter;
   * `503` (no handler subscribed) must not be acknowledged, or Yuanbao does not redeliver and the
   * message is lost.
   */
  async handleWebhook(
    rawBody: string,
    signature: string | undefined,
    timestamp: string | undefined,
  ): Promise<YuanbaoWebhookAnswer> {
    if (!verifyYuanbaoSignature(this.opts.callbackSecret, rawBody, signature, timestamp)) {
      return { status: 401, reason: "signature mismatch" };
    }
    let payload: YuanbaoWebhookEvent;
    try {
      payload = JSON.parse(rawBody) as YuanbaoWebhookEvent;
    } catch {
      return { status: 400, reason: "body is not JSON" };
    }
    const event = toMessageEvent(payload);
    if (event === undefined) return { status: 200, reason: "not a text message" };
    if (this.seen.has(event.id)) return { status: 200, reason: "duplicate" };
    if (this.handler === undefined) return { status: 503, reason: "no handler subscribed" };
    this.remember(event.id);
    const outcome = await this.runHandler(this.handler, event);
    if (outcome === "handler_threw") process.stderr.write(`[${LABEL}] handler threw\n`);
    return { status: 200, reason: outcome };
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
    const body = await this.call("POST", "/open-apis/auth/token", undefined, {
      app_id: this.opts.appId,
      app_secret: this.opts.appSecret,
    });
    if (body.code !== undefined && body.code !== 0) {
      throw new Error(`token answered error ${String(body.code)}: ${String(body.msg)}`);
    }
    const value = body.data?.access_token;
    if (!value) throw new Error("token answer has no access_token");
    this.accessToken = { value, expiresAt: Date.now() + (body.data?.expires_in ?? 7200) * 1000 };
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
        ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
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

function toMessageEvent(payload: YuanbaoWebhookEvent): GatewayMessageEvent | undefined {
  const m = payload.message;
  if (payload.type !== "message" || m === undefined) return undefined;
  const userId = m.from?.id;
  if (!userId || !m.id || typeof m.text !== "string") return undefined;
  const ts = (m.create_time ?? 0) * 1000;
  return {
    id: m.id,
    platform: "yuanbao",
    sender: { id: userId },
    channel: { id: userId, type: "dm" },
    text: m.text,
    receivedAt: ts > 0 ? ts : Date.now(),
    yuanbao: { messageId: m.id, userId, raw: payload },
  } as GatewayMessageEvent;
}
