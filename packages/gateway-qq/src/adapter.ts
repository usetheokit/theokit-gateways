/**
 * `QQAdapter` — `BasePlatformAdapter` over a QQ Bot (the Tencent QQ open platform): signed webhook
 * in, bot message API out. Direct messages (C2C) only.
 *
 * @public
 */

import {
  type AdapterCapabilities,
  BasePlatformAdapter,
  chunkByGrapheme,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  SeenIds,
  type SendResult,
  sendErrorFromHttp,
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
/** What a callback URL validation `plain_token` may contain (QQ sends short alphanumeric tokens). */
const PLAIN_TOKEN_SHAPE = /^[A-Za-z0-9+/=_-]{1,128}$/;
/** A callback URL validation `event_ts`: Unix seconds as a decimal string. */
const EVENT_TS_SHAPE = /^[0-9]{1,20}$/;

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

async function defaultFetch(...[url, init]: Parameters<QQFetch>): ReturnType<QQFetch> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const res = await fetch(url, { ...init, signal: timeout });
  return { status: res.status, text: () => res.text(), headers: res.headers };
}

/** Split `text` into messages of at most 2000 characters, never inside a grapheme. @public */
export function splitForQQ(text: string): string[] {
  return chunkByGrapheme(text, { limit: QQ_MESSAGE_LIMIT }).filter((part) => part !== "");
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A non-2xx HTTP answer, with what a caller needs to retry. */
class HttpFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfter: string | undefined,
    readonly platformCode: string | undefined,
  ) {
    super(message);
  }
}

/** The fetch itself rejected, so no answer came. */
class NetworkFailure extends Error {}

/** Run the fetch and read the body; a rejection of either becomes a `NetworkFailure`. */
async function fetchText(
  doFetch: QQFetch,
  url: string,
  init: Parameters<QQFetch>[1],
): Promise<{ status: number; retryAfter: string | undefined; text: string }> {
  try {
    const res = await doFetch(url, init);
    const retryAfter = res.headers?.get("retry-after") ?? undefined;
    return { status: res.status, retryAfter, text: await res.text() };
  } catch (err) {
    throw new NetworkFailure(messageOf(err));
  }
}

/** Throw an `HttpFailure` for a non-2xx answer, keeping the body's platform code when it has one. */
function assertHttpOk(
  who: string,
  res: { status: number; retryAfter: string | undefined },
  text: string,
  codeOf: (body: { code?: unknown; error?: unknown } | null) => unknown,
): void {
  if (res.status >= 200 && res.status < 300) return;
  let code: unknown;
  try {
    code = codeOf(JSON.parse(text));
  } catch {
    code = undefined;
  }
  throw new HttpFailure(
    res.status,
    `${who} answered HTTP ${res.status}`,
    res.retryAfter,
    code === undefined || code === null ? undefined : String(code),
  );
}

/** The failed `SendResult` for a thrown error: HTTP status, rejected fetch, or anything else. */
function failureOf(err: unknown): SendResult {
  if (err instanceof HttpFailure) {
    return sendErrorFromHttp(err.status, err.message, {
      ...(err.retryAfter === undefined ? {} : { retryAfter: err.retryAfter }),
      ...(err.platformCode === undefined ? {} : { platformCode: err.platformCode }),
    });
  }
  const code = err instanceof NetworkFailure ? "network_error" : "platform_error";
  return { ok: false, error: { code, message: messageOf(err) } };
}

/**
 * A 200 answer whose body carries a platform error code. No code is mapped to `rate_limit` or
 * `auth_failed`: QQ's documented codes were not checked, so all stay `platform_error`.
 */
function bodyFailure(message: string, code: unknown): SendResult {
  return { ok: false, error: { code: "platform_error", message, platformCode: String(code) } };
}

/**
 * QQ Bot adapter.
 *
 * `connect()` exchanges the AppID and AppSecret for an access token and answers `true` or `false`,
 * never a throw. Inbound arrives by `handleWebhook(rawBody, signature, timestamp)`, which verifies
 * the Ed25519 signature, answers the callback URL validation, turns a C2C text message into one
 * direct-message event and dispatches it. Replies go through the C2C message API, split at 2000
 * characters, as passive replies to the user's last message (`msg_id`, `msg_seq`) when one is
 * known; a refusal comes back as `platform_error` with QQ's `code` in `platformCode`; an HTTP failure maps by status (429 is `rate_limit`) and a rejected fetch is `network_error`.
 *
 * @public
 */
export class QQAdapter extends BasePlatformAdapter {
  override get capabilities(): AdapterCapabilities {
    return { ...super.capabilities, maxMessageChars: QQ_MESSAGE_LIMIT, threads: false };
  }

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
    const missing = (["appId", "appSecret"] as const).find((key) => !opts[key]);
    if (missing !== undefined) throw new Error(`${LABEL}: opts.${missing} is required`);
    this.opts = opts;
    this.doFetch = opts.fetch ?? defaultFetch;
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    this.connected = await this.fetchToken();
    return this.connected;
  }

  /** Whether a fresh access token was obtained; a failure is logged, never thrown. */
  private async fetchToken(): Promise<boolean> {
    return this.token(true).then(
      () => true,
      (err: unknown) => {
        process.stderr.write(`[${LABEL}] connect failed: ${messageOf(err)}\n`);
        return false;
      },
    );
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
    const channel = {
      valid: (id: string) => id !== "",
      message: "channel.id must be a QQ user openid",
    };
    const refused = this.refuseUnsendable(out, {
      className: "QQAdapter",
      connected: this.connected,
      channel,
    });
    if (refused !== undefined) return refused;
    let messageId = "";
    try {
      for (const text of splitForQQ(this.outboundText(out))) {
        const sent = await this.sendPart(out.channel.id, text);
        if (typeof sent !== "string") return sent;
        messageId = sent || messageId;
      }
    } catch (err) {
      return failureOf(err);
    }
    return { ok: true, messageId };
  }

  /** Send one part; answers the message id, or the failure QQ reported. */
  private async sendPart(openid: string, text: string): Promise<string | SendResult> {
    const url = `${this.opts.apiBase ?? DEFAULT_API}/v2/users/${encodeURIComponent(openid)}/messages`;
    const payload = { content: text, msg_type: 0, ...this.nextReplyRef(openid) };
    const body = await this.call("POST", url, await this.token(false), payload);
    if (body.code === undefined) return body.id ?? "";
    const message = `QQ error ${String(body.code)}: ${String(body.message)}`;
    return bodyFailure(message, body.code);
  }

  onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    return this.subscribe(handler);
  }

  /** Deliver an event that arrived out of band, through `runHandler`. */
  override deliver(event: GatewayMessageEvent) {
    return this.deliverInbound(event);
  }

  /** Whether `signature` and `timestamp` are the valid callback headers for `rawBody`. */
  verifyWebhook(
    rawBody: string,
    signature: string | undefined,
    timestamp: string | undefined,
  ): boolean {
    return verifyQQSignature(this.opts.appSecret, rawBody, signature, timestamp);
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
    const payload = parseJson<QQWebhookPayload>(rawBody);
    if (payload === undefined) return { status: 400, reason: "body is not JSON" };
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return { status: 400, reason: "body is not a JSON object" };
    }
    // The URL validation (op 13) is signed by us, not by QQ: QQ checks our answer.
    if (payload.op === 13) return this.validation(payload);
    if (!this.verifyWebhook(rawBody, signature, timestamp)) {
      return { status: 401, reason: "signature mismatch" };
    }
    return this.ingestWebhook(payload);
  }

  /** Dispatch a verified, parsed webhook payload; the shared tail of `handleWebhook` and the descriptor. */
  async ingestWebhook(parsed: unknown): Promise<QQWebhookAnswer> {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { status: 400, reason: "body is not a JSON object" };
    }
    const event = toMessageEvent(parsed as QQWebhookPayload);
    if (event === undefined) return { status: 200, reason: "not a direct text message" };
    // Before dispatch: the handler's reply is the one that answers this message.
    this.rememberReplyRef(event.channel.id, event.id);
    const outcome = await this.dispatchOnce(this.seen, event, LABEL);
    return outcome === "no_handler"
      ? { status: 503, reason: "no handler subscribed" }
      : { status: 200, reason: outcome };
  }

  private validation(payload: QQWebhookPayload): QQWebhookAnswer {
    const plain = payload.d?.plain_token;
    const ts = payload.d?.event_ts;
    if (!plain || !ts) return { status: 400, reason: "validation has no plain_token or event_ts" };
    // Answer only values in the shape QQ sends. The same key verifies events over
    // `timestamp + rawBody`, and neither charset contains `{`, so an answer never covers a JSON
    // object.
    if (typeof plain !== "string" || !PLAIN_TOKEN_SHAPE.test(plain)) {
      return { status: 400, reason: "validation plain_token is not a token" };
    }
    if (typeof ts !== "string" || !EVENT_TS_SHAPE.test(ts)) {
      return { status: 400, reason: "validation event_ts is not a timestamp" };
    }
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
    const fresh = force ? undefined : this.cachedToken();
    if (fresh !== undefined) return fresh;
    const body = await this.call("POST", this.opts.tokenUrl ?? DEFAULT_TOKEN_URL, undefined, {
      appId: this.opts.appId,
      clientSecret: this.opts.appSecret,
    });
    if (body.code !== undefined) {
      throw new Error(`token answered error ${String(body.code)}: ${String(body.message)}`);
    }
    if (!body.access_token) throw new Error("token answer has no access_token");
    const ttl = Number(body.expires_in);
    const seconds = Number.isFinite(ttl) && ttl > 0 ? ttl : 7200;
    this.accessToken = { value: body.access_token, expiresAt: Date.now() + seconds * 1000 };
    return body.access_token;
  }

  /** The cached token while it has more than the refresh margin left. */
  private cachedToken(): string | undefined {
    const cached = this.accessToken;
    return cached !== undefined && cached.expiresAt - TOKEN_MARGIN_MS > Date.now()
      ? cached.value
      : undefined;
  }

  private async call(
    method: "POST",
    url: string,
    token: string | undefined,
    payload: unknown,
  ): Promise<ApiBody> {
    const auth: Record<string, string> =
      token === undefined
        ? {}
        : { Authorization: `QQBot ${token}`, "X-Union-Appid": this.opts.appId };
    const res = await fetchText(this.doFetch, url, {
      method,
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify(payload),
    });
    assertHttpOk("QQ", res, res.text, (b) => b?.code);
    const body = parseJson<ApiBody>(res.text);
    if (body === undefined) throw new Error(`QQ answered HTTP ${res.status} with a non-JSON body`);
    return body;
  }
}

function parseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
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
