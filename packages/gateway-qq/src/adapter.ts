/**
 * `QQAdapter` — `BasePlatformAdapter` over a QQ Bot (the Tencent QQ open platform): signed webhook
 * in, bot message API out. Direct messages (C2C) only.
 *
 * @public
 */

import {
  BasePlatformAdapter,
  chunkByGrapheme,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  SeenIds,
  type SendResult,
} from "@theokit/gateway";

import { refuseAttachments } from "./refuse-attachments.js";
import { signQQ, verifyQQSignature } from "./signature.js";
import type { QQAdapterOptions, QQFetch, QQWebhookPayload } from "./types.js";

/** The most characters one message carries here. */
export const QQ_MESSAGE_LIMIT = 2000;
const LABEL = "gateway-qq";
const DEFAULT_API = "https://api.sgroup.qq.com";
const DEFAULT_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const REQUEST_TIMEOUT_MS = 30_000;
/** Refresh this long before the token's stated expiry. */
const TOKEN_MARGIN_MS = 60_000;
/** How many users' last inbound message ids are kept for passive replies. */
const REPLY_WINDOW_MAX = 1000;

/** What a webhook route answers: 200 acknowledges, anything else makes QQ redeliver. */
export type QQWebhookAnswer = {
  readonly status: 200 | 400 | 401 | 503;
  readonly reason: string;
  /** The JSON body to send back; set for the callback URL validation. */
  readonly body?: { readonly plain_token: string; readonly signature: string };
};

interface ApiBody {
  code?: number;
  message?: string;
  id?: string;
  access_token?: string;
  expires_in?: number | string;
}

const defaultFetch: QQFetch = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { status: res.status, text: () => res.text() };
};

/** Split `text` into messages of at most 2000 characters, never inside a grapheme. @public */
export function splitForQQ(text: string): string[] {
  return chunkByGrapheme(text, { limit: QQ_MESSAGE_LIMIT }).filter((part) => part !== "");
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * QQ Bot adapter.
 *
 * `connect()` exchanges the AppID and AppSecret for an access token and answers `true` or `false`,
 * never a throw. Inbound arrives by `handleWebhook(rawBody, signature, timestamp)`, which verifies
 * the Ed25519 signature, answers the callback URL validation, turns a C2C text message into one
 * direct-message event and dispatches it. Replies go through the C2C message API, split at 2000
 * characters, as passive replies to the user's last message (`msg_id`, `msg_seq`) when one is
 * known; a refusal comes back as `qq_send_failed` with QQ's `code`.
 *
 * @public
 */
export class QQAdapter extends BasePlatformAdapter {
  readonly platform = "qq" as const;
  private readonly opts: QQAdapterOptions;
  private readonly doFetch: QQFetch;
  private connected = false;
  private accessToken: { value: string; expiresAt: number } | undefined;
  private readonly seen = new SeenIds();
  private readonly replyWindow = new Map<string, { msgId: string; seq: number }>();

  /** @throws Error when `appId` or `appSecret` is empty */
  constructor(opts: QQAdapterOptions) {
    super();
    for (const key of ["appId", "appSecret"] as const) {
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
    this.replyWindow.clear();
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    return refuseAttachments(out) ?? this.sendText(out);
  }

  private async sendText(out: OutboundMessage): Promise<SendResult> {
    const refused = this.refuseUnsendable(out, {
      className: "QQAdapter",
      connected: this.connected,
      channel: { valid: (id) => id !== "", message: "channel.id must be a QQ user openid" },
    });
    if (refused !== undefined) return refused;
    let messageId = "";
    try {
      for (const text of splitForQQ(this.outboundText(out))) {
        const token = await this.token(false);
        const body = await this.call(
          "POST",
          `${this.opts.apiBase ?? DEFAULT_API}/v2/users/${encodeURIComponent(out.channel.id)}/messages`,
          token,
          { content: text, msg_type: 0, ...this.nextReplyRef(out.channel.id) },
        );
        if (body.code !== undefined) {
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
    } catch (err) {
      return { ok: false, error: { code: "qq_send_failed", message: messageOf(err) } };
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

  /**
   * Webhook entry: verify, parse and dispatch. Pass the RAW body and the `X-Signature-Ed25519`
   * and `X-Signature-Timestamp` headers. Answer `status` 200 only when the event was handled or
   * is not for this adapter, with `body` as the JSON when it is set; `503` (no handler
   * subscribed) must not be acknowledged, or QQ does not redeliver and the message is lost.
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
    // The URL validation (op 13) is signed by us, not by QQ: QQ checks our answer.
    if (payload.op === 13) return this.validation(payload);
    if (!verifyQQSignature(this.opts.appSecret, rawBody, signature, timestamp)) {
      return { status: 401, reason: "signature mismatch" };
    }
    const event = toMessageEvent(payload);
    if (event === undefined) return { status: 200, reason: "not a direct text message" };
    // Before dispatch: the handler's reply is the one that answers this message.
    this.rememberReplyRef(event.channel.id, event.id);
    const outcome = await this.dispatchOnce(this.seen, event, LABEL);
    if (outcome === "no_handler") return { status: 503, reason: "no handler subscribed" };
    return { status: 200, reason: outcome };
  }

  private validation(payload: QQWebhookPayload): QQWebhookAnswer {
    const plain = payload.d?.plain_token;
    const ts = payload.d?.event_ts;
    if (!plain || !ts) return { status: 400, reason: "validation has no plain_token or event_ts" };
    return {
      status: 200,
      reason: "validation",
      body: { plain_token: plain, signature: signQQ(this.opts.appSecret, ts + plain) },
    };
  }

  private rememberReplyRef(openid: string, msgId: string): void {
    if (this.replyWindow.get(openid)?.msgId === msgId) return;
    this.replyWindow.delete(openid);
    this.replyWindow.set(openid, { msgId, seq: 0 });
    if (this.replyWindow.size > REPLY_WINDOW_MAX) {
      const oldest = this.replyWindow.keys().next().value;
      if (oldest !== undefined) this.replyWindow.delete(oldest);
    }
  }

  private nextReplyRef(openid: string): { msg_id?: string; msg_seq?: number } {
    const ref = this.replyWindow.get(openid);
    if (ref === undefined) return {};
    ref.seq += 1;
    return { msg_id: ref.msgId, msg_seq: ref.seq };
  }

  private async token(force: boolean): Promise<string> {
    const cached = this.accessToken;
    if (!force && cached !== undefined && cached.expiresAt - TOKEN_MARGIN_MS > Date.now()) {
      return cached.value;
    }
    const body = await this.call("POST", this.opts.tokenUrl ?? DEFAULT_TOKEN_URL, undefined, {
      appId: this.opts.appId,
      clientSecret: this.opts.appSecret,
    });
    if (body.code !== undefined) {
      throw new Error(`token answered error ${String(body.code)}: ${String(body.message)}`);
    }
    const value = body.access_token;
    if (!value) throw new Error("token answer has no access_token");
    const ttl = Number(body.expires_in);
    this.accessToken = {
      value,
      expiresAt: Date.now() + (Number.isFinite(ttl) && ttl > 0 ? ttl : 7200) * 1000,
    };
    return value;
  }

  private async call(
    method: "POST",
    url: string,
    token: string | undefined,
    payload: unknown,
  ): Promise<ApiBody> {
    const res = await this.doFetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token === undefined
          ? {}
          : { Authorization: `QQBot ${token}`, "X-Union-Appid": this.opts.appId }),
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
  const userOpenId = d.author?.user_openid;
  if (!userOpenId || !d.id || typeof d.content !== "string") return undefined;
  const ts = Date.parse(d.timestamp ?? "");
  return {
    id: d.id,
    platform: "qq",
    sender: { id: userOpenId },
    channel: { id: userOpenId, type: "dm" },
    text: d.content.trim(),
    receivedAt: Number.isFinite(ts) ? ts : Date.now(),
    qq: { messageId: d.id, userOpenId, raw: payload },
  } as GatewayMessageEvent;
}
