/**
 * `ZaloAdapter` — `BasePlatformAdapter` over a Zalo Official Account: webhook in, OA Open API out.
 *
 * @public
 */

import {
  BasePlatformAdapter,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  SeenIds,
  type SendResult,
} from "@theokit/gateway";

import { refuseAttachments } from "./refuse-attachments.js";
import { verifyZaloSignature } from "./signature.js";
import { splitForZalo } from "./split.js";
import type { ZaloAdapterOptions, ZaloFetch, ZaloWebhookEvent } from "./types.js";

const LABEL = "gateway-zalo";
const DEFAULT_BASE = "https://openapi.zalo.me";
const REQUEST_TIMEOUT_MS = 30_000;

/** What a webhook route answers: 200 acknowledges, anything else makes Zalo redeliver. */
export type ZaloWebhookAnswer = { readonly status: 200 | 401 | 400 | 503; readonly reason: string };

const defaultFetch: ZaloFetch = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { status: res.status, text: () => res.text() };
};

/**
 * Zalo Official Account adapter.
 *
 * `connect()` checks the access token with `getoa` and answers `true` or `false`, never a throw.
 * Inbound arrives by `handleWebhook(rawBody, signatureHeader)`, which verifies the signature,
 * turns a `user_send_text` event into one event and dispatches it. A reply over 2000 characters
 * goes as several messages. A Zalo OA may message a user only within Zalo's customer-service
 * window; a refusal comes back as `zalo_send_failed` with Zalo's error code.
 *
 * @public
 */
export class ZaloAdapter extends BasePlatformAdapter {
  readonly platform = "zalo" as const;
  private readonly opts: ZaloAdapterOptions;
  private readonly doFetch: ZaloFetch;
  private connected = false;
  private readonly seen = new SeenIds();

  /** @throws Error when `appId`, `oaSecretKey` or `accessToken` is empty */
  constructor(opts: ZaloAdapterOptions) {
    super();
    for (const key of ["appId", "oaSecretKey", "accessToken"] as const) {
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
      const body = await this.call("GET", "/v2.0/oa/getoa");
      if (body.error !== 0 && body.error !== undefined) {
        throw new Error(`getoa answered error ${String(body.error)}: ${String(body.message)}`);
      }
      this.connected = true;
      return true;
    } catch (err) {
      process.stderr.write(`[${LABEL}] connect failed: ${messageOf(err)}\n`);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    return refuseAttachments(out) ?? this.sendText(out);
  }

  private async sendText(out: OutboundMessage): Promise<SendResult> {
    const refused = this.refuseUnsendable(out, {
      className: "ZaloAdapter",
      connected: this.connected,
      channel: { valid: (id) => id !== "", message: "channel.id must be a Zalo user id" },
    });
    if (refused !== undefined) return refused;
    let messageId = "";
    try {
      for (const text of splitForZalo(this.outboundText(out))) {
        const body = await this.call("POST", "/v3.0/oa/message/cs", {
          recipient: { user_id: out.channel.id },
          message: { text },
        });
        if (body.error !== 0) {
          return {
            ok: false,
            error: {
              code: "zalo_send_failed",
              message: `Zalo error ${String(body.error)}: ${String(body.message)}`,
            },
          };
        }
        messageId = body.data?.message_id ?? messageId;
      }
    } catch (err) {
      return { ok: false, error: { code: "zalo_send_failed", message: messageOf(err) } };
    }
    return { ok: true, messageId };
  }

  onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    return this.subscribe(handler);
  }

  /** Deliver an event that arrived out of band, through `runHandler`. */
  override async deliver(
    event: GatewayMessageEvent,
  ): Promise<"ok" | "no_handler" | "handler_threw"> {
    return this.deliverInbound(event);
  }

  /** The values a webhook route needs to verify a request itself. */
  getWebhookSecrets(): { appId: string; oaSecretKey: string } {
    return { appId: this.opts.appId, oaSecretKey: this.opts.oaSecretKey };
  }

  /**
   * Webhook entry: verify, parse and dispatch. Answer `status` 200 only when the event was
   * handled or is not for this adapter; `503` (no handler subscribed) must not be acknowledged,
   * or Zalo does not redeliver and the message is lost.
   */
  async handleWebhook(rawBody: string, signature: string | undefined): Promise<ZaloWebhookAnswer> {
    if (!verifyZaloSignature(this.opts, rawBody, signature)) {
      return { status: 401, reason: "signature mismatch" };
    }
    let payload: ZaloWebhookEvent;
    try {
      payload = JSON.parse(rawBody) as ZaloWebhookEvent;
    } catch {
      return { status: 400, reason: "body is not JSON" };
    }
    const skipped = this.skipReason(payload);
    if (skipped !== undefined) return { status: 200, reason: skipped };
    const event = toMessageEvent(payload) as GatewayMessageEvent;
    const outcome = await this.dispatchOnce(this.seen, event, LABEL);
    if (outcome === "no_handler") return { status: 503, reason: "no handler subscribed" };
    return { status: 200, reason: outcome };
  }

  /** Why a verified event is acknowledged without dispatch, or `undefined` to dispatch it. */
  private skipReason(payload: ZaloWebhookEvent): string | undefined {
    if (payload.app_id !== undefined && payload.app_id !== this.opts.appId) {
      return "event is for another app";
    }
    return toMessageEvent(payload) === undefined ? "not a text message" : undefined;
  }

  private async call(method: "GET" | "POST", path: string, payload?: unknown) {
    const res = await this.doFetch((this.opts.apiBase ?? DEFAULT_BASE) + path, {
      method,
      headers: { access_token: this.opts.accessToken, "Content-Type": "application/json" },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const text = await res.text();
    let body: { error?: number; message?: string; data?: { message_id?: string } };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new Error(`Zalo answered HTTP ${res.status} with a non-JSON body`);
    }
    if (body.error === undefined) {
      throw new Error(`Zalo answered HTTP ${res.status} without an error field`);
    }
    return body as { error: number; message?: string; data?: { message_id?: string } };
  }
}

function toMessageEvent(payload: ZaloWebhookEvent): GatewayMessageEvent | undefined {
  if (payload.event_name !== "user_send_text") return undefined;
  const userId = payload.sender?.id;
  const text = payload.message?.text;
  const msgId = payload.message?.msg_id;
  if (!userId || typeof text !== "string" || !msgId) return undefined;
  const ts = Number(payload.timestamp);
  return {
    id: msgId,
    platform: "zalo",
    sender: { id: userId },
    channel: { id: userId, type: "dm" },
    text,
    receivedAt: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
    zalo: { messageId: msgId, userId, oaId: payload.recipient?.id ?? "", raw: payload },
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
