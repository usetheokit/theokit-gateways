/**
 * `ZaloAdapter` — `BasePlatformAdapter` over a Zalo Official Account: webhook in, OA Open API out.
 *
 * @public
 */

import {
  type AdapterCapabilities,
  BasePlatformAdapter,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  SeenIds,
  type SendResult,
  sendErrorFromHttp,
} from "@theokit/gateway";

import { refuseAttachments } from "./refuse-attachments.js";
import { verifyZaloSignature } from "./signature.js";
import { splitForZalo, ZALO_MESSAGE_LIMIT } from "./split.js";
import type { ZaloAdapterOptions, ZaloFetch, ZaloWebhookEvent } from "./types.js";

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
  doFetch: ZaloFetch,
  url: string,
  init: Parameters<ZaloFetch>[1],
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
 * `auth_failed`: Zalo's documented codes were not checked, so all stay `platform_error`.
 */
function bodyFailure(message: string, code: unknown): SendResult {
  return { ok: false, error: { code: "platform_error", message, platformCode: String(code) } };
}

const LABEL = "gateway-zalo";
const DEFAULT_BASE = "https://openapi.zalo.me";
const REQUEST_TIMEOUT_MS = 30_000;

/** What a webhook route answers: 200 acknowledges, anything else makes Zalo redeliver. */
export type ZaloWebhookAnswer = { readonly status: 200 | 401 | 400 | 503; readonly reason: string };

const defaultFetch: ZaloFetch = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { status: res.status, text: () => res.text(), headers: res.headers };
};

/**
 * Zalo Official Account adapter.
 *
 * `connect()` checks the access token with `getoa` and answers `true` or `false`, never a throw.
 * Inbound arrives by `handleWebhook(rawBody, signatureHeader)`, which verifies the signature,
 * turns a `user_send_text` event into one event and dispatches it. A reply over 2000 characters
 * goes as several messages. A Zalo OA may message a user only within Zalo's customer-service
 * window; a refusal comes back as `platform_error` with Zalo's error code in `platformCode`;
 * an HTTP failure maps by status (429 is `rate_limit`) and a rejected fetch is
 * `network_error`.
 *
 * @public
 */
export class ZaloAdapter extends BasePlatformAdapter {
  readonly platform = "zalo" as const;

  /** The platform facts; `maxMessageChars` is the splitter\'s limit. */
  override get capabilities(): AdapterCapabilities {
    return { ...super.capabilities, maxMessageChars: ZALO_MESSAGE_LIMIT };
  }
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
          return bodyFailure(
            `Zalo error ${String(body.error)}: ${String(body.message)}`,
            body.error,
          );
        }
        messageId = body.data?.message_id ?? messageId;
      }
    } catch (err) {
      return failureOf(err);
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

  /** Whether `signature` is the valid `X-ZEvent-Signature` for `rawBody`. */
  verifyWebhook(rawBody: string, signature: string | undefined): boolean {
    return verifyZaloSignature(this.opts, rawBody, signature);
  }

  /**
   * Webhook entry: verify, parse and dispatch. Answer `status` 200 only when the event was
   * handled or is not for this adapter; `503` (no handler subscribed) must not be acknowledged,
   * or Zalo does not redeliver and the message is lost.
   */
  async handleWebhook(rawBody: string, signature: string | undefined): Promise<ZaloWebhookAnswer> {
    if (!this.verifyWebhook(rawBody, signature)) {
      return { status: 401, reason: "signature mismatch" };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return { status: 400, reason: "body is not JSON" };
    }
    return this.ingestWebhook(payload);
  }

  /** Dispatch a verified, parsed webhook payload; the shared tail of `handleWebhook` and the descriptor. */
  async ingestWebhook(parsed: unknown): Promise<ZaloWebhookAnswer> {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { status: 400, reason: "body is not a JSON object" };
    }
    const payload = parsed as ZaloWebhookEvent;
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
    const res = await fetchText(this.doFetch, (this.opts.apiBase ?? DEFAULT_BASE) + path, {
      method,
      headers: { access_token: this.opts.accessToken, "Content-Type": "application/json" },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const text = res.text;
    assertHttpOk("Zalo", res, text, (b) => b?.error);
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
