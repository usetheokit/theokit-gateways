/**
 * `WeixinAdapterBase` — the connect / token / send / dispatch flow that the WeChat and WeCom
 * adapters share. A subclass supplies the platform's endpoints, its signature check and its event
 * shape; this class owns everything else.
 *
 * @public
 */

import { SeenIds } from "../text/seen-ids.js";
import type { MessageEvent as GatewayMessageEvent } from "../types/message-event.js";
import { BasePlatformAdapter, type OutboundMessage, type SendResult } from "./base.js";
import { parseFlatXml } from "./weixin-xml.js";

const REQUEST_TIMEOUT_MS = 30_000;
/** Refresh this long before the token's stated expiry. */
const TOKEN_MARGIN_MS = 60_000;

/** A `fetch`-shaped function; the adapter's only network seam. @public */
export type WeixinFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

/**
 * What a webhook route answers. `body` is the text to write back; anything but 200 makes the
 * platform retry.
 *
 * @public
 */
export type WeixinWebhookAnswer = {
  readonly status: 200 | 400 | 401 | 503;
  readonly body: string;
  readonly reason: string;
};

/** What a subclass tells the base about its platform. @public */
export interface WeixinAdapterConfig {
  /** Log prefix, e.g. `gateway-wechat`. */
  readonly label: string;
  /** Class name used in the `not_connected` message, e.g. `WeChatAdapter`. */
  readonly className: string;
  /** Brand used in messages, e.g. `WeChat`. */
  readonly brand: string;
  /** What `channel.id` must be, e.g. `a WeChat OpenID`. */
  readonly userNoun: string;
  /** API base used when `apiBase` is not set. */
  readonly defaultBase: string;
  readonly apiBase?: string;
  readonly fetch?: WeixinFetch;
}

/** One send call: a path (with its access token) and a JSON payload. @public */
export interface WeixinSendRequest {
  readonly path: string;
  readonly payload: unknown;
}

interface ApiBody {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
}

const defaultFetch: WeixinFetch = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { status: res.status, text: () => res.text() };
};

function weixinMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function weixinAck(reason: string): WeixinWebhookAnswer {
  return { status: 200, body: "success", reason };
}

/**
 * Shared base of the WeChat and WeCom adapters.
 *
 * @public
 */
export abstract class WeixinAdapterBase extends BasePlatformAdapter {
  private readonly cfg: WeixinAdapterConfig;
  private readonly doFetch: WeixinFetch;
  private connected = false;
  private accessToken: { value: string; expiresAt: number } | undefined;
  private readonly seen = new SeenIds();

  constructor(cfg: WeixinAdapterConfig) {
    super();
    this.cfg = cfg;
    this.doFetch = cfg.fetch ?? defaultFetch;
  }

  /** Path and query of the access-token request. */
  protected abstract tokenPath(): string;
  /** The send call for one part of a reply. */
  protected abstract sendRequest(token: string, userId: string, content: string): WeixinSendRequest;
  /** Cut a reply into parts the platform accepts. */
  protected abstract split(text: string): string[];
  /** The event for a text message, `"skip"` for another type, `undefined` for a text with gaps. */
  protected abstract toEvent(
    fields: Record<string, string>,
  ): GatewayMessageEvent | "skip" | undefined;

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    try {
      await this.token(true);
      this.connected = true;
      return true;
    } catch (err) {
      process.stderr.write(`[${this.cfg.label}] connect failed: ${weixinMessageOf(err)}\n`);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.accessToken = undefined;
  }

  /** Send text only; a subclass's `sendMessage` refuses attachments first, then calls this. */
  protected async sendText(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "outbound text is empty" } };
    }
    if (!this.connected) {
      return {
        ok: false,
        error: {
          code: "not_connected",
          message: `${this.cfg.className}.connect() has not succeeded`,
        },
      };
    }
    if (out.channel.id === "") {
      return {
        ok: false,
        error: { code: "invalid_channel", message: `channel.id must be ${this.cfg.userNoun}` },
      };
    }
    return this.sendParts(out);
  }

  private async sendParts(out: OutboundMessage): Promise<SendResult> {
    const failed = `${this.platform}_send_failed`;
    try {
      for (const content of this.split(this.outboundText(out))) {
        const token = await this.token(false);
        const req = this.sendRequest(token, out.channel.id, content);
        const body = await this.call("POST", req.path, req.payload);
        if (body.errcode !== 0) {
          return {
            ok: false,
            error: {
              code: failed,
              message: `${this.cfg.brand} error ${String(body.errcode)}: ${String(body.errmsg)}`,
            },
          };
        }
      }
    } catch (err) {
      return { ok: false, error: { code: failed, message: weixinMessageOf(err) } };
    }
    // The send answer carries no message id a reply needs.
    return { ok: true, messageId: "" };
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

  /** Turn a plain (decrypted) XML body into one event, dispatch it and answer the webhook. */
  protected async handleMessage(xml: string): Promise<WeixinWebhookAnswer> {
    const event = this.toEvent(parseFlatXml(xml));
    if (event === "skip") return weixinAck("not a text message");
    if (event === undefined) return { status: 400, body: "", reason: "incomplete" };
    const outcome = await this.dispatchOnce(this.seen, event, this.cfg.label);
    if (outcome === "no_handler") return { status: 503, body: "", reason: "no handler subscribed" };
    return weixinAck(outcome);
  }

  private async token(force: boolean): Promise<string> {
    const cached = this.accessToken;
    if (!force && cached !== undefined && cached.expiresAt - TOKEN_MARGIN_MS > Date.now()) {
      return cached.value;
    }
    const body = await this.call("GET", this.tokenPath());
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
    const res = await this.doFetch((this.cfg.apiBase ?? this.cfg.defaultBase) + path, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as ApiBody;
    } catch {
      throw new Error(`${this.cfg.brand} answered HTTP ${res.status} with a non-JSON body`);
    }
  }
}
