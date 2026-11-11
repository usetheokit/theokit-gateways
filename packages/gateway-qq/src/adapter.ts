/**
 * `QQAdapter` — `BasePlatformAdapter` over a QQ Bot (Tencent QQ official bot): signed webhook
 * in, C2C message API out.
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
import { signQQ, verifyQQSignature } from "./signature.js";
import { splitForQQ } from "./split.js";
import type { QQAdapterOptions, QQFetch, QQWebhookPayload } from "./types.js";

const LABEL = "gateway-qq";
const DEFAULT_BASE = "https://api.sgroup.qq.com";
const DEFAULT_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const REQUEST_TIMEOUT_MS = 30_000;
/** Refresh this long before the token's stated expiry. */
const TOKEN_MARGIN_MS = 60_000;

/**
 * What a webhook route answers: 200 acknowledges, anything else makes QQ redeliver. `body` is set
 * for the endpoint validation request and must be sent back as the JSON response body.
 */
export type QQWebhookAnswer = {
  readonly status: 200 | 400 | 401 | 503;
  readonly reason: string;
  readonly body?: { readonly plain_token: string; readonly signature: string };
};

interface ApiBody {
  access_token?: string;
  expires_in?: number | string;
  /** Set on an error answer. */
  code?: number;
  message?: string;
  /** Set on a sent message. */
  id?: string;
}

const defaultFetch: QQFetch = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { status: res.status, text: () => res.text() };
};

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * QQ Bot adapter.
 *
 * `connect()` exchanges the app id and secret for an access token and answers `true` or `false`,
 * never a throw. Inbound arrives by `handleWebhook(rawBody, signature, timestamp)`, which answers the
 * endpoint validation request, verifies the Ed25519 signature, turns a text message into one direct-message event and dispatches it. Replies go
 * through the bot message API, split at 2000 characters; a refusal comes back as
 * `qq_send_failed` with QQ's `code`. The token is refreshed before it expires.
 *
 * @public
 */
export class QQAdapter extends BasePlatformAdapter {
  readonly platform = "qq" as const;
  private readonly opts: QQAdapterOptions;
  private readonly doFetch: QQFetch;
  private handler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private connected = false;
  private accessToken: { value: string; expiresAt: number } | undefined;
  private readonly seen = new Set<string>();

  /** @throws Error when `appId` or `clientSecret` is empty */
  constructor(opts: QQAdapterOptions) {
    super();
    for (const key of ["appId", "clientSecret"] as const) {
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
        error: { code: "not_connected", message: "QQAdapter.connect() has not succeeded" },
      };
    }
    if (out.channel.id === "") {
      return {
        ok: false,
        error: { code: "invalid_channel", message: "channel.id must be a QQ user_openid" },
      };
    }
    try {
      return await this.sendParts(out);
    } catch (err) {
      return { ok: false, error: { code: "qq_send_failed", message: messageOf(err) } };
    }
  }

  private async sendParts(out: OutboundMessage): Promise<SendResult> {
    let messageId = "";
    let seq = 0;
    for (const text of splitForQQ(this.textFor(out))) {
      const token = await this.token(false);
      const body = await this.call(
        "POST",
        `${this.opts.apiBase ?? DEFAULT_BASE}/v2/users/${encodeURIComponent(out.channel.id)}/messages`,
        `QQBot ${token}`,
        {
          content: text,
          msg_type: 0,
          // A reply to a message names it (`msg_id`); each part of one reply needs its own `msg_seq`.
          ...(out.replyTo ? { msg_id: out.replyTo, msg_seq: ++seq } : {}),
        },
      );
      if (body.code !== undefined && body.code !== 0) {
        return {
          ok: false,
          error: {
            code: "qq_send_failed",
            message: `QQ error ${String(body.code)}: ${String(body.message)}`,
          },
        };
      }
      messageId = body.id ?? messageId;
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
   * `503` (no handler subscribed) must not be acknowledged, or QQ does not redeliver and the
   * message is lost.
   */
  async handleWebhook(
    rawBody: string,
    signature: string | undefined,
    timestamp: string | undefined,
  ): Promise<QQWebhookAnswer> {
    let payload: QQWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as QQWebhookPayload;
    } catch {
      return { status: 400, reason: "body is not JSON" };
    }
    if (payload.op === 13) return this.validation(payload);
    if (!verifyQQSignature(this.opts.clientSecret, rawBody, signature, timestamp)) {
      return { status: 401, reason: "signature mismatch" };
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

  /**
   * Endpoint validation (`op` 13): QQ sends a token and expects it back with a signature of
   * `event_ts + plain_token`. It carries no signature of its own, so it proves only that this
   * endpoint holds the secret.
   */
  private validation(payload: QQWebhookPayload): QQWebhookAnswer {
    const plain = payload.d?.plain_token;
    const ts = payload.d?.event_ts;
    if (!plain || !ts) return { status: 400, reason: "validation without a token" };
    return {
      status: 200,
      reason: "validation",
      body: { plain_token: plain, signature: signQQ(this.opts.clientSecret, ts + plain) },
    };
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
    const body = await this.call("POST", this.opts.tokenUrl ?? DEFAULT_TOKEN_URL, undefined, {
      appId: this.opts.appId,
      clientSecret: this.opts.clientSecret,
    });
    if (body.code !== undefined && body.code !== 0) {
      throw new Error(`token answered error ${String(body.code)}: ${String(body.message)}`);
    }
    const value = body.access_token;
    if (!value) throw new Error("token answer has no access_token");
    // `expires_in` is a string of seconds on the wire.
    const seconds = Number(body.expires_in ?? 7200);
    this.accessToken = { value, expiresAt: Date.now() + (seconds > 0 ? seconds : 7200) * 1000 };
    return value;
  }

  private async call(
    method: "POST",
    url: string,
    authorization: string | undefined,
    payload: unknown,
  ): Promise<ApiBody> {
    const res = await this.doFetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(authorization === undefined ? {} : { Authorization: authorization }),
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as ApiBody;
    } catch {
      throw new Error(`QQ answered HTTP ${res.status} with a non-JSON body`);
    }
  }
}

function toMessageEvent(payload: QQWebhookPayload): GatewayMessageEvent | undefined {
  const d = payload.d;
  if (payload.op !== 0 || payload.t !== "C2C_MESSAGE_CREATE" || d === undefined) return undefined;
  const userOpenid = d.author?.user_openid;
  if (!userOpenid || !d.id || typeof d.content !== "string") return undefined;
  const ts = Date.parse(d.timestamp ?? "");
  return {
    id: d.id,
    platform: "qq",
    sender: { id: userOpenid },
    channel: { id: userOpenid, type: "dm" },
    text: d.content.trim(),
    receivedAt: Number.isNaN(ts) ? Date.now() : ts,
    qq: { messageId: d.id, userOpenid, raw: payload },
  } as GatewayMessageEvent;
}
