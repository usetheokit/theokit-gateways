/**
 * `YuanbaoAdapter` — `BasePlatformAdapter` over a Tencent Yuanbao (元宝) bot: signed JSON webhook
 * in, bot message API out.
 *
 * @public
 */

import {
  type AdapterCapabilities,
  BasePlatformAdapter,
  createTokenCache,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  SeenIds,
  type SendResult,
  sendErrorFromHttp,
} from "@theokit/gateway";

import { refuseAttachments } from "./refuse-attachments.js";
import { verifyYuanbaoSignature } from "./signature.js";
import { splitForYuanbao, YUANBAO_MESSAGE_LIMIT } from "./split.js";
import type { YuanbaoAdapterOptions, YuanbaoFetch, YuanbaoWebhookEvent } from "./types.js";

const LABEL = "gateway-yuanbao";
const DEFAULT_BASE = "https://yuanbao.tencent.com";
const REQUEST_TIMEOUT_MS = 30_000;

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
  return { status: res.status, text: () => res.text(), headers: res.headers };
};

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
  doFetch: YuanbaoFetch,
  url: string,
  init: Parameters<YuanbaoFetch>[1],
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
 * `auth_failed`: Yuanbao's documented codes were not checked, so all stay `platform_error`.
 */
function bodyFailure(message: string, code: unknown): SendResult {
  return { ok: false, error: { code: "platform_error", message, platformCode: String(code) } };
}

/**
 * Tencent Yuanbao bot adapter.
 *
 * `connect()` exchanges the app id and secret for an access token and answers `true` or `false`,
 * never a throw. Inbound arrives by `handleWebhook(rawBody, signature, timestamp)`, which verifies
 * the signature, turns a text message into one direct-message event and dispatches it. Replies go
 * through the bot message API, split at 2000 characters; a refusal comes back as
 * `platform_error` with Yuanbao's `code` in `platformCode`; an HTTP failure maps by status
 * (429 is `rate_limit`) and a rejected fetch is `network_error`. The token is refreshed before it
 * expires.
 *
 * @public
 */
export class YuanbaoAdapter extends BasePlatformAdapter {
  readonly platform = "yuanbao" as const;

  /** The platform facts; `maxMessageChars` is the splitter\'s limit. */
  override get capabilities(): AdapterCapabilities {
    return { ...super.capabilities, maxMessageChars: YUANBAO_MESSAGE_LIMIT };
  }
  private readonly opts: YuanbaoAdapterOptions;
  private readonly doFetch: YuanbaoFetch;
  private connected = false;
  private readonly tokens = createTokenCache({ fetchToken: () => this.requestToken() });
  private readonly seen = new SeenIds();

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
      await this.tokens.get({ force: true });
      this.connected = true;
      return true;
    } catch (err) {
      process.stderr.write(`[${LABEL}] connect failed: ${messageOf(err)}\n`);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.tokens.clear();
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    return refuseAttachments(out) ?? this.sendText(out);
  }

  private async sendText(out: OutboundMessage): Promise<SendResult> {
    const refused = this.refuseUnsendable(out, {
      className: "YuanbaoAdapter",
      connected: this.connected,
      channel: { valid: (id) => id !== "", message: "channel.id must be a Yuanbao user id" },
    });
    if (refused !== undefined) return refused;
    let messageId = "";
    try {
      for (const text of splitForYuanbao(this.outboundText(out))) {
        const token = await this.tokens.get();
        const body = await this.call("POST", "/open-apis/message/send", token, {
          receive_id: out.channel.id,
          msg_type: "text",
          content: { text },
        });
        if (body.code !== 0) {
          return bodyFailure(`Yuanbao error ${String(body.code)}: ${String(body.msg)}`, body.code);
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

  /** Whether `signature` and `timestamp` are the valid callback headers for `rawBody`. */
  verifyWebhook(
    rawBody: string,
    signature: string | undefined,
    timestamp: string | undefined,
  ): boolean {
    return verifyYuanbaoSignature(this.opts.callbackSecret, rawBody, signature, timestamp);
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
    if (!this.verifyWebhook(rawBody, signature, timestamp)) {
      return { status: 401, reason: "signature mismatch" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return { status: 400, reason: "body is not JSON" };
    }
    return this.ingestWebhook(parsed);
  }

  /** Dispatch a verified, parsed webhook payload; the shared tail of `handleWebhook` and the descriptor. */
  async ingestWebhook(parsed: unknown): Promise<YuanbaoWebhookAnswer> {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { status: 400, reason: "body is not a JSON object" };
    }
    const event = toMessageEvent(parsed as YuanbaoWebhookEvent);
    if (event === undefined) return { status: 200, reason: "not a text message" };
    const outcome = await this.dispatchOnce(this.seen, event, LABEL);
    if (outcome === "no_handler") return { status: 503, reason: "no handler subscribed" };
    return { status: 200, reason: outcome };
  }

  private async requestToken(): Promise<{ value: string; expiresInS?: number }> {
    const body = await this.call("POST", "/open-apis/auth/token", undefined, {
      app_id: this.opts.appId,
      app_secret: this.opts.appSecret,
    });
    if (body.code !== undefined && body.code !== 0) {
      throw new Error(`token answered error ${String(body.code)}: ${String(body.msg)}`);
    }
    const value = body.data?.access_token;
    if (!value) throw new Error("token answer has no access_token");
    return { value, expiresInS: body.data?.expires_in };
  }

  private async call(
    method: "POST",
    path: string,
    token: string | undefined,
    payload: unknown,
  ): Promise<ApiBody> {
    const res = await fetchText(this.doFetch, (this.opts.apiBase ?? DEFAULT_BASE) + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(payload),
    });
    const text = res.text;
    assertHttpOk("Yuanbao", res, text, (b) => b?.code);
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
